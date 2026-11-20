// Pooled particles for the stadium: dust, turf, sparks, confetti, fireworks and motes in the light.

import type { Sprites } from './assets';
import { Camera, TAU } from './math';

export const PUFF = 0;
export const CHUNK = 1;
export const SPARK = 2;
export const CONFETTI = 3;
export const MOTE = 4;
export const GLINT = 5;

export interface Particle {
  k: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** previous position, for streaks */
  px: number; py: number; pz: number;
  life: number;
  max: number;
  /** size in yards (GLINT: in pixels at depth 40) */
  size: number;
  grow: number;
  grav: number;
  drag: number;
  color: string;
  alpha: number;
  rot: number;
  spin: number;
  /** PUFF: 1 = chalk sprite */
  tex: number;
}

const blank = (): Particle => ({
  k: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0, life: 0, max: 1, size: 1, grow: 0,
  grav: 0, drag: 0, color: '#fff', alpha: 1, rot: 0, spin: 0, tex: 0,
});

export class Fx {
  private pool: Particle[] = [];
  private n = 0;

  constructor(private cap = 900) {
    for (let i = 0; i < cap; i += 1) this.pool.push(blank());
  }

  get count(): number {
    return this.n;
  }

  clear(keepMotes = true): void {
    let m = 0;
    for (let i = 0; i < this.n; i += 1) {
      const p = this.pool[i]!;
      if (keepMotes && p.k === MOTE) {
        const q = this.pool[m]!;
        this.pool[m] = p;
        this.pool[i] = q;
        m += 1;
      }
    }
    this.n = m;
  }

  /** Takes a particle from the pool (reusing the oldest slot when full) and resets it. */
  spawn(k: number, x: number, y: number, z: number): Particle {
    let p: Particle;
    if (this.n < this.cap) {
      p = this.pool[this.n]!;
      this.n += 1;
    } else {
      p = this.pool[(Math.random() * this.cap) | 0]!;
    }
    p.k = k;
    p.x = p.px = x;
    p.y = p.py = y;
    p.z = p.pz = z;
    p.vx = p.vy = p.vz = 0;
    p.life = 0;
    p.max = 1;
    p.size = 0.5;
    p.grow = 0;
    p.grav = 0;
    p.drag = 0;
    p.color = '#ffffff';
    p.alpha = 1;
    p.rot = 0;
    p.spin = 0;
    p.tex = 0;
    return p;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.n) {
      const p = this.pool[i]!;
      p.life += dt;
      if (p.life >= p.max) {
        this.n -= 1;
        this.pool[i] = this.pool[this.n]!;
        this.pool[this.n] = p;
        continue;
      }
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy -= p.grav * dt;
      if (p.drag > 0) {
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d; p.vz *= d;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      p.size += p.grow * dt;
      if (p.y < 0 && p.k !== SPARK) {
        p.y = 0;
        if (p.k === CHUNK) {
          p.vy = -p.vy * 0.35;
          p.vx *= 0.55;
          p.vz *= 0.55;
          p.spin *= 0.5;
        } else if (p.k === CONFETTI) {
          p.vx = p.vy = p.vz = 0;
          p.spin = 0;
          p.grav = 0;
          if (p.max - p.life > 0.8) p.max = p.life + 0.8;
        } else if (p.vy < 0) p.vy = 0;
      }
      i += 1;
    }
  }

  /** Alpha-blended kinds. */
  drawSolid(ctx: CanvasRenderingContext2D, cam: Camera, sp: Sprites): void {
    for (let i = 0; i < this.n; i += 1) {
      const p = this.pool[i]!;
      if (p.k !== PUFF && p.k !== CHUNK && p.k !== CONFETTI) continue;
      if (!cam.project(p.x, p.y, p.z)) continue;
      const f = p.life / p.max;
      if (p.k === PUFF) {
        const s = p.size * cam.ss * 2;
        if (s < 1) continue;
        ctx.globalAlpha = p.alpha * (f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85);
        ctx.drawImage(p.tex ? sp.chalk : sp.dust, cam.sx - s / 2, cam.sy - s / 2, s, s);
      } else if (p.k === CHUNK) {
        const s = Math.max(1.5, p.size * cam.ss);
        ctx.globalAlpha = p.alpha * (f > 0.7 ? (1 - f) / 0.3 : 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(cam.sx - s / 2, cam.sy - s / 2, s, s * 0.8);
      } else {
        const s = Math.max(2, p.size * cam.ss);
        const flip = Math.cos(p.rot * 1.7);
        ctx.globalAlpha = p.alpha * (f > 0.85 ? (1 - f) / 0.15 : 1) * (flip > 0 ? 1 : 0.7);
        ctx.fillStyle = p.color;
        const c = Math.cos(p.rot);
        const sn = Math.sin(p.rot);
        const hw = s * 0.5 * Math.max(0.15, Math.abs(flip));
        const hh = s * 0.32;
        ctx.beginPath();
        ctx.moveTo(cam.sx - c * hw + sn * hh, cam.sy - sn * hw - c * hh);
        ctx.lineTo(cam.sx + c * hw + sn * hh, cam.sy + sn * hw - c * hh);
        ctx.lineTo(cam.sx + c * hw - sn * hh, cam.sy + sn * hw + c * hh);
        ctx.lineTo(cam.sx - c * hw - sn * hh, cam.sy - sn * hw + c * hh);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Additive kinds; the caller sets globalCompositeOperation = 'lighter'. */
  drawGlow(ctx: CanvasRenderingContext2D, cam: Camera, sp: Sprites, px: number): void {
    ctx.lineCap = 'round';
    for (let i = 0; i < this.n; i += 1) {
      const p = this.pool[i]!;
      if (p.k !== SPARK && p.k !== MOTE && p.k !== GLINT) continue;
      if (!cam.project(p.x, p.y, p.z)) continue;
      const f = p.life / p.max;
      const sx = cam.sx;
      const sy = cam.sy;
      const ss = cam.ss;
      if (p.k === SPARK) {
        const a = p.alpha * (1 - f) * (1 - f * 0.4);
        if (a < 0.02) continue;
        const w = Math.max(px, p.size * ss);
        if (!cam.project(p.px - p.vx * 0.03, p.py - p.vy * 0.03, p.pz - p.vz * 0.03)) continue;
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(cam.sx, cam.sy);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      } else if (p.k === MOTE) {
        const tw = 0.5 + 0.5 * Math.sin(p.rot);
        const s = Math.max(2 * px, p.size * ss);
        ctx.globalAlpha = p.alpha * tw * Math.min(1, f * 6, (1 - f) * 6);
        ctx.drawImage(sp.warm, sx - s / 2, sy - s / 2, s, s);
      } else {
        const s = p.size * px * (0.6 + 0.4 * Math.sin(f * Math.PI)) * Math.max(0.5, Math.min(1.6, ss / 12));
        ctx.globalAlpha = p.alpha * Math.sin(f * Math.PI);
        ctx.drawImage(sp.star, sx - s / 2, sy - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** A burst of sparks on a sphere, for fireworks. */
export function burst(fx: Fx, x: number, y: number, z: number, n: number, speed: number, color: string, life: number): void {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * TAU;
    const b = Math.acos(Math.random() * 2 - 1);
    const s = speed * (0.55 + Math.random() * 0.45);
    const p = fx.spawn(SPARK, x, y, z);
    p.vx = Math.sin(b) * Math.cos(a) * s;
    p.vy = Math.cos(b) * s;
    p.vz = Math.sin(b) * Math.sin(a) * s;
    p.grav = 5;
    p.drag = 1.5;
    p.max = life * (0.7 + Math.random() * 0.5);
    p.size = 0.22;
    p.color = color;
  }
}
