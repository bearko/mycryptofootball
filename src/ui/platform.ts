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

/** the title's id on the platform (its host is football.bearko.games) */
const GAME = 'football';

/** The least of the SDK that is used here (bearko.games/sdk/v1.js). */
interface Sdk {
  init(opts: Record<string, unknown>): Promise<unknown>;
  tutorialStep(step: number, id: string): unknown;
  unlockTrophy(id: string): Promise<unknown>;
  submitScore(metrics: Record<string, unknown>, opts?: { quiet?: boolean }): Promise<unknown>;
  rta: { start(opts: Record<string, unknown>): Promise<unknown>; checkpoint(id: string, opts?: { igtMs?: number }): Promise<unknown>; abort(): void };
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
  } catch (err) {
    console.warn('[platform] start', err);
  }
}

/** True once the SDK is there (the chat can be offered). */
export const platformOn = (): boolean => ready;

export function openChat(): void {
  guard('chat.open', (api) => api.chat.open());
}

// ---------------------------------------------------------------- the first year, step by step

/**
 * The steps of a new coach's first year (docs/PLATFORM.md has the table). Once published, a number and its id
 * are never changed: a new step takes a free number.
 */
export const STEPS = {
  start: 0,
  first_pick: 4,
  recruit_done: 8,
  policy_done: 12,
  first_practice: 16,
  day3: 22,
  match_day: 28,
  match_start: 32,
  first_play: 36,
  halftime: 42,
  first_match_done: 48,
  week2: 54,
  cup_start: 60,
  cup_r1_done: 66,
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
    if (s.phase === 'recruit') return;
    step('recruit_done');
    // (the first meeting on the training policy: reported when it is closed, or at the latest with the first practice)
    if (s.day > 0) step('policy_done');
    if (s.day >= 1) step('first_practice');
    if (s.day >= 2) step('day3');
    if (s.day >= 6) step('match_day');
    const played = s.results.length;
    if (m || played >= 1) step('match_start');
    if ((m && m.n >= 1) || played >= 1) step('first_play');
    if ((m && played === 0 && m.quarter >= 3) || played >= 1) step('halftime');
    if (played >= 1) step('first_match_done');
    if (s.day >= 8) step('week2');
    if ((m && played === 1) || played >= 2) step('cup_start');
    if (played >= 2) step('cup_r1_done');
    if (s.phase === 'done') step('done');
  } catch (err) {
    console.warn('[platform] trackGuide', err);
  }
}

/** A step that is not in the saved game (the first hero picked at the briefing). */
export function guideEvent(d: SaveData, id: GuideStep): void {
  if (guided(d)) step(id);
}

// ---------------------------------------------------------------- achievements, total score, RTA
// (the doors only: what to send is settled with the platform first — see docs/PLATFORM.md)

export function unlockTrophy(name: string): void {
  guard('unlockTrophy', (api) => api.unlockTrophy(`${GAME}.${name}`));
}

export function submitScore(metrics: Record<string, unknown>, quiet = false): void {
  guard('submitScore', (api) => api.submitScore(metrics, { quiet }));
}

export const rta = {
  start: (regulation: string): void => void guard('rta.start', (api) => api.rta.start({ regulation })),
  checkpoint: (id: string, igtMs?: number): void => void guard('rta.checkpoint', (api) => api.rta.checkpoint(id, { igtMs })),
  abort: (): void => void guard('rta.abort', (api) => api.rta.abort()),
};
