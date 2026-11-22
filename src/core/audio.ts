// Everything the game sounds like: a marching band at a night game.
// The effects are synthesized (src/core/audio/kit.ts is the band, sounds.ts the scores, crowd.ts the stadium);
// the music and a few jingles are samples from the asset catalog.
//
// Nothing here may throw, and everything is a silent no-op before unlockAudio() and where there is no
// window or no AudioContext (tests, old browsers): the game must run the same without sound.

import catalog from '../generated/catalog.json';
import { crowdGroan, crowdMood, crowdOoh, crowdRoar, crowdStart, crowdStop, crowdTension } from './audio/crowd';
import { clamp, createEngine, duckMusic, sample, samples, sounding, tapOf, type Engine } from './audio/engine';
import { R } from './audio/sounds';
import { commit, prefs, save } from './save';

const BGM = ((catalog as { bgm?: unknown }).bgm ?? {}) as Record<string, string>;
const SE = ((catalog as { se?: unknown }).se ?? {}) as Record<string, string>;

export type BgmKey = 'club' | 'match' | 'final' | '';

/** Bus levels at a volume setting of 1. The music files are mastered hot; the band sits on top of them. */
const MUSIC_BASE = 0.55;
const SFX_BASE = 1;
const CROWD_BASE = 0.8;
/** Cross-fade between tracks, in seconds. */
const FADE = 0.6;
/** How many voices may be sounding before a sound of each priority (0 = ticks, 1 = normal, 2 = big moments) is dropped. */
const LIMIT = [20, 36, 60] as const;
/** The same for voices that are scheduled but have not started yet (a fanfare books a couple of seconds ahead). */
const BOOKED = [90, 130, 190] as const;

const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';

/** The real-time engine (created by the first gesture). */
let live: Engine | null = null;
/** Where sounds are scheduled: the live engine, or an offline one while the lab measures. */
let eng: Engine | null = null;
let unlocked = false;
let asleep = false;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;

const muted = (): boolean => {
  try {
    return !!save().mute;
  } catch {
    return false;
  }
};
const vol = (key: 'bgm' | 'se' | 'voice'): number => {
  try {
    return clamp(Number(prefs()[key]), 0, 1);
  } catch {
    return key === 'bgm' ? 0.6 : key === 'se' ? 0.8 : 0.9;
  }
};

// ------------------------------------------------------------------------------------------------ samples

let loading: Promise<void> | null = null;

function loadSamples(ctx: BaseAudioContext): Promise<void> {
  loading ??= Promise.all(Object.entries(SE).map(async ([key, url]) => {
    try {
      if (samples.has(key)) return;
      const res = await fetch(url);
      samples.set(key, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      /* that effect falls back to the synthesized version, or is silent */
    }
  })).then(() => undefined, () => undefined);
  return loading;
}

// ------------------------------------------------------------------------------------------------ music

interface Track {
  el: HTMLAudioElement;
  /** null: the element could not be routed into the graph, so its own volume does the work */
  gain: GainNode | null;
  level: number;
  target: number;
  stop: ReturnType<typeof setTimeout> | null;
  /** the browser has let this element play once (after that it may be started from anywhere) */
  primed: boolean;
}

const tracks = new Map<string, Track>();
let want: BgmKey = '';
let fbDuck = 1;
let fbMuffle = 1;
let fbDuckTimer: ReturnType<typeof setTimeout> | null = null;
let fbTimer: ReturnType<typeof setInterval> | null = null;

/** Volume handling for elements that play outside the graph: a timer fades them, and they follow ducks and muffles. */
function fbSync(): void {
  const step = (): boolean => {
    let moving = false;
    const base = (muted() ? 0 : vol('bgm')) * MUSIC_BASE * fbDuck * fbMuffle;
    for (const tr of tracks.values()) {
      if (tr.gain) continue;
      const d = tr.target - tr.level;
      tr.level = Math.abs(d) < 0.07 ? tr.target : tr.level + Math.sign(d) * 0.07;
      if (tr.level !== tr.target) moving = true;
      try {
        tr.el.volume = clamp(tr.level * base, 0, 1);
      } catch {
        /* some phones do not allow setting the volume */
      }
    }
    return moving;
  };
  if (step() && !fbTimer) fbTimer = setInterval(() => {
    if (!step() && fbTimer) {
      clearInterval(fbTimer);
      fbTimer = null;
    }
  }, 40);
}

function trackFor(key: string): Track | null {
  const have = tracks.get(key);
  if (have) return have;
  const url = BGM[key];
  if (!url) return null;
  const el = new Audio(url);
  el.loop = true;
  el.preload = 'auto';
  const tr: Track = { el, gain: null, level: 0, target: 0, stop: null, primed: false };
  if (live) {
    try {
      const ctx = live.ctx as AudioContext;
      const node = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain).connect(live.musicIn);
      tr.gain = gain;
    } catch {
      tr.gain = null;
    }
  }
  if (!tr.gain) el.volume = 0;
  tracks.set(key, tr);
  return tr;
}

function ramp(tr: Track, to: number): void {
  tr.target = to;
  if (tr.gain && live) {
    const now = live.ctx.currentTime;
    tr.gain.gain.cancelScheduledValues(now);
    tr.gain.gain.setTargetAtTime(to, now, FADE / 3);
  }
}

const start = (tr: Track): void => {
  if (muted() || asleep) return;
  try {
    // refused (no gesture yet, or the phone just came back): the next tap tries again, see unlockAudio()
    void tr.el.play().then(() => {
      tr.primed = true;
    }, () => undefined);
  } catch {
    /* ignore */
  }
};

/** Moves the music toward `want`: the new track fades in from its start while the others fade out and pause. */
function syncMusic(): void {
  if (!unlocked || !hasWindow) return;
  for (const [key, tr] of tracks) {
    if (key === want || tr.target === 0) continue;
    ramp(tr, 0);
    if (tr.stop) clearTimeout(tr.stop);
    tr.stop = setTimeout(() => {
      tr.stop = null;
      if (tr.target === 0) tr.el.pause();
    }, FADE * 1700);
  }
  const tr = want ? trackFor(want) : null;
  if (tr && tr.target !== 1) {
    if (tr.stop) clearTimeout(tr.stop);
    tr.stop = null;
    if (tr.el.paused) {
      try {
        tr.el.currentTime = 0;
      } catch {
        /* not seekable yet */
      }
    }
    ramp(tr, 1);
    start(tr);
  }
  fbSync();
}

/** Cross-fades (about 600 ms) to a track; '' fades the music out. */
export function playBgm(key: BgmKey): void {
  try {
    const next: BgmKey = key && BGM[key] ? key : '';
    if (next === want) return;
    want = next;
    syncMusic();
  } catch {
    /* no music */
  }
}

/** Briefly pulls the music down (cut-ins, big telops); it comes back by itself. */
export function duck(depth = 0.55, ms = 700): void {
  try {
    if (live) duckMusic(live, depth, ms);
    else fallbackDuck(clamp(depth, 0, 1), ms);
  } catch {
    /* ignore */
  }
}

function fallbackDuck(depth: number, ms: number): void {
  if (![...tracks.values()].some((tr) => !tr.gain)) return;
  fbDuck = 1 - depth;
  if (fbDuckTimer) clearTimeout(fbDuckTimer);
  fbDuckTimer = setTimeout(() => {
    fbDuck = 1;
    fbSync();
  }, ms);
  fbSync();
}

/** While a pop-up is open the music (and the stadium) steps back behind a low-pass. */
export function setMuffled(on: boolean): void {
  try {
    if (live) {
      const now = live.ctx.currentTime;
      const open = Math.min(20000, live.ctx.sampleRate / 2 - 200);
      live.musicLp.frequency.setTargetAtTime(on ? 620 : open, now, on ? 0.07 : 0.14);
      live.musicMuffle.gain.setTargetAtTime(on ? 0.6 : 1, now, 0.1);
      live.crowdLp.frequency.setTargetAtTime(on ? 900 : open, now, on ? 0.07 : 0.14);
    }
    fbMuffle = on ? 0.45 : 1;
    fbSync();
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------------------------------------ volume, mute, unlock

function setBuses(e: Engine, smooth: boolean): void {
  const set = (p: AudioParam, v: number): void => {
    if (smooth) p.setTargetAtTime(v, e.ctx.currentTime, 0.02);
    else p.value = v;
  };
  set(e.sfx.gain, vol('se') * SFX_BASE);
  set(e.crowd.gain, vol('se') * CROWD_BASE);
  set(e.music.gain, vol('bgm') * MUSIC_BASE);
  set(e.mute.gain, e.live && muted() ? 0 : 1);
}

// ------------------------------------------------------------------------------------------------ the voice

/** The announcer's voice at a volume setting of 1 (it sits above the band and the crowd). */
const VOICE_BASE = 1.15;
let voiceBus: GainNode | null = null;

/**
 * Where the announcer's voice goes (core/voice/voice.ts), and a duck of the music under it; null while nothing may
 * be heard (before the first gesture, muted, the page asleep, the voice turned down to 0).
 */
export function voiceOut(): { ctx: BaseAudioContext; node: AudioNode; duck(ms: number): void } | null {
  try {
    if (!live || !unlocked || asleep || muted()) return null;
    const v = vol('voice');
    if (v <= 0) return null;
    const e = live;
    if (!voiceBus) {
      voiceBus = e.ctx.createGain();
      voiceBus.connect(e.mute);
    }
    voiceBus.gain.value = v * VOICE_BASE;
    return { ctx: e.ctx, node: voiceBus, duck: (ms) => duckMusic(e, 0.4, ms) };
  } catch {
    return null;
  }
}

/** Re-reads prefs().bgm / prefs().se and save().mute and applies them now. */
export function applyVolumes(): void {
  try {
    if (live) setBuses(live, true);
    if (!hasWindow) return;
    const now = want ? tracks.get(want) : undefined;
    if (muted()) for (const tr of tracks.values()) tr.el.pause();
    else if (unlocked && now && now.el.paused) start(now);
    fbSync();
  } catch {
    /* ignore */
  }
}

/** Flips save().mute, stores it, and returns the new state. */
export function toggleMute(): boolean {
  const s = save();
  s.mute = !s.mute;
  commit();
  applyVolumes();
  return s.mute;
}

/** Phone vibration, if the player allows it and the browser can. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (!prefs().haptics) return;
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/**
 * Call from EVERY tap and key press (it is cheap). Browsers only allow sound after a gesture, and a phone does not
 * count the moment a finger lands (pointerdown) as one: only lifting it (pointerup, touchend, click) does.
 * So this is not a one-off: whatever the browser refused before is tried again here, until the music really plays.
 * It also repairs what a lost event can leave behind: a context that stayed suspended, a page that still thinks it is hidden.
 */
export function unlockAudio(): void {
  if (!hasWindow) return;
  try {
    // somebody is touching the page, so it is in front: never stay asleep because a "wake" event got lost
    if (asleep && document.visibilityState !== 'hidden') setAsleep(false);
    if (!live) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const ctx = new AC({ latencyHint: 'interactive' });
        live = createEngine(ctx, true);
        live.onDuck = fallbackDuck;
        eng = live;
        setBuses(live, false);
        void loadSamples(ctx);
      }
    }
    if (live && !asleep) {
      const ctx = live.ctx as AudioContext;
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    }
  } catch {
    live = null;
    eng = null;
  }
  try {
    const first = !unlocked;
    unlocked = true;
    if (asleep || muted()) return;
    // Phones only let an <audio> element start inside a gesture: touch every track now (silently),
    // so that a later playBgm() from a timer or a screen change is allowed to start it.
    for (const key of Object.keys(BGM)) {
      if (key === want) continue;
      const tr = trackFor(key);
      if (!tr || tr.primed || tr.target !== 0 || !tr.el.paused) continue;
      void tr.el.play().then(() => {
        tr.primed = true;
        if (tr.target === 0) tr.el.pause();
      }, () => undefined);
    }
    if (first) syncMusic();
    const tr = want ? tracks.get(want) ?? trackFor(want) : null;
    if (tr) {
      if (tr.target !== 1) syncMusic();
      else if (tr.el.paused) start(tr);
    }
  } catch {
    /* no music */
  }
}

// A page nobody is looking at makes no sound. Leaving the browser, switching apps, locking the phone or putting an
// installed app in the background all end up here: the music elements are paused at once (a phone would otherwise
// keep playing them like a music player), the context is suspended, and everything comes back on return.
function setAsleep(sleep: boolean): void {
  try {
    if (sleep === asleep) return;
    asleep = sleep;
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = null;
    const ctx = live ? (live.ctx as AudioContext) : null;
    if (asleep) {
      for (const tr of tracks.values()) tr.el.pause();
      if (live && ctx) {
        live.fade.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        // timers are throttled in the background, so do not rely on one alone
        sleepTimer = setTimeout(() => void ctx.suspend().catch(() => undefined), 120);
        if (document.visibilityState === 'hidden') void ctx.suspend().catch(() => undefined);
      }
    } else if (unlocked) {
      if (live && ctx) {
        void ctx.resume().catch(() => undefined);
        live.fade.gain.cancelScheduledValues(ctx.currentTime);
        live.fade.gain.setTargetAtTime(1, ctx.currentTime, 0.08);
      }
      const tr = want ? tracks.get(want) : undefined;
      if (tr) start(tr);
    }
  } catch {
    /* ignore */
  }
}
if (hasWindow) {
  const check = (): void => setAsleep(document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', check);
  // some browsers skip visibilitychange when the page is frozen, unloaded or put in the back/forward cache
  window.addEventListener('pagehide', () => setAsleep(true));
  window.addEventListener('pageshow', check);
  document.addEventListener('freeze', () => setAsleep(true));
  document.addEventListener('resume', check);
  window.addEventListener('focus', check);
}

// ------------------------------------------------------------------------------------------------ effects

/**
 * Wraps a recipe as a public, never-throwing function.
 * Live, a sound is dropped when the page is hidden or muted, when the same sound was asked for less than
 * `gapMs` ago, or when too many voices are already sounding for its priority.
 */
function play<A extends unknown[]>(prio: 0 | 1 | 2, gapMs: number, fn: (e: Engine, t: number, ...a: A) => void): (...a: A) => void {
  let last = -1e9;
  return (...a: A): void => {
    const e = eng;
    if (!e) return;
    try {
      if (e.live) {
        if (asleep || muted()) return;
        const now = performance.now();
        if (now - last < gapMs || e.voices > BOOKED[prio] || sounding(e) > LIMIT[prio]) return;
        last = now;
        const ctx = e.ctx as AudioContext;
        // a phone call or a tab switch can leave the context suspended: any sound asked for brings it back
        if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
      }
      fn(e, e.ctx.currentTime + (e.live ? 0.004 : 0), ...a);
    } catch {
      /* this one sound is lost */
    }
  };
}

export const sfx = {
  // interface
  hover: play(0, 30, R.hover),
  tap: play(1, 25, R.tap),
  back: play(1, 40, R.back),
  deny: play(1, 90, R.deny),
  toggle: play(1, 40, R.toggle),
  open: play(1, 60, R.open),
  close: play(1, 60, R.close),
  /** screen wipe: a short snare roll into a cymbal */
  transition: play(1, 150, R.transition),
  pageTurn: play(1, 50, R.pageTurn),
  typeTick: play(0, 24, R.typeTick),
  countTick: play(0, 24, R.countTick),
  stamp: play(2, 60, R.stamp),
  swap: play(1, 60, R.swap),
  drag: play(0, 40, R.drag),
  drop: play(1, 40, R.drop),
  // cards
  /** slight pitch rise per index */
  cardDeal: play(1, 12, R.cardDeal),
  cardHover: play(0, 30, R.cardHover),
  cardPick: play(1, 40, R.cardPick),
  cardConfirm: play(2, 80, R.cardConfirm),
  cardFlip: play(1, 40, R.cardFlip),
  /** two cards collide; the verdict colours the tail */
  clash: play(2, 120, R.clash),
  /** a play drawn on the field */
  chalk: play(1, 60, R.chalk),
  // match
  whistle: play(2, 120, R.whistle),
  snap: play(1, 60, R.snap),
  handoff: play(1, 60, R.handoff),
  throwBall: play(1, 80, R.throwBall),
  catchBall: play(1, 40, R.catchBall),
  dropBall: play(1, 80, R.dropBall),
  /** power 0..1 */
  impact: play(1, 30, R.impact),
  breakaway: play(1, 150, R.breakaway),
  steal: play(2, 100, R.steal),
  /** a small positive tick scaled by yards */
  gain: play(1, 50, R.gain),
  firstDown: play(2, 150, R.firstDown),
  touchdown: play(2, 300, R.touchdown),
  turnover: play(2, 200, R.turnover),
  stopped: play(2, 120, R.stopped),
  /** level 1..5, rising pitch */
  momentum: play(1, 50, R.momentum),
  specialReady: play(2, 150, R.specialReady),
  specialCutin: play(2, 300, R.specialCutin),
  quarter: play(2, 300, R.quarter),
  halftime: play(2, 300, R.halftime),
  win: play(2, 500, R.win),
  lose: play(2, 500, R.lose),
  // club
  /** one step of a rising arpeggio */
  statUp: play(1, 25, R.statUp),
  trustUp: play(1, 80, R.trustUp),
  learn: play(2, 150, R.learn),
  recruit: play(2, 120, R.recruit),
  captain: play(2, 200, R.captain),
  practice: play(1, 150, R.practice),
  event: play(1, 100, R.event),
} satisfies Record<string, (...a: never[]) => void>;

/** The stadium's state changes are not sounds to drop: they must take hold even while the game is muted or hidden. */
const steady = <A extends unknown[]>(fn: (e: Engine, ...a: A) => void) => (...a: A): void => {
  try {
    if (eng) fn(eng, ...a);
  } catch {
    /* ignore */
  }
};

export const crowd = {
  /** fade the ambience bed in */
  start: steady(crowdStart),
  /** fade it out (also ends the stomp loop) */
  stop: steady(crowdStop),
  /** 0..1: how loud and bright the stand is */
  setMood: steady(crowdMood),
  roar: play(2, 150, crowdRoar),
  ooh: play(1, 200, crowdOoh),
  groan: play(1, 200, crowdGroan),
  /** the stomp-stomp-clap loop (about 100 bpm); switching it off lets the bar in progress finish */
  tension: steady(crowdTension),
};

// ------------------------------------------------------------------------------------------------ deprecated

/** @deprecated the old API, kept while the screens move over to `sfx` */
export const blip = {
  tap: (): void => sfx.tap(),
  pick: (): void => sfx.cardPick(),
  no: (): void => sfx.deny(),
  flip: (): void => sfx.cardFlip(),
  whistle: (): void => sfx.whistle('short'),
  cheer: (): void => {
    sfx.touchdown(true);
    crowd.roar(1);
  },
  first: (): void => sfx.firstDown(),
  bad: (): void => sfx.turnover(false),
  throw: (): void => sfx.throwBall(false),
};

const playSample = play(1, 0, (e, t, key: string, volume: number) => void sample(e, t, key, volume));

/** @deprecated a sampled effect from the asset catalog; use `sfx` */
export function se(key: string, volume = 0.7): void {
  playSample(key, clamp(volume, 0, 1));
}

// ------------------------------------------------------------------------------------------------ lab hooks

/** Dev only (lab/audio.html): the state of the live engine and a post-limiter analyser for meters. */
export function audioDebug(): { unlocked: boolean; state: string; voices: number; booked: number; tap: AnalyserNode | null; bgm?: string; playing?: boolean; asleep?: boolean; time?: number } {
  try {
    const tr = want ? tracks.get(want) : undefined;
    return {
      bgm: want,
      playing: !!tr && !tr.el.paused,
      time: tr ? tr.el.currentTime : 0,
      asleep,
      unlocked,
      state: live ? (live.ctx as AudioContext).state : 'none',
      voices: live ? sounding(live) : 0,
      booked: live ? live.voices : 0,
      tap: live ? tapOf(live) : null,
    };
  } catch {
    return { unlocked, state: 'none', voices: 0, booked: 0, tap: null };
  }
}

const bgmBuffers = new Map<string, AudioBuffer>();
/** A fresh compressor fades its gain in over about 0.2 s; an offline render lets that pass before the sound starts. */
const WARM_UP = 0.3;

/**
 * Dev only: renders whatever `fn` plays (through the same buses and limiter as the live engine) into a buffer,
 * so the lab can measure it. `bgm` adds a music track at the current music volume, to test the full mix;
 * `bypass` leaves the limiter out.
 */
export async function renderOffline(seconds: number, fn: () => void, opts: { bgm?: BgmKey; sampleRate?: number; bypass?: boolean } = {}): Promise<AudioBuffer | null> {
  if (!hasWindow || typeof OfflineAudioContext === 'undefined') return null;
  try {
    const sr = opts.sampleRate ?? 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * (WARM_UP + seconds)) + 256, sr);
    const e = createEngine(ctx, false, opts.bypass);
    setBuses(e, false);
    await loadSamples(ctx);
    if (opts.bgm && BGM[opts.bgm]) {
      let buf = bgmBuffers.get(opts.bgm);
      if (!buf) {
        buf = await ctx.decodeAudioData(await (await fetch(BGM[opts.bgm]!)).arrayBuffer());
        bgmBuffers.set(opts.bgm, buf);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(e.musicIn);
      src.start(0, Math.min(30, buf.duration / 3));
    }
    // `fn` runs when the render reaches the end of the warm-up; only what follows it is handed back
    let lead = 0;
    const scheduled = ctx.suspend(WARM_UP).then(() => {
      lead = Math.round(ctx.currentTime * sr);
      const prev = eng;
      eng = e;
      try {
        fn();
      } catch {
        /* render what was scheduled before it failed */
      } finally {
        eng = prev;
      }
      return ctx.resume();
    });
    const full = await ctx.startRendering();
    await scheduled;
    const length = Math.min(full.length - lead, Math.ceil(sr * seconds));
    const out = new AudioBuffer({ numberOfChannels: full.numberOfChannels, length, sampleRate: sr });
    for (let ch = 0; ch < full.numberOfChannels; ch += 1) out.copyToChannel(full.getChannelData(ch).subarray(lead, lead + length), ch);
    return out;
  } catch {
    return null;
  }
}
