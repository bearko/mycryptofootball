// The audio graph and the two primitives every sound is built from (an enveloped oscillator, a filtered noise burst).
// An Engine wraps one AudioContext: the live one, or an OfflineAudioContext used by the lab to measure the sounds.
//
//   music elements -> musicIn -> low-pass -> muffle -> duck -> music (volume) --+
//   sfx voices ---------------------------------------------> sfx (volume) -----+--> mute -> compressor -> trim
//   reverb send -> convolver --------------------------------> sfx              |       -> soft clip -> fade -> out
//   crowd voices -> crowdIn -> low-pass --------------------> crowd (volume) ---+

export interface Engine {
  ctx: BaseAudioContext;
  /** false: an offline render (no timers, no rate limits) */
  live: boolean;
  /** effects bus: connect voices here; its gain is the effects volume */
  sfx: GainNode;
  /** crowd bus input (goes through the pop-up low-pass, then the crowd volume) */
  crowdIn: GainNode;
  crowdLp: BiquadFilterNode;
  crowd: GainNode;
  /** music chain */
  musicIn: GainNode;
  musicLp: BiquadFilterNode;
  musicMuffle: GainNode;
  musicDuck: GainNode;
  music: GainNode;
  /** reverb send: a short stadium slap for brass, whistles, cymbals and the crowd */
  verb: GainNode;
  mute: GainNode;
  /** page visibility fade */
  fade: GainNode;
  /** post-limiter tap for meters (created on demand) */
  tap: AnalyserNode | null;
  white: AudioBuffer;
  pink: AudioBuffer;
  metal: AudioBuffer;
  /** scheduled, not yet finished one-shot sources */
  voices: number;
  duckDepth: number;
  duckEnd: number;
  /** lets the music player mirror a duck when the element is not routed through the graph */
  onDuck: ((depth: number, ms: number) => void) | null;
  /** owned by crowd.ts */
  crowdState: unknown;
}

/** Decoded samples from the asset catalog, shared by every engine. */
export const samples = new Map<string, AudioBuffer>();

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : Number.isFinite(v) ? v : lo);
/** A random pitch factor within +-cents. */
export const vary = (cents: number): number => 2 ** (rnd(-cents, cents) / 1200);

/** The limiter's ceiling: the soft clipper never lets a sample past this. */
export const CEILING = 0.9;
const KNEE = 0.68;
// The compressor adds a fixed make-up gain (about +3.9 dB with these settings); TRIM takes it back out.
const TRIM = 1;

function softClip(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  // The top of the curve (input 1.25 and beyond) lands just under CEILING.
  const range = 1.25;
  for (let i = 0; i < n; i += 1) {
    const x = ((i / (n - 1)) * 2 - 1) * range;
    const a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (CEILING - KNEE) * Math.tanh((a - KNEE) / (CEILING - KNEE));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
/** The shaper's curve spans inputs of +-CLIP_RANGE, so the stage in front of it scales by 1 / CLIP_RANGE. */
const CLIP_RANGE = 1.25;

function whiteBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Pink noise whose end cross-fades into its start, so it loops without a seam. */
function pinkBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const x = Math.floor(sr * 0.3);
  const raw = new Float32Array(n + x);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let peak = 0;
  for (let i = 0; i < n + x; i += 1) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    raw[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) d[i] = raw[i]! / peak;
  for (let i = 0; i < x; i += 1) {
    const k = i / x;
    d[i] = (raw[i]! * Math.sqrt(k) + raw[n + i]! * Math.sqrt(1 - k)) / peak;
  }
  return buf;
}

/** Inharmonic square partials with a wash of noise: the raw material of every cymbal. */
function metalBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const ratios = [1, 1.483, 1.932, 2.546, 2.63, 3.897, 4.71, 5.62];
  const base = 317;
  const phase = ratios.map(() => Math.random());
  const step = ratios.map((r) => (base * r) / sr);
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    for (let k = 0; k < ratios.length; k += 1) {
      phase[k] = (phase[k]! + step[k]!) % 1;
      v += phase[k]! < 0.5 ? 1 : -1;
    }
    d[i] = (v / ratios.length) * 0.7 + (Math.random() * 2 - 1) * 0.3;
  }
  return buf;
}

function impulse(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 1.1);
  const pre = Math.floor(sr * 0.022);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i += 1) {
      const k = (i - pre) / (n - pre);
      // the tail gets darker as it decays, like sound coming back from the far stand
      const a = 0.25 + 0.7 * k;
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * Math.exp(-5.5 * k) * (1 - k);
    }
  }
  return buf;
}

/** `bypass` leaves the limiter out (the lab uses it to see what the buses add up to before it). */
export function createEngine(ctx: BaseAudioContext, live: boolean, bypass = false): Engine {
  const top = Math.min(20000, ctx.sampleRate / 2 - 200);
  const gain = (v: number): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const lowpass = (): BiquadFilterNode => {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = top;
    f.Q.value = 0.5;
    return f;
  };

  const mute = gain(1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -5;
  comp.knee.value = 5;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.13;
  const trim = gain(TRIM / CLIP_RANGE);
  const shaper = ctx.createWaveShaper();
  shaper.curve = softClip();
  const post = gain(1);
  const fade = gain(1);
  if (bypass) mute.connect(fade);
  else mute.connect(comp).connect(trim).connect(shaper).connect(post).connect(fade);
  fade.connect(ctx.destination);

  const sfx = gain(1);
  sfx.connect(mute);

  const crowdIn = gain(1);
  const crowdLp = lowpass();
  const crowd = gain(1);
  crowdIn.connect(crowdLp).connect(crowd).connect(mute);

  const musicIn = gain(1);
  const musicLp = lowpass();
  const musicMuffle = gain(1);
  const musicDuck = gain(1);
  const music = gain(1);
  musicIn.connect(musicLp).connect(musicMuffle).connect(musicDuck).connect(music).connect(mute);

  const verb = gain(1);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx);
  const wet = gain(0.7);
  verb.connect(conv).connect(wet).connect(sfx);

  return {
    ctx, live, sfx, crowdIn, crowdLp, crowd, musicIn, musicLp, musicMuffle, musicDuck, music, verb, mute, fade,
    tap: null,
    white: whiteBuffer(ctx, 2),
    pink: pinkBuffer(ctx, 5),
    metal: metalBuffer(ctx, 2),
    voices: 0,
    duckDepth: 0,
    duckEnd: 0,
    onDuck: null,
    crowdState: null,
  };
}

/** A post-limiter analyser for meters and scopes (lab only). */
export function tapOf(e: Engine): AnalyserNode {
  if (!e.tap) {
    e.tap = e.ctx.createAnalyser();
    e.tap.fftSize = 2048;
    e.fade.connect(e.tap);
  }
  return e.tap;
}

/** Counts a one-shot source as a voice until it ends, then unhooks the end of its chain. */
export function track(e: Engine, src: AudioScheduledSourceNode, tail?: AudioNode): void {
  e.voices += 1;
  src.onended = (): void => {
    e.voices -= 1;
    try {
      tail?.disconnect();
    } catch {
      /* already gone */
    }
  };
}

/** Connects a node to the reverb send at the given level. */
export function send(e: Engine, from: AudioNode, amount: number): void {
  if (amount <= 0) return;
  const g = e.ctx.createGain();
  g.gain.value = amount;
  from.connect(g).connect(e.verb);
}

export interface Tone {
  t: number;
  /** start frequency in Hz */
  f: number;
  /** total length in seconds (attack + hold + decay) */
  dur: number;
  peak: number;
  type?: OscillatorType;
  /** glide to this frequency ... */
  f2?: number;
  /** ... within this many seconds (default: the whole length) */
  glide?: number;
  /** attack seconds (default 2 ms) */
  a?: number;
  hold?: number;
  to?: AudioNode;
  verb?: number;
}

/** An oscillator with a percussive envelope: linear attack, optional hold, exponential decay. */
export function tone(e: Engine, o: Tone): void {
  if (o.peak <= 0 || o.dur <= 0) return;
  const { ctx } = e;
  const a = Math.min(o.a ?? 0.002, o.dur * 0.6);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(1, o.f), o.t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), o.t + Math.min(o.glide ?? o.dur, o.dur));
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(o.peak, o.t + a);
  if (o.hold) g.gain.setValueAtTime(o.peak, o.t + Math.min(a + o.hold, o.dur * 0.9));
  g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  osc.connect(g).connect(o.to ?? e.sfx);
  if (o.verb) send(e, g, o.verb);
  track(e, osc, g);
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.01);
}

export interface Noise {
  t: number;
  dur: number;
  peak: number;
  /** filter centre / corner in Hz */
  f: number;
  type?: BiquadFilterType;
  q?: number;
  /** filter sweep: [fraction of the length, frequency] pairs */
  sweep?: Array<[number, number]>;
  a?: number;
  hold?: number;
  src?: 'white' | 'pink' | 'metal';
  /** playback rate of the noise buffer (lower = darker, grainier) */
  rate?: number;
  /** a gain curve over the whole length; replaces the envelope (peak still scales it) */
  curve?: Float32Array<ArrayBuffer>;
  to?: AudioNode;
  verb?: number;
}

/** A burst of filtered noise with the same envelope shape as tone(). */
export function noise(e: Engine, o: Noise): void {
  if (o.peak <= 0 || o.dur <= 0) return;
  const { ctx } = e;
  const buf = o.src === 'pink' ? e.pink : o.src === 'metal' ? e.metal : e.white;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  const top = ctx.sampleRate / 2 - 200;
  f.frequency.setValueAtTime(Math.min(top, Math.max(20, o.f)), o.t);
  for (const [k, hz] of o.sweep ?? []) f.frequency.exponentialRampToValueAtTime(Math.min(top, Math.max(20, hz)), o.t + k * o.dur);
  const g = ctx.createGain();
  if (o.curve && o.curve.length > 1) {
    const c = new Float32Array(new ArrayBuffer(o.curve.length * 4));
    for (let i = 0; i < c.length; i += 1) c[i] = o.curve[i]! * o.peak;
    g.gain.setValueAtTime(0, o.t);
    g.gain.setValueCurveAtTime(c, o.t, o.dur);
  } else {
    const a = Math.min(o.a ?? 0.002, o.dur * 0.6);
    g.gain.setValueAtTime(0, o.t);
    g.gain.linearRampToValueAtTime(o.peak, o.t + a);
    if (o.hold) g.gain.setValueAtTime(o.peak, o.t + Math.min(a + o.hold, o.dur * 0.9));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
  }
  src.connect(f).connect(g).connect(o.to ?? e.sfx);
  if (o.verb) send(e, g, o.verb);
  track(e, src, g);
  src.start(o.t, Math.random() * (buf.duration - 0.05));
  src.stop(o.t + o.dur + 0.01);
}

/** Plays a decoded catalog sample; false when it is not loaded (the caller may synthesize instead). */
export function sample(e: Engine, t: number, key: string, volume: number, to?: AudioNode): boolean {
  const buf = samples.get(key);
  if (!buf) return false;
  const src = e.ctx.createBufferSource();
  const g = e.ctx.createGain();
  g.gain.value = volume;
  src.buffer = buf;
  src.connect(g).connect(to ?? e.sfx);
  track(e, src, g);
  src.start(t);
  return true;
}

/** Pulls the music down by `depth` (0..1) for `ms`, then lets it come back. Overlapping calls keep the deeper, later one. */
export function duckMusic(e: Engine, depth: number, ms: number): void {
  const now = e.ctx.currentTime;
  const d = clamp(depth, 0, 1);
  const end = now + Math.max(0, ms) / 1000;
  const active = now < e.duckEnd;
  e.duckDepth = active ? Math.max(e.duckDepth, d) : d;
  e.duckEnd = active ? Math.max(e.duckEnd, end) : end;
  const p = e.musicDuck.gain;
  p.cancelScheduledValues(now);
  p.setTargetAtTime(1 - e.duckDepth, now, 0.035);
  p.setTargetAtTime(1, e.duckEnd, 0.28);
  e.onDuck?.(e.duckDepth, (e.duckEnd - now) * 1000);
}
