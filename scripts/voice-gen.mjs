// Makes the announcer's pieces with a speech generator (ElevenLabs), one generation for each piece, and writes the
// manifest that scripts/pack-voice.mjs packs. Pieces already made in the folder are kept, so new words can be added
// later without making everything again.
//
//   ELEVENLABS_API_KEY=… node scripts/voice-gen.mjs <dir> [extra.txt]
//   node scripts/pack-voice.mjs <dir>/manifest.tsv
//
// The pieces are those of src/core/voice/pieces.ts, then the lines of extra.txt (words not said yet; one a line).
// A name the generator could read wrong is given to it in kana (scripts/voice-readings.json); a piece whose words or
// reading changed is made again.
// <dir>/raw/ keeps what the generator gave; <dir>/out/ the trimmed, small mono pieces. The folder is not part of the
// repository (the voice is shipped only packed). Requests go through curl (it follows the proxy settings).
// VOICE_ID and MODEL may be set; by default the club's announcer and eleven_v4.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const [dir, extraFile] = process.argv.slice(2);
const KEY = (process.env.ELEVENLABS_API_KEY ?? '').trim();
if (!dir || !KEY) {
  console.error('usage: ELEVENLABS_API_KEY=… node scripts/voice-gen.mjs <dir> [extra.txt]');
  process.exit(1);
}
const VOICE = process.env.VOICE_ID ?? 'J1DALOfipG5iKvQ4qv7N';
const MODEL = process.env.MODEL ?? 'eleven_v4';
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const src = readFileSync(join(root, 'src/core/voice/pieces.ts'), 'utf8');
const known = [...src.matchAll(/^ {2}\[(".*?"), \d+, \d+\],$/gm)].map((m) => JSON.parse(m[1]));
const extra = extraFile ? readFileSync(extraFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
const all = [...new Set([...known, ...extra])];
const READ = JSON.parse(readFileSync(join(root, 'scripts/voice-readings.json'), 'utf8'));
/** what the generator is given for a piece (a piece that begins with a comma is said without it) */
const spokenOf = (text) => READ[text] ?? text.replace(/^[、。]+/, '');

const raw = join(dir, 'raw');
const out = join(dir, 'out');
mkdirSync(raw, { recursive: true });
mkdirSync(out, { recursive: true });
/** a piece's file name: the same words always get the same file */
const names = existsSync(join(dir, 'names.json')) ? JSON.parse(readFileSync(join(dir, 'names.json'), 'utf8')) : {};
let next = Object.keys(names).length + 1;
for (const t of all) if (!names[t]) names[t] = `${String(next++).padStart(4, '0')}.mp3`;
writeFileSync(join(dir, 'names.json'), JSON.stringify(names, null, 1));

const body = join(dir, 'body.json');
/** what each made piece was made from */
const madeFrom = existsSync(join(dir, 'spoken.json')) ? JSON.parse(readFileSync(join(dir, 'spoken.json'), 'utf8')) : {};
for (const text of all) {
  const f = join(raw, names[text]);
  const spoken = spokenOf(text);
  if (existsSync(f) && (madeFrom[text] ?? text.replace(/^[、。]+/, '')) === spoken) continue;
  for (const old of [f, join(out, names[text])]) if (existsSync(old)) unlinkSync(old);
  writeFileSync(body, JSON.stringify({ text: spoken, model_id: MODEL }));
  let code = '';
  for (let tries = 0; tries < 3 && code !== '200'; tries += 1) {
    code = execFileSync('curl', ['-s', '-o', f, '-w', '%{http_code}', '--max-time', '90', '-H', `xi-api-key: ${KEY}`,
      '-H', 'content-type: application/json', '--data-binary', `@${body}`,
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`], { encoding: 'utf8' });
    if (code !== '200') {
      console.error(`${text}: ${code}`);
      if (existsSync(f)) unlinkSync(f);
    }
  }
  madeFrom[text] = spoken;
  writeFileSync(join(dir, 'spoken.json'), JSON.stringify(madeFrom, null, 1));
  console.log(`made ${names[text]} ${text}`);
}

// trimmed, mono and small, like the recorded pieces were
const rows = [];
for (const text of all) {
  const name = names[text];
  const f = join(out, name);
  if (!existsSync(f)) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(raw, name),
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,volume=-3dB',
      '-ac', '1', '-ar', '24000', '-b:a', '40k', f]);
  }
  rows.push(`${text}\tout/${name}`);
}
writeFileSync(join(dir, 'manifest.tsv'), rows.join('\n') + '\n');
console.log(`${rows.length} pieces in ${join(dir, 'manifest.tsv')}`);
