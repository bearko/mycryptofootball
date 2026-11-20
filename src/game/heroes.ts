// The heroes who may join the club. Each one is outstanding at exactly one thing,
// and each one brings one special play, named after the hero's own passive skill.

import catalog from '../generated/catalog.json';
import { KIND, type Kind, type SpecialCard } from './cards';
import { STATS, type Stat, type Stats } from './model';

export interface CatalogHero {
  id: number;
  name: string;
  rarity: number;
  faction: string;
  passive: string;
  img: string;
}

const HEROES = catalog.heroes as Record<string, CatalogHero>;
export const hero = (id: number): CatalogHero => {
  const h = HEROES[String(id)];
  if (!h) throw new Error(`unknown hero ${id}`);
  return h;
};

export interface Recruit {
  id: number;
  stats: Stats;
  kind: Kind;
  /** one line on who this is on the field */
  blurb: string;
  /** what the hero says when introducing themselves */
  line: string;
}

const s = (spd: number, pas: number, cat: number, blk: number, tkl: number, iq: number): Stats =>
  ({ spd, pas, cat, blk, tkl, iq });

/** Two heroes for each of the six abilities. */
export const RECRUITS: readonly Recruit[] = [
  { id: 5019, stats: s(72, 30, 42, 22, 34, 38), kind: 'powerRun', blurb: '崖も駆け下りる俊足。ボールを持たせれば誰にも止められない', line: '崖だろうと坂だろうと、まっすぐ駆け下りるのみ！' },
  { id: 3038, stats: s(66, 26, 46, 18, 36, 44), kind: 'trick', blurb: '煙にまぎれる忍び。相手の読みをすり抜けて走る', line: '煙が晴れたときには、もうゴールの向こうでござる。' },
  { id: 5028, stats: s(34, 72, 30, 24, 20, 42), kind: 'sureLong', blurb: '波に揺れる扇も射抜く弓の名手。遠くの的ほど燃える', line: '遠い的ほど燃えます。祈って、放つ。それだけです。' },
  { id: 4053, stats: s(30, 66, 34, 28, 24, 48), kind: 'sureShort', blurb: '息子の頭のリンゴを射抜いた正確さ。近くの的は外さない', line: 'リンゴより大きな的なら、外しませんよ。' },
  { id: 2001, stats: s(52, 28, 66, 16, 20, 44), kind: 'flyLong', blurb: '空を飛んだ兄弟。高く遠いボールほどよく捕る', line: '高いボールなら任せて！ 空はぼくら兄弟の庭さ。' },
  { id: 3013, stats: s(46, 22, 68, 26, 34, 40), kind: 'steal', blurb: '天下の大泥棒。相手のパスまで盗んでしまう', line: '絶景かな！ 相手のパスも、ちょうだいつかまつる。' },
  { id: 3018, stats: s(16, 18, 22, 72, 50, 34), kind: 'wall', blurb: '立ったまま一歩も引かない僧兵。壁として最強', line: 'ここは通さぬ。立ったままでも、止めてみせよう。' },
  { id: 2019, stats: s(30, 14, 20, 68, 44, 22), kind: 'pushRun', blurb: '熊と相撲をとって育った怪力。押し合いなら負けない', line: '押しくらべなら、クマにだって負けないぞ！' },
  { id: 4001, stats: s(30, 16, 18, 48, 72, 20), kind: 'roar', blurb: '一喝で大軍を止めた豪傑。相手をまとめてなぎ倒す', line: 'オレの一喝で、まとめて吹き飛ばしてやる！' },
  { id: 1008, stats: s(42, 18, 24, 40, 66, 26), kind: 'rush', blurb: '素手で戦った拳闘王。まっすぐ突っこんで捕まえる', line: 'グローブなんていらねえ。まっすぐ行って、つかまえる。' },
  { id: 5015, stats: s(24, 46, 36, 14, 16, 74), kind: 'peekDef', blurb: '天才軍師。相手の攻めを見抜いてから守りを決める', line: '相手の策は、すでに読めております。' },
  { id: 2011, stats: s(30, 40, 34, 20, 22, 68), kind: 'peekOff', blurb: '兵法の祖。相手の守りを見抜いてから攻めを決める', line: '敵を知り、己を知る。勝ちは戦う前に決まるのです。' },
];

export const recruit = (id: number): Recruit => {
  const r = RECRUITS.find((x) => x.id === id);
  if (!r) throw new Error(`hero ${id} is not a recruit`);
  return r;
};

/** The one thing a hero is best at, and the one thing they are worst at. */
export function talentOf(stats: Stats): { best: Stat; worst: Stat } {
  let best: Stat = 'spd';
  let worst: Stat = 'spd';
  for (const k of STATS) {
    if (stats[k] > stats[best]) best = k;
    if (stats[k] < stats[worst]) worst = k;
  }
  return { best, worst };
}

export function specialOf(id: number, kind: Kind, boost = false): SpecialCard {
  return { key: String(id), owner: id, kind, name: hero(id).passive, boost };
}

export const specialSide = (kind: Kind): 'off' | 'def' => KIND[kind].side;
