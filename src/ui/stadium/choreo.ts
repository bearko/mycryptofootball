// Turns the result of one play into a script: where everybody runs, where the ball is, and the beats
// (snap, hand-off, throw, catch, hit, touchdown) the renderer hangs its camera work and effects on.
//
// Scripts are written in "drive coordinates" like the rules (u = yards from the offense's own goal line,
// v = across the field) and converted to world x/z here: team 0 attacks toward +x, team 1 toward -x.

import { KIND, isKickoff, isRun, type DefType, type KickType, type OffType } from '../../game/cards';
import { FIELD, returnerOf, type Outcome, type PlayResult, type TeamSheet } from '../../game/match';
import { DEF_POS_OF, OFF_POS_OF, defPos, offPos, roleOf, sizeOf, type DefPos, type OffPos, type Size } from '../../game/model';
import { END, WIDTH } from './assets';
import { clamp, lerp } from './math';

export type UV = [number, number];
export interface Ref { team: 0 | 1; id: number }

export interface Key {
  t: number;
  x: number;
  z: number;
  /** arrive at full speed instead of easing into the key */
  hard?: boolean;
}

export interface Plan extends Ref {
  pos: OffPos | DefPos;
  keys: Key[];
  /** owner of a special play called this time */
  star: boolean;
}

export type BallSeg =
  | { t0: number; t1: number; kind: 'held'; team: 0 | 1; id: number }
  | { t0: number; t1: number; kind: 'air'; from: [number, number, number]; to: [number, number, number]; h: number; spiral: boolean }
  | { t0: number; t1: number; kind: 'ground'; at: [number, number, number] };

export type Cue = { t: number } & (
  | { c: 'snap' }
  | { c: 'clash'; at: UV[] }
  | { c: 'handoff' }
  | { c: 'throw'; long: boolean }
  /** the foot meets the ball */
  | { c: 'kick' }
  | { c: 'jump'; who: Ref; h: number; dur: number }
  /** dir: +1 toward the goal the offense attacks */
  | { c: 'dive'; who: Ref; dir: number }
  | { c: 'catch'; who: Ref; long: boolean }
  | { c: 'swat'; x: number; y: number; z: number }
  | { c: 'drop'; x: number; z: number }
  | { c: 'impact'; x: number; z: number; power: number; victim: Ref | null; hitter: Ref | null; back: boolean }
  | { c: 'steal'; who: Ref }
  | { c: 'break' }
  /** the day's duel, a run: the ace steps around the defender who came to stop him (side: which way across the field) */
  | { c: 'juke'; who: Ref; foe: Ref; side: number }
  | { c: 'td'; who: Ref }
  | { c: 'celebrate'; team: 0 | 1 }
  | { c: 'ignite'; who: Ref }
  | { c: 'end' }
);

/** What the picture needs to know about a play (a PlayResult, or something made up for the title screen). */
export interface PlaySpec {
  n: number;
  off: 0 | 1;
  type: OffType;
  call: DefType | undefined;
  outcome: Outcome;
  yards: number;
  td: boolean;
  los: number;
  toGo: number;
  /** which down it was (missing: a made-up play, no sideline sign) */
  down?: number;
  /** the try after a touchdown */
  tfp?: boolean;
  /** a ball taken away (an interception, a fumble) is run all the way back by the defender who took it */
  ret6?: boolean;
  carrier: number;
  defender: number;
  offStar: number | null;
  defStar: number | null;
  /**
   * a kick instead of a play (the kicker is `carrier`, lined up where the running back would be).
   * A kickoff is told from the side that receives it: `off` is the team the ball is kicked to, `los` where it is
   * kicked from (in that team's yards), `carrier` who gets the ball, `defender` who of the kicking team gets to him
   */
  kick?: { type: KickType; good: boolean; dist: number; kicker?: number; ret?: number };
  /**
   * the day's duel is fought on this play (game/duel.ts): the attacking ace, the defender he meets, and who wins.
   * The picture is built around the moment the two meet (Script.tDuel)
   */
  duel?: { ace: number; foe: number; win: boolean };
}

/**
 * What a hero was sent out to do, as the coach drew it: the way the runner means to go, the routes the receivers run.
 * World x,z points. It is the plan, not the result (the runner may never get that far).
 */
export interface Design extends Ref {
  kind: 'run' | 'route' | 'decoy';
  way: [number, number][];
}

/**
 * The route tree: every way a receiver can be sent out. Which ones fit depends on how far downfield the ball is
 * caught (see routesFor).
 */
export type RouteName =
  | 'lookin' | 'hitch' | 'quickout'
  | 'slant' | 'cross' | 'slicein' | 'hook'
  | 'squarein' | 'squareout' | 'post' | 'comeback'
  | 'corner' | 'longpost' | 'zigout' | 'fade' | 'up';
export const ROUTE_LABEL: Record<RouteName, string> = {
  lookin: 'ルックイン', hitch: 'ヒッチ', quickout: 'クイックアウト',
  slant: 'スラント', cross: 'クロス', slicein: 'スライスイン', hook: 'フック',
  squarein: 'スクエアーイン', squareout: 'スクエアーアウト', post: 'ポスト', comeback: 'カムバック',
  corner: 'コーナー', longpost: 'ロングポスト', zigout: 'ジグアウト', fade: 'フェード', up: 'アップ',
};
/** routes that end with the receiver coming back toward the passer (not for a ball caught in the end zone) */
const COMES_BACK: readonly RouteName[] = ['hitch', 'hook', 'comeback'];

/** The routes that fit a catch `depth` yards past the line of scrimmage. */
export function routesFor(long: boolean, depth: number): readonly RouteName[] {
  if (!long) return depth < 3 ? ['lookin', 'hitch', 'quickout'] : ['slant', 'cross', 'slicein', 'hook', 'quickout', 'hitch'];
  if (depth < 15) return ['squarein', 'post', 'squareout', 'comeback', 'hook'];
  return depth < 22 ? ['longpost', 'corner', 'up', 'zigout', 'fade', 'comeback'] : ['up', 'longpost', 'fade', 'zigout', 'corner'];
}

/**
 * A route from the line of scrimmage to the spot `depth` yards downfield: the corners to run through (drive
 * coordinates; the last one is where the ball is caught). `inward` is +1 when the middle of the field lies toward
 * larger v. `room`: how far past the line of scrimmage a hero may run at all (the back of the end zone).
 */
export function routeWay(name: RouteName, los: number, v0: number, depth: number, inward: number, room: number): UV[] {
  const top = los + depth;
  const i = inward;
  /** how far past the spot a hero runs before he turns back */
  const over = (most: number): number => Math.max(0.6, Math.min(most, room - depth));
  switch (name) {
    // at once, diagonally inside, shallow
    case 'lookin': return [[los + Math.min(0.5, depth * 0.3), v0 + i * 0.4], [top, v0 + i * 4.2]];
    // past the spot, stop, and back toward the passer
    case 'hitch': return [[top + over(1.8), v0 + i * 0.2], [top, v0 + i * 1.0]];
    // a lean to the inside, then flat to the sideline
    case 'quickout': return [[top - 0.3, v0 + i * 1.3], [top, v0 - i * 1.5]];
    // a step upfield, then diagonally across the middle
    case 'slant': return [[los + Math.min(2, depth * 0.35), v0 + i * 0.2], [top, v0 + i * 5.6]];
    // flat across the whole formation
    case 'cross': return [[top - 0.3, v0 + i * 0.7], [top, v0 + i * 8.5]];
    // a swing to the outside first, then slicing in behind the defender
    case 'slicein': return [[los + depth * 0.42, v0 - i * 1.3], [los + depth * 0.72, v0 - i * 0.5], [top, v0 + i * 4.8]];
    // deeper, then curling back to the inside
    case 'hook': return [[top + over(2.4), v0 + i * 0.6], [top, v0 + i * 2.3]];
    // straight up, then square in
    case 'squarein': return [[top - 0.4, v0 + i * 0.3], [top, v0 + i * 7]];
    // straight up with a lean inside, then square out
    case 'squareout': return [[top - 0.4, v0 + i * 1.9], [top, v0 - i * 1.5]];
    // up, then angling in toward the goal posts
    case 'post': return [[los + depth * 0.6, v0 + i * 0.3], [top, v0 + i * 5]];
    // past the spot and back out to the sideline
    case 'comeback': return [[top + over(3.2), v0 + i * 0.6], [top, v0 - i * 1.2]];
    // leaning in, then breaking out to the corner
    case 'corner': return [[los + depth * 0.55, v0 + i * 2.8], [top, v0 - i * 1.3]];
    // the deep post: a long stem, then all the way to the middle
    case 'longpost': return [[los + depth * 0.5, v0 + i * 0.3], [top, v0 + i * 7.5]];
    // sold as a post, then back out to the sideline
    case 'zigout': return [[los + depth * 0.5, v0 + i * 0.3], [los + depth * 0.74, v0 + i * 3.6], [top, v0 - i * 1.2]];
    // up the sideline, drifting to the outside shoulder
    case 'fade': return [[los + depth * 0.4, v0 + i * 0.7], [top, v0 - i * 1.0]];
    // straight up
    case 'up': return [[los + depth * 0.5, v0], [top, v0 + i * 0.3]];
  }
}

export interface Script {
  spec: PlaySpec;
  dir: 1 | -1;
  losX: number;
  dur: number;
  snap: number;
  tHand: number;
  tThrow: number;
  tCatch: number;
  /** the hit, the drop, or the moment the scorer stops */
  tEnd: number;
  tTD: number;
  plans: Plan[];
  ball: BallSeg[];
  cues: Cue[];
  /** who the camera follows once the ball is in somebody's hands for good */
  star: Ref;
  pass: boolean;
  long: boolean;
  /** where the play ends, world */
  endX: number;
  endZ: number;
  /** where the pass comes down, world */
  spotX: number;
  spotZ: number;
  /** the play as it was drawn up (empty for a kick) */
  design: Design[];
  /** the route the pass went to (missing for a run, a kick or a sack before the throw) */
  route?: RouteName;
  /** the moment the day's duel is decided: the step around the defender, the hit, the catch (-1: no duel in this play) */
  tDuel: number;
  /** who of the offense is at that moment (the runner, the receiver, the quarterback who is sacked) */
  duelWho: Ref;
}

export function specOf(res: PlayResult): PlaySpec {
  const dsp = res.defPick.special;
  if (res.kick && isKickoff(res.kick.type)) {
    return {
      n: res.n, off: (1 - res.off) as 0 | 1, type: 'long', call: undefined,
      kick: { type: res.kick.type, good: res.kick.good, dist: res.kick.dist, kicker: res.kick.kicker, ret: res.kick.ret },
      // (run all the way back: the receiving team's touchdown)
      outcome: res.outcome, yards: 0, td: !!res.returnTd, los: FIELD - res.before.pos, toGo: 10,
      carrier: res.kick.returner ?? res.carrier, defender: res.defender, offStar: null, defStar: null,
    };
  }
  return {
    n: res.n,
    off: res.off,
    // a kick is filmed like a long pass: the camera follows the ball
    type: res.kick ? 'long' : (res.offPick.type as OffType),
    call: dsp ? (KIND[dsp.kind].base as DefType) : (res.defPick.type as DefType),
    kick: res.kick ? { type: res.kick.type, good: res.kick.good, dist: res.kick.dist } : undefined,
    outcome: res.outcome,
    yards: res.yards,
    td: res.td,
    los: res.before.pos,
    toGo: res.before.toGo,
    down: res.before.down,
    tfp: !!res.tfp,
    ...(res.returnTd ? { ret6: true } : {}),
    carrier: res.carrier,
    defender: res.defender,
    offStar: res.offPick.special ? res.offPick.special.owner : null,
    defStar: dsp ? dsp.owner : null,
  };
}

/**
 * Where everybody lines up. Six a side: two linemen, two receivers out wide. Eleven a side: a line of five with
 * a tight end beside it, a third receiver in the slot; four down linemen, three linebackers, two safeties.
 * (The six-a-side positions keep their places: the other five fill in around them.)
 */
export function formation(los: number, call?: DefType, size: Size = 6): { off: Record<OffPos, UV>; def: Record<DefPos, UV> } {
  const off = {
    OL1: [los - 1.9, 8.5], OL2: [los - 1.9, 15.5], QB: [los - 5, 12], RB: [los - 8.2, 12.8],
    WR1: [los - 1.9, 2.6], WR2: [los - 1.9, 21.4],
  } as Record<OffPos, UV>;
  const def = {
    DL1: [los + 1.9, 8.5], DL2: [los + 1.9, 15.5], LB: [los + 5.6, 12], CB1: [los + 4.6, 3], CB2: [los + 4.6, 21], S: [los + 11, 12],
  } as Record<DefPos, UV>;
  if (call === 'stuff') { def.LB = [los + 3.6, 12]; def.CB1 = [los + 4, 6]; def.CB2 = [los + 4, 18]; def.S = [los + 8, 12]; }
  if (call === 'contain') { def.CB1 = [los + 2.6, 2.4]; def.CB2 = [los + 2.6, 21.6]; def.LB = [los + 5, 12]; }
  if (call === 'zone') { def.CB1 = [los + 5.8, 4.5]; def.CB2 = [los + 5.8, 19.5]; def.LB = [los + 6.6, 12]; }
  if (call === 'deep') { def.CB1 = [los + 9, 4.5]; def.CB2 = [los + 9, 19.5]; def.S = [los + 15, 12]; }
  if (call === 'blitz') { def.LB = [los + 2.4, 12]; def.S = [los + 7, 12]; def.CB1 = [los + 3.2, 4.5]; def.CB2 = [los + 3.2, 19.5]; }
  if (size === 11) {
    // the line closes up around a center, the tight end stands beside it, the third receiver in the slot
    off.OL1 = [los - 1.9, 8.8];
    off.OL3 = [los - 1.9, 10.4];
    off.OL5 = [los - 1.9, 12];
    off.OL4 = [los - 1.9, 13.6];
    off.OL2 = [los - 1.9, 15.2];
    off.TE = [los - 1.9, 16.9];
    off.WR3 = [los - 3, 5.7];
    def.DL1 = [los + 1.9, 8.2];
    def.DL3 = [los + 1.9, 10.8];
    def.DL4 = [los + 1.9, 13.2];
    def.DL2 = [los + 1.9, 15.8];
    // two more linebackers on the wings, the safeties split the deep field
    const lu = def.LB[0];
    def.LB2 = [lu - 0.3, 7.2];
    def.LB3 = [lu - 0.3, 16.8];
    const su = def.S[0];
    def.S = [su, 9.2];
    def.S2 = [su + 0.6, 14.8];
    if (call === 'stuff') { def.LB2 = [los + 3.3, 8.4]; def.LB3 = [los + 3.3, 15.6]; }
    if (call === 'contain') { def.LB2 = [los + 3.4, 5.4]; def.LB3 = [los + 3.4, 18.6]; }
    if (call === 'zone') { def.LB2 = [los + 6.2, 7]; def.LB3 = [los + 6.2, 17]; def.S = [los + 12, 9.4]; def.S2 = [los + 12, 14.6]; }
    if (call === 'deep') { def.S = [los + 15, 8.6]; def.S2 = [los + 15.5, 15.4]; def.LB2 = [los + 6.4, 6.6]; def.LB3 = [los + 6.4, 17.4]; }
    if (call === 'blitz') { def.LB2 = [los + 2.7, 6.6]; def.LB3 = [los + 2.7, 17.4]; }
  }
  // nobody lines up behind the back of an end zone
  for (const p of DEF_POS_OF[size]) def[p][0] = Math.min(def[p][0], FIELD + 3.6);
  for (const p of OFF_POS_OF[size]) off[p][0] = Math.max(off[p][0], -3.8);
  return { off, def };
}

/** World x of a drive position for the team on offense. */
export const worldX = (offense: 0 | 1, u: number): number => (offense === 0 ? u : FIELD - u);

export interface Spot extends Ref { pos: OffPos | DefPos; x: number; z: number; offense: boolean }

/**
 * Where everybody stands for a kickoff, seen from the team that receives it (`recv`; `los`: where the ball is
 * kicked from, in its yards). The kicking team is in a row beside the ball with its kicker behind it; the other
 * team is spread over its own half, its fastest back deep. The heroes are the ones who play on after the kick:
 * the kicking team's defense (its kicker takes the safety's place if he is not one of them), the other team's offense.
 */
export function kickoffForm(teams: [TeamSheet, TeamSheet], recv: 0 | 1, los: number, kicker: number): { team: 0 | 1; id: number; pos: OffPos | DefPos; at: UV; offense: boolean }[] {
  const kt = (1 - recv) as 0 | 1;
  const K = teams[kt];
  const R = teams[recv];
  const out: { team: 0 | 1; id: number; pos: OffPos | DefPos; at: UV; offense: boolean }[] = [];
  const dp = defPos(K.lineup);
  const kp: DefPos = dp.find((p) => K.lineup.def[p] === kicker) ?? 'S';
  const row = dp.filter((p) => p !== kp);
  const left = Math.ceil(row.length / 2);
  row.forEach((p, i) => {
    const onLeft = i < left;
    const n = onLeft ? left : row.length - left;
    const f = n > 1 ? (onLeft ? i : i - left) / (n - 1) : 0.5;
    out.push({ team: kt, id: K.lineup.def[p], pos: p, at: [los + 1.6, onLeft ? lerp(2.4, 9.6, f) : lerp(14.4, 21.6, f)], offense: false });
  });
  out.push({ team: kt, id: kicker, pos: kp, at: [los + 4.6, 12.6], offense: false });
  const op = offPos(R.lineup);
  const back = returnerOf(R).id;
  const line = op.filter((p) => roleOf(p) === 'OL' && R.lineup.off[p] !== back);
  line.forEach((p, i) => {
    out.push({ team: recv, id: R.lineup.off[p], pos: p, at: [los - 11, line.length > 1 ? lerp(line.length > 2 ? 3.6 : 8, line.length > 2 ? 20.4 : 16, i / (line.length - 1)) : 12], offense: true });
  });
  const order = (p: OffPos): number => (roleOf(p) === 'QB' ? 0 : roleOf(p) === 'TE' ? 1 : 2);
  const rest = op.filter((p) => roleOf(p) !== 'OL' && R.lineup.off[p] !== back).sort((a, b) => order(a) - order(b));
  const slots: UV[] = rest.length > 3
    ? [[los - 17, 8.4], [los - 17, 15.6], [13, 5.5], [13, 18.5], [18, 12], [20, 4], [20, 20]]
    : [[los - 17, 12], [14, 5.5], [14, 18.5], [20, 12]];
  rest.forEach((p, i) => out.push({ team: recv, id: R.lineup.off[p], pos: p, at: slots[i % slots.length]!, offense: true }));
  const bp = op.find((p) => R.lineup.off[p] === back) ?? 'RB';
  out.push({ team: recv, id: back, pos: bp, at: [7, 12], offense: true });
  return out;
}

/** `kicker`: line up for a kickoff instead (`offense` is then the team that receives it; see kickoffForm). */
export function lineUp(teams: [TeamSheet, TeamSheet], offense: 0 | 1, los: number, call?: DefType, kicker?: number): Spot[] {
  if (kicker !== undefined) {
    return kickoffForm(teams, offense, los, kicker).map((f) => ({ team: f.team, id: f.id, pos: f.pos, x: worldX(offense, f.at[0]), z: f.at[1], offense: f.offense }));
  }
  const d = (1 - offense) as 0 | 1;
  const f = formation(los, call, sizeOf(teams[offense].lineup));
  const out: Spot[] = [];
  for (const p of offPos(teams[offense].lineup)) out.push({ team: offense, id: teams[offense].lineup.off[p], pos: p, x: worldX(offense, f.off[p][0]), z: f.off[p][1], offense: true });
  for (const p of defPos(teams[d].lineup)) out.push({ team: d, id: teams[d].lineup.def[p], pos: p, x: worldX(offense, f.def[p][0]), z: f.def[p][1], offense: false });
  return out;
}

// ------------------------------------------------------------------ paths

const slope = (keys: Key[], j: number, x: boolean): number => {
  const n = keys.length;
  const k = keys[j]!;
  const v = x ? k.x : k.z;
  if (j === 0) return 0;
  const a = keys[j - 1]!;
  const d0 = ((v - (x ? a.x : a.z)) / Math.max(1e-3, k.t - a.t));
  // a "hard" key is passed at full speed: the body carries on a little before it settles
  if (k.hard) return d0;
  if (j === n - 1) return 0;
  const c = keys[j + 1]!;
  const d1 = (((x ? c.x : c.z) - v) / Math.max(1e-3, c.t - k.t));
  if (d0 * d1 <= 0) return 0;
  const m = (d0 + d1) / 2;
  const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
  return clamp(m, -lim, lim);
};

/** Position on a plan at time t (smooth through the keys, no overshoot). */
export function evalKeys(keys: Key[], t: number, out: { x: number; z: number }): void {
  const n = keys.length;
  const first = keys[0]!;
  const last = keys[n - 1]!;
  if (n === 1 || t <= first.t) {
    out.x = first.x;
    out.z = first.z;
    return;
  }
  if (t >= last.t) {
    out.x = last.x;
    out.z = last.z;
    return;
  }
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1]!.t) i += 1;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const h = Math.max(1e-3, k1.t - k0.t);
  const u = (t - k0.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  out.x = h00 * k0.x + h10 * h * slope(keys, i, true) + h01 * k1.x + h11 * h * slope(keys, i + 1, true);
  out.z = h00 * k0.z + h10 * h * slope(keys, i, false) + h01 * k1.z + h11 * h * slope(keys, i + 1, false);
}

// ------------------------------------------------------------------ the script

/** seconds per yard at a sprint */
const PACE = 0.082;

/**
 * A kickoff: the ball is kicked off the ground, hangs, and comes down to the back who waits for it; he runs it
 * back behind his blockers until somebody of the kicking team gets to him. An onside kick skips along the ground
 * and both teams throw themselves at it.
 */
function buildKickoff(teams: [TeamSheet, TeamSheet], sp: PlaySpec, where: (team: 0 | 1, id: number) => UV | null, fast: boolean): Script {
  const o = sp.off;
  const d = (1 - o) as 0 | 1;
  const dir: 1 | -1 = o === 0 ? 1 : -1;
  const X = (u: number): number => worldX(o, u);
  const los = sp.los;
  const kick = sp.kick!;
  const s = fast ? 0.06 : 0.7;
  const plans: Plan[] = [];
  const uv = new Map<Plan, UV>();
  const go = (p: Plan, t: number, u: number, v: number, hard = false): void => {
    const last = p.keys[p.keys.length - 1]!;
    const key: Key = { t: Math.max(t, last.t + 0.02), x: X(clamp(u, -4.3, FIELD + 4.3)), z: clamp(v, -0.8, WIDTH + 0.8) };
    if (hard) key.hard = true;
    p.keys.push(key);
    uv.set(p, [u, v]);
  };
  const U = (p: Plan): number => uv.get(p)![0];
  const V = (p: Plan): number => uv.get(p)![1];
  const ref = (p: Plan): Ref => ({ team: p.team, id: p.id });
  for (const f of kickoffForm(teams, o, los, kick.kicker ?? teams[d].lineup.def.S)) {
    const w = where(f.team, f.id);
    const p: Plan = { team: f.team, id: f.id, pos: f.pos, star: false, keys: [{ t: 0, x: w ? w[0] : X(f.at[0]), z: w ? w[1] : f.at[1] }] };
    plans.push(p);
    uv.set(p, [f.at[0], f.at[1]]);
    go(p, s * 0.8, f.at[0], f.at[1]);
  }
  const kickers = plans.filter((p) => p.team === d);
  const takers = plans.filter((p) => p.team === o);
  const kp = kickers.find((p) => p.id === kick.kicker) ?? kickers[kickers.length - 1]!;
  const row = kickers.filter((p) => p !== kp);
  const cues: Cue[] = [];
  const ball: BallSeg[] = [];
  const side = (sp.n % 3) - 1;
  const tK = s + 0.75;
  // everybody waits for the foot to meet the ball
  for (const p of plans) if (p !== kp) go(p, tK - 0.08, U(p), V(p));
  go(kp, s, U(kp), V(kp));
  go(kp, tK, los + 0.5, 12, true);
  go(kp, tK + 0.45, los - 1.4, 12.2);
  ball.push({ t0: 0, t1: tK, kind: 'ground', at: [X(los), 0.15, 12] });
  cues.push({ t: s, c: 'snap' });
  cues.push({ t: tK, c: 'kick' });
  let tCatch: number;
  let tEnd: number;
  let tTD = -1;
  let endT: number;
  let endU: number;
  let endV: number;
  let spotU: number;
  let spotV: number;
  let star: Ref;
  if (kick.type === 'onside') {
    // ---- the short kick: two hops along the ground, and a pile on the ball
    const bu = los - kick.dist;
    const bv = 12 + (side || 1) * 3.6;
    const tG = tK + 1.2;
    ball.push({ t0: tK, t1: tK + 0.5, kind: 'air', from: [X(los), 0.2, 12], to: [X(los - kick.dist * 0.6), 0.2, lerp(12, bv, 0.6)], h: 1.3, spiral: false });
    ball.push({ t0: tK + 0.5, t1: tK + 0.9, kind: 'air', from: [X(los - kick.dist * 0.6), 0.2, lerp(12, bv, 0.6)], to: [X(bu), 0.25, bv], h: 0.8, spiral: false });
    ball.push({ t0: tK + 0.9, t1: tG, kind: 'ground', at: [X(bu), 0.25, bv] });
    const near = (list: Plan[]): Plan => [...list].sort((p, q) => Math.abs(V(p) - bv) - Math.abs(V(q) - bv))[0]!;
    const mine = row.find((p) => p.id === sp.defender) ?? near(row);
    const front = takers.filter((p) => U(p) >= los - 12);
    const theirs = takers.find((p) => p.id === sp.carrier) ?? near(front.length ? front : takers);
    const winner = kick.good ? mine : theirs;
    const loser = kick.good ? theirs : mine;
    row.filter((p) => p !== mine).forEach((p, i) => go(p, tG + 0.1, bu + 1.3 + (i % 3) * 0.9, lerp(V(p), bv, 0.62) + (V(p) < bv ? -0.5 : 0.5)));
    front.filter((p) => p !== theirs).forEach((p, i) => go(p, tG + 0.1, bu - 1.3 - (i % 3) * 0.9, lerp(V(p), bv, 0.62) + (V(p) < bv ? -0.5 : 0.5)));
    takers.filter((p) => !front.includes(p) && p !== theirs).forEach((p) => go(p, tG + 0.3, U(p) + 4, V(p)));
    go(winner, tG, bu + (winner.team === d ? 0.2 : -0.2), bv, true);
    go(loser, tG + 0.08, bu + (loser.team === d ? 1.0 : -1.0), bv + 0.7, true);
    go(kp, tG, los - 3, 12.4);
    cues.push({ t: tG - 0.14, c: 'dive', who: ref(winner), dir: winner.team === o ? 1 : -1 });
    cues.push({ t: tG - 0.04, c: 'dive', who: ref(loser), dir: loser.team === o ? 1 : -1 });
    cues.push({ t: tG - 0.02, c: 'clash', at: [[X(bu), bv]] });
    ball.push({ t0: tG, t1: 99, kind: 'held', team: winner.team, id: winner.id });
    if (kick.good) {
      cues.push({ t: tG, c: 'steal', who: ref(winner) });
      cues.push({ t: tG + 0.7, c: 'celebrate', team: d });
    } else cues.push({ t: tG, c: 'catch', who: ref(winner), long: false });
    tCatch = tG;
    tEnd = tG;
    endT = tG + (kick.good ? 1.3 : 0.8);
    endU = bu;
    endV = bv;
    spotU = bu;
    spotV = bv;
    star = ref(winner);
  } else {
    // ---- kicked deep
    const ret = kick.ret ?? 0;
    const back = takers.find((p) => p.id === sp.carrier) ?? takers[takers.length - 1]!;
    const landU = ret > 0 ? los - kick.dist : -2.2;
    const lv = 12 + side * 3.2;
    const tLand = tK + clamp(kick.dist * 0.07, 1.5, 2.2);
    ball.push({ t0: tK, t1: tLand, kind: 'air', from: [X(los), 0.2, 12], to: [X(landU), 1.5, lv], h: 9, spiral: true });
    go(back, tLand - 0.12, landU, lv);
    cues.push({ t: tLand, c: 'catch', who: ref(back), long: false });
    ball.push({ t0: tLand, t1: 99, kind: 'held', team: o, id: back.id });
    const blockers = takers.filter((p) => p !== back);
    endU = landU + ret;
    endV = clamp(lv - side * 1.6 + (sp.n % 2 ? 1.2 : -1.2), 3, 21);
    if (ret > 0 && sp.td) {
      // ---- run all the way back: through the first wave, past the kicker, into the end zone
      endU = FIELD + 2.8;
      const run = clamp((endU - landU) * PACE * 0.95, 1.8, 3.6);
      tEnd = tLand + 0.2 + run;
      const tMid = tLand + 0.2 + run * 0.4;
      const midU = lerp(landU, endU, 0.4);
      const cut = sp.n % 2 ? 1 : -1;
      go(back, tLand + 0.2, landU + 0.3, lv);
      go(back, tMid, midU, lerp(lv, endV, 0.5) + cut * 2.2);
      go(back, tEnd, endU, endV);
      tTD = tMid + (tEnd - tMid) * ((FIELD + 0.4 - midU) / (endU - midU));
      const tackler = row.find((p) => p.id === sp.defender) ?? row[0]!;
      // the kicking team meets him in the middle, and nobody gets a hand on him
      go(tackler, tMid - 0.05, midU + 1.6, lerp(lv, endV, 0.5) + cut * 0.4, true);
      cues.push({ t: tMid - 0.12, c: 'dive', who: ref(tackler), dir: -1 });
      go(tackler, tMid + 0.5, midU + 0.4, lerp(lv, endV, 0.5) - cut * 0.6);
      // (eleven heroes chasing one is no heap: they stay spread across the field, falling further behind)
      row.filter((p) => p !== tackler).forEach((p, i) => {
        go(p, tMid, Math.max(midU + 2.5 + (i % 4) * 2.6, lerp(U(p), midU, 0.5)), lerp(V(p), endV, 0.2));
        go(p, tEnd, endU - 13 - (i % 4) * 3 - Math.floor(i / 4) * 2.5, lerp(V(p), endV, 0.3));
      });
      // the kicker is the last man: he squares up to him, dives, and comes up short
      const tLast = tMid + (tTD - tMid) * 0.55;
      go(kp, tLast, lerp(midU, FIELD, 0.55) - 0.6, lerp(lerp(lv, endV, 0.5) + cut * 2.2, endV, 0.55) - cut * 1.4, true);
      cues.push({ t: tLast - 0.14, c: 'dive', who: ref(kp), dir: -1 });
      blockers.forEach((p, i) => {
        go(p, tLand, Math.max(U(p) - 3, landU + 2), V(p));
        go(p, tMid, midU - 1 - (i % 5) * 2, lerp(V(p), endV, 0.2) + (i % 2 ? 1.6 : -1.6));
        go(p, tEnd, endU - 9 - (i % 5) * 3, lerp(V(p), endV, 0.25) + (i % 2 ? 1.6 : -1.6));
      });
      cues.push({ t: lerp(tLand, tMid, 0.7), c: 'clash', at: [[X(midU - 1), endV - 2.5], [X(midU), endV + 2.5]] });
      cues.push({ t: tMid + 0.05, c: 'break' });
      cues.push({ t: tTD, c: 'td', who: ref(back) });
      cues.push({ t: tEnd + 0.1, c: 'celebrate', team: o });
      endT = Math.max(tTD + 1.5, tEnd + 0.9);
    } else if (ret > 0) {
      const run = clamp(ret * PACE * 1.15, 0.4, 2.4);
      tEnd = tLand + 0.2 + run;
      go(back, tLand + 0.2, landU + 0.3, lv);
      if (ret >= 6) go(back, tLand + 0.2 + run * 0.5, landU + ret * 0.5, lerp(lv, endV, 0.5) + (sp.n % 2 ? 1.5 : -1.5));
      go(back, tEnd, endU - 0.5, endV, true);
      go(back, tEnd + 0.32, endU, endV);
      const tackler = row.find((p) => p.id === sp.defender) ?? row[0]!;
      /** how far down the field a hero of the kicking team can have run by the end */
      const far = (p: Plan): number => U(p) - (tEnd - tK) / PACE * 0.9;
      go(tackler, lerp(tK, tEnd, 0.6), Math.max(lerp(U(tackler), endU + 5, 0.62), far(tackler)), lerp(V(tackler), endV, 0.6));
      go(tackler, tEnd, endU + 0.45, endV, true);
      go(tackler, tEnd + 0.32, endU + 0.9, endV + 0.2);
      row.filter((p) => p !== tackler).forEach((p, i) => go(p, tEnd, Math.max(endU + 3.4 + i * 1.7, far(p)), lerp(V(p), endV, 0.42)));
      blockers.forEach((p, i) => {
        go(p, tLand, Math.max(U(p) - 3, endU + 2), V(p));
        go(p, tEnd, Math.max(endU + 2.5 + (i % 5) * 1.7, Math.min(U(p), endU + 4)), lerp(V(p), endV, 0.3) + (i % 2 ? 0.7 : -0.7));
      });
      if (ret >= 4) cues.push({ t: lerp(tLand, tEnd, 0.6), c: 'clash', at: [[X(endU + 4), endV - 2.5], [X(endU + 5.5), endV + 2.5]] });
      if (ret >= 12) cues.push({ t: tLand + 0.2 + run * 0.45, c: 'break' });
      cues.push({ t: tEnd, c: 'impact', x: X(endU - 0.1), z: endV, power: clamp(0.5 + ret * 0.012, 0.5, 0.8), victim: ref(back), hitter: ref(tackler), back: false });
      endT = tEnd + 0.6;
    } else {
      // into the end zone: he catches it and stays down; nobody needs to hurry
      tEnd = tLand + 0.45;
      endU = landU;
      endV = lv;
      row.forEach((p, i) => go(p, tEnd, 15 + (i % 4) * 2.2, V(p)));
      blockers.forEach((p) => go(p, tEnd, Math.max(U(p) - 2.5, 6), V(p)));
      endT = tEnd + 0.5;
    }
    if (!sp.td) go(kp, tEnd, los - 7, 12.3);
    tCatch = tLand;
    spotU = landU;
    spotV = lv;
    star = ref(back);
  }
  cues.push({ t: endT, c: 'end' });
  cues.sort((p, q) => p.t - q.t);
  return {
    spec: sp, dir, losX: X(los), dur: endT + (fast ? 0.08 : 0.5), snap: s, tHand: -1, tThrow: tK, tCatch, tEnd, tTD, plans, ball, cues, star,
    pass: true, long: true, endX: X(endU), endZ: endV, spotX: X(clamp(spotU, 0, FIELD)), spotZ: spotV, design: [], tDuel: -1, duelWho: star,
  };
}

export function buildScript(
  teams: [TeamSheet, TeamSheet],
  sp: PlaySpec,
  where: (team: 0 | 1, id: number) => UV | null,
  fast: boolean,
): Script {
  if (sp.kick && isKickoff(sp.kick.type)) return buildKickoff(teams, sp, where, fast);
  const o = sp.off;
  const d = (1 - o) as 0 | 1;
  const dir: 1 | -1 = o === 0 ? 1 : -1;
  const X = (u: number): number => worldX(o, u);
  const O = teams[o];
  const D = teams[d];
  const los = sp.los;
  const type = sp.type;
  const size = sizeOf(O.lineup);
  const OFFP = offPos(O.lineup);
  const DEFP = defPos(D.lineup);
  /** the positions of some kinds, in the line-up's order */
  const og = (...roles: string[]): OffPos[] => OFFP.filter((p) => roles.includes(roleOf(p)));
  const dg = (...roles: string[]): DefPos[] => DEFP.filter((p) => roles.includes(roleOf(p)));
  const base = formation(los, undefined, size);
  const called = formation(los, sp.call, size);
  const special = sp.offStar !== null || sp.defStar !== null;
  const s = fast ? 0.06 : special ? 1.02 : 0.62;

  const plans: Plan[] = [];
  const uv = new Map<Plan, UV>();
  const mk = (team: 0 | 1, id: number, pos: OffPos | DefPos, at: UV): Plan => {
    const w = where(team, id);
    const p: Plan = { team, id, pos, star: false, keys: [{ t: 0, x: w ? w[0] : X(at[0]), z: w ? w[1] : at[1] }] };
    plans.push(p);
    uv.set(p, [at[0], at[1]]);
    return p;
  };
  for (const p of OFFP) mk(o, O.lineup.off[p], p, base.off[p]);
  for (const p of DEFP) mk(d, D.lineup.def[p], p, base.def[p]);
  const find = (team: 0 | 1, id: number): Plan => plans.find((p) => p.team === team && p.id === id) ?? plans[team === o ? 0 : OFFP.length]!;
  const a = (pos: OffPos): Plan => find(o, O.lineup.off[pos]);
  const b = (pos: DefPos): Plan => find(d, D.lineup.def[pos]);
  const go = (p: Plan, t: number, u: number, v: number, hard = false): void => {
    const last = p.keys[p.keys.length - 1]!;
    const key: Key = { t: Math.max(t, last.t + 0.02), x: X(clamp(u, -4.3, FIELD + 4.3)), z: clamp(v, -0.8, WIDTH + 0.8) };
    if (hard) key.hard = true;
    p.keys.push(key);
    uv.set(p, [u, v]);
  };
  const U = (p: Plan): number => uv.get(p)![0];
  const V = (p: Plan): number => uv.get(p)![1];
  /** forget everything a plan does after the snap */
  const cut = (p: Plan): void => {
    while (p.keys.length > 1 && p.keys[p.keys.length - 1]!.t > s + 0.001) p.keys.pop();
    const pos = p.pos as DefPos;
    uv.set(p, [called.def[pos][0], called.def[pos][1]]);
  };
  const ref = (p: Plan): Ref => ({ team: p.team, id: p.id });
  /** when a plan first gets past drive position u (looked up on the finished path) */
  const cross = (p: Plan, u: number, t0: number, t1: number): number => {
    const tmp = { x: 0, z: 0 };
    const target = X(u);
    for (let t = t0; t < t1; t += 0.02) {
      evalKeys(p.keys, t, tmp);
      if ((tmp.x - target) * dir >= 0) return t;
    }
    return t1;
  };
  /** how far a chasing defender can have got by time t */
  const reach = (p: Plan, t: number): number => U(p) + Math.max(0, t - s - 0.2) / PACE * 0.92;

  const cues: Cue[] = [];
  const ball: BallSeg[] = [];
  const design: Design[] = [];
  const draw = (pl: Plan, kind: Design['kind'], way: UV[]): void => {
    design.push({ team: pl.team, id: pl.id, kind, way: way.map(([u, v]) => [X(clamp(u, -4.3, FIELD + 4.3)), clamp(v, 0.6, WIDTH - 0.6)] as [number, number]) });
  };

  // before the snap: everybody gets set, the defense shows its call
  for (const p of OFFP) go(a(p), s * 0.72, base.off[p][0], base.off[p][1]);
  for (const p of DEFP) go(b(p), s * 0.86, called.def[p][0], called.def[p][1]);
  for (const p of plans) {
    // hold still until the ball is snapped
    const last = p.keys[p.keys.length - 1]!;
    p.keys.push({ t: s, x: last.x, z: last.z });
  }
  if (sp.offStar !== null) {
    const p = find(o, sp.offStar);
    p.star = true;
    cues.push({ t: 0.1, c: 'ignite', who: ref(p) });
  }
  if (sp.defStar !== null) {
    const p = find(d, sp.defStar);
    p.star = true;
    cues.push({ t: sp.offStar !== null ? 0.3 : 0.1, c: 'ignite', who: ref(p) });
  }
  cues.push({ t: s, c: 'snap' });

  // the two lines push each other
  const push = sp.outcome === 'gain' ? clamp(sp.yards * 0.3, 0.3, 1.8) : -0.9;
  // (on a run the tight end blocks with the line; on a pass he goes out for the ball)
  for (const p of og('OL', ...(isRun(type) || sp.kick ? ['TE'] : []))) {
    const pl = a(p);
    const [u, v] = base.off[p];
    go(pl, s + 0.26, u + 0.95, v);
    go(pl, s + 1.0, u + 0.9 + push, v + (v < 12 ? -0.3 : 0.3));
  }
  for (const p of dg('DL')) {
    const pl = b(p);
    const [u, v] = called.def[p];
    go(pl, s + 0.26, u - 0.95, v);
    go(pl, s + 1.0, u - 0.9 + push, v + (v < 12 ? -0.3 : 0.3));
  }
  cues.push({ t: s + 0.25, c: 'clash', at: size === 11 ? [[X(los), 8.5], [X(los), 12], [X(los), 15.5]] : [[X(los), 8.5], [X(los), 15.5]] });

  const qb = a('QB');
  const rb = a('RB');
  const defender = find(d, sp.defender);
  const carrier = find(o, sp.carrier);
  const end = los + sp.yards;
  let tHand = -1;
  let tThrow = -1;
  let tCatch = -1;
  let tEnd = s + 1;
  let tTD = -1;
  let endT = s + 2;
  let star: Ref = ref(carrier);
  let endU = end;
  let endV = 12;
  let spotU = end;
  let spotV = 12;
  let route: RouteName | undefined;
  /** the day's duel: the defender is the one the ace meets, and the play has a moment of its own */
  const duel = sp.duel && sp.duel.foe === sp.defender ? sp.duel : null;
  let tDuel = -1;
  let duelWho: Ref = ref(carrier);
  const moved = new Set<Plan>();
  /** the earliest the tackler can be at a spot without flying there */
  const needT = (u: number, v: number): number => {
    const from = called.def[defender.pos as DefPos] ?? [los + 5, 12];
    return s + 0.18 + Math.hypot(from[0] - u, from[1] - v) / 15;
  };
  /**
   * The defender who has taken the ball away runs it all the way back the other way, from (u0, v0) at t0: the offense
   * turns and chases, and the quarterback, the last one with a chance, dives and comes up short.
   */
  const runBack = (u0: number, v0: number, t0: number): { tEnd: number; tTD: number; endT: number; v: number } => {
    const goalU = -2.8;
    const v = clamp(v0 + (v0 < 12 ? 3 : -3), 3, WIDTH - 3);
    const run = clamp((u0 - goalU) * PACE * 0.95, 1.2, 3.6);
    const t1 = t0 + run;
    go(defender, t0, u0 - 0.6, v0);
    go(defender, t0 + run * 0.5, lerp(u0, goalU, 0.5), lerp(v0, v, 0.6));
    go(defender, t1, goalU, v);
    const tGoal = t0 + run * ((u0 - 0.4) / (u0 - goalU));
    go(qb, tGoal - 0.1, 2.4, v + (v < 12 ? 1.5 : -1.5), true);
    cues.push({ t: tGoal - 0.22, c: 'dive', who: ref(qb), dir: -1 });
    cues.push({ t: t0 + run * 0.3, c: 'break' });
    cues.push({ t: tGoal, c: 'td', who: ref(defender) });
    cues.push({ t: t1 + 0.1, c: 'celebrate', team: d });
    return { tEnd: t1, tTD: tGoal, endT: Math.max(tGoal + 1.5, t1 + 0.9), v };
  };

  if (sp.kick) {
    // ---- a kick: the quarterback holds for a place kick, the kicker (in the running back's spot) swings through
    const k = rb;
    const punt = sp.kick.type === 'punt';
    const holdU = los - 6.2;
    const tK = s + (punt ? 1.0 : 0.9);
    const dur = punt ? 1.7 : 1.4;
    const tLand = tK + dur;
    const side = ((sp.n % 3) - 1);
    let from: [number, number, number];
    if (punt) {
      go(qb, s + 0.4, los - 2.2, 10.2);
      go(k, s + 0.3, los - 9.5, 12);
      go(k, tK, los - 8.4, 12, true);
      go(k, tK + 0.5, los - 7.6, 12.2);
      ball.push({ t0: 0, t1: tK, kind: 'held', team: o, id: k.id });
      from = [X(los - 8), 1.1, 12];
    } else {
      go(qb, s + 0.28, holdU, 12.8);
      go(k, s + 0.3, holdU - 2.8, 10.9);
      go(k, tK, holdU - 0.5, 12, true);
      go(k, tK + 0.45, holdU + 0.9, 12.3);
      ball.push({ t0: 0, t1: s + 0.3, kind: 'held', team: o, id: qb.id });
      ball.push({ t0: s + 0.3, t1: tK, kind: 'ground', at: [X(holdU + 0.45), 0.15, 12.1] });
      from = [X(holdU + 0.45), 0.2, 12.1];
    }
    cues.push({ t: tK, c: 'kick' });
    // the rush comes anyway, and somebody leaps at the ball
    for (const p of dg('DL')) go(b(p), tK + 0.1, los - 3.2, called.def[p][1] + (called.def[p][1] < 12 ? 0.8 : -0.8), true);
    cues.push({ t: tK - 0.05, c: 'jump', who: ref(b('DL1')), h: 0.9, dur: 0.5 });
    const goalU = FIELD + END + 0.1;
    let landU: number;
    let landV: number;
    if (punt) {
      landU = Math.min(los + sp.kick.dist, FIELD + 2.5);
      landV = 12 + side * 4;
      const deep = b('S');
      go(deep, tLand - 0.1, Math.min(landU + 0.4, FIELD + 3.5), landV);
      moved.add(deep);
      ball.push({ t0: tK, t1: tLand, kind: 'air', from, to: [X(landU), 1.6, landV], h: 10, spiral: true });
      if (landU < FIELD) {
        ball.push({ t0: tLand, t1: 99, kind: 'held', team: d, id: deep.id });
        cues.push({ t: tLand, c: 'catch', who: ref(deep), long: true });
      } else ball.push({ t0: tLand, t1: 99, kind: 'ground', at: [X(landU), 0.2, landV] });
    } else if (sp.kick.good) {
      landU = goalU + 3.5;
      landV = 12 + side * 1.3;
      // through the uprights, then down behind them
      ball.push({ t0: tK, t1: tLand, kind: 'air', from, to: [X(goalU), 6.2, landV], h: 5.5, spiral: false });
      ball.push({ t0: tLand, t1: tLand + 0.5, kind: 'air', from: [X(goalU), 6.2, landV], to: [X(landU), 0.2, landV], h: 0.4, spiral: false });
      ball.push({ t0: tLand + 0.5, t1: 99, kind: 'ground', at: [X(landU), 0.2, landV] });
      cues.push({ t: tLand + 0.05, c: 'celebrate', team: o });
    } else if (sp.n % 2) {
      // wide of the post
      landU = goalU + 2.5;
      landV = 12 + (side || 1) * 5.6;
      ball.push({ t0: tK, t1: tLand, kind: 'air', from, to: [X(goalU), 5.2, landV], h: 5.5, spiral: false });
      ball.push({ t0: tLand, t1: tLand + 0.45, kind: 'air', from: [X(goalU), 5.2, landV], to: [X(landU), 0.2, landV], h: 0.3, spiral: false });
      ball.push({ t0: tLand + 0.45, t1: 99, kind: 'ground', at: [X(landU), 0.2, landV] });
      cues.push({ t: tLand + 0.45, c: 'drop', x: X(landU), z: landV });
    } else {
      // short: it comes down in front of the bar
      landU = goalU - 3.2;
      landV = 12 + side * 1.5;
      ball.push({ t0: tK, t1: tLand, kind: 'air', from, to: [X(landU), 0.2, landV], h: 6.5, spiral: false });
      ball.push({ t0: tLand, t1: 99, kind: 'ground', at: [X(landU), 0.2, landV] });
      cues.push({ t: tLand, c: 'drop', x: X(landU), z: landV });
    }
    tThrow = tK;
    tCatch = tLand;
    tEnd = tLand;
    endT = tLand + (sp.kick.good && !punt ? 1.1 : 0.8);
    endU = clamp(landU, 0, FIELD + 4);
    endV = landV;
    spotU = endU;
    spotV = landV;
    star = ref(k);
  } else if (isRun(type)) {
    const inside = type === 'inside';
    const edge = sp.n % 2 ? 4.4 : 19.6;
    const lane = inside ? 12 + ((sp.n % 3) - 1) * 0.8 : edge;
    const fumble = sp.outcome === 'fumble';
    const stopU = sp.td ? FIELD + 2.8 : fumble ? Math.min(los + 1.2, FIELD - 0.5) : end;
    const back = !sp.td && sp.yards <= 1;
    // where the runner is when he is hit; he then falls to the spot the rules gave
    const hitU = sp.td ? stopU : back ? stopU + 0.7 : stopU - 0.6;
    tHand = s + (inside ? 0.34 : 0.3);
    // the run as drawn up: through the hole and on, as far as the goal line allows
    // (in the day's duel the ace sees his way all the way to the goal line)
    const far = duel && duel.ace === rb.id ? FIELD + 1.5 : 0;
    if (inside) draw(rb, 'run', [base.off.RB, [los - 5.4, 12.2], [los - 0.8, lane], [far || Math.min(los + 9, FIELD + 2), lane]]);
    else draw(rb, 'run', [base.off.RB, [los - 7.7, lerp(12.8, lane, 0.3)], [los - 3.6, lane], [far || Math.min(los + 11, FIELD + 2), lane + (lane < 12 ? 0.9 : -0.9)]]);
    go(qb, s + 0.3, los - 5.9, inside ? 12.5 : 12 + (lane < 12 ? -0.9 : 0.9));
    go(qb, s + 1.2, los - 5.5, 12.4);
    let fromU: number;
    let tA: number;
    if (inside) {
      go(rb, tHand, los - 5.4, 12.2);
      fromU = los - 0.8;
      if (hitU > fromU + 0.5) {
        tA = s + 0.7;
        go(rb, tA, fromU, lane);
        tEnd = tA + clamp((hitU - fromU) * PACE, 0.26, 2.7);
      } else {
        tA = tHand;
        fromU = los - 5.4;
        tEnd = s + 0.8;
      }
      if (!sp.td) tEnd = Math.max(tEnd, needT(hitU + 0.85, lane));
      go(rb, tEnd, hitU, lane, !sp.td);
    } else {
      go(rb, tHand, los - 7.7, lerp(12.8, lane, 0.3));
      fromU = los - 3.6;
      if (hitU > fromU + 0.5) {
        tA = s + 0.95;
        go(rb, tA, fromU, lane);
        tEnd = tA + clamp((hitU - fromU) * PACE, 0.3, 2.9);
        if (!sp.td) tEnd = Math.max(tEnd, needT(hitU + 0.85, lane));
        go(rb, tEnd, hitU, lane + (lane < 12 ? 0.9 : -0.9), !sp.td);
      } else {
        tA = tHand;
        fromU = los - 7.7;
        tEnd = Math.max(s + 0.98, needT(hitU + 0.85, lane));
        go(rb, tEnd, hitU, lerp(12.8, lane, 0.85), true);
      }
    }
    const tAt = (u: number): number => cross(rb, u, tA, tEnd);
    ball.push({ t0: 0, t1: tHand - (inside ? 0 : 0.14), kind: 'held', team: o, id: qb.id });
    if (!inside) {
      // a short pitch
      const from = { x: 0, z: 0 };
      const to = { x: 0, z: 0 };
      evalKeys(qb.keys, tHand - 0.14, from);
      evalKeys(rb.keys, tHand + 0.04, to);
      ball.push({ t0: tHand - 0.14, t1: tHand + 0.04, kind: 'air', from: [from.x, 1.3, from.z], to: [to.x, 1.3, to.z], h: 0.5, spiral: false });
    }
    cues.push({ t: tHand, c: 'handoff' });
    for (const p of og('WR')) {
      const pl = a(p);
      const [u, v] = base.off[p];
      go(pl, s + 0.9, u + 3.5, v);
      go(pl, Math.max(tEnd, s + 1.2), u + 4 + clamp(sp.yards, 0, 14) * 0.35, v);
    }
    cut(defender);
    moved.add(defender);
    const lz = V(rb);
    // ---- the day's duel, won by the runner: the defender comes up to meet him, and he steps around him. The
    // defender is turned round (and brings him down from behind in the end), or dives at nothing when it is a score
    let juked = false;
    if (duel?.win && !fumble && duel.ace === rb.id) {
      const tFin = sp.td ? tAt(FIELD + 0.4) : tEnd;
      const at = { x: 0, z: 0 };
      const uOf = (x: number): number => (x - X(0)) * dir;
      let tJ = tA + (tFin - tA) * 0.34;
      evalKeys(rb.keys, tJ, at);
      // the defender has to be able to get there
      const need = needT(uOf(at.x) + 0.6, at.z);
      if (need > tJ) {
        tJ = need;
        evalKeys(rb.keys, tJ, at);
      }
      if (tJ > tA + 0.12 && tFin - tJ >= (sp.td ? 0.3 : 0.8)) {
        juked = true;
        const uJ = uOf(at.x);
        const zJ = at.z;
        const side = Math.abs(zJ - 12) < 1.5 ? (sp.n % 2 ? 1 : -1) : zJ < 12 ? 1 : -1;
        // the step: plant, cut across, and back onto the way
        const pre = { x: 0, z: 0 };
        const post = { x: 0, z: 0 };
        evalKeys(rb.keys, tJ - 0.16, pre);
        evalKeys(rb.keys, tJ + 0.24, post);
        const weave: Key[] = [
          { t: tJ - 0.16, x: pre.x, z: pre.z },
          { t: tJ, x: at.x, z: clamp(zJ + side * 1.7, 0.6, WIDTH - 0.6), hard: true },
          { t: tJ + 0.24, x: post.x, z: clamp(post.z + side * 1.0, 0.6, WIDTH - 0.6), hard: true },
        ];
        rb.keys = [...rb.keys.filter((k) => k.t < tJ - 0.17 || k.t > tJ + 0.25), ...weave].sort((p, q) => p.t - q.t);
        go(defender, Math.max(s + 0.1, tJ - 0.3), uJ + 2.6, zJ);
        go(defender, tJ, uJ + 0.55, zJ, true);
        go(defender, tJ + (sp.td ? 0.3 : 0.16), uJ + (sp.td ? 0.2 : 0.9), zJ - side * 0.4);
        cues.push({ t: tJ, c: 'juke', who: ref(rb), foe: ref(defender), side });
        if (sp.td) cues.push({ t: tJ - 0.04, c: 'dive', who: ref(defender), dir: -1 });
        tDuel = tJ;
      }
    }
    if (duel && tDuel < 0 && !sp.td) tDuel = tEnd;
    duelWho = ref(rb);
    if (sp.td) {
      tTD = tAt(FIELD + 0.4);
      const du = Math.min(FIELD - 0.8, reach(defender, tTD));
      if (!juked) {
        go(defender, tTD, du, lz + (lz < 12 ? 1.6 : -1.6), true);
        if (du > FIELD - 3.5) cues.push({ t: tTD - 0.08, c: 'dive', who: ref(defender), dir: 1 });
      }
      cues.push({ t: tTD, c: 'td', who: ref(rb) });
      cues.push({ t: tEnd + 0.1, c: 'celebrate', team: o });
      ball.push({ t0: tHand + (inside ? 0 : 0.04), t1: 99, kind: 'held', team: o, id: rb.id });
      endT = Math.max(tTD + 1.5, tEnd + 0.9);
    } else {
      if (juked) {
        // turned round, he runs the ace down from behind
        go(defender, tEnd, hitU - 0.8, lz, true);
      } else {
        go(defender, s + 0.22 + (tEnd - s - 0.22) * 0.62, lerp(U(defender), hitU + 2.6, 0.6), lerp(V(defender), lz, 0.7));
        go(defender, tEnd, hitU + 0.85, lz, true);
      }
      if (fumble) {
        const lu = hitU + 1.7;
        const lv = lz + (lz < 12 ? 1.3 : -1.3);
        go(rb, tEnd + 0.32, stopU, lz);
        go(defender, tEnd + 0.5, lu - 0.2, lv, true);
        cues.push({ t: tEnd, c: 'impact', x: X(hitU), z: lz, power: 0.9, victim: ref(rb), hitter: ref(defender), back: true });
        ball.push({ t0: tHand + (inside ? 0 : 0.04), t1: tEnd, kind: 'held', team: o, id: rb.id });
        ball.push({ t0: tEnd, t1: tEnd + 0.5, kind: 'air', from: [X(hitU), 1.4, lz], to: [X(lu), 0.25, lv], h: 2.4, spiral: false });
        ball.push({ t0: tEnd + 0.5, t1: 99, kind: 'held', team: d, id: defender.id });
        cues.push({ t: tEnd + 0.42, c: 'dive', who: ref(defender), dir: 1 });
        cues.push({ t: tEnd + 0.5, c: 'steal', who: ref(defender) });
        star = ref(defender);
        if (sp.ret6) {
          // scooped up on the run, and taken all the way back the other way
          const back6 = runBack(lu - 0.2, lv, tEnd + 0.7);
          tEnd = back6.tEnd;
          tTD = back6.tTD;
          endT = back6.endT;
          endU = -2.8;
          endV = back6.v;
        } else {
          cues.push({ t: tEnd + 1.05, c: 'celebrate', team: d });
          endT = tEnd + 1.25;
          endU = lu;
          endV = lv;
        }
      } else {
        go(rb, tEnd + 0.32, stopU, lz);
        go(defender, tEnd + 0.32, juked ? stopU - 0.7 : stopU + 0.9, lz + 0.2);
        const power = clamp((back ? 0.82 : 0.55 + Math.min(0.25, sp.yards * 0.012)) + (sp.defStar !== null ? 0.15 : 0), 0.3, 1);
        cues.push({ t: tEnd, c: 'impact', x: X(hitU + 0.4), z: lz, power, victim: ref(rb), hitter: ref(defender), back });
        ball.push({ t0: tHand + (inside ? 0 : 0.04), t1: 99, kind: 'held', team: o, id: rb.id });
        endT = tEnd + 0.55;
      }
    }
    if (sp.yards >= 12) cues.push({ t: tAt(los + 4), c: 'break' });
    if (!fumble) {
      endU = stopU;
      endV = lz;
    }
    spotU = endU;
    spotV = endV;
    star = fumble ? star : ref(rb);
  } else {
    const long = type === 'long';
    const sack = sp.outcome === 'sack';
    const int = sp.outcome === 'int';
    const caught = sp.outcome === 'gain' || sp.outcome === 'nogain' || sp.outcome === 'loss';
    const deep = long ? 18 : 5;
    const targets = og('WR', 'TE');
    const recvPos: OffPos = targets.includes(carrier.pos as OffPos) ? (carrier.pos as OffPos) : 'WR1';
    const recv = a(recvPos);
    /** everybody else who goes out for a pass (six a side: the one other receiver) */
    const others = targets.filter((p) => p !== recvPos).map((p) => a(p));
    const rv0 = base.off[recvPos][1];
    const inward = rv0 < 12 ? 1 : -1;
    const maxDepth = FIELD - los + 2.6;
    let depth: number;
    if (caught) {
      depth = long ? clamp(sp.yards * 0.84, 7, 32) : clamp(Math.min(sp.yards, 5), 1, 9);
      if (sp.td && FIELD - los <= depth + 1.5) depth = FIELD - los + 2.2;
    } else if (int) depth = deep + 2;
    else depth = deep + (long ? 3 : 1);
    depth = clamp(depth, 1, maxDepth);
    // which route: it changes from play to play, and the two receivers never run the same one
    // a ball caught in the end zone is not one to come back for
    const noBack = sp.td && los + depth >= FIELD - 0.5;
    const menu = routesFor(long, depth).filter((r) => !noBack || !COMES_BACK.includes(r));
    const pickAt = Math.abs(sp.n * 7 + sp.carrier * 3 + Math.round(los) * 5 + (recvPos === 'WR1' ? 0 : 2));
    const routeName = menu[pickAt % menu.length]!;
    const way = routeWay(routeName, los, rv0, depth, inward, maxDepth);
    const rv = clamp(way[way.length - 1]![1], 1, WIDTH - 1);
    way[way.length - 1]![1] = rv;
    route = routeName;
    spotU = los + depth;
    spotV = rv;
    const dropU = sack ? end + 0.7 : long ? los - 8.6 : los - 7.2;
    const tDrop = s + (long ? 0.8 : 0.55);
    tThrow = s + (long ? 1.12 : 0.8);
    const flight = long ? clamp(0.72 + depth * 0.023, 0.95, 1.45) : 0.5;
    tCatch = tThrow + flight;

    go(rb, s + 0.45, los - 5.2, 15.2);
    go(rb, s + 1.4, los - 4.9, 15.4);
    /** runs a hero through the corners of a route, at an even pace, to arrive at the last one at time t1 */
    const runRoute = (pl: Plan, from: UV, corners: UV[], t1: number, upTo: number): void => {
      let total = 0;
      let at = from;
      const lens = corners.map((c) => {
        const l = Math.hypot(c[0] - at[0], c[1] - at[1]);
        at = c;
        total += l;
        return l;
      });
      let run = 0;
      for (let i = 0; i < upTo; i += 1) {
        run += lens[i]!;
        go(pl, s + (t1 - s) * (run / Math.max(0.1, total)), corners[i]![0], corners[i]![1]);
      }
    };
    others.forEach((other, k) => {
      // every other receiver runs a route of his own (it takes his defender with him)
      const [u, v] = base.off[other.pos as OffPos];
      const inw = v < 12 ? 1 : -1;
      const n2 = sp.n + k;
      const d2 = Math.max(1, Math.min(long ? (n2 % 2 ? 17 : 12) : n2 % 3 ? 5.5 : 2.5, maxDepth - 1.5));
      const menu2 = routesFor(long, d2).filter((r) => r !== routeName);
      const w2 = routeWay(menu2[(pickAt + sp.n + k * 2) % menu2.length]!, los, v, d2, inw, maxDepth);
      for (const c of w2) c[1] = clamp(c[1], 1, WIDTH - 1);
      runRoute(other, [u, v], w2, tCatch + 0.25, w2.length);
      draw(other, 'decoy', [[u, v], ...w2]);
    });
    // the receiver the ball goes to: every corner but the last, which the outcome decides below
    runRoute(recv, base.off[recvPos], way, tCatch, way.length - 1);
    draw(recv, 'route', [base.off[recvPos], ...way]);
    if (sp.call === 'blitz' && b('LB') !== defender) {
      const lb = b('LB');
      go(lb, s + 0.75, los - 2.4, 12.6 + (sp.n % 2 ? 1.5 : -1.5));
      moved.add(lb);
    }
    // each of them is covered: the corners on the wide receivers, linebackers on the slot and the tight end
    const COVER: Partial<Record<OffPos, DefPos>> = { WR1: 'CB1', WR2: 'CB2', WR3: 'LB2', TE: 'LB3' };
    for (const other of others) {
      const cb = b(COVER[other.pos as OffPos]!);
      if (cb !== defender && !moved.has(cb)) {
        go(cb, tCatch + 0.25, U(other) + 1.4, V(other) + (V(other) < 12 ? 0.8 : -0.8));
        moved.add(cb);
      }
    }
    cut(defender);
    moved.add(defender);

    if (sack) {
      const tSack = Math.max(s + (long ? 1.1 : 0.92), needT(dropU + 0.75, 12.3));
      go(qb, tDrop, dropU, 12);
      go(qb, tSack, dropU - 0.2, 12.1);
      go(qb, tSack + 0.32, end, 12.2);
      go(recv, tCatch, spotU, rv);
      go(defender, s + (tSack - s) * 0.42, lerp(U(defender), dropU, 0.45), lerp(V(defender), 12.6, 0.5));
      go(defender, tSack, dropU + 0.75, 12.3, true);
      go(defender, tSack + 0.32, end + 0.8, 12.4);
      ball.push({ t0: 0, t1: 99, kind: 'held', team: o, id: qb.id });
      cues.push({ t: tSack, c: 'impact', x: X(dropU + 0.3), z: 12.2, power: 0.95, victim: ref(qb), hitter: ref(defender), back: true });
      tEnd = tSack;
      if (duel) {
        tDuel = tSack;
        duelWho = ref(qb);
      }
      tThrow = -1;
      tCatch = -1;
      route = undefined;
      endT = tSack + 0.75;
      endU = end;
      endV = 12.2;
      star = ref(qb);
    } else {
      go(qb, tDrop, dropU, 12);
      go(qb, tThrow, dropU - 0.1, 12);
      go(qb, tThrow + 0.25, dropU + 0.8, 12);
      go(recv, tCatch, spotU, rv, caught);
      if (duel) {
        tDuel = tCatch;
        duelWho = ref(recv);
      }
      const handX = X(dropU + 0.5);
      ball.push({ t0: 0, t1: tThrow, kind: 'held', team: o, id: qb.id });
      cues.push({ t: tThrow - 0.16, c: 'jump', who: ref(qb), h: 0.35, dur: 0.3 });
      cues.push({ t: tThrow, c: 'throw', long });
      const arc = long ? clamp(4.5 + depth * 0.22, 6, 11) : 2.4;
      if (caught) {
        const jumpH = long ? 1.1 : 0.55;
        ball.push({ t0: tThrow, t1: tCatch, kind: 'air', from: [handX, 2.1, 12], to: [X(spotU), 1.6 + jumpH, rv], h: arc, spiral: true });
        ball.push({ t0: tCatch, t1: 99, kind: 'held', team: o, id: recv.id });
        cues.push({ t: tCatch - 0.2, c: 'jump', who: ref(recv), h: jumpH, dur: 0.42 });
        cues.push({ t: tCatch, c: 'catch', who: ref(recv), long });
        // (the day's duel: the defender goes up for it too)
        if (duel) cues.push({ t: tCatch - 0.2, c: 'jump', who: ref(defender), h: jumpH * 0.8, dur: 0.42 });
        const stopU = sp.td ? Math.max(FIELD + 2.8, spotU + 0.7) : end;
        const rac = stopU - spotU;
        const back = !sp.td && rac < 1;
        const hitU = sp.td ? stopU : back ? stopU + 0.6 : stopU - 0.6;
        const rvEnd = rv + inward * (rac > 6 ? 1.4 : 0.4);
        go(defender, s + (tCatch - s) * 0.6, los + depth * 0.6 + 2.6, lerp(V(defender), rv, 0.6));
        go(defender, tCatch, spotU + 1.7, rv + inward * 0.9);
        if (sp.td && spotU >= FIELD) {
          tTD = tCatch + 0.08;
          tEnd = tCatch + 0.55;
          go(recv, tEnd, spotU + 0.8, rv);
          go(defender, tEnd, spotU + 1.2, rv + inward * 1.6);
        } else if (rac > 0.9) {
          tEnd = tCatch + clamp((hitU - spotU) * (PACE + 0.006), 0.3, 2.5);
          go(recv, tEnd, hitU, rvEnd, !sp.td);
          if (sp.td) {
            tTD = cross(recv, FIELD + 0.4, tCatch, tEnd);
            const du = Math.min(FIELD - 0.8, spotU + 1.7 + (tTD - tCatch) / PACE * 0.9);
            go(defender, tTD, du, rvEnd - inward * 1.6, true);
            if (du > FIELD - 3.5) cues.push({ t: tTD - 0.08, c: 'dive', who: ref(defender), dir: 1 });
          } else {
            go(defender, tEnd, hitU + 0.85, rvEnd, true);
          }
          if (rac >= 9) cues.push({ t: tCatch + 0.3, c: 'break' });
        } else {
          tEnd = tCatch + 0.3;
          go(recv, tEnd, hitU, rv, true);
          go(defender, tEnd, hitU + 0.85, rv, true);
        }
        if (sp.td) {
          cues.push({ t: tTD, c: 'td', who: ref(recv) });
          cues.push({ t: tEnd + 0.1, c: 'celebrate', team: o });
          endT = Math.max(tTD + 1.5, tEnd + 0.9);
        } else {
          go(recv, tEnd + 0.32, stopU, V(recv));
          go(defender, tEnd + 0.32, stopU + 0.9, V(recv) + 0.2);
          const power = clamp((back ? 0.75 : 0.5 + Math.min(0.3, rac * 0.02)) + (sp.defStar !== null ? 0.15 : 0), 0.3, 1);
          cues.push({ t: tEnd, c: 'impact', x: X(hitU + 0.4), z: V(recv), power, victim: ref(recv), hitter: ref(defender), back });
          endT = tEnd + 0.55;
        }
        endU = stopU;
        endV = V(recv);
        star = ref(recv);
      } else if (int && sp.ret6) {
        // ---- picked off and run all the way back the other way
        go(defender, s + (tCatch - s) * 0.6, los + depth * 0.6 + 2.4, lerp(V(defender), rv, 0.6));
        go(defender, tCatch, spotU - 0.7, rv);
        ball.push({ t0: tThrow, t1: tCatch, kind: 'air', from: [handX, 2.1, 12], to: [X(spotU - 0.7), 2.7, rv], h: arc, spiral: true });
        ball.push({ t0: tCatch, t1: 99, kind: 'held', team: d, id: defender.id });
        cues.push({ t: tCatch - 0.22, c: 'jump', who: ref(defender), h: 1.2, dur: 0.46 });
        cues.push({ t: tCatch, c: 'steal', who: ref(defender) });
        go(recv, tCatch + 0.2, spotU + 0.5, rv - inward * 0.4);
        const back6 = runBack(spotU - 0.7, rv, tCatch + 0.15);
        go(recv, back6.tEnd, 5, lerp(rv, back6.v, 0.7));
        tEnd = back6.tEnd;
        tTD = back6.tTD;
        endT = back6.endT;
        endU = -2.8;
        endV = back6.v;
        star = ref(defender);
      } else if (int) {
        const backU = spotU - 2.2;
        go(defender, s + (tCatch - s) * 0.6, los + depth * 0.6 + 2.4, lerp(V(defender), rv, 0.6));
        go(defender, tCatch, spotU - 0.7, rv);
        go(defender, tCatch + 0.8, backU, rv + inward * 1.3, true);
        go(recv, tCatch + 0.2, spotU + 0.5, rv - inward * 0.4);
        go(recv, tCatch + 0.8, backU + 0.8, rv + inward * 1.1, true);
        ball.push({ t0: tThrow, t1: tCatch, kind: 'air', from: [handX, 2.1, 12], to: [X(spotU - 0.7), 2.7, rv], h: arc, spiral: true });
        ball.push({ t0: tCatch, t1: 99, kind: 'held', team: d, id: defender.id });
        cues.push({ t: tCatch - 0.22, c: 'jump', who: ref(defender), h: 1.2, dur: 0.46 });
        cues.push({ t: tCatch, c: 'steal', who: ref(defender) });
        tEnd = tCatch + 0.8;
        cues.push({ t: tEnd, c: 'impact', x: X(backU + 0.3), z: rv + inward * 1.2, power: 0.5, victim: ref(defender), hitter: ref(recv), back: true });
        cues.push({ t: tEnd + 0.75, c: 'celebrate', team: d });
        endT = tEnd + 0.9;
        endU = backU;
        endV = rv + inward * 1.3;
        star = ref(defender);
      } else {
        const swat = sp.n % 2 === 0 || !!duel;
        go(defender, s + (tCatch - s) * 0.6, los + depth * 0.6 + 2.4, lerp(V(defender), rv, 0.6));
        go(defender, tCatch, spotU + 0.7, rv + inward * 0.4);
        go(recv, tCatch + 0.4, spotU + 1.1, rv);
        let tDropAt: number;
        let lu: number;
        let lv: number;
        if (swat) {
          lu = spotU + 2.4;
          lv = rv - inward * 1.9;
          tDropAt = tCatch + 0.42;
          ball.push({ t0: tThrow, t1: tCatch, kind: 'air', from: [handX, 2.1, 12], to: [X(spotU + 0.3), 2.5, rv + inward * 0.2], h: arc, spiral: true });
          ball.push({ t0: tCatch, t1: tDropAt, kind: 'air', from: [X(spotU + 0.3), 2.5, rv + inward * 0.2], to: [X(lu), 0.2, lv], h: 0.7, spiral: false });
          cues.push({ t: tCatch - 0.22, c: 'jump', who: ref(defender), h: 1.1, dur: 0.44 });
          cues.push({ t: tCatch - 0.16, c: 'jump', who: ref(recv), h: 0.7, dur: 0.4 });
          cues.push({ t: tCatch, c: 'swat', x: X(spotU + 0.3), y: 2.5, z: rv + inward * 0.2 });
        } else {
          // just out of reach
          lu = Math.min(spotU + 3.2, FIELD + 4.2);
          lv = rv + inward * 0.7;
          tDropAt = tCatch + 0.14;
          ball.push({ t0: tThrow, t1: tDropAt, kind: 'air', from: [handX, 2.1, 12], to: [X(lu), 0.2, lv], h: arc, spiral: true });
          cues.push({ t: tCatch - 0.1, c: 'dive', who: ref(recv), dir: 1 });
        }
        ball.push({ t0: tDropAt, t1: 99, kind: 'ground', at: [X(lu), 0.2, lv] });
        cues.push({ t: tDropAt, c: 'drop', x: X(lu), z: lv });
        tEnd = tDropAt;
        endT = tDropAt + 0.6;
        endU = lu;
        endV = lv;
        star = ref(recv);
      }
    }
  }

  // defenders who are not making the play drift toward where it ends
  for (const p of dg('LB', 'CB', 'S')) {
    const pl = b(p);
    if (moved.has(pl)) continue;
    const [u, v] = called.def[p];
    go(pl, s + 0.25, u, v);
    // (eleven a side they keep more of their shape: twenty-two heroes in one heap is no picture)
    go(pl, Math.max(tEnd, s + 0.6), u + (endU + 1.5 - u) * (size === 11 ? 0.34 : 0.55), v + (endV - v) * (size === 11 ? 0.26 : 0.45));
  }

  cues.push({ t: endT, c: 'end' });
  cues.sort((p, q) => p.t - q.t);
  const dur = endT + (fast ? 0.08 : 0.5);
  return {
    spec: sp, dir, losX: X(los), dur, snap: s, tHand, tThrow, tCatch, tEnd, tTD, plans, ball, cues, star,
    pass: !isRun(type), long: type === 'long', endX: X(endU), endZ: endV, spotX: X(spotU), spotZ: spotV, design, route,
    tDuel: fast ? -1 : tDuel, duelWho,
  };
}

// ------------------------------------------------------------------ made-up plays for the title screen

export function randomSpec(teams: [TeamSheet, TeamSheet], n: number, rnd: () => number): PlaySpec {
  const off: 0 | 1 = rnd() < 0.5 ? 0 : 1;
  const d = (1 - off) as 0 | 1;
  const types: OffType[] = ['inside', 'outside', 'short', 'long', 'outside', 'long'];
  const type = types[Math.floor(rnd() * types.length)]!;
  const calls: DefType[] = ['stuff', 'contain', 'zone', 'deep', 'blitz'];
  const call = calls[Math.floor(rnd() * calls.length)]!;
  const los = 8 + Math.floor(rnd() * 30);
  const O = teams[off];
  const D = teams[d];
  const r = rnd();
  let outcome: Outcome = 'gain';
  let yards = 0;
  if (type === 'inside') yards = r < 0.15 ? 0 : 2 + Math.floor(rnd() * 8);
  else if (type === 'outside') yards = r < 0.15 ? -3 : r < 0.6 ? 3 + Math.floor(rnd() * 8) : 14 + Math.floor(rnd() * 22);
  else if (type === 'short') {
    if (r < 0.15) outcome = 'incomplete';
    else if (r < 0.22) outcome = 'int';
    else if (r < 0.3 && call === 'blitz') { outcome = 'sack'; yards = -5; } else yards = 4 + Math.floor(rnd() * 10);
  } else if (r < 0.3) outcome = 'incomplete';
  else if (r < 0.4) outcome = 'int';
  else yards = 16 + Math.floor(rnd() * 22);
  if (outcome === 'gain' && yards === 0) outcome = 'nogain';
  if (outcome === 'gain' && yards < 0) outcome = 'loss';
  let td = false;
  if (outcome === 'gain' && los + yards >= FIELD) {
    yards = FIELD - los;
    td = true;
  }
  if (outcome === 'sack' || outcome === 'loss') yards = Math.max(yards, 1 - los);
  const run = isRun(type);
  const pool: DefPos[] = type === 'inside' ? ['DL1', 'DL2', 'LB'] : type === 'outside' ? ['LB', 'CB1', 'CB2'] : type === 'short' ? ['CB1', 'CB2', 'LB'] : ['S', 'CB1', 'CB2'];
  return {
    n, off, type, call, outcome, yards, td, los, toGo: Math.min(10, FIELD - los),
    carrier: run ? O.lineup.off.RB : O.lineup.off[rnd() < 0.5 ? 'WR1' : 'WR2'],
    defender: D.lineup.def[pool[Math.floor(rnd() * pool.length)]!],
    offStar: null, defStar: null,
  };
}
