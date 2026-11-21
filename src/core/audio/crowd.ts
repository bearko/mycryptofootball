// The stadium: a looping bed of filtered noise that follows a mood value, one-shot reactions,
// and a stomp-stomp-clap loop for tense moments.

import { clamp, noise, rnd, tone, type Engine } from './engine';

/** 100 bpm: stomp, stomp (eighths), clap (on the second beat), rest. */
const BEAT = 0.6;
const CYCLE = BEAT * 2;

interface Bed {
  srcs: AudioScheduledSourceNode[];
  low: BiquadFilterNode;
  bright: GainNode;
  swell: GainNode;
  level: GainNode;
}

interface State {
  on: boolean;
  mood: number;
  bed: Bed | null;
  teardown: ReturnType<typeof setTimeout> | null;
  tense: boolean;
  /** start time of the next stomp cycle */
  next: number;
  cycles: number;
  timer: ReturnType<typeof setInterval> | null;
}

function state(e: Engine): State {
  if (!e.crowdState) {
    const st: State = { on: false, mood: 0.3, bed: null, teardown: null, tense: false, next: 0, cycles: 0, timer: null };
    e.crowdState = st;
  }
  return e.crowdState as State;
}

const bedLevel = (mood: number): number => 0.06 + 0.2 * mood ** 1.4;

function build(e: Engine): Bed {
  const { ctx } = e;
  const sum = ctx.createGain();
  const srcs: AudioScheduledSourceNode[] = [];
  // two readings of the same loop at different speeds never line up, so the loop point cannot be heard
  for (const rate of [1, 0.77]) {
    const src = ctx.createBufferSource();
    src.buffer = e.pink;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(sum);
    src.start(0, Math.random() * 4);
    srcs.push(src);
  }
  const band = (f: number, q: number, g: number): [BiquadFilterNode, GainNode] => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const out = ctx.createGain();
    out.gain.value = g;
    sum.connect(bp).connect(out);
    return [bp, out];
  };
  const [low, g1] = band(520, 0.7, 1);
  const [, g2] = band(1150, 1, 0.5);
  const [, bright] = band(2500, 0.9, 0.1);
  const move = ctx.createGain();
  const swell = ctx.createGain();
  const level = ctx.createGain();
  level.gain.value = 0;
  for (const g of [g1, g2, bright]) g.connect(move);
  move.connect(swell).connect(level).connect(e.crowdIn);
  // slow movement: the whole stand breathing, and its tone drifting
  const lfo = (hz: number, depth: number, to: AudioParam): void => {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(to);
    o.start();
    srcs.push(o);
  };
  lfo(0.13, 0.17, move.gain);
  lfo(0.41, 0.09, move.gain);
  lfo(0.071, 90, low.frequency);
  return { srcs, low, bright, swell, level };
}

function applyMood(e: Engine, st: State, tau: number): void {
  if (!st.bed) return;
  const now = e.ctx.currentTime;
  st.bed.level.gain.setTargetAtTime(st.on ? bedLevel(st.mood) : 0, now, tau);
  st.bed.bright.gain.setTargetAtTime(0.08 + 0.75 * st.mood, now, 0.5);
  st.bed.low.frequency.setTargetAtTime(470 + 220 * st.mood, now, 0.5);
}

export function crowdStart(e: Engine): void {
  const st = state(e);
  if (st.teardown) clearTimeout(st.teardown);
  st.teardown = null;
  st.on = true;
  if (!st.bed) st.bed = build(e);
  applyMood(e, st, 0.45);
}

export function crowdStop(e: Engine): void {
  const st = state(e);
  st.on = false;
  crowdTension(e, false);
  if (!st.bed) return;
  applyMood(e, st, 0.3);
  if (!e.live) return;
  if (st.teardown) clearTimeout(st.teardown);
  st.teardown = setTimeout(() => {
    st.teardown = null;
    if (st.on || !st.bed) return;
    for (const s of st.bed.srcs) {
      try {
        s.stop();
      } catch {
        /* never started */
      }
    }
    try {
      st.bed.level.disconnect();
    } catch {
      /* already gone */
    }
    st.bed = null;
  }, 2500);
}

export function crowdMood(e: Engine, v: number): void {
  const st = state(e);
  st.mood = clamp(v, 0, 1);
  applyMood(e, st, 0.5);
}

/** Lifts the bed for a moment, so a one-shot reaction feels like the whole stand joining in. */
function lift(e: Engine, t: number, amount: number, hold: number): void {
  const bed = state(e).bed;
  if (!bed) return;
  const p = bed.swell.gain;
  p.cancelScheduledValues(t);
  p.setTargetAtTime(1 + amount, t, 0.12);
  p.setTargetAtTime(1, t + hold, 0.7);
}

export function crowdRoar(e: Engine, t: number, power = 0.7): void {
  const p = clamp(power, 0, 1);
  const to = e.crowdIn;
  noise(e, {
    t, to, src: 'pink', rate: rnd(0.9, 1.2), f: 620, sweep: [[0.15, 900], [1, 700]], q: 0.9,
    a: 0.15, hold: 0.25 + 0.5 * p, dur: 1.4 + 1.6 * p, peak: 0.3 + 0.6 * p, verb: 0.12,
  });
  noise(e, {
    t, to, f: 1450, sweep: [[0.2, 2100], [1, 1500]], q: 1.1,
    a: 0.2, hold: 0.2 + 0.4 * p, dur: 1.2 + 1.4 * p, peak: 0.16 + 0.4 * p,
  });
  noise(e, { t, to, f: 3400, type: 'highpass', q: 0.5, a: 0.25, hold: 0.1 + 0.3 * p, dur: 1 + 1.2 * p, peak: 0.03 + 0.09 * p });
  if (p > 0.55) {
    // a few fans whistling through their fingers
    const n = p > 0.85 ? 3 : 2;
    for (let i = 0; i < n; i += 1) {
      const f = rnd(1850, 2500);
      const at = t + rnd(0.15, 0.9 + p);
      tone(e, { t: at, to, f, f2: f * rnd(1.15, 1.35), dur: rnd(0.16, 0.3), hold: 0.08, peak: 0.035, a: 0.03, verb: 0.3 });
    }
  }
  lift(e, t, 1.2 * p, 0.5 + p);
}

export function crowdOoh(e: Engine, t: number): void {
  const to = e.crowdIn;
  noise(e, { t, to, src: 'pink', f: 430, sweep: [[0.35, 640], [1, 400]], q: 2.4, a: 0.16, hold: 0.1, dur: 0.95, peak: 0.95, verb: 0.1 });
  noise(e, { t, to, f: 850, sweep: [[0.35, 1150], [1, 800]], q: 2.5, a: 0.16, hold: 0.1, dur: 0.9, peak: 0.4 });
  lift(e, t, 0.35, 0.4);
}

export function crowdGroan(e: Engine, t: number): void {
  const to = e.crowdIn;
  noise(e, { t, to, src: 'pink', rate: 0.85, f: 620, sweep: [[1, 330]], q: 2.2, a: 0.14, hold: 0.15, dur: 1.3, peak: 0.8, verb: 0.1 });
  noise(e, { t, to, f: 1000, sweep: [[1, 640]], q: 2.5, a: 0.14, hold: 0.1, dur: 1.1, peak: 0.24 });
}

function stomp(e: Engine, t: number, v: number): void {
  const to = e.crowdIn;
  tone(e, { t, to, f: 98, f2: 46, glide: 0.06, dur: 0.2, peak: 0.36 * v, a: 0.003 });
  noise(e, { t, to, src: 'pink', f: 420, type: 'lowpass', q: 0.6, dur: 0.1, peak: 0.4 * v, a: 0.002 });
  // late feet, and the bleachers rattling
  noise(e, { t: t + rnd(0.012, 0.03), to, src: 'pink', f: 520, type: 'lowpass', q: 0.6, dur: 0.08, peak: 0.26 * v, a: 0.002 });
  noise(e, { t, to, f: 950, q: 0.7, dur: 0.06, peak: 0.45 * v, a: 0.001 });
  tone(e, { t, to, f: 310, f2: 150, glide: 0.04, dur: 0.08, peak: 0.16 * v, type: 'triangle', a: 0.002 });
}

function clap(e: Engine, t: number, v: number): void {
  const to = e.crowdIn;
  for (let i = 0; i < 4; i += 1) {
    noise(e, { t: t + (i ? rnd(0.004, 0.028) : 0), to, f: rnd(1100, 1900), q: 1.3, dur: rnd(0.07, 0.12), peak: 0.8 * v, a: 0.001 });
  }
  noise(e, { t, to, f: 1500, q: 0.8, dur: 0.2, peak: 0.34 * v, a: 0.004, verb: 0.25 });
}

function cycle(e: Engine, st: State, t: number): void {
  // the stand needs a couple of bars to find each other
  const v = Math.min(1, 0.55 + 0.15 * st.cycles);
  stomp(e, t, v);
  stomp(e, t + BEAT / 2, v * 0.92);
  clap(e, t + BEAT, v);
}

function pump(e: Engine, st: State): void {
  const now = e.ctx.currentTime;
  while (st.tense && st.next < now + 0.25) {
    cycle(e, st, st.next);
    st.next += CYCLE;
    st.cycles += 1;
  }
  if (!st.tense && st.timer) {
    clearInterval(st.timer);
    st.timer = null;
  }
}

/** Switches the stomp-stomp-clap loop. Turning it off lets the bar in progress finish on its clap. */
export function crowdTension(e: Engine, on: boolean): void {
  const st = state(e);
  if (st.tense === on) return;
  st.tense = on;
  if (!on) return;
  const now = e.ctx.currentTime;
  if (!e.live) {
    // an offline render has no timers: lay down two bars
    st.cycles = 0;
    cycle(e, st, now + 0.02);
    st.cycles = 1;
    cycle(e, st, now + 0.02 + CYCLE);
    return;
  }
  if (st.cycles > 0 && st.next > now - CYCLE * 2) {
    // switched back on within a bar or two: stay on the old grid
    while (st.next < now + 0.04) st.next += CYCLE;
  } else {
    st.next = now + 0.05;
    st.cycles = 0;
  }
  if (!st.timer) st.timer = setInterval(() => {
    try {
      pump(e, st);
    } catch {
      /* a failed bar is just silence */
    }
  }, 70);
  pump(e, st);
}
