// The club's standing ("格"): seven steps from a bunch of beginners to a school everybody knows.
// A gauge fills with wins and drains with defeats; full, the club goes up a step, empty, it goes down one.
// The standing decides how many heroes the club may have, how many practice cards are dealt each day,
// which tournament it plays in, and how strong the schools it meets are.

export interface Tier {
  name: string;
  /** how many heroes the club may have */
  roster: number;
  /** practice cards dealt each day (the rest card comes on top) */
  hand: number;
  /** the tournament a club of this standing plays in */
  cup: string;
  /** what the schools it meets have on top of their basic ability */
  level: number;
  /** what a hero who joins a club of this standing has on top of a beginner's abilities */
  join: number;
  /** how many a side its tournament is played: six in the district, eleven from the prefecture up */
  size: 6 | 11;
}

export const TIERS: readonly Tier[] = [
  { name: '素人', roster: 7, hand: 5, cup: '地区大会', level: 0, join: 0, size: 6 },
  { name: '同好会', roster: 9, hand: 5, cup: '地区大会', level: 7, join: 4, size: 6 },
  { name: '弱小', roster: 11, hand: 6, cup: '県大会', level: 9, join: 9, size: 11 },
  { name: '注目株', roster: 16, hand: 6, cup: '県大会', level: 15, join: 13, size: 11 },
  { name: '中堅', roster: 22, hand: 6, cup: '地方大会', level: 21, join: 17, size: 11 },
  { name: '強豪', roster: 22, hand: 7, cup: '全国大会', level: 28, join: 21, size: 11 },
  { name: '名門', roster: 24, hand: 7, cup: '全国大会', level: 32, join: 25, size: 11 },
];
/** the tournaments, the smallest first */
export const CUPS: readonly string[] = ['地区大会', '県大会', '地方大会', '全国大会'];
export const TOP_TIER = TIERS.length - 1;
export const FAME_MAX = 100;
/** the gauge after going up a step / after going down one */
export const FAME_AFTER_UP = 30;
export const FAME_AFTER_DOWN = 60;
/** what a win and a defeat are worth in each of the year's four matches: the practice match, then the three rounds */
export const FAME_WIN: readonly number[] = [15, 30, 40, 50];
export const FAME_LOSS: readonly number[] = [-10, -25, -15, -10];

export const tierOf = (n: number): Tier => TIERS[Math.max(0, Math.min(TOP_TIER, n))]!;

export interface Standing {
  tier: number;
  /** 0..FAME_MAX */
  fame: number;
}

export interface FameChange {
  before: Standing;
  after: Standing;
  /** gauge points this match was worth */
  delta: number;
  /** +1: the club went up a step, -1: down one */
  moved: number;
}

/**
 * Books one match. `match`: 0 for the practice match, 1–3 for the rounds of the tournament.
 * Beginners who win their first round (and so reach the semi-final) become a club at once, whatever the gauge says.
 */
export function applyResult(now: Standing, match: number, win: boolean): FameChange {
  const delta = (win ? FAME_WIN : FAME_LOSS)[Math.max(0, Math.min(3, match))]!;
  let { tier, fame } = now;
  fame += delta;
  if (now.tier === 0 && match === 1 && win) fame = Math.max(fame, FAME_MAX);
  if (fame >= FAME_MAX) {
    if (tier < TOP_TIER) {
      tier += 1;
      fame = FAME_AFTER_UP;
    } else fame = FAME_MAX;
  } else if (fame < 0) {
    if (tier > 0) {
      tier -= 1;
      fame = FAME_AFTER_DOWN;
    } else fame = 0;
  }
  return { before: { ...now }, after: { tier, fame }, delta, moved: tier - now.tier };
}
