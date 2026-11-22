// Practice cards: a picture and a name, nothing else. What a card does is shown when it is considered
// (the effect bar over the hand, and the numbers over the heroes' heads).
// The frame and the background say what kind of card it is: paper for the ordinary drills, red for one-on-one,
// dark foil with a gold frame for a hero's special practice, green for the day off, the club's colour for the
// tactic practice, red and white for the camp's scrimmage. Between the tournaments a card stands for a fortnight
// (a "2週間" tag), at the camp it says so (a "合宿" tag): its effect is bigger, the picture the same.

import catalog from '../../generated/catalog.json';
import { h } from '../../core/dom';
import { hero, recruit, talentOf } from '../../game/heroes';
import { STAT_LABEL } from '../../game/model';
import { XPS, cardInfo, clubTacticLv, member, plan, tacticOf, weeksOf, type CardInfo, type PracticeCard, type PracticeKey, type Season } from '../../game/season';
import { LEVEL_PTS, TACTIC, TACTIC_LV_MAX } from '../../game/tactics';
import { tilt } from '../fx';
import { stars } from '../kit';
import { DRILL_STAT, shortName, xpChip } from './bits';
import type { DrillKind } from './ground';

/** The picture of each ordinary drill (and the day off): an Extension, by star level. */
const ART = ((catalog as { drills?: unknown }).drills ?? {}) as Record<string, { name: string; img: string }[]>;
const artOf = (key: PracticeKey | 'rest', star: number): string => {
  const set = ART[key] ?? [];
  return (set[Math.min(set.length, Math.max(1, star)) - 1] ?? set[0])?.img ?? '';
};

/** The drill the heroes perform for a card (the day off has none). */
export const drillKind = (card: PracticeCard): DrillKind | null =>
  (card.kind === 'basic' ? card.key : card.kind === 'rest' ? null : card.kind === 'tactic' || card.kind === 'scrim' ? 'game' : card.kind);

/** What a card stands for today, when it is not one ordinary day: "2週間", "合宿" (or ''). */
export function cardWhen(s: Season): string {
  const p = plan(s);
  const weeks = weeksOf(p);
  if (weeks) return `${Math.round(weeks)}週間`;
  return p.stage === 'camp' && !p.scrim ? '合宿' : '';
}

/** One card of the hand. `index` only numbers the key hint; the caller wires the pointer. */
export function practiceCard(s: Season, card: PracticeCard, index: number): HTMLButtonElement {
  const info = cardInfo(s, card);
  const inner = h('span.card-in');
  const key = h('span.card-key', String(index + 1));
  let cls: string;
  let label = `${info.name}：${info.text}`;
  if (card.kind === 'basic') {
    const stat = DRILL_STAT[card.key];
    cls = `is-basic ${stat ? `t-${stat}` : 't-all'} star${card.star}`;
    label = `${info.name} ★${card.star}：${info.text}`;
    inner.append(
      h('span.pgc-art', h('img.px', { src: artOf(card.key, card.star), alt: '', draggable: false }), stars(card.star)),
      h('span.pgc-name', info.name));
  } else if (card.kind === 'rest') {
    cls = 'is-rest';
    inner.append(
      h('span.pgc-art', h('img.px', { src: artOf('rest', 1), alt: '', draggable: false })),
      h('span.pgc-name', info.name));
  } else if (card.kind === 'scrim') {
    cls = 'is-scrim';
    inner.append(
      h('span.pgc-art.is-scrim', h('b.pgc-red', '紅'), h('b.pgc-white', '白')),
      h('span.pgc-name', info.name));
  } else if (card.kind === 'tactic') {
    const t = tacticOf(s) ?? 'speed';
    const lv = clubTacticLv(s);
    cls = 'is-tactic';
    label = `${info.name}（${TACTIC[t].name}・練度${lv}）：${info.text}`;
    inner.append(
      h('span.pgc-art.is-tactic', h('b.pgc-colour', TACTIC[t].name), h('span.pgc-lv', h('em', '★'.repeat(lv)), '☆'.repeat(TACTIC_LV_MAX - lv))),
      h('span.pgc-name', info.name));
  } else if (card.kind === 'solo') {
    cls = `is-solo t-${member(s, card.hero).focus}`;
    label = `マンツーマン（${hero(card.hero).name}）：${info.text}`;
    inner.append(
      h('span.pgc-art.is-hero', h('img.px', { src: hero(card.hero).img, alt: '', draggable: false }), h('b.pgc-who', shortName(card.hero))),
      h('span.pgc-name', info.name));
  } else {
    cls = `is-special t-${talentOf(recruit(card.hero).stats).best}`;
    label = `特別練習「${info.name}」（${hero(card.hero).name}）：${info.text}`;
    inner.append(
      h('span.foil'),
      h('span.pgc-art.is-hero', h('img.px', { src: hero(card.hero).img, alt: '', draggable: false }), h('b.pgc-who', '特別練習')),
      h('span.pgc-name', `「${info.name}」`));
  }
  const when = cardWhen(s);
  if (when) {
    cls += ` ${weeksOf(plan(s)) ? 'is-span' : 'is-camp'}`;
    label = `${when}：${label}`;
    inner.append(h('span.pgc-when', when));
  }
  inner.append(h('span.card-glare'));
  const tc = card.kind === 'tactic' ? { '--tc': TACTIC[tacticOf(s) ?? 'speed'].color } : {};
  const btn: HTMLButtonElement = h('button.card.pgc', { class: cls, type: 'button', 'aria-label': label, data: { uid: String(card.uid) }, style: { '--i': '0', ...tc } }, inner, key);
  tilt(btn, 9);
  return btn;
}

const signed = (n: number): string => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

/** A stamina chip: "体力 −14". */
export function staChip(n: number, who = ''): HTMLElement {
  return h('span.fx-sta', { class: n < 0 ? 'is-loss' : 'is-gain' }, h('u', `${who}体力`), h('b', signed(n)));
}

/** What a card is expected to do, for the effect bar over the hand. */
export function cardEffect(s: Season, card: PracticeCard): { title: HTMLElement; text: string; chips: HTMLElement[] } {
  const out = effectOf(s, card);
  // a fortnight, or the camp: said next to the name
  const when = cardWhen(s);
  if (when) out.title.append(h('i.fx-when', when));
  return out;
}

function effectOf(s: Season, card: PracticeCard): { title: HTMLElement; text: string; chips: HTMLElement[] } {
  const info: CardInfo = cardInfo(s, card);
  const xp = XPS.filter((k) => info.xp[k]).map((k) => xpChip(k, info.xp[k]!, true));
  const heart = (n: number, who: string): HTMLElement => h('span.fx-heart', h('u', `${who}信頼`), h('b', `+${n}`));
  const who = (text: string): HTMLElement => h('span.fx-who', text);
  if (card.kind === 'scrim') {
    return { title: h('b.fx-name', info.name), text: info.text, chips: [...xp, staChip(info.sta), heart(info.trust, '')] };
  }
  if (card.kind === 'basic') {
    return {
      title: h('b.fx-name', info.name, stars(card.star)), text: info.text,
      chips: [who('全員'), ...xp, staChip(info.sta), ...(info.trust ? [heart(info.trust, '')] : [])],
    };
  }
  if (card.kind === 'rest') {
    return { title: h('b.fx-name', info.name), text: info.text, chips: [who('全員'), staChip(info.sta)] };
  }
  if (card.kind === 'tactic') {
    const t = TACTIC[tacticOf(s) ?? 'speed'].name;
    const pts = s.tactic ? s.tacticWins ?? 0 : 0;
    const lv = clubTacticLv(s);
    const next = LEVEL_PTS[lv];
    // how far to the next level: "練度 2 → 3" when this practice gets there, else the points left
    const step = next === undefined ? null : pts + 1 >= next ? h('span.fx-tac', h('u', '練度'), h('b', `${lv}→${lv + 1}`))
      : h('span.fx-tac', h('u', `練度${lv + 1}まで`), h('b', `あと${next - pts}`));
    return {
      title: h('b.fx-name', info.name), text: `${t}の型をみがく`,
      chips: [who('全員'), ...(step ? [step] : []), ...xp, staChip(info.sta), heart(info.trust, '')],
    };
  }
  const name = shortName(card.hero);
  if (card.kind === 'solo') {
    const m = member(s, card.hero);
    return {
      title: h('b.fx-name', `マンツーマン：${name}`), text: `${STAT_LABEL[m.focus]}を特訓`,
      chips: [who(`${name}だけ`), ...xp, staChip(info.sta), heart(info.heroTrust, ''), staChip(info.others, 'ほかは')],
    };
  }
  const talent = talentOf(recruit(card.hero).stats).best;
  return {
    title: h('b.fx-name', `特別練習「${info.name}」`), text: `${name}が教える${STAT_LABEL[talent]}の練習`,
    chips: [who('全員'), ...xp, staChip(info.sta), heart(info.trust, ''), heart(info.trust + info.heroTrust, name)],
  };
}
