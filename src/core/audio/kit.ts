// The kit: a drumline, a brass section, a glockenspiel, a pea whistle and the foley of cards, chalk, pads and a ball.
// Every instrument takes the engine, a start time and a velocity (0..1) and schedules its voices; nothing is kept.
//
// One key for everything tuned: C. C-E-G sits inside both pieces of music the game plays most (it is the relative
// major of the club theme and the dominant of the match themes), so stabs never fight the BGM.

import { clamp, noise, rnd, send, tone, track, vary, type Engine } from './engine';

const C4 = 261.63;
/** Semitones from middle C to Hz. */
export const hz = (semi: number): number => C4 * 2 ** (semi / 12);

// ---------------------------------------------------------------------------------------------- drumline

/** Stick on the rim: the family's smallest sound. `pitch` shifts it for round-robins and rising rows. */
export function rim(e: Engine, t: number, v: number, pitch = 1): void {
  const p = pitch * vary(35);
  tone(e, { t, f: 1750 * p, dur: 0.016, peak: 0.26 * v, type: 'triangle', a: 0.0006 });
  tone(e, { t, f: 820 * p, f2: 700 * p, dur: 0.028, peak: 0.24 * v, type: 'triangle', a: 0.0006 });
  noise(e, { t, f: 4200, type: 'highpass', q: 0.6, dur: 0.014, peak: 0.34 * v, a: 0.0005 });
}

/** A high-tension marching snare: short tuned head, crisp wires. */
export function snare(e: Engine, t: number, v: number, ghost = false): void {
  const p = vary(25);
  const len = ghost ? 0.6 : 1;
  tone(e, { t, f: 335 * p, f2: 245 * p, glide: 0.04, dur: 0.085 * len, peak: 0.42 * v, type: 'triangle', a: 0.001 });
  if (!ghost) tone(e, { t, f: 540 * p, f2: 410 * p, glide: 0.03, dur: 0.045, peak: 0.16 * v, a: 0.001 });
  noise(e, { t, f: 2300, type: 'highpass', q: 0.7, dur: 0.13 * len, peak: 0.36 * v, a: 0.001, verb: ghost ? 0 : 0.06 });
  noise(e, { t, f: 5000, q: 0.9, dur: 0.08 * len, peak: 0.24 * v, a: 0.001 });
}

/** Grace note, then the stroke. */
export function flam(e: Engine, t: number, v: number): void {
  snare(e, t, v * 0.32, true);
  snare(e, t + 0.03, v);
}

function rollCurve(dur: number, v0: number, v1: number, rate: number): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.ceil(dur * 1000));
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const step = 1000 / rate;
  let next = 0;
  let amp = 0;
  let level = 0;
  let hand = 0;
  for (let i = 0; i < n; i += 1) {
    if (i >= next) {
      // alternate hands: the left is a touch softer, and no two strokes are identical
      amp = (hand % 2 ? 0.82 : 1) * rnd(0.85, 1);
      level = Math.max(level, amp);
      hand += 1;
      next += step * rnd(0.93, 1.07);
    }
    level *= 0.925;
    const k = i / (n - 1);
    c[i] = (0.22 + 0.78 * level) * (v0 + (v1 - v0) * k * k);
  }
  c[n - 1] = 0;
  return c;
}

/** A buzz roll from velocity v0 to v1: one noise voice and one head voice, chopped into strokes by a gain curve. */
export function roll(e: Engine, t: number, dur: number, v0: number, v1: number, rate = 27): void {
  const curve = rollCurve(dur, v0, v1, rate);
  noise(e, { t, f: 2400, type: 'highpass', q: 0.7, dur, peak: 0.34, curve });
  noise(e, { t, f: 330, q: 3, dur, peak: 0.5, curve, src: 'pink' });
}

/** Tenor toms, tuned to the key. `semi` is semitones from middle C (the drums live between about -12 and +7). */
export function tom(e: Engine, t: number, semi: number, v: number, len = 1): void {
  const f = hz(semi) * vary(12);
  tone(e, { t, f: f * 1.55, f2: f, glide: 0.035, dur: 0.2 * len, peak: 0.4 * v, a: 0.0015 });
  tone(e, { t, f: f * 2.1, f2: f * 1.9, dur: 0.07 * len, peak: 0.11 * v, type: 'triangle', a: 0.001 });
  noise(e, { t, f: 2800, q: 0.9, dur: 0.014, peak: 0.2 * v, a: 0.0005 });
}

/** Bass drum. The upper layer and the beater click are what a phone speaker actually reproduces. */
export function bass(e: Engine, t: number, v: number, big = false): void {
  const p = vary(15);
  tone(e, { t, f: 128 * p, f2: 47, glide: 0.075, dur: big ? 0.46 : 0.3, peak: 0.6 * v, a: 0.002 });
  tone(e, { t, f: 205 * p, f2: 96, glide: 0.05, dur: big ? 0.16 : 0.11, peak: 0.24 * v, type: 'triangle', a: 0.0015 });
  noise(e, { t, f: 2600, type: 'lowpass', q: 0.5, dur: 0.02, peak: 0.3 * v, a: 0.0005 });
}

/** Crash cymbal; `choke` grabs it almost at once (the cancel sound). */
export function cymbal(e: Engine, t: number, v: number, dur = 1.2, choke = false): void {
  if (choke) {
    noise(e, { t, src: 'metal', f: 3600, type: 'highpass', q: 0.6, dur: 0.15, hold: 0.06, peak: 0.2 * v, a: 0.002, rate: rnd(0.96, 1.05) });
    noise(e, { t, f: 7200, q: 0.6, dur: 0.11, hold: 0.04, peak: 0.12 * v, a: 0.002 });
    return;
  }
  noise(e, { t, src: 'metal', f: 3300, type: 'highpass', q: 0.6, dur, peak: 0.2 * v, a: 0.002, rate: rnd(0.96, 1.05), verb: 0.12 });
  noise(e, { t, f: 6800, q: 0.5, dur: dur * 0.6, peak: 0.13 * v, a: 0.002 });
  noise(e, { t, src: 'metal', f: 900, q: 1.2, dur: Math.min(0.25, dur * 0.3), peak: 0.1 * v, a: 0.002, rate: 0.7 });
}

/** A cymbal played backwards: the breath before a big hit. Ends exactly at t + dur. */
export function swell(e: Engine, t: number, dur: number, v: number): void {
  const n = 64;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i += 1) c[i] = (i / (n - 1)) ** 2.6;
  c[n - 1] = 0;
  noise(e, { t, src: 'metal', f: 2600, type: 'highpass', q: 0.6, sweep: [[1, 5200]], dur, peak: 0.24 * v, curve: c });
}

// ---------------------------------------------------------------------------------------------- brass

export interface BrassOpts {
  /** filter opening, 1 = normal; lower is darker, further away */
  bright?: number;
  /** slower attack: a swell instead of a stab */
  soft?: boolean;
  /** the pitch sags at the end (the sad trombone gesture) */
  fall?: boolean;
  /** delayed vibrato for held chords */
  vib?: boolean;
  verb?: number;
}

/** A brass section: two detuned saws per note through one enveloped low-pass. `semis` are semitones from middle C. */
export function brass(e: Engine, t: number, semis: number[], dur: number, v: number, o: BrassOpts = {}): void {
  if (!semis.length || dur <= 0 || v <= 0) return;
  const { ctx } = e;
  const bright = o.bright ?? 1;
  const att = Math.min(o.soft ? 0.07 : 0.016, dur * 0.5);
  const end = t + dur;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.1;
  const open = (1100 + 2500 * v) * bright;
  const held = (700 + 1200 * v) * bright;
  lp.frequency.setValueAtTime(380, t);
  lp.frequency.exponentialRampToValueAtTime(open, t + att + 0.012);
  lp.frequency.exponentialRampToValueAtTime(held, Math.max(t + att + 0.02, Math.min(t + att + 0.17, end)));
  lp.frequency.setTargetAtTime(350, end, 0.05);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(1, t + att);
  if (dur > att + 0.09) amp.gain.linearRampToValueAtTime(0.8, t + att + 0.08);
  amp.gain.setTargetAtTime(0, end, 0.028);

  const mix = ctx.createGain();
  mix.gain.value = (0.3 * v) / Math.sqrt(semis.length);
  mix.connect(lp).connect(amp).connect(e.sfx);
  send(e, amp, o.verb ?? 0.16);

  let vib: GainNode | null = null;
  if (o.vib && dur > 0.4) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rnd(5.2, 5.8);
    vib = ctx.createGain();
    vib.gain.setValueAtTime(0, t + 0.22);
    vib.gain.linearRampToValueAtTime(11, t + 0.5);
    lfo.connect(vib);
    lfo.start(t);
    lfo.stop(end + 0.22);
  }
  const stop = end + 0.22;
  semis.forEach((semi, i) => {
    for (const side of [-1, 1]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(semi);
      const det = side * rnd(4, 9);
      // every player scoops into the note a little differently
      osc.detune.setValueAtTime(det - rnd(20, 45), t);
      osc.detune.linearRampToValueAtTime(det, t + 0.045);
      if (o.fall) {
        osc.detune.setValueAtTime(det, Math.max(t + 0.05, end - 0.16));
        osc.detune.linearRampToValueAtTime(det - 190, end + 0.08);
      }
      vib?.connect(osc.detune);
      osc.connect(mix);
      // the chain is torn down when the last oscillator ends
      track(e, osc, i === semis.length - 1 && side === 1 ? amp : undefined);
      osc.start(t);
      osc.stop(stop);
    }
  });
}

// ---------------------------------------------------------------------------------------------- bells

/** Glockenspiel from the front of the band: the sparkle on anything that grows. */
export function bell(e: Engine, t: number, semi: number, v: number, dur = 0.5): void {
  const f = hz(semi);
  tone(e, { t, f, dur, peak: 0.2 * v, a: 0.001, verb: 0.1 });
  tone(e, { t, f: f * 2.76, dur: dur * 0.4, peak: 0.07 * v, a: 0.001 });
  if (f * 5.4 < 9000) tone(e, { t, f: f * 5.4, dur: dur * 0.14, peak: 0.03 * v, a: 0.001 });
}

// ---------------------------------------------------------------------------------------------- whistle

/** A pea whistle: one loud partial, chopped and bent by the pea at about 40 Hz, with breath noise around it. */
export function whistle(e: Engine, t: number, dur: number, v: number): void {
  const { ctx } = e;
  const f0 = 2760 * vary(30);
  const end = t + dur;
  const car = ctx.createOscillator();
  car.frequency.setValueAtTime(f0 * 0.9, t);
  car.frequency.exponentialRampToValueAtTime(f0, t + 0.03);
  car.frequency.setValueAtTime(f0, Math.max(t + 0.031, end - 0.05));
  car.frequency.exponentialRampToValueAtTime(f0 * 0.95, end + 0.02);
  const lfo = ctx.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.setValueAtTime(rnd(36, 41), t);
  lfo.frequency.linearRampToValueAtTime(rnd(42, 48), end);
  const fm = ctx.createGain();
  fm.gain.value = f0 * 0.03;
  lfo.connect(fm).connect(car.frequency);
  const trem = ctx.createGain();
  trem.gain.value = 0.68;
  const depth = ctx.createGain();
  depth.gain.value = 0.32;
  lfo.connect(depth).connect(trem.gain);
  const env = ctx.createGain();
  const peak = 0.17 * v;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.012);
  if (dur > 0.3) env.gain.linearRampToValueAtTime(peak * 1.12, end - 0.08);
  env.gain.setTargetAtTime(0, end - 0.02, 0.014);
  car.connect(trem).connect(env).connect(e.sfx);
  send(e, env, 0.22);
  track(e, car, env);
  track(e, lfo);
  car.start(t);
  lfo.start(t);
  car.stop(end + 0.12);
  lfo.stop(end + 0.12);
  noise(e, { t, f: f0, q: 5, dur: dur + 0.04, hold: Math.max(0.01, dur - 0.05), peak: 0.1 * v, a: 0.01 });
  noise(e, { t, f: 6500, type: 'highpass', q: 0.5, dur: dur + 0.03, hold: Math.max(0.01, dur - 0.05), peak: 0.012 * v, a: 0.008 });
}

// ---------------------------------------------------------------------------------------------- paper and chalk

/** A card flicked off the deck. */
export function flick(e: Engine, t: number, v: number, pitch = 1): void {
  const p = pitch * vary(60);
  noise(e, { t, f: 2300 * p, sweep: [[0.8, 5200 * p]], q: 1.3, dur: 0.05, peak: 0.42 * v, a: 0.002 });
  tone(e, { t, f: 250 * p, f2: 190 * p, dur: 0.022, peak: 0.07 * v, a: 0.001 });
}

/** Paper moving through air. */
export function swish(e: Engine, t: number, v: number, up = true, dur = 0.11): void {
  const lo = 850 * vary(80);
  const hi = 3700 * vary(80);
  noise(e, { t, f: up ? lo : hi, sweep: [[1, up ? hi : lo]], q: 0.9, dur, peak: 0.26 * v, a: dur * 0.4 });
}

/** Paper landing on the table; `hard` makes it a slam. */
export function slap(e: Engine, t: number, v: number, hard = false): void {
  tone(e, { t, f: hard ? 150 : 185, f2: hard ? 72 : 120, glide: 0.04, dur: hard ? 0.11 : 0.055, peak: (hard ? 0.5 : 0.3) * v, a: 0.001 });
  noise(e, { t, f: hard ? 2600 : 1900, type: 'lowpass', q: 0.6, dur: hard ? 0.05 : 0.028, peak: (hard ? 0.4 : 0.26) * v, a: 0.0006 });
  if (hard) noise(e, { t, f: 3400, type: 'highpass', q: 0.6, dur: 0.018, peak: 0.26 * v, a: 0.0005 });
}

/** One chalk stroke: band-passed noise broken up by stick-slip. */
export function chalk(e: Engine, t: number, dur: number, v: number): void {
  const n = Math.max(4, Math.ceil(dur * 380));
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i += 1) {
    const k = i / (n - 1);
    const shape = Math.min(1, k * 9) * Math.min(1, (1 - k) * 5);
    c[i] = shape * (Math.random() < 0.14 ? 0.08 : rnd(0.4, 1));
  }
  c[n - 1] = 0;
  const f = rnd(2900, 3500);
  noise(e, { t, f, sweep: [[1, f * rnd(1.05, 1.25)]], q: 2.6, dur, peak: 0.34 * v, curve: c });
  noise(e, { t, f: 1300, q: 1.4, dur, peak: 0.13 * v, curve: c, src: 'pink' });
}

/** The tick of one character of dialogue: a tiny tuned key-click. */
export function blip(e: Engine, t: number, semi: number, v: number): void {
  tone(e, { t, f: hz(semi) * vary(18), dur: 0.026, peak: 0.07 * v, type: 'square', a: 0.001 });
  tone(e, { t, f: hz(semi) * 2, dur: 0.012, peak: 0.05 * v, type: 'triangle', a: 0.0006 });
  noise(e, { t, f: 3800, type: 'highpass', q: 0.6, dur: 0.008, peak: 0.1 * v, a: 0.0004 });
}

// ---------------------------------------------------------------------------------------------- field

/** Bodies colliding. Power 0..1: a brush of pads up to helmets cracking and the ground shaking. */
export function thud(e: Engine, t: number, power: number): void {
  const p = clamp(power, 0, 1);
  const v = 0.3 + 0.7 * p;
  tone(e, { t, f: (165 - 45 * p) * vary(40), f2: 60 - 14 * p, glide: 0.06, dur: 0.1 + 0.2 * p, peak: 0.55 * v, a: 0.002 });
  tone(e, { t, f: 260 - 40 * p, f2: 120, glide: 0.04, dur: 0.07 + 0.05 * p, peak: 0.2 * v, type: 'triangle', a: 0.001 });
  // shoulder pads: a dry crunch
  noise(e, { t, f: 850 + 500 * p, q: 0.8, dur: 0.05 + 0.07 * p, peak: 0.34 * v, a: 0.001, src: 'pink', rate: 1.6 });
  noise(e, { t, f: 2700, type: 'lowpass', q: 0.5, dur: 0.03 + 0.03 * p, peak: 0.22 * v, a: 0.0006 });
  if (p > 0.45) {
    // helmets: two hard plastic knocks, never quite together
    const k = (p - 0.45) / 0.55;
    tone(e, { t: t + 0.004, f: 1150 * vary(60), dur: 0.028, peak: 0.16 * k, type: 'triangle', a: 0.0006 });
    tone(e, { t: t + rnd(0.012, 0.024), f: 1720 * vary(60), dur: 0.022, peak: 0.12 * k, type: 'triangle', a: 0.0006 });
    noise(e, { t, f: 3600, type: 'highpass', q: 0.6, dur: 0.02, peak: 0.2 * k, a: 0.0005 });
  }
  if (p > 0.8) tone(e, { t: t + 0.01, f: 82, f2: 38, dur: 0.42, peak: 0.34 * ((p - 0.8) / 0.2), a: 0.004, verb: 0.1 });
}

/** A ball through the night air. `flutter` adds the spin of a long spiral. */
export function whoosh(e: Engine, t: number, dur: number, v: number, flutter = false): void {
  const p = vary(90);
  let curve: Float32Array<ArrayBuffer> | undefined;
  if (flutter) {
    const n = Math.ceil(dur * 500);
    curve = new Float32Array(new ArrayBuffer(n * 4));
    const spin = rnd(15, 19);
    for (let i = 0; i < n; i += 1) {
      const k = i / (n - 1);
      curve[i] = Math.sin(Math.PI * k ** 0.75) ** 1.4 * (0.74 + 0.26 * Math.sin(2 * Math.PI * spin * k * dur));
    }
    curve[n - 1] = 0;
  }
  noise(e, {
    t, f: 520 * p, sweep: [[0.4, 1900 * p], [1, 760 * p]], q: 1.3, dur, peak: 0.36 * v, a: dur * 0.35, curve,
  });
  noise(e, { t, f: 260 * p, sweep: [[0.4, 700 * p], [1, 330 * p]], q: 0.9, dur, peak: 0.2 * v, a: dur * 0.35, src: 'pink' });
}

/** Leather into hands (or a hand onto leather). */
export function pop(e: Engine, t: number, v: number, pitch = 1): void {
  const p = pitch * vary(50);
  tone(e, { t, f: 350 * p, f2: 165 * p, glide: 0.03, dur: 0.06, peak: 0.44 * v, a: 0.001 });
  noise(e, { t, f: 1900 * p, q: 1, dur: 0.022, peak: 0.34 * v, a: 0.0006 });
}
