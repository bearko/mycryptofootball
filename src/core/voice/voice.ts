// The announcer's voice. What the caster and the booth say on screen is spoken from recorded pieces
// (pieces.ts, packed into public/voice.bin by scripts/pack-voice.mjs): a line is cut into the pieces that make it,
// names and numbers included ("タッチダウン！ マイクリ学園に6点" = "タッチダウン！" "マイクリ学園" "に" "6点").
// A line that cannot be made wholly of pieces is not spoken (its text is still on the screen).
//
// The packed file is read once, when a match screen opens; a piece is decoded the first time it is said, and the
// last ones said are kept. Lines do not talk over each other: a line comes when the voice is free (or about to be),
// and only a big moment cuts in. Nothing here may throw: before the sound is unlocked, in tests, muted, or with the
// voice turned down to 0, nothing is said.

import { voiceOut } from '../audio';
import { PIECES, VOICE_BYTES } from './pieces';
import { PIECES_EN, VOICE_BYTES_EN } from './pieces-en';
import { isEn, tr } from '../i18n';

/** The bytes of the packed file are scrambled; this turns them back (and is its own inverse). `at`: offset in the file. */
export function scramble(bytes: Uint8Array, at: number): Uint8Array {
  for (let i = 0; i < bytes.length; i += 1) bytes[i]! ^= ((at + i) * 167 + 53) & 255;
  return bytes;
}

// ------------------------------------------------------------------ cutting a line into pieces

type Table = readonly (readonly [text: string, offset: number, length: number])[];

/** the pieces that start with each character, longest first */
function byFirst(table: Table): Map<string, number[]> {
  const map = new Map<string, number[]>();
  table.forEach(([text], i) => {
    const c = text[0]!;
    const list = map.get(c) ?? [];
    list.push(i);
    map.set(c, list);
  });
  for (const list of map.values()) list.sort((a, b) => table[b]![0].length - table[a]![0].length);
  return map;
}
const JA_FIRST = byFirst(PIECES);
const EN_FIRST = byFirst(PIECES_EN);

/** said as nothing */
const SPACE = /\s/;
/** may be left out (a short pause), at a price: a line made of whole pieces is better */
const MARK = /[、。！？…・]/;
const MARK_EN = /[,.!?…:;"'\u2019\u2014\u2013-]/;
/** a letter of a word (an English piece begins and ends at the edges of words) */
const WORD = /[A-Za-z0-9]/;

/** The pieces a line is made of (fewest pieces first), or null when it cannot be made of pieces. */
export function cut(text: string, en = isEn()): number[] | null {
  return cutWith(text, en ? PIECES_EN : PIECES, en ? EN_FIRST : JA_FIRST, en);
}

/** The same, with any table of pieces (`en`: English, whose pieces are whole words). */
export function cutWith(text: string, table: Table, first: Map<string, number[]> = byFirst(table), en = false): number[] | null {
  const n = text.length;
  const best: ({ cost: number; prev: number; piece: number } | null)[] = Array.from({ length: n + 1 }, () => null);
  best[0] = { cost: 0, prev: -1, piece: -1 };
  const relax = (to: number, cost: number, prev: number, piece: number): void => {
    const b = best[to];
    if (!b || cost < b.cost) best[to] = { cost, prev, piece };
  };
  const mark = en ? MARK_EN : MARK;
  for (let i = 0; i < n; i += 1) {
    const here = best[i];
    if (!here) continue;
    const c = text[i]!;
    if (SPACE.test(c)) relax(i + 1, here.cost, i, -1);
    else if (mark.test(c)) relax(i + 1, here.cost + 3, i, -1);
    if (en && i > 0 && WORD.test(c) && WORD.test(text[i - 1]!)) continue;
    for (const p of first.get(c) ?? []) {
      const t = table[p]![0];
      if (!text.startsWith(t, i)) continue;
      const end = i + t.length;
      if (en && end < n && WORD.test(text[end]!) && WORD.test(t[t.length - 1]!)) continue;
      relax(end, here.cost + 1, i, p);
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

/** the announcer of the game's language: his pieces and the file they are packed in (the language is set before
 * anything is said, and changing it reloads the page) */
const voiceOf = (): { pieces: Table; bytes: number; file: string } =>
  isEn() ? { pieces: PIECES_EN, bytes: VOICE_BYTES_EN, file: 'voice-en.bin' } : { pieces: PIECES, bytes: VOICE_BYTES, file: 'voice.bin' };

const hasWindow = typeof window !== 'undefined' && typeof fetch === 'function';
let packed: Promise<Uint8Array | null> | null = null;

/** Starts reading the packed file (once). Call when a match screen opens. */
export function warmVoice(): void {
  if (!hasWindow || packed) return;
  try {
    const { file, bytes } = voiceOf();
    packed = fetch(`${import.meta.env.BASE_URL}${file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => {
        loaded = !!b && bytes > 0 && b.byteLength === bytes;
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
    const [, at, len] = voiceOf().pieces[p]!;
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
/** an English piece that does not end a sentence: the next one comes in a little before its end */
const EN_JOIN = -0.05;
const EN_ENDS = /[!?.,]$/;
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
  try {
    const out = voiceOut();
    if (!out) return;
    // in English the line is said as the screen shows it (a line given in Japanese is put into English first)
    const pieces = cut(isEn() ? tr(text) : text);
    const table = voiceOf().pieces;
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
        if (i > 0 && !isEn() && GOES_ON.test(table[pieces[i]!]![0]) && !ENDS.test(table[pieces[i - 1]!]![0])) t += JOIN - GAP;
        // English words in the middle of a sentence run on into each other ("Returned" "18 yards!")
        if (i > 0 && isEn() && !EN_ENDS.test(table[pieces[i - 1]!]![0])) t += EN_JOIN - GAP;
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
    for (const t of texts) for (const p of cut(isEn() ? tr(t) : t) ?? []) void decode(out.ctx, p);
  } catch {
    /* ignore */
  }
}
