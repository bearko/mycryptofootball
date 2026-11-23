// The game in English: the dictionary (src/i18n/en.json) has every Japanese text of the source, its holes match,
// and texts as the screens put them together come out with no Japanese left.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import { setLang, tr, hasJa } from '../src/core/i18n';

const dict = en as Record<string, string>;
const holes = (s: string): number => s.split('{}').length - 1;

beforeAll(() => setLang('en'));

describe('the English dictionary', () => {
  it('has an English for every Japanese text of the source', () => {
    const out = execFileSync('node', ['scripts/i18n-extract.mjs', '--missing'], { encoding: 'utf8' });
    const missing = (JSON.parse(out) as { ja: string; files: string[] }[]).map((m) => `${m.ja}  (${m.files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('keeps the holes of every pattern', () => {
    const bad = Object.entries(dict).filter(([k, v]) => v && holes(k) !== holes(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('gives the Japanese words the styles write (content: …) an English one under html.en', () => {
    const bad: string[] = [];
    for (const f of readdirSync('src/styles')) {
      const css = readFileSync(`src/styles/${f}`, 'utf8');
      for (const m of css.matchAll(/([^{}\n]+)\{[^}]*content:\s*'([^']*)'/g)) {
        const sel = m[1]!.trim();
        if (!hasJa(m[2]!) || sel.startsWith('html.en')) continue;
        if (!css.includes(`html.en ${sel} {`)) bad.push(`${f}: ${sel}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no Japanese in the English', () => {
    const bad = Object.entries(dict).filter(([, v]) => hasJa(v.replace(/[・「」（）、。！？：〜]/g, ''))).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

// texts the screens build out of parts (labels for the screen reader, lines joined with ： and 、)
const SAMPLES = [
  '1年目。格：素人（ゲージ 0/100）。押すと格の一覧',
  '3年生 7人が卒業。来年の春、新しい部員を7人までむかえられる',
  '4週間：キャッチ練習 ★1：走りながら捕る',
  'キャッチ練習 ★1：走りながら捕る',
  'ウィリアム・テル（1年生、QB・K、方針：パス、信頼11、体力100）',
  'ウィリアム・テル（3年生、控え、方針：パス、信頼11、体力100）',
  'ウィリアム・テル：タックル 24（苦手）',
  'ウィリアム・テル：パス 66（おすすめ・得意）',
  'ウィリアム・テル：走力 30',
  'カレンダー：きょうは4月5日（月）',
  'カレンダー：きょうは6月28日〜7月25日',
  'キッカー：那須与一（キック B）。押すと次のヒーローに交代',
  '攻撃のエース：チンギス・ハン。押すと次のヒーローに交代',
  'スポーツセンター：部費 10万円、練習の効果 2.6倍、疲れにくい',
  '学校：費用なし、練習の効果 2倍',
  'ポジション（攻撃/守備）。方針：タックル',
  'マネージャーの説明：11人制になったら',
  'RB or WRで出場中に使える',
  '相手の守備カードの読みを無効にして走る。読まれていても関係ない。攻撃の作戦／流れ2／RB or WRで出場中に使える',
  'パス守備 74',
  'ラン 77',
  'マイクリ vs 雷鳴館',
  '平将門「パワーラン」全員で押す／こちらの読み：初見',
  '戦術練習（空中戦・練度1）：空中戦の型を全員で合わせる。練度が上がる',
  '控え：源義経、特別作戦は使えない',
  '相手の守備カードの読みを無効にして走る。読まれていても関係ない。',
  'まとめて\n決める',
  '流れ2',
  'スマホを横向きにして遊んでください',
  '空中戦の練度が3に上がりました！ 新しく"Counter", "Play Action"が使えます。 試合の手札も1枚増えます。',
];

describe('one yard', () => {
  it('is said in the singular, and only one', () => {
    expect(tr('あと1ヤード、ここが大事！')).toBe('1 yard to go, a big one!');
    expect(tr('あと11ヤード、ここが大事！')).toBe('11 yards to go, a big one!');
  });
});

describe('texts put together by the screens', () => {
  it('come out in English', () => {
    const left = SAMPLES.map((s) => [s, tr(s)]).filter(([, t]) => hasJa(t!));
    expect(left).toEqual([]);
  });
});
