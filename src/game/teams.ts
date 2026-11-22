// The schools the club meets. Each has its own heroes, its own way to play, and aces with special plays.
// How strong a school is on the day depends on the round it is met in (and on the tournament: the higher the
// club's standing, the stronger everybody); which schools are met changes from year to year.

import { TACTIC_LV_MAX, tacticCards, type Tactic } from './tactics';
import type { Rng } from '../core/rng';
import { KIND, type Kind } from './cards';
import { hero, specialOf } from './heroes';
import { bestKicker } from './lineup';
import type { TeamSheet } from './match';
import { DEF_POS_OF, OFF_POS_OF, ROLE_WEIGHTS, STATS, STAT_MAX, roleOf, type DefPos, type Lineup, type OffPos, type Size, type Stats } from './model';
import { CUPS, tierOf } from './prestige';

interface OppPlayer {
  id: number;
  off: OffPos;
  def: DefPos;
  ace?: Kind;
}

export interface School {
  name: string;
  short: string;
  color: string;
  /** one line for the scouting report */
  style: string;
  /** its colour eleven a side (game/tactics.ts). The schools that play only six a side have none */
  tactic?: Tactic;
  runBias: number;
  /** how much better than other schools it reads the club's plays (added to the round's) */
  smart?: number;
  /** the six who play six a side */
  players: OppPlayer[];
  /** the five who join them when the game is eleven a side */
  more: OppPlayer[];
  /** its aces, the most dangerous first: the later the round, the more of them have their special plays ready */
  aces: number[];
}

/**
 * What the round adds to whichever school is met in it: the practice match, then the three rounds of the tournament.
 * `base`: ability every player has in everything; `spread`: extra ability in what each player's positions need;
 * `smart`: how well the school reads the club; `aces`: how many of its aces have their special plays ready.
 */
export const ROUNDS: readonly { base: number; spread: number; smart: number; aces: number }[] = [
  { base: 28, spread: 20, smart: 0.2, aces: 1 },
  { base: 32, spread: 22, smart: 0.4, aces: 2 },
  { base: 38, spread: 24, smart: 0.6, aces: 3 },
  { base: 39, spread: 25, smart: 0.8, aces: 5 },
];

/** Who stands where in a squad listed in the usual order (the first six play six a side). */
const SLOTS: readonly [OffPos, DefPos][] = [
  ['QB', 'S'], ['RB', 'LB'], ['WR1', 'CB1'], ['WR2', 'CB2'], ['OL1', 'DL1'], ['OL2', 'DL2'],
  ['OL3', 'DL3'], ['OL4', 'DL4'], ['OL5', 'LB2'], ['TE', 'LB3'], ['WR3', 'S2'],
];
/**
 * A squad from a list of heroes in the usual order: quarterback, running back, two receivers, two linemen;
 * then three more linemen, the tight end and the slot receiver. `aces`: [place in the list, special play], the most dangerous first.
 */
function squad(ids: number[], aces: [number, Kind][]): Pick<School, 'players' | 'more' | 'aces'> {
  const all: OppPlayer[] = ids.map((id, i) => ({ id, off: SLOTS[i]![0], def: SLOTS[i]![1] }));
  for (const [i, kind] of aces) all[i]!.ace = kind;
  return { players: all.slice(0, 6), more: all.slice(6), aces: aces.map(([i]) => ids[i]!) };
}

/** The first four are the schools of a club's very first year, in the order it meets them. */
export const SCHOOLS: readonly School[] = [
  {
    name: '黄竜商業', short: '黄竜商', color: '#f08a3c', style: 'ランもパスもそこそこ。まずは腕試し',
    runBias: 0.5,
    players: [
      { id: 1005, off: 'RB', def: 'LB', ace: 'pushRun' },
      { id: 2029, off: 'QB', def: 'S', ace: 'sureShort' },
      { id: 2006, off: 'WR1', def: 'CB1', ace: 'steal' },
      { id: 2003, off: 'WR2', def: 'CB2' },
      { id: 2021, off: 'OL1', def: 'DL1', ace: 'rush' },
      { id: 2042, off: 'OL2', def: 'DL2', ace: 'wall' },
    ],
    aces: [1005, 2021, 2029, 2006, 2042],
    more: [
      { id: 2009, off: 'OL3', def: 'DL3' },
      { id: 2012, off: 'OL4', def: 'DL4' },
      { id: 2020, off: 'OL5', def: 'LB2' },
      { id: 2037, off: 'TE', def: 'LB3' },
      { id: 2038, off: 'WR3', def: 'S2' },
    ],
  },
  {
    name: '白虎工業', short: '白虎工', color: '#e6edf7', style: 'とにかく走ってくる。壁も厚い',
    runBias: 0.68,
    players: [
      { id: 1003, off: 'RB', def: 'LB', ace: 'powerRun' },
      { id: 2013, off: 'OL1', def: 'DL1', ace: 'wall' },
      { id: 4049, off: 'OL2', def: 'DL2', ace: 'pushRun' },
      { id: 3009, off: 'QB', def: 'S', ace: 'sureShort' },
      { id: 2043, off: 'WR1', def: 'CB1', ace: 'steal' },
      { id: 2045, off: 'WR2', def: 'CB2' },
    ],
    aces: [1003, 2013, 4049, 2043, 3009],
    more: [
      { id: 3023, off: 'OL3', def: 'DL3' },
      { id: 3025, off: 'OL4', def: 'DL4' },
      { id: 3044, off: 'OL5', def: 'LB2' },
      { id: 3045, off: 'TE', def: 'LB3' },
      { id: 3049, off: 'WR3', def: 'S2' },
    ],
  },
  {
    name: '玄武学院', tactic: 'speed', short: '玄武学', color: '#b08cff', style: 'ロングパスで一気に攻めてくる',
    runBias: 0.36,
    players: [
      { id: 3019, off: 'QB', def: 'S', ace: 'sureLong' },
      { id: 4023, off: 'WR1', def: 'CB1', ace: 'flyLong' },
      { id: 4037, off: 'OL1', def: 'DL1', ace: 'roar' },
      { id: 3048, off: 'RB', def: 'LB', ace: 'trick' },
      { id: 3011, off: 'OL2', def: 'DL2' },
      { id: 5009, off: 'WR2', def: 'CB2', ace: 'steal' },
    ],
    aces: [3019, 4023, 4037, 3048, 5009],
    more: [
      { id: 4010, off: 'OL3', def: 'DL3' },
      { id: 4018, off: 'OL4', def: 'DL4' },
      { id: 4024, off: 'OL5', def: 'LB2' },
      { id: 4040, off: 'TE', def: 'LB3' },
      { id: 4048, off: 'WR3', def: 'S2' },
    ],
  },
  {
    name: '青龍大付属', tactic: 'royal', short: '青龍大', color: '#58b0ff', style: '攻めも守りも一芸ぞろいの王者',
    runBias: 0.5,
    players: [
      { id: 5001, off: 'QB', def: 'S', ace: 'sureLong' },
      { id: 4012, off: 'RB', def: 'CB2', ace: 'powerRun' },
      { id: 4009, off: 'WR1', def: 'CB1', ace: 'steal' },
      { id: 4025, off: 'OL1', def: 'LB', ace: 'roar' },
      { id: 4027, off: 'WR2', def: 'DL1', ace: 'rush' },
      { id: 4035, off: 'OL2', def: 'DL2' },
    ],
    aces: [5001, 4012, 4009, 4025, 4027],
    more: [
      { id: 5003, off: 'OL3', def: 'DL3' },
      { id: 5006, off: 'OL4', def: 'DL4' },
      { id: 5017, off: 'OL5', def: 'LB2' },
      { id: 5025, off: 'TE', def: 'LB3' },
      { id: 5026, off: 'WR3', def: 'S2' },
    ],
  },
  // ---- the schools met from the second year on
  {
    name: '彩雲芸術', short: '彩雲芸', color: '#ff8fd0', style: 'パスをつなぐ技巧派。走ってくることは少ない', runBias: 0.3,
    ...squad([2023, 2005, 2049, 2004, 2048, 2022], [[0, 'sureShort'], [2, 'flyLong'], [3, 'steal'], [1, 'trick'], [4, 'wall']]),
  },
  {
    name: '天馬学舎', tactic: 'air', short: '天馬学', color: '#7fe0c0', style: '読みのするどい頭脳派。同じ手は二度通じない', runBias: 0.45, smart: 0.2,
    ...squad([2034, 2041, 2047, 1006, 2044, 2015, 2008, 2033, 2010, 2039, 2036], [[2, 'steal'], [0, 'sureShort'], [4, 'wall'], [1, 'trick'], [3, 'flyLong']]),
  },
  {
    name: '荒波水産', tactic: 'iron', short: '荒波水', color: '#3fd0d8', style: '荒っぽい突撃でQBに迫り、ボールを奪いにくる', runBias: 0.55,
    ...squad([4036, 4052, 3029, 3032, 3037, 3042, 4008, 3031, 3036, 4020, 2017], [[4, 'rush'], [2, 'steal'], [1, 'powerRun'], [5, 'roar'], [0, 'sureShort']]),
  },
  {
    name: '雷鳴館', tactic: 'ground', short: '雷鳴館', color: '#ff6a3c', style: 'ランで押しきる武闘派。壁も厚い', runBias: 0.7,
    ...squad([3014, 4031, 4022, 1002, 4032, 3051, 2046, 2014, 3012, 4029, 4005], [[1, 'powerRun'], [4, 'pushRun'], [5, 'wall'], [2, 'trick'], [0, 'sureShort']]),
  },
  {
    name: '聖剣学院', tactic: 'iron', short: '聖剣学', color: '#9fd6ff', style: '守りが堅い。ロングパス一発で仕留めにくる', runBias: 0.4,
    ...squad([5023, 4045, 5007, 3002, 3034, 5029, 4038, 4057, 3050, 2002, 3039], [[4, 'wall'], [0, 'sureLong'], [2, 'flyLong'], [5, 'roar'], [1, 'rush']]),
  },
  {
    name: '銀河理科大付属', tactic: 'air', short: '銀河理', color: '#8f7bff', style: '計算されたパス攻撃。読みもするどい', runBias: 0.3, smart: 0.15,
    ...squad([5010, 3003, 3043, 5027, 4041, 4007, 4017, 4028, 4044, 5005, 3008], [[0, 'sureLong'], [2, 'flyLong'], [3, 'steal'], [4, 'wall'], [1, 'trick']]),
  },
  {
    name: '覇王学園', tactic: 'ground', short: '覇王学', color: '#e04848', style: '力でねじふせる。走っても守っても重い', runBias: 0.62,
    ...squad([4026, 5014, 5016, 5030, 5018, 3015, 3007, 3046, 4014, 2031, 4019], [[4, 'roar'], [1, 'powerRun'], [5, 'pushRun'], [0, 'sureShort'], [2, 'steal']]),
  },
  {
    name: '蒼天大付属', tactic: 'speed', short: '蒼天大', color: '#3f8cff', style: '走ってよし投げてよし。すきのない強豪', runBias: 0.5,
    ...squad([5004, 3047, 2040, 5022, 4047, 5031, 4033, 3040, 4051, 5020, 3027], [[1, 'trick'], [4, 'rush'], [0, 'sureLong'], [5, 'wall'], [2, 'flyLong']]),
  },
  {
    name: '麒麟学院', tactic: 'royal', short: '麒麟学', color: '#f0a030', style: '全国の王者。攻めも守りも一芸ぞろい', runBias: 0.48, smart: 0.1,
    ...squad([5008, 5024, 5011, 5021, 5012, 4003, 4030, 4013, 4054, 4056, 3016], [[0, 'sureLong'], [2, 'steal'], [4, 'roar'], [1, 'powerRun'], [5, 'rush']]),
  },
];

/**
 * The schools of each tournament (district, prefecture, region, nation), the weakest first.
 * A good school of one tournament is one of the lesser ones of the next.
 */
export const CUP_SCHOOLS: readonly (readonly number[])[] = [
  [0, 1, 4, 2, 5, 3],
  [2, 5, 3, 6, 7, 8],
  [3, 7, 8, 9, 10],
  [8, 9, 10, 11, 12],
];
/** which tournament a club of this standing plays in (an index into CUP_SCHOOLS) */
export const cupIndex = (league: number): number => Math.max(0, CUPS.indexOf(tierOf(league).cup));

/**
 * The year's four opponents: the practice match, then the three rounds. Four schools of the club's tournament,
 * met in order of strength (so the weakest of them is the practice match and the strongest waits in the final).
 */
export function drawSchools(league: number, rng: Rng): number[] {
  const pool = CUP_SCHOOLS[cupIndex(league)]!;
  const picked = rng.shuffle(pool.map((_, i) => i)).slice(0, 4).sort((a, b) => a - b);
  return picked.map((i) => pool[i]!);
}
/** The schools of a club's very first spring: always the same four. */
export const FIRST_DRAW: readonly number[] = [0, 1, 2, 3];

/**
 * The schools of a year's matches, in the calendar's order (season.ts SCHEDULE): the spring's four (the practice
 * match and the three rounds), the June practice match, then the autumn's four (the August practice match and the
 * three rounds; drawn again when autumn begins, from the tournament the club then plays in: autumnDraw).
 */
export function drawYear(league: number, rng: Rng, spring: readonly number[] = drawSchools(league, rng)): number[] {
  const pool = CUP_SCHOOLS[cupIndex(league)]!;
  // the June practice match: a school the club did not meet in spring, if there is one
  const rest = pool.filter((x) => !spring.includes(x));
  const june = rng.pick(rest.length ? rest : pool);
  return [...spring, june, ...drawSchools(league, rng)];
}
/** The autumn's four (the August practice match and the three rounds) from the tournament of this standing. */
export const autumnDraw = (league: number, rng: Rng): number[] => drawSchools(league, rng);

/** The aces whose special plays are ready in this round (six a side only those who play). */
function activeAces(team: School, round: number, size: Size): number[] {
  const on = size === 11 ? [...team.players, ...team.more] : team.players;
  return team.aces.filter((id) => on.some((p) => p.id === id && p.ace)).slice(0, ROUNDS[round]!.aces);
}

function oppStats(round: number, p: OppPlayer, level: number, ace: boolean): Stats {
  // (level: the tournament's, and what the time of year adds)
  const r = ROUNDS[round]!;
  const st = {} as Stats;
  for (const k of STATS) {
    const need = (ROLE_WEIGHTS[roleOf(p.off)][k] ?? 0) + (ROLE_WEIGHTS[roleOf(p.def)][k] ?? 0);
    st[k] = Math.round(Math.min(STAT_MAX, r.base + level + r.spread * need + (ace && need > 0 ? 8 : 0)));
  }
  return st;
}

/**
 * A school as the match engine sees it.
 * `round`: 0 for the practice match, 1–3 for the rounds of the tournament (it decides how strong the school is).
 * `league`: the standing of the tournament (an index into TIERS): the higher, the stronger every player.
 * `size`: how many a side (by default what that tournament plays). `school`: which school (by default the one a
 * club meets in that round in its first year).
 */
export function opponentSheet(round: number, league = 0, size: Size = tierOf(league).size, school: number = FIRST_DRAW[round]!, lift = 0): TeamSheet {
  const team = SCHOOLS[school]!;
  const all = size === 11 ? [...team.players, ...team.more] : team.players;
  const aces = activeAces(team, round, size);
  const lineup: Lineup = { off: {} as Lineup['off'], def: {} as Lineup['def'] };
  for (const p of all) {
    lineup.off[p.off] = p.id;
    lineup.def[p.def] = p.id;
  }
  const players = all.map((p) => ({ id: p.id, name: hero(p.id).name, stats: oppStats(round, p, tierOf(league).level + lift, aces.includes(p.id)) }));
  // every school has somebody who can kick: its best foot
  lineup.k = bestKicker(players, lineup);
  const sheet: TeamSheet = {
    name: team.name,
    short: team.short,
    color: team.color,
    players,
    lineup,
    specials: all.filter((p) => aces.includes(p.id)).map((p) => specialOf(p.id, p.ace!)),
    runBias: team.runBias,
    smart: Math.min(0.95, ROUNDS[round]!.smart + (team.smart ?? 0)),
    ...(size === 11 && team.tactic ? { tactic: team.tactic, tacticLv: schoolTacticLv(league, round) } : {}),
  };
  // eleven a side, the colour's own plays
  if (sheet.tactic) sheet.specials.push(...tacticCards(sheet, sheet.tactic, sheet.tacticLv ?? 1));
  return sheet;
}

/** How far a school has come with its colour: the higher the league and the later the round, the further. */
export const schoolTacticLv = (league: number, round: number): number => Math.min(TACTIC_LV_MAX, Math.max(1, league - 1 + (round >= 3 ? 1 : 0)));

/** The aces of a school in a round, for the scouting report. */
export function aces(school: number, round: number, size: Size = 6): { id: number; name: string; play: string; tag: string }[] {
  const team = SCHOOLS[school]!;
  const on = activeAces(team, round, size);
  return [...team.players, ...team.more]
    .filter((p) => on.includes(p.id))
    .map((p) => ({ id: p.id, name: hero(p.id).name, play: hero(p.id).passive, tag: KIND[p.ace!].tag }));
}

/** Every position of a squad is filled (a check for the data above). */
export const complete = (team: School): boolean =>
  OFF_POS_OF[6].every((pos) => team.players.some((p) => p.off === pos)) && DEF_POS_OF[6].every((pos) => team.players.some((p) => p.def === pos))
  && OFF_POS_OF[11].every((pos) => [...team.players, ...team.more].some((p) => p.off === pos))
  && DEF_POS_OF[11].every((pos) => [...team.players, ...team.more].some((p) => p.def === pos));
