// Everything that must survive a reload lives in one localStorage entry.

import { Rng } from './rng';
import type { MatchState } from '../game/match';
import type { Season } from '../game/season';

const KEY = 'mycryptofootball.save.v1';

export interface SaveData {
  v: 1;
  season: Season | null;
  /** a match in progress: the match state with its random generator flattened to a number */
  match: (Omit<MatchState, 'rng'> & { rng: number }) | null;
  mute: boolean;
  fast: boolean;
  /** seasons finished / titles won, for the title screen */
  seasons: number;
  titles: number;
  helpSeen: boolean;
}

const blank = (): SaveData => ({
  v: 1, season: null, match: null, mute: false, fast: false, seasons: 0, titles: 0, helpSeen: false,
});

let data: SaveData | null = null;

export function save(): SaveData {
  if (data) return data;
  data = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SaveData;
      if (parsed && parsed.v === 1) data = { ...blank(), ...parsed };
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
