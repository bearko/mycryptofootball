// What the club has done over the years: the achievements of bearko.games, the numbers of its total score and the
// splits of the RTA (docs/PLATFORM.md). Everything is read from the saved season, so nothing is lost when the shared
// platform is away: whatever has been reached is sent again the next time (the platform keeps the first).
import { SCHEDULE, type DayPlan, type Season } from './season';
import { TOP_TIER } from './prestige';

/** The tournaments by level: the district's (地区大会) first, the nation's (全国大会) last (prestige.ts Tier.cup). */
export const CUP_LEVELS = ['地区大会', '県大会', '地方大会', '全国大会'] as const;

/** The club's record over all its years (Season.career; kept by finishMatch). */
export interface Career {
  /** matches won */
  wins: number;
  /** tournaments won, by level (CUP_LEVELS) */
  titles: number[];
  /** the highest standing reached (an index into TIERS) */
  best: number;
  /** an eleven-a-side match won */
  eleven?: boolean;
  /** summits won against the corporate champion */
  summits?: number;
  /** things that happen inside a match: a touchdown off a special play, an onside kick won back */
  feats?: Feat[];
}
export type Feat = 'special_td' | 'onside';

/** The club's record, started from what a season saved before it was kept shows. */
export function careerOf(s: Season): Career {
  return (s.career ??= { wins: s.results.filter((r) => r.win).length, titles: [0, 0, 0, 0], best: s.tier });
}

/** Notes a thing done in a match (once). */
export function noteFeat(s: Season, f: Feat): void {
  const c = careerOf(s);
  if (!(c.feats ??= []).includes(f)) c.feats.push(f);
}

/**
 * The achievements (their ids on the platform, without the title's prefix), in the order a club reaches them.
 * The proposal for the platform is in docs/PLATFORM.md.
 */
export const ACHIEVEMENTS = ['first_win', 'club', 'special_td', 'onside', 'district', 'eleven', 'graduate', 'meimon', 'nation', 'summit'] as const;
export type Achievement = (typeof ACHIEVEMENTS)[number];

/** The achievements this club has reached. */
export function achieved(s: Season): Achievement[] {
  const c = careerOf(s);
  const has: Record<Achievement, boolean> = {
    first_win: c.wins > 0,
    club: c.best >= 1,
    special_td: !!c.feats?.includes('special_td'),
    onside: !!c.feats?.includes('onside'),
    district: (c.titles[0] ?? 0) > 0,
    eleven: !!c.eleven,
    graduate: Object.keys(s.alumni ?? {}).length > 0,
    meimon: c.best >= TOP_TIER,
    nation: (c.titles[3] ?? 0) > 0,
    summit: (c.summits ?? 0) > 0,
  };
  return ACHIEVEMENTS.filter((a) => has[a]);
}

/** The numbers of the total score (a `progress` title: what the club stands at now). */
export function scoreOf(s: Season): { tier: number; years: number; wins: number; titles: number[]; nation: boolean; summit: boolean } {
  const c = careerOf(s);
  return { tier: c.best, years: s.year, wins: c.wins, titles: CUP_LEVELS.map((_, i) => c.titles[i] ?? 0), nation: (c.titles[3] ?? 0) > 0, summit: (c.summits ?? 0) > 0 };
}

// ------------------------------------------------------------------ the RTA

/** The regulation: from the founding briefing to winning the district tournament. */
export const RTA_REGULATION = 'football-district';
/** Its splits, in the order they are reached. */
export const RTA_SPLITS = ['first_win', 'club', 'district'] as const;
export type RtaSplit = (typeof RTA_SPLITS)[number];

/** The splits this club has reached. */
export function splitsReached(s: Season): RtaSplit[] {
  const got = new Set<string>(achieved(s));
  return RTA_SPLITS.filter((x) => got.has(x));
}

const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Days from April 5 to a day of the calendar. */
const offsetOf = (d: DayPlan): number => {
  let n = d.date - 5;
  for (let m = 4; m < d.month; m += 1) n += MONTH_LEN[m - 1]!;
  return n;
};
/** The days the club has played through: its time in the game, counted across the years (the RTA's IGT). */
export function daysPlayed(s: Season): number {
  const today = SCHEDULE[Math.min(s.day, SCHEDULE.length - 1)]!;
  return (s.year - 1) * 365 + offsetOf(today) + 1;
}
