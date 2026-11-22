// A hero's scouting sheet during a match: who he is and where he plays, his body (the 40-yard dash, the bench
// press), his abilities, and his numbers — this season's for the club's own heroes, this match's for the other
// side. It opens beside the hero: under the mouse, or with a tap on the field. It has no buttons and needs no
// closing: it goes when the pointer leaves the hero, the field is tapped elsewhere, or a play begins.

import { h } from '../core/dom';
import { bench, forty, lineOf, passerRating, played, rolesOf, type Box, type Line } from '../game/boxscore';
import { hero } from '../game/heroes';
import type { TeamSheet } from '../game/match';
import { ROLE_LABEL, STATS, STAT_LABEL, type Role } from '../game/model';
import type { Member } from '../game/season';
import { gradeChip, rankChip, statIcon } from './kit';

/** What the sheet needs to know about the hero and his numbers. */
export interface CardFacts {
  team: TeamSheet;
  /** the club's own hero (his school year is shown) */
  member?: Member;
  id: number;
  /** the numbers to show, and what they cover */
  line: Line;
  span: 'season' | 'match';
  /** matches these numbers come from (the season's) */
  games: number;
  /** eleven a side, the hero's duel in this match (game/duel.ts) */
  duel?: { w: number; l: number; beast: boolean } | null;
}

const avg = (a: number | undefined, b: number | undefined, digits = 1): string => (b ? (Math.round(((a ?? 0) / b) * 10 ** digits) / 10 ** digits).toFixed(digits) : '—');
const pct = (a: number | undefined, b: number | undefined): string => (b ? `${Math.round(((a ?? 0) / b) * 100)}%` : '—');
const n = (v: number | undefined): string => String(v ?? 0);
const of = (a: number | undefined, b: number | undefined): string => `${a ?? 0}/${b ?? 0}`;

/** One block of numbers: a heading and a row of label/value cells. */
type Cell = [label: string, value: string, unit?: string];
interface Block { key: string; head: string; tag: string; cells: Cell[] }

/** The numbers that matter for each kind of player, the way the pro game keeps them. */
function blocks(l: Line, roles: { off: Role | null; def: Role | null; kicker: boolean }): Block[] {
  const out: Block[] = [];
  const off = roles.off;
  if (off === 'QB' || (l.att ?? 0) > 0) {
    const rate = passerRating(l);
    out.push({ key: 'pass', head: 'パス', tag: 'QB', cells: [
      ['成功', of(l.cmp, l.att)], ['成功率', pct(l.cmp, l.att)], ['獲得', n(l.py), 'yd'], ['TD', n(l.ptd)], ['INT', n(l.pi)],
      ['レーティング', rate == null ? '—' : rate.toFixed(1)], ['被サック', n(l.sk)],
    ] });
  }
  if (off === 'RB' || (l.car ?? 0) > 0) {
    out.push({ key: 'run', head: 'ラン', tag: 'RB', cells: [
      ['キャリー', n(l.car)], ['獲得', n(l.ry), 'yd'], ['平均', avg(l.ry, l.car), 'yd'], ['TD', n(l.rtd)], ['最長', n(l.rlong), 'yd'], ['ファンブル', n(l.fum)],
    ] });
  }
  if (off === 'WR' || off === 'TE' || (l.tgt ?? 0) > 0) {
    out.push({ key: 'rec', head: 'レシーブ', tag: off === 'TE' ? 'TE' : 'WR', cells: [
      ['キャッチ', of(l.rec, l.tgt)], ['捕球率', pct(l.rec, l.tgt)], ['獲得', n(l.cy), 'yd'], ['平均', avg(l.cy, l.rec), 'yd'], ['TD', n(l.ctd)], ['最長', n(l.clong), 'yd'],
    ] });
  }
  if (off === 'OL' || (l.lc ?? 0) + (l.lsk ?? 0) > 0) {
    out.push({ key: 'line', head: 'ブロック', tag: 'OL', cells: [
      ['出場プレー', n(l.os)], ['背後のラン', n(l.lc), '回'], ['ラン平均', avg(l.ly, l.lc), 'yd'], ['許したサック', n(l.lsk)],
    ] });
  }
  const def = roles.def;
  if (def || (l.ds ?? 0) > 0) {
    const tag = def ? ROLE_LABEL[def] : '守備';
    const cells: Cell[] = def === 'CB' || def === 'S'
      ? [['INT', n(l.int)], ['パス阻止', n(l.pd)], ['タックル', n(l.tk)], ['ファンブル奪取', n(l.ff)]]
      : def === 'DL'
        ? [['タックル', n(l.tk)], ['サック', n(l.sck)], ['ロスタックル', n(l.tfl)], ['ファンブル奪取', n(l.ff)]]
        : [['タックル', n(l.tk)], ['サック', n(l.sck)], ['ロスタックル', n(l.tfl)], ['INT', n(l.int)], ['パス阻止', n(l.pd)]];
    if (l.rtn && !l.kr) cells.push(['リターンTD', n(l.rtn)]);
    out.push({ key: 'def', head: '守備', tag, cells: [['出場プレー', n(l.ds)], ...cells] });
  }
  if (roles.kicker || (l.fga ?? 0) + (l.xpa ?? 0) + (l.pn ?? 0) + (l.ko ?? 0) > 0) {
    const cells: Cell[] = [['FG', of(l.fgm, l.fga)], ['成功率', pct(l.fgm, l.fga)], ['最長', l.fgl ? String(l.fgl) : '—', l.fgl ? 'yd' : undefined], ['TFP', of(l.xpm, l.xpa)]];
    if (l.pn) cells.push(['パント平均', avg(l.pny, l.pn), 'yd']);
    out.push({ key: 'kick', head: 'キック', tag: 'K', cells });
  }
  if ((l.kr ?? 0) > 0) {
    const cells: Cell[] = [['回数', n(l.kr)], ['獲得', n(l.kry), 'yd'], ['平均', avg(l.kry, l.kr), 'yd']];
    if (l.rtn) cells.push(['TD', n(l.rtn)]);
    out.push({ key: 'ret', head: 'リターン', tag: 'KR', cells });
  }
  return out;
}

/** The sheet itself. */
export function heroCard(f: CardFacts): HTMLElement {
  const p = f.team.players.find((x) => x.id === f.id)!;
  const roles = rolesOf(f.team, f.id);
  const art = hero(f.id);
  const where = [roles.off ? ROLE_LABEL[roles.off] : null, roles.def ? ROLE_LABEL[roles.def] : null, roles.kicker ? 'K' : null].filter(Boolean).join('・');
  const list = blocks(f.line, roles);
  const span = f.span === 'season' ? `今シーズン${f.games ? `（${f.games}試合）` : ''}` : 'この試合';
  return h('div.hcard', { style: { '--tc': f.team.color }, role: 'tooltip' },
    h('div.hcard-head',
      h('div.hcard-art', art ? h('img.px', { src: art.img, alt: '', draggable: false }) : null),
      h('div.hcard-who',
        h('div.hcard-pos', where ? h('b', where) : h('b.is-bench', '控え'), f.member ? gradeChip(f.member.grade ?? 1) : null),
        h('strong', p.name),
        h('span', f.team.name),
        f.duel ? h('span.hcard-duel', { class: f.duel.beast ? 'is-beast' : '' }, h('i', '対決'), `${f.duel.w}勝${f.duel.l}敗`, f.duel.beast ? h('em', '手がつけられない') : null) : null),
      h('dl.hcard-body',
        h('div', h('dt', '40ヤード走'), h('dd', forty(p.stats, f.id).toFixed(2), h('small', '秒'))),
        h('div', h('dt', 'ベンチプレス'), h('dd', String(bench(p.stats, f.id)), h('small', 'kg'))))),
    h('ul.hcard-stats', STATS.map((k) => h('li', statIcon(k), h('span', STAT_LABEL[k]), h('b', String(Math.round(p.stats[k]))), rankChip(p.stats[k])))),
    h('div.hcard-span', span),
    list.length && played(f.line)
      ? h('div.hcard-blocks', list.map((b) => h('section', { class: `b-${b.key}` },
        h('h4', h('i', b.tag), b.head),
        h('dl', b.cells.map(([label, value, unit]) => h('div', h('dt', label), h('dd', value, unit && value !== '—' ? h('small', unit) : null)))))))
      : h('p.hcard-none', f.span === 'season' ? 'まだ記録がありません' : 'この試合はまだ記録がありません'));
}

/** The numbers for a hero: the club's own heroes show the season (this match included until it is booked). */
export function factsOf(opts: { team: TeamSheet; mine: boolean; id: number; members: Member[]; season?: Box; match?: Box; booked: boolean }, duel?: CardFacts['duel']): CardFacts {
  const { team, mine, id } = opts;
  if (!mine) return { team, id, line: lineOf(id, opts.match), span: 'match', games: 0, duel };
  const now = opts.booked ? undefined : opts.match;
  const line = lineOf(id, opts.season, now);
  const games = (opts.season?.[id]?.gp ?? 0) + (now && played(now[id]) ? 1 : 0);
  line.gp = games;
  return { team, id, member: opts.members.find((m) => m.id === id), line, span: 'season', games, duel };
}
