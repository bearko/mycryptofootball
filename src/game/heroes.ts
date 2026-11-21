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

/** Four heroes for each of the six abilities: the first twelve were there from the start, the rest came with the bigger clubs. */
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
  { id: 3010, stats: s(68, 24, 40, 24, 40, 42), kind: 'trick', blurb: '山も谷も越える忍びの頭。道なき道を抜けていく', line: '道がなければ、つくればよい。拙者についてまいれ。' },
  { id: 5013, stats: s(70, 28, 36, 30, 38, 34), kind: 'powerRun', blurb: '草原を駆けぬけた蒼き狼。走りだしたら地の果てまで', line: '地の果てまで走る。追いつけるものなら、追ってこい。' },
  { id: 4006, stats: s(40, 68, 32, 18, 22, 40), kind: 'sureShort', blurb: '早撃ちの名手。近い的なら、まばたきの間に射抜く', line: '抜くのも撃つのも、オレがいちばん速いぜ。' },
  { id: 3026, stats: s(44, 66, 38, 16, 24, 42), kind: 'sureLong', blurb: '森の弓の名人。遠くの的の真ん中を射抜く', line: '森のはしからでも、的の真ん中に当ててみせるよ。' },
  { id: 4004, stats: s(48, 24, 68, 20, 38, 38), kind: 'steal', blurb: '飛ぶ燕も斬る剣士。空中のボールは見のがさない', line: '飛ぶ燕を斬るのだ。飛ぶボールなど、たやすい。' },
  { id: 2026, stats: s(50, 26, 66, 14, 22, 46), kind: 'flyLong', blurb: '身軽さで天下まで登りつめた男。高いボールにも手が届く', line: '高いところは得意じゃ！ 天下もボールも、つかんでみせよう。' },
  { id: 4055, stats: s(22, 16, 20, 70, 52, 36), kind: 'wall', blurb: '生涯かすり傷ひとつ負わなかった猛将。その前はだれも通れない', line: 'それがしの前を通れた者は、まだ一人もおらぬ。' },
  { id: 4039, stats: s(26, 18, 22, 68, 46, 34), kind: 'pushRun', blurb: '山のように大きな男。押せば道がひらける', line: 'おいどんが押す。みんなは、あとから走ればよか。' },
  { id: 4016, stats: s(36, 14, 18, 46, 72, 18), kind: 'roar', blurb: '天下無双の武人。立ちふさがる者をまとめて吹き飛ばす', line: '相手になるやつは、どこだ。まとめてかかってこい！' },
  { id: 5032, stats: s(44, 16, 26, 38, 68, 30), kind: 'rush', blurb: '二刀の剣豪。一直線に踏みこんで、かならずしとめる', line: '間合いに入れば、もう逃がさぬ。' },
  { id: 4050, stats: s(26, 44, 34, 16, 18, 72), kind: 'peekDef', blurb: '待って勝つ軍師。相手の攻めを見てから手を打つ', line: '急ぐことはありません。相手が動いてからで、間に合います。' },
  { id: 5002, stats: s(32, 42, 32, 20, 20, 70), kind: 'peekOff', blurb: '戦場を見わたす将軍。守りのうすい所を見つけて突く', line: '守りのうすい所は、かならずある。そこを突くのだ。' },
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
