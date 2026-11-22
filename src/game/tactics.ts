// A team's colour (its tactic), eleven a side: how it scores and how it is scored on.
//
// When the club first plays eleven a side it takes one of four colours (the manager suggests the one its heroes
// suit); it may change it each spring, at the meeting. Every school that plays eleven a side has one too, and the two
// best have a fifth, the all-round one. A colour gets stronger the more the club wins with it (its level, 1 to 5);
// changing it starts the level again from 1.
//
//  - speed  (速攻)   breakaways and kickoffs run all the way back; it gives up big plays too. May kick onside whenever behind
//  - iron   (鉄壁)   the other side gains less and loses the ball more (and gets it run back); its own big plays are rare
//  - ground (地上戦) runs go further; strong against the run, weak against the long pass. Ahead, a run takes two plays off the clock
//  - air    (空中戦) passes are caught and the long ones go further; weak against the run. Late on, an incomplete pass stops the clock
//  - royal  (王道)   a little of everything (the two best schools only)
//
// Each colour has a small edge on the next: iron > speed > ground > air > iron. The edge is small: the duels decide.
// Nothing here uses the match's dice. Six a side has no colours.

import type { Stats } from './model';

export type Tactic = 'speed' | 'iron' | 'ground' | 'air' | 'royal';
/** the four the club can take */
export const TACTICS: readonly Tactic[] = ['speed', 'iron', 'ground', 'air'];

export interface TacticInfo {
  name: string;
  /** what kind of team it is, in a word */
  kind: string;
  /** what it does, one line each: its strength and its weakness */
  good: string;
  bad: string;
  color: string;
}

export const TACTIC: Record<Tactic, TacticInfo> = {
  speed: { name: '速攻', kind: '攻撃型', good: '抜けると独走。キックオフからも走りきる', bad: '前がかりで、相手のビッグプレーも出やすい', color: '#ff7a2e' },
  iron: { name: '鉄壁', kind: '守備型', good: '相手が進めない。奪ったボールを走りきる', bad: '手堅いぶん、自分のビッグプレーは少ない', color: '#5b8cff' },
  ground: { name: '地上戦', kind: 'ラン型', good: 'ランがよく進み、ランを止める。リード中は時計を進める', bad: '深いパスに弱い', color: '#6fd34a' },
  air: { name: '空中戦', kind: 'パス型', good: 'パスが通り、ロングパスが伸びる。終盤は時計が止まる', bad: 'ランに押しきられやすい', color: '#37e3ff' },
  royal: { name: '王道', kind: '王者', good: 'どれも少しずつ強い', bad: 'はっきりした弱点がない', color: '#ffe14a' },
};

/** Each colour has a small edge on the next one. */
const BEATS: Partial<Record<Tactic, Tactic>> = { iron: 'speed', speed: 'ground', ground: 'air', air: 'iron' };
/** +1: a has the edge on b, -1: b on a, 0: neither. */
export const edgeOf = (a: Tactic | undefined, b: Tactic | undefined): -1 | 0 | 1 =>
  !a || !b ? 0 : BEATS[a] === b ? 1 : BEATS[b] === a ? -1 : 0;

/** Wins with a colour that take it to each level (level 1 to start). */
export const LEVEL_WINS: readonly number[] = [0, 2, 5, 9, 14];
export const TACTIC_LV_MAX = LEVEL_WINS.length;
/** The level of a colour after this many wins with it. */
export const tacticLevel = (wins: number): number => LEVEL_WINS.filter((w) => wins >= w).length;
/** How strongly a colour works at a level: 0.7 at level 1 to 1.1 at level 5. */
export const tacticPower = (lv: number): number => 0.6 + 0.1 * Math.min(TACTIC_LV_MAX, Math.max(1, lv));

/**
 * The colour the manager suggests for a group of heroes: the one their abilities suit best (fast heroes: speed;
 * tacklers: iron; blockers: ground; throwers and catchers: air).
 */
export function suggestTactic(heroes: readonly { stats: Stats }[]): Exclude<Tactic, 'royal'> {
  const n = Math.max(1, heroes.length);
  const mean = (f: (s: Stats) => number): number => heroes.reduce((a, x) => a + f(x.stats), 0) / n;
  const best = (f: (s: Stats) => number): number => Math.max(0, ...heroes.map((x) => f(x.stats)));
  const score: Record<Exclude<Tactic, 'royal'>, number> = {
    speed: mean((s) => s.spd),
    iron: mean((s) => s.tkl),
    ground: mean((s) => s.blk),
    // one good thrower is enough, the catchers count as a group
    air: (best((s) => s.pas) + mean((s) => s.cat)) / 2,
  };
  return (Object.keys(score) as Exclude<Tactic, 'royal'>[]).reduce((a, b) => (score[b] > score[a] ? b : a));
}
