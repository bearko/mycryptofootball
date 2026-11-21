// Shared vocabulary: stats, positions, and how well a hero fits a position.

export type Stat = 'spd' | 'pas' | 'cat' | 'blk' | 'tkl' | 'iq';
export const STATS: readonly Stat[] = ['spd', 'pas', 'cat', 'blk', 'tkl', 'iq'];
export const STAT_LABEL: Record<Stat, string> = {
  spd: '走力',
  pas: 'パス',
  cat: '捕球',
  blk: 'ブロック',
  tkl: 'タックル',
  iq: '判断',
};

export type Stats = Record<Stat, number>;

/**
 * A match is played six a side (a small club's district games) or eleven a side.
 * The eleven-a-side positions are the six-a-side ones and five more, so everything written for six still finds its heroes.
 */
export type Size = 6 | 11;
export type OffPos = 'QB' | 'RB' | 'WR1' | 'WR2' | 'WR3' | 'TE' | 'OL1' | 'OL2' | 'OL3' | 'OL4' | 'OL5';
export type DefPos = 'DL1' | 'DL2' | 'DL3' | 'DL4' | 'LB' | 'LB2' | 'LB3' | 'CB1' | 'CB2' | 'S' | 'S2';
export const OFF_POS_OF: Record<Size, readonly OffPos[]> = {
  6: ['QB', 'RB', 'WR1', 'WR2', 'OL1', 'OL2'],
  11: ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'OL1', 'OL2', 'OL3', 'OL4', 'OL5'],
};
export const DEF_POS_OF: Record<Size, readonly DefPos[]> = {
  6: ['DL1', 'DL2', 'LB', 'CB1', 'CB2', 'S'],
  11: ['DL1', 'DL2', 'DL3', 'DL4', 'LB', 'LB2', 'LB3', 'CB1', 'CB2', 'S', 'S2'],
};

/** The kind of a position (the receivers share a kind, and so on). */
export type Role = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S';
export const roleOf = (p: OffPos | DefPos): Role => p.replace(/\d$/, '') as Role;

/** Positions are called what a football club calls them. */
export const ROLE_LABEL: Record<Role, string> = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', OL: 'OL', DL: 'DL', LB: 'LB', CB: 'CB', S: 'S' };
/** ...and spelled out where there is room. */
export const ROLE_FULL: Record<Role, string> = {
  QB: 'クォーターバック',
  RB: 'ランニングバック',
  WR: 'ワイドレシーバー',
  TE: 'タイトエンド',
  OL: 'オフェンスライン',
  DL: 'ディフェンスライン',
  LB: 'ラインバッカー',
  CB: 'コーナーバック',
  S: 'セーフティ',
};
/** One line for people who have never watched the sport. */
export const ROLE_HINT: Record<Role, string> = {
  QB: '攻撃の司令塔。ボールを投げる。パスと判断が大事',
  RB: 'ボールを持って走る。走力が命',
  WR: 'パスを捕る。捕球と走力',
  TE: '壁にもなり、パスも捕る。ブロックと捕球',
  OL: 'QBとRBを守る壁。ブロック',
  DL: '相手の壁を割ってQBに迫る。タックルとブロック',
  LB: '守備の中心。走ってくる相手を止める。タックルと走力',
  CB: 'WRに張りつく。走力と捕球',
  S: '最後の砦。判断と捕球',
};

/** Which stats a position uses, as weights that sum to 1. */
export const ROLE_WEIGHTS: Record<Role, Partial<Stats>> = {
  QB: { pas: 0.7, iq: 0.3 },
  RB: { spd: 0.8, iq: 0.2 },
  WR: { cat: 0.6, spd: 0.4 },
  TE: { blk: 0.5, cat: 0.5 },
  OL: { blk: 0.85, tkl: 0.15 },
  DL: { tkl: 0.7, blk: 0.3 },
  LB: { tkl: 0.6, spd: 0.4 },
  CB: { spd: 0.6, cat: 0.4 },
  S: { iq: 0.6, cat: 0.4 },
};

/** How good these stats are at this position (0-100). */
export function fit(stats: Stats, role: Role): number {
  let v = 0;
  for (const [k, w] of Object.entries(ROLE_WEIGHTS[role])) v += stats[k as Stat] * (w as number);
  return v;
}

/**
 * The rank of an ability value: a letter (and, on the screen, a colour) that says roughly how good a number is.
 * One scale for everything that is measured from 0 up: the six abilities, and how well a hero fits a position.
 */
export const RANKS = [
  { name: 'G', min: 0 }, { name: 'F', min: 20 }, { name: 'E', min: 40 }, { name: 'D', min: 50 }, { name: 'C', min: 60 },
  { name: 'B', min: 70 }, { name: 'A', min: 80 }, { name: 'S', min: 90 }, { name: 'SS', min: 100 },
] as const;
export type Rank = typeof RANKS[number]['name'];
/** 0 for G … 8 for SS */
export function rankIndex(v: number): number {
  let i = 0;
  while (i < RANKS.length - 1 && v >= RANKS[i + 1]!.min) i += 1;
  return i;
}
export const rank = (v: number): Rank => RANKS[rankIndex(v)]!.name;
/** an ability can be trained up to this (SS begins at 100) */
export const STAT_MAX = 120;

/** A player as the match engine sees it. */
export interface Player {
  id: number;
  name: string;
  stats: Stats;
}

/**
 * Who plays where (six or eleven on each unit). `k` is the kicker: any hero of the club, starter or not (null or missing: nobody kicks,
 * so no field goals, no punts, and only two-point tries after a touchdown).
 */
export type Lineup = { off: Record<OffPos, number>; def: Record<DefPos, number>; k?: number | null };
/**
 * How many a side a line-up is for. (A six-a-side line-up simply has no entries for the other positions:
 * go through offPos()/defPos(), never through every OffPos.)
 */
export const sizeOf = (l: Lineup): Size => (l.off.OL3 != null ? 11 : 6);
export const offPos = (l: Lineup): readonly OffPos[] => OFF_POS_OF[sizeOf(l)];
export const defPos = (l: Lineup): readonly DefPos[] => DEF_POS_OF[sizeOf(l)];

/** What kicking takes: an accurate foot and a cool head. */
export const KICK_WEIGHTS: Partial<Stats> = { pas: 0.6, iq: 0.4 };
/** How good these stats are at kicking (0-100). */
export function kickFit(stats: Stats): number {
  let v = 0;
  for (const [k, w] of Object.entries(KICK_WEIGHTS)) v += stats[k as Stat] * (w as number);
  return v;
}
