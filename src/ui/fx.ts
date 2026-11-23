// Feel: everything that makes the interface react — particles on a full-screen overlay, shakes, flashes,
// the screen-change wipe, text that slams or types itself in, counting numbers, cards that tilt under the pointer.
// All of it respects the "演出" setting: with motion off there is no shake, no flash and transitions are short.

import { tr } from '../core/i18n';
import { h } from '../core/dom';
import { prefs } from '../core/save';

// ------------------------------------------------------------------ small helpers

export const motion = (): boolean => prefs().motion;

export const ease = {
  out: (t: number): number => 1 - (1 - t) ** 3,
  inOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t: number): number => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  linear: (t: number): number => t,
};

/** Calls step(0..1) every frame for ms; resolves at the end. */
export function tween(ms: number, step: (t: number) => void, curve: (t: number) => number = ease.out): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - t0) / Math.max(1, ms)));
      step(curve(t));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/** Counts a number up (or down) inside an element. */
export function countUp(el: HTMLElement, from: number, to: number, ms = 500, fmt: (v: number) => string = String, onTick?: () => void): Promise<void> {
  if (from === to || !motion()) {
    el.textContent = fmt(to);
    return Promise.resolve();
  }
  let last = from;
  return tween(ms, (t) => {
    const v = Math.round(from + (to - from) * t);
    if (v !== last) {
      last = v;
      el.textContent = fmt(v);
      onTick?.();
    }
  });
}

export const center = (el: Element): { x: number; y: number } => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Restarts a CSS animation class on an element. */
export function kick(el: Element | null, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

// ------------------------------------------------------------------ particles

type Shape = 'dot' | 'rect' | 'star' | 'ring' | 'line' | 'tri';
interface Particle {
  x: number; y: number; vx: number; vy: number; g: number; drag: number;
  life: number; max: number; size: number; grow: number; color: string; shape: Shape;
  rot: number; vr: number; add: boolean;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
const parts: Particle[] = [];
let running = false;
let last = 0;
let dpr = 1;
const MAX = 700;

function ensure(): boolean {
  if (typeof document === 'undefined') return false;
  if (canvas) return true;
  canvas = h('canvas.fx-layer', { 'aria-hidden': 'true' });
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  const size = (): void => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas!.width = Math.round(window.innerWidth * dpr);
    canvas!.height = Math.round(window.innerHeight * dpr);
  };
  size();
  window.addEventListener('resize', size);
  return !!ctx;
}

function loop(now: number): void {
  if (!ctx || !canvas) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      parts.splice(i, 1);
      continue;
    }
    p.vy += p.g * dt;
    p.vx *= 1 - p.drag * dt;
    p.vy *= 1 - p.drag * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.size += p.grow * dt;
    const k = p.life / p.max;
    ctx.globalAlpha = Math.min(1, k * 2.2);
    ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    const s = Math.max(0.5, p.size);
    if (p.shape === 'dot') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, 6.283);
      ctx.fill();
    } else if (p.shape === 'ring') {
      ctx.lineWidth = Math.max(1, s * 0.16 * k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, 6.283);
      ctx.stroke();
    } else if (p.shape === 'line') {
      ctx.lineWidth = Math.max(1, s * 0.22);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.shape === 'rect') ctx.fillRect(-s, -s * 0.5, s * 2, s * Math.abs(Math.cos(p.rot * 2.3)) + 1);
      else if (p.shape === 'tri') {
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.9, s * 0.8);
        ctx.lineTo(-s * 0.9, s * 0.8);
        ctx.fill();
      } else {
        ctx.beginPath();
        for (let j = 0; j < 8; j += 1) {
          const r = j % 2 ? s * 0.42 : s;
          ctx.lineTo(Math.cos((j * Math.PI) / 4) * r, Math.sin((j * Math.PI) / 4) * r);
        }
        ctx.fill();
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (parts.length) requestAnimationFrame(loop);
  else running = false;
}

function emit(p: Partial<Particle> & { x: number; y: number }): void {
  if (!ensure() || parts.length >= MAX) return;
  const life = p.life ?? 0.6;
  parts.push({
    vx: 0, vy: 0, g: 0, drag: 0, size: 4, grow: 0, color: '#fff', shape: 'dot', rot: Math.random() * 6.28,
    vr: 0, add: false, ...p, life, max: life,
  });
  if (!running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }
}

const rem = (): number => (typeof document === 'undefined' ? 12 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 12);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export interface BurstOpts { color?: string | string[]; count?: number; power?: number; shape?: Shape | Shape[]; gravity?: number; life?: number; size?: number; add?: boolean }

/** A pop of particles flying outward. */
export function burst(x: number, y: number, o: BurstOpts = {}): void {
  const u = rem();
  const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#ffe14a'];
  const shapes = Array.isArray(o.shape) ? o.shape : [o.shape ?? 'rect'];
  const n = motion() ? o.count ?? 14 : Math.min(6, o.count ?? 14);
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * 6.283;
    const sp = rnd(0.35, 1) * (o.power ?? 1) * u * 38;
    emit({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - u * 6, g: (o.gravity ?? 1) * u * 80, drag: 2.2,
      life: rnd(0.35, 0.8) * (o.life ?? 1), size: rnd(0.25, 0.6) * u * (o.size ?? 1), color: colors[i % colors.length]!,
      shape: shapes[i % shapes.length]!, vr: rnd(-9, 9), add: o.add ?? false,
    });
  }
}

/** Fast streaks, like metal on metal. */
export function sparks(x: number, y: number, color = '#fff6b0', count = 18, power = 1): void {
  const u = rem();
  for (let i = 0; i < (motion() ? count : 6); i += 1) {
    const a = Math.random() * 6.283;
    const sp = rnd(0.5, 1.2) * u * 70 * power;
    emit({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 4, life: rnd(0.18, 0.4), size: rnd(0.2, 0.45) * u, color, shape: 'line', add: true });
  }
}

/** An expanding ring: the answer to any tap. */
export function ring(x: number, y: number, color = '#ffe14a', size = 1): void {
  const u = rem();
  emit({ x, y, life: 0.35, size: u * 0.6 * size, grow: u * 12 * size, color, shape: 'ring' });
}

/** Paper rain from the top of the screen. */
export function confetti(colors: string[], seconds = 2.2): void {
  if (!ensure()) return;
  const u = rem();
  const total = motion() ? 140 : 30;
  for (let i = 0; i < total; i += 1) {
    setTimeout(() => emit({
      x: rnd(0, window.innerWidth), y: -u, vx: rnd(-6, 6) * u, vy: rnd(8, 20) * u, g: u * 14, drag: 0.4,
      life: rnd(1.6, 3), size: rnd(0.35, 0.7) * u, color: colors[i % colors.length]!, shape: i % 5 === 0 ? 'star' : 'rect', vr: rnd(-8, 8),
    }), Math.random() * seconds * 1000);
  }
}

/** Glittering motes rising from a spot (something was gained). */
export function glitter(x: number, y: number, color = '#ffe14a', count = 10): void {
  const u = rem();
  for (let i = 0; i < count; i += 1) {
    emit({
      x: x + rnd(-2, 2) * u, y: y + rnd(-1, 1) * u, vx: rnd(-2, 2) * u, vy: -rnd(4, 12) * u, drag: 1, life: rnd(0.5, 1.1),
      size: rnd(0.15, 0.4) * u, color, shape: 'star', vr: rnd(-4, 4), add: true,
    });
  }
}

// ------------------------------------------------------------------ whole-screen reactions

/** Shakes the game. power 1 is a firm hit. */
export function shake(power = 1, ms = 280, target: Element | null = typeof document === 'undefined' ? null : document.getElementById('app')): void {
  if (!target || !motion() || !('animate' in target)) return;
  const u = rem() * 0.5 * power;
  const frames: Keyframe[] = [];
  const n = 7;
  for (let i = 0; i < n; i += 1) {
    const k = 1 - i / n;
    frames.push({ transform: `translate(${rnd(-u, u) * k}px, ${rnd(-u, u) * k}px) rotate(${rnd(-0.4, 0.4) * power * k}deg)` });
  }
  frames.push({ transform: 'none' });
  target.animate(frames, { duration: ms, easing: 'linear' });
}

let flashEl: HTMLElement | null = null;
/** A full-screen flash of colour. */
export function flash(color = '#ffffff', ms = 220, strength = 0.7): void {
  if (!motion() || typeof document === 'undefined') return;
  if (!flashEl) {
    flashEl = h('div.fx-flash', { 'aria-hidden': 'true' });
    document.body.append(flashEl);
  }
  flashEl.style.background = color;
  flashEl.animate([{ opacity: strength }, { opacity: 0 }], { duration: ms, easing: 'ease-out' });
}

/** A number or word that pops out of a spot and floats away. */
export function pop(x: number, y: number, text: string, cls = ''): void {
  if (typeof document === 'undefined') return;
  const el = h('div.fx-pop', { class: cls, style: { left: `${x}px`, top: `${y}px` } }, text);
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 1400);
}

let wiping = false;
/**
 * The screen change: slanted bars sweep across like a referee's flag, the screen is swapped behind them, they sweep away.
 * Returns once the new screen is fully visible.
 */
export async function wipe(swap: () => void): Promise<void> {
  if (typeof document === 'undefined' || wiping || !motion()) {
    swap();
    return;
  }
  wiping = true;
  const bars = h('div.fx-wipe', { 'aria-hidden': 'true' }, Array.from({ length: 6 }, (_, i) => h('i', { style: { '--i': String(i) } })));
  document.body.append(bars);
  await new Promise((r) => setTimeout(r, 330));
  swap();
  bars.classList.add('out');
  await new Promise((r) => setTimeout(r, 360));
  bars.remove();
  wiping = false;
}

// ------------------------------------------------------------------ text

/** Text whose characters arrive one by one (CSS does the motion; each span gets its index in --i). */
export function kinetic(line: string, cls = ''): HTMLElement {
  const text = tr(line);
  return h('span.kinetic', { class: cls, 'aria-label': text },
    [...text].map((ch, i) => h('span', { 'aria-hidden': 'true', style: { '--i': String(i) } }, ch === ' ' ? ' ' : ch)));
}

export interface Typing { done: Promise<void>; skip: () => void }
/** Types text into an element. onTick fires per visible character (for a sound). */
export function typewriter(el: HTMLElement, line: string, opts: { cps?: number; onTick?: (i: number) => void } = {}): Typing {
  // (typed out whole: the English of the line, not of its first letters)
  const text = tr(line);
  let i = 0;
  let stopped = false;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const end = (): void => {
    if (stopped) return;
    stopped = true;
    el.textContent = text;
    finish();
  };
  if (!motion()) {
    end();
    return { done, skip: end };
  }
  el.textContent = '';
  const step = 1000 / (opts.cps ?? 38);
  const tick = (): void => {
    if (stopped) return;
    i += 1;
    el.textContent = text.slice(0, i);
    const ch = text[i - 1];
    if (ch && ch.trim() && i % 2 === 1) opts.onTick?.(i);
    if (i >= text.length) end();
    else setTimeout(tick, /[、。！？…]/.test(ch ?? '') ? step * 4 : step);
  };
  setTimeout(tick, step);
  return { done, skip: end };
}

// ------------------------------------------------------------------ pointer feel

/** Makes an element lean toward the pointer like a card held in the hand (sets --rx, --ry, --gx, --gy). */
export function tilt(el: HTMLElement, max = 10): HTMLElement {
  const move = (e: PointerEvent): void => {
    if (!motion()) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${(px - 0.5) * 2 * max}deg`);
    el.style.setProperty('--rx', `${(0.5 - py) * 2 * max}deg`);
    el.style.setProperty('--gx', `${px * 100}%`);
    el.style.setProperty('--gy', `${py * 100}%`);
  };
  const leave = (): void => {
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--rx', '0deg');
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  return el;
}

/**
 * Moves elements smoothly from where they were to where they are now (first-last-invert-play).
 * Call `const play = flip(nodes)` before changing the layout, then `play()` after.
 */
export function flip(nodes: Iterable<Element>, ms = 320): () => void {
  const first = new Map<Element, DOMRect>();
  for (const n of nodes) first.set(n, n.getBoundingClientRect());
  return () => {
    if (!motion()) return;
    for (const [n, a] of first) {
      if (!n.isConnected) continue;
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) continue;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    }
  };
}
