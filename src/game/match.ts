// The match engine: no screen, no clock, only rules. Everything random goes through the match's Rng,
// so the same seed and the same picks always give the same game.
//
// The simplified sport:
//  - the field is FIELD yards long; a drive starts START yards from your own goal line
//  - four plays to gain 10 yards, or the ball goes to the other team where it is
//  - reaching the far end is a touchdown (TD_POINTS), then the other team attacks
//  - no kicks, no penalties, no clock: the game is QUARTERS x PLAYS_PER_Q plays long

import { Rng, clamp } from '../core/rng';
import {
  DEF_SPECIAL_MATCH, DEF_TYPES, KIND, MATCH, OFF_TYPES, READ_MAX, READ_POTENCY, isRun,
  type DefKind, type DefType, type OffKind, type OffType, type SpecialCard,
} from './cards';
import { fit, roleOf, type DefPos, type Lineup, type OffPos, type Player } from './model';

export const FIELD = 50;
export const START = 15;
export const QUARTERS = 4;
export const PLAYS_PER_Q = 7;
export const TD_POINTS = 7;
export const MOM_MAX = 5;
export const MOM_START = 1;

export interface TeamSheet {
  name: string;
  short: string;
  color: string;
  players: Player[];
  lineup: Lineup;
  specials: SpecialCard[];
  /** 0..1: how much the team likes to run when the computer calls its plays */
  runBias: number;
  /** 0..1: how well the computer adapts to what the other side keeps calling */
  smart: number;
  /** specials the opponent has studied before the game: key -> starting read level */
  scouted?: Record<string, number>;
}

export interface Pick {
  type: OffType | DefType;
  star: number;
  special?: SpecialCard;
  /** chosen after looking at the other side's card */
  peeked?: boolean;
}

export interface Hand {
  off: Pick[];
  def: Pick[];
}

export interface TeamTotals {
  plays: number;
  yards: number;
  td: number;
  firstDowns: number;
  turnovers: number;
  specials: Record<string, number>;
}

export interface MatchState {
  teams: [TeamSheet, TeamSheet];
  rng: Rng;
  quarter: number;
  /** plays left in this quarter */
  left: number;
  poss: 0 | 1;
  /** yards from the attacking team's own goal line */
  pos: number;
  down: number;
  toGo: number;
  score: [number, number];
  mom: [number, number];
  /** read[t][key]: how well the opponent already reads team t's special */
  read: [Record<string, number>, Record<string, number>];
  /** what each team has called on offense so far */
  calls: [OffType[], OffType[]];
  hand: Hand;
  over: boolean;
  /** tied after the last quarter: next score wins */
  sudden: boolean;
  first: 0 | 1;
  totals: [TeamTotals, TeamTotals];
  n: number;
}

export type Outcome = 'gain' | 'nogain' | 'loss' | 'incomplete' | 'sack' | 'int' | 'fumble';

export interface PlayResult {
  n: number;
  off: 0 | 1;
  offPick: Pick;
  defPick: Pick;
  before: { pos: number; down: number; toGo: number; quarter: number; left: number };
  outcome: Outcome;
  yards: number;
  td: boolean;
  firstDown: boolean;
  /** why the ball changed hands, if it did */
  turnover: null | 'downs' | 'int' | 'fumble';
  /** who read whom: the card match-up alone */
  edge: 'off' | 'def' | 'even';
  /** hero ids, for the picture and the call */
  passer: number;
  carrier: number;
  defender: number;
  /** potency of each side's special this time (0 when none) */
  offPotency: number;
  defPotency: number;
  momBefore: [number, number];
  momAfter: [number, number];
  /** what happened to the clock after this play */
  period: null | 'quarter' | 'half' | 'final' | 'sudden';
  lines: string[];
}

// ------------------------------------------------------------------ set-up

const emptyTotals = (): TeamTotals => ({ plays: 0, yards: 0, td: 0, firstDowns: 0, turnovers: 0, specials: {} });

export function createMatch(home: TeamSheet, away: TeamSheet, seed: number): MatchState {
  const rng = new Rng(seed);
  const first: 0 | 1 = rng.chance(0.5) ? 0 : 1;
  const st: MatchState = {
    teams: [home, away],
    rng,
    quarter: 1,
    left: PLAYS_PER_Q,
    poss: first,
    pos: START,
    down: 1,
    toGo: 10,
    score: [0, 0],
    mom: [MOM_START, MOM_START],
    read: [{ ...(home.scouted ?? {}) }, { ...(away.scouted ?? {}) }],
    calls: [[], []],
    hand: { off: [], def: [] },
    over: false,
    sudden: false,
    first,
    totals: [emptyTotals(), emptyTotals()],
    n: 0,
  };
  deal(st);
  return st;
}

function star(rng: Rng): number {
  const r = rng.next();
  return r < 0.5 ? 1 : r < 0.85 ? 2 : 3;
}

/** Deals this play's basic cards: three of the four plays, three of the five calls, each with a ★. */
export function deal(st: MatchState): void {
  st.hand = {
    off: st.rng.shuffle(OFF_TYPES).slice(0, 3).map((type) => ({ type, star: star(st.rng) })),
    def: st.rng.shuffle(DEF_TYPES).slice(0, 3).map((type) => ({ type, star: star(st.rng) })),
  };
  st.hand.off.sort((a, b) => OFF_TYPES.indexOf(a.type as OffType) - OFF_TYPES.indexOf(b.type as OffType));
  st.hand.def.sort((a, b) => DEF_TYPES.indexOf(a.type as DefType) - DEF_TYPES.indexOf(b.type as DefType));
}

// ------------------------------------------------------------------ ratings

const byId = (t: TeamSheet, id: number): Player => t.players.find((p) => p.id === id)!;
export const at = (t: TeamSheet, pos: OffPos | DefPos): Player =>
  byId(t, pos in t.lineup.off ? t.lineup.off[pos as OffPos] : t.lineup.def[pos as DefPos]);
const r = (t: TeamSheet, pos: OffPos | DefPos): number => fit(at(t, pos).stats, roleOf(pos));
const avg = (a: number, b: number): number => (a + b) / 2;

/** The better and the other of the two receivers for a throw of this depth. */
function receivers(t: TeamSheet, type: 'short' | 'long'): [OffPos, OffPos] {
  const val = (pos: OffPos): number => {
    const s = at(t, pos).stats;
    return type === 'long' ? 0.5 * s.spd + 0.5 * s.cat : r(t, pos);
  };
  return val('WR1') >= val('WR2') ? ['WR1', 'WR2'] : ['WR2', 'WR1'];
}

export function offRating(t: TeamSheet, type: OffType, target?: OffPos): number {
  const line = avg(r(t, 'OL1'), r(t, 'OL2'));
  if (type === 'inside') return 0.45 * r(t, 'RB') + 0.55 * line;
  if (type === 'outside') return 0.8 * r(t, 'RB') + 0.2 * line;
  const [best, other] = receivers(t, type);
  const a = target ?? best;
  const b = a === best ? other : best;
  if (type === 'short') return 0.5 * r(t, 'QB') + 0.35 * r(t, a) + 0.15 * r(t, b);
  const s = at(t, a).stats;
  return 0.45 * r(t, 'QB') + 0.4 * (0.5 * s.spd + 0.5 * s.cat) + 0.15 * line;
}

export function defRating(t: TeamSheet, type: OffType): number {
  const dl = avg(r(t, 'DL1'), r(t, 'DL2'));
  const cb = avg(r(t, 'CB1'), r(t, 'CB2'));
  if (type === 'inside') return 0.65 * dl + 0.35 * r(t, 'LB');
  if (type === 'outside') return 0.55 * r(t, 'LB') + 0.45 * cb;
  if (type === 'short') return 0.6 * cb + 0.25 * r(t, 'LB') + 0.15 * r(t, 'S');
  return 0.5 * r(t, 'S') + 0.35 * cb + 0.15 * dl;
}

/** Four numbers that sum a team up, for the line-up screen. */
export function unitSummary(t: TeamSheet): { runOff: number; passOff: number; runDef: number; passDef: number } {
  return {
    runOff: avg(offRating(t, 'inside'), offRating(t, 'outside')),
    passOff: avg(offRating(t, 'short'), offRating(t, 'long')),
    runDef: avg(defRating(t, 'inside'), defRating(t, 'outside')),
    passDef: avg(defRating(t, 'short'), defRating(t, 'long')),
  };
}

// ------------------------------------------------------------------ specials

const isPeek = (sp: SpecialCard): boolean => sp.kind === 'peekOff' || sp.kind === 'peekDef';

/** Where the owner lines up on the unit the special belongs to (null: not on the field). */
function ownerPos(t: TeamSheet, sp: SpecialCard): OffPos | DefPos | null {
  const side = KIND[sp.kind].side;
  const map: Record<string, number> = side === 'off' ? t.lineup.off : t.lineup.def;
  for (const [pos, id] of Object.entries(map)) if (id === sp.owner) return pos as OffPos | DefPos;
  return null;
}

/** Why a special cannot be called right now, or null when it can. */
export function specialBlock(st: MatchState, t: 0 | 1, sp: SpecialCard): null | 'side' | 'bench' | 'position' | 'momentum' {
  const info = KIND[sp.kind];
  const onOffense = st.poss === t;
  if ((info.side === 'off') !== onOffense) return 'side';
  const pos = ownerPos(st.teams[t], sp);
  if (!pos) return 'bench';
  if (info.roles && !info.roles.includes(roleOf(pos))) return 'position';
  if (st.mom[t] < info.cost) return 'momentum';
  return null;
}

export const usableSpecials = (st: MatchState, t: 0 | 1): SpecialCard[] =>
  st.teams[t].specials.filter((sp) => specialBlock(st, t, sp) === null);

export function potency(st: MatchState, t: 0 | 1, sp: SpecialCard): number {
  const level = clamp(st.read[t][sp.key] ?? 0, 0, READ_MAX);
  return READ_POTENCY[level]! * (sp.boost ? 1.15 : 1);
}

function spend(st: MatchState, t: 0 | 1, sp: SpecialCard): void {
  st.mom[t] = clamp(st.mom[t] - KIND[sp.kind].cost, 0, MOM_MAX);
  st.read[t][sp.key] = clamp((st.read[t][sp.key] ?? 0) + 1, 0, READ_MAX);
  st.totals[t].specials[sp.key] = (st.totals[t].specials[sp.key] ?? 0) + 1;
}

export const specialPick = (sp: SpecialCard): Pick => ({ type: KIND[sp.kind].base, star: 1, special: sp });

/**
 * Calls a "look first" special. Returns true when the look works (the caller may then show the other card);
 * the more the opponent has seen the trick, the more often it fails. The momentum is spent either way.
 */
export function usePeek(st: MatchState, t: 0 | 1, sp: SpecialCard): boolean {
  const p = potency(st, t, sp);
  spend(st, t, sp);
  return st.rng.chance(Math.min(1, p));
}

// ------------------------------------------------------------------ hints (what a sharp hero senses)

export type Hint = null | 'run' | 'pass' | 'blitz' | 'special';

/** What team t senses about the other side's pick before choosing its own. */
export function senseHint(st: MatchState, t: 0 | 1, oppPick: Pick): Hint {
  const me = st.teams[t];
  const opp = st.teams[1 - t];
  const onOffense = st.poss === t;
  const mine = onOffense ? at(me, 'QB').stats.iq : at(me, 'S').stats.iq;
  const theirs = onOffense ? at(opp, 'S').stats.iq : at(opp, 'QB').stats.iq;
  const p = clamp(0.2 + (mine - theirs) / 80, 0.06, 0.8);
  if (!st.rng.chance(p)) return null;
  if (oppPick.special) return 'special';
  if (onOffense) {
    const d = oppPick.type as DefType;
    return d === 'blitz' ? 'blitz' : d === 'stuff' || d === 'contain' ? 'run' : 'pass';
  }
  return isRun(oppPick.type as OffType) ? 'run' : 'pass';
}

// ------------------------------------------------------------------ the computer's play calling

const keyMoment = (st: MatchState): boolean =>
  st.down >= 3 || FIELD - st.pos <= 12 || (st.quarter >= QUARTERS && st.left <= 3);

function offWeights(st: MatchState, t: 0 | 1): (p: Pick) => number {
  const team = st.teams[t];
  const last = st.calls[t][st.calls[t].length - 1];
  const behind = st.score[t] < st.score[1 - t];
  const late = st.quarter >= QUARTERS;
  const goal = FIELD - st.pos;
  return (p) => {
    const type = p.type as OffType;
    let w = isRun(type) ? team.runBias : 1 - team.runBias;
    w *= { inside: 1.0, outside: 0.9, short: 1.1, long: 0.7 }[type];
    if (st.toGo <= 2) w *= { inside: 2.2, outside: 1.0, short: 1.0, long: 0.5 }[type];
    if (st.down >= 3 && st.toGo >= 7) w *= { inside: 0.4, outside: 0.7, short: 1.6, long: 1.6 }[type];
    if (goal < 15) w *= type === 'long' ? 0.3 : 1;
    if (late && behind) w *= type === 'long' ? 1.6 : type === 'inside' ? 0.6 : 1;
    if (type === last) w *= 0.7;
    return w * (1 + 0.35 * (p.star - 1));
  };
}

function defWeights(st: MatchState, t: 0 | 1): (p: Pick) => number {
  const team = st.teams[t];
  const seen = st.calls[1 - t];
  const runs = seen.filter(isRun).length;
  const runRate = (runs + 2) / (seen.length + 4);
  const a = seen[seen.length - 1];
  const b = seen[seen.length - 2];
  const repeat = a && a === b ? a : null;
  const counter: Record<OffType, DefType> = { inside: 'stuff', outside: 'contain', short: 'zone', long: 'deep' };
  const goal = FIELD - st.pos;
  return (p) => {
    const type = p.type as DefType;
    let w = 1;
    const lean = team.smart * (runRate - 0.5) * 1.6;
    if (type === 'stuff' || type === 'contain') w *= 1 + lean;
    if (type === 'zone' || type === 'deep') w *= 1 - lean;
    if (repeat && counter[repeat] === type) w *= 1 + team.smart * 1.2;
    if (st.toGo <= 2) w *= { stuff: 2.2, contain: 1.0, zone: 1.0, deep: 0.4, blitz: 1.3 }[type];
    if (st.down >= 3 && st.toGo >= 7) w *= { stuff: 0.5, contain: 0.8, zone: 1.5, deep: 1.8, blitz: 1.3 }[type];
    if (goal <= 10) w *= { stuff: 1.3, contain: 1.1, zone: 1.3, deep: 0.4, blitz: 1.0 }[type];
    return Math.max(0.05, w) * (1 + 0.35 * (p.star - 1));
  };
}

/** How much a special suits the moment (0: do not bother). */
function specialAppeal(st: MatchState, sp: SpecialCard): number {
  const goal = FIELD - st.pos;
  const long = st.toGo >= 7;
  const short = st.toGo <= 3;
  switch (sp.kind) {
    case 'pushRun': return short ? 2 : 0.3;
    case 'sureShort': return st.toGo <= 6 ? 1.5 : 0.6;
    case 'sureLong': case 'flyLong': return goal >= 15 ? (long ? 1.6 : 1) : 0.2;
    case 'powerRun': case 'trick': return 1;
    case 'peekOff': return 1;
    case 'wall': return short || goal <= 8 ? 2 : 0.5;
    case 'steal': return long ? 1.6 : 0.6;
    case 'rush': return long ? 1.4 : 0.7;
    case 'roar': return 1;
    case 'peekDef': return 1;
  }
}

/** The basic card that does best against the other side's pick. */
export const bestAgainst = (opp: Pick, onOffense: boolean): OffType | DefType => {
  if (onOffense) {
    const d = opp.special && !isPeek(opp.special) ? KIND[opp.special.kind].base as DefType : (opp.type as DefType);
    return [...OFF_TYPES].sort((a, b) => MATCH[b][d] - MATCH[a][d])[0]!;
  }
  const o = opp.type as OffType;
  return [...DEF_TYPES].sort((a, b) => MATCH[o][a] - MATCH[o][b])[0]!;
};

/**
 * The computer picks for team t. `opp` is the other side's pick when it is already made:
 * it is only looked at if a "look first" special is used and works.
 */
export function autoPick(st: MatchState, t: 0 | 1, opp?: Pick): Pick {
  const onOffense = st.poss === t;
  const specials = usableSpecials(st, t).filter((sp) => !isPeek(sp) || opp);
  if (specials.length) {
    const sp = st.rng.weighted(specials, (s) => specialAppeal(st, s));
    if (st.rng.chance(specialChance(st, t, sp))) {
      if (!isPeek(sp)) return specialPick(sp);
      return peekPick(st, t, sp, opp!);
    }
  }
  return onOffense ? st.rng.weighted(st.hand.off, offWeights(st, t)) : st.rng.weighted(st.hand.def, defWeights(st, t));
}

function specialChance(st: MatchState, t: 0 | 1, sp: SpecialCard): number {
  const full = st.mom[t] >= MOM_MAX;
  const base = keyMoment(st) ? 0.6 : full ? 0.5 : 0.15;
  return base * Math.min(1.2, specialAppeal(st, sp)) * (0.4 + 0.6 * potency(st, t, sp));
}

function peekPick(st: MatchState, t: 0 | 1, sp: SpecialCard, opp: Pick): Pick {
  const onOffense = st.poss === t;
  if (usePeek(st, t, sp)) return { type: bestAgainst(opp, onOffense), star: 2, peeked: true };
  return { type: st.rng.pick<OffType | DefType>(onOffense ? OFF_TYPES : DEF_TYPES), star: 2, peeked: true };
}

/** After the other side has picked: does the computer use a "look first" special? (null: no) */
export function autoPeek(st: MatchState, t: 0 | 1, opp: Pick): Pick | null {
  const peeks = usableSpecials(st, t).filter(isPeek);
  if (!peeks.length) return null;
  const sp = st.rng.pick(peeks);
  return st.rng.chance(specialChance(st, t, sp)) ? peekPick(st, t, sp, opp) : null;
}

// ------------------------------------------------------------------ one play

const SD: Record<OffType, number> = { inside: 0.7, outside: 1.1, short: 0.9, long: 1.2 };
/** (attack rating - defense rating) / ADV_SCALE is added to the quality of the play */
const ADV_SCALE = 20;

const nm = (t: TeamSheet, id: number): string => byId(t, id).name;

export function resolvePlay(st: MatchState, offPick: Pick, defPick: Pick): PlayResult {
  if (st.over) throw new Error('the match is over');
  const o = st.poss;
  const d = (1 - o) as 0 | 1;
  const O = st.teams[o];
  const D = st.teams[d];
  const rng = st.rng;
  const type = offPick.type as OffType;
  const before = { pos: st.pos, down: st.down, toGo: st.toGo, quarter: st.quarter, left: st.left };
  const momBefore: [number, number] = [st.mom[0], st.mom[1]];

  const osp = offPick.special;
  const dsp = defPick.special;
  const ok = osp?.kind as OffKind | undefined;
  const dk = dsp?.kind as DefKind | undefined;
  const op = osp ? potency(st, o, osp) : 0;
  const dp = dsp ? potency(st, d, dsp) : 0;
  if (osp) spend(st, o, osp);
  if (dsp) spend(st, d, dsp);

  // who is involved
  const passer = O.lineup.off.QB;
  let targetPos: OffPos = 'RB';
  if (!isRun(type)) {
    const [best, other] = receivers(O, type as 'short' | 'long');
    targetPos = rng.chance(0.75) ? best : other;
    if (ok === 'flyLong') targetPos = ownerPos(O, osp!) as OffPos;
  }
  const carrier = isRun(type) ? O.lineup.off.RB : O.lineup.off[targetPos];
  const defPool: Record<OffType, DefPos[]> = {
    inside: ['DL1', 'DL2', 'LB'], outside: ['LB', 'CB1', 'CB2'], short: ['CB1', 'CB2', 'LB'], long: ['S', 'CB1', 'CB2'],
  };
  let defender = D.lineup.def[rng.weighted(defPool[type], (p) => 10 + r(D, p))];
  if (dsp) defender = dsp.owner;

  // quality of the play
  let m = dk && dk !== 'peekDef' ? DEF_SPECIAL_MATCH[dk][type] : MATCH[type][defPick.type as DefType];
  if (ok === 'trick') m = Math.max(m, m + (1.0 - m) * Math.min(1, op));
  const edge: PlayResult['edge'] = m <= -1 ? 'def' : m >= 0.8 ? 'off' : 'even';
  const adv = (offRating(O, type, isRun(type) ? undefined : targetPos) - defRating(D, type)) / ADV_SCALE;
  let q = adv + m + 0.3 * (offPick.star - 1) - 0.3 * (defPick.star - 1) + rng.normal() * SD[type];
  if (ok === 'powerRun') q += 1.8 * op;
  if (ok === 'pushRun') q += 1.0 * op;
  if (ok === 'sureLong') q += 2.0 * op;
  if (ok === 'sureShort') q += 1.0 * op;
  if (ok === 'flyLong') q += 1.3 * op;
  if (dk === 'roar') q -= 1.6 * dp;
  if (dk === 'rush' && type !== 'outside') q -= 0.9 * dp;
  if (dk === 'wall' && type !== 'long') q -= 0.8 * dp;

  const noInt = ok === 'sureLong' || ok === 'sureShort';
  const blitz = defPick.type === 'blitz' && dk !== 'steal' && dk !== 'wall' && dk !== 'roar';
  let outcome: Outcome = 'gain';
  let yards = 0;

  const stolen = dk === 'steal' && rng.chance((isRun(type) ? 0.12 : type === 'short' ? 0.55 : 0.7) * dp);
  if (stolen) {
    if (isRun(type)) outcome = 'fumble';
    else outcome = noInt ? 'incomplete' : 'int';
    yards = isRun(type) ? rng.int(0, 3) : 0;
  } else if (type === 'inside') {
    yards = Math.round(3.5 + 2.0 * q);
    yards = clamp(yards, -2, 9);
    if (q > 2.4 && rng.chance(0.5)) yards += rng.int(6, 14);
    if (q < -2.3 && rng.chance(0.15)) outcome = 'fumble';
  } else if (type === 'outside') {
    yards = Math.round(3 + 3.2 * q);
    yards = clamp(yards, -5, 14);
    if (q > 1.9 && rng.chance(0.55)) yards += rng.int(8, 22);
    if (q < -2.4 && rng.chance(0.12)) outcome = 'fumble';
  } else if (type === 'short') {
    const sure = ok === 'sureShort' && rng.chance(Math.min(1, op));
    if (!sure && !noInt && q < -2.3 && rng.chance(0.45)) outcome = 'int';
    else if (!sure && blitz && q < -1.6) {
      outcome = 'sack';
      yards = -rng.int(4, 7);
    } else if (!sure && q < -0.9) outcome = 'incomplete';
    else {
      yards = clamp(Math.round(5 + 2.2 * q), sure ? 4 : 2, 13);
      if (q > 2.2 && rng.chance(0.4)) yards += rng.int(6, 15);
    }
  } else {
    const sackSafe = ok === 'sureLong' && rng.chance(0.6 * Math.min(1, op));
    if (blitz && q < 0 && !sackSafe) {
      outcome = 'sack';
      yards = -rng.int(5, 8);
    } else if (!noInt && q < -1.5 && rng.chance(0.5)) outcome = 'int';
    else if (q < 1.0) outcome = 'incomplete';
    else {
      yards = clamp(Math.round(17 + 6 * (q - 1)), 15, 40);
      if (ok === 'flyLong') yards += Math.round(8 * op);
    }
  }

  // specials that bend the result
  const moving = outcome === 'gain';
  if (moving && (ok === 'powerRun' || ok === 'pushRun')) {
    yards = Math.max(yards, Math.round((ok === 'powerRun' ? 4 : 3) * Math.min(1, op)));
  }
  if (moving && dk === 'wall' && type !== 'long') yards = Math.min(yards, Math.round(1 + (1 - Math.min(1, dp)) * 5));
  let roared = false;
  if (moving && dk === 'roar' && yards <= 0) {
    yards -= Math.round(3 * dp);
    roared = true;
  }

  // the ball cannot go behind the goal line or past the far end
  if (outcome === 'gain' || outcome === 'sack') yards = Math.max(yards, 1 - st.pos);
  let td = false;
  if (outcome === 'gain') {
    if (st.pos + yards >= FIELD) {
      yards = FIELD - st.pos;
      td = true;
    } else if (yards === 0) outcome = 'nogain';
    else if (yards < 0) outcome = 'loss';
  }

  // ---- book-keeping
  const lines: string[] = [];
  const cn = nm(O, carrier);
  const dn = nm(D, defender);
  const pn = nm(O, passer);
  if (osp) lines.push(`${nm(O, osp.owner)}の「${osp.name}」！`);
  if (dsp) lines.push(`${nm(D, dsp.owner)}の「${dsp.name}」！`);
  let turnover: PlayResult['turnover'] = null;
  let firstDown = false;
  const tot = st.totals[o];
  tot.plays += 1;
  st.calls[o].push(type);
  const mom = (t: 0 | 1, v: number): void => {
    st.mom[t] = clamp(st.mom[t] + v, 0, MOM_MAX);
  };

  const kickoff = (to: 0 | 1): void => {
    st.poss = to;
    st.pos = START;
    st.down = 1;
    st.toGo = 10;
  };
  const handOver = (spot: number): void => {
    // spot: where the ball is, measured from the old offense's goal line
    st.poss = d;
    st.pos = clamp(FIELD - spot, 8, FIELD - 1);
    st.down = 1;
    st.toGo = Math.min(10, FIELD - st.pos);
    tot.turnovers += 1;
  };

  if (outcome === 'int' || outcome === 'fumble') {
    turnover = outcome;
    const depth = outcome === 'fumble' ? yards : type === 'long' ? 18 : 5;
    lines.push(outcome === 'int' ? `${dn}がパスを奪い取った！ 攻守交代` : `${cn}がボールをこぼした！ ${dn}が押さえて攻守交代`);
    yards = 0;
    handOver(clamp(before.pos + depth, 1, FIELD - 1));
    mom(d, 2);
    mom(o, -1);
  } else {
    if (outcome === 'incomplete') lines.push(`${pn}のパスは通らず。${dn}がはじいた`);
    else if (outcome === 'sack') lines.push(`${dn}が${pn}をつかまえた！ ${-yards}ヤード後退`);
    else if (outcome === 'loss') lines.push(`${dn}が${cn}を押し戻した。${-yards}ヤード後退`);
    else if (outcome === 'nogain') lines.push(`${dn}が${cn}を止めた。前進できず`);
    else if (isRun(type)) lines.push(`${cn}が${type === 'inside' ? '中央を突く' : '外を回る'}！ ${yards}ヤード前進`);
    else lines.push(`${pn}から${cn}へ${type === 'long' ? 'ロング' : ''}パス成功！ ${yards}ヤード前進`);

    tot.yards += yards;
    if (yards < 0) mom(d, 1);
    if (roared) mom(o, -1);
    if (td) {
      st.score[o] += TD_POINTS;
      tot.td += 1;
      lines.push(`タッチダウン！ ${O.short}に${TD_POINTS}点`);
      mom(o, 2);
      mom(d, -1);
      kickoff(d);
    } else {
      if (yards >= 15) mom(o, 1);
      st.pos += yards;
      st.toGo -= yards;
      if (st.toGo <= 0) {
        firstDown = true;
        tot.firstDowns += 1;
        st.down = 1;
        st.toGo = Math.min(10, FIELD - st.pos);
        lines.push('ファーストダウン！ 攻撃権を更新');
        mom(o, 1);
      } else if (st.down >= 4) {
        turnover = 'downs';
        lines.push('4回で10ヤード進めず。攻守交代');
        handOver(st.pos);
        mom(d, 2);
      } else {
        st.down += 1;
      }
    }
  }

  // ---- the clock (counted in plays)
  st.n += 1;
  let period: PlayResult['period'] = null;
  if (st.sudden) {
    if (st.score[0] !== st.score[1]) {
      st.over = true;
      period = 'final';
    }
  } else {
    st.left -= 1;
    if (st.left <= 0) {
      if (st.quarter >= QUARTERS) {
        if (st.score[0] === st.score[1]) {
          st.sudden = true;
          period = 'sudden';
        } else {
          st.over = true;
          period = 'final';
        }
      } else {
        st.quarter += 1;
        st.left = PLAYS_PER_Q;
        period = 'quarter';
        if (st.quarter === QUARTERS / 2 + 1) {
          period = 'half';
          kickoff((1 - st.first) as 0 | 1);
        }
      }
    }
  }
  if (!st.over) deal(st);

  return {
    n: st.n, off: o, offPick, defPick, before, outcome, yards, td, firstDown, turnover, edge,
    passer, carrier, defender, offPotency: op, defPotency: dp,
    momBefore, momAfter: [st.mom[0], st.mom[1]], period, lines,
  };
}

/** Plays a whole match with the computer calling for both sides. */
export function simulate(home: TeamSheet, away: TeamSheet, seed: number): MatchState {
  const st = createMatch(home, away, seed);
  let guard = 0;
  while (!st.over && guard < 400) {
    guard += 1;
    const o = st.poss;
    const d = (1 - o) as 0 | 1;
    // each side picks without seeing the other; a "look first" special is the exception
    const def0 = autoPick(st, d);
    const off = autoPick(st, o, def0);
    const def = def0.special || off.peeked ? def0 : (autoPeek(st, d, off) ?? def0);
    resolvePlay(st, off, def);
  }
  return st;
}
