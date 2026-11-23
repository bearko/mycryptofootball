// The game in English.
//
// The game is written in Japanese; English is a dictionary laid over it (src/i18n/en.json, keyed by the Japanese
// text: a template's ${…} is {} there, and what fills it is translated in turn). The names of heroes, their skills
// and the database's items come from the asset database (catalog.json `en`).
//
// - `tr(text)`: the English of a Japanese text (itself, in Japanese, or when the dictionary has nothing for it).
// - `localize()`: from then on, every Japanese text that appears on the page is put into English as it appears
//   (a watcher on the page), so the screens need not call tr themselves. A text typed out letter by letter
//   (fx.ts typewriter) or cut up into parts (the manager's [[marks]]) is translated whole where it is made.
// - The language is a preference (save.ts Prefs.lang), asked on the very first start (ui/language.ts).

import catalog from '../generated/catalog.json';
import en from '../i18n/en.json';

export type Lang = 'ja' | 'en';

let current: Lang = 'ja';
export const lang = (): Lang => current;
export const isEn = (): boolean => current === 'en';
export function setLang(l: Lang): void {
  current = l;
  if (typeof document === 'undefined') return;
  document.documentElement.lang = l;
  document.documentElement.classList.toggle('en', l === 'en');
}

const JA = /[぀-ヿ㐀-鿿！-｠]/;
/** Is there Japanese in this text? */
export const hasJa = (text: string): boolean => JA.test(text);

/** exact texts: the dictionary's own and the database's names */
const exact = new Map<string, string>();
/** patterns with {} holes, longest first */
const patterns: { re: RegExp; to: string; key: string; open: boolean }[] = [];
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** names of the asset database made of several words ("サトシ・ナカモト ALPHA CC"): put in whole, before a line is cut at its dots and spaces */
const COMPOUND: [string, string][] = [];
// (an English name in the asset database may keep a Japanese dot: "SATOSHI・NAKAMOTO")
for (const [k, v] of Object.entries((catalog as { en?: Record<string, string> }).en ?? {})) {
  exact.set(k, v.replace(/・/g, ' '));
  if (/[・ ]/.test(k)) COMPOUND.push([k, v.replace(/・/g, ' ')]);
}
COMPOUND.sort((a, b) => b[0].length - a[0].length);
for (const [k, v] of Object.entries(en as Record<string, string>)) {
  if (!v) continue;
  if (k.includes('{}')) {
    const parts = k.split('{}').map(escape);
    patterns.push({ re: new RegExp(`^${parts.join('([\\s\\S]+?)')}$`), to: v, key: k, open: k.endsWith('{}') });
  } else exact.set(k, v);
}
// the most specific pattern first (the most fixed text)
patterns.sort((a, b) => b.key.replace(/\{\}/g, '').length - a.key.replace(/\{\}/g, '').length);

const MONTH = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** what a dictionary pattern cannot say: dates */
const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^(\d+)月(\d+)日（(.+)）$/, (m) => `${MONTH[+m[1]!]} ${m[2]} (${translate(m[3]!, 1)})`],
  [/^(\d+)月(\d+)日〜(?:(\d+)月)?(\d+)日$/, (m) => `${MONTH[+m[1]!]} ${m[2]}–${m[3] ? `${MONTH[+m[3]]} ` : ''}${m[4]}`],
  [/^(\d+)月$/, (m) => MONTH_FULL[+m[1]!] ?? m[0]],
];

/** the texts nothing could put into English (shown by i18nDebug() in the browser) */
const missing = new Set<string>();
const cache = new Map<string, string>();

/** The text in English (when the game is in English). */
export function tr(text: string): string {
  if (current !== 'en' || !text || !hasJa(text)) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  // one yard is a yard (the dictionary says "{} yards" for any number)
  const out = translate(text, 0).replace(/\b1 yards\b/g, '1 yard');
  if (cache.size > 5000) cache.clear();
  cache.set(text, out);
  // what was made is not put through again (a text node the page changed to it comes back to the watcher)
  cache.set(out, out);
  return out;
}

function translate(text: string, depth: number): string {
  // a part met again (in one line or another) is read as before
  const seen = cache.get(text);
  if (seen !== undefined) return seen;
  const out = translateRaw(text, depth);
  cache.set(text, out);
  if (depth === 0 && hasJa(out)) missing.add(text);
  return out;
}

const JA_ALL = new RegExp(JA.source, 'g');
/** how much Japanese is left in a text (the smaller the better) */
const left = (text: string): number => text.match(JA_ALL)?.length ?? 0;
const PAIRS: [string, string][] = [['（', '）'], ['「', '」'], ['(', ')'], ['『', '』'], ['【', '】']];
/** are the brackets of a part closed in it (a part cut out of the middle of brackets is no part) */
function balanced(text: string): boolean {
  for (const [o, c] of PAIRS) {
    let n = 0;
    for (const ch of text) {
      if (ch === o) n += 1;
      else if (ch === c && --n < 0) return false;
    }
    if (n !== 0) return false;
  }
  return true;
}
/** can a pattern's hole take this: closed brackets, and no end of a sentence or a label outside them */
function whole(text: string): boolean {
  if (!balanced(text)) return false;
  let depth = 0;
  for (const ch of text) {
    if ('（「(『【'.includes(ch)) depth += 1;
    else if ('）」)』】'.includes(ch)) depth -= 1;
    else if (depth === 0 && '。／：\n'.includes(ch)) return false;
  }
  return true;
}
/** the separators a line is cut at when nothing takes it whole, and what joins the English parts */
const SEPS: [string, string][] = [['\n', '\n'], ['。', '. '], ['：', ': '], ['／', ' / '], [' / ', ' / '], ['　', ' '], ['、', ', '], ['・', ' · '], [' ', ' ']];

/** A sentence cut from a line at its full stop: as it is, or as the dictionary has it, with its full stop. */
function sentence(text: string, depth: number): string {
  const plain = translate(text, depth);
  if (!hasJa(plain) || !text.trim()) return plain;
  const lead = text.match(/^\s*/)![0];
  const full = translate(`${text.trim()}。`, depth);
  return hasJa(full) ? plain : lead + full.replace(/\.$/, '');
}

/** Parts put back together where the dictionary has them together (two sentences of one text), the longest first. */
function groups(parts: string[], sep: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let j = parts.length;
    while (j > i + 1 && !exact.has(parts.slice(i, j).join(sep)) && !exact.has(parts.slice(i, j).join(sep) + sep)) j -= 1;
    const g = parts.slice(i, j).join(sep);
    out.push(j > i + 1 && !exact.has(g) ? g + sep : g);
    i = j;
  }
  return out;
}

function translateRaw(text: string, depth: number): string {
  if (!hasJa(text)) return text;
  const e = exact.get(text);
  if (e !== undefined) return e;
  // the text with its spaces trimmed (a line may come with a space at either end)
  const trimmed = text.trim();
  if (trimmed !== text) {
    const inner = translate(trimmed, depth);
    if (inner !== trimmed) return text.replace(trimmed, inner);
  }
  for (const [re, fn] of RULES) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  if (depth >= 6) return text;
  // the ways to read it: a pattern of the dictionary, or the line cut into parts. The first that leaves no
  // Japanese wins; failing that, the one that leaves the least.
  let best = text;
  let bestLeft = left(text);
  const consider = (out: string): boolean => {
    const l = left(out);
    if (l < bestLeft) {
      best = out;
      bestLeft = l;
    }
    return l === 0;
  };
  for (const p of patterns) {
    const m = p.re.exec(text);
    // a hole at the very end may take the rest of the line (a label：its text), the others one part of it
    if (!m || m.slice(1).some((c, i, all) => (p.open && i === all.length - 1 ? !balanced(c) : !whole(c)))) continue;
    let i = 0;
    const out = p.to.replace(/\{\}/g, () => {
      i += 1;
      return translate(m[i] ?? '', depth + 1);
    });
    if (consider(out)) return out;
  }
  for (const [ja, en] of COMPOUND) {
    if (!text.includes(ja) || text === ja) continue;
    const out = translate(text.split(ja).join(en), depth + 1);
    if (consider(out)) return out;
    break;
  }
  for (const [sep, join] of SEPS) {
    if (!text.includes(sep)) continue;
    const parts = text.split(sep);
    if (!parts.every(balanced)) continue;
    const done = groups(parts, sep).map((p) => (sep === '。' ? sentence(p, depth + 1) : translate(p, depth + 1)));
    // a sentence the dictionary already ends with its full stop takes no second one
    let out = done.reduce((acc, d, i) => (i === 0 ? d : acc + (sep === '。' && /[.!?]$/.test(acc) ? ' ' : join) + d), '').trimEnd();
    if (sep === '。') out = out.replace(/ {2,}/g, ' ');
    if (consider(out)) return out;
  }
  return best;
}

// ---------------------------------------------------------------- the page

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'] as const;

function fixText(node: Text): void {
  const v = node.nodeValue;
  if (!v || !hasJa(v)) return;
  const p = node.parentElement;
  if (p && (SKIP.has(p.tagName) || p.closest('[data-no-tr]'))) return;
  const t = tr(v);
  if (t !== v) node.nodeValue = t;
}
function fixEl(el: Element): void {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && hasJa(v)) {
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
}
function fixTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  fixEl(root as Element);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) fixText(n as Text);
    else fixEl(n as Element);
  }
}

/**
 * Text drawn on a canvas (the stadium's banners, the scoreboard) is put into English where it is drawn: the
 * drawing calls translate what they are given.
 */
function localizeCanvas(): void {
  const P = CanvasRenderingContext2D.prototype;
  for (const k of ['fillText', 'strokeText', 'measureText'] as const) {
    const orig = P[k] as (this: CanvasRenderingContext2D, text: string, ...rest: unknown[]) => unknown;
    (P as unknown as Record<string, unknown>)[k] = function (this: CanvasRenderingContext2D, text: string, ...rest: unknown[]) {
      return orig.call(this, typeof text === 'string' ? tr(text) : text, ...rest);
    };
  }
}

let watching = false;
/** From now on, Japanese text that appears on the page is put into English (the game in English only). */
export function localize(): void {
  if (watching || current !== 'en' || typeof MutationObserver === 'undefined') return;
  watching = true;
  (window as unknown as { i18nDebug: typeof i18nDebug }).i18nDebug = i18nDebug;
  if (typeof CanvasRenderingContext2D !== 'undefined') localizeCanvas();
  fixTree(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target as Text);
      else if (r.type === 'attributes') fixEl(r.target as Element);
      else r.addedNodes.forEach(fixTree);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  document.title = tr(document.title);
}

/** A hero's name in parts, for the places that break it (Japanese at its dots; English at its spaces). */
export const nameParts = (name: string): string[] => (current === 'en' ? tr(name).split(' ') : name.split('・'));

/** A list of choices: 「RBかWR」, "RB or WR". */
export const orList = (xs: string[]): string => xs.join(current === 'en' ? ' or ' : 'か');

/** For the browser console: the texts still in Japanese. */
export function i18nDebug(): string[] {
  return [...missing];
}
