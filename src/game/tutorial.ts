// The first week of a new club, as its manager tells it: what she says, when, and what the coach is asked to do next.
// Words only: the screen that shows them is ui/tutor.ts, and each screen decides when a lesson is due.
//
// A lesson is a few short pages (one thought each, at most two sentences and TALK_MAX letters), then something for
// the coach to do; the next lesson waits for that. Words inside [[ ]] are shown highlighted.
// A scene can be skipped: the coach then gets its gist instead, a handful of lines of about GIST_MAX letters.

import type { Season } from './season';

export type Scene = 'recruit' | 'club' | 'lineup' | 'match' | 'after' | 'eleven';
export const SCENES: readonly Scene[] = ['recruit', 'club', 'lineup', 'match', 'after', 'eleven'];
export const SCENE_NAME: Record<Scene, string> = {
  recruit: '入部説明会', club: '練習グラウンド', lineup: '編成', match: 'はじめての試合', after: '試合のあと', eleven: '11人制になったら',
};
/**
 * The scenes of the first week (given once, to a club founded from the title). The others are news: what changes
 * later on (the first match eleven a side), told once to any club when the time comes (Season.told).
 */
export const FIRST_WEEK: readonly Scene[] = ['recruit', 'club', 'lineup', 'match', 'after'];

export const TALK_MAX = 60;
export const GIST_MAX = 28;

/** what the words may depend on: a finger or a mouse, and how the first match went */
export interface TalkCtx { touch: boolean; win: boolean }
type Words = string | ((c: TalkCtx) => string);

export interface Page {
  text: Words;
  /** the manager's pose (ui/kit.ts) */
  pose?: string;
  /** what she is talking about: a CSS selector of something on the screen, which gets a ring around it */
  look?: string;
  /** she speaks from the top of the screen (what she talks about is at the bottom) */
  top?: boolean;
}

export interface Lesson {
  id: string;
  scene: Scene;
  pages: Page[];
  /** what the coach does next (shown small, beside `look`, until it is done) */
  goal?: Words;
  look?: string;
}

/** the mark that ends the lessons for good (everything said, or the coach wanted no more) */
export const END = 'end';

export const LESSONS: readonly Lesson[] = [
  // ---------------------------------------------------------------- the briefing
  {
    id: 'r1', scene: 'recruit',
    pages: [
      { text: '監督、はじめまして！ マネージャーの[[マイン]]です。', pose: 'wave' },
      { text: 'このアメフト部は、できたばかりの[[創部1年目]]。部員はまだ、ひとりもいません。', pose: 'think' },
      {
        text: (c) => (c.touch ? 'まずは[[主将]]をえらびましょう。気になる子をタップして、もう一度タップすると入部です。' : 'まずは[[主将]]をえらびましょう。気になる子にかざして、クリックすると入部です。'),
        pose: 'point', look: '.rc-stage',
      },
    ],
    goal: '主将を1人えらぶ', look: '.rc-stage',
  },
  {
    id: 'r2', scene: 'recruit',
    pages: [
      { text: '主将が決まりましたね！ ヒーローはみんな、何かひとつが得意な[[一芸もち]]です。', pose: 'cheer' },
      { text: 'あと6人えらびましょう。上の[[ランプ]]がぜんぶ光ると、バランスのいいチームです。', pose: 'point', look: '.rc-lamps' },
    ],
    goal: 'あと6人えらぶ（おまかせでもOK）', look: '.recruit .foot .row .btn:last-child',
  },
  {
    id: 'r3', scene: 'recruit',
    pages: [
      { text: '7人そろいました！ 11人には足りないので、まずは[[6人制]]の試合に出ます。', pose: 'smile' },
      { text: '[[大会を勝ち抜く]]と部の名が上がって、入部する子も増えていきますよ。', pose: 'sparkle' },
    ],
    goal: '「この7人ではじめる」を押す', look: '.recruit .foot .row .btn:last-child',
  },
  // ---------------------------------------------------------------- the practice ground
  {
    id: 'c1', scene: 'club',
    pages: [
      { text: 'ここが練習グラウンドです。目標は全国大会の優勝、[[マイクリボウル]]！', pose: 'cheer' },
      { text: 'そのために部を強くしていきましょう。まずは[[ミーティング]]で、練習の方針を決めます。', pose: 'point' },
    ],
  },
  {
    id: 'c2', scene: 'club',
    pages: [
      { text: 'ヒーローごとに、練習で[[のばす能力]]をひとつ決めます。「おすすめ」はその子の得意です。', pose: 'point', top: true },
      { text: '迷ったら、そのまま[[この方針でいく]]を押して大丈夫ですよ。', pose: 'smile', top: true, look: '.pol-foot .btn.go' },
    ],
    goal: '方針を決めて「この方針でいく」', look: '.pol-foot .btn.go',
  },
  {
    id: 'c3', scene: 'club',
    pages: [
      {
        text: (c) => (c.touch ? '下のカードが今日の[[練習]]です。タップすると、だれが何をのばせるか予測が出ます。' : '下のカードが今日の[[練習]]です。かざすと、だれが何をのばせるか予測が出ます。'),
        pose: 'point', top: true, look: '.pg-cards',
      },
      {
        text: (c) => (c.touch ? '同じカードをもう一度タップすると練習開始。[[1枚で1日]]進みます。' : 'クリックすると練習開始。[[1枚で1日]]進みます。'),
        pose: 'smile', top: true, look: '.pg-cards',
      },
    ],
    goal: '練習カードを1枚えらぶ', look: '.pg-cards',
  },
  {
    id: 'c4', scene: 'club',
    pages: [
      { text: 'おつかれさまでした！ 練習すると[[能力]]と[[信頼]]が上がって、[[体力]]が減ります。', pose: 'smile', top: true },
      { text: '日曜は[[練習試合]]です。それまで、好きなカードで鍛えていきましょう。', pose: 'point', top: true },
    ],
  },
  {
    id: 'c5', scene: 'club',
    pages: [
      { text: '信頼がたまると、ヒーローは試合で使える[[特別作戦]]を覚えます。主将はもう使えますよ。', pose: 'sparkle', top: true },
      { text: '体力が半分を切るとバテてしまいます。そんなときは[[休養]]のカードもどうぞ。', pose: 'think', top: true },
    ],
  },
  {
    id: 'c6', scene: 'club',
    pages: [
      { text: '今日は、はじめての[[練習試合]]です！ 上の[[編成]]で、だれがどこを守るか見られます。', pose: 'cheer', look: '.pg-menu .btn' },
      { text: '準備ができたら[[試合へ]]を押してください、監督！', pose: 'point', top: true, look: '.vs-go .btn' },
    ],
    goal: '「試合へ」を押す', look: '.vs-go .btn',
  },
  // ---------------------------------------------------------------- the line-up
  {
    id: 'l1', scene: 'lineup',
    pages: [
      { text: '攻撃の組と守備の組を、べつべつに決められます。得意に合う場所ほど力を出せます。', pose: 'point' },
      { text: '迷ったら[[おまかせ]]で、いちばん強い並びになりますよ。', pose: 'smile' },
    ],
  },
  // ---------------------------------------------------------------- the first match (a told story: match.ts createStory)
  {
    id: 'm1', scene: 'match',
    pages: [
      { text: '練習試合は第3クォーターの終わりまで[[0対0]]です。でも、指示を出す人がいなくて…。', pose: 'think' },
      { text: 'みんなバラバラです。あっ、相手が[[キック]]で点を取りにきます！', pose: 'cry' },
    ],
  },
  {
    id: 'm2', scene: 'match',
    pages: [
      { text: '決められました…。キックをゴールの間に蹴りこむと[[3点]]です。', pose: 'cry' },
      { text: 'のこりは第4クォーターだけ。監督、ここから[[指示]]をお願いします！', pose: 'point' },
    ],
  },
  {
    id: 'm3', scene: 'match',
    pages: [
      { text: 'アメフトは、ボールを[[前へ]]、相手の陣地のおくへ運ぶスポーツです。', pose: 'point', top: true },
      { text: 'まずは[[ラン]]、ボールを持って走る作戦です。少しずつですが、手がたく進めます。', pose: 'smile', top: true, look: '.hand-cards .card:not(.blocked)' },
    ],
    goal: (c) => (c.touch ? '「中央ラン」をタップ、もう一度タップ' : '「中央ラン」をクリック'), look: '.hand-cards .card:not(.blocked)',
  },
  {
    id: 'm4', scene: 'match',
    pages: [
      { text: '7ヤード進みました！ 次は[[パス]]、ボールを投げて一気に進む作戦です。', pose: 'cheer', top: true },
      { text: 'そのかわり、取れなかったり、うばわれたりもします。[[ショートパス]]をどうぞ！', pose: 'point', top: true, look: '.hand-cards .card:not(.blocked)' },
    ],
    goal: (c) => (c.touch ? '「ショートパス」をタップ、もう一度タップ' : '「ショートパス」をクリック'), look: '.hand-cards .card:not(.blocked)',
  },
  {
    id: 'm5', scene: 'match',
    pages: [
      { text: '[[4回の攻撃で10ヤード]]進むと、また4回攻められます。いまのがそれです！', pose: 'sparkle', top: true },
      { text: '相手のゴールまで運べば[[タッチダウン、6点]]で逆転です。あとは監督におまかせします！', pose: 'cheer', top: true },
    ],
    goal: '好きなカードで、相手のゴールまで運ぶ', look: '.hand-cards',
  },
  // ---------------------------------------------------------------- back on the ground
  {
    id: 'a1', scene: 'after',
    pages: [
      {
        text: (c) => (c.win ? 'はじめての勝利です、監督！ 勝つと、部の[[格]]のゲージがたまっていきます。' : 'おつかれさまでした、監督。練習試合なので、負けても[[大会]]には出られます。'),
        pose: 'cheer', top: true, look: '.pg-school',
      },
      { text: '来週からは[[地区大会]]。1回戦に勝てば[[同好会]]に上がって、部員が増えますよ。', pose: 'point', top: true },
      { text: 'めざすはマイクリボウル！ 説明は[[設定]]から、いつでも見直せます。', pose: 'sparkle', top: true },
    ],
  },
  // ---------------------------------------------------------------- eleven a side (news: Season.told)
  {
    id: 'e1', scene: 'eleven',
    pages: [
      { text: '監督、部の格が上がって、ここからは[[11人制]]の試合です！', pose: 'cheer' },
      { text: '攻撃も守備も11人ずつ。人数が足りないうちは、攻撃と守備を[[かけもち]]します。', pose: 'point' },
      { text: 'チームの[[色]]（戦術の型）も決まりました。勝つほど、戦術練習をするほど[[練度]]が上がります。', pose: 'smile' },
    ],
  },
  {
    id: 'e4', scene: 'eleven',
    pages: [
      { text: '作戦カードは[[ブラスト]]や[[ブリッツ]]のような本格的なプレーになり、練度が上がると増えます。', pose: 'sparkle' },
      { text: 'まずは上の[[編成]]で、11人の並びを見てみましょう！', pose: 'point', look: '.pg-menu .btn' },
    ],
    goal: '「編成」を押す', look: '.pg-menu .btn',
  },
  {
    id: 'e2', scene: 'eleven',
    pages: [
      { text: 'これが[[11人]]の並びです。[[TE]]・[[CB]]・[[S]]などの場所が増えました。', pose: 'point' },
      { text: '[[エース]]を決めると、試合で相手のエースと[[対決]]します。迷ったら[[おまかせ]]で大丈夫です。', pose: 'smile', look: '.lu-aces' },
    ],
  },
  {
    id: 'e3', scene: 'eleven',
    pages: [
      { text: '11人制の作戦カードは[[プレーの名前]]です。下の小さな字が、何の作戦かを表します。', pose: 'point', top: true, look: '.hand-cards' },
      { text: '練度2で[[ドロー]]や[[スクリーンパス]]、練度3で[[プレイアクション]]と、プレーが増えていきます。', pose: 'sparkle', top: true },
      { text: '練度3からは、手札も[[1枚]]増えます。相手の守りを読んで、いろいろ試してみましょう！', pose: 'cheer', top: true },
    ],
  },
];

/** A picture beside a line of a gist: a button as it looks in the game, a play card, a small mark. */
export type GistPic = { btn: string; cls?: string } | { card: 'inside' | 'short' } | { mark: string };
export interface Gist { text: string; pic?: GistPic }

/** What a skipped scene wanted to say, in a few lines. */
export const GISTS: Record<Scene, Gist[]> = {
  recruit: [
    { text: 'えらんで、もう一度押すと入部', pic: { btn: '入部させる' } },
    { text: 'さいしょの1人が主将になる', pic: { mark: '★主将' } },
    { text: '創部1年目。部員が足りず試合は6人制', pic: { mark: '6人制' } },
    { text: '大会を勝ち抜くと部員が増える', pic: { mark: '部員＋' } },
  ],
  club: [
    { text: '目標は全国大会の優勝「マイクリボウル」', pic: { mark: '優勝' } },
    { text: 'カードにかざす（タップ）と予測が出る', pic: { mark: '予測' } },
    { text: 'もう一度押すと練習。1枚で1日進む', pic: { mark: '1日' } },
    { text: '練習で能力と信頼が上がり、体力が減る', pic: { mark: '♥' } },
    { text: '日曜は試合。「試合へ」で始まる', pic: { btn: '試合へ', cls: 'go' } },
  ],
  lineup: [
    { text: '攻撃の組と守備の組は、べつべつに組める', pic: { mark: '攻/守' } },
    { text: '迷ったら「おまかせ」で最強の並びに', pic: { btn: 'おまかせ' } },
  ],
  match: [
    { text: 'ボールを前（相手の陣地）へ運ぶスポーツ', pic: { mark: '▶▶▶' } },
    { text: 'ラン：持って走る。手がたく少しずつ', pic: { card: 'inside' } },
    { text: 'パス：投げる。大きく進むが失敗もある', pic: { card: 'short' } },
    { text: 'キックが決まると3点', pic: { mark: '3点' } },
    { text: '相手のゴールまで運ぶとタッチダウン、6点', pic: { mark: '6点' } },
  ],
  eleven: [
    { text: '弱小から試合は11人制。足りないうちは攻守かけもち', pic: { mark: '11人' } },
    { text: 'チームの色の練度は、勝利と戦術練習で上がる', pic: { mark: '練度' } },
    { text: '作戦カードは本格的なプレー。練度で増える', pic: { mark: 'Lv' } },
    { text: '練度3から手札が1枚増える', pic: { mark: '＋1' } },
    { text: 'エースを決めると、相手のエースと対決', pic: { mark: '対決' } },
  ],
  after: [
    { text: '試合に勝つと、部の格のゲージがたまる', pic: { mark: '格' } },
    { text: '1回戦に勝てば同好会。部員が増える', pic: { mark: '部員＋' } },
    { text: '説明は「設定」からいつでも見直せる', pic: { btn: '設定', cls: 'alt' } },
  ],
};

export const lessonOf = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
export const words = (w: Words, c: TalkCtx): string => (typeof w === 'function' ? w(c) : w);
/** the text without its highlight marks */
export const plain = (text: string): string => text.replace(/\[\[|\]\]/g, '');

/** Is the manager still teaching this club? (Only a club founded from the title, in its first year, until the last lesson.) */
export const tutorOn = (s: Season | null | undefined): boolean => !!s && !!s.tut && s.year === 1 && !s.tut.includes(END);
/** Is this lesson still to come? (A first-week lesson while the teaching lasts; news until it has been told.) */
export function lessonDue(s: Season | null | undefined, id: string): boolean {
  const l = lessonOf(id);
  if (!s || !l) return false;
  if (!FIRST_WEEK.includes(l.scene)) return !(s.told ?? []).includes(id);
  return tutorOn(s) && !s.tut!.includes(id);
}
/** A piece of news has been told. */
export function tell(s: Season, id: string): void {
  if (!(s.told ??= []).includes(id)) s.told.push(id);
}

/** the last lesson of the first week (it ends the teaching) */
const LAST_FIRST_WEEK = 'a1';

/** The lesson has been given (the last one ends the teaching). */
export function markLesson(s: Season, id: string): void {
  const l = lessonOf(id);
  if (l && !FIRST_WEEK.includes(l.scene)) {
    tell(s, id);
    return;
  }
  if (!s.tut || s.tut.includes(id)) return;
  s.tut.push(id);
  if (id === LAST_FIRST_WEEK) endLessons(s);
}
/** The coach skipped a scene: none of its lessons will be given (skipping the last scene ends the teaching). */
export function skipScene(s: Season, scene: Scene): void {
  if (!FIRST_WEEK.includes(scene)) {
    for (const l of LESSONS) if (l.scene === scene) tell(s, l.id);
    return;
  }
  if (!s.tut) return;
  for (const l of LESSONS) if (l.scene === scene && !s.tut.includes(l.id)) s.tut.push(l.id);
  if (scene === FIRST_WEEK[FIRST_WEEK.length - 1]) endLessons(s);
}
/** No more lessons, whatever is left. */
export function endLessons(s: Season): void {
  if (s.tut && !s.tut.includes(END)) s.tut.push(END);
}
/** Have the lessons ended (said to the end, or waved away)? False for a club that never had any. */
export const lessonsOver = (s: Season | null | undefined): boolean => !!s?.tut?.includes(END);
