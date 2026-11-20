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

export type OffPos = 'QB' | 'RB' | 'WR1' | 'WR2' | 'OL1' | 'OL2';
export type DefPos = 'DL1' | 'DL2' | 'LB' | 'CB1' | 'CB2' | 'S';
export const OFF_POS: readonly OffPos[] = ['QB', 'RB', 'WR1', 'WR2', 'OL1', 'OL2'];
export const DEF_POS: readonly DefPos[] = ['DL1', 'DL2', 'LB', 'CB1', 'CB2', 'S'];

/** The kind of a position (the two receivers share a kind, and so on). */
export type Role = 'QB' | 'RB' | 'WR' | 'OL' | 'DL' | 'LB' | 'CB' | 'S';
export const roleOf = (p: OffPos | DefPos): Role => p.replace(/\d$/, '') as Role;

export const ROLE_LABEL: Record<Role, string> = {
  QB: '司令塔',
  RB: 'ランナー',
  WR: 'レシーバー',
  OL: 'ライン',
  DL: '守備ライン',
  LB: 'ラインバッカー',
  CB: 'コーナー',
  S: 'セーフティ',
};
/** One line for people who have never watched the sport. */
export const ROLE_HINT: Record<Role, string> = {
  QB: 'ボールを投げる人。パスと判断が大事',
  RB: 'ボールを持って走る人。走力が命',
  WR: 'パスを捕る人。捕球と走力',
  OL: '味方を守る壁。ブロック',
  DL: '相手の壁を壊す人。タックルとブロック',
  LB: '走ってくる相手を止める人。タックルと走力',
  CB: 'レシーバーに張りつく人。走力と捕球',
  S: '最後の砦。判断と捕球',
};

/** Which stats a position uses, as weights that sum to 1. */
export const ROLE_WEIGHTS: Record<Role, Partial<Stats>> = {
  QB: { pas: 0.7, iq: 0.3 },
  RB: { spd: 0.8, iq: 0.2 },
  WR: { cat: 0.6, spd: 0.4 },
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

export function grade(v: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (v >= 75) return 'S';
  if (v >= 60) return 'A';
  if (v >= 45) return 'B';
  if (v >= 32) return 'C';
  return 'D';
}

/** A player as the match engine sees it. */
export interface Player {
  id: number;
  name: string;
  stats: Stats;
}

export type Lineup = { off: Record<OffPos, number>; def: Record<DefPos, number> };
