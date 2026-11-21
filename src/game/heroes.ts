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

/**
 * Everybody who may join the club. The first twenty-four (four for each of the six abilities, every special play twice)
 * are the ones who come to the briefing of a new club; the others turn up in later springs, as the years go by
 * and the first heroes graduate.
 */
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
  // ---- the later generations
  { id: 1004, stats: s(67, 24, 42, 22, 34, 44), kind: 'trick', blurb: '動物を追いつづけた博物学者。けもの道をよく知っている', line: '足あとを見れば、どこが空いているか分かるんだ。' },
  { id: 2030, stats: s(69, 26, 44, 16, 30, 40), kind: 'trick', blurb: '舞で都を驚かせた踊り手。ひらりとかわして走る', line: 'さあさあ、ごらんあれ。ひらりとかわしてみせましょう。' },
  { id: 3006, stats: s(70, 22, 40, 26, 38, 30), kind: 'powerRun', blurb: '森のモンスター。はねるように外を駆けぬける', line: 'ピョーン！（走るのが大好き、と言っている）' },
  { id: 3022, stats: s(71, 28, 40, 20, 32, 38), kind: 'powerRun', blurb: '森と川を駆けた少女。風のように外を走る', line: '風といっしょに走るの。だれにも追いつけないわ。' },
  { id: 4015, stats: s(66, 30, 46, 14, 28, 42), kind: 'trick', blurb: '皇帝を夢中にさせた美女。見とれている間に走りぬける', line: '見とれているうちに、通りすぎてしまいますわよ。' },
  { id: 2018, stats: s(34, 67, 34, 20, 26, 42), kind: 'sureShort', blurb: '戦国の姫。ねらった所へ、きっちり届ける', line: 'ねらいは外しませぬ。しっかり受けとりなさい。' },
  { id: 3020, stats: s(40, 68, 36, 14, 20, 44), kind: 'sureShort', blurb: '国を動かした舞姫。思いどおりの所へボールを届ける', line: 'ねらった相手は、けっして外しませんわ。' },
  { id: 3021, stats: s(32, 69, 30, 24, 22, 44), kind: 'sureLong', blurb: '想いを届けた聖人。遠くの仲間にも、まっすぐ届ける', line: '想いは、遠くまで届くものです。ボールも同じですよ。' },
  { id: 3028, stats: s(36, 70, 32, 18, 18, 46), kind: 'sureLong', blurb: '光を追いかけた画家。遠くの景色までよく見えている', line: '遠くまで、よく見えるよ。あそこに投げよう。' },
  { id: 3041, stats: s(38, 66, 38, 18, 20, 46), kind: 'sureShort', blurb: 'やさしい絵の名手。受けやすいボールを投げる', line: '受けやすいボールを投げるよ。安心して走って。' },
  { id: 2016, stats: s(50, 24, 67, 16, 24, 42), kind: 'flyLong', blurb: '皇帝の末娘。高く上がったボールにも、しなやかに手が届く', line: 'どんなに高くても、あきらめません。' },
  { id: 2024, stats: s(46, 22, 66, 20, 32, 40), kind: 'steal', blurb: '踊りで王をとりこにした姫。ほしいものは必ず手に入れる', line: 'ほしいものは、いただくわ。そのボールもね。' },
  { id: 2032, stats: s(52, 26, 68, 14, 22, 44), kind: 'flyLong', blurb: '想像の翼をもつ作家。遠くへ飛んだボールを追いかける', line: '想像してみて。あのボールを、わたしが捕るところを！' },
  { id: 3004, stats: s(48, 24, 69, 16, 30, 40), kind: 'steal', blurb: '伝説の踊り子。相手のふところから、するりと奪う', line: '秘密もボールも、気づいたときには私の手の中よ。' },
  { id: 3035, stats: s(44, 28, 70, 14, 20, 46), kind: 'flyLong', blurb: '歌の名人。舞いおちるボールを、そっと受けとめる', line: '花が散るように落ちてくるボール。そっと受けとめましょう。' },
  { id: 2007, stats: s(22, 16, 22, 69, 44, 34), kind: 'pushRun', blurb: '大きな袋をかつぐ力もち。雪の夜でも止まらない', line: 'ほっほっほ。重い荷物なら、毎年はこんでおるよ。' },
  { id: 3005, stats: s(20, 14, 20, 71, 50, 28), kind: 'wall', blurb: '水のモンスター。大きな体で流れをせき止める', line: 'ザブーン！（ここは通さない、と言っている）' },
  { id: 3024, stats: s(26, 18, 22, 68, 46, 32), kind: 'pushRun', blurb: '大きな絵を描きつづけた画家。どっしり構えて押しこむ', line: '大きく、力づよく。絵もブロックも同じことさ。' },
  { id: 4011, stats: s(22, 18, 18, 70, 48, 36), kind: 'wall', blurb: '分厚い本を書いた思想家。肩を組んだ壁は破れない', line: '団結せよ！ 肩を組めば、この壁は破れない。' },
  { id: 4034, stats: s(24, 20, 20, 67, 44, 40), kind: 'wall', blurb: '正体不明の発明家。くずれない仕組みで仲間を守る', line: 'この壁は、だれにも書きかえられない。' },
  { id: 2028, stats: s(38, 16, 22, 42, 68, 26), kind: 'roar', blurb: '国を守って立ち上がった姉妹。2人がかりで相手を止める', line: '姉妹そろえば、こわいものなし！' },
  { id: 3001, stats: s(42, 14, 20, 40, 70, 22), kind: 'rush', blurb: '炎のモンスター。まっすぐ突っこんで燃やしつくす', line: 'ガオーッ！（まっすぐ行くぞ、と言っている）' },
  { id: 4002, stats: s(34, 18, 26, 44, 66, 34), kind: 'wall', blurb: 'ランプを手に夜も見回った看護師。守ると決めたら通さない', line: 'ここから先へは、一歩も通しません。' },
  { id: 4021, stats: s(44, 16, 24, 36, 69, 24), kind: 'rush', blurb: '燃えるように描いた画家。情熱のままに飛びこむ', line: '燃えているんだ。止まってなんか、いられない！' },
  { id: 4046, stats: s(32, 14, 18, 48, 71, 22), kind: 'roar', blurb: '何をされても倒れなかった怪僧。にらむだけで相手がすくむ', line: 'わしは倒れん。倒れるのは、おまえたちのほうだ。' },
  { id: 1001, stats: s(28, 42, 34, 18, 20, 72), kind: 'peekDef', blurb: '名探偵の生みの親。相手の攻めを推理で見抜く', line: '初歩的なことだよ、監督。相手の次の手は、もう分かっている。' },
  { id: 1007, stats: s(30, 40, 36, 16, 22, 68), kind: 'peekOff', blurb: '宮廷の料理人で医女。相手の様子をよく見ている', line: '顔色を見れば分かります。あそこが、いま弱っています。' },
  { id: 2025, stats: s(26, 44, 32, 18, 18, 70), kind: 'peekDef', blurb: '正体不明の発明家。相手の動きをすべて記録している', line: '記録はうそをつかない。次の一手は、もう読めている。' },
  { id: 2027, stats: s(32, 38, 36, 18, 20, 69), kind: 'peekOff', blurb: 'たとえ話の名人。相手のすきを、ちゃんと見ている', line: 'ウサギが寝ているうちに、カメは進むのです。' },
  { id: 3017, stats: s(24, 44, 34, 20, 18, 73), kind: 'peekDef', blurb: 'はるか西へ旅した僧。相手の心の動きを見通す', line: 'あわてることはありません。相手の心が、よく見えます。' },
  { id: 3030, stats: s(30, 46, 32, 14, 18, 71), kind: 'peekOff', blurb: '人の心を描いた劇作家。相手の次のせりふが分かる', line: '攻めるべきか、待つべきか。答えは相手の顔に書いてある。' },
];
/** how many of them come to the briefing of a new club (the first ones in the list) */
export const FOUNDERS = 24;

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
