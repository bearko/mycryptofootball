// Turns the result of one play into a script: where everybody runs, where the ball is, and the beats
// (snap, hand-off, throw, catch, hit, touchdown) the renderer hangs its camera work and effects on.
//
// Scripts are written in "drive coordinates" like the rules (u = yards from the offense's own goal line,
// v = across the field) and converted to world x/z here: team 0 attacks toward +x, team 1 toward -x.

import { KIND, isRun, type DefType, type KickType, type OffType } from '../../game/cards';
import { FIELD, type Outcome, type PlayResult, type TeamSheet } from '../../game/match';
import { DEF_POS, OFF_POS, type DefPos, type OffPos } from '../../game/model';
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
  carrier: number;
  defender: number;
  offStar: number | null;
  defStar: number | null;
  /** a kick instead of a play (the kicker is `carrier`, lined up where the running back would be) */
  kick?: { type: KickType; good: boolean; dist: number };
}

/**
 * What a hero was sent out to do, as the coach drew it: the way the runner means to go, the routes the receivers run.
 * World x,z points. It is the plan, not the result (the runner may never get that far).
 */
export interface Design extends Ref {
  kind: 'run' | 'route' | 'decoy';
  way: [number, number][];
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
}

export function specOf(res: PlayResult): PlaySpec {
  const dsp = res.defPick.special;
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
    carrier: res.carrier,
    defender: res.defender,
    offStar: res.offPick.special ? res.offPick.special.owner : null,
    defStar: dsp ? dsp.owner : null,
  };
}

export function formation(los: number, call?: DefType): { off: Record<OffPos, UV>; def: Record<DefPos, UV> } {
  const off: Record<OffPos, UV> = {
    OL1: [los - 1.9, 8.5], OL2: [los - 1.9, 15.5], QB: [los - 5, 12], RB: [los - 8.2, 12.8],
    WR1: [los - 1.9, 2.6], WR2: [los - 1.9, 21.4],
  };
  const def: Record<DefPos, UV> = {
    DL1: [los + 1.9, 8.5], DL2: [los + 1.9, 15.5], LB: [los + 5.6, 12], CB1: [los + 4.6, 3], CB2: [los + 4.6, 21], S: [los + 11, 12],
  };
  if (call === 'stuff') { def.LB = [los + 3.6, 12]; def.CB1 = [los + 4, 6]; def.CB2 = [los + 4, 18]; def.S = [los + 8, 12]; }
  if (call === 'contain') { def.CB1 = [los + 2.6, 2.4]; def.CB2 = [los + 2.6, 21.6]; def.LB = [los + 5, 12]; }
  if (call === 'zone') { def.CB1 = [los + 5.8, 4.5]; def.CB2 = [los + 5.8, 19.5]; def.LB = [los + 6.6, 12]; }
  if (call === 'deep') { def.CB1 = [los + 9, 4.5]; def.CB2 = [los + 9, 19.5]; def.S = [los + 15, 12]; }
  if (call === 'blitz') { def.LB = [los + 2.4, 12]; def.S = [los + 7, 12]; def.CB1 = [los + 3.2, 4.5]; def.CB2 = [los + 3.2, 19.5]; }
  // nobody lines up behind the back of an end zone
  for (const p of DEF_POS) def[p][0] = Math.min(def[p][0], FIELD + 3.6);
  for (const p of OFF_POS) off[p][0] = Math.max(off[p][0], -3.8);
  return { off, def };
}

/** World x of a drive position for the team on offense. */
export const worldX = (offense: 0 | 1, u: number): number => (offense === 0 ? u : FIELD - u);

export interface Spot extends Ref { pos: OffPos | DefPos; x: number; z: number; offense: boolean }

export function lineUp(teams: [TeamSheet, TeamSheet], offense: 0 | 1, los: number, call?: DefType): Spot[] {
  const f = formation(los, call);
  const d = (1 - offense) as 0 | 1;
  const out: Spot[] = [];
  for (const p of OFF_POS) out.push({ team: offense, id: teams[offense].lineup.off[p], pos: p, x: worldX(offense, f.off[p][0]), z: f.off[p][1], offense: true });
  for (const p of DEF_POS) out.push({ team: d, id: teams[d].lineup.def[p], pos: p, x: worldX(offense, f.def[p][0]), z: f.def[p][1], offense: false });
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

export function buildScript(
  teams: [TeamSheet, TeamSheet],
  sp: PlaySpec,
  where: (team: 0 | 1, id: number) => UV | null,
  fast: boolean,
): Script {
  const o = sp.off;
  const d = (1 - o) as 0 | 1;
  const dir: 1 | -1 = o === 0 ? 1 : -1;
  const X = (u: number): number => worldX(o, u);
  const O = teams[o];
  const D = teams[d];
  const los = sp.los;
  const type = sp.type;
  const base = formation(los);
  const called = formation(los, sp.call);
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
  for (const p of OFF_POS) mk(o, O.lineup.off[p], p, base.off[p]);
  for (const p of DEF_POS) mk(d, D.lineup.def[p], p, base.def[p]);
  const find = (team: 0 | 1, id: number): Plan => plans.find((p) => p.team === team && p.id === id) ?? plans[team === o ? 0 : 6]!;
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
  for (const p of OFF_POS) go(a(p), s * 0.72, base.off[p][0], base.off[p][1]);
  for (const p of DEF_POS) go(b(p), s * 0.86, called.def[p][0], called.def[p][1]);
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
  for (const p of ['OL1', 'OL2'] as const) {
    const pl = a(p);
    const [u, v] = base.off[p];
    go(pl, s + 0.26, u + 0.95, v);
    go(pl, s + 1.0, u + 0.9 + push, v + (v < 12 ? -0.3 : 0.3));
  }
  for (const p of ['DL1', 'DL2'] as const) {
    const pl = b(p);
    const [u, v] = called.def[p];
    go(pl, s + 0.26, u - 0.95, v);
    go(pl, s + 1.0, u - 0.9 + push, v + (v < 12 ? -0.3 : 0.3));
  }
  cues.push({ t: s + 0.25, c: 'clash', at: [[X(los), 8.5], [X(los), 15.5]] });

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
  const moved = new Set<Plan>();
  /** the earliest the tackler can be at a spot without flying there */
  const needT = (u: number, v: number): number => {
    const from = called.def[defender.pos as DefPos] ?? [los + 5, 12];
    return s + 0.18 + Math.hypot(from[0] - u, from[1] - v) / 15;
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
    for (const p of ['DL1', 'DL2'] as const) go(b(p), tK + 0.1, los - 3.2, called.def[p][1] + (called.def[p][1] < 12 ? 0.8 : -0.8), true);
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
    if (inside) draw(rb, 'run', [base.off.RB, [los - 5.4, 12.2], [los - 0.8, lane], [Math.min(los + 9, FIELD + 2), lane]]);
    else draw(rb, 'run', [base.off.RB, [los - 7.7, lerp(12.8, lane, 0.3)], [los - 3.6, lane], [Math.min(los + 11, FIELD + 2), lane + (lane < 12 ? 0.9 : -0.9)]]);
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
    for (const p of ['WR1', 'WR2'] as const) {
      const pl = a(p);
      const [u, v] = base.off[p];
      go(pl, s + 0.9, u + 3.5, v);
      go(pl, Math.max(tEnd, s + 1.2), u + 4 + clamp(sp.yards, 0, 14) * 0.35, v);
    }
    cut(defender);
    moved.add(defender);
    const lz = V(rb);
    if (sp.td) {
      tTD = tAt(FIELD + 0.4);
      const du = Math.min(FIELD - 0.8, reach(defender, tTD));
      go(defender, tTD, du, lz + (lz < 12 ? 1.6 : -1.6), true);
      if (du > FIELD - 3.5) cues.push({ t: tTD - 0.08, c: 'dive', who: ref(defender), dir: 1 });
      cues.push({ t: tTD, c: 'td', who: ref(rb) });
      cues.push({ t: tEnd + 0.1, c: 'celebrate', team: o });
      ball.push({ t0: tHand + (inside ? 0 : 0.04), t1: 99, kind: 'held', team: o, id: rb.id });
      endT = Math.max(tTD + 1.5, tEnd + 0.9);
    } else {
      go(defender, s + 0.22 + (tEnd - s - 0.22) * 0.62, lerp(U(defender), hitU + 2.6, 0.6), lerp(V(defender), lz, 0.7));
      go(defender, tEnd, hitU + 0.85, lz, true);
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
        cues.push({ t: tEnd + 1.05, c: 'celebrate', team: d });
        star = ref(defender);
        endT = tEnd + 1.25;
        endU = lu;
        endV = lv;
      } else {
        go(rb, tEnd + 0.32, stopU, lz);
        go(defender, tEnd + 0.32, stopU + 0.9, lz + 0.2);
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
    const recvPos: OffPos = carrier.pos === 'WR1' || carrier.pos === 'WR2' ? carrier.pos : 'WR1';
    const recv = a(recvPos);
    const other = a(recvPos === 'WR1' ? 'WR2' : 'WR1');
    const rv0 = base.off[recvPos][1];
    const inward = rv0 < 12 ? 1 : -1;
    const rv = rv0 + inward * (long ? 1.7 : 3.8);
    const maxDepth = FIELD - los + 2.6;
    let depth: number;
    if (caught) {
      depth = long ? clamp(sp.yards * 0.84, 7, 32) : clamp(Math.min(sp.yards, 5), 1, 9);
      if (sp.td && FIELD - los <= depth + 1.5) depth = FIELD - los + 2.2;
    } else if (int) depth = deep + 2;
    else depth = deep + (long ? 3 : 1);
    depth = clamp(depth, 1, maxDepth);
    spotU = los + depth;
    spotV = rv;
    const dropU = sack ? end + 0.7 : long ? los - 8.6 : los - 7.2;
    const tDrop = s + (long ? 0.8 : 0.55);
    tThrow = s + (long ? 1.12 : 0.8);
    const flight = long ? clamp(0.72 + depth * 0.023, 0.95, 1.45) : 0.5;
    tCatch = tThrow + flight;

    go(rb, s + 0.45, los - 5.2, 15.2);
    go(rb, s + 1.4, los - 4.9, 15.4);
    {
      const [u, v] = base.off[other.pos as OffPos];
      const inw = v < 12 ? 1 : -1;
      go(other, s + (tCatch - s) * 0.6, u + (long ? 10 : 5), v);
      go(other, tCatch + 0.25, u + (long ? 13.5 : 6.5), v + inw * 1.6);
    }
    go(recv, s + (tCatch - s) * 0.55, los + depth * 0.5, rv0 + inward * 0.3);
    draw(recv, 'route', [base.off[recvPos], [los + depth * 0.5, rv0 + inward * 0.3], [spotU, rv]]);
    {
      const [u, v] = base.off[other.pos as OffPos];
      draw(other, 'decoy', [[u, v], [u + (long ? 10 : 5), v], [u + (long ? 13.5 : 6.5), v + (v < 12 ? 1.6 : -1.6)]]);
    }
    if (sp.call === 'blitz' && b('LB') !== defender) {
      const lb = b('LB');
      go(lb, s + 0.75, los - 2.4, 12.6 + (sp.n % 2 ? 1.5 : -1.5));
      moved.add(lb);
    }
    // the other corner stays with the other receiver
    {
      const cb = b(recvPos === 'WR1' ? 'CB2' : 'CB1');
      if (cb !== defender) {
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
      tThrow = -1;
      tCatch = -1;
      endT = tSack + 0.75;
      endU = end;
      endV = 12.2;
      star = ref(qb);
    } else {
      go(qb, tDrop, dropU, 12);
      go(qb, tThrow, dropU - 0.1, 12);
      go(qb, tThrow + 0.25, dropU + 0.8, 12);
      go(recv, tCatch, spotU, rv, caught);
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
        const swat = sp.n % 2 === 0;
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
  for (const p of ['LB', 'CB1', 'CB2', 'S'] as const) {
    const pl = b(p);
    if (moved.has(pl)) continue;
    const [u, v] = called.def[p];
    go(pl, s + 0.25, u, v);
    go(pl, Math.max(tEnd, s + 0.6), u + (endU + 1.5 - u) * 0.55, v + (endV - v) * 0.45);
  }

  cues.push({ t: endT, c: 'end' });
  cues.sort((p, q) => p.t - q.t);
  const dur = endT + (fast ? 0.08 : 0.5);
  return {
    spec: sp, dir, losX: X(los), dur, snap: s, tHand, tThrow, tCatch, tEnd, tTD, plans, ball, cues, star,
    pass: !isRun(type), long: type === 'long', endX: X(endU), endZ: endV, spotX: X(spotU), spotZ: spotV, design,
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
