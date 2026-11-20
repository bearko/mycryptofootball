// BGM (streamed <audio>), a handful of sampled effects, and small synthesized sounds.
// Nothing here may throw: a browser that refuses audio must still run the game.

import catalog from '../generated/catalog.json';
import { commit, save } from './save';

const BGM = catalog.bgm as Record<string, string>;
const SE = catalog.se as Record<string, string>;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
let bgm: HTMLAudioElement | null = null;
let bgmKey = '';
let unlocked = false;

function ac(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = save().mute ? 0 : 0.8;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

async function load(key: string): Promise<void> {
  const c = ac();
  const url = SE[key];
  if (!c || !url || buffers.has(key)) return;
  try {
    const res = await fetch(url);
    buffers.set(key, await c.decodeAudioData(await res.arrayBuffer()));
  } catch {
    /* the effect is simply silent */
  }
}

/** Call from the first tap or key press: browsers only allow sound after a gesture. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const c = ac();
  if (c && c.state === 'suspended') void c.resume();
  for (const k of Object.keys(SE)) void load(k);
  if (bgm && bgmKey && !save().mute) void bgm.play().catch(() => undefined);
}

export function playBgm(key: string, volume = 0.35): void {
  if (bgmKey === key) return;
  bgmKey = key;
  try {
    if (bgm) {
      bgm.pause();
      bgm.src = '';
    }
    const url = BGM[key];
    if (!url) {
      bgm = null;
      return;
    }
    bgm = new Audio(url);
    bgm.loop = true;
    bgm.volume = volume;
    if (unlocked && !save().mute) void bgm.play().catch(() => undefined);
  } catch {
    bgm = null;
  }
}

/** A sampled effect from the asset database. */
export function se(key: string, volume = 0.7): void {
  const c = ac();
  const buf = buffers.get(key);
  if (!c || !master || !buf || save().mute) return;
  try {
    const src = c.createBufferSource();
    const g = c.createGain();
    g.gain.value = volume;
    src.buffer = buf;
    src.connect(g).connect(master);
    src.start();
  } catch {
    /* ignore */
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
  const c = ac();
  if (!c || !master || save().mute) return;
  try {
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch {
    /* ignore */
  }
}

function noise(dur: number, vol: number, delay = 0): void {
  const c = ac();
  if (!c || !master || save().mute) return;
  try {
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(master);
    src.start(c.currentTime + delay);
  } catch {
    /* ignore */
  }
}

/** Small synthesized sounds for the interface and the field. */
export const blip = {
  tap: (): void => tone(660, 0.06, 'square', 0.08),
  pick: (): void => tone(520, 0.08, 'square', 0.1, 780),
  no: (): void => tone(180, 0.12, 'sawtooth', 0.08),
  flip: (): void => noise(0.08, 0.25),
  whistle: (): void => {
    tone(2100, 0.22, 'square', 0.07);
    tone(2300, 0.22, 'square', 0.05);
  },
  cheer: (): void => {
    noise(0.9, 0.35);
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'square', 0.1, undefined, i * 0.09));
  },
  first: (): void => [660, 880].forEach((f, i) => tone(f, 0.12, 'square', 0.1, undefined, i * 0.1)),
  bad: (): void => [330, 247, 196].forEach((f, i) => tone(f, 0.16, 'sawtooth', 0.08, undefined, i * 0.12)),
  throw: (): void => tone(300, 0.3, 'sine', 0.1, 900),
};

export function toggleMute(): boolean {
  const s = save();
  s.mute = !s.mute;
  commit();
  if (master) master.gain.value = s.mute ? 0 : 0.8;
  if (bgm) {
    if (s.mute) bgm.pause();
    else if (unlocked) void bgm.play().catch(() => undefined);
  }
  return s.mute;
}
