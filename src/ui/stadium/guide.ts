// The lines a broadcast draws over a play so that it reads at a glance, painted on the turf and in the air:
//
//  - the plan: the way the runner means to go and the routes the receivers were sent on (thin, arrowheads flowing along)
//  - what really happens: a ribbon behind the ball wherever the offense takes it
//  - the pass (or kick): its whole arc ahead of the ball, and a ring where it will come down
//  - on a touchdown: a lit road from the runner to the goal line while he is still on his way, and afterwards the
//    whole way the ball went, from the snap to the end zone
//
// Everything is in world coordinates (x along the field, z across); the caller owns the camera.

import { FIELD } from '../../game/match';
import { END, WIDTH } from './assets';
import { evalKeys, type BallSeg, type Design, type Ref, type Script } from './choreo';
import type { Painter } from './ground';
import { TAU, clamp, css, easeOut, lerp, mix, sat, type RGB } from './math';

/** a little above the paint on the turf */
const Y = 0.035;
const GOLD: RGB = [255, 214, 92];
const WHITE: RGB = [255, 255, 255];
const INK = 'rgba(4,22,16,';

/** A path on the ground: x,z pairs every `STEP` yards or so, with the distance run so far at each point. */
interface Way {
  pts: number[];
  len: number[];
  total: number;
}

const STEP = 0.45;

function wayOf(corners: [number, number][], round = 2): Way {
  let pts = corners.map((p) => [p[0], p[1]] as [number, number]);
  // corner cutting, keeping the two ends
  for (let it = 0; it < round && pts.length > 2; it += 1) {
    const out: [number, number][] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (i > 0) out.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)]);
      if (i < pts.length - 2) out.push([lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  const flat: number[] = [];
  const len: number[] = [];
  let total = 0;
  flat.push(pts[0]![0], pts[0]![1]);
  len.push(0);
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / STEP));
    for (let k = 1; k <= n; k += 1) {
      flat.push(lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n));
      total += d / n;
      len.push(total);
    }
  }
  return { pts: flat, len, total };
}

/** Appends a point to a way that grows while the play runs. */
function extend(w: Way, x: number, z: number): void {
  const n = w.len.length;
  if (n) {
    const d = Math.hypot(x - w.pts[n * 2 - 2]!, z - w.pts[n * 2 - 1]!);
    w.total += d;
  }
  w.pts.push(x, z);
  w.len.push(w.total);
}

const at = { x: 0, z: 0, tx: 1, tz: 0 };
/** The point `s` yards along a way, and the direction of travel there (into `at`). */
function along(w: Way, s: number): void {
  const n = w.len.length;
  if (n < 2) {
    at.x = w.pts[0] ?? 0;
    at.z = w.pts[1] ?? 0;
    at.tx = 1;
    at.tz = 0;
    return;
  }
  const d = clamp(s, 0, w.total);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (w.len[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const span = Math.max(1e-4, w.len[hi]! - w.len[lo]!);
  const f = (d - w.len[lo]!) / span;
  const ax = w.pts[lo * 2]!; const az = w.pts[lo * 2 + 1]!;
  const bx = w.pts[hi * 2]!; const bz = w.pts[hi * 2 + 1]!;
  at.x = lerp(ax, bx, f);
  at.z = lerp(az, bz, f);
  const l = Math.hypot(bx - ax, bz - az) || 1;
  at.tx = (bx - ax) / l;
  at.tz = (bz - az) / l;
}

/** How far along a way the point nearest to (x,z) lies, looking only ahead of `from` (a hero does not run backwards along his route). */
function nearest(w: Way, x: number, z: number, from: number): number {
  const n = w.len.length;
  let best = from;
  let bestD = Infinity;
  for (let i = 0; i < n; i += 1) {
    const s = w.len[i]!;
    if (s < from - 0.01) continue;
    if (s > from + 9) break;
    const d = (w.pts[i * 2]! - x) ** 2 + (w.pts[i * 2 + 1]! - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

const poly: number[] = [];
const cutPts: number[] = [];

/** The piece of a way between two distances, as x,z pairs in `cutPts`. Returns the number of points. */
function cut(w: Way, s0: number, s1: number): number {
  cutPts.length = 0;
  const a = clamp(s0, 0, w.total);
  const b = clamp(s1, 0, w.total);
  if (b - a < 0.05) return 0;
  along(w, a);
  cutPts.push(at.x, at.z);
  const n = w.len.length;
  for (let i = 0; i < n; i += 1) {
    const s = w.len[i]!;
    if (s <= a + 0.02) continue;
    if (s >= b - 0.02) break;
    cutPts.push(w.pts[i * 2]!, w.pts[i * 2 + 1]!);
  }
  along(w, b);
  cutPts.push(at.x, at.z);
  return cutPts.length / 2;
}

/**
 * Fills a band (`half` yards to each side) along the points in `cutPts`, lying on the turf.
 * `side` moves it off the centre line; `tail` < 1 makes it thinner toward its start, like a comet.
 */
function band(p: Painter, n: number, half: number, style: string, side = 0, tail = 1): void {
  if (n < 2) return;
  poly.length = 0;
  // one side out, the other side back: a single outline, so translucent paint has no seams
  for (let pass = 0; pass < 2; pass += 1) {
    for (let k = 0; k < n; k += 1) {
      const i = pass ? n - 1 - k : k;
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let tx = cutPts[i1 * 2]! - cutPts[i0 * 2]!;
      let tz = cutPts[i1 * 2 + 1]! - cutPts[i0 * 2 + 1]!;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const h = half * (tail >= 1 ? 1 : lerp(tail, 1, i / (n - 1)));
      const off = side + (pass ? -h : h);
      poly.push(cutPts[i * 2]! - tz * off, Y, cutPts[i * 2 + 1]! + tx * off);
    }
  }
  p.fill(poly, style);
}

/**
 * Strokes the centre line of the points in `cutPts` with an even weight on screen. From far away or at a flat angle
 * a band on the turf shrinks to a hair; this keeps the line readable from any camera.
 */
function hair(p: Painter, n: number, width: number, style: string): void {
  if (n < 2) return;
  const ctx = p.ctx;
  const cam = p.cam;
  let on = false;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    if (!cam.project(cutPts[i * 2]!, Y, cutPts[i * 2 + 1]!)) {
      on = false;
      continue;
    }
    if (on) ctx.lineTo(cam.sx, cam.sy);
    else ctx.moveTo(cam.sx, cam.sy);
    on = true;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style;
  ctx.lineWidth = width * p.px;
  ctx.stroke();
}

/** An arrowhead lying on the turf at the point last looked up with along(). */
function chevron(p: Painter, w: number, thick: number, style: string): void {
  const { x, z, tx, tz } = at;
  const nx = -tz;
  const nz = tx;
  const back = w * 0.9;
  poly.length = 0;
  poly.push(
    x + tx * thick, Y, z + tz * thick,
    x + nx * w - tx * back, Y, z + nz * w - tz * back,
    x + nx * w - tx * (back + thick), Y, z + nz * w - tz * (back + thick),
    x, Y, z,
    x - nx * w - tx * (back + thick), Y, z - nz * w - tz * (back + thick),
    x - nx * w - tx * back, Y, z - nz * w - tz * back,
  );
  p.fill(poly, style);
}

interface Line {
  who: Ref;
  kind: Design['kind'];
  way: Way;
  /** yards of it already run */
  done: number;
}

export interface GuideFrame {
  /** seconds into the play */
  t: number;
  /** real seconds (the caller's clock) */
  clock: number;
  bx: number; by: number; bz: number;
  /** who holds the ball, if anybody */
  held: Ref | null;
  air: boolean;
  where(r: Ref): { x: number; z: number } | null;
}

export class Guide {
  private lines: Line[] = [];
  private col: RGB;
  private bright: RGB;
  /** the plan is drawn almost white, like chalk, with a breath of the team's colour */
  private chalk: RGB;
  private t0: number;
  private t = 0;
  private clock: number;
  /** where the ball has been since the snap, on the ground, while the offense had it */
  private track: Way = { pts: [], len: [], total: 0 };
  /** the stretch of the track the ball flew over: [from, to] yards along it */
  private flown: [number, number] = [-1, -1];
  private trackOn = true;
  private trackFrom = 0;
  /** the throw (or kick) */
  private arc: { seg: Extract<BallSeg, { kind: 'air' }>; pts: number[]; landed: number } | null = null;
  /** from the runner to the goal, when this play is a touchdown */
  private road: { way: Way; t0: number; from: number } | null = null;
  private roadTried = false;
  private roadNews = false;
  private tdAt = -1;
  private endAt = -1;
  private planOff: number;
  private gold = false;

  constructor(private script: Script, team: RGB, clock: number) {
    this.col = team;
    this.bright = mix(team, WHITE, 0.45);
    this.chalk = mix(team, WHITE, 0.82);
    this.t0 = clock;
    this.clock = clock;
    for (const d of script.design) {
      if (d.way.length < 2) continue;
      this.lines.push({ who: { team: d.team, id: d.id }, kind: d.kind, way: wayOf(d.way), done: 0 });
    }
    // the plan is wiped once the ball is caught (or the runner is stopped)
    this.planOff = script.pass ? (script.tCatch > 0 ? script.tCatch : script.tEnd) : script.tEnd;
    this.trackOn = !script.spec.kick;
    // the ribbon begins where the play does: at the hand-off (or the pitch), or as the pass leaves the hand
    this.trackFrom = script.pass ? (script.tThrow > 0 ? script.tThrow : Infinity) : Math.max(script.snap, script.tHand - 0.16);
    const throwSeg = script.ball.find((s): s is Extract<BallSeg, { kind: 'air' }> => s.kind === 'air' && s.t1 - s.t0 >= 0.4);
    if (throwSeg) {
      const pts: number[] = [];
      const N = 30;
      for (let i = 0; i <= N; i += 1) {
        const f = i / N;
        pts.push(lerp(throwSeg.from[0], throwSeg.to[0], f), lerp(throwSeg.from[1], throwSeg.to[1], f) + throwSeg.h * 4 * f * (1 - f), lerp(throwSeg.from[2], throwSeg.to[2], f));
      }
      this.arc = { seg: throwSeg, pts, landed: -1 };
      // a pass that comes down in the end zone for the score, or a kick that is good: the arc itself is the golden road
      const sp = script.spec;
      this.gold = sp.kick ? sp.kick.good && sp.kick.type !== 'punt' : sp.td && script.tTD > 0 && script.tTD - script.tCatch < 0.2;
    }
  }

  /** True once nothing is left to draw. */
  get dead(): boolean {
    return this.endAt >= 0 && this.clock - this.endAt > 0.8;
  }

  touchdown(clock: number): void {
    if (this.tdAt < 0) this.tdAt = clock;
  }

  /** The play is over: everything fades (after a touchdown the way to the end zone stays until the next scene). */
  finish(clock: number): void {
    if (this.tdAt < 0 && this.endAt < 0) this.endAt = clock;
  }

  /** True once, when the road to the goal has just been lit (the camera may want to look down it). */
  takeRoad(): boolean {
    const v = this.roadNews;
    this.roadNews = false;
    return v;
  }

  /** Time goes by after the play (for the fades). */
  tick(clock: number): void {
    this.clock = clock;
  }

  step(f: GuideFrame): void {
    const sc = this.script;
    const o = sc.spec.off;
    this.t = f.t;
    this.clock = f.clock;
    for (const ln of this.lines) {
      const ac = f.where(ln.who);
      if (ac && f.t >= sc.snap) ln.done = nearest(ln.way, ac.x, ac.z, ln.done);
    }
    // the ball's way on the ground
    if (this.trackOn && f.t >= this.trackFrom) {
      const arcOn = !!this.arc && f.t >= this.arc.seg.t0 && f.t <= this.arc.seg.t1;
      // ours: in an offensive hand, on its way through the air from one, or pitched to the runner
      const ours = f.held ? f.held.team === o : f.air && (arcOn || (!sc.pass && f.t <= sc.tEnd));
      if (!ours) {
        // taken away, batted down or loose on the turf: the line ends here
        this.trackOn = false;
      } else {
        const n = this.track.len.length;
        const x = clamp(f.bx, -END, FIELD + END);
        const z = clamp(f.bz, 0, WIDTH);
        if (!n || Math.hypot(x - this.track.pts[n * 2 - 2]!, z - this.track.pts[n * 2 - 1]!) > 0.3) {
          if (arcOn && this.flown[0] < 0) this.flown[0] = this.track.total;
          extend(this.track, x, z);
          if (arcOn) this.flown[1] = this.track.total;
        }
      }
    }
    if (this.arc && this.arc.landed < 0 && f.t >= this.arc.seg.t1) this.arc.landed = f.clock;
    // a touchdown on the way: light the road from the runner to the goal while he is still running
    if (sc.spec.td && !sc.spec.kick && !this.roadTried && sc.tTD > 0) {
      const got = sc.pass ? sc.tCatch : sc.tHand;
      if (f.t >= got + 0.05 && f.t >= sc.tTD - 2.2) {
        this.roadTried = true;
        const plan = sc.plans.find((p) => p.team === sc.star.team && p.id === sc.star.id);
        if (plan) {
          const corners: [number, number][] = [];
          const tmp = { x: 0, z: 0 };
          const tEnd = sc.tTD + 0.12;
          for (let t = f.t; t < tEnd; t += 0.05) {
            evalKeys(plan.keys, t, tmp);
            corners.push([tmp.x, tmp.z]);
          }
          evalKeys(plan.keys, tEnd, tmp);
          // on into the end zone
          corners.push([tmp.x + sc.dir * 1.6, tmp.z]);
          const way = wayOf(corners, 0);
          if (way.total > 3.5) {
            this.road = { way, t0: f.clock, from: 0 };
            this.roadNews = true;
          }
        }
      }
    }
    if (this.road) {
      const ac = f.where(sc.star);
      if (ac) this.road.from = nearest(this.road.way, ac.x, ac.z, this.road.from);
    }
  }

  private fadeOut(): number {
    return this.endAt < 0 ? 1 : 1 - sat((this.clock - this.endAt) / 0.7);
  }

  /** Everything that lies on the turf: drawn before the heroes. */
  drawGround(p: Painter): void {
    const ctx = p.ctx;
    const sc = this.script;
    const clock = this.clock;
    const all = this.fadeOut();
    if (all <= 0.01) return;
    const td = this.tdAt >= 0;
    const since = clock - this.t0;

    // ---- the plan
    const planFade = (this.t > this.planOff ? 1 - sat((this.t - this.planOff) / 0.45) : 1) * (td ? 0 : 1) * all;
    if (planFade > 0.01) {
      this.lines.forEach((ln, li) => {
        const w = ln.way;
        const main = ln.kind !== 'decoy';
        const shown = w.total * easeOut((since - li * 0.07) / 0.42);
        if (shown < 0.6) return;
        const a = planFade * (main ? 1 : 0.7);
        const half = main ? 0.32 : 0.22;
        const glow = (n: number): void => {
          ctx.globalCompositeOperation = 'lighter';
          band(p, n, half * 3.2, css(this.col, 0.2 * a));
          ctx.globalCompositeOperation = 'source-over';
        };
        // run already: a route stays as a solid line; the runner's is covered by the ball's own ribbon
        if (ln.kind !== 'run' && ln.done > 0.3) {
          const n = cut(w, 0, Math.min(ln.done, shown));
          band(p, n, half * 1.7, `${INK}${0.34 * a})`);
          glow(n);
          band(p, n, half, css(this.chalk, 0.95 * a));
          hair(p, n, 3, css(this.chalk, 0.9 * a));
        }
        // still ahead: a thinner line, and arrowheads that flow along it
        const s0 = Math.min(ln.done, shown);
        const n = cut(w, s0, shown);
        if (n >= 2) {
          band(p, n, half * 1.5, `${INK}${0.3 * a})`);
          glow(n);
          band(p, n, half * 0.55, css(this.chalk, 0.8 * a));
          hair(p, n, 2.2, css(this.chalk, 0.75 * a));
        }
        const gap = main ? 2.4 : 2.8;
        const flow = (clock * (main ? 6.5 : 4.5)) % gap;
        const cw = main ? 1.2 : 0.85;
        for (let s = s0 + flow; s < shown - 0.2; s += gap) {
          const edge = Math.min(sat((s - s0) / 0.8), sat((shown - s) / 0.8));
          if (edge <= 0.05) continue;
          along(w, s);
          chevron(p, cw * 1.25, cw * 0.78, `${INK}${0.4 * a * edge})`);
          chevron(p, cw, cw * 0.5, css(this.chalk, a * edge));
        }
        // where the route ends: a mark to run to
        if (ln.kind === 'route' && shown >= w.total - 0.1) {
          along(w, w.total);
          const r = 1.15 + 0.16 * Math.sin(clock * 6);
          this.ring(p, at.x, at.z, r, `${INK}${0.35 * a})`, 0.24);
          this.ring(p, at.x, at.z, r, css(this.chalk, 0.95 * a), 0.14);
        }
      });
    }

    // ---- the road to the goal
    const road = this.road;
    if (road && !td) {
      const w = road.way;
      const r = easeOut((clock - road.t0) / 0.32);
      const s0 = road.from;
      const s1 = lerp(s0, w.total, r);
      const n = cut(w, s0, s1);
      if (n >= 2) {
        const pulse = 0.8 + 0.2 * Math.sin(clock * 9);
        const half = 2;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalCompositeOperation = 'source-over';
        band(p, n, half, css([255, 196, 40], 0.62 * pulse * all));
        ctx.globalCompositeOperation = 'lighter';
        band(p, n, half * 1.5, css(GOLD, 0.1 * pulse * all));
        band(p, n, 0.2, css(mix(GOLD, WHITE, 0.3), 0.95 * all), half);
        band(p, n, 0.2, css(mix(GOLD, WHITE, 0.3), 0.95 * all), -half);
        const gap = 3;
        const flow = (clock * 15) % gap;
        for (let s = s0 + flow; s < s1 - 0.3; s += gap) {
          const edge = Math.min(sat((s - s0) / 1.2), sat((s1 - s) / 1.2));
          if (edge <= 0.05) continue;
          along(w, s);
          chevron(p, half * 0.8, 0.8, css(mix(GOLD, WHITE, 0.6), 0.95 * edge * all));
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // the end zone waits, lit, while the road is up and through the celebration
    if ((road || td) && sc.spec.td) {
      const x0 = sc.dir > 0 ? FIELD : -END;
      const k = td ? 0.55 + 0.45 * Math.sin((clock - this.tdAt) * 7) ** 2 : 0.45 + 0.3 * Math.sin(clock * 8);
      ctx.globalCompositeOperation = 'lighter';
      p.fill([x0, Y, 0, x0 + END, Y, 0, x0 + END, Y, WIDTH, x0, Y, WIDTH], css(GOLD, 0.16 * k * all));
      const gx = sc.dir > 0 ? FIELD : 0;
      p.fill([gx - 0.22, Y, 0, gx + 0.22, Y, 0, gx + 0.22, Y, WIDTH, gx - 0.22, Y, WIDTH], css(GOLD, 0.8 * k * all));
      ctx.globalCompositeOperation = 'source-over';
    }

    // ---- where the ball has gone
    const tr = this.track;
    if (tr.total > 0.6) {
      const col = td ? GOLD : this.col;
      const hot = td ? mix(GOLD, WHITE, 0.5) : this.bright;
      const grow = td ? 1 + 0.5 * (1 - sat((clock - this.tdAt) / 0.5)) : 1;
      const pieces: [number, number, boolean][] = [];
      if (this.flown[0] >= 0) {
        pieces.push([0, this.flown[0], false], [this.flown[0], this.flown[1], true], [this.flown[1], tr.total, false]);
      } else pieces.push([0, tr.total, false]);
      for (const [a, b, flew] of pieces) {
        const n = cut(tr, a, b);
        if (n < 2) continue;
        if (flew) {
          // under the pass: only its shadow on the turf
          band(p, n, 0.1, `${INK}${0.35 * all})`);
          band(p, n, 0.05, css(hot, 0.5 * all));
          continue;
        }
        // a comet: thin where the ball set off, full width where it is now (after a touchdown, the whole way glows)
        const tail = td || this.flown[0] >= 0 ? 0.7 : 0.4;
        band(p, n, 1.0 * grow, `${INK}${0.34 * all})`, 0, tail);
        ctx.globalCompositeOperation = 'lighter';
        band(p, n, 1.9 * grow, css(col, 0.28 * all), 0, tail);
        ctx.globalCompositeOperation = 'source-over';
        band(p, n, 0.8 * grow, css(col, 0.96 * all), 0, tail);
        hair(p, n, 5, css(col, 0.9 * all));
        band(p, n, 0.24 * grow, css(WHITE, 0.95 * all), 0, tail);
        hair(p, n, 2, css(WHITE, 0.9 * all));
        if (!td && a < b) {
          // arrowheads run up the ribbon toward the ball
          const gap = 2.6;
          const flow = (clock * 9) % gap;
          for (let s = a + flow; s < b - 0.6; s += gap) {
            const edge = Math.min(sat((s - a) / 2), sat((b - s) / 1.2));
            if (edge <= 0.05) continue;
            along(tr, s);
            chevron(p, 0.62 * lerp(tail, 1, (s - a) / Math.max(1, b - a)), 0.34, css(WHITE, 0.6 * edge * all));
          }
        }
      }
      if (td) {
        // light runs the whole way again and again: from the snap to the end zone
        const loop = 1.15;
        const ph = ((clock - this.tdAt) % loop) / loop;
        const s = ph * (tr.total + 6) - 3;
        const n = cut(tr, s - 3, s + 3);
        ctx.globalCompositeOperation = 'lighter';
        band(p, n, 0.6, css(WHITE, 0.55 * all));
        band(p, n, 1.3, css(GOLD, 0.25 * all));
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // ---- where the pass comes down
    const arc = this.arc;
    if (arc && arc.seg.to[1] < 3.6 && this.t >= arc.seg.t0 - 0.05) {
      const f = sat((this.t - arc.seg.t0) / Math.max(0.01, arc.seg.t1 - arc.seg.t0));
      const gone = arc.landed >= 0 ? 1 - sat((clock - arc.landed) / 0.35) : 1;
      const a = sat(f * 5) * gone * all;
      if (a > 0.02) {
        const c = this.gold ? GOLD : this.bright;
        const r = lerp(2.3, 0.85, easeOut(f));
        this.ring(p, arc.seg.to[0], arc.seg.to[2], r, css(c, 0.9 * a), 0.12);
        this.ring(p, arc.seg.to[0], arc.seg.to[2], 0.3, css(c, 0.9 * a), 0.3);
        // four ticks that close in with the ring
        for (let k = 0; k < 4; k += 1) {
          const ang = k * (TAU / 4) + clock * 1.4;
          const cx = Math.cos(ang); const cz = Math.sin(ang);
          const x = arc.seg.to[0]; const z = arc.seg.to[2];
          p.fill([
            x + cx * (r + 0.15) - cz * 0.1, Y, z + cz * (r + 0.15) + cx * 0.1,
            x + cx * (r + 0.8) - cz * 0.1, Y, z + cz * (r + 0.8) + cx * 0.1,
            x + cx * (r + 0.8) + cz * 0.1, Y, z + cz * (r + 0.8) - cx * 0.1,
            x + cx * (r + 0.15) + cz * 0.1, Y, z + cz * (r + 0.15) - cx * 0.1,
          ], css(c, 0.9 * a));
        }
      }
    }
  }

  /** A ring painted on the turf. */
  private ring(p: Painter, x: number, z: number, r: number, style: string, thick: number): void {
    const N = 22;
    poly.length = 0;
    for (let i = 0; i <= N; i += 1) {
      const a = (i / N) * TAU;
      poly.push(x + Math.cos(a) * (r + thick), Y, z + Math.sin(a) * (r + thick));
    }
    for (let i = N; i >= 0; i -= 1) {
      const a = (i / N) * TAU;
      poly.push(x + Math.cos(a) * Math.max(0, r - thick), Y, z + Math.sin(a) * Math.max(0, r - thick));
    }
    p.fill(poly, style);
  }

  /** Over the heroes: the lines once more, faintly (a hero never hides them), and the pass in the air. */
  drawAir(p: Painter): void {
    const all = this.fadeOut();
    if (all <= 0.01) return;
    const td = this.tdAt >= 0;
    if (this.track.total > 0.6) {
      const n = cut(this.track, 0, this.track.total);
      hair(p, n, 2, css(td ? mix(GOLD, WHITE, 0.4) : this.bright, 0.3 * all));
    }
    if (this.road && !td) {
      const n = cut(this.road.way, this.road.from, lerp(this.road.from, this.road.way.total, easeOut((this.clock - this.road.t0) / 0.32)));
      hair(p, n, 2, css(mix(GOLD, WHITE, 0.4), 0.3 * all));
    }
    const arc = this.arc;
    if (!arc) return;
    const seg = arc.seg;
    if (this.t < seg.t0 - 0.02) return;
    const gone = arc.landed >= 0 ? 1 - sat((this.clock - arc.landed) / (this.gold ? 1.4 : 0.6)) : 1;
    const a = gone * all;
    if (a <= 0.02) return;
    const ctx = p.ctx;
    const cam = p.cam;
    const px = p.px;
    const f = sat((this.t - seg.t0) / Math.max(0.01, seg.t1 - seg.t0));
    const n = arc.pts.length / 3;
    const c = this.gold ? GOLD : this.bright;
    // the whole arc shows itself well ahead of the ball
    const shown = sat(f * 2.6 + 0.12);
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    let ok = false;
    let lx = 0; let ly = 0;
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1);
      if (u > shown) break;
      const vis = cam.project(arc.pts[i * 3]!, arc.pts[i * 3 + 1]!, arc.pts[i * 3 + 2]!);
      if (vis && ok) {
        const flown = u <= f;
        // behind the ball a solid streak that is brightest at the ball; ahead of it, every other piece: a dotted line
        if (flown || i % 2 === 0) {
          const w = Math.max(1.4 * px, cam.ss * (flown ? 0.2 : 0.11));
          const near = flown ? 0.45 + 0.55 * sat(1 - (f - u) * 3) : 0.8;
          ctx.strokeStyle = css(flown ? mix(c, WHITE, 0.3) : c, a * near);
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(cam.sx, cam.sy);
          ctx.stroke();
          if (flown) {
            ctx.strokeStyle = css(c, 0.22 * a * near);
            ctx.lineWidth = w * 3.2;
            ctx.stroke();
          }
        }
      }
      ok = vis;
      lx = cam.sx; ly = cam.sy;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
