// The duels on screen (game/duel.ts): the day's match-ups before the kickoff, the moment two heroes meet on a play
// (a panel of a comic across the screen), the word thrown onto the screen as it is decided, and what came of it
// under the telop. The club is always on the left.

import { sfx } from '../core/audio';
import { speak } from '../core/voice/voice';
import { h } from '../core/dom';
import { hero } from '../game/heroes';
import { clubRecord, defPosOf, offPosOf, skillOf, type Duel } from '../game/duel';
import { isRun, type OffType } from '../game/cards';
import { isEn, nameParts, tr } from '../core/i18n';
import { roleOf } from '../game/model';
import type { MatchState, PlayResult } from '../game/match';
import { sprite } from './kit';

/** A hero's side of a duel: picture, name, position and skill. */
function face(st: MatchState, team: 0 | 1, id: number, unit: 'off' | 'def'): HTMLElement {
  const t = st.teams[team];
  const pos = unit === 'off' ? offPosOf(t, id) : defPosOf(t, id);
  return h('div.duel-face', { class: team === 0 ? 'mine' : 'theirs', style: { '--team': t.color } },
    h('span.duel-art', sprite(id)),
    h('span.duel-who', h('i', pos ? roleOf(pos) : ''), h('b', hero(id).name)),
    h('span.duel-skill', `「${skillOf(id)}」`));
}

/** One duel as a row: the club's hero on the left whichever side attacks. */
function row(st: MatchState, du: Duel, i: number): HTMLElement {
  const ace = face(st, du.side, du.ace, 'off');
  const foe = face(st, (1 - du.side) as 0 | 1, du.foe, 'def');
  const [left, right] = du.side === 0 ? [ace, foe] : [foe, ace];
  return h('div.duel-row', { style: { '--i': String(i) } },
    h('span.duel-kind', du.rival ? h('em', du.rival) : du.side === 0 ? 'こちらの攻撃の柱' : '相手の攻撃の柱'),
    h('div.duel-pair', left, h('b.duel-vs', 'VS'), right));
}

/**
 * The day's duels before the kickoff ("本日の見どころ"). It goes on by itself; a tap goes on at once.
 */
export function showDuels(parent: HTMLElement, st: MatchState): Promise<void> {
  const duels = st.duels ?? [];
  if (!duels.length) return Promise.resolve();
  const layer = h('div.duel-show',
    h('div.duel-panel',
      h('div.duel-head', h('b', '本日の見どころ'), h('span', 'この2つの対決が、試合を決める')),
      ...duels.map((du, i) => row(st, du, i))),
    h('span.duel-tap', 'タップで次へ'));
  parent.append(layer);
  sfx.transition();
  speak('本日の見どころ！', { hot: true });
  return new Promise((resolve) => {
    let done = false;
    const end = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      layer.classList.add('out');
      setTimeout(() => layer.remove(), 260);
      resolve();
    };
    const timer = window.setTimeout(end, 5200);
    layer.addEventListener('pointerup', () => {
      sfx.tap();
      end();
    });
  });
}

// ---------------------------------------------------------------- the moment two heroes meet on a play
//
// A panel of a comic across the screen: the two heroes large, each in his own half with the air streaking past him
// toward the other, their names in fat letters like sound effects, and a "V.S." burst between them.

/** deterministic noise for the drawings (the same panel every time) */
const rnd = (i: number): number => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Speed lines as a picture that repeats sideways: dashes of ink and of light, of every length. */
function streaks(seed: number): string {
  const W = 900;
  const H = 300;
  let rects = '';
  for (let i = 0; i < 46; i += 1) {
    const y = Math.round(rnd(seed + i * 3) * H);
    const w = Math.round(120 + rnd(seed + i * 3 + 1) * 520);
    const x = Math.round(rnd(seed + i * 3 + 2) * W);
    const t = (1 + rnd(seed + i * 7) * 4.5).toFixed(1);
    const ink = i % 3 === 0;
    const fill = ink ? 'rgba(6,8,28,0.55)' : `rgba(255,255,255,${(0.3 + rnd(seed + i) * 0.6).toFixed(2)})`;
    // (drawn twice, a page apart, so that the picture joins itself at the edge)
    rects += `<rect x="${x}" y="${y}" width="${w}" height="${t}" fill="${fill}"/><rect x="${x - W}" y="${y}" width="${w}" height="${t}" fill="${fill}"/>`;
  }
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${rects}</svg>`)}")`;
}
const STREAKS = [streaks(1), streaks(57)];

/** A burst with jagged points, as a clip-path (percentages). */
function burst(points: number, seed: number, deep: number): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? deep + rnd(seed + i) * 8 : 42 + rnd(seed + i) * 8;
    out.push(`${(50 + Math.cos(a) * r).toFixed(1)}% ${(50 + Math.sin(a) * r).toFixed(1)}%`);
  }
  return `polygon(${out.join(',')})`;
}

/** Letters like a sound effect: each its own span, tipped and nudged a little (the same way every time). */
function comic(text: string, seed: number): HTMLElement {
  const letters = [...text];
  return h('span.dc-letters', { 'data-no-tr': '', style: { '--n': String(Math.max(3, letters.length)) } },
    ...letters.map((ch, i) => h('i', {
      style: { '--r': `${((rnd(seed + i * 2) - 0.5) * 11).toFixed(1)}deg`, '--y': `${((rnd(seed + i * 2 + 1) - 0.5) * 0.5).toFixed(2)}rem`, '--d': String(i) },
    }, ch === ' ' ? '\u00a0' : ch)));
}

/** The name as the panel writes it: the whole name in Japanese, the last name in English (the letters are large). */
const panelName = (id: number): string => (isEn() ? nameParts(hero(id).name).pop()! : hero(id).name);

/** One hero's half of the panel. `left`: the club's side (the hero looks right). */
function half(st: MatchState, team: 0 | 1, id: number, unit: 'off' | 'def', left: boolean): HTMLElement {
  const t = st.teams[team];
  const pos = unit === 'off' ? offPosOf(t, id) : defPosOf(t, id);
  return h('div.dc-half', { class: left ? 'is-left' : 'is-right', style: { '--team': t.color, '--streaks': STREAKS[left ? 0 : 1]! } },
    h('i.dc-tone'),
    h('i.dc-air'),
    h('i.dc-air.is-far'),
    h('span.dc-hero', sprite(id)),
    h('div.dc-who',
      h('span.dc-tag', h('b', pos ? roleOf(pos) : ''), h('em', unit === 'off' ? '攻撃のエース' : '守備のエース')),
      h('span.dc-name', comic(tr(panelName(id)), id)),
      h('span.dc-skill', `「${tr(skillOf(id))}」`)));
}

/**
 * The moment two heroes meet on a play: the panel. The club is on the left whichever side attacks.
 * `first`: their first meeting today (the panel takes its time); later ones are over quickly.
 */
export function duelCut(st: MatchState, res: PlayResult): HTMLElement | null {
  const d = res.duel;
  const du = d ? st.duels?.[d.i] : undefined;
  if (!d || !du) return null;
  const ace = half(st, du.side, du.ace, 'off', du.side === 0);
  const foe = half(st, (1 - du.side) as 0 | 1, du.foe, 'def', du.side !== 0);
  const [left, right] = du.side === 0 ? [ace, foe] : [foe, ace];
  return h('div.duel-cut', { class: du.rival ? 'is-rival' : '' },
    h('div.dc-band',
      left, right,
      h('i.dc-gutter')),
    h('div.dc-vs', { style: { '--burst': burst(13, 5, 26), '--burst2': burst(13, 5, 23) } }, h('i.dc-vs-ink'), h('i.dc-vs-paper'), h('b', { 'data-no-tr': '' }, 'V.S.')),
    h('span.dc-head', comic(tr(du.rival ?? '対決！'), 3)));
}

/** How the day's duel was decided, for the word that is thrown onto the screen at its moment. */
export type DuelEnd = 'through' | 'catch' | 'stop' | 'deny' | 'steal';
const WORD: Record<DuelEnd, string> = { through: '抜いたッ！！', catch: '捕ったッ！！', stop: '止めたッ！！', deny: 'はじいたッ！！', steal: '奪ったッ！！' };

/** What a play's duel came to (null: no duel on it). */
export function duelEnd(res: PlayResult): DuelEnd | null {
  if (!res.duel) return null;
  const run = isRun(res.offPick.type as OffType);
  if (res.turnover === 'int' || res.turnover === 'fumble') return 'steal';
  if (res.outcome === 'sack') return 'stop';
  if (res.outcome === 'incomplete') return 'deny';
  if (run) return res.duel.win ? 'through' : 'stop';
  return res.duel.win || res.yards > 2 ? 'catch' : 'stop';
}

/** The word thrown onto the screen as the duel is decided ("抜いたッ！！"), in the colour of the side it went to. */
export function duelWord(st: MatchState, res: PlayResult, end: DuelEnd): HTMLElement {
  const offWon = end === 'through' || end === 'catch';
  const team = offWon ? res.off : ((1 - res.off) as 0 | 1);
  return h('div.duel-word', { class: offWon ? 'is-off' : 'is-def', style: { '--team': st.teams[team].color, '--burst': burst(16, 9, 30) } },
    h('i.dw-burst'),
    comic(tr(WORD[end]), 11));
}

/** What came of the duel, for under the telop (null: no duel on this play). */
export function duelTag(st: MatchState, res: PlayResult): HTMLElement | null {
  const d = res.duel;
  const du = d ? st.duels?.[d.i] : undefined;
  if (!d || !du) return null;
  const winner = d.win ? du.ace : du.foe;
  const team: 0 | 1 = d.win ? du.side : ((1 - du.side) as 0 | 1);
  const text = d.stopped ? `${hero(winner).name}が止めた！` : d.born ? `${hero(winner).name}、手がつけられない！` : `対決は${hero(winner).name}の勝ち`;
  return h('span.telop-duel', { class: `${team === 0 ? 'mine' : 'theirs'} ${d.born ? 'is-beast' : ''} ${d.stopped ? 'is-stop' : ''}` }, sprite(winner), text);
}

/** The club's duels so far, for the scoreboard ("対決 2勝1敗"); null when the match has none. */
export function duelScore(st: MatchState): HTMLElement | null {
  if (!st.duels?.length) return null;
  const r = clubRecord(st.duels);
  return h('span.bug-duel', { title: '注目の対決の勝ち負け（こちらから見て）' }, h('em', '対決'), h('b', `${r.w}勝${r.l}敗`));
}
