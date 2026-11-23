// Lists the Japanese text in the game's source, as the patterns the English dictionary (src/i18n/en.json) is keyed
// by: a template's ${…} becomes {}. `node scripts/i18n-extract.mjs [--missing]` prints JSON; --missing leaves out what
// the dictionary already has.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const JA = /[぀-ヿ一-鿿]/;
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['generated', 'voice'].includes(f)) walk(p); }
    else if (p.endsWith('.ts')) files.push(p);
  }
};
walk('src');
const found = new Map();
/**
 * The string literals of a source file (quotes and templates; a template's ${…} becomes {}), skipping comments and
 * import lines. A small scanner: enough for this code base.
 */
function literals(code) {
  const out = [];
  let i = 0;
  const n = code.length;
  // a template from its opening backtick; returns [pattern, index after the closing backtick]
  const template = (at) => {
    let j = at + 1;
    let text = '';
    while (j < n && code[j] !== '`') {
      if (code[j] === '\\') { text += code[j + 1]; j += 2; continue; }
      if (code[j] === '$' && code[j + 1] === '{') {
        j += 2;
        let depth = 1;
        while (j < n && depth) {
          const c = code[j];
          if (c === '`') { const [inner, k] = template(j); out.push(inner); j = k; continue; }
          if (c === "'" || c === '"') { const [lit, k] = quoted(j); out.push(lit); j = k; continue; }
          if (c === '{') depth += 1;
          else if (c === '}') depth -= 1;
          j += 1;
        }
        text += '{}';
        continue;
      }
      text += code[j];
      j += 1;
    }
    return [text, j + 1];
  };
  const quoted = (at) => {
    const q = code[at];
    let j = at + 1;
    let text = '';
    while (j < n && code[j] !== q) {
      if (code[j] === '\\') { const e = code[j + 1]; text += e === 'n' ? '\n' : e; j += 2; continue; }
      text += code[j];
      j += 1;
    }
    return [text, j + 1];
  };
  while (i < n) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i) + 2; continue; }
    if (code.startsWith('import ', i) && (i === 0 || code[i - 1] === '\n')) { i = code.indexOf(';', i) + 1; continue; }
    if (c === "'" || c === '"') { const [lit, k] = quoted(i); out.push(lit); i = k; continue; }
    if (c === '`') { const [lit, k] = template(i); out.push(lit); i = k; continue; }
    i += 1;
  }
  return out;
}
for (const f of files) {
  for (const text of literals(readFileSync(f, 'utf8'))) {
    if (!JA.test(text)) continue;
    const prev = found.get(text) ?? [];
    const name = f.replace('src/', '');
    if (!prev.includes(name)) prev.push(name);
    found.set(text, prev);
  }
}
// read by the translator's own rules (dates: src/core/i18n.ts RULES), or both languages on purpose (the choice of
// language)
const OWN = new Set(['{}月{}日（{}）', '{}月', '{}月{}日〜{}{}日', '言語選択', '日本語', 'Language / 言語',
  'You can change this later in Settings. / あとから「設定」で変えられます。']);
for (const k of OWN) found.delete(k);
const dict = existsSync('src/i18n/en.json') ? JSON.parse(readFileSync('src/i18n/en.json', 'utf8')) : {};
const missing = process.argv.includes('--missing');
const out = [...found].filter(([k]) => !missing || !(k in dict)).map(([k, fs]) => ({ ja: k, files: fs }));
console.log(JSON.stringify(out, null, 1));
