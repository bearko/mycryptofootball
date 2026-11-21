// The play-by-play: what the announcer shouts at each beat of a play. Pure text, no screen.
// Every call is a shout (`head`, a word or two, big on the screen) and what follows it (`tail`).
// Which line of several is said depends only on the play's number, so the same match reads the same every time
// (and nothing here touches the match's dice).

import { FIELD, TWO_POINTS, type PlayResult } from './match';
import { isKick, isRun, type OffType } from './cards';

export type Beat = 'snap' | 'handoff' | 'throw' | 'catch' | 'drop' | 'break' | 'steal' | 'touchdown' | 'kick' | 'end';

export interface Call {
  head: string;
  tail?: string;
  /** the big moments: a score, a ball taken away, a sack */
  hot?: boolean;
  /** who it is good for (the side on offense, or the side on defense) */
  side: 'off' | 'def' | 'none';
}

export interface CallNames {
  /** short names of the two schools, home first */
  teams: [string, string];
  /** a hero's name */
  hero(id: number): string;
}

const pick = <T>(list: readonly T[], n: number, salt: number): T => list[Math.abs(n * 5 + salt * 3) % list.length]!;

/**
 * What is said at one beat of a play. `route`: the name of the route the pass goes to (for 'throw').
 * Returns null when there is nothing worth saying (the picture speaks for itself).
 */
export function callFor(beat: Beat, res: PlayResult, names: CallNames, route?: string): Call | null {
  const n = res.n;
  const kick = res.kick;
  const type = res.offPick.type;
  const run = !isKick(type) && isRun(type as OffType);
  const passer = names.hero(res.passer);
  const carrier = names.hero(res.carrier);
  const defender = names.hero(res.defender);
  const offName = names.teams[res.off];
  const defName = names.teams[1 - res.off]!;
  const toGoal = FIELD - res.before.pos;
  const say = (head: string, tail?: string, side: Call['side'] = 'none', hot = false): Call => ({ head, tail, side, hot });

  switch (beat) {
    case 'snap': {
      if (kick) {
        if (kick.type === 'punt') return say('パントだ！', `${offName}、陣地を取りにいく`);
        if (kick.type === 'fg') return say(`${kick.dist}ヤード！`, `${names.hero(kick.kicker)}がねらう！`);
        return say('追加点のキック！', `${names.hero(kick.kicker)}、落ち着いて！`);
      }
      if (res.tfp) return say('2点をねらう！', `ゴール前${toGoal}ヤード、押しこめるか！`);
      if (res.before.down >= 4) return say('4回目の勝負！', `あと${res.before.toGo}ヤード！ ${offName}、行った！`);
      if (toGoal <= 5) return say('ゴール前！', `${offName}、ここで決めるか！`);
      if (res.before.down === 3) return say('3回目！', `あと${res.before.toGo}ヤード、ここが大事！`);
      return pick([say('スナップ！'), say('さあ動いた！'), say('プレー開始！')], n, 1);
    }
    case 'handoff': {
      if (type === 'inside') return pick([say('中央だ！', `${carrier}が突っこむ！`), say('ど真ん中！', `${carrier}、こじ開けろ！`), say('渡した！', `${carrier}、まっすぐ行く！`)], n, 2);
      return pick([say('外へ回る！', `${carrier}が大きくまくる！`), say('オープンだ！', `${carrier}、サイドラインへ走る！`), say('外だ外だ！', `${carrier}が持って出た！`)], n, 2);
    }
    case 'throw': {
      const to = route ? `${route}！` : '投げた！';
      if (type === 'long') return pick([say('深い！', `${passer}が大きく投げた！ ${route ?? 'ロング'}だ！`), say(to, `${carrier}が奥へ走っている！`), say('ロングだ！', route ? `${passer}、${route}に思いきって投げた！` : `${passer}、思いきって投げた！`)], n, 3);
      return pick([say(to, `${passer}がすばやく投げた！`), say('投げた！', route ? `${route}の${carrier}へ！` : `${carrier}へ！`), say(to, `${carrier}をねらう！`)], n, 3);
    }
    case 'catch':
      return pick([say('とった！', `${carrier}、ナイスキャッチ！`), say('通ったぁ！', `${carrier}の手におさまった！`), say('キャッチ！', `${carrier}がつかんだ！`)], n, 4);
    case 'drop':
      return pick([say('落ちた！', 'パス失敗！'), say('通らない！', `${defender}がじゃました！`), say('ああっと！', 'ボールは芝の上！')], n, 5);
    case 'break':
      return pick([say('抜けたぁ！', `${carrier}が止まらない！`), say('まだ走る！', `${carrier}、まだ走る！`), say('独走だ！', `だれも${carrier}に追いつけない！`)], n, 6);
    case 'steal': {
      if (res.turnover === 'int') return pick([say('インターセプトォ！！', `${defender}が読んでいた！`, 'def', true), say('とったのは守備！', `${defender}のインターセプトだ！`, 'def', true)], n, 7);
      return pick([say('ファンブル！！', `こぼれた！ ${defender}がおさえた！`, 'def', true), say('ボールが出た！', `${defName}が奪いとった！`, 'def', true)], n, 7);
    }
    case 'touchdown':
      return pick([
        say('タッチダウーーン！！', `${carrier}が決めたぁ！`, 'off', true),
        say('決めたぁぁ！！', `${offName}、タッチダウン！`, 'off', true),
        say('タッチダウン！！', `${carrier}、エンドゾーンに飛びこんだ！`, 'off', true),
      ], n, 8);
    case 'kick': {
      if (!kick) return null;
      if (kick.type === 'punt') return say('高く上がった！', `${kick.dist}ヤードのパント！`);
      return pick([say('蹴ったぁ！', 'ボールはゴールへ向かう！'), say('右足一閃！', '入るか、どうだ！')], n, 9);
    }
    case 'end': {
      if (kick) {
        if (kick.type === 'punt') return null;
        if (kick.good) return kick.type === 'fg' ? say('入ったぁ！！', `${names.hero(kick.kicker)}のフィールドゴール、3点！`, 'off', true) : say('決まった！', '追加点、1点！', 'off');
        return kick.type === 'fg' ? say('外れたぁ！', `フィールドゴール失敗！ ${defName}のボール！`, 'def', true) : say('外れた！', '追加点ならず！', 'def');
      }
      if (res.tfp) return res.points ? say('押しこんだぁ！', `${TWO_POINTS}点成功！`, 'off', true) : say('止めたぁ！', `${defName}がゴールを守った！`, 'def', true);
      if (res.td || res.turnover === 'int' || res.turnover === 'fumble') return null; // already shouted
      if (res.outcome === 'sack') return pick([say('サァァック！！', `${defender}が${passer}をしとめた！`, 'def', true), say('サックだ！！', `${defender}、${passer}を投げさせない！`, 'def', true)], n, 10);
      if (res.turnover === 'downs') return say('止めたぁ！！', `4回目も届かない！ ${defName}のボール！`, 'def', true);
      if (res.outcome === 'incomplete') return null; // said when the ball came down
      if (res.firstDown) {
        return res.yards >= 15
          ? pick([say(`${res.yards}ヤード！！`, `${carrier}のビッグプレー！ ファーストダウン！`, 'off', true), say('ビッグゲイン！！', `${carrier}が${res.yards}ヤードかせいだ！`, 'off', true)], n, 11)
          : pick([say('ファーストダウン！', `${carrier}が届いた！ 攻撃はつづく！`, 'off'), say('越えた！', `${res.yards}ヤード、ファーストダウン！`, 'off')], n, 11);
      }
      if (res.yards <= 0) return pick([say('つぶしたぁ！', `${defender}が${carrier}を進ませない！`, 'def'), say('進めない！', `${defender}のナイスタックル！`, 'def')], n, 12);
      if (!run && res.yards <= 2) return say('すぐ止めた！', `${defender}、${res.yards}ヤードしか許さない`, 'def');
      return pick([say(`${res.yards}ヤード！`, `${defender}がようやく止めた`, 'off'), say('止めた！', `${carrier}、${res.yards}ヤード前進`), say(`${res.yards}ヤード前進！`, `${defender}のタックル`)], n, 12);
    }
  }
}
