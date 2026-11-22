// The duels on screen (game/duel.ts): the day's match-ups before the kickoff, the moment two heroes meet on a play,
// and what came of it under the telop. The club is always on the left.

import { sfx } from '../core/audio';
import { speak } from '../core/voice/voice';
import { h } from '../core/dom';
import { hero } from '../game/heroes';
import { clubRecord, defPosOf, offPosOf, skillOf, type Duel } from '../game/duel';
import { roleOf } from '../game/model';
import type { MatchState, PlayResult } from '../game/match';
import { kinetic } from './fx';
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

/** The moment two heroes meet on a play: both pictures, both skills. */
export function duelCut(st: MatchState, res: PlayResult): HTMLElement | null {
  const d = res.duel;
  const du = d ? st.duels?.[d.i] : undefined;
  if (!d || !du) return null;
  return h('div.duel-cut', { class: du.rival ? 'is-rival' : '' },
    h('div.duel-cut-band'),
    h('span.duel-cut-head', kinetic(du.rival ?? '対決！')),
    row(st, du, 0));
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
