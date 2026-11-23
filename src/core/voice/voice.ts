// The announcer's voice. What the caster and the booth say on screen is spoken from recorded pieces
// (pieces.ts, packed into public/voice.bin by scripts/pack-voice.mjs): a line is cut into the pieces that make it,
// names and numbers included ("タッチダウン！ マイクリ学園に6点" = "タッチダウン！" "マイクリ学園" "に" "6点").
// A line that cannot be made wholly of pieces is not spoken (its text is still on the screen).
//
// The packed file is read once, when a match screen opens; a piece is decoded the first time it is said, and the
// last ones said are kept. Lines do not talk over each other: a line comes when the voice is free (or about to be),
// and only a big moment cuts in. Nothing here may throw: before the sound is unlocked, in tests, muted, or with the
// voice turned down to 0, nothing is said.

import { isEn } from '../i18n';
import { voiceOut } from '../audio';
import { PIECES, VOICE_BYTES } from './pieces';

/** The bytes of the packed file are scrambled; this turns them back (and is its own inverse). `at`: offset in the file. */
export function scramble(bytes: Uint8Array, at: number): Uint8Array {
  for (let i = 0; i < bytes.length; i += 1) bytes[i]! ^= ((at + i) * 167 + 53) & 255;
  return bytes;
}

// ------------------------------------------------------------------ cutting a line into pieces

/** the pieces that start with each character, longest first */
const BY_FIRST = new Map<string, number[]>();
PIECES.forEach(([text], i) => {
  const c = text[0]!;
  const list = BY_FIRST.get(c) ?? [];
  list.push(i);
  BY_FIRST.set(c, list);
});
for (const list of BY_FIRST.values()) list.sort((a, b) => PIECES[b]![0].length - PIECES[a]![0].length);

/** said as nothing */
const SPACE = /\s/;
/** may be left out (a short pause), at a price: a line made of whole pieces is better */
const MARK = /[、。！？…・]/;

/** The pieces a line is made of (fewest pieces first), or null when it cannot be made of pieces. */
export function cut(text: string): number[] | null {
  const n = text.length;
  const best: ({ cost: number; prev: number; piece: number } | null)[] = Array.from({ length: n + 1 }, () => null);
  best[0] = { cost: 0, prev: -1, piece: -1 };
  const relax = (to: number, cost: number, prev: number, piece: number): void => {
    const b = best[to];
    if (!b || cost < b.cost) best[to] = { cost, prev, piece };
  };
  for (let i = 0; i < n; i += 1) {
    const here = best[i];
    if (!here) continue;
    const c = text[i]!;
    if (SPACE.test(c)) relax(i + 1, here.cost, i, -1);
    else if (MARK.test(c)) relax(i + 1, here.cost + 3, i, -1);
    for (const p of BY_FIRST.get(c) ?? []) {
      const t = PIECES[p]![0];
      if (text.startsWith(t, i)) relax(i + t.length, here.cost + 1, i, p);
    }
  }
  if (!best[n]) return null;
  const out: number[] = [];
  for (let at = n; at > 0;) {
    const b = best[at]!;
    if (b.piece >= 0) out.push(b.piece);
    at = b.prev;
  }
  return out.length ? out.reverse() : null;
}

/**
 * The screen writes the schools by their short names; the voice says them in full. Puts the full names in
 * (a short name that is the start of the full one is not touched where the full one is already written).
 */
export function fullNames(text: string, teams: readonly { short: string; name: string }[]): string {
  let out = text;
  for (const { short, name } of teams) {
    if (!short || short === name) continue;
    const esc = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rest = name.startsWith(short) ? name.slice(short.length) : '';
    out = out.replace(new RegExp(rest ? `${esc(short)}(?!${esc(rest)})` : esc(short), 'g'), name);
  }
  return out;
}

// ------------------------------------------------------------------ the sound

const hasWindow = typeof window !== 'undefined' && typeof fetch === 'function';
let packed: Promise<Uint8Array | null> | null = null;

/** Starts reading the packed file (once). Call when a match screen opens. */
export function warmVoice(): void {
  if (!hasWindow || packed) return;
  try {
    packed = fetch(`${import.meta.env.BASE_URL}voice.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => {
        loaded = !!b && b.byteLength === VOICE_BYTES;
        return loaded ? new Uint8Array(b!) : null;
      })
      .catch(() => null);
  } catch {
    packed = Promise.resolve(null);
  }
}

/** decoded pieces, the most recently said last */
const decoded = new Map<number, Promise<AudioBuffer | null>>();
const KEEP = 160;

function decode(ctx: BaseAudioContext, p: number): Promise<AudioBuffer | null> {
  const have = decoded.get(p);
  if (have) {
    decoded.delete(p);
    decoded.set(p, have);
    return have;
  }
  warmVoice();
  const job = (packed ?? Promise.resolve(null)).then(async (bin) => {
    if (!bin) return null;
    const [, at, len] = PIECES[p]!;
    try {
      const bytes = scramble(bin.slice(at, at + len), at);
      return await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
    } catch {
      return null;
    }
  });
  decoded.set(p, job);
  while (decoded.size > KEEP) decoded.delete(decoded.keys().next().value!);
  return job;
}

/** a short breath between two pieces */
const GAP = 0.03;
/**
 * a piece that goes on from a name ("マイクリ学園" "に"): no breath, and a little into the end of the name (a piece
 * made alone ends as if the sentence did)
 */
const JOIN = -0.06;
const GOES_ON = /^[にがのをはへとでもや]/;
const ENDS = /[！？、。…]$/;
/** a line that waits longer than this for its pieces has missed its moment */
const TOO_LATE = 0.9;
/** a line comes after the one being said if that one ends within this */
const NEARLY = 0.45;

let playing: AudioBufferSourceNode[] = [];
let busyUntil = 0;
/** the line waiting for its pieces: a newer line replaces it */
let waiting = 0;
let waitingHot = false;
let ticket = 0;
/** lines said so far (for voiceDebug) */
let said = 0;
let loaded = false;

/** For checking in a browser: is the packed file read, how many pieces are decoded, how many lines were said. */
export function voiceDebug(): { loaded: boolean; decoded: number; said: number; busy: boolean } {
  return { loaded, decoded: decoded.size, said, busy: !!playing.length };
}

/** Stops whatever is being said (and what is waiting to be). */
export function hush(): void {
  ticket += 1;
  waiting = 0;
  busyUntil = 0;
  for (const s of playing) {
    try {
      s.stop();
    } catch {
      /* already over */
    }
  }
  playing = [];
}

/**
 * Says a line. `hot`: a big moment, which cuts in on whatever is being said. `quiet`: said only when the voice is
 * free (the booth's lines between plays).
 */
export function speak(text: string, opts: { hot?: boolean; quiet?: boolean } = {}): void {
  // (the announcer speaks Japanese only, for now)
  if (isEn()) return;
  try {
    const out = voiceOut();
    if (!out) return;
    const pieces = cut(text);
    if (!pieces) return;
    const ctx = out.ctx;
    const asked = ctx.currentTime;
    const busy = asked < busyUntil;
    if (opts.quiet && (busy || waiting)) return;
    if (waiting && waitingHot && !opts.hot) return;
    const mine = ++ticket;
    waiting = mine;
    waitingHot = !!opts.hot;
    void Promise.all(pieces.map((p) => decode(ctx, p))).then((bufs) => {
      if (mine !== ticket) return;
      waiting = 0;
      const now = ctx.currentTime;
      if (now - asked > TOO_LATE || bufs.some((b) => !b)) return;
      let t = now + 0.02;
      if (now < busyUntil) {
        if (opts.hot) {
          for (const s of playing) {
            try {
              s.stop(t);
            } catch {
              /* already over */
            }
          }
          playing = [];
        } else if (busyUntil - now < NEARLY) t = busyUntil + GAP;
        else return;
      }
      const start = t;
      (bufs as AudioBuffer[]).forEach((b, i) => {
        if (i > 0 && GOES_ON.test(PIECES[pieces[i]!]![0]) && !ENDS.test(PIECES[pieces[i - 1]!]![0])) t += JOIN - GAP;
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(out.node);
        src.start(t);
        src.onended = () => {
          playing = playing.filter((s) => s !== src);
        };
        playing.push(src);
        t += b.duration + GAP;
      });
      busyUntil = t;
      said += 1;
      out.duck((t - start) * 1000);
    }, () => undefined);
  } catch {
    /* silence */
  }
}

/** Decodes the pieces of lines that are about to be said (a play's calls are known before it is shown). */
export function prefetchVoice(texts: readonly string[]): void {
  try {
    const out = voiceOut();
    if (!out) return;
    for (const t of texts) for (const p of cut(t) ?? []) void decode(out.ctx, p);
  } catch {
    /* ignore */
  }
}
