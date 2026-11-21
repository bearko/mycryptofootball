// The practice ground: the school's own modest field at dusk, drawn in the same 3D world as the stadium.
//
// This file holds what only the ground has: the light of the day, the scenery (school building, trees,
// chain-link fences, shed, scoreboard), the equipment (sled, dummies, cones, ball cart, bench, blackboard),
// the warm-up stations and the scripts of the drills. The stadium class owns the heroes, the camera,
// the particles and the frame; it calls in here through a small Painter.

import { FIELD } from '../../game/match';
import { DISPLAY_FONT, END, PIXEL_FONT, WIDTH, makeCanvas, type Tex } from './assets';
import { evalKeys, type Key } from './choreo';
import { Camera, TAU, clamp, css, lerp, mix, rgbOf, sat, scale, seeded, type RGB } from './math';

export type DrillKind = 'dash' | 'pass' | 'catch' | 'hit' | 'tackle' | 'study' | 'game' | 'solo' | 'special';

export interface DrillHooks {
  /** footfalls / rhythm beats worth a tick sound */
  onStep?(): void;
  onThrow?(): void;
  onCatch?(): void;
  /** bodies or pads colliding */
  onImpact?(power: number): void;
  /** chalk on the board (study) */
  onChalk?(): void;
  onWhistle?(): void;
  /** the moment a hero visibly "gets" something — the caller pops numbers over that hero */
  onPayoff?(heroId: number): void;
  onEnd?(): void;
}

/** What the scenery needs from the renderer. */
export interface Painter {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  /** device pixels per CSS pixel */
  px: number;
  W: number;
  H: number;
  fill(pts: ArrayLike<number>, style: string | CanvasGradient): boolean;
  /** textured world quad: top-left, top-right, bottom-left, bottom-right */
  tex(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, quad: ArrayLike<number>, nu: number, nv: number, tol: number, depth: number, smooth: boolean): void;
}

// ------------------------------------------------------------------ the light of the day

export interface Light {
  /** 0 bright late afternoon .. 1 deep sunset .. beyond 1 the blue hour */
  p: number;
  week: number;
  skyTop: RGB;
  skyMid: RGB;
  skyLow: RGB;
  sun: RGB;
  /** unit vector toward the sun */
  sx: number; sy: number; sz: number;
  /** everything is multiplied by this colour at the end of the frame */
  tint: RGB;
  /** strength of the glow around the sun */
  glow: number;
  /** shadows: unit ground direction, length per yard of height, darkness */
  shX: number; shZ: number; shLen: number; shA: number;
  stars: number;
  /** share of the school's windows that are lit */
  lit: number;
  cloudLit: RGB;
  cloudDark: RGB;
  dirt: RGB;
  far: RGB;
}

const KP = [0, 0.5, 1, 1.15];
function kf(p: number, v: RGB[]): RGB {
  for (let i = 0; i < KP.length - 1; i += 1) {
    if (p <= KP[i + 1]!) return mix(v[i]!, v[i + 1]!, sat((p - KP[i]!) / (KP[i + 1]! - KP[i]!)));
  }
  return v[v.length - 1]!;
}
function kn(p: number, v: number[]): number {
  for (let i = 0; i < KP.length - 1; i += 1) {
    if (p <= KP[i + 1]!) return lerp(v[i]!, v[i + 1]!, sat((p - KP[i]!) / (KP[i + 1]! - KP[i]!)));
  }
  return v[v.length - 1]!;
}

/** day 0..27: the weekday sets how late it is, the week shifts the colours a little. */
export function lightOf(day: number): Light {
  const d = ((Math.floor(day) % 7) + 7) % 7;
  const week = Math.floor(((Math.floor(day) % 28) + 28) % 28 / 7);
  const p = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.15][d]!;
  // each week leans a little toward gold, rose, amber or violet
  const lean: RGB = ([[255, 214, 150], [255, 170, 190], [255, 190, 120], [200, 170, 255]] as RGB[])[week]!;
  const w = 0.14;
  const skyTop = kf(p, [[72, 142, 222], [66, 98, 176], [42, 44, 112], [18, 22, 66]]);
  const skyMid = mix(kf(p, [[146, 200, 240], [222, 164, 156], [206, 96, 112], [92, 70, 132]]), lean, w);
  const skyLow = mix(kf(p, [[255, 238, 200], [255, 194, 124], [255, 142, 72], [226, 120, 92]]), lean, w);
  const sun = kf(p, [[255, 246, 214], [255, 220, 150], [255, 150, 80], [255, 120, 90]]);
  const el = kn(p, [0.36, 0.2, 0.07, -0.03]);
  // low over the left end of the school, so it sinks into the picture as the week goes on
  const az = Math.atan2(-0.9, -0.44) + (week - 1.5) * 0.07;
  const ce = Math.cos(el);
  const tint = mix(kf(p, [[255, 250, 240], [255, 230, 204], [255, 204, 178], [176, 178, 226]]), lean, 0.06);
  return {
    p, week, skyTop, skyMid, skyLow, sun,
    sx: Math.cos(az) * ce, sy: Math.sin(el), sz: Math.sin(az) * ce,
    tint,
    glow: kn(p, [0.5, 0.75, 1, 0.45]),
    shX: -Math.cos(az), shZ: -Math.sin(az),
    shLen: kn(p, [1.15, 1.7, 2.5, 2.9]),
    shA: kn(p, [0.34, 0.32, 0.28, 0.1]),
    stars: kn(p, [0, 0, 0.45, 1]),
    lit: kn(p, [0.18, 0.4, 0.72, 0.95]),
    cloudLit: mix(kf(p, [[255, 250, 240], [255, 214, 170], [255, 150, 120], [220, 130, 140]]), lean, 0.1),
    cloudDark: kf(p, [[196, 210, 232], [170, 150, 190], [110, 84, 150], [50, 48, 100]]),
    dirt: kf(p, [[198, 170, 128], [196, 160, 118], [186, 140, 104], [120, 104, 116]]),
    far: mix(kf(p, [[120, 150, 150], [130, 110, 130], [90, 60, 100], [36, 34, 76]]), skyLow, 0.25),
  };
}

// ------------------------------------------------------------------ where things stand

export const SLED = { x: 27, z: 16 };
export const DUMMIES: [number, number][] = [[32, 5], [34, 8.5], [36, 12]];
export const CONES: [number, number][] = [[8, 19.4], [14, 19.4], [20, 19.4], [26, 19.4], [32, 19.4], [8, 22.3], [14, 22.3], [20, 22.3], [26, 22.3], [32, 22.3]];
export const BOARD = { x: 20, z: -2.4 };
export const CART = { x: 6, z: 12.5 };
export const BENCH = { x: 15.5, z: 26.8 };
export const CENTER = { x: 20, z: 12 };

/** A hero's positions in the line-up (null: not on that unit). */
export type Unit = 'QB' | 'RB' | 'WR' | 'OL' | 'DL' | 'LB' | 'CB' | 'S';
export interface Post { off: Unit | null; def: Unit | null }
/** Linemen practise with linemen: the offense's position decides, the defense's only for a hero who plays no offense. */
export const isLine = (p: Post | null | undefined): boolean => !!p && (p.off ? p.off === 'OL' : p.def === 'DL');

export interface Station {
  x: number;
  z: number;
  /**
   * tossA: the quarterback, throwing to the receivers (tossB) in turn. sled: the linemen drive the sled together.
   * bag: a lineman works on a stand-up dummy (`i`). shuttle: the running back weaves the cones with a ball.
   * hops / jog / sway: footwork for whoever is left.
   */
  job: 'tossA' | 'tossB' | 'sled' | 'bag' | 'jog' | 'hops' | 'shuttle' | 'sway';
  face: 1 | -1;
  /** bag: which dummy */
  i?: number;
}

/** Warm-up stations when nothing is known about positions: one per hero in the order they were given. */
export const STATIONS: Station[] = [
  { x: 12, z: 8.5, job: 'tossA', face: 1 },
  { x: 20, z: 8.5, job: 'tossB', face: -1 },
  { x: SLED.x - 2.2, z: SLED.z, job: 'sled', face: 1 },
  { x: 15.5, z: 13.6, job: 'jog', face: 1 },
  { x: 12.5, z: 17, job: 'hops', face: 1 },
  { x: 17, z: 20.8, job: 'shuttle', face: 1 },
  { x: 29, z: 20, job: 'sway', face: -1 },
];

/**
 * Where each hero warms up, the way a football club really splits up for individual work:
 * the linemen together at the sled and the bags, the quarterback throwing to the receivers,
 * the running back through the cones, everyone else on footwork. Same order as `ids`.
 */
export function stationsFor(ids: number[], posts?: Record<number, Post>): Station[] {
  if (!posts || !ids.some((id) => posts[id])) return ids.map((_, i) => STATIONS[i % STATIONS.length]!);
  const out = new Map<number, Station>();
  const line = ids.filter((id) => isLine(posts[id])).sort((a, b) => Number(posts[b]!.off === 'OL') - Number(posts[a]!.off === 'OL'));
  line.forEach((id, k) => {
    if (k < 2) out.set(id, { x: SLED.x - 2.2, z: SLED.z + (line.length > 1 ? (k ? 0.75 : -0.75) : 0), job: 'sled', face: 1 });
    else {
      const i = (k - 2) % DUMMIES.length;
      out.set(id, { x: DUMMIES[i]![0] - 1.7, z: DUMMIES[i]![1], job: 'bag', face: 1, i });
    }
  });
  const rest = ids.filter((id) => !out.has(id));
  const qb = rest.find((id) => posts[id]?.off === 'QB');
  if (qb !== undefined) out.set(qb, { x: 11.5, z: 9, job: 'tossA', face: 1 });
  const catchers = rest.filter((id) => posts[id]?.off === 'WR');
  const SPOTS: [number, number][] = [[19.5, 7], [21, 11], [18.2, 4.6]];
  catchers.forEach((id, k) => out.set(id, { x: SPOTS[k % SPOTS.length]![0], z: SPOTS[k % SPOTS.length]![1], job: qb === undefined && k === 0 ? 'tossA' : 'tossB', face: -1 }));
  const rb = rest.find((id) => posts[id]?.off === 'RB');
  if (rb !== undefined) out.set(rb, { x: 15.5, z: 20.8, job: 'shuttle', face: 1 });
  // the substitute and anybody who only plays defense: footwork on their own
  const SPARE: Station[] = [{ x: 9.5, z: 16.2, job: 'hops', face: 1 }, { x: 14, z: 14, job: 'jog', face: 1 }, { x: 22.5, z: 15.5, job: 'sway', face: -1 }];
  let n = 0;
  for (const id of ids) {
    if (out.has(id)) continue;
    out.set(id, SPARE[n % SPARE.length]!);
    n += 1;
  }
  return ids.map((id) => out.get(id)!);
}

export interface Prop {
  kind: 'sled' | 'dummy' | 'cone' | 'cart' | 'bench' | 'board' | 'coach';
  x: number;
  z: number;
  /** depth from the camera this frame */
  sd: number;
  /** highlight 0..1 (eased toward hiTo) */
  hi: number;
  hiTo: number;
  /** sled: how far it has been pushed; dummy: lean (radians, 1.45 = down) */
  v: number;
  vTo: number;
  /** dummy: which way it falls on screen; coach: 0..1 visible */
  a: number;
  aTo: number;
  i: number;
}

const prop = (kind: Prop['kind'], x: number, z: number, i = 0): Prop => ({ kind, x, z, sd: 0, hi: 0, hiTo: 0, v: 0, vTo: 0, a: kind === 'coach' ? 0 : 1, aTo: kind === 'coach' ? 0 : 1, i });

// ------------------------------------------------------------------ baked scenery

const SCHOOL = { x0: 3, x1: 47, z: -27, h: 12.6, deep: 9 };

function bakeSchool(l: Light): Tex {
  const W = 264;
  const H = 96;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  const rnd = seeded(1234 + l.week * 7);
  // the wall faces away from the sun: in shade, picking up the colour of the sky
  const wall = mix(mix([232, 220, 196], l.skyMid, 0.25), [70, 70, 120], 0.2 + 0.3 * sat(l.p));
  const dark = scale(wall, 0.72);
  const base = 20;
  // a stair tower rises above the roof on the left third
  g.fillStyle = css(scale(wall, 0.92));
  g.fillRect(60, 0, 34, base);
  g.fillStyle = css(dark);
  g.fillRect(60, 0, 34, 2);
  // clock
  g.fillStyle = '#f4efe2';
  g.beginPath();
  g.arc(77, 10, 6, 0, TAU);
  g.fill();
  g.strokeStyle = '#3a3440';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(77, 10);
  g.lineTo(77, 5.5);
  g.moveTo(77, 10);
  g.lineTo(80.5, 11.5);
  g.stroke();
  // the main block
  g.fillStyle = css(wall);
  g.fillRect(0, base, W, H - base);
  g.fillStyle = css(dark);
  g.fillRect(0, base, W, 3);
  g.fillRect(0, H - 5, W, 5);
  const lit: RGB = [255, 214, 132];
  const glass = mix(l.skyMid, [40, 50, 90], 0.55);
  for (let floor = 0; floor < 3; floor += 1) {
    const y = base + 8 + floor * 23;
    g.fillStyle = css(scale(wall, 0.86));
    g.fillRect(0, y + 15, W, 2);
    for (let x = 6; x < W - 10; x += 13) {
      const door = floor === 2 && x > 120 && x < 146;
      if (door) continue;
      const on = rnd() < l.lit;
      g.fillStyle = css(on ? scale(lit, 0.86 + rnd() * 0.14) : scale(glass, 0.8 + rnd() * 0.3));
      g.fillRect(x, y, 9, 12);
      g.fillStyle = css(dark);
      g.fillRect(x + 4, y, 1, 12);
      g.fillRect(x, y + 6, 9, 1);
    }
  }
  // entrance with a small canopy
  g.fillStyle = css(scale(wall, 0.6));
  g.fillRect(122, H - 26, 26, 21);
  g.fillStyle = css(rnd() < 2 ? lit : glass);
  g.fillRect(126, H - 22, 8, 17);
  g.fillRect(136, H - 22, 8, 17);
  g.fillStyle = css(dark);
  g.fillRect(116, H - 29, 38, 3);
  return c;
}

function bakeTree(l: Light, variant: number): Tex {
  const c = makeCanvas(44, 56);
  const g = c.getContext('2d')!;
  const rnd = seeded(50 + variant * 13);
  const leafDark = mix([28, 66, 52], [40, 30, 80], 0.25 + 0.3 * sat(l.p));
  const leafMid = mix([52, 112, 66], [90, 60, 90], 0.12 + 0.25 * sat(l.p));
  const leafLit = mix(mix([120, 170, 80], l.sun, 0.45), [255, 255, 255], 0.05);
  g.fillStyle = css(mix([84, 60, 44], [40, 30, 60], 0.3));
  g.fillRect(20, 34, 4, 22);
  g.fillRect(17, 40, 3, 2);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 9; i += 1) blobs.push([10 + rnd() * 24, 9 + rnd() * 24, 6 + rnd() * 6]);
  const paint = (col: RGB, ox: number, oy: number, k: number): void => {
    g.fillStyle = css(col);
    for (const [x, y, r] of blobs) {
      // pixel discs
      const rr = r * k;
      for (let yy = -Math.ceil(rr); yy <= rr; yy += 1) {
        const hw = Math.floor(Math.sqrt(Math.max(0, rr * rr - yy * yy)));
        g.fillRect(Math.round(x + ox - hw), Math.round(y + oy + yy), hw * 2, 1);
      }
    }
  };
  paint(leafDark, 0, 1, 1);
  paint(leafMid, -1, -1, 0.82);
  // the low sun catches the upper left of every clump
  paint(leafLit, -3, -3, 0.42);
  return c;
}

function bakeCloud(variant: number): Tex {
  // two tones are painted as two alphas of white; the renderer tints them with the light of the day
  const c = makeCanvas(96, 32);
  const g = c.getContext('2d')!;
  const rnd = seeded(300 + variant * 31);
  const blobs: [number, number, number, number][] = [];
  for (let i = 0; i < 7; i += 1) blobs.push([14 + rnd() * 68, 14 + rnd() * 7, 9 + rnd() * 14, 4 + rnd() * 6]);
  g.fillStyle = '#ffffff';
  for (const [x, y, rx, ry] of blobs) {
    for (let yy = -Math.ceil(ry); yy <= ry; yy += 1) {
      const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))));
      g.fillRect(Math.round(x - hw), Math.round(y + yy), hw * 2, 1);
    }
  }
  // flat bottom
  g.clearRect(0, 22, 96, 10);
  return c;
}

function bakeMesh(): Tex {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(226,232,240,0.5)';
  g.lineWidth = 1;
  for (let k = -64; k < 128; k += 8) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.moveTo(k + 64, 0);
    g.lineTo(k, 64);
    g.stroke();
  }
  return c;
}

function bakeSkyline(l: Light): Tex {
  const W = 512;
  const H = 40;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d')!;
  const rnd = seeded(900 + l.week);
  // distant hills, then roofs and poles of the neighbourhood
  g.fillStyle = css(mix(l.far, l.skyLow, 0.35));
  for (let x = 0; x < W; x += 1) {
    const y = 20 + Math.sin(x * 0.045) * 5 + Math.sin(x * 0.011 + 2) * 7 + Math.sin(x * 0.11) * 1.5;
    g.fillRect(x, y, 1, H - y);
  }
  g.fillStyle = css(l.far);
  let x = 0;
  while (x < W) {
    const w = 6 + Math.floor(rnd() * 14);
    const h = 5 + Math.floor(rnd() * 9);
    g.fillRect(x, H - h, w, h);
    if (rnd() < 0.5) {
      // a pitched roof
      for (let k = 0; k < 4; k += 1) g.fillRect(x + k, H - h - k - 1 + 3, w - k * 2, 1);
    }
    if (rnd() < l.lit * 0.7) {
      g.fillStyle = 'rgba(255,214,140,0.9)';
      g.fillRect(x + 2 + Math.floor(rnd() * Math.max(1, w - 5)), H - h + 2, 2, 2);
      g.fillStyle = css(l.far);
    }
    if (rnd() < 0.3) g.fillRect(x + w + 1, H - 16, 1, 16);
    x += w + Math.floor(rnd() * 5);
  }
  return c;
}

function bakeScoreboard(short: string): Tex {
  const c = makeCanvas(120, 66);
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f3b2e';
  g.fillRect(0, 0, 120, 66);
  g.strokeStyle = '#d9d2bc';
  g.lineWidth = 2;
  g.strokeRect(2, 2, 116, 62);
  g.fillStyle = '#efe9d6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `13px ${DISPLAY_FONT}`;
  g.fillText(short, 34, 16);
  g.fillText('紅白', 88, 16);
  // hand-hung number plates
  for (const cx of [34, 88]) {
    g.fillStyle = '#f4f1e6';
    g.fillRect(cx - 13, 28, 26, 28);
    g.fillStyle = '#20242e';
    g.font = `22px ${DISPLAY_FONT}`;
    g.fillText('0', cx, 43);
  }
  g.fillStyle = '#efe9d6';
  g.font = `12px ${PIXEL_FONT}`;
  g.fillText('-', 61, 42);
  return c;
}

// ------------------------------------------------------------------ the ground

const quad = new Float64Array(12);
function q(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number): Float64Array {
  quad[0] = ax; quad[1] = ay; quad[2] = az; quad[3] = bx; quad[4] = by; quad[5] = bz;
  quad[6] = cx; quad[7] = cy; quad[8] = cz; quad[9] = dx; quad[10] = dy; quad[11] = dz;
  return quad;
}

/** The faces of an axis-aligned box that the camera can see. */
function box(P: Painter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, top: string, front: string, side: string): void {
  const cam = P.cam;
  if (cam.ex < x0) P.fill([x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], side);
  else if (cam.ex > x1) P.fill([x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0], side);
  if (cam.ez > z1) P.fill([x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], front);
  else if (cam.ez < z0) P.fill([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0], front);
  if (cam.ey > y1) P.fill([x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1], top);
}

const TREES: [number, number, number, number][] = [
  // x, z, height, variant
  [-16, -16, 12, 0], [-6, -12, 10, 1], [52, -13, 11, 2], [59, -9, 9, 0], [66, -18, 13, 1], [-24, -24, 13, 2],
  [69, 3, 11, 1], [72, 15, 12, 0], [67, 27, 10, 2], [-21, 15, 11, 1], [-25, 27, 12, 0], [51, -30, 12, 0], [-3, -31, 12, 2],
];

/** Chalk on the blackboard: strokes in board units (u -1..1 across, v 0..1 up), drawn one after another. */
const BOARD_PLAY: number[][] = [
  // the line of scrimmage
  [-0.9, 0.5, 0.9, 0.5],
  // three circles (as short strokes) for the offense
  [-0.5, 0.36, -0.42, 0.28, -0.34, 0.36, -0.42, 0.44, -0.5, 0.36],
  [-0.08, 0.36, 0, 0.28, 0.08, 0.36, 0, 0.44, -0.08, 0.36],
  [0.34, 0.36, 0.42, 0.28, 0.5, 0.36, 0.42, 0.44, 0.34, 0.36],
  // two crosses for the defense
  [-0.3, 0.62, -0.18, 0.74], [-0.18, 0.62, -0.3, 0.74],
  [0.18, 0.62, 0.3, 0.74], [0.3, 0.62, 0.18, 0.74],
  // the runner behind, and his way around the end
  [-0.08, 0.14, 0, 0.06, 0.08, 0.14, 0, 0.22, -0.08, 0.14],
  [0.1, 0.16, 0.5, 0.2, 0.72, 0.4, 0.76, 0.86],
  [0.68, 0.78, 0.76, 0.88, 0.84, 0.78],
  // a block
  [0.42, 0.46, 0.34, 0.6], [0.28, 0.58, 0.4, 0.62],
];

export class Ground {
  light: Light;
  props: Prop[] = [];
  /** the blackboard: how much of the play is drawn (0..1) */
  board = 0;
  boardTo = 0;
  boardRate = 1;
  private school: Tex;
  private trees: Tex[];
  private clouds: Tex[];
  private mesh: Tex;
  private skyline: Tex;
  private score: Tex;
  private club: RGB;
  private skies: { az: number; el: number; size: number; v: number; speed: number }[] = [];
  private tree: [number, number, number, number][];

  constructor(private short: string, color: string, day: number) {
    this.light = lightOf(day);
    this.club = rgbOf(color);
    this.school = bakeSchool(this.light);
    this.trees = [0, 1, 2].map((v) => bakeTree(this.light, v));
    this.clouds = [0, 1, 2].map((v) => bakeCloud(v));
    this.mesh = bakeMesh();
    this.skyline = bakeSkyline(this.light);
    this.score = bakeScoreboard(short);
    const rnd = seeded(71 + this.light.week * 19 + Math.floor(day) * 3);
    const n = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i += 1) {
      this.skies.push({ az: rnd() * TAU, el: 0.1 + rnd() * 0.42, size: 0.75 + rnd() * 0.9, v: Math.floor(rnd() * 3), speed: 0.004 + rnd() * 0.006 });
    }
    // far trees first
    this.tree = [...TREES].sort((a, b) => a[1] - b[1]);
    this.props.push(prop('sled', SLED.x, SLED.z));
    DUMMIES.forEach(([x, z], i) => this.props.push(prop('dummy', x, z, i)));
    CONES.forEach(([x, z], i) => this.props.push(prop('cone', x, z, i)));
    this.props.push(prop('cart', CART.x, CART.z), prop('bench', BENCH.x, BENCH.z), prop('board', BOARD.x, BOARD.z), prop('coach', 0, 0));
  }

  /** Bakes again what is written with a web font (once the font has arrived). */
  repaint(): void {
    this.score = bakeScoreboard(this.short);
  }

  find(kind: Prop['kind'], i = 0): Prop {
    return this.props.find((p) => p.kind === kind && p.i === i) ?? this.props[0]!;
  }

  highlight(kinds: Prop['kind'][]): void {
    for (const p of this.props) p.hiTo = kinds.includes(p.kind) ? 1 : 0;
  }

  step(dt: number): void {
    for (const p of this.props) {
      p.hi += (p.hiTo - p.hi) * (1 - Math.exp(-8 * dt));
      p.a += (p.aTo - p.a) * (1 - Math.exp(-9 * dt));
      const k = p.kind === 'dummy' ? (p.vTo > p.v ? 16 : 5) : 7;
      p.v += (p.vTo - p.v) * (1 - Math.exp(-k * dt));
    }
    if (this.board < this.boardTo) this.board = Math.min(this.boardTo, this.board + dt * this.boardRate);
    else if (this.board > this.boardTo) this.board = Math.max(this.boardTo, this.board - dt * 2);
  }

  // ---- drawing

  sky(P: Painter, clock: number, horizon: number, stars: number[]): void {
    const { ctx, cam, W, H, px } = P;
    const l = this.light;
    const g = ctx.createLinearGradient(0, horizon - H * 1.05, 0, horizon + H * 0.04);
    g.addColorStop(0, css(l.skyTop));
    g.addColorStop(0.62, css(mix(l.skyTop, l.skyMid, 0.75)));
    g.addColorStop(0.86, css(mix(l.skyMid, l.skyLow, 0.6)));
    g.addColorStop(1, css(l.skyLow));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, clamp(horizon + H * 0.06, 0, H));
    if (l.stars > 0.02) {
      ctx.fillStyle = '#fff6e8';
      for (let i = 0; i < stars.length; i += 4) {
        if (stars[i + 1]! < 0.22) continue;
        if (!cam.project(cam.ex + stars[i]! * 900, cam.ey + stars[i + 1]! * 900, cam.ez + stars[i + 2]! * 900)) continue;
        if (cam.sy > horizon || cam.sx < 0 || cam.sx > W || cam.sy < 0) continue;
        const tw = 0.6 + 0.4 * Math.sin(clock * (1 + stars[i + 3]! * 2) + i);
        ctx.globalAlpha = stars[i + 3]! * tw * l.stars * sat(stars[i + 1]! * 2.2 - 0.3);
        const s = Math.max(1, px * (0.7 + stars[i + 3]!));
        ctx.fillRect(cam.sx, cam.sy, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // the sun: a disc low over the roofs, and its halo
    if (l.sy > -0.02 && cam.project(cam.ex + l.sx * 900, cam.ey + l.sy * 900, cam.ez + l.sz * 900)) {
      const sx = cam.sx;
      const sy = cam.sy;
      const r = H * 0.036 * (1 + 0.5 * sat(l.p));
      const halo = ctx.createRadialGradient(sx, sy, r * 0.4, sx, sy, r * 7);
      halo.addColorStop(0, css(mix(l.sun, [255, 255, 255], 0.5), 0.9));
      halo.addColorStop(0.16, css(l.sun, 0.55));
      halo.addColorStop(0.5, css(l.sun, 0.14));
      halo.addColorStop(1, css(l.sun, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(sx - r * 7, sy - r * 7, r * 14, r * 14);
      ctx.fillStyle = css(mix(l.sun, [255, 255, 255], 0.55));
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
    }
    // clouds drift around the sky; lit from below by the low sun
    ctx.imageSmoothingEnabled = false;
    for (const c of this.skies) {
      const az = c.az + clock * c.speed;
      const ce = Math.cos(c.el);
      if (!cam.project(cam.ex + Math.cos(az) * ce * 600, cam.ey + Math.sin(c.el) * 600, cam.ez + Math.sin(az) * ce * 600)) continue;
      const w = H * 0.34 * c.size;
      const h = w / 3;
      if (cam.sx < -w || cam.sx > W + w || cam.sy > horizon + h) continue;
      this.cloud(P, this.clouds[c.v]!, cam.sx - w / 2, cam.sy - h / 2, w, h);
    }
    // a couple of birds heading home
    ctx.strokeStyle = css(mix(l.far, [20, 20, 40], 0.6), 0.85);
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i += 1) {
      const t = clock * (5 + i * 1.3) + i * 97;
      const bx = ((t + i * 60) % 300) - 120;
      const by = 26 + i * 6 + Math.sin(t * 0.21) * 2;
      if (!cam.project(bx, by, -70 - i * 14) || cam.sy > horizon) continue;
      const s = Math.max(2.5 * px, cam.ss * 0.9);
      const flap = Math.sin(clock * 9 + i * 2) * 0.55;
      ctx.lineWidth = Math.max(1, px);
      ctx.beginPath();
      ctx.moveTo(cam.sx - s, cam.sy - s * flap);
      ctx.lineTo(cam.sx, cam.sy);
      ctx.lineTo(cam.sx + s, cam.sy - s * flap);
      ctx.stroke();
    }
  }

  private tinted: Tex | null = null;

  /** A cloud in two tones: body in the shade colour, a lit rim along its underside. */
  private cloud(P: Painter, src: Tex, x: number, y: number, w: number, h: number): void {
    const l = this.light;
    if (!this.tinted) this.tinted = makeCanvas(96, 32);
    const t = this.tinted;
    const g = t.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, 96, 32);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    const gr = g.createLinearGradient(0, 4, 0, 23);
    gr.addColorStop(0, css(l.cloudDark));
    gr.addColorStop(0.55, css(mix(l.cloudDark, l.cloudLit, 0.45)));
    gr.addColorStop(1, css(l.cloudLit));
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 32);
    P.ctx.globalAlpha = 0.92;
    P.ctx.drawImage(t, x, y, w, h);
    P.ctx.globalAlpha = 1;
  }

  /** Everything beyond the field: the neighbourhood, the school, trees, fences, shed, scoreboard. */
  far(P: Painter, clock: number): void {
    const { ctx, cam, px } = P;
    const l = this.light;
    // bare ground all the way out
    P.fill([-500, 0, -500, 600, 0, -500, 600, 0, 500, -500, 0, 500], css(mix(l.dirt, l.far, 0.35)));
    // the neighbourhood: a ring of silhouettes
    const R = 190;
    const sk = this.skyline;
    const segs = 14;
    for (let i = 0; i < segs; i += 1) {
      const a0 = (i / segs) * TAU;
      const a1 = ((i + 1) / segs) * TAU;
      const x0 = CENTER.x + Math.cos(a0) * R; const z0 = CENTER.z + Math.sin(a0) * R;
      const x1 = CENTER.x + Math.cos(a1) * R; const z1 = CENTER.z + Math.sin(a1) * R;
      const sx = ((i * 131) % 5) * 90;
      P.tex(sk, sx % (sk.width - 100), 0, 100, sk.height, q(x0, 26, z0, x1, 26, z1, x0, 0, z0, x1, 0, z1), 1, 1, 3 * px, 2, false);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // the school: front in pixel art, a plain side and roof
    const S = SCHOOL;
    const wall = mix(mix([232, 220, 196], l.skyMid, 0.25), [70, 70, 120], 0.2 + 0.3 * sat(l.p));
    if (cam.ex < S.x0) P.fill([S.x0, 0, S.z, S.x0, 0, S.z - S.deep, S.x0, S.h * 0.79, S.z - S.deep, S.x0, S.h * 0.79, S.z], css(mix(wall, l.sun, 0.35)));
    else if (cam.ex > S.x1) P.fill([S.x1, 0, S.z, S.x1, 0, S.z - S.deep, S.x1, S.h * 0.79, S.z - S.deep, S.x1, S.h * 0.79, S.z], css(scale(wall, 0.7)));
    P.tex(this.school, 0, 0, this.school.width, this.school.height, q(S.x0, S.h, S.z, S.x1, S.h, S.z, S.x0, 0, S.z, S.x1, 0, S.z), 4, 1, 2.5 * px, 4, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // trees, with a slow sway
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < this.tree.length; i += 1) {
      const [x, z, h, v] = this.tree[i]!;
      if (!cam.project(x, 0, z) || cam.sd < 4) continue;
      const hh = h * cam.ss;
      const ww = hh * (44 / 56);
      if (cam.sx < -ww || cam.sx > P.W + ww) continue;
      const sway = Math.sin(clock * 0.7 + i * 1.9) * 0.012;
      ctx.setTransform(1, 0, -sway, 1, cam.sx, cam.sy);
      ctx.drawImage(this.trees[v]!, -ww / 2, -hh, ww, hh);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // the shed behind the left goal
    {
      const c: RGB = mix([150, 120, 96], l.far, 0.25);
      box(P, -17, 0, 3, -11.5, 3.6, 8.5, css(scale(c, 0.7)), css(scale(c, 0.82)), css(mix(c, l.sun, 0.3)));
      P.fill([-17.4, 3.6, 2.6, -11.1, 3.6, 2.6, -11.1, 4.9, 5.75, -17.4, 4.9, 5.75], css(mix([96, 70, 70], l.far, 0.3)));
      P.fill([-17.4, 3.6, 8.9, -11.1, 3.6, 8.9, -11.1, 4.9, 5.75, -17.4, 4.9, 5.75], css(mix([120, 84, 80], l.sun, 0.2)));
      P.fill([-11.5, 0, 4.6, -11.5, 0, 6.8, -11.5, 2.6, 6.8, -11.5, 2.6, 4.6], css(scale(c, 0.5)));
    }
    // chain-link: the far fence, the tall backstop behind the left goal, a low fence on the right
    this.fence(P, -13, -5.2, 63, -5.2, 3.4);
    this.fence(P, -9.5, -5.2, -9.5, 29, 7.5);
    this.fence(P, 63, -5.2, 63, 29, 3.4);
    // the hand-operated scoreboard on two posts, far side
    {
      const x = 39; const z = -3.6;
      const post = css(mix([190, 190, 196], l.far, 0.4));
      this.line(P, x - 2.2, 0, z, x - 2.2, 4.8, z, 0.14, post);
      this.line(P, x + 2.2, 0, z, x + 2.2, 4.8, z, 0.14, post);
      P.tex(this.score, 0, 0, this.score.width, this.score.height, q(x - 2.7, 4.9, z, x + 2.7, 4.9, z, x - 2.7, 1.9, z, x + 2.7, 1.9, z), 1, 1, 2 * px, 3, true);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  private line(P: Painter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, style: string): void {
    const { ctx, cam, px } = P;
    if (!cam.project(x0, y0, z0)) return;
    const ax = cam.sx; const ay = cam.sy; const as = cam.ss;
    if (!cam.project(x1, y1, z1)) return;
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(px, ((as + cam.ss) / 2) * w);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(cam.sx, cam.sy);
    ctx.stroke();
  }

  private fence(P: Painter, x0: number, z0: number, x1: number, z1: number, h: number): void {
    const { ctx, px } = P;
    const l = this.light;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 8));
    const metal = css(mix([206, 210, 216], l.far, 0.45));
    const rows = h > 5 ? 2 : 1;
    for (let i = 0; i < n; i += 1) {
      const ax = lerp(x0, x1, i / n); const az = lerp(z0, z1, i / n);
      const bx = lerp(x0, x1, (i + 1) / n); const bz = lerp(z0, z1, (i + 1) / n);
      P.tex(this.mesh, 0, 0, 64, 32 * rows, q(ax, h, az, bx, h, bz, ax, 0, az, bx, 0, bz), 1, 1, 3 * px, 3, true);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.line(P, ax, 0, az, ax, h + 0.2, az, 0.13, metal);
    }
    this.line(P, x1, 0, z1, x1, h + 0.2, z1, 0.13, metal);
    for (let i = 0; i < n; i += 1) {
      const ax = lerp(x0, x1, i / n); const az = lerp(z0, z1, i / n);
      const bx = lerp(x0, x1, (i + 1) / n); const bz = lerp(z0, z1, (i + 1) / n);
      this.line(P, ax, h, az, bx, h, bz, 0.1, metal);
    }
  }

  /** Long shadows of the equipment and the goals, laid on the turf before anything stands on it. */
  shadows(P: Painter): void {
    const l = this.light;
    if (l.shA < 0.02) return;
    const style = `rgba(22,10,40,${l.shA})`;
    const cast = (x0: number, z0: number, x1: number, z1: number, h: number): void => {
      const dx = l.shX * l.shLen * h;
      const dz = l.shZ * l.shLen * h;
      // the footprint swept along the shadow direction (the sun stands toward -x, -z)
      P.fill([x0, 0.01, z1, x0, 0.01, z0, x1, 0.01, z0, x1 + dx, 0.01, z0 + dz, x1 + dx, 0.01, z1 + dz, x0 + dx, 0.01, z1 + dz], style);
    };
    for (const p of this.props) {
      if (p.kind === 'sled') cast(p.x + p.v - 0.2, p.z - 1.2, p.x + p.v + 0.3, p.z + 1.2, 1.9);
      else if (p.kind === 'dummy') cast(p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4, 2.2 * Math.cos(Math.min(1.5, Math.abs(p.v))));
      else if (p.kind === 'cone') cast(p.x - 0.18, p.z - 0.18, p.x + 0.18, p.z + 0.18, 0.5);
      else if (p.kind === 'cart') cast(p.x - 0.8, p.z - 0.6, p.x + 0.8, p.z + 0.6, 1.3);
      else if (p.kind === 'bench') cast(p.x - 2.6, p.z - 0.3, p.x + 2.6, p.z + 0.3, 0.7);
      else if (p.kind === 'board') cast(p.x - 2.4, p.z - 0.1, p.x + 2.4, p.z + 0.1, 3.4);
    }
    // goal posts and the trees on the sunny side reach onto the field
    for (const gx of [-END - 0.6, FIELD + END + 0.6]) cast(gx - 0.12, WIDTH / 2 - 0.12, gx + 0.12, WIDTH / 2 + 0.12, 9);
    cast(-9.6, -5, -9.4, 10, 3.2);
    for (const [x, z, h] of TREES) {
      if (z > 0 || x > 40) continue;
      const cx = x + l.shX * l.shLen * h * 0.75;
      const cz = z + l.shZ * l.shLen * h * 0.75;
      const r = h * 0.42;
      const pts: number[] = [];
      for (let k = 0; k < 10; k += 1) {
        const a = (k / 10) * TAU;
        pts.push(cx + Math.cos(a) * r * (1 + l.shLen * 0.35 * Math.abs(l.shX)), 0.01, cz + Math.sin(a) * r);
      }
      P.fill(pts, `rgba(22,10,40,${l.shA * 0.6})`);
    }
  }

  /** A soft pulse on the turf under equipment that is being pointed at. */
  glows(P: Painter, clock: number, sprite: Tex): void {
    const { ctx, cam } = P;
    for (const p of this.props) {
      if (p.hi < 0.03 || (p.kind === 'coach' && p.a < 0.1)) continue;
      if (!cam.project(p.x + (p.kind === 'sled' ? p.v : 0), 0, p.z) || cam.sd < 1.5) continue;
      const fx = cam.sx; const fy = cam.sy;
      if (!cam.groundDir(p.x, p.z, 1, 0)) continue;
      const gxx = cam.sx; const gxy = cam.sy;
      if (!cam.groundDir(p.x, p.z, 0, 1)) continue;
      const r = (p.kind === 'cone' ? 1.1 : p.kind === 'board' || p.kind === 'bench' ? 3.4 : 2.3) * (1 + 0.12 * Math.sin(clock * 5 + p.i));
      ctx.setTransform(gxx, gxy, cam.sx, cam.sy, fx, fy);
      ctx.globalAlpha = 0.75 * p.hi;
      ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
      ctx.strokeStyle = `rgba(255,244,210,${0.8 * p.hi})`;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** A bouncing pointer over equipment that is being pointed at (drawn over everything). */
  pointers(P: Painter, clock: number): void {
    const { ctx, cam, px } = P;
    for (const p of this.props) {
      if (p.hi < 0.2 || p.kind === 'coach' || (p.kind === 'cone' && p.i !== 2 && p.i !== 7)) continue;
      const top = p.kind === 'sled' ? 2.3 : p.kind === 'dummy' ? 2.5 : p.kind === 'board' ? 3.7 : p.kind === 'cone' ? 0.9 : 1.8;
      if (!cam.project(p.x + (p.kind === 'sled' ? p.v : 0), top, p.z) || cam.sd < 2) continue;
      const s = clamp(cam.ss * 0.34, 5 * px, 13 * px);
      const y = cam.sy - s * 1.2 - Math.abs(Math.sin(clock * 5 + p.i)) * s * 0.9;
      ctx.globalAlpha = sat(p.hi * 1.4);
      ctx.fillStyle = '#fff3c4';
      ctx.strokeStyle = 'rgba(40,20,50,0.85)';
      ctx.lineWidth = Math.max(1.5, 1.4 * px);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cam.sx - s, y - s * 1.1);
      ctx.lineTo(cam.sx + s, y - s * 1.1);
      ctx.lineTo(cam.sx, y + s * 0.3);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawProp(P: Painter, p: Prop, clock: number): void {
    const { ctx, cam, px } = P;
    const l = this.light;
    const club = this.club;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lit = (c: RGB): string => css(mix(c, l.sun, 0.22));
    const shade = (c: RGB): string => css(mix(scale(c, 0.62), [40, 30, 80], 0.2));
    const hi = p.hi * (0.5 + 0.5 * Math.sin(clock * 6));
    if (p.kind === 'sled') {
      const x = p.x + p.v;
      const steel: RGB = [150, 156, 170];
      const pad = mix(scale(club, 0.8), [30, 40, 80], 0.25);
      box(P, x - 0.1, 0, p.z - 1.3, x + 2.4, 0.22, p.z - 1.05, lit(steel), shade(steel), shade(steel));
      box(P, x - 0.1, 0, p.z + 1.05, x + 2.4, 0.22, p.z + 1.3, lit(steel), shade(steel), shade(steel));
      box(P, x + 0.5, 0.22, p.z - 1.1, x + 0.75, 1.5, p.z + 1.1, lit(steel), shade(steel), shade(steel));
      for (const dz of [-0.62, 0.62]) {
        box(P, x - 0.35, 0.35, p.z + dz - 0.45, x + 0.2, 2.1, p.z + dz + 0.45, lit(pad), shade(pad), css(mix(pad, [255, 255, 255], 0.12 + 0.3 * hi)));
      }
    } else if (p.kind === 'dummy') {
      if (!cam.project(p.x, 0, p.z) || cam.sd < 1.2) return;
      const ss = cam.ss;
      const w = 0.86 * ss;
      const h = 2.3 * ss;
      const col = mix(p.i % 2 ? [208, 74, 62] : scale(club, 0.9), [255, 255, 255], 0.25 * hi);
      ctx.translate(cam.sx, cam.sy);
      ctx.rotate(p.v * (p.a >= 0 ? 1 : -1));
      ctx.fillStyle = shade(col);
      this.round(ctx, -w / 2, -h, w, h, w * 0.42);
      ctx.fillStyle = lit(col);
      this.round(ctx, -w / 2, -h, w * 0.62, h, w * 0.4);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-w / 2, -h * 0.62, w, Math.max(1, h * 0.05));
      ctx.fillStyle = 'rgba(20,16,40,0.5)';
      ctx.fillRect(-w / 2, -Math.max(1, h * 0.06), w, Math.max(1, h * 0.06));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (p.kind === 'cone') {
      if (!cam.project(p.x, 0, p.z) || cam.sd < 1.2) return;
      const ss = cam.ss;
      const w = 0.5 * ss;
      const h = 0.62 * ss;
      ctx.fillStyle = css(mix([236, 120, 48], [255, 240, 200], 0.4 * hi));
      ctx.beginPath();
      ctx.moveTo(cam.sx - w / 2, cam.sy);
      ctx.lineTo(cam.sx + w / 2, cam.sy);
      ctx.lineTo(cam.sx + w * 0.1, cam.sy - h);
      ctx.lineTo(cam.sx - w * 0.1, cam.sy - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(cam.sx - w * 0.3, cam.sy - h * 0.55, w * 0.6, Math.max(1, h * 0.16));
    } else if (p.kind === 'cart') {
      const wood: RGB = [150, 110, 78];
      box(P, p.x - 0.8, 0.5, p.z - 0.6, p.x + 0.8, 1.25, p.z + 0.6, css(scale(wood, 0.5)), shade(wood), lit(wood));
      this.line(P, p.x - 0.7, 0, p.z + 0.55, p.x - 0.7, 0.5, p.z + 0.55, 0.1, '#3a3440');
      this.line(P, p.x + 0.7, 0, p.z + 0.55, p.x + 0.7, 0.5, p.z + 0.55, 0.1, '#3a3440');
      // a heap of balls
      for (let k = 0; k < 5; k += 1) {
        if (!cam.project(p.x - 0.5 + (k % 3) * 0.5, 1.32 + (k > 2 ? 0.26 : 0), p.z - 0.15 + (k % 2) * 0.3)) continue;
        const r = Math.max(2, cam.ss * 0.26);
        ctx.fillStyle = '#8a4a24';
        ctx.strokeStyle = '#2c1408';
        ctx.lineWidth = Math.max(1, r * 0.16);
        ctx.beginPath();
        ctx.ellipse(cam.sx, cam.sy, r, r * 0.66, (k - 2) * 0.4, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
    } else if (p.kind === 'bench') {
      const wood: RGB = [176, 138, 96];
      box(P, p.x - 2.6, 0.62, p.z - 0.32, p.x + 2.6, 0.78, p.z + 0.32, lit(wood), shade(wood), shade(wood));
      for (const dx of [-2.2, 2.2]) box(P, p.x + dx - 0.1, 0, p.z - 0.25, p.x + dx + 0.1, 0.62, p.z + 0.25, lit(wood), shade(wood), shade(wood));
      // water bottles and a towel in the club colour
      const cols: RGB[] = [[120, 190, 230], [240, 240, 244], [120, 190, 230], [250, 210, 90]];
      cols.forEach((c, k) => {
        if (!cam.project(p.x - 1.6 + k * 0.55, 0.78, p.z)) return;
        const w = Math.max(1.5 * px, cam.ss * 0.2);
        const h = cam.ss * 0.52;
        ctx.fillStyle = css(mix(c, l.sun, 0.2));
        ctx.fillRect(cam.sx - w / 2, cam.sy - h, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(cam.sx - w / 2, cam.sy - h, w, Math.max(1, h * 0.18));
      });
      box(P, p.x + 0.9, 0.78, p.z - 0.26, p.x + 2, 0.9, p.z + 0.26, lit(club), shade(club), shade(club));
    } else if (p.kind === 'board') {
      const frame: RGB = [160, 124, 88];
      const y0 = 0.95; const y1 = 3.45; const hw = 2.45;
      this.line(P, p.x - hw, 0, p.z, p.x - hw, y1 + 0.1, p.z, 0.14, shade(frame));
      this.line(P, p.x + hw, 0, p.z, p.x + hw, y1 + 0.1, p.z, 0.14, shade(frame));
      this.line(P, p.x - hw - 0.4, 0, p.z, p.x - hw + 0.4, 0, p.z, 0.12, '#3a3440');
      this.line(P, p.x + hw - 0.4, 0, p.z, p.x + hw + 0.4, 0, p.z, 0.12, '#3a3440');
      P.fill([p.x - hw, y0, p.z, p.x + hw, y0, p.z, p.x + hw, y1, p.z, p.x - hw, y1, p.z], lit(frame));
      const m = 0.13;
      P.fill([p.x - hw + m, y0 + m, p.z + 0.02, p.x + hw - m, y0 + m, p.z + 0.02, p.x + hw - m, y1 - m, p.z + 0.02, p.x - hw + m, y1 - m, p.z + 0.02],
        css(mix([32, 74, 58], [255, 255, 255], 0.1 * hi)));
      // the play, as far as it has been drawn
      const total = BOARD_PLAY.length;
      const shown = this.board * total;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(244,246,236,0.95)';
      for (let s = 0; s < total && s < shown; s += 1) {
        const st = BOARD_PLAY[s]!;
        const part = sat(shown - s);
        const n = st.length / 2;
        const upto = 1 + (n - 1) * part;
        ctx.beginPath();
        let ok = false;
        for (let k = 0; k < n && k < upto; k += 1) {
          let u = st[k * 2]!;
          let v = st[k * 2 + 1]!;
          if (k + 1 > upto && k > 0) {
            // the stroke is still being drawn: stop part of the way along this piece
            const f = upto - k;
            u = lerp(st[(k - 1) * 2]!, u, f);
            v = lerp(st[(k - 1) * 2 + 1]!, v, f);
          }
          if (!cam.project(p.x + u * (hw - 0.3), y0 + 0.2 + v * (y1 - y0 - 0.4), p.z + 0.04)) { ok = false; continue; }
          if (ok) ctx.lineTo(cam.sx, cam.sy);
          else ctx.moveTo(cam.sx, cam.sy);
          ok = true;
          ctx.lineWidth = Math.max(1.2 * px, cam.ss * 0.07);
        }
        ctx.stroke();
      }
    } else if (p.kind === 'coach') {
      if (p.a < 0.04 || !cam.project(p.x, 0, p.z) || cam.sd < 1.2) return;
      // a clipboard on a stand, a whistle on its cord: the coach is "there"
      const ss = cam.ss;
      const sx = cam.sx; const sy = cam.sy;
      ctx.globalAlpha = sat(p.a);
      ctx.strokeStyle = '#3a3440';
      ctx.lineWidth = Math.max(px, ss * 0.09);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - ss * 1.5);
      ctx.moveTo(sx - ss * 0.4, sy);
      ctx.lineTo(sx, sy - ss * 0.35);
      ctx.lineTo(sx + ss * 0.4, sy);
      ctx.stroke();
      ctx.translate(sx, sy - ss * 1.75);
      ctx.rotate(-0.12);
      ctx.fillStyle = shade([150, 110, 78]);
      ctx.fillRect(-ss * 0.42, -ss * 0.55, ss * 0.84, ss * 1.05);
      ctx.fillStyle = '#f6f2e6';
      ctx.fillRect(-ss * 0.35, -ss * 0.45, ss * 0.7, ss * 0.88);
      ctx.fillStyle = 'rgba(40,50,90,0.75)';
      for (let k = 0; k < 4; k += 1) ctx.fillRect(-ss * 0.27, -ss * 0.3 + k * ss * 0.17, ss * (0.5 - (k % 2) * 0.14), Math.max(1, ss * 0.045));
      ctx.fillStyle = '#9aa0ae';
      ctx.fillRect(-ss * 0.14, -ss * 0.62, ss * 0.28, ss * 0.12);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // whistle, swinging
      const sw = Math.sin(clock * 3) * ss * 0.1;
      ctx.strokeStyle = '#d04a3e';
      ctx.lineWidth = Math.max(1, ss * 0.035);
      ctx.beginPath();
      ctx.moveTo(sx + ss * 0.36, sy - ss * 2.2);
      ctx.lineTo(sx + ss * 0.42 + sw, sy - ss * 1.5);
      ctx.stroke();
      ctx.fillStyle = '#f0c860';
      ctx.beginPath();
      ctx.arc(sx + ss * 0.42 + sw, sy - ss * 1.44, Math.max(1.5, ss * 0.11), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr * 0.4);
    ctx.arcTo(x, y + h, x, y, rr * 0.4);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fill();
  }

  /** The colour of the evening over the finished picture, and the glow of the sun in the lens. */
  wash(P: Painter): void {
    const { ctx, cam, W, H } = P;
    const l = this.light;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = css(l.tint);
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    if (l.sy > -0.05 && cam.project(cam.ex + l.sx * 900, cam.ey + Math.max(0.02, l.sy) * 900, cam.ez + l.sz * 900)) {
      const sx = cam.sx; const sy = cam.sy;
      const r = Math.hypot(W, H) * 0.5;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, css(l.sun, 0.34 * l.glow));
      g.addColorStop(0.3, css(l.sun, 0.13 * l.glow));
      g.addColorStop(1, css(l.sun, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      // the sun is behind the camera or off to the side: a warm breath from that edge
      const side = cam.fx * l.sz - cam.fz * l.sx > 0 ? W : 0;
      const g = ctx.createLinearGradient(side, 0, W - side, 0);
      g.addColorStop(0, css(l.sun, 0.12 * l.glow));
      g.addColorStop(0.6, css(l.sun, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ------------------------------------------------------------------ drills

export type GCue = { t: number } & (
  | { c: 'step' }
  | { c: 'whistle'; who?: number }
  | { c: 'throw'; who: number }
  | { c: 'catch'; who: number }
  | { c: 'impact'; x: number; z: number; power: number; a?: number; b?: number }
  | { c: 'chalk' }
  | { c: 'payoff'; who: number }
  | { c: 'jump'; who: number; h: number; dur: number }
  | { c: 'crouch'; who: number; on: boolean }
  | { c: 'tumble'; who: number; dir: 1 | -1; down: number }
  | { c: 'flip'; who: number }
  | { c: 'topple'; i: number; dir: 1 | -1 }
  | { c: 'rock'; i: number }
  | { c: 'sled'; dx: number }
  | { c: 'aura'; who: number; on: boolean }
  | { c: 'carry'; who: number; on: boolean }
  | { c: 'lines'; on: boolean }
  | { c: 'dust'; x: number; z: number }
  | { c: 'coach'; x: number; z: number }
  | { c: 'board'; rate: number }
  | { c: 'end' }
);

export interface BallArc {
  t0: number;
  t1: number;
  from: [number, number, number];
  to: [number, number, number];
  h: number;
  spiral: boolean;
}

export interface DrillPlan {
  kind: DrillKind;
  /** when the action is over (hooks.onEnd) and when the picture has settled (the promise resolves) */
  end: number;
  dur: number;
  keys: Map<number, Key[]>;
  cues: GCue[];
  balls: BallArc[];
  /** heroes the camera frames */
  focus: number[];
  /** which way a hero looks while standing during the drill */
  face: Map<number, 1 | -1>;
  /** ring colour for the scout side of a scrimmage */
  rings: Map<number, string>;
  /** a point the camera may use (line of scrimmage, the board, ...) */
  camX: number;
  camZ: number;
  /** solo: what the lead is doing (camX is then the side the camera stands on: +1 or -1) */
  solo: 'spd' | 'pas' | 'cat' | 'blk' | 'tkl' | 'iq';
}

export interface DrillActor { id: number; x: number; z: number; off?: Unit | null; def?: Unit | null }

const tmp = { x: 0, z: 0 };

/** Writes the script of one drill, starting from wherever the heroes are right now. */
export function buildDrill(kind: DrillKind, actors: DrillActor[], lead: number | undefined, best: DrillPlan['solo']): DrillPlan {
  const keys = new Map<number, Key[]>();
  for (const a of actors) keys.set(a.id, [{ t: 0, x: a.x, z: a.z }]);
  const cues: GCue[] = [];
  const balls: BallArc[] = [];
  const face = new Map<number, 1 | -1>();
  const rings = new Map<number, string>();
  let focus = actors.map((a) => a.id);
  let end = 1.62;
  let camX = CENTER.x;
  let camZ = CENTER.z;
  const go = (id: number, t: number, x: number, z: number, hard = false): void => {
    const k = keys.get(id);
    if (!k) return;
    const last = k[k.length - 1]!;
    const key: Key = { t: Math.max(t, last.t + 0.02), x: clamp(x, -3.5, FIELD + 3.5), z: clamp(z, 0.6, WIDTH - 0.6) };
    if (hard) key.hard = true;
    k.push(key);
  };
  const at = (id: number, t: number): [number, number] => {
    const k = keys.get(id);
    if (!k) return [CENTER.x, CENTER.z];
    evalKeys(k, t, tmp);
    return [tmp.x, tmp.z];
  };
  /** a ball from one hero's hands to another's, resolved once all paths are written */
  const throws: { t0: number; dur: number; from: number | [number, number, number]; to: number | [number, number, number]; h: number; lift: number }[] = [];
  const toss = (from: number | [number, number, number], to: number | [number, number, number], t0: number, dur: number, h: number, lift = 0): void => {
    throws.push({ t0, dur, from, to, h, lift });
    if (typeof from === 'number') {
      cues.push({ t: t0, c: 'throw', who: from }, { t: t0, c: 'carry', who: from, on: false });
    }
    if (typeof to === 'number') cues.push({ t: t0 + dur, c: 'catch', who: to }, { t: t0 + dur, c: 'carry', who: to, on: true });
  };
  const steps = (t0: number, t1: number, every: number): void => {
    for (let t = t0; t <= t1; t += every) cues.push({ t, c: 'step' });
  };
  const leadActor = actors.find((a) => a.id === lead) ?? actors[0]!;
  const dist = (a: DrillActor, x: number, z: number): number => Math.hypot(a.x - x, a.z - z);
  // position groups: linemen work with linemen, the backs and receivers with each other
  const grouped = actors.some((a) => a.off || a.def);
  const inLine = (a: DrillActor): boolean => isLine({ off: a.off ?? null, def: a.def ?? null });
  const line = grouped ? actors.filter(inLine) : [];
  const skill = grouped ? actors.filter((a) => !inLine(a)) : actors;
  const passer = actors.find((a) => a.off === 'QB');
  /** two linemen, one protecting and one rushing: set, punch, reset, punch */
  const passSet = (a: DrillActor, b: DrillActor, d: number): void => {
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const mx = clamp((l.x + r.x) / 2, 8, 44);
    const mz = (l.z + r.z) / 2;
    face.set(l.id, 1);
    face.set(r.id, -1);
    go(l.id, 0.34, mx - 1.5, mz);
    go(r.id, 0.34, mx + 1.7, mz);
    cues.push({ t: 0.3, c: 'crouch', who: l.id, on: true }, { t: 0.3, c: 'crouch', who: r.id, on: true });
    cues.push({ t: 0.5 + d, c: 'crouch', who: l.id, on: false }, { t: 0.5 + d, c: 'crouch', who: r.id, on: false });
    // the protector gives ground, the rusher comes: they meet twice
    go(l.id, 0.66 + d, mx - 2.1, mz, true);
    go(r.id, 0.66 + d, mx - 0.7, mz, true);
    go(l.id, 0.92 + d, mx - 2.4, mz + 0.5);
    go(r.id, 0.92 + d, mx + 0.4, mz + 0.5);
    go(l.id, 1.22 + d, mx - 2.9, mz + 0.5, true);
    go(r.id, 1.22 + d, mx - 1.5, mz + 0.5, true);
    go(l.id, 1.56, mx - 3.1, mz + 0.5);
    go(r.id, 1.56, mx - 0.6, mz + 0.5);
    cues.push({ t: 0.66 + d, c: 'impact', x: mx - 1.4, z: mz, power: 0.45, a: l.id, b: r.id }, { t: 1.22 + d, c: 'impact', x: mx - 2.2, z: mz + 0.5, power: 0.6, a: l.id, b: r.id });
    cues.push({ t: 1.26 + d, c: 'payoff', who: l.id }, { t: 1.3 + d, c: 'payoff', who: r.id });
  };
  /** a lineman alone works on the nearest bag: two shots */
  const bagWork = (o: DrillActor, d: number): void => {
    const di = DUMMIES.map((p, i) => [dist(o, p[0], p[1]), i] as const).sort((p, r) => p[0] - r[0])[0]![1];
    const [dx, dz] = DUMMIES[di]!;
    const tc = clamp(0.4 + dist(o, dx, dz) / 17, 0.6, 0.95) + d;
    face.set(o.id, 1);
    go(o.id, tc, dx - 1, dz, true);
    go(o.id, tc + 0.22, dx - 1.9, dz);
    go(o.id, tc + 0.5, dx - 1, dz, true);
    go(o.id, tc + 0.72, dx - 1.8, dz);
    cues.push({ t: tc, c: 'impact', x: dx - 0.4, z: dz, power: 0.5, a: o.id }, { t: tc, c: 'rock', i: di });
    cues.push({ t: tc + 0.5, c: 'impact', x: dx - 0.4, z: dz, power: 0.65, a: o.id }, { t: tc + 0.5, c: 'rock', i: di }, { t: tc + 0.54, c: 'payoff', who: o.id });
  };

  if (kind === 'dash') {
    cues.push({ t: 0.18, c: 'whistle' }, { t: 0.4, c: 'lines', on: true }, { t: 1.22, c: 'lines', on: false });
    // the backs and receivers go first and further; the linemen come out of their stance a beat behind them
    [...skill, ...line].forEach((a, j) => {
      const big = line.includes(a);
      const d = big ? 0.14 : 0;
      const x1 = Math.min(a.x + (big ? 9.5 : 14), 45);
      cues.push({ t: 0, c: 'crouch', who: a.id, on: true }, { t: 0.2 + d + j * 0.02, c: 'crouch', who: a.id, on: false });
      face.set(a.id, 1);
      go(a.id, 0.22 + d + j * 0.025, a.x, a.z);
      go(a.id, 1.18 + d * 0.5 + j * 0.03, x1, a.z, true);
      go(a.id, 1.6, Math.min(x1 + 1.8, 47), a.z);
      cues.push({ t: 1.2 + d * 0.5 + j * 0.045, c: 'payoff', who: a.id });
    });
    steps(0.3, 1.16, 0.108);
  } else if (kind === 'pass') {
    const targets = skill.filter((a) => a !== passer);
    if (passer && targets.length) {
      // routes on air: the quarterback sets up and hits each receiver in turn as he breaks
      const qx = clamp(passer.x, 8, 15);
      const qz = clamp(passer.z, 6, 16);
      go(passer.id, 0.28, qx, qz);
      go(passer.id, 0.5, qx - 1.1, qz);
      face.set(passer.id, 1);
      cues.push({ t: 0.08, c: 'carry', who: passer.id, on: true });
      targets.slice(0, 4).forEach((r, k) => {
        const tc = 0.86 + k * 0.24;
        const cut = k % 2 ? 2.6 : -2.6;
        const x0 = Math.max(r.x, qx + 6);
        face.set(r.id, 1);
        go(r.id, 0.2 + k * 0.04, r.x, r.z);
        go(r.id, tc - 0.26, x0 + 4.5, r.z);
        go(r.id, tc, x0 + 6.6, r.z + cut, true);
        go(r.id, Math.min(1.72, tc + 0.36), x0 + 8.4, r.z + cut * 1.4);
        toss(passer.id, r.id, tc - 0.4, 0.4, 1.4 + (k % 2) * 0.5, 0.3);
        if (k < Math.min(targets.length, 4) - 1) cues.push({ t: tc - 0.36, c: 'carry', who: passer.id, on: true });
        cues.push({ t: tc - 0.12, c: 'jump', who: r.id, h: 0.4, dur: 0.26 }, { t: tc + 0.04, c: 'payoff', who: r.id });
      });
      for (const r of targets.slice(4)) cues.push({ t: 1.4, c: 'payoff', who: r.id });
      cues.push({ t: 1.5, c: 'payoff', who: passer.id });
      for (const r of targets) cues.push({ t: 2.05, c: 'carry', who: r.id, on: false });
      steps(0.3, 0.8, 0.15);
      camX = qx + 6;
      camZ = qz;
      focus = [passer.id, ...targets.map((r) => r.id)];
    } else {
      const pairs: [DrillActor, DrillActor][] = [];
      for (let i = 0; i + 1 < skill.length && pairs.length < 3; i += 2) pairs.push([skill[i]!, skill[i + 1]!]);
      pairs.forEach(([p, r], k) => {
        const [a, b] = p.x <= r.x ? [p, r] : [r, p];
        const mx = clamp((a.x + b.x) / 2, 8, 40);
        const z = (a.z + b.z) / 2 + (k - 1) * 0.6;
        const d = 0.06 * k;
        go(a.id, 0.3, mx - 4.6, z);
        go(b.id, 0.3, mx + 4.6, z);
        face.set(a.id, 1);
        face.set(b.id, -1);
        cues.push({ t: 0.05, c: 'carry', who: a.id, on: true });
        toss(a.id, b.id, 0.36 + d, 0.42, 1.5, 0.3);
        cues.push({ t: 0.6 + d, c: 'jump', who: b.id, h: 0.35, dur: 0.26 }, { t: 0.8 + d, c: 'payoff', who: b.id });
        toss(b.id, a.id, 0.98 + d, 0.42, 1.5, 0.3);
        cues.push({ t: 1.22 + d, c: 'jump', who: a.id, h: 0.35, dur: 0.26 }, { t: 1.42 + d, c: 'payoff', who: a.id }, { t: 1.95, c: 'carry', who: a.id, on: false });
      });
      // whoever is left over throws into the ball cart
      for (let i = pairs.length * 2; i < skill.length; i += 1) {
        const a = skill[i]!;
        face.set(a.id, a.x > CART.x ? -1 : 1);
        cues.push({ t: 0.1, c: 'carry', who: a.id, on: true });
        toss(a.id, [CART.x, 1.35, CART.z], 0.5, 0.55, 2.6);
        cues.push({ t: 0.9, c: 'carry', who: a.id, on: true });
        toss(a.id, [CART.x, 1.35, CART.z], 1.05, 0.5, 2.6);
        cues.push({ t: 1.5, c: 'payoff', who: a.id });
      }
    }
    // meanwhile the linemen work on pass protection, one on one
    for (let i = 0; i + 1 < line.length; i += 2) passSet(line[i]!, line[i + 1]!, i * 0.03);
    if (line.length % 2) bagWork(line[line.length - 1]!, 0);
  } else if (kind === 'catch') {
    const T = passer ?? [...skill].sort((p, r) => dist(p, CART.x, CART.z) - dist(r, CART.x, CART.z))[0] ?? actors[0]!;
    const rest = skill.filter((a) => a !== T);
    // the linemen do the drill linemen do with a ball: a loose one hits the turf, fall on it
    line.forEach((l, k) => {
      if (l === T) return;
      const tc = 0.92 + k * 0.16;
      const px = clamp(l.x + (k % 2 ? -2.4 : 2.6), 6, 44);
      const pz = clamp(l.z + (k % 2 ? 1.4 : -1.2), 2, WIDTH - 2);
      face.set(l.id, px >= l.x ? 1 : -1);
      toss([CART.x, 1.35, CART.z], [px, 0.25, pz], tc - 0.5, 0.5, 2.2);
      go(l.id, tc - 0.42, l.x, l.z);
      go(l.id, tc, px - (px >= l.x ? 0.4 : -0.4), pz, true);
      cues.push({ t: tc - 0.06, c: 'tumble', who: l.id, dir: px >= l.x ? 1 : -1, down: 0.34 }, { t: tc, c: 'dust', x: px, z: pz });
      cues.push({ t: tc, c: 'catch', who: l.id }, { t: tc, c: 'carry', who: l.id, on: true }, { t: tc + 0.06, c: 'payoff', who: l.id }, { t: 2.05, c: 'carry', who: l.id, on: false });
    });
    go(T.id, 0.26, CART.x + 1.9, CART.z + 0.4);
    face.set(T.id, 1);
    cues.push({ t: 0.12, c: 'carry', who: T.id, on: true });
    rest.forEach((r, k) => {
      const tc = 0.98 + k * 0.1;
      const cut = k % 2 ? 2.4 : -2.4;
      const x0 = Math.max(r.x, CART.x + 5);
      face.set(r.id, 1);
      go(r.id, 0.18 + k * 0.05, r.x, r.z);
      go(r.id, tc - 0.3, x0 + 6.5, r.z);
      go(r.id, tc, x0 + 9, r.z + cut, true);
      go(r.id, Math.min(1.7, tc + 0.4), x0 + 11.2, r.z + cut * 1.3);
      if (k < 4) {
        toss(T.id, r.id, tc - 0.66, 0.66, 3.6 + (k % 2) * 0.8, 0.9);
        if (k < 3) cues.push({ t: tc - 0.64, c: 'carry', who: T.id, on: true });
        cues.push({ t: tc - 0.2, c: 'jump', who: r.id, h: 1.0, dur: 0.42 });
      }
      cues.push({ t: tc + 0.02, c: 'payoff', who: r.id });
    });
    cues.push({ t: 1.45, c: 'payoff', who: T.id }, { t: 2.0, c: 'carry', who: T.id, on: false });
    for (const r of rest) cues.push({ t: 2.05, c: 'carry', who: r.id, on: false });
    steps(0.3, 0.9, 0.15);
    camX = CART.x;
    camZ = CART.z;
  } else if (kind === 'hit') {
    const order = [...actors].sort((p, r) => dist(p, SLED.x, SLED.z) - dist(r, SLED.x, SLED.z));
    const crew = line.length ? line.slice(0, 2) : order.slice(0, 2);
    // the backs and receivers each take a stand-up bag (two shots with the shoulder); whoever is left pairs off
    const bags = grouped ? skill.slice(0, DUMMIES.length) : [];
    const taken = new Set<number>();
    bags.forEach((o, k) => {
      const di = DUMMIES.map((p, i) => [taken.has(i) ? 1e9 : dist(o, p[0], p[1]), i] as const).sort((p, r) => p[0] - r[0])[0]![1];
      taken.add(di);
      const [dx, dz] = DUMMIES[di]!;
      const tc = clamp(0.4 + dist(o, dx, dz) / 20, 0.62, 1.0) + k * 0.04;
      face.set(o.id, 1);
      go(o.id, tc, dx - 1, dz, true);
      go(o.id, tc + 0.24, dx - 2.2, dz);
      go(o.id, tc + 0.52, dx - 1, dz, true);
      go(o.id, tc + 0.74, dx - 1.9, dz);
      cues.push({ t: tc, c: 'impact', x: dx - 0.4, z: dz, power: 0.45, a: o.id }, { t: tc, c: 'rock', i: di });
      cues.push({ t: tc + 0.52, c: 'impact', x: dx - 0.4, z: dz, power: 0.6, a: o.id }, { t: tc + 0.52, c: 'rock', i: di }, { t: tc + 0.56, c: 'payoff', who: o.id });
    });
    const rest = order.filter((a) => !crew.includes(a) && !bags.includes(a));
    crew.forEach((c, k) => {
      const z = SLED.z + (crew.length < 2 ? 0 : k ? 0.65 : -0.65);
      face.set(c.id, 1);
      go(c.id, 0.5, SLED.x - 1.25, z, true);
      go(c.id, 0.98, SLED.x + 1.35, z);
      go(c.id, 1.1, SLED.x + 1.1, z);
      go(c.id, 1.18, SLED.x + 1.35, z, true);
      go(c.id, 1.56, SLED.x + 2.7, z);
      cues.push({ t: 1.2 + k * 0.05, c: 'payoff', who: c.id });
    });
    cues.push({ t: 0.5, c: 'impact', x: SLED.x - 0.5, z: SLED.z, power: 0.85, a: crew[0]?.id, b: crew[1]?.id }, { t: 0.5, c: 'sled', dx: 2.6 });
    cues.push({ t: 1.18, c: 'impact', x: SLED.x + 2.1, z: SLED.z, power: 0.6, a: crew[0]?.id, b: crew[1]?.id }, { t: 1.18, c: 'sled', dx: 1.4 });
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const [a, b] = rest[i]!.x <= rest[i + 1]!.x ? [rest[i]!, rest[i + 1]!] : [rest[i + 1]!, rest[i]!];
      const mx = clamp((a.x + b.x) / 2, 6, 44);
      const mz = (a.z + b.z) / 2;
      const d = i * 0.03;
      face.set(a.id, 1);
      face.set(b.id, -1);
      go(a.id, 0.6 + d, mx - 0.75, mz, true);
      go(b.id, 0.6 + d, mx + 0.75, mz, true);
      go(a.id, 0.9 + d, mx - 2.1, mz);
      go(b.id, 0.9 + d, mx + 2.1, mz);
      go(a.id, 1.28 + d, mx - 0.75, mz, true);
      go(b.id, 1.28 + d, mx + 0.75, mz, true);
      go(a.id, 1.58, mx - 1.7, mz);
      go(b.id, 1.58, mx + 1.7, mz);
      cues.push({ t: 0.6 + d, c: 'impact', x: mx, z: mz, power: 0.55, a: a.id, b: b.id }, { t: 1.28 + d, c: 'impact', x: mx, z: mz, power: 0.7, a: a.id, b: b.id });
      cues.push({ t: 0.92, c: 'crouch', who: a.id, on: true }, { t: 0.92, c: 'crouch', who: b.id, on: true }, { t: 1.06, c: 'crouch', who: a.id, on: false }, { t: 1.06, c: 'crouch', who: b.id, on: false });
      cues.push({ t: 1.3 + d, c: 'payoff', who: a.id }, { t: 1.34 + d, c: 'payoff', who: b.id });
    }
    if (rest.length % 2) {
      // the odd one out takes it out on a dummy
      const o = rest[rest.length - 1]!;
      const di = DUMMIES.map((d, i) => [dist(o, d[0], d[1]), i] as const).sort((p, r) => p[0] - r[0])[0]![1];
      const [dx, dz] = DUMMIES[di]!;
      const tc = clamp(0.35 + dist(o, dx, dz) / 17, 0.6, 1.25);
      face.set(o.id, 1);
      go(o.id, tc, dx - 1, dz, true);
      go(o.id, tc + 0.3, dx - 2, dz);
      cues.push({ t: tc, c: 'impact', x: dx - 0.4, z: dz, power: 0.5, a: o.id }, { t: tc, c: 'rock', i: di }, { t: tc + 0.04, c: 'payoff', who: o.id });
    }
    camX = SLED.x;
    camZ = SLED.z;
    focus = crew.map((c) => c.id);
  } else if (kind === 'tackle') {
    cues.push({ t: 0.1, c: 'whistle' });
    const free = [...actors];
    const bigs = [...line];
    DUMMIES.forEach(([dx, dz], i) => {
      if (grouped && !bigs.length) return;
      const from = bigs.length ? bigs : free;
      from.sort((p, r) => dist(p, dx, dz) - dist(r, dx, dz));
      const t = from.shift();
      if (!t) return;
      if (from === bigs) free.splice(free.indexOf(t), 1);
      const tc = Math.max(0.68 + i * 0.2, 0.3 + dist(t, dx, dz) / 18);
      face.set(t.id, 1);
      go(t.id, tc, dx - 0.9, dz, true);
      go(t.id, tc + 0.3, dx + 0.6, dz);
      cues.push({ t: tc - 0.06, c: 'tumble', who: t.id, dir: 1, down: 0.3 }, { t: tc, c: 'topple', i, dir: 1 });
      cues.push({ t: tc, c: 'impact', x: dx - 0.3, z: dz, power: 0.7, a: t.id }, { t: tc + 0.03, c: 'payoff', who: t.id });
    });
    // the others pair off: one runs, one chases him down and wraps him up
    for (let i = 0; i + 1 < free.length; i += 2) {
      const [c, r] = free[i]!.x <= free[i + 1]!.x ? [free[i]!, free[i + 1]!] : [free[i + 1]!, free[i]!];
      const tk = 1.02 + i * 0.12;
      const mz = (c.z + r.z) / 2;
      const ex = Math.min(r.x + 5.5, 44);
      go(r.id, 0.25, r.x, r.z);
      go(r.id, tk, ex, mz, true);
      go(r.id, tk + 0.3, ex + 0.8, mz);
      go(c.id, 0.3, c.x, c.z);
      go(c.id, tk, ex - 0.85, mz, true);
      go(c.id, tk + 0.3, ex - 0.1, mz);
      cues.push({ t: tk, c: 'impact', x: ex - 0.4, z: mz, power: 0.62, a: c.id, b: r.id });
      cues.push({ t: tk, c: 'tumble', who: r.id, dir: 1, down: 0.3 }, { t: tk - 0.05, c: 'tumble', who: c.id, dir: 1, down: 0.26 });
      cues.push({ t: tk + 0.03, c: 'payoff', who: c.id }, { t: tk + 0.08, c: 'payoff', who: r.id });
    }
    if (free.length % 2) cues.push({ t: 1.4, c: 'payoff', who: free[free.length - 1]!.id });
    steps(0.3, 0.9, 0.12);
    camX = DUMMIES[1]![0];
    camZ = DUMMIES[1]![1];
  } else if (kind === 'study') {
    const sorted = grouped ? [...line, ...skill] : [...actors].sort((p, r) => p.x - r.x);
    const half = grouped && line.length ? line.length : Math.ceil(sorted.length / 2);
    sorted.forEach((a, j) => {
      const left = j < half;
      const k = left ? half - 1 - j : j - half;
      const x = BOARD.x + (left ? -1 : 1) * (3.5 + k * 2.3);
      go(a.id, 0.5 + j * 0.02, x, 1.5 + (k % 2) * 1.6);
      face.set(a.id, left ? 1 : -1);
      cues.push({ t: 1.0 + j * 0.05, c: 'jump', who: a.id, h: 0.3, dur: 0.22 }, { t: 1.36 + j * 0.035, c: 'payoff', who: a.id });
    });
    cues.push({ t: 0.42, c: 'board', rate: 1.05 });
    for (const t of [0.48, 0.7, 0.92, 1.14, 1.36]) cues.push({ t, c: 'chalk' });
    camX = BOARD.x;
    camZ = BOARD.z;
  } else if (kind === 'game') {
    const L = clamp(actors.reduce((s, a) => s + a.x, 0) / Math.max(1, actors.length), 15, 30);
    const pool = [...actors];
    // the one nearest the camera side watches with the whistle
    pool.sort((p, r) => r.z - p.z);
    let ref = pool.length > 6 ? pool.shift() : undefined;
    pool.sort((p, r) => p.x - r.x);
    let [rb, qb, ol, dl, lb, cb]: (DrillActor | undefined)[] = pool;
    if (grouped) {
      // everybody lines up where they really play: the offense against a scout defense made of team-mates
      const left = [...pool, ...(ref ? [ref] : [])];
      const take = (want: (a: DrillActor) => boolean): DrillActor | undefined => {
        const i = left.findIndex(want);
        return i < 0 ? undefined : left.splice(i, 1)[0];
      };
      qb = take((a) => a.off === 'QB');
      rb = take((a) => a.off === 'RB');
      ol = take((a) => a.off === 'OL');
      dl = take((a) => a.def === 'DL' || a.off === 'OL');
      lb = take((a) => a.def === 'LB' || a.def === 'S');
      cb = take((a) => a.def === 'CB');
      qb ??= left.shift();
      rb ??= left.shift();
      ol ??= left.shift();
      dl ??= left.shift();
      lb ??= left.shift();
      cb ??= left.shift();
      ref = left.shift();
    }
    const spot = (a: DrillActor | undefined, x: number, z: number, f: 1 | -1): void => {
      if (!a) return;
      go(a.id, 0.32, x, z);
      face.set(a.id, f);
      cues.push({ t: 0.3, c: 'crouch', who: a.id, on: true }, { t: 0.44, c: 'crouch', who: a.id, on: false });
    };
    spot(ol, L - 1.3, 12, 1);
    spot(qb, L - 4.2, 12, 1);
    spot(rb, L - 5.9, 14.6, 1);
    spot(dl, L + 1.3, 12, -1);
    spot(lb, L + 4.6, 10.8, -1);
    spot(cb, L + 3.6, 17.2, -1);
    for (const d of [dl, lb, cb]) if (d) rings.set(d.id, '#f6f4ea');
    if (ref) {
      go(ref.id, 0.3, L - 2.5, 21.2);
      face.set(ref.id, 1);
      cues.push({ t: 0.4, c: 'jump', who: ref.id, h: 0.4, dur: 0.26 }, { t: 1.46, c: 'payoff', who: ref.id });
    }
    cues.push({ t: 0.4, c: 'whistle', who: ref?.id });
    if (qb) cues.push({ t: 0.08, c: 'carry', who: qb.id, on: true });
    if (ol && dl) {
      go(ol.id, 0.62, L - 0.55, 12, true);
      go(dl.id, 0.62, L + 0.55, 12, true);
      go(ol.id, 1.25, L + 0.5, 12.2);
      go(dl.id, 1.25, L + 1.6, 12.2);
      cues.push({ t: 0.62, c: 'impact', x: L, z: 12, power: 0.45, a: ol.id, b: dl.id }, { t: 0.66, c: 'payoff', who: ol.id }, { t: 0.7, c: 'payoff', who: dl.id });
    }
    if (qb) {
      go(qb.id, 0.64, L - 4.7, 12.7);
      go(qb.id, 1.3, L - 4.2, 12.4);
      cues.push({ t: 0.72, c: 'payoff', who: qb.id });
    }
    if (rb) {
      go(rb.id, 0.64, L - 5, 13.5);
      go(rb.id, 0.96, L - 2.4, 17.2);
      go(rb.id, 1.32, L + 4.1, 17.7, true);
      go(rb.id, 1.6, L + 4.7, 17.7);
      if (qb) cues.push({ t: 0.64, c: 'carry', who: qb.id, on: false });
      cues.push({ t: 0.64, c: 'carry', who: rb.id, on: true }, { t: 1.36, c: 'payoff', who: rb.id }, { t: 2.0, c: 'carry', who: rb.id, on: false });
    }
    if (cb) {
      go(cb.id, 0.74, L + 3.6, 17.2);
      go(cb.id, 1.32, L + 5, 17.6, true);
      go(cb.id, 1.6, L + 5.4, 17.6);
      cues.push({ t: 1.32, c: 'impact', x: L + 4.5, z: 17.6, power: 0.75, a: cb.id, b: rb?.id }, { t: 1.34, c: 'payoff', who: cb.id });
      if (rb) cues.push({ t: 1.32, c: 'tumble', who: rb.id, dir: -1, down: 0.3 });
    }
    if (lb) {
      go(lb.id, 0.7, L + 4.6, 10.8);
      go(lb.id, 1.34, L + 3.2, 15.6);
      cues.push({ t: 1.42, c: 'payoff', who: lb.id });
    }
    steps(0.7, 1.26, 0.14);
    camX = L;
    camZ = 13.5;
  } else if (kind === 'solo') {
    // the lead comes out to the front of the ground, where nobody stands between him and the camera
    const lead = leadActor;
    focus = [lead.id];
    // (he works toward the left end: on the left stage that is toward the goal and the evening sun)
    const left = lead.x < 22;
    const side: 1 | -1 = -1;
    const a = { id: lead.id, x: left ? 10 : 33.5, z: 22.6 };
    const t0 = clamp(Math.hypot(lead.x - a.x, lead.z - a.z) / 34, 0.12, 0.42);
    go(a.id, t0, a.x, a.z);
    cues.push({ t: 0, c: 'coach', x: a.x + 3.4, z: 23.4 }, { t: Math.max(0.15, t0 - 0.05), c: 'whistle' });
    face.set(a.id, side);
    let mode = best;
    const T = 0.42;
    if (mode === 'blk') {
      // drive forward against the air, twice, low and hard
      go(a.id, T + 0.2, a.x + side * 2.4, a.z, true);
      go(a.id, T + 0.48, a.x + side * 0.8, a.z);
      go(a.id, T + 0.8, a.x + side * 3.6, a.z, true);
      go(a.id, T + 1.12, a.x + side * 3, a.z);
      cues.push({ t: T + 0.2, c: 'impact', x: a.x + side * 3, z: a.z, power: 0.6, a: a.id }, { t: T + 0.8, c: 'impact', x: a.x + side * 4.2, z: a.z, power: 0.85, a: a.id });
      cues.push({ t: T + 0.5, c: 'crouch', who: a.id, on: true }, { t: T + 0.64, c: 'crouch', who: a.id, on: false });
    } else if (mode === 'tkl') {
      // dive, roll, up, dive again
      go(a.id, T + 0.28, a.x + side * 4, a.z, true);
      go(a.id, T + 0.56, a.x + side * 4.9, a.z);
      go(a.id, T + 0.9, a.x + side * 1, a.z, true);
      go(a.id, T + 1.14, a.x + side * 0.4, a.z);
      cues.push({ t: T + 0.22, c: 'tumble', who: a.id, dir: side, down: 0.1 }, { t: T + 0.28, c: 'impact', x: a.x + side * 4.4, z: a.z, power: 0.6, a: a.id });
      cues.push({ t: T + 0.84, c: 'tumble', who: a.id, dir: -side as 1 | -1, down: 0.08 }, { t: T + 0.9, c: 'impact', x: a.x + side * 0.6, z: a.z, power: 0.75, a: a.id });
    } else if (mode === 'pas') {
      // three quick spirals at a target: the ball cart, or the nearest dummy
      const target: [number, number, number] = left ? [CART.x, 1.35, CART.z] : [DUMMIES[2]![0] - 0.3, 1.4, DUMMIES[2]![1]];
      const d = Math.hypot(target[0] - a.x, target[2] - a.z);
      face.set(a.id, target[0] >= a.x ? 1 : -1);
      for (const [k, t] of [T + 0.06, T + 0.42, T + 0.78].entries()) {
        const fly = clamp(d / 34, 0.22, 0.4);
        cues.push({ t: t - 0.2, c: 'carry', who: a.id, on: true }, { t: t - 0.12, c: 'jump', who: a.id, h: 0.3, dur: 0.24 });
        toss(a.id, [target[0], target[1] + k * 0.2, target[2]], t, fly, 0.6 + d * 0.05);
        if (!left) cues.push({ t: t + fly, c: 'rock', i: 2 }, { t: t + fly, c: 'impact', x: target[0] - 0.2, z: target[2], power: 0.3 });
      }
    } else if (mode === 'cat') {
      // balls lobbed from the cart: shuffle under each one and go up for it
      const spots: [number, number][] = [[a.x + 1.6, a.z - 1], [a.x - 1.1, a.z + 0.4], [a.x + 0.9, a.z - 0.3]];
      [T + 0.2, T + 0.6, T + 1.0].forEach((t, k) => {
        go(a.id, t, spots[k]![0], spots[k]![1]);
        toss([CART.x, 1.5, CART.z], a.id, t - 0.52, 0.52, 3.2 + k * 0.5, 0.9);
        cues.push({ t: t - 0.2, c: 'jump', who: a.id, h: 0.95, dur: 0.4 }, { t: t + 0.12, c: 'carry', who: a.id, on: false });
      });
      face.set(a.id, a.x > CART.x ? -1 : 1);
    } else if (mode === 'iq') {
      // reading the coach's notes: the play goes up on the board behind, and it clicks
      cues.push({ t: 0.3, c: 'board', rate: 1 });
      for (const t of [0.45, 0.72, 1.0, 1.28]) cues.push({ t, c: 'chalk' });
      go(a.id, T + 0.2, a.x + side * 1.4, a.z + 0.3);
      cues.push({ t: T + 0.3, c: 'jump', who: a.id, h: 0.3, dur: 0.22 }, { t: T + 0.62, c: 'jump', who: a.id, h: 0.3, dur: 0.22 }, { t: T + 0.94, c: 'jump', who: a.id, h: 0.6, dur: 0.3 });
    } else {
      mode = 'spd';
      go(a.id, T + 0.02, a.x, a.z);
      go(a.id, T + 0.4, a.x + side * 7.5, a.z, true);
      go(a.id, T + 0.8, a.x + side * 0.6, a.z, true);
      go(a.id, T + 1.14, a.x + side * 5.5, a.z);
      cues.push({ t: T - 0.14, c: 'crouch', who: a.id, on: true }, { t: T, c: 'crouch', who: a.id, on: false });
      cues.push({ t: T + 0.1, c: 'lines', on: true }, { t: T + 1.0, c: 'lines', on: false });
      cues.push({ t: T + 0.4, c: 'dust', x: a.x + side * 7.5, z: a.z }, { t: T + 0.8, c: 'dust', x: a.x + side * 0.6, z: a.z });
      steps(T + 0.06, T + 1.1, 0.1);
    }
    cues.push({ t: 1.5, c: 'payoff', who: a.id });
    return finish(kind, 1.66, 2.2, keys, cues, balls, throws, at, focus, face, rings, side, 0, mode);
  } else {
    // special: the lead shows the move out front, the others copy it a beat later
    const a = leadActor;
    const fx = clamp(a.x, 13, 27);
    const fz = 18.6;
    go(a.id, 0.3, fx, fz);
    face.set(a.id, 1);
    cues.push({ t: 0.05, c: 'aura', who: a.id, on: true }, { t: 2.0, c: 'aura', who: a.id, on: false });
    const others = actors.filter((o) => o !== a).sort((p, r) => p.x - r.x);
    const combo = (id: number, x: number, z: number, d: number): void => {
      cues.push({ t: 0.44 + d, c: 'jump', who: id, h: 1.15, dur: 0.38 });
      go(id, 0.84 + d, x, z);
      go(id, 1.08 + d, x + 3.6, z, true);
      go(id, 1.3 + d, x + 4.1, z);
      cues.push({ t: 0.9 + d, c: 'flip', who: id }, { t: 1.12 + d, c: 'jump', who: id, h: 0.9, dur: 0.34 }, { t: 1.12 + d, c: 'flip', who: id });
    };
    combo(a.id, fx, fz, 0);
    cues.push({ t: 1.2, c: 'payoff', who: a.id }, { t: 1.08, c: 'dust', x: fx + 3.6, z: fz });
    others.forEach((o, k) => {
      const x = fx - 7.4 + k * 2.9;
      const z = 10.6 + (k % 2) * 2.2;
      go(o.id, 0.4, x, z);
      face.set(o.id, 1);
      combo(o.id, x, z, 0.26);
      cues.push({ t: 1.5 + k * 0.035, c: 'payoff', who: o.id });
    });
    steps(0.86, 1.36, 0.13);
    end = 1.86;
    return finish(kind, end, 2.35, keys, cues, balls, throws, at, [a.id], face, rings, fx, fz, best);
  }
  return finish(kind, end, 2.15, keys, cues, balls, throws, at, focus, face, rings, camX, camZ, best);
}

function finish(
  kind: DrillKind, end: number, dur: number, keys: Map<number, Key[]>, cues: GCue[], balls: BallArc[],
  throws: { t0: number; dur: number; from: number | [number, number, number]; to: number | [number, number, number]; h: number; lift: number }[],
  at: (id: number, t: number) => [number, number],
  focus: number[], face: Map<number, 1 | -1>, rings: Map<number, string>, camX: number, camZ: number, solo: DrillPlan['solo'],
): DrillPlan {
  for (const th of throws) {
    let from: [number, number, number];
    let to: [number, number, number];
    if (typeof th.from === 'number') {
      const p = at(th.from, th.t0);
      from = [p[0], 1.8, p[1]];
    } else from = th.from;
    if (typeof th.to === 'number') {
      const p = at(th.to, th.t0 + th.dur);
      to = [p[0], 1.55 + th.lift, p[1]];
    } else to = th.to;
    balls.push({ t0: th.t0, t1: th.t0 + th.dur, from, to, h: th.h, spiral: true });
  }
  cues.push({ t: end, c: 'end' });
  cues.sort((a, b) => a.t - b.t);
  return { kind, end, dur, keys, cues, balls, focus, face, rings, camX, camZ, solo };
}

/** Which props a drill is about (for the hint and for the drill itself). */
export function propsOf(kind: DrillKind, solo: DrillPlan['solo']): Prop['kind'][] {
  switch (kind) {
    case 'dash': return ['cone'];
    case 'pass': return ['cart'];
    case 'catch': return ['cart'];
    case 'hit': return ['sled'];
    case 'tackle': return ['dummy'];
    case 'study': return ['board'];
    case 'game': return [];
    case 'special': return [];
    default:
      return solo === 'cat' || solo === 'pas' ? ['cart', 'coach'] : solo === 'iq' ? ['board', 'coach'] : solo === 'spd' ? ['cone', 'coach'] : ['coach'];
  }
}

/** Where the heroes look while a drill is only being considered. */
export function spotOf(kind: DrillKind, solo: DrillPlan['solo']): [number, number] {
  switch (kind) {
    case 'dash': return [20, 20.8];
    case 'pass': case 'catch': return [CART.x, CART.z];
    case 'hit': return [SLED.x, SLED.z];
    case 'tackle': return DUMMIES[1]!;
    case 'study': return [BOARD.x, BOARD.z];
    case 'game': return [CENTER.x + 2, 13];
    case 'special': return [CENTER.x, 18.6];
    default:
      return solo === 'cat' || solo === 'pas' ? [CART.x, CART.z] : solo === 'iq' ? [BOARD.x, BOARD.z] : [20, 22.6];
  }
}

