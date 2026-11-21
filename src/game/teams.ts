// The schools the club meets. Their line-ups never change; their ability rises with each round,
// and from the first tournament game on, each has its own heroes with special plays.

import { KIND, type Kind } from './cards';
import { hero, specialOf } from './heroes';
import type { TeamSheet } from './match';
import { ROLE_WEIGHTS, STATS, roleOf, type DefPos, type Lineup, type OffPos, type Stats } from './model';

interface OppPlayer {
  id: number;
  off: OffPos;
  def: DefPos;
  ace?: Kind;
}

export interface OppTeam {
  name: string;
  short: string;
  color: string;
  /** one line for the scouting report */
  style: string;
  /** ability every player has in everything */
  base: number;
  /** extra ability in what each player's positions need */
  spread: number;
  runBias: number;
  smart: number;
  players: OppPlayer[];
}

export const OPPONENTS: readonly OppTeam[] = [
  {
    name: '黄竜商業', short: '黄竜商', color: '#f08a3c', style: 'ランもパスもそこそこ。まずは腕試し',
    base: 26, spread: 20, runBias: 0.5, smart: 0.2,
    players: [
      { id: 1005, off: 'RB', def: 'LB', ace: 'pushRun' },
      { id: 2029, off: 'QB', def: 'S' },
      { id: 2006, off: 'WR1', def: 'CB1' },
      { id: 2003, off: 'WR2', def: 'CB2' },
      { id: 2021, off: 'OL1', def: 'DL1' },
      { id: 2042, off: 'OL2', def: 'DL2' },
    ],
  },
  {
    name: '白虎工業', short: '白虎工', color: '#e6edf7', style: 'とにかく走ってくる。壁も厚い',
    base: 31, spread: 22, runBias: 0.68, smart: 0.4,
    players: [
      { id: 1003, off: 'RB', def: 'LB', ace: 'powerRun' },
      { id: 2013, off: 'OL1', def: 'DL1', ace: 'wall' },
      { id: 4049, off: 'OL2', def: 'DL2' },
      { id: 3009, off: 'QB', def: 'S' },
      { id: 2043, off: 'WR1', def: 'CB1' },
      { id: 2045, off: 'WR2', def: 'CB2' },
    ],
  },
  {
    name: '玄武学院', short: '玄武学', color: '#b08cff', style: 'ロングパスで一気に攻めてくる',
    base: 36, spread: 24, runBias: 0.36, smart: 0.6,
    players: [
      { id: 3019, off: 'QB', def: 'S', ace: 'sureLong' },
      { id: 4023, off: 'WR1', def: 'CB1', ace: 'flyLong' },
      { id: 4037, off: 'OL1', def: 'DL1', ace: 'roar' },
      { id: 3048, off: 'RB', def: 'LB' },
      { id: 3011, off: 'OL2', def: 'DL2' },
      { id: 5009, off: 'WR2', def: 'CB2' },
    ],
  },
  {
    name: '青龍大付属', short: '青龍大', color: '#58b0ff', style: '攻めも守りも一芸ぞろいの王者',
    base: 41, spread: 25, runBias: 0.5, smart: 0.8,
    players: [
      { id: 5001, off: 'QB', def: 'S', ace: 'sureLong' },
      { id: 4012, off: 'RB', def: 'CB2', ace: 'powerRun' },
      { id: 4009, off: 'WR1', def: 'CB1', ace: 'steal' },
      { id: 4025, off: 'OL1', def: 'LB', ace: 'roar' },
      { id: 4027, off: 'WR2', def: 'DL1', ace: 'rush' },
      { id: 4035, off: 'OL2', def: 'DL2' },
    ],
  },
];

function oppStats(team: OppTeam, p: OppPlayer): Stats {
  const st = {} as Stats;
  for (const k of STATS) {
    const need = (ROLE_WEIGHTS[roleOf(p.off)][k] ?? 0) + (ROLE_WEIGHTS[roleOf(p.def)][k] ?? 0);
    st[k] = Math.round(Math.min(99, team.base + team.spread * need + (p.ace && need > 0 ? 8 : 0)));
  }
  return st;
}

export function opponentSheet(index: number): TeamSheet {
  const team = OPPONENTS[index]!;
  const lineup: Lineup = { off: {} as Lineup['off'], def: {} as Lineup['def'] };
  for (const p of team.players) {
    lineup.off[p.off] = p.id;
    lineup.def[p.def] = p.id;
  }
  return {
    name: team.name,
    short: team.short,
    color: team.color,
    players: team.players.map((p) => ({ id: p.id, name: hero(p.id).name, stats: oppStats(team, p) })),
    lineup,
    specials: team.players.filter((p) => p.ace).map((p) => specialOf(p.id, p.ace!)),
    runBias: team.runBias,
    smart: team.smart,
  };
}

/** The aces of a school, for the scouting report. */
export function aces(index: number): { id: number; name: string; play: string; tag: string }[] {
  return OPPONENTS[index]!.players
    .filter((p) => p.ace)
    .map((p) => ({ id: p.id, name: hero(p.id).name, play: hero(p.id).passive, tag: KIND[p.ace!].tag }));
}
