// Maths kit for the stadium renderer: easing, cheap noise, colour helpers and the look-at camera.
//
// World space: x runs along the field (0..FIELD is the playing area, the end zones lie outside it),
// z runs across it (0 = far sideline, WIDTH = the sideline next to the main camera), y is up. Units are yards.

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const sat = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const s = sat(t);
  return s * s * (3 - 2 * s);
};
export const easeOut = (t: number): number => 1 - (1 - sat(t)) ** 3;
export const easeIn = (t: number): number => sat(t) ** 2;
export const easeBack = (t: number): number => {
  const s = sat(t) - 1;
  return 1 + s * s * (2.7 * s + 1.7);
};

/** Frame-rate independent approach of `cur` toward `target`. */
export const damp = (cur: number, target: number, lambda: number, dt: number): number =>
  cur + (target - cur) * (1 - Math.exp(-lambda * dt));

/** 0..1, the same for the same n. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in -1..1. */
export function noise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i + seed * 57.31);
  const b = hash(i + 1 + seed * 57.31);
  return (a + (b - a) * f * f * (3 - 2 * f)) * 2 - 1;
}

/** A small seeded generator for baking textures (never used by the match rules). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ colour

export type RGB = [number, number, number];

export function rgbOf(color: string): RGB {
  let c = color.trim();
  if (c.startsWith('#')) {
    c = c.slice(1);
    if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
    const n = parseInt(c.slice(0, 6), 16);
    if (!Number.isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /(\d+)[^\d]+(\d+)[^\d]+(\d+)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [200, 200, 200];
}

export const css = (c: RGB, a = 1): string =>
  a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

export const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const scale = (a: RGB, k: number): RGB => [clamp(a[0] * k, 0, 255), clamp(a[1] * k, 0, 255), clamp(a[2] * k, 0, 255)];
export const luma = (c: RGB): number => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

// ------------------------------------------------------------------ camera

export const NEAR = 0.7;

/** A look-at camera. `project` and `poly` write into public scratch fields to avoid garbage. */
export class Camera {
  // pose
  ex = 25; ey = 14; ez = 46;
  tx = 25; ty = 1; tz = 11;
  /** vertical field of view, radians */
  fov = 0.56;
  roll = 0;
  // screen (device pixels)
  w = 1; h = 1; cx = 0.5; cy = 0.5; f = 1;
  // basis
  private rx = 1; private ry = 0; private rz = 0;
  private ux = 0; private uy = 1; private uz = 0;
  fx = 0; fy = 0; fz = -1;
  // result of the last project()
  sx = 0; sy = 0;
  /** device pixels per yard at that depth */
  ss = 0;
  /** distance along the view axis (<= NEAR: behind the camera) */
  sd = 0;
  /** result of the last poly(): flat x,y pairs */
  out = new Float64Array(64);

  /** Recomputes the basis. `cy` is the vertical principal point in pixels, `zoom` scales the focal length. */
  setup(w: number, h: number, cx: number, cy: number, zoom = 1): void {
    this.w = w;
    this.h = h;
    this.cx = cx;
    this.cy = cy;
    this.f = (h / 2 / Math.tan(this.fov / 2)) * zoom;
    let fx = this.tx - this.ex;
    let fy = this.ty - this.ey;
    let fz = this.tz - this.ez;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // right = forward x up
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    // up = right x forward
    let ux = -rz * fy;
    let uy = rz * fx - rx * fz;
    let uz = rx * fy;
    let ry = 0;
    if (this.roll !== 0) {
      const c = Math.cos(this.roll);
      const s = Math.sin(this.roll);
      const nrx = rx * c + ux * s;
      const nry = uy * s;
      const nrz = rz * c + uz * s;
      ux = ux * c - rx * s;
      uy = uy * c;
      uz = uz * c - rz * s;
      rx = nrx; ry = nry; rz = nrz;
    }
    this.fx = fx; this.fy = fy; this.fz = fz;
    this.rx = rx; this.ry = ry; this.rz = rz;
    this.ux = ux; this.uy = uy; this.uz = uz;
  }

  /** Projects a world point. Returns false when it is behind the near plane (sx/sy are then meaningless). */
  project(x: number, y: number, z: number): boolean {
    const dx = x - this.ex;
    const dy = y - this.ey;
    const dz = z - this.ez;
    const d = dx * this.fx + dy * this.fy + dz * this.fz;
    this.sd = d;
    if (d < NEAR) return false;
    const k = this.f / d;
    this.sx = this.cx + (dx * this.rx + dy * this.ry + dz * this.rz) * k;
    this.sy = this.cy - (dx * this.ux + dy * this.uy + dz * this.uz) * k;
    this.ss = k;
    return true;
  }

  /** Direction on screen (pixels per yard) of a ground vector at a ground point; result in sx/sy. */
  groundDir(x: number, z: number, dx: number, dz: number): boolean {
    if (!this.project(x, 0, z)) return false;
    const ax = this.sx;
    const ay = this.sy;
    if (!this.project(x + dx * 0.5, 0, z + dz * 0.5)) return false;
    this.sx = (this.sx - ax) * 2;
    this.sy = (this.sy - ay) * 2;
    return true;
  }

  /**
   * Clips a world polygon (flat x,y,z triples) against the near plane and projects it.
   * Returns the number of vertices written to `out` (0: nothing to draw).
   */
  poly(pts: ArrayLike<number>): number {
    const n = pts.length / 3;
    if (this.out.length < (n + 2) * 2) this.out = new Float64Array((n + 4) * 2);
    const out = this.out;
    let m = 0;
    let px = 0; let py = 0; let pd = 0;
    // previous vertex in camera space
    {
      const i = (n - 1) * 3;
      const dx = pts[i]! - this.ex; const dy = pts[i + 1]! - this.ey; const dz = pts[i + 2]! - this.ez;
      px = dx * this.rx + dy * this.ry + dz * this.rz;
      py = dx * this.ux + dy * this.uy + dz * this.uz;
      pd = dx * this.fx + dy * this.fy + dz * this.fz;
    }
    for (let k = 0; k < n; k += 1) {
      const i = k * 3;
      const dx = pts[i]! - this.ex; const dy = pts[i + 1]! - this.ey; const dz = pts[i + 2]! - this.ez;
      const x = dx * this.rx + dy * this.ry + dz * this.rz;
      const y = dx * this.ux + dy * this.uy + dz * this.uz;
      const d = dx * this.fx + dy * this.fy + dz * this.fz;
      const inPrev = pd >= NEAR;
      const inCur = d >= NEAR;
      if (inPrev !== inCur) {
        const t = (NEAR - pd) / (d - pd);
        const ix = px + (x - px) * t;
        const iy = py + (y - py) * t;
        out[m++] = this.cx + (ix * this.f) / NEAR;
        out[m++] = this.cy - (iy * this.f) / NEAR;
      }
      if (inCur) {
        out[m++] = this.cx + (x * this.f) / d;
        out[m++] = this.cy - (y * this.f) / d;
      }
      px = x; py = y; pd = d;
    }
    return m >> 1;
  }
}

/** A critically damped spring for one camera value. */
export class Spring {
  v = 0;
  constructor(public x: number) {}
  step(target: number, omega: number, dt: number): number {
    // semi-implicit integration, stable for the step sizes we clamp to
    const a = omega * omega * (target - this.x) - 2 * omega * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  snap(x: number): void {
    this.x = x;
    this.v = 0;
  }
}
