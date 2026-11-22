// Packs the announcer's recorded pieces into one file the game reads (public/voice.bin) and the table that says
// which words each piece says and where it lies (src/core/voice/pieces.ts).
//
//   node scripts/pack-voice.mjs <manifest.tsv>
//
// The manifest has one piece a line: the words it says, a tab, and the path of its mp3 (relative to the manifest).
// A piece is a short, trimmed mp3 (mono). The pieces are not kept in the repository one by one: only the packed
// file is, and its bytes are scrambled (src/core/voice/voice.ts unscrambles a piece when it is needed).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const manifest = process.argv[2];
if (!manifest) {
  console.error('usage: node scripts/pack-voice.mjs <manifest.tsv>');
  process.exit(1);
}
const base = dirname(resolve(manifest));
const rows = readFileSync(manifest, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));

/** the same as scramble() in src/core/voice/voice.ts */
const scramble = (bytes, at) => {
  for (let i = 0; i < bytes.length; i += 1) bytes[i] ^= ((at + i) * 167 + 53) & 255;
  return bytes;
};

const parts = [];
const table = [];
let at = 0;
for (const [text, file] of rows) {
  const bytes = new Uint8Array(readFileSync(join(base, file)));
  table.push([text, at, bytes.length]);
  parts.push(scramble(bytes, at));
  at += bytes.length;
}
const out = new Uint8Array(at);
let p = 0;
for (const b of parts) {
  out.set(b, p);
  p += b.length;
}
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
writeFileSync(join(root, 'public/voice.bin'), out);
writeFileSync(join(root, 'src/core/voice/pieces.ts'), [
  '// Made by scripts/pack-voice.mjs: do not edit by hand.',
  '// Every recorded piece of the announcer: the words it says, and where it lies in public/voice.bin (offset, length).',
  '',
  `export const VOICE_BYTES = ${at};`,
  '',
  'export const PIECES: readonly (readonly [text: string, offset: number, length: number])[] = [',
  ...table.map(([t, o, n]) => `  [${JSON.stringify(t)}, ${o}, ${n}],`),
  '];',
  '',
].join('\n'));
console.log(`${table.length} pieces, ${(at / 1024 / 1024).toFixed(2)} MB`);
