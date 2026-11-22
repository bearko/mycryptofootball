// Play cards: the four offensive plays, the five defensive calls, how they match up,
// and the kinds of special plays a hero can bring.

import type { Role } from './model';
import type { Tactic } from './tactics';

export type OffType = 'inside' | 'outside' | 'short' | 'long';
export type DefType = 'stuff' | 'contain' | 'zone' | 'deep' | 'blitz';
export const OFF_TYPES: readonly OffType[] = ['inside', 'outside', 'short', 'long'];
export const DEF_TYPES: readonly DefType[] = ['stuff', 'contain', 'zone', 'deep', 'blitz'];

export const isRun = (t: OffType): boolean => t === 'inside' || t === 'outside';

/** Kicks: cards a team only has when somebody is its kicker. 'pat' is the kick after a touchdown. */
export type KickType = 'fg' | 'punt' | 'pat' | 'kickoff' | 'onside';
export const KICK_TYPES: readonly KickType[] = ['fg', 'punt', 'pat', 'kickoff', 'onside'];
export const isKick = (t: string): t is KickType => (KICK_TYPES as readonly string[]).includes(t);
/** the kicks that put the ball in play (after a score, and when a half begins) */
export const isKickoff = (t: string): t is 'kickoff' | 'onside' => t === 'kickoff' || t === 'onside';
export const KICK_INFO: Record<KickType, { name: string; text: string }> = {
  fg: { name: 'フィールドゴール', text: 'ゴールの間に蹴りこんで3点。外すと、その場所から相手の攻撃' },
  punt: { name: 'パント', text: '遠くへ蹴って、相手の攻撃を遠い場所から始めさせる' },
  pat: { name: 'キック', text: 'ゴールの間に蹴りこめば1点。プレーで押しこむより確実' },
  kickoff: { name: 'キックオフ', text: '遠くへ蹴って、相手に自陣の深い所から攻めさせる' },
  onside: { name: 'オンサイドキック', text: '短く蹴って、自分たちでボールを取り返しにいく。失敗すると相手はゴールの近くから' },
};

export interface CardInfo {
  name: string;
  /** one line: what happens */
  text: string;
  /** the call it beats most clearly / the call that shuts it down */
  good: string;
  bad: string;
}

export const OFF_INFO: Record<OffType, CardInfo> = {
  inside: { name: '中央ラン', text: 'まん中を走る。大きくは進まないが堅実。突撃にもやや弱い', good: 'ロング警戒', bad: '中央固め' },
  outside: { name: '外ラン', text: '外側を回って走る。抜ければ大きい', good: '突撃', bad: '外張り' },
  short: { name: 'ショートパス', text: '短いパス。確実に数ヤード', good: '突撃', bad: 'ショート警戒' },
  long: { name: 'ロングパス', text: '一気に大きく進む。失敗も多く、突撃にも弱い', good: '中央固め', bad: 'ロング警戒' },
};

export const DEF_INFO: Record<DefType, CardInfo> = {
  stuff: { name: '中央固め', text: 'まん中に人を集める', good: '中央ラン', bad: 'ロングパス' },
  contain: { name: '外張り', text: '外側を見張る', good: '外ラン', bad: 'ロングパス' },
  zone: { name: 'ショート警戒', text: '短いパスの通り道をふさぐ', good: 'ショートパス', bad: '中央ラン' },
  deep: { name: 'ロング警戒', text: '後ろを厚く守る', good: 'ロングパス', bad: 'ラン全部' },
  blitz: { name: '突撃', text: '全員で投げる人に襲いかかる賭け。中央ランも止めるが、ショートパスにも弱い', good: 'ロングパス', bad: '外ラン' },
};

/**
 * How a play does against a call, before anyone's ability counts.
 * Positive favors the offense. Each play has one call that shuts it down.
 */
export const MATCH: Record<OffType, Record<DefType, number>> = {
  inside: { stuff: -1.5, contain: 0.4, zone: 0.9, deep: 1.0, blitz: -0.6 },
  outside: { stuff: 0.6, contain: -1.5, zone: 0.2, deep: 0.8, blitz: 1.0 },
  short: { stuff: 0.8, contain: 0.3, zone: -1.4, deep: 0.6, blitz: 0.9 },
  long: { stuff: 1.0, contain: 0.9, zone: 0.3, deep: -1.8, blitz: -1.2 },
};

// ------------------------------------------------------------------ special plays

export type OffKind = 'powerRun' | 'trick' | 'sureLong' | 'sureShort' | 'flyLong' | 'pushRun' | 'peekOff'
  // a team's colour (game/tactics.ts): its own plays, eleven a side
  | 'reverse' | 'flea' | 'fakePunt' | 'drive' | 'shotgun';
export type DefKind = 'steal' | 'wall' | 'roar' | 'rush' | 'peekDef' | 'manMark' | 'allBlitz';
export type Kind = OffKind | DefKind;

export interface KindInfo {
  side: 'off' | 'def';
  /** momentum spent */
  cost: number;
  /** the play it is run as (for the picture on the field and for the match-up) */
  base: OffType | DefType;
  /** where the hero has to line up for the play to be available (null: anywhere on that unit) */
  roles: Role[] | null;
  /** short label of the effect */
  tag: string;
  text: string;
  /** only on the last of the four downs (it is run instead of the punt) */
  fourth?: boolean;
}

export const KIND: Record<Kind, KindInfo> = {
  powerRun: {
    side: 'off', cost: 2, base: 'outside', roles: ['RB', 'WR'], tag: '外ラン強化',
    text: '外ランが大幅に強くなり、止められても数ヤードは前に倒れこむ',
  },
  trick: {
    side: 'off', cost: 2, base: 'outside', roles: ['RB', 'WR'], tag: '読み無効',
    text: '相手の守備カードの読みを無効にして走る。読まれていても関係ない',
  },
  sureLong: {
    side: 'off', cost: 3, base: 'long', roles: ['QB'], tag: '必中ロング',
    text: 'ロングパスがほぼ通る。奪われることもない',
  },
  sureShort: {
    side: 'off', cost: 1, base: 'short', roles: ['QB'], tag: '必中ショート',
    text: '外さないショートパス。奪われない。あと少しを確実に取りたいときに',
  },
  flyLong: {
    side: 'off', cost: 2, base: 'long', roles: ['WR', 'TE'], tag: '飛距離アップ',
    text: 'このヒーローへのロングパス。通りやすく、捕れば普段よりさらに進む',
  },
  pushRun: {
    side: 'off', cost: 1, base: 'inside', roles: ['OL', 'TE', 'RB'], tag: '押しこみ',
    text: '中央ランで必ず数ヤード押しこむ。あと少しのときの切り札',
  },
  peekOff: {
    side: 'off', cost: 1, base: 'inside', roles: null, tag: '守備を見る',
    text: '相手の守備カードを見てから、好きな作戦を選べる',
  },
  steal: {
    side: 'def', cost: 3, base: 'zone', roles: ['CB', 'S'], tag: 'ボール強奪',
    text: '相手がパスなら高い確率で奪い取る。ランでもボールをこぼさせることがある',
  },
  wall: {
    side: 'def', cost: 2, base: 'stuff', roles: ['DL', 'LB'], tag: '通さない',
    text: 'ランと短いパスをほとんど進ませない。ゴール前や「あと少し」で使いたい',
  },
  roar: {
    side: 'def', cost: 2, base: 'stuff', roles: ['DL', 'LB'], tag: '全作戦に強い',
    text: '相手がどの作戦でも大きく弱らせる。押し戻せば相手の流れも奪う',
  },
  rush: {
    side: 'def', cost: 1, base: 'blitz', roles: ['DL', 'LB'], tag: '突撃強化',
    text: '強化した突撃。パスや中央ランをつぶす。外ランには弱いまま',
  },
  peekDef: {
    side: 'def', cost: 2, base: 'zone', roles: null, tag: '攻撃を見る',
    text: '相手の作戦カードを見てから、好きな守備を選べる',
  },
  // ---- a team's colour: its own plays (eleven a side). Their owner is whoever lines up for them
  reverse: {
    side: 'off', cost: 2, base: 'outside', roles: ['RB', 'WR'], tag: '逆を突く',
    text: '外へ走ると見せて逆へ持ちかえる。読みに強く、抜ければ独走しやすい',
  },
  flea: {
    side: 'off', cost: 2, base: 'long', roles: ['QB'], tag: 'ランに見せる',
    text: 'ランと見せて戻したボールを奥へ投げる。ランを警戒した守備ほど大きく通る',
  },
  fakePunt: {
    side: 'off', cost: 1, base: 'short', roles: null, tag: '奇襲', fourth: true,
    text: '4回目、パントの形からパスを投げる。不意を突けばまず届く',
  },
  drive: {
    side: 'off', cost: 1, base: 'inside', roles: ['RB', 'OL', 'TE'], tag: '全員で押す',
    text: '全員でまん中を押しこむラン。必ず数ヤード進み、ゴール前で強い',
  },
  shotgun: {
    side: 'off', cost: 1, base: 'short', roles: ['QB'], tag: '全員が受ける',
    text: '後ろに下がって構え、全員が受けに走るパス。通りやすく、突撃にもつぶされにくい',
  },
  manMark: {
    side: 'def', cost: 2, base: 'zone', roles: ['CB', 'S', 'LB'], tag: 'エースを消す',
    text: '相手のエースにひとりが張りつく。エースに渡ればほとんど進ませない',
  },
  allBlitz: {
    side: 'def', cost: 2, base: 'blitz', roles: ['DL', 'LB'], tag: '全員で襲う',
    text: '全員で投げる人と走る人に襲いかかる大勝負。外へ逃げられると大きくやられる',
  },
};

/** The match-up a defensive special gives instead of a basic call. */
export const DEF_SPECIAL_MATCH: Record<Exclude<DefKind, 'peekDef'>, Record<OffType, number>> = {
  steal: { inside: 0.4, outside: 0.2, short: -1.0, long: -1.4 },
  wall: { inside: -1.5, outside: -1.2, short: -0.6, long: 0.6 },
  roar: { inside: -0.4, outside: -0.4, short: -0.4, long: -0.4 },
  rush: { ...{ inside: MATCH.inside.blitz, outside: MATCH.outside.blitz, short: MATCH.short.blitz, long: MATCH.long.blitz } },
  manMark: { inside: 0.4, outside: 0.2, short: -0.5, long: -0.5 },
  allBlitz: { inside: -1.4, outside: 1.4, short: 0.5, long: -2.0 },
};

/** How much of a special's effect is left once the opponent has seen it n times. */
export const READ_POTENCY = [1, 0.7, 0.45, 0.25] as const;
export const READ_MAX = READ_POTENCY.length - 1;
export const READ_LABEL = ['初見', '見られた', '読まれている', '完全に読まれた'] as const;

/** A special play a team can call. */
export interface SpecialCard {
  /** unique within a team */
  key: string;
  /** hero who owns it */
  owner: number;
  kind: Kind;
  name: string;
  /** stronger once the hero trusts the coach deeply */
  boost: boolean;
  /** a play of the team's colour (eleven a side), and how far the team has come with it (game/tactics.ts) */
  tactic?: Tactic;
  lv?: number;
}
