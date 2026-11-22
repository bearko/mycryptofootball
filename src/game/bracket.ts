// A tournament's bracket: eight teams, three rounds (the club and seven schools of its tournament).
//
// The club always stands in the first place of the draw. Its own games are played on the field; the other games of a
// round are decided when the club's game of that round is over (the stronger school wins more often), so the club's
// next opponent is whoever really came through. Once the club is out (or the final is played) the rest is decided at
// once. How strong a school is in a match still follows the round (teams.ts ROUNDS): the draw decides who, not how
// strong. Nothing here uses the match's dice.

import type { Rng } from '../core/rng';
import { CUPS, tierOf } from './prestige';

/** the club in a bracket's field */
export const CLUB = -1;

export interface Bracket {
  /** the eight places, top to bottom: CLUB, or a school (an index into SCHOOLS) */
  field: number[];
  /**
   * the winner of each of the seven games: 0–3 the first round (places 0–1, 2–3, 4–5, 6–7), 4–5 the semi-finals,
   * 6 the final. null: not played yet
   */
  won: (number | null)[];
  /** each game's score, the winner's first */
  score: ([number, number] | null)[];
  /** the coach has seen the draw announced */
  shown?: boolean;
  /** the games the coach has seen decided on the bracket */
  seen?: number[];
}

/** The schools of each tournament's bracket (district, prefecture, region, nation), the weakest first. */
export const BRACKET_SCHOOLS: readonly (readonly number[])[] = [
  [0, 1, 4, 2, 5, 3, 6],
  [2, 5, 3, 6, 7, 8, 9],
  [3, 6, 7, 8, 9, 10, 11],
  [6, 7, 8, 9, 10, 11, 12],
];
const cupAt = (league: number): number => Math.max(0, CUPS.indexOf(tierOf(league).cup));
/** How strong a school is in its tournament: its place among the bracket's schools (0: the weakest). */
export const ratingOf = (league: number, school: number): number => BRACKET_SCHOOLS[cupAt(league)]!.indexOf(school);

/** the games of each round (1–3) */
export const ROUND_GAMES: readonly (readonly number[])[] = [[], [0, 1, 2, 3], [4, 5], [6]];
/** the game of each round the club plays in (it stands first in the draw) */
export const CLUB_GAME = [-1, 0, 4, 6];

/**
 * Draws the bracket of a tournament of this standing. The club meets one of the two weakest first; the two
 * strongest are kept apart, on the other half, so they can only meet in the final.
 */
export function makeBracket(league: number, rng: Rng): Bracket {
  const pool = [...BRACKET_SCHOOLS[cupAt(league)]!];
  const first = pool.splice(rng.int(0, 1), 1)[0]!;
  // pool is still weakest first: two for the club's quarter, the top four on the other half
  const near = rng.shuffle(pool.slice(0, 2));
  const top = pool.slice(2);
  const [a, b] = rng.shuffle([top[3]!, top[2]!]);
  const [c, d] = rng.shuffle([top[1]!, top[0]!]);
  return {
    field: [CLUB, first, near[0]!, near[1]!, a!, c!, b!, d!],
    won: Array(7).fill(null),
    score: Array(7).fill(null),
  };
}

/** The two teams of a game (null where they are not known yet). */
export function pairOf(b: Bracket, g: number): [number | null, number | null] {
  if (g < 4) return [b.field[2 * g]!, b.field[2 * g + 1]!];
  if (g < 6) return [b.won[(g - 4) * 2]!, b.won[(g - 4) * 2 + 1]!];
  return [b.won[4]!, b.won[5]!];
}

/** The club's opponent in a round (1–3), once known; null after the club is out or before it is decided. */
export function clubOpponent(b: Bracket, round: number): number | null {
  const g = CLUB_GAME[round]!;
  const [x, y] = pairOf(b, g);
  if (x !== CLUB && y !== CLUB) return null;
  const other = x === CLUB ? y : x;
  return other ?? null;
}

/** A plausible score for a game between schools (the winner's first): touchdowns, a field goal, a try now and then. */
function scoreOf(rng: Rng, close: boolean): [number, number] {
  const pts = (): number => rng.pick([0, 3, 6, 7, 7, 8]) + rng.pick([0, 3, 7, 7, 14, 14, 21]);
  let w = pts();
  let l = pts();
  if (w === l) w += rng.pick([3, 7]);
  if (w < l) [w, l] = [l, w];
  if (!close && w - l < 10) w += 7;
  return [w, l];
}

/** Plays out one game between two schools: the stronger wins more often. */
function playGame(b: Bracket, g: number, league: number, rng: Rng): void {
  const [x, y] = pairOf(b, g);
  if (x == null || y == null || b.won[g] != null) return;
  const edge = (ratingOf(league, x) - ratingOf(league, y)) * 0.1;
  const p = Math.min(0.85, Math.max(0.15, 0.5 + edge));
  const win = rng.chance(p) ? x : y;
  b.won[g] = win;
  b.score[g] = scoreOf(rng, Math.abs(edge) < 0.15);
}

/**
 * Books the club's game of a round, and plays the other games of that round. When the club is out, or has played
 * the final, the rest of the bracket is played to its end.
 */
export function bookRound(b: Bracket, round: number, win: boolean, score: [number, number], league: number, rng: Rng): void {
  const g = CLUB_GAME[round]!;
  const [x, y] = pairOf(b, g);
  const other = (x === CLUB ? y : x)!;
  b.won[g] = win ? CLUB : other;
  b.score[g] = win ? score : [score[1], score[0]];
  for (const h of ROUND_GAMES[round]!) playGame(b, h, league, rng);
  if (!win || round === 3) finishBracket(b, league, rng);
}

/** Plays every game not yet played (the club has gone out). */
export function finishBracket(b: Bracket, league: number, rng: Rng): void {
  for (let g = 0; g < 7; g += 1) playGame(b, g, league, rng);
}

/** The games decided that the coach has not seen on the bracket yet. */
export const freshGames = (b: Bracket): number[] =>
  b.won.map((w, g) => (w != null && !(b.seen ?? []).includes(g) ? g : -1)).filter((g) => g >= 0);
/** The coach has now seen these games decided. */
export function markSeen(b: Bracket, games: readonly number[]): void {
  b.seen = [...new Set([...(b.seen ?? []), ...games])];
}

/** How far the club went: the round it lost in (1–3), 4 for winning it all, 0 while it is still in. */
export function clubReach(b: Bracket): number {
  for (const r of [1, 2, 3]) {
    const w = b.won[CLUB_GAME[r]!];
    if (w == null) return 0;
    if (w !== CLUB) return r;
  }
  return 4;
}
