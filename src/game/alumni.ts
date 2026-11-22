// What the graduates leave behind: OB points (OBポイント), and what they buy at the alumni's shop (OB会).
//
// - Every hero who graduates leaves points: the more he grew, the more he trusted the coach, the more he leaves
//   (a captain a little more). They are kept from year to year.
// - The shop sells lunch boxes (the Extensions of the lunch-box series, お弁当): one gives everybody back stamina,
//   right away, any day; and medals for the medal game.
// - The medal game (MCHスロット): three reels of MCH medals. A spin costs one or three medals; two alike on the left
//   pay a little, three alike pay well (the rarer the medal, the more). Medals can be changed into the club's money.
//   On average a spin gives back a little less than it costs: it is a game, not a bank.
// Nothing here uses the match's dice; the season's generator rolls the reels (season.ts).

import type { Rng } from '../core/rng';
import { STATS, type Stats } from './model';

export type BentoKey = 'onigiri' | 'sand' | 'jubako' | 'gojubako';
export const BENTO_KEYS: readonly BentoKey[] = ['onigiri', 'sand', 'jubako', 'gojubako'];
export interface Bento {
  /** stamina everybody gets back */
  sta: number;
  /** and trust (only the grandest) */
  trust: number;
  /** what it costs, in OB points */
  price: number;
  /** its picture: an index into the catalog's lunch boxes */
  art: number;
}
export const BENTO: Record<BentoKey, Bento> = {
  onigiri: { sta: 15, trust: 0, price: 10, art: 0 },
  sand: { sta: 30, trust: 0, price: 20, art: 1 },
  jubako: { sta: 50, trust: 0, price: 35, art: 2 },
  gojubako: { sta: 100, trust: 2, price: 60, art: 3 },
};

/** a bag of medals at the shop: how many, for how many OB points */
export const MEDAL_PACK = { medals: 100, price: 10 } as const;
/** medals changed into money: this many medals for this many 万円 */
export const MEDAL_RATE = { medals: 100, money: 5 } as const;
/** the bets a spin may take */
export const BETS = [1, 3] as const;

/**
 * The points a graduate leaves: a few for having been there, more for how good he became and how much he trusted
 * the coach, a captain a few more.
 */
export function obOf(m: { stats: Stats; trust: number; captain: boolean }): number {
  const avg = STATS.reduce((v, k) => v + m.stats[k], 0) / STATS.length;
  return 4 + Math.floor(avg / 15) + Math.floor(m.trust / 25) + (m.captain ? 5 : 0);
}

// ---- the medal game

/** how often each medal turns up on a reel: the plain medal the most, the rarest the least */
export const REEL_WEIGHTS = [6, 5, 4, 3, 2] as const;
/** three alike pay this many times the bet, by medal */
export const TRIPLE = [3, 6, 15, 40, 150] as const;
/** two alike on the left (the third not) pay this many times the bet */
export const PAIR = 2;

export interface Spin {
  /** the medal on each reel (an index into the catalog's medals) */
  reels: [number, number, number];
  /** medals paid back (0: nothing) */
  pay: number;
  /** what came up: three alike, two alike, or nothing */
  hit: 'triple' | 'pair' | null;
}

/** One spin of the reels for this bet. */
export function spin(rng: Rng, bet: number): Spin {
  const one = (): number => rng.weighted([0, 1, 2, 3, 4], (i) => REEL_WEIGHTS[i]!);
  const reels: [number, number, number] = [one(), one(), one()];
  const [a, b, c] = reels;
  if (a === b && b === c) return { reels, pay: TRIPLE[a]! * bet, hit: 'triple' };
  if (a === b) return { reels, pay: PAIR * bet, hit: 'pair' };
  return { reels, pay: 0, hit: null };
}

/** What a spin gives back on average, for each medal bet (a little under 1). */
export function slotReturn(): number {
  const total = REEL_WEIGHTS.reduce((a, b) => a + b, 0);
  let v = 0;
  REEL_WEIGHTS.forEach((w, k) => {
    const p = w / total;
    v += p ** 3 * TRIPLE[k]! + p ** 2 * (1 - p) * PAIR;
  });
  return v;
}
