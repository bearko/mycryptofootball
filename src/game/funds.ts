// Running the club: its money (部費), its training facilities, and practice matches away from home.
//
// - Every drill has its facility, and the day off has the club room. Each goes from level 1 to 5; a drill's card
//   shows its facility's level as stars and does that much more (LV_MUL), the club room gives back more stamina
//   (REST_LV). The pictures are My Crypto Heroes Extensions of the same series, Common at level 1 to Legendary at 5.
// - Money comes in at the start of each part of the year (more for a club of a higher standing: ALLOWANCE), and
//   from the supporters for every win (more for the later rounds and the bigger tournaments: DONATION).
// - The summer camp may be held away from the school (CAMP_SITE): the further it goes, the more it costs and the more
//   it does (experience) — and the cooler the place, the less it wears the heroes out. The school is free.
// - A practice match in the summer or the autumn may be played away, against a school of the tournament above:
//   it costs money (TRIP_COST), and the trip teaches everybody something whatever the score (TRIP_XP).
// Nothing here uses the match's dice. Money is counted in units of 10,000 yen (万円).

import type { PracticeKey, Xp } from './season';

export type FacKey = PracticeKey | 'rest';
export const FAC_KEYS: readonly FacKey[] = ['dash', 'pass', 'catch', 'hit', 'tackle', 'study', 'game', 'rest'];

export interface FacilityInfo {
  name: string;
  /** what it is good for, in a few words */
  what: string;
}
export const FACILITY: Record<FacKey, FacilityInfo> = {
  dash: { name: '陸上トラック', what: '走りこみ' },
  pass: { name: 'パス練習場', what: 'パス練習' },
  catch: { name: 'キャッチ練習場', what: 'キャッチ練習' },
  hit: { name: '当たり稽古場', what: '当たり稽古' },
  tackle: { name: 'タックル練習場', what: 'タックル練習' },
  study: { name: '作戦室', what: '作戦会議' },
  game: { name: 'グラウンド', what: 'ミニゲーム' },
  rest: { name: '部室', what: '休養' },
};
export const FAC_MAX = 5;
/** the Extension's rarity at each level */
export const RARITY = ['', 'コモン', 'アンコモン', 'レア', 'エピック', 'レジェンダリー'] as const;
/** how much a drill gives at each level of its facility */
export const LV_MUL = [0, 1.4, 1.6, 1.8, 2.0, 2.2] as const;
/** the stamina a day off gives back at each level of the club room */
export const REST_LV = [0, 45, 50, 56, 63, 70] as const;
/** what it costs to take a facility to this level (万円) */
export const FAC_PRICE = [0, 0, 6, 14, 28, 50] as const;

/** a new club's money */
export const START_MONEY = 5;
/** what comes in at the start of each part of the year, by the club's standing (an index into TIERS) */
export const ALLOWANCE = [5, 8, 11, 15, 20, 26, 32] as const;
/** what the supporters give for a win: a practice match, then the rounds of a tournament */
export const DONATION = [1, 3, 5, 8] as const;
/** and for winning the autumn's tournament */
export const TITLE_DONATION = 10;
/** the bigger the tournament, the bigger the gifts: a share more for each step of the standing */
export const donationOf = (round: number, league: number): number => Math.round(DONATION[Math.max(0, Math.min(3, round))]! * (1 + league * 0.25));

/** a practice match away from home: what it costs, by the club's standing */
export const tripCost = (league: number): number => 4 + league;
/** what everybody takes home from a trip (half as much again for a win) */
export const TRIP_XP: Record<Xp, number> = { pow: 8, spd: 8, tec: 8, int: 8 };
export const TRIP_WIN = 1.5;

export type Facilities = Record<FacKey, number>;
export const newFacilities = (): Facilities => Object.fromEntries(FAC_KEYS.map((k) => [k, 1])) as Facilities;
/** the price of the next level of a facility (null at the top) */
export const nextPrice = (lv: number): number | null => (lv >= FAC_MAX ? null : FAC_PRICE[lv + 1]!);

// ---- the summer camp's place

export type CampKey = 'school' | 'beach' | 'highland' | 'center';
export const CAMP_KEYS: readonly CampKey[] = ['school', 'beach', 'highland', 'center'];
export interface CampSite {
  name: string;
  /** what it is like, in a few words */
  what: string;
  /** how much better practice sticks there (an ordinary day is 1) */
  xp: number;
  /** how much more a drill wears the heroes out there */
  sta: number;
  /** what it costs a beginners' club (万円; more for a club of a higher standing: campCost) */
  price: number;
}
export const CAMP_SITE: Record<CampKey, CampSite> = {
  school: { name: '学校', what: '校舎に泊まりこむ', xp: 2, sta: 1.5, price: 0 },
  beach: { name: '海辺の民宿', what: '砂浜で足腰をきたえる', xp: 2.3, sta: 1.5, price: 3 },
  highland: { name: '高原の合宿所', what: '涼しくて疲れにくい', xp: 2.3, sta: 1.15, price: 6 },
  center: { name: 'スポーツセンター', what: '一流の設備とトレーナー', xp: 2.6, sta: 1.15, price: 10 },
};
/** What a camp at this place costs a club of this standing (万円). */
export const campCost = (k: CampKey, tier: number): number => Math.round(CAMP_SITE[k].price * (1 + tier * 0.4));
