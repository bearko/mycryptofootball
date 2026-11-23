// The playbook, eleven a side: the plays are called by their names (ブラスト, スイープ, スクリーンパス, ブリッツ …).
//
// Every play belongs to one of the four families of plays (中央ラン・外ラン・ショートパス・ロングパス) or the five
// families of calls (中央固め・外張り・ショート警戒・ロング警戒・突撃): the match engine runs it as its family (the
// picture on the field, who carries the ball, the match-up of cards.ts MATCH). What makes a play its own is a small
// shift of that match-up (`vs`): a draw is a run that hurts the blitz, a screen a pass that does the same, a
// play-action a long pass that beats the defenses set against the run. The shifts add up to about nothing: a play is
// no better than its family, only good and bad against other calls.
//
// The first play of each family is there from the start; the others come with the team's level with its colour
// (game/tactics.ts, 1–5: a club gets better at them the more it wins and practises). Six a side has no playbook:
// its cards are the families themselves.
// Nothing here uses the match's dice.

import { DEF_INFO, OFF_INFO, MATCH, DEF_TYPES, OFF_TYPES, type DefType, type OffType } from './cards';

export type OffPlay = 'blast' | 'sweep' | 'quick' | 'deep' | 'draw' | 'screen' | 'counter' | 'playAction' | 'option' | 'bootleg' | 'jetSweep';
export type DefPlay = 'box' | 'edge' | 'cover2' | 'cover3' | 'blitz' | 'zoneBlitz' | 'cover1' | 'prevent' | 'bear' | 'aGap' | 'cover4' | 'goalLine';
export type PlayKey = OffPlay | DefPlay;

export interface PlayInfo {
  name: string;
  /** the family it is run as */
  base: OffType | DefType;
  /** the level with the team's colour it comes at (1: from the start) */
  lv: number;
  /** what it does, one line */
  text: string;
  /** how it shifts the family's match-up against the other side's families (positive: better for the offense) */
  vs: Partial<Record<OffType | DefType, number>>;
}

export const OFF_PLAYS: Record<OffPlay, PlayInfo> = {
  blast: { name: 'ブラスト', base: 'inside', lv: 1, text: 'ラインが押し開けたまん中を、まっすぐ突き破る', vs: {} },
  sweep: { name: 'スイープ', base: 'outside', lv: 1, text: 'ブロックを引き連れて外を大きく回る。抜ければ大きい', vs: {} },
  quick: { name: 'クイックパス', base: 'short', lv: 1, text: 'すばやく短いパス。確実に数ヤード', vs: {} },
  deep: { name: 'ディープパス', base: 'long', lv: 1, text: '奥へ走ったレシーバーへ投げこむ。決まれば一気に進む', vs: {} },
  draw: {
    name: 'ドロー', base: 'inside', lv: 2, text: 'パスと見せて手渡すラン。突撃とパスの警戒に強く、中央固めに弱い',
    vs: { stuff: -0.5, contain: -0.3, zone: 0.2, deep: 0.1, blitz: 0.6 },
  },
  screen: {
    name: 'スクリーンパス', base: 'short', lv: 2, text: '突っこんでくる守りの裏へふわりと投げる。突撃に強く、外張りに弱い',
    vs: { stuff: -0.2, contain: -0.5, zone: -0.1, deep: 0.1, blitz: 0.7 },
  },
  counter: {
    name: 'カウンター', base: 'inside', lv: 3, text: '逆へ一歩見せてから切り返すラン。中央固めをかわし、外張りに弱い',
    vs: { stuff: 0.8, contain: -0.4, zone: -0.2, deep: -0.2 },
  },
  playAction: {
    name: 'プレイアクション', base: 'long', lv: 3, text: 'ランのふりで守りを引きつけて、奥へ投げる。ランの守りに強く、突撃に弱い',
    vs: { stuff: 0.4, contain: 0.3, zone: -0.1, deep: -0.2, blitz: -0.4 },
  },
  option: {
    name: 'オプション', base: 'outside', lv: 4, text: 'QB が守りを見て、持って走るか渡すかを決める。外張りに強い',
    vs: { stuff: -0.2, contain: 0.8, zone: -0.2, deep: -0.2, blitz: -0.2 },
  },
  bootleg: {
    name: 'ブートレッグ', base: 'short', lv: 4, text: 'QB が外へ転がり出て投げる。中央固めとショート警戒をかわす',
    vs: { stuff: 0.4, contain: -0.4, zone: 0.6, deep: -0.3, blitz: -0.3 },
  },
  jetSweep: {
    name: 'ジェットスイープ', base: 'outside', lv: 5, text: '横に走りこんだレシーバーが、そのまま受け取って外を駆ける',
    vs: { stuff: 0.4, contain: -0.3, zone: 0.3, deep: -0.2, blitz: -0.2 },
  },
};

export const DEF_PLAYS: Record<DefPlay, PlayInfo> = {
  box: { name: 'ボックス', base: 'stuff', lv: 1, text: 'まん中に人を集めて、ランを止める', vs: {} },
  edge: { name: 'コンテイン', base: 'contain', lv: 1, text: '外側を見張って、外へのランを封じる', vs: {} },
  cover2: { name: 'カバー2', base: 'zone', lv: 1, text: '短いパスの通り道を、みんなでふさぐ', vs: {} },
  cover3: { name: 'カバー3', base: 'deep', lv: 1, text: '後ろを3人で厚く守って、奥へのパスを止める', vs: {} },
  blitz: { name: 'ブリッツ', base: 'blitz', lv: 1, text: '投げる人へ一気に襲いかかる電撃作戦', vs: {} },
  zoneBlitz: {
    name: 'ゾーンブリッツ', base: 'blitz', lv: 2, text: '襲いかかりながら、短いパスの通り道にも人を残す。奥はあく',
    vs: { inside: 0.2, outside: -0.6, short: -0.4, long: 0.8 },
  },
  cover1: {
    name: 'カバー1', base: 'zone', lv: 2, text: 'ひとりひとりに張りついて、奥のひとりが助ける。ランには少し弱い',
    vs: { inside: 0.3, outside: 0.2, short: 0.2, long: -0.7 },
  },
  prevent: {
    name: 'プリベント', base: 'deep', lv: 3, text: '奥だけは決して通さない構え。短いパスとランは進まれる',
    vs: { inside: 0.3, outside: 0.4, short: 0.4, long: -1.1 },
  },
  bear: {
    name: '46ディフェンス', base: 'stuff', lv: 3, text: '前に8人そろえてランを外まで止める。パスには手が回らない',
    vs: { inside: -0.3, outside: -0.6, short: 0.3, long: 0.6 },
  },
  aGap: {
    name: 'Aギャップブリッツ', base: 'blitz', lv: 4, text: 'まん中のすき間から一直線に突っこむ。中央ランをつぶす',
    vs: { inside: -0.8, outside: 0.3, short: 0.2, long: 0.3 },
  },
  cover4: {
    name: 'カバー4', base: 'deep', lv: 4, text: '後ろを4人で分けて守る。奥と外に強く、短いパスに弱い',
    vs: { inside: -0.2, outside: -0.3, short: 0.5 },
  },
  goalLine: {
    name: 'ゴールライン', base: 'stuff', lv: 5, text: '全員で前に詰める、ゴール前の守り。ランは通さない',
    vs: { inside: -0.6, outside: -0.2, short: 0.2, long: 0.6 },
  },
};

export const OFF_PLAY_KEYS = Object.keys(OFF_PLAYS) as OffPlay[];
export const DEF_PLAY_KEYS = Object.keys(DEF_PLAYS) as DefPlay[];
export const playInfo = (k: PlayKey): PlayInfo => (OFF_PLAYS as Record<string, PlayInfo>)[k] ?? (DEF_PLAYS as Record<string, PlayInfo>)[k]!;
export const isOffPlay = (k: PlayKey): k is OffPlay => k in OFF_PLAYS;
/** the plays of a side a team has at a level, family by family (the first of each family first) */
export function playsAt(side: 'off' | 'def', lv: number, base: OffType | DefType): PlayKey[] {
  const all: PlayKey[] = side === 'off' ? OFF_PLAY_KEYS : DEF_PLAY_KEYS;
  return all.filter((k) => playInfo(k).base === base && playInfo(k).lv <= Math.max(1, lv));
}
/** the plays a level brings (for the manager's news and the help) */
export const playsOfLevel = (lv: number): PlayKey[] => [...OFF_PLAY_KEYS, ...DEF_PLAY_KEYS].filter((k) => playInfo(k).lv === lv);
/** how many cards of each side a hand has at a level (one more from level 3) */
export const handAt = (lv: number): number => (lv >= 3 ? 4 : 3);

/** The shift a play and a call give the match-up of their families (positive: better for the offense). */
export function playShift(off: PlayKey | undefined, def: PlayKey | undefined, offType: OffType, defType: DefType): number {
  return (off ? playInfo(off).vs[defType] ?? 0 : 0) + (def ? playInfo(def).vs[offType] ?? 0 : 0);
}

/** The match-up of a play against each family of the other side (the family's own, shifted). */
function lineOf(k: PlayKey): { other: OffType | DefType; m: number }[] {
  const p = playInfo(k);
  if (isOffPlay(k)) return DEF_TYPES.map((d) => ({ other: d, m: MATCH[p.base as OffType][d] + (p.vs[d] ?? 0) }));
  return OFF_TYPES.map((o) => ({ other: o, m: MATCH[o][p.base as DefType] + (p.vs[o] ?? 0) }));
}
const familyName = (t: OffType | DefType): string => (t in OFF_INFO ? OFF_INFO[t as OffType].name : DEF_INFO[t as DefType].name);
/** What a play is good and bad against, by the plain names of the other side's families. */
export function goodBad(k: PlayKey): { good: string; bad: string } {
  const line = lineOf(k);
  const off = isOffPlay(k);
  // the offense likes a high number, the defense a low one
  const sorted = [...line].sort((a, b) => (off ? b.m - a.m : a.m - b.m));
  return { good: familyName(sorted[0]!.other), bad: familyName(sorted[sorted.length - 1]!.other) };
}
/** the plain name of a play's family ("中央ラン"), shown under its name */
export const familyOf = (k: PlayKey): string => familyName(playInfo(k).base);
