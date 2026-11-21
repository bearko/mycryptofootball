// The match engine: no screen, no clock, only rules. Everything random goes through the match's Rng,
// so the same seed and the same picks always give the same game.
//
// The simplified sport:
//  - the field is FIELD yards long; a drive starts START yards from your own goal line
//  - four plays to gain 10 yards, or the ball goes to the other team where it is
//  - reaching the far end is a touchdown (TD_POINTS). The scoring team then tries for more from TRY_YARDS out:
//    a kick for one point (it needs a kicker) or one more play for two. Then the other team attacks
//  - a team with a kicker can also kick a field goal (FG_POINTS; a miss gives the ball away where it lies)
//    or punt the ball away
//  - each half begins with a kickoff, and after every score the team that scored kicks off: the other team
//    catches the ball and runs it back, and attacks from where it is stopped (about START yards out on average).
//    A team that is behind in the last quarter may try an onside kick instead: a short kick it tries to win back
//  - no penalties, no clock: the game is QUARTERS x PLAYS_PER_Q plays long
//    (the try after a touchdown and the kickoffs are not counted)

import { Rng, clamp } from '../core/rng';
import {
  DEF_SPECIAL_MATCH, DEF_TYPES, KICK_INFO, KIND, MATCH, OFF_TYPES, READ_MAX, READ_POTENCY, isKick, isKickoff, isRun,
  type DefKind, type DefType, type KickType, type OffKind, type OffType, type SpecialCard,
} from './cards';
import { defPos, fit, kickFit, offPos, roleOf, type DefPos, type Lineup, type OffPos, type Player, type Role } from './model';

export const FIELD = 50;
/** where a drive starts on average (a kickoff run back) */
export const START = 15;
/** a kickoff is kicked from here, in the kicking team's yards */
export const KICKOFF_FROM = 17;
/** an onside kick travels this far before anybody may fall on it */
export const ONSIDE_YARDS = 6;
export const QUARTERS = 4;
export const PLAYS_PER_Q = 7;
export const TD_POINTS = 6;
export const FG_POINTS = 3;
export const PAT_POINTS = 1;
export const TWO_POINTS = 2;
/** the try after a touchdown is played from this far out */
export const TRY_YARDS = 3;
/** On the try the defense packs the goal line: a play's quality drops by this much (so two points are a real gamble). */
export const TRY_WALL = 1.1;
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
  type: OffType | DefType | KickType;
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
  /** added to each team's chance of sensing the other side's pick (from the half-time talk) */
  insight?: [number, number];
  /** the team with the ball has just scored a touchdown: this play is its try for more points */
  tfp?: boolean;
  /** the team with the ball is about to kick off (the only cards it may play are the kickoffs) */
  ko?: boolean;
  /** a match told as a story (the tutorial's first match): what the plays to come will be, whatever is called */
  script?: Scripted[];
}

/**
 * One play of a scripted match: the offense gains this much whatever is called (`td`: it scores, and the story
 * and the match end there), or the team with the ball kicks, and the kick is good.
 */
export interface Scripted {
  yards?: number;
  td?: boolean;
  kick?: 'fg';
}

export type Outcome = 'gain' | 'nogain' | 'loss' | 'incomplete' | 'sack' | 'int' | 'fumble' | 'kick';

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
  /** why the ball changed hands, if it did (a missed field goal and a punt give it away too) */
  turnover: null | 'downs' | 'int' | 'fumble' | 'miss' | 'punt';
  /**
   * a kick: what was tried, from how far (a punt or a kickoff: how far it went), whether it was good, who kicked
   * (an onside kick is good when the kicking team wins the ball back). A kickoff: who of the other team got the ball,
   * how far it was run back (0: it went into the end zone), and where the next drive starts (`spot`, in the yards of the team that has it)
   */
  kick?: { type: KickType; good: boolean; dist: number; kicker: number; returner?: number; ret?: number; spot?: number };
  /** this play was the try after a touchdown */
  tfp?: boolean;
  /** points scored on this play */
  points: number;
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
    // the match begins with a kickoff: `first` is the team that receives it
    poss: (1 - first) as 0 | 1,
    pos: KICKOFF_FROM,
    ko: true,
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
  if (st.script) {
    // a told story: every play is on the table, and nothing is left to luck
    st.hand = {
      off: OFF_TYPES.map((type) => ({ type, star: 1 })),
      def: DEF_TYPES.slice(0, 3).map((type) => ({ type, star: 1 })),
    };
    return;
  }
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
/** The positions of one kind in a team's line-up, in order (two linemen six a side, five when it is eleven). */
export function group<P extends OffPos | DefPos = OffPos | DefPos>(t: TeamSheet, ...roles: Role[]): P[] {
  return ([...offPos(t.lineup), ...defPos(t.lineup)] as (OffPos | DefPos)[]).filter((p) => roles.includes(roleOf(p))) as P[];
}
/** How good a team is at one kind of position: the mean over everybody who plays it. */
const rr = (t: TeamSheet, ...roles: Role[]): number => {
  const g = group(t, ...roles);
  let v = 0;
  for (const p of g) v += r(t, p);
  return v / g.length;
};

/** The best and the second best target for a throw of this depth (a tight end is thrown short passes too). */
function receivers(t: TeamSheet, type: 'short' | 'long'): [OffPos, OffPos] {
  const val = (pos: OffPos): number => {
    const s = at(t, pos).stats;
    return type === 'long' ? 0.5 * s.spd + 0.5 * s.cat : r(t, pos);
  };
  const g = type === 'long' ? group<OffPos>(t, 'WR') : group<OffPos>(t, 'WR', 'TE');
  const sorted = g.map((p, i) => ({ p, i, v: val(p) })).sort((a, b) => b.v - a.v || a.i - b.i);
  return [sorted[0]!.p, sorted[1]!.p];
}

export function offRating(t: TeamSheet, type: OffType, target?: OffPos): number {
  const line = rr(t, 'OL');
  // on a run the tight end is one more blocker
  const push = isRun(type) ? rr(t, 'OL', 'TE') : line;
  if (type === 'inside') return 0.45 * r(t, 'RB') + 0.55 * push;
  if (type === 'outside') return 0.8 * r(t, 'RB') + 0.2 * push;
  const [best, other] = receivers(t, type);
  const a = target ?? best;
  const b = a === best ? other : best;
  if (type === 'short') return 0.5 * r(t, 'QB') + 0.35 * r(t, a) + 0.15 * r(t, b);
  const s = at(t, a).stats;
  return 0.45 * r(t, 'QB') + 0.4 * (0.5 * s.spd + 0.5 * s.cat) + 0.15 * line;
}

export function defRating(t: TeamSheet, type: OffType): number {
  const dl = rr(t, 'DL');
  const cb = rr(t, 'CB');
  const lb = rr(t, 'LB');
  const sf = rr(t, 'S');
  if (type === 'inside') return 0.65 * dl + 0.35 * lb;
  if (type === 'outside') return 0.55 * lb + 0.45 * cb;
  if (type === 'short') return 0.6 * cb + 0.25 * lb + 0.15 * sf;
  return 0.5 * sf + 0.35 * cb + 0.15 * dl;
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

// ------------------------------------------------------------------ the half-time talk

export type TalkKey = 'fire' | 'rethink' | 'study';
export const TALK_KEYS: readonly TalkKey[] = ['fire', 'rethink', 'study'];
export const TALKS: Record<TalkKey, { name: string; text: string }> = {
  fire: { name: '気合いを入れる', text: '流れ +2。後半の入りから特別作戦をねらえる' },
  rethink: { name: '作戦を練り直す', text: '読まれた特別作戦を、すべて1段階もとにもどす' },
  study: { name: '相手を分析する', text: '後半は、相手の作戦の気配を読みやすくなる' },
};

/** What the coach does with the break. Each team gets one. */
export function halftimeTalk(st: MatchState, t: 0 | 1, key: TalkKey): void {
  if (key === 'fire') st.mom[t] = clamp(st.mom[t] + 2, 0, MOM_MAX);
  else if (key === 'rethink') {
    for (const k of Object.keys(st.read[t])) st.read[t][k] = Math.max(0, st.read[t][k]! - 1);
  } else {
    const now = st.insight ?? [0, 0];
    now[t] += 0.25;
    st.insight = now;
  }
}

/** The computer's half-time talk: fire up when behind, otherwise whatever helps. */
export function autoTalk(st: MatchState, t: 0 | 1): TalkKey {
  const read = Object.values(st.read[t]).some((v) => v >= 2);
  if (read && st.rng.chance(0.6)) return 'rethink';
  if (st.score[t] < st.score[1 - t]) return 'fire';
  return st.rng.pick(TALK_KEYS);
}

// ------------------------------------------------------------------ hints (what a sharp hero senses)

export type Hint = null | 'run' | 'pass' | 'blitz' | 'special' | 'kick';

/** What team t senses about the other side's pick before choosing its own. */
export function senseHint(st: MatchState, t: 0 | 1, oppPick: Pick): Hint {
  const me = st.teams[t];
  const opp = st.teams[1 - t];
  const onOffense = st.poss === t;
  const mine = onOffense ? at(me, 'QB').stats.iq : at(me, 'S').stats.iq;
  const theirs = onOffense ? at(opp, 'S').stats.iq : at(opp, 'QB').stats.iq;
  const p = clamp(0.2 + (mine - theirs) / 80 + (st.insight?.[t] ?? 0), 0.06, 0.85);
  if (!st.rng.chance(p)) return null;
  if (isKick(oppPick.type)) return 'kick';
  if (oppPick.special) return 'special';
  if (onOffense) {
    const d = oppPick.type as DefType;
    return d === 'blitz' ? 'blitz' : d === 'stuff' || d === 'contain' ? 'run' : 'pass';
  }
  return isRun(oppPick.type as OffType) ? 'run' : 'pass';
}

// ------------------------------------------------------------------ kicking

/** The team's kicker, if it has one. */
export function kickerOf(t: TeamSheet): Player | null {
  const id = t.lineup.k;
  return id == null ? null : t.players.find((p) => p.id === id) ?? null;
}
/** How far the kicker's leg carries, in yards (the distance where a field goal is a toss-up is a little short of it). */
const leg = (k: Player): number => 16 + kickFit(k.stats) * 0.2;
/** The chance a field goal is good from where the ball is now. */
export function fgChance(st: MatchState, t: 0 | 1): number {
  const k = kickerOf(st.teams[t]);
  if (!k) return 0;
  const d = FIELD - st.pos;
  return clamp(1.02 - 0.55 * (d / leg(k)) ** 2, 0.03, 0.98);
}
/** The chance the kick after a touchdown is good. */
export function patChance(t: TeamSheet): number {
  const k = kickerOf(t);
  return k ? clamp(0.72 + kickFit(k.stats) * 0.003, 0.5, 0.97) : 0;
}
/**
 * May team t try an onside kick now? Only when it is about to kick off, behind, in the last quarter:
 * that is when winning the ball back is worth the risk (and the only time the coach is asked).
 */
export const canOnside = (st: MatchState, t: 0 | 1): boolean =>
  !!st.ko && st.poss === t && !st.script && !st.sudden && st.quarter >= QUARTERS && st.score[t] < st.score[1 - t];
/** The chance an onside kick is won back by the team that kicks it. */
export function onsideChance(t: TeamSheet): number {
  const k = kickerOf(t);
  return clamp(0.22 + ((k ? kickFit(k.stats) : 40) - 50) / 300, 0.12, 0.32);
}

/** Why team t cannot play this kick now (null: it can). */
export function kickBlock(st: MatchState, t: 0 | 1, type: KickType): null | 'nobody' | 'far' | 'time' {
  if (isKickoff(type) || st.ko) {
    // a kickoff needs nobody special (anybody can boot the ball off the tee); an onside kick has its moment
    if (st.poss !== t) return 'nobody';
    return st.ko && isKickoff(type) && (type === 'kickoff' || canOnside(st, t)) ? null : 'time';
  }
  const k = kickerOf(st.teams[t]);
  if (!k || st.poss !== t) return 'nobody';
  if ((type === 'pat') !== !!st.tfp) return 'time';
  if (type === 'fg' && FIELD - st.pos > leg(k) * 1.2) return 'far';
  return null;
}
/** The kicks team t has in its hand right now (it must have the ball and a kicker). */
export function kickPicks(st: MatchState, t: 0 | 1): Pick[] {
  if (st.ko) return st.poss !== t ? [] : (canOnside(st, t) ? (['kickoff', 'onside'] as const) : (['kickoff'] as const)).map((type) => ({ type, star: 1 }));
  if (st.poss !== t || st.script || !kickerOf(st.teams[t])) return [];
  return (st.tfp ? (['pat'] as const) : (['fg', 'punt'] as const)).map((type) => ({ type, star: 1 }));
}

// ------------------------------------------------------------------ what the player is shown before choosing

/** What losing the ball is counted as, in yards, when a card's outlook is worked out. */
const TURNOVER_COST = 12;
/** A normal curve in seven steps (value, weight): enough for an estimate. */
const BELL: readonly [number, number][] = [[-1.8, 0.05], [-1.2, 0.1], [-0.6, 0.2], [0, 0.3], [0.6, 0.2], [1.2, 0.1], [1.8, 0.05]];

/**
 * The yards a play of this quality is worth on average (a lost ball counts against it).
 * It follows resolvePlay() without rolling any dice: an estimate for the number on the cards, never the result.
 */
function worth(type: OffType, q: number, blitz: boolean, room: number, safe = false): number {
  const lose = safe ? 0 : TURNOVER_COST;
  let y: number;
  if (type === 'inside') y = clamp(Math.round(3.5 + 2 * q), -2, 9) + (q > 2.4 ? 5 : 0) - (q < -2.3 ? 0.15 * lose : 0);
  else if (type === 'outside') y = clamp(Math.round(3 + 3.2 * q), -5, 14) + (q > 1.9 ? 0.55 * 15 : 0) - (q < -2.4 ? 0.12 * lose : 0);
  else if (type === 'short') {
    if (q < -2.3) y = -0.45 * lose + (blitz ? 0.55 * -5.5 : 0);
    else if (blitz && q < -1.6) y = -5.5;
    else if (q < -0.9) y = 0;
    else y = clamp(Math.round(5 + 2.2 * q), 2, 13) + (q > 2.2 ? 0.4 * 10.5 : 0);
  } else if (blitz && q < 0) y = -6.5;
  else if (q < -1.5) y = -0.5 * lose;
  else if (q < 1) y = 0;
  else y = clamp(Math.round(17 + 6 * (q - 1)), 15, 40);
  return Math.min(y, room);
}

/**
 * A rough 1..10 for a card in team t's hand, not knowing what the other side will call:
 * the abilities of the heroes involved against the ones across from them, the card's stars, a special's push.
 * On offense it is the ground the play should gain; on defense, how little it should give up.
 * A guide, not a promise: the other side's card still decides most of it. null for a "look first" special.
 */
export function outlook(st: MatchState, t: 0 | 1, pick: Pick): number | null {
  const me = st.teams[t];
  const opp = st.teams[1 - t];
  const onOffense = st.poss === t;
  const room = FIELD - st.pos;
  const sp = pick.special;
  if (sp && isPeek(sp)) return null;
  if (isKick(pick.type)) {
    // a kick: its chance of going in (a punt has no number: what it is worth depends on where the ball is)
    if (pick.type === 'punt' || pick.type === 'kickoff' || kickBlock(st, t, pick.type)) return null;
    if (pick.type === 'onside') return clamp(Math.round(onsideChance(me) * 10), 1, 10);
    return clamp(Math.round((pick.type === 'fg' ? fgChance(st, t) : patChance(me)) * 10), 1, 10);
  }
  const pot = sp ? potency(st, t, sp) : 0;
  const star = 0.3 * (pick.star - 1);
  const wall = st.tfp ? TRY_WALL : 0;
  // the other side's card is unknown: its stars count as the average deal
  const THEIR_STARS = 0.2;
  if (onOffense) {
    const type = pick.type as OffType;
    const kind = sp?.kind as OffKind | undefined;
    const adv = (offRating(me, type) - defRating(opp, type)) / ADV_SCALE;
    const push = kind === 'powerRun' ? 1.8 : kind === 'pushRun' ? 1.0 : kind === 'sureLong' ? 2.0 : kind === 'sureShort' ? 1.0 : kind === 'flyLong' ? 1.3 : 0;
    let sum = 0;
    let hit = 0;
    for (const d of DEF_TYPES) {
      let m = MATCH[type][d];
      if (kind === 'trick') m = Math.max(m, m + (1 - m) * Math.min(1, pot));
      for (const [z, w] of BELL) {
        const q = adv + m + star - THEIR_STARS + push * pot + z * SD[type] - wall;
        let y = worth(type, q, d === 'blitz', room, kind === 'sureLong' || kind === 'sureShort');
        if (kind === 'flyLong' && q >= 1) y = Math.min(room, y + 8 * pot);
        if ((kind === 'powerRun' || kind === 'pushRun') && q > -2.3) y = Math.max(y, (kind === 'powerRun' ? 4 : 3) * Math.min(1, pot));
        sum += w * y;
        if (y >= room) hit += w;
      }
    }
    // the try after a touchdown is all or nothing: like a kick, the number is the chance of getting there
    if (st.tfp) return clamp(Math.round((hit / DEF_TYPES.length) * 10), 1, 10);
    return clamp(Math.round(1 + (sum / DEF_TYPES.length) * 0.75), 1, 10);
  }
  // defense: what the other side's plays should gain against this call, weighted by how much they like to run
  const call = pick.type as DefType;
  const kind = sp?.kind as DefKind | undefined;
  let sum = 0;
  let hit = 0;
  for (const type of OFF_TYPES) {
    const share = (isRun(type) ? opp.runBias : 1 - opp.runBias) / 2;
    const adv = (offRating(opp, type) - defRating(me, type)) / ADV_SCALE;
    let m = kind && kind !== 'peekDef' ? DEF_SPECIAL_MATCH[kind][type] : MATCH[type][call];
    if (kind === 'roar') m -= 1.6 * pot;
    if (kind === 'rush' && type !== 'outside') m -= 0.9 * pot;
    if (kind === 'wall' && type !== 'long') m -= 0.8 * pot;
    const blitz = call === 'blitz' && kind !== 'steal' && kind !== 'wall' && kind !== 'roar';
    for (const [z, w] of BELL) {
      let y = worth(type, adv + m - star + THEIR_STARS + z * SD[type] - wall, blitz, room);
      if (kind === 'wall' && type !== 'long') y = Math.min(y, 1 + (1 - Math.min(1, pot)) * 5);
      if (kind === 'steal') y -= (isRun(type) ? 0.12 : type === 'short' ? 0.55 : 0.7) * pot * TURNOVER_COST;
      sum += share * w * y;
      if (y >= room) hit += share * w;
    }
  }
  if (st.tfp) return clamp(Math.round(10 * (1 - hit)), 1, 10);
  return clamp(Math.round(10 - sum * 0.9), 1, 10);
}

/** The heroes a card is about, the one who matters most first (at most three). */
export function keyHeroes(st: MatchState, t: 0 | 1, pick: Pick): { id: number; pos: OffPos | DefPos | 'K' }[] {
  const me = st.teams[t];
  const onOffense = st.poss === t;
  if (isKick(pick.type)) {
    const k = kickerOf(me);
    // the kicker, and the quarterback who holds the ball for a place kick
    return [...(k ? [{ id: k.id, pos: 'K' as const }] : []), ...(pick.type === 'punt' || isKickoff(pick.type) || k?.id === me.lineup.off.QB ? [] : [{ id: me.lineup.off.QB, pos: 'QB' as const }])];
  }
  let order: (OffPos | DefPos)[];
  if (onOffense) {
    const type = pick.type as OffType;
    if (isRun(type)) order = ['RB', 'OL1', 'OL2'];
    else {
      const [best, other] = receivers(me, type as 'short' | 'long');
      order = type === 'short' ? ['QB', best, other] : ['QB', best, 'OL1'];
    }
  } else {
    const call = pick.type as DefType;
    order = ({
      stuff: ['DL1', 'DL2', 'LB'], contain: ['LB', 'CB1', 'CB2'], zone: ['CB1', 'CB2', 'LB'], deep: ['S', 'CB1', 'CB2'], blitz: ['DL1', 'DL2', 'LB'],
    } as Record<DefType, DefPos[]>)[call];
  }
  const out: { id: number; pos: OffPos | DefPos | 'K' }[] = order.map((pos) => ({ id: at(me, pos).id, pos }));
  const sp = pick.special;
  if (sp) {
    // the hero whose play it is comes first, wherever they line up
    const i = out.findIndex((k) => k.id === sp.owner);
    const own = i >= 0 ? out.splice(i, 1)[0]! : { id: sp.owner, pos: ownerPos(me, sp) ?? out[0]!.pos };
    out.unshift(own);
  }
  return out.slice(0, 3);
}

// ---- the huddle: before each play the heroes on the field say how their own match-up looks

/** What a hero talks about: one of the four ways to attack, or where the whole thing is weakest ("gap"). */
export type Topic = OffType | 'gap' | 'kick';
export interface Voice {
  id: number;
  pos: OffPos | DefPos | 'K';
  /** the speaker's judgment: the higher, the more their word is worth */
  iq: number;
  topic: Topic;
  /** for a "gap": the way to attack the speaker points at */
  points?: OffType;
  text: string;
  /** how it sounds for the speaker's own team */
  tone: 'good' | 'bad' | 'even' | 'vague';
}

const OFF_LINES: Record<OffType, [string, string, string, string, string]> = {
  inside: ['中央は押しこめます！', '中央は少し押せてます', '中央は五分五分です', '相手のDLが重い…中央は苦しいです', '中央は完全に押し負けてます'],
  outside: ['外なら走り勝てる！', '外は少し分がある', '外は五分だな', '相手のLBが速い、外はきつい', '外は追いつかれる…'],
  short: ['CBには勝ってる、短いのください！', '短いパスなら通りそう', 'マークは五分です', 'CBが離れない…短いのは厳しい', '完全に張りつかれてます'],
  long: ['奥、抜けます！', '奥は少し空きそうです', '奥は五分です', 'Sが深い…奥は厳しい', '奥は完全に見張られてます'],
};
const DEF_LINES: Record<OffType, [string, string, string, string, string]> = {
  inside: ['中央は止められます！', '中央は少し分があります', '中央は五分です', '相手のOLが強い…中央は押されます', '中央は割られます…'],
  outside: ['外は任せろ！', '外は少し分がある', '外は五分だ', '相手のRBが速い、外が怖い', '外は走り負ける…'],
  short: ['WRは抑えてます！', '短いパスは少し分があります', 'マークは五分です', 'WRが速い…短いのは通されそう', 'WRに振り切られてます…'],
  long: ['奥は通さない！', '奥は少し分があります', '奥は五分です', '奥を狙われると危ない', '奥は走り負けてます…'],
};
const VAGUE = ['うーん…よくわかりません', 'やってみないとわからん！', 'とにかく全力でいきます！', '…気合いです！'];
const PLAY_NAME: Record<OffType, string> = { inside: '中央ラン', outside: '外ラン', short: 'ショートパス', long: 'ロングパス' };

/**
 * The huddle before a play: two heroes of the unit on the field say how their own match-up looks,
 * and now and then somebody says where the whole thing is weakest.
 * They judge the real difference in ability, and the sharper the hero (judgment), the closer they get:
 * a dull one is often wrong, or has nothing to say. Rolls its own dice: the match does not change.
 */
export function huddle(st: MatchState, t: 0 | 1): Voice[] {
  // a kickoff, or a told story: nobody has anything to say
  if (st.ko || st.script) return [];
  const me = st.teams[t];
  const opp = st.teams[1 - t];
  const onOffense = st.poss === t;
  const rng = new Rng((st.rng.s ^ Math.imul(st.n + 1, 0x9e3779b1)) >>> 0);
  /** how far ahead the speaker's own side really is, for one way to attack */
  const real = (type: OffType): number => (onOffense ? offRating(me, type) - defRating(opp, type) : defRating(me, type) - offRating(opp, type));
  const seen = (iq: number, type: OffType): number => real(type) + rng.normal() * (100 - iq) * 0.2;
  const speak = (pos: OffPos | DefPos, topic: OffType | 'gap'): Voice => {
    const hero = at(me, pos);
    const iq = hero.stats.iq;
    const base = { id: hero.id, pos, iq, topic };
    if (iq < 40 && rng.chance((40 - iq) / 50)) return { ...base, text: rng.pick(VAGUE), tone: 'vague' };
    if (topic === 'gap') {
      const view = OFF_TYPES.map((type) => [type, seen(iq, type)] as const).sort((a, b) => b[1] - a[1]);
      const [best, worst] = [view[0]!, view[view.length - 1]!];
      if (onOffense) {
        return {
          ...base, points: best[0], tone: best[1] >= 3 ? 'good' : 'even',
          text: best[1] - worst[1] < 4 ? 'どこも同じくらいだ。読み合いで勝とう' : `狙い目は${PLAY_NAME[best[0]]}。${PLAY_NAME[worst[0]]}は固いぞ`,
        };
      }
      return {
        ...base, points: worst[0], tone: worst[1] <= -3 ? 'bad' : 'even',
        text: best[1] - worst[1] < 4 ? 'どこも同じくらいです。読み合いで止めましょう' : `${PLAY_NAME[worst[0]]}を狙われそうです。${PLAY_NAME[best[0]]}は怖くない`,
      };
    }
    const v = seen(iq, topic);
    const i = v >= 8 ? 0 : v >= 3 ? 1 : v > -3 ? 2 : v > -8 ? 3 : 4;
    return { ...base, text: (onOffense ? OFF_LINES : DEF_LINES)[topic][i], tone: i < 2 ? 'good' : i === 2 ? 'even' : 'bad' };
  };
  // who talks about what; the round changes with every play
  let table: [OffPos | DefPos, OffType | 'gap'][];
  // the speaker for a kind of position changes from play to play (six a side: the first of two on odd plays)
  const turn = <P extends OffPos | DefPos>(...roles: Role[]): P => {
    const g = group<P>(me, ...roles);
    return g[(st.n + 1) % g.length]!;
  };
  if (onOffense) {
    const [short] = receivers(me, 'short');
    const [long, other] = receivers(me, 'long');
    table = [[turn('OL'), 'inside'], ['RB', 'outside'], [short, 'short'], [long === short ? other : long, 'long'], ['QB', 'gap']];
  } else {
    table = [[turn('DL'), 'inside'], [turn('LB'), 'outside'], [turn('CB'), 'short'], [turn('S'), 'long'], ['S', 'gap']];
  }
  const a = st.n % table.length;
  let b = (st.n * 2 + 2) % table.length;
  if (b === a) b = (b + 1) % table.length;
  // nobody speaks twice in one huddle
  if (table[b]![0] === table[a]![0]) b = (b + 1) % table.length;
  let first = speak(...table[a]!);
  // when a kick is worth thinking about (fourth down, or the try after a touchdown), the kicker says how it looks
  const k = onOffense ? kickerOf(me) : null;
  if (k && (st.tfp || st.down >= 4) && !kickBlock(st, t, st.tfp ? 'pat' : 'fg')) {
    if (first.id === k.id) first = speak(...table[b]!);
    const iq = k.stats.iq;
    const v = (st.tfp ? patChance(me) : fgChance(st, t)) + rng.normal() * (100 - iq) * 0.004;
    const i = v >= 0.85 ? 0 : v >= 0.62 ? 1 : v >= 0.38 ? 2 : 3;
    return [first, {
      id: k.id, pos: 'K', iq, topic: 'kick', tone: i < 2 ? 'good' : i === 2 ? 'even' : 'bad',
      text: ['この距離なら決めます！', '入ると思います', '五分五分です…', '遠すぎます…届くかどうか'][i]!,
    }];
  }
  return [first, speak(...table[b]!)];
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
  // against a kick the only thing a defense can do is come after it
  if (isKick(opp.type)) return 'blitz';
  const o = opp.type as OffType;
  return [...DEF_TYPES].sort((a, b) => MATCH[o][a] - MATCH[o][b])[0]!;
};

/**
 * The computer picks for team t. `opp` is the other side's pick when it is already made:
 * it is only looked at if a "look first" special is used and works.
 */
/** Whether the computer kicks now, and what (null: it runs a play). */
function autoKick(st: MatchState, t: 0 | 1): Pick | null {
  const me = st.teams[t];
  if (st.script && !st.ko) return st.script[0]?.kick ? { type: st.script[0].kick, star: 1 } : null;
  if (st.ko) {
    // behind with the game running out: the short kick, most of the time. Otherwise kick it deep
    const diff = st.score[t] - st.score[1 - t];
    // (with more than a couple of plays left, a stop and a quick score is still the better bet)
    const must = canOnside(st, t) && st.left <= (diff < -8 ? 3 : 2);
    return { type: must && st.rng.chance(st.left <= 2 ? 0.9 : 0.6) ? 'onside' : 'kickoff', star: 1 };
  }
  if (!kickerOf(me)) return null;
  const diff = st.score[t] - st.score[1 - t];
  const late = st.quarter >= QUARTERS;
  if (st.tfp) {
    // two down late: only two points help. Otherwise take the point, unless the kicker cannot be trusted
    if (late && (diff === -2 || diff === -5)) return null;
    return st.rng.chance(patChance(me) >= 0.75 ? 0.93 : 0.6) ? { type: 'pat', star: 1 } : null;
  }
  const p = kickBlock(st, t, 'fg') ? 0 : fgChance(st, t);
  const lastPlay = st.left <= 1 && (st.quarter === QUARTERS / 2 || late) && !st.sudden;
  // the last play of a half: three points are better than nothing (at the very end, only if they are enough)
  if (lastPlay && p >= 0.25 && (!late || (diff <= 0 && diff >= -FG_POINTS))) return { type: 'fg', star: 1 };
  if (st.sudden && st.down >= 3 && p >= 0.6) return { type: 'fg', star: 1 };
  if (st.down < 4) return null;
  if (late && diff < -FG_POINTS && st.left <= 3) return null;
  if (st.toGo <= 1 && FIELD - st.pos > 3 && st.rng.chance(0.6)) return null;
  if (p >= 0.45) return { type: 'fg', star: 1 };
  if (st.toGo <= 2) return null;
  if (late && diff < 0) return null;
  // deep in its own half, or simply too far to go: kick it away
  return st.pos <= 32 || st.toGo >= 6 ? { type: 'punt', star: 1 } : null;
}

export function autoPick(st: MatchState, t: 0 | 1, opp?: Pick): Pick {
  const onOffense = st.poss === t;
  // nobody defends a kickoff with a call
  if (st.ko && !onOffense) return { type: 'zone', star: 1 };
  if (onOffense) {
    const kick = autoKick(st, t);
    if (kick) return kick;
  }
  if (st.script) return onOffense ? st.hand.off[0]! : { type: 'zone', star: 1 };
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

/** Team `to` gets the ball next: the other team kicks off to it (the kick is the next thing played). */
function kickoff(st: MatchState, to: 0 | 1): void {
  st.poss = (1 - to) as 0 | 1;
  st.pos = KICKOFF_FROM;
  st.down = 1;
  st.toGo = 10;
  st.ko = true;
}

/** Who kicks off: the kicker, or the quarterback when the team has none. */
export const kickoffKicker = (t: TeamSheet): Player => kickerOf(t) ?? at(t, 'QB');
/** Who waits deep for a kickoff: the fastest of the backs and receivers. */
export const returnerOf = (t: TeamSheet): Player =>
  group<OffPos>(t, 'RB', 'WR').map((p) => at(t, p)).sort((a, b) => b.stats.spd - a.stats.spd)[0]!;

/**
 * A kickoff. Kicked deep, the other team catches it and runs it back; a drive starts about START yards out
 * on average, further out against a good kicker and fast coverage, closer in with a fast returner.
 * An onside kick goes a few yards: now and then the kicking team falls on it, usually the other team does, close to the goal.
 * No play goes off the clock.
 */
function resolveKickoff(st: MatchState, offPick: Pick, defPick: Pick): PlayResult {
  const o = st.poss;
  const d = (1 - o) as 0 | 1;
  const O = st.teams[o];
  const D = st.teams[d];
  const type = offPick.type as 'kickoff' | 'onside';
  const why = kickBlock(st, o, type);
  if (why) throw new Error(`this kick cannot be played now (${why})`);
  const k = kickoffKicker(O);
  const rng = st.rng;
  const before = { pos: st.pos, down: st.down, toGo: st.toGo, quarter: st.quarter, left: st.left };
  const momBefore: [number, number] = [st.mom[0], st.mom[1]];
  const mom = (t: 0 | 1, v: number): void => {
    st.mom[t] = clamp(st.mom[t] + v, 0, MOM_MAX);
  };
  const lines: string[] = [];
  let good = true;
  let dist: number;
  let ret: number | undefined;
  let returner: number | undefined;
  let tackler = at(O, 'LB').id;
  if (type === 'onside') {
    dist = ONSIDE_YARDS;
    good = rng.chance(onsideChance(O));
    const spot = before.pos + dist;
    if (good) {
      st.pos = spot;
      lines.push(`オンサイドキック、成功！ ${O.short}がボールを取り返した`);
      mom(o, 2);
      mom(d, -1);
    } else {
      st.poss = d;
      st.pos = FIELD - spot;
      lines.push(`オンサイドキックは${D.short}が押さえた。ゴールまで${spot}ヤードから攻撃`);
      mom(d, 1);
    }
    // the two who go for the ball: a corner of the kicking team, a lineman of the other
    tackler = at(O, 'CB1').id;
    returner = at(D, 'OL1').id;
  } else {
    // who runs it back: the fastest of the backs and receivers. Who chases: the kicking team's linebackers and corners
    const back = returnerOf(D);
    const chase = group<DefPos>(O, 'LB', 'CB').map((p) => at(O, p));
    const cover = chase.reduce((v, p) => v + (p.stats.spd + p.stats.tkl) / 2, 0) / chase.length;
    dist = clamp(Math.round(22 + kickFit(k.stats) * 0.1 + rng.normal() * 3), 14, FIELD - before.pos + 4);
    // (a told story: caught at the six, run back to where a drive starts)
    if (st.script) dist = FIELD - before.pos - 6;
    const land = FIELD - (before.pos + dist);
    returner = back.id;
    tackler = chase[rng.int(0, chase.length - 1)]!.id;
    if (land <= 0) {
      // into the end zone: nobody runs it out, the ball comes out to the twelve
      ret = 0;
      st.pos = 12;
      dist = FIELD - before.pos;
      lines.push(`${k.name}のキックオフはエンドゾーンへ。${D.short}は自陣${st.pos}ヤードから`);
    } else {
      ret = clamp(Math.round(7.4 + (back.stats.spd - cover) / 10 + rng.normal() * 3.5), 1, 26);
      st.pos = st.script ? START : clamp(land + ret, 3, 30);
      ret = st.pos - land;
      lines.push(`${k.name}のキックオフ。${back.name}が${ret}ヤード戻して、${D.short}は自陣${st.pos}ヤードから`);
    }
    st.poss = d;
  }
  st.down = 1;
  st.toGo = Math.min(10, FIELD - st.pos);
  st.ko = false;
  st.n += 1;
  deal(st);
  return {
    n: st.n, off: o, offPick, defPick, before, outcome: 'kick', yards: 0, td: false, firstDown: false, turnover: null, edge: 'even',
    passer: O.lineup.off.QB, carrier: k.id, defender: tackler, offPotency: 0, defPotency: 0,
    momBefore, momAfter: [st.mom[0], st.mom[1]], period: null, lines,
    kick: { type, good, dist, kicker: k.id, returner, ret, spot: st.pos }, points: 0,
  };
}

/** One play goes off the clock (which is counted in plays); deals the next hand unless the match is over. */
function tick(st: MatchState): PlayResult['period'] {
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
        // a told story is as long as its plays
        st.left = st.script ? st.script.length : PLAYS_PER_Q;
        period = 'quarter';
        if (st.quarter === QUARTERS / 2 + 1) {
          period = 'half';
          // the team that kicked off the match receives the second half
          kickoff(st, (1 - st.first) as 0 | 1);
        }
      }
    }
  }
  if (!st.over) deal(st);
  return period;
}

/** A kick: a field goal, a punt, or the kick after a touchdown. The defense's card cannot stop it (a rush hurries it a little). */
function resolveKick(st: MatchState, offPick: Pick, defPick: Pick): PlayResult {
  if (isKickoff(offPick.type)) return resolveKickoff(st, offPick, defPick);
  const o = st.poss;
  const d = (1 - o) as 0 | 1;
  const O = st.teams[o];
  const D = st.teams[d];
  const type = offPick.type as KickType;
  const why = kickBlock(st, o, type);
  if (why) throw new Error(`this kick cannot be played now (${why})`);
  const k = kickerOf(O)!;
  const rng = st.rng;
  const before = { pos: st.pos, down: st.down, toGo: st.toGo, quarter: st.quarter, left: st.left };
  const momBefore: [number, number] = [st.mom[0], st.mom[1]];
  const mom = (t: 0 | 1, v: number): void => {
    st.mom[t] = clamp(st.mom[t] + v, 0, MOM_MAX);
  };
  const rush = defPick.type === 'blitz' && !defPick.special;
  const tot = st.totals[o];
  const lines: string[] = [];
  let good = false;
  let dist = FIELD - st.pos;
  let points = 0;
  let turnover: PlayResult['turnover'] = null;
  if (type === 'pat') {
    good = rng.chance(patChance(O) - (rush ? 0.04 : 0));
    if (good) {
      points = PAT_POINTS;
      st.score[o] += points;
      lines.push(`${k.name}のキック、成功！ ${O.short}に${points}点`);
    } else lines.push(`${k.name}のキックは外れた…`);
    st.tfp = false;
    kickoff(st, d);
  } else if (type === 'fg') {
    tot.plays += 1;
    // (in a told story the kick is good)
    const told = !!st.script?.shift()?.kick;
    good = rng.chance(fgChance(st, o) - (rush ? 0.06 : 0)) || told;
    if (good) {
      points = FG_POINTS;
      st.score[o] += points;
      lines.push(`${k.name}の${dist}ヤードのフィールドゴール、成功！ ${O.short}に${points}点`);
      mom(o, 1);
      kickoff(st, d);
    } else {
      turnover = 'miss';
      lines.push(`${k.name}のフィールドゴールは外れた…。${D.short}の攻撃に`);
      mom(d, 1);
      st.poss = d;
      st.pos = clamp(FIELD - before.pos, 8, FIELD - 1);
      st.down = 1;
      st.toGo = Math.min(10, FIELD - st.pos);
    }
  } else {
    tot.plays += 1;
    turnover = 'punt';
    dist = clamp(Math.round(17 + kickFit(k.stats) * 0.2 + rng.normal() * 4 - (rush ? 3 : 0)), 8, 45);
    const spot = before.pos + dist;
    good = true;
    st.poss = d;
    // into the end zone: the ball comes out to the ten
    st.pos = spot >= FIELD ? 10 : clamp(FIELD - spot, 3, FIELD - 1);
    if (spot >= FIELD) dist = FIELD - before.pos;
    st.down = 1;
    st.toGo = Math.min(10, FIELD - st.pos);
    lines.push(`${k.name}のパント、${dist}ヤード。${D.short}は自陣${st.pos}ヤードから`);
  }
  const period = tick(st);
  return {
    n: st.n, off: o, offPick, defPick, before, outcome: 'kick', yards: type === 'punt' ? dist : 0, td: false, firstDown: false, turnover, edge: 'even',
    passer: O.lineup.off.QB, carrier: k.id, defender: D.lineup.def.DL1, offPotency: 0, defPotency: 0,
    momBefore, momAfter: [st.mom[0], st.mom[1]], period, lines,
    kick: { type, good, dist, kicker: k.id }, tfp: type === 'pat' || undefined, points,
  };
}

export function resolvePlay(st: MatchState, offPick: Pick, defPick: Pick): PlayResult {
  if (st.over) throw new Error('the match is over');
  if (isKick(offPick.type)) return resolveKick(st, offPick, defPick);
  if (st.ko) throw new Error('a kickoff comes first');
  const tryPlay = !!st.tfp;
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
    // eleven a side, every other short pass that does not go to the first choice goes to the tight end
    const second = type === 'short' && st.n % 2 && O.lineup.off.TE != null && best !== 'TE' ? 'TE' : other;
    targetPos = rng.chance(0.75) ? best : second;
    if (ok === 'flyLong') targetPos = ownerPos(O, osp!) as OffPos;
  }
  const carrier = isRun(type) ? O.lineup.off.RB : O.lineup.off[targetPos];
  // who can be the one to make the stop: the kinds of defender the play runs into
  const dg = (...roles: Role[]): DefPos[] => roles.flatMap((role) => group<DefPos>(D, role));
  const defPool: Record<OffType, DefPos[]> = {
    inside: dg('DL', 'LB'), outside: dg('LB', 'CB'), short: dg('CB', 'LB'), long: dg('S', 'CB'),
  };
  let defender = D.lineup.def[rng.weighted(defPool[type], (p) => 10 + r(D, p))];
  if (dsp) defender = dsp.owner;

  // quality of the play
  let m = dk && dk !== 'peekDef' ? DEF_SPECIAL_MATCH[dk][type] : MATCH[type][defPick.type as DefType];
  if (ok === 'trick') m = Math.max(m, m + (1.0 - m) * Math.min(1, op));
  let edge: PlayResult['edge'] = m <= -1 ? 'def' : m >= 0.8 ? 'off' : 'even';
  const adv = (offRating(O, type, isRun(type) ? undefined : targetPos) - defRating(D, type)) / ADV_SCALE;
  let q = adv + m + 0.3 * (offPick.star - 1) - 0.3 * (defPick.star - 1) + rng.normal() * SD[type];
  if (tryPlay) q -= TRY_WALL;
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

  // a told story: the play gains what the story says
  const told = st.script?.shift();
  if (told) {
    outcome = 'gain';
    yards = told.td ? FIELD : (told.yards ?? 0);
    edge = 'even';
    roared = false;
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

  let points = 0;
  /** a touchdown is followed by a try: the clock waits for it */
  let tryNext = false;
  const handOver = (spot: number): void => {
    // spot: where the ball is, measured from the old offense's goal line
    st.poss = d;
    st.pos = clamp(FIELD - spot, 8, FIELD - 1);
    st.down = 1;
    st.toGo = Math.min(10, FIELD - st.pos);
    tot.turnovers += 1;
  };

  if (tryPlay) {
    // the try after a touchdown: two points for reaching the end zone, nothing otherwise, and the ball goes over
    tot.plays -= 1;
    if (td) {
      points = TWO_POINTS;
      st.score[o] += points;
      lines.push(`2点ねらい、成功！ ${O.short}に${points}点`);
      mom(o, 1);
    } else {
      lines.push(outcome === 'int' || outcome === 'fumble' ? `${dn}が止めた！ 2点ねらいは失敗` : '2点ねらいは失敗');
      mom(d, 1);
      if (outcome === 'gain') outcome = 'nogain';
    }
    td = false;
    yards = 0;
    st.tfp = false;
    kickoff(st, d);
  } else if (outcome === 'int' || outcome === 'fumble') {
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
      points = TD_POINTS;
      st.score[o] += points;
      tot.td += 1;
      lines.push(`タッチダウン！ ${O.short}に${points}点`);
      mom(o, 2);
      mom(d, -1);
      if (told) {
        // the story ends on this touchdown: no try, the match is over
        delete st.script;
        st.left = 1;
      } else if (st.sudden) kickoff(st, d);
      else {
        // the try for more points comes next, from close in; the clock waits for it
        tryNext = true;
        st.tfp = true;
        st.pos = FIELD - TRY_YARDS;
        st.down = 1;
        st.toGo = TRY_YARDS;
      }
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
  let period: PlayResult['period'] = null;
  if (tryNext) {
    st.n += 1;
    deal(st);
  } else period = tick(st);

  return {
    n: st.n, off: o, offPick, defPick, before, outcome, yards, td, firstDown, turnover, edge,
    passer, carrier, defender, offPotency: op, defPotency: dp,
    momBefore, momAfter: [st.mom[0], st.mom[1]], period, lines, points, tfp: tryPlay || undefined,
  };
}

/**
 * The first match a new club ever plays, told as a story: nobody has been calling the plays and nothing has been scored.
 * With the last play of the third quarter the visitors kick a field goal; then the coach takes over, and the
 * drive that follows ends in the winning touchdown as time runs out. The cards chosen decide how the plays look,
 * not how far they go. `dropStory` turns what is left of it into an ordinary match.
 */
export const FIRST_MATCH: readonly Scripted[] = [{ kick: 'fg' }, { yards: 7 }, { yards: 11 }, { yards: 6 }, { yards: 5 }, { td: true }];
export function createStory(home: TeamSheet, away: TeamSheet, seed: number): MatchState {
  const st = createMatch(home, away, seed);
  st.script = FIRST_MATCH.map((x) => ({ ...x }));
  st.quarter = QUARTERS - 1;
  st.left = 1;
  st.first = 0;
  st.ko = false;
  st.poss = 1;
  st.pos = 32;
  st.down = 4;
  st.toGo = 6;
  deal(st);
  return st;
}
/** Has this story not played a single play yet? */
export const storyFresh = (st: MatchState): boolean => !!st.script && st.n === 0;
/** The rest of the match is played out like any other. */
export function dropStory(st: MatchState): void {
  if (!st.script) return;
  delete st.script;
  if (!st.over) deal(st);
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
    const def = def0.special || off.peeked || isKick(off.type) ? def0 : (autoPeek(st, d, off) ?? def0);
    const res = resolvePlay(st, off, def);
    if (res.period === 'half') for (const t of [0, 1] as const) halftimeTalk(st, t, autoTalk(st, t));
  }
  return st;
}
