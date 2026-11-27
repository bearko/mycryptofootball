/**
 * The one door to the shared platform of bearko.games (login, achievements, total score, RTA, the chat, the
 * numbers on who plays). Nothing else touches `window.BearkoGames`.
 *
 * The game must play to the end without it: the SDK may fail to load (offline, a blocker) or its calls may fail
 * (the title not yet registered). Every call is wrapped; a failure is a console warning and nothing more.
 * The game keeps no cookie of its own: the platform holds the login.
 */
import { version } from '../../package.json';
import { onCommit, type SaveData } from '../core/save';
import { lessonsOver } from '../game/tutorial';
import { RTA_REGULATION, achieved, daysPlayed, scoreOf, splitsReached } from '../game/feats';

/** the title's id on the platform (its host is football.bearko.games) */
const GAME = 'football';

/** The least of the SDK that is used here (bearko.games/sdk/v1.js). */
interface Sdk {
  init(opts: Record<string, unknown>): Promise<unknown>;
  tutorialStep(step: number, id: string): unknown;
  unlockTrophy(id: string): Promise<unknown>;
  submitScore(metrics: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<unknown>;
  rta: {
    start(opts: Record<string, unknown>): Promise<unknown>;
    checkpoint(id: string, opts?: { igtMs?: number }): Promise<unknown>;
    abort(): void;
    current(): { runId: string; regulation: string } | null;
    getRegulations(): Promise<{ ok: boolean; regulations?: { id: string }[] }>;
  };
  chat: { open(): void; setVisible(on: boolean): void };
}

const found = (): Sdk | undefined => (window as unknown as { BearkoGames?: Sdk }).BearkoGames;
let ready = false;

function guard<T>(what: string, run: (api: Sdk) => T): T | undefined {
  try {
    const api = ready ? found() : undefined;
    if (!api) return undefined;
    const out = run(api);
    if (out instanceof Promise) out.catch((err: unknown) => console.warn(`[platform] ${what}`, err));
    return out;
  } catch (err) {
    console.warn(`[platform] ${what}`, err);
    return undefined;
  }
}

/** Called once as the game starts. The SDK is a deferred script: if it is not there yet, wait for the page to load. */
export function startPlatform(): void {
  const begin = (): void => {
    if (ready || !found()) return;
    ready = true;
    // The chat: the game fills the whole screen (the field, the hand of cards, the score in the corners), so
    // neither the dock on the right nor a button of its own is shown: it is opened from the title and from Settings.
    // Notices come at the top, clear of the cards.
    guard('init', (api) => api.init({ game: GAME, version, chat: { layout: 'float', button: false }, toast: 'top', toastOffset: 8 }));
    for (const [step, id] of waiting) guard('tutorialStep', (api) => api.tutorialStep(step, id));
    waiting.length = 0;
  };
  try {
    begin();
    if (!ready) window.addEventListener('load', begin, { once: true });
    // the first year is followed from what is saved: every time the game is saved, the steps reached are reported
    onCommit(trackGuide);
    onCommit(trackFeats);
  } catch (err) {
    console.warn('[platform] start', err);
  }
}

/** True once the SDK is there (the chat can be offered). */
export const platformOn = (): boolean => ready;

export function openChat(): void {
  guard('chat.open', (api) => api.chat.open());
}

// ---------------------------------------------------------------- the first week, step by step

/**
 * The steps of the tutorial: a new coach's first week, up to the end of the manager's last lesson after the
 * practice match (docs/PLATFORM.md has the table). Once published, a number and its id are never changed:
 * a new step takes a free number.
 */
export const STEPS = {
  start: 0,
  captain: 6,
  recruit_done: 12,
  policy_done: 18,
  first_practice: 24,
  day3: 30,
  match_day: 36,
  match_start: 42,
  first_play: 48,
  second_play: 54,
  first_td: 60,
  match_done: 66,
  done: 90,
} as const;
export type GuideStep = keyof typeof STEPS;

const sent = new Set<string>();
const waiting: [number, string][] = [];

function step(id: GuideStep): void {
  if (sent.has(id)) return;
  sent.add(id);
  if (!ready) waiting.push([STEPS[id], id]);
  else guard('tutorialStep', (api) => api.tutorialStep(STEPS[id], id));
}

/** Is this a club a new coach founded from the title screen, still in its first year? (Not an old save, a test or a bot.) */
const guided = (d: SaveData): boolean => !!d.season && d.season.guide === true && d.season.year === 1;

/**
 * Looks at the saved game as it stands and reports the steps reached (each is sent once).
 * Only the first year of a club founded from the title counts.
 */
export function trackGuide(d: SaveData): void {
  try {
    if (!guided(d)) return;
    const s = d.season!;
    const m = d.match;
    step('start');
    // the manager has said everything, or the coach has waved the rest away: the tutorial is over, wherever that was
    const over = (): void => {
      if (lessonsOver(s)) step('done');
    };
    if (s.phase === 'recruit') {
      over();
      return;
    }
    step('recruit_done');
    // (the first meeting on the training policy: reported when it is closed, or at the latest with the first practice)
    if (s.day > 0) step('policy_done');
    if (s.day >= 1) step('first_practice');
    if (s.day >= 2) step('day3');
    if (s.day >= 6) step('match_day');
    const played = s.results.length;
    if (m || played >= 1) step('match_start');
    if (played >= 1) step('match_done');
    over();
  } catch (err) {
    console.warn('[platform] trackGuide', err);
  }
}

/** A step that is not in the saved game (the captain picked at the briefing, the cards played in the first match). */
export function guideEvent(d: SaveData, id: GuideStep): void {
  if (guided(d)) step(id);
}

// ---------------------------------------------------------------- achievements, total score, RTA
// What the club has done is read from the saved season (game/feats.ts) every time the game is saved. The platform
// keeps the first of each, so what is sent while the title is not yet set up there is simply sent again later.

const unlocked = new Set<string>();
let scored = '';
let scoreAt = 0;
let scoreTimer: ReturnType<typeof setTimeout> | undefined;
/** the platform takes a quiet score at most once a minute */
const SCORE_GAP = 61_000;

function sendScore(d: SaveData, loud: boolean): void {
  const s = d.season;
  if (!s) return;
  const metrics = scoreOf(s);
  const key = JSON.stringify(metrics);
  if (key === scored && !loud) return;
  const wait = loud ? 0 : scoreAt + SCORE_GAP - Date.now();
  clearTimeout(scoreTimer);
  if (wait > 0) {
    scoreTimer = setTimeout(() => sendScore(d, false), wait);
    return;
  }
  scored = key;
  scoreAt = Date.now();
  guard('submitScore', (api) => api.submitScore(metrics, { quiet: !loud }));
}

/** Sends what the saved club has reached: its achievements, its total score and, in an RTA, the splits. */
export function trackFeats(d: SaveData): void {
  try {
    const s = d.season;
    if (!ready || !s || !s.members.length) return;
    for (const a of achieved(s)) {
      if (unlocked.has(a)) continue;
      unlocked.add(a);
      guard('unlockTrophy', (api) => api.unlockTrophy(`${GAME}.${a}`));
    }
    sendScore(d, false);
    trackRta(d);
  } catch (err) {
    console.warn('[platform] trackFeats', err);
  }
}

/** The year's end: the total score with a notice. */
export function yearScore(d: SaveData): void {
  try {
    if (ready && d.season?.members.length) sendScore(d, true);
  } catch (err) {
    console.warn('[platform] yearScore', err);
  }
}

// ---- the RTA: from the founding briefing to the district title, timed by the platform (its timer, its notices)

let regulationOn: boolean | null = null;
/** Is the RTA open on the platform? (asked once; until then and without the SDK: no) */
export async function rtaOpen(): Promise<boolean> {
  if (regulationOn !== null) return regulationOn;
  const api = ready ? found() : undefined;
  if (!api) return false;
  try {
    const r = await api.rta.getRegulations();
    regulationOn = !!r.ok && !!r.regulations?.some((x) => x.id === RTA_REGULATION);
  } catch (err) {
    console.warn('[platform] rta.getRegulations', err);
    regulationOn = false;
  }
  return regulationOn;
}

/** Is a run being timed now? (the page must not reload under it: core/update.ts waits) */
export const rtaRunning = (): boolean => !!guard('rta.current', (api) => api.rta.current());

/** Starts the timing of a new club's run. */
export function startRta(): Promise<boolean> {
  const api = ready ? found() : undefined;
  if (!api) return Promise.resolve(false);
  const fail = (err: unknown): boolean => {
    console.warn('[platform] rta.start', err);
    return false;
  };
  try {
    return api.rta.start({ regulation: RTA_REGULATION }).then((r) => !!(r as { ok?: boolean })?.ok, fail);
  } catch (err) {
    return Promise.resolve(fail(err));
  }
}

/** Stops a run (a new club is founded, the run's club is gone). */
export function abortRta(): void {
  guard('rta.abort', (api) => api.rta.abort());
}

function trackRta(d: SaveData): void {
  const s = d.season!;
  if (!s.rta) return;
  const run = guard('rta.current', (api) => api.rta.current());
  // the page was reloaded or the run ended: the platform's timing is gone, and so is the run
  if (!run || run.regulation !== s.rta.reg) {
    s.rta = undefined;
    return;
  }
  for (const split of splitsReached(s)) {
    if (s.rta.sent.includes(split)) continue;
    s.rta.sent.push(split);
    guard('rta.checkpoint', (api) => api.rta.checkpoint(split, { igtMs: daysPlayed(s) }));
  }
}
