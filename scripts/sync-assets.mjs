#!/usr/bin/env node
// Builds the game catalog from the My Crypto Heroes asset database
// (https://github.com/bearko/mycryptoheroes) and copies only the files the game uses.
//
//   node scripts/sync-assets.mjs
//
// Source directory: $MCH_ASSETS_DIR, else vendor/mycryptoheroes (git submodule).
// Outputs: public/mch/** (copied assets) and src/generated/catalog.json.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, process.env.MCH_ASSETS_DIR ?? 'vendor/mycryptoheroes');
const outPublic = join(root, 'public', 'mch');
const outCatalog = join(root, 'src', 'generated', 'catalog.json');

if (!existsSync(join(src, 'Data'))) {
  console.error(`[sync-assets] asset database not found at ${src}`);
  console.error('Run `git submodule update --init` or set MCH_ASSETS_DIR.');
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(join(src, p), 'utf8'));
let copied = 0;
/** Copies a file from the asset DB and returns its URL path relative to the site root. */
function use(relPath) {
  const from = join(src, relPath);
  if (!existsSync(from)) throw new Error(`missing asset: ${relPath}`);
  const to = join(outPublic, relPath);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
  return `mch/${relPath}`;
}

rmSync(outPublic, { recursive: true, force: true });

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

// ---------------------------------------------------------------- heroes
// Originals only (replicas and collaboration entries are left out).
// The name of each hero's passive skill becomes the name of that hero's special play.
const heroes = {};
for (const h of readJson('Data/Heroes/heroes.json')) {
  if (h.category !== 'original' || !RARITIES.includes(h.rarity?.name)) continue;
  if (!existsSync(join(src, h.image_file_path))) continue;
  heroes[h.id] = {
    id: h.id,
    name: h.name.ja,
    rarity: h.rarity.id,
    faction: h.faction?.name?.ja ?? '',
    passive: h.passive?.name?.ja ?? '',
    img: use(h.image_file_path),
  };
}

// ---------------------------------------------------------------- guide characters (every frame, keyed by file name)
// navi_ain_*: the club manager.  chris_*: the play-by-play announcer.
const chars = {};
for (const file of readdirSync(join(src, 'Image/Characters'))) {
  if (!/^(navi_ain|chris)_.*\.png$/.test(file)) continue;
  chars[file.replace(/\.png$/, '')] = use(`Image/Characters/${file}`);
}

// ---------------------------------------------------------------- sound
const bgm = {
  club: use('Audio/BGM/land.mp3'),
  match: use('Audio/BGM/pvp.mp3'),
  final: use('Audio/BGM/colosseum.mp3'),
};
const se = {
  win: use('Audio/SE/Jingles/win.mp3'),
  lose: use('Audio/SE/Jingles/lose.mp3'),
  special: use('Audio/SE/Jingles/knight.mp3'),
  hit: use('Audio/SE/Battle/1_single_damage.mp3'),
  bighit: use('Audio/SE/Battle/2_area_damage.mp3'),
  up: use('Audio/SE/Battle/4_buff.mp3'),
  down: use('Audio/SE/Battle/5_debuff_status_effect.mp3'),
  get: use('Audio/SE/Actions/open_treasure.mp3'),
};

mkdirSync(dirname(outCatalog), { recursive: true });
writeFileSync(outCatalog, `${JSON.stringify({ heroes, chars, bgm, se }, null, 1)}\n`);
console.log(`[sync-assets] ${Object.keys(heroes).length} heroes, ${copied} files → public/mch`);
