// Everything that must survive a reload lives in one localStorage entry.

import { Rng } from './rng';
import type { MatchState } from '../game/match';
import type { Season } from '../game/season';

const KEY = 'mycryptofootball.save.v1';

export interface Prefs {
  /** 0..1 */
  bgm: number;
  /** 0..1: effects, crowd and jingles */
  se: number;
  /** false: no screen shake, no flashes, no slow motion; short transitions */
  motion: boolean;
  /** phone vibration on hits and big moments (where the browser supports it) */
  haptics: boolean;
  /** 1: normal, 1.15: large text */
  text: number;
  /** adds shapes and patterns wherever a color carries meaning */
  colorSafe: boolean;
}

export const defaultPrefs = (): Prefs => ({ bgm: 0.6, se: 0.8, motion: true, haptics: true, text: 1, colorSafe: false });

export interface SaveData {
  v: 1;
  season: Season | null;
  /** a match in progress: the match state with its random generator flattened to a number */
  match: (Omit<MatchState, 'rng'> & { rng: number }) | null;
  mute: boolean;
  fast: boolean;
  /** how the game looks, sounds and feels (the settings panel) */
  prefs: Prefs;
  /** seasons finished / titles won, for the title screen */
  seasons: number;
  titles: number;
  helpSeen: boolean;
}

const blank = (): SaveData => ({
  v: 1, season: null, match: null, mute: false, fast: false, prefs: defaultPrefs(), seasons: 0, titles: 0, helpSeen: false,
});

let data: SaveData | null = null;

export function save(): SaveData {
  if (data) return data;
  data = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SaveData;
      if (parsed && parsed.v === 1) data = { ...blank(), ...parsed, prefs: { ...defaultPrefs(), ...(parsed.prefs ?? {}) } };
      // a season saved under older rules cannot be continued: it starts over (settings and records stay)
      if (data.season && (data.season as { v?: number }).v !== 2) {
        data.season = null;
        data.match = null;
      }
    }
  } catch {
    /* a browser without storage still runs the game, it just forgets */
  }
  return data;
}

export function commit(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save()));
  } catch {
    /* ignore */
  }
}

export function storeMatch(st: MatchState | null): void {
  save().match = st ? { ...st, rng: st.rng.s } : null;
  commit();
}

export function loadMatch(): MatchState | null {
  const m = save().match;
  if (!m) return null;
  // a deep copy, so playing on never touches the stored snapshot
  const copy = JSON.parse(JSON.stringify(m)) as typeof m;
  return { ...copy, rng: new Rng(copy.rng) };
}

/** The current settings (always defined). */
export const prefs = (): Prefs => save().prefs;
