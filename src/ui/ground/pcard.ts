// Practice cards: the same family as the play cards of a match (sheets from the playbook, foil for the special ones).
// A card says what it hands out in shapes and colours: ■ power, ▶ speed, ● technique, ◆ brains, ♥ trust.

import { h } from '../../core/dom';
import { hero, recruit, talentOf } from '../../game/heroes';
import { STAT_LABEL } from '../../game/model';
import { XPS, cardInfo, member, type CardInfo, type PracticeCard, type Season } from '../../game/season';
import { tilt } from '../fx';
import { stars, statIcon } from '../kit';
import { DRILL_STAT, ICON, icon, shortName, xpChip } from './bits';
import type { DrillKind } from './ground';

export const drillKind = (card: PracticeCard): DrillKind => (card.kind === 'basic' ? card.key : card.kind);

const xpRow = (info: CardInfo, word: boolean): HTMLElement =>
  h('span.pgc-xp', { class: word ? 'is-wordy' : '' }, XPS.filter((k) => info.xp[k]).map((k) => xpChip(k, info.xp[k]!, word)));

const heart = (n: number, who = ''): HTMLElement | null =>
  (n > 0 ? h('span.pgc-heart', { title: `信頼 +${n}` }, `♥${who}+${n}`) : null);

/** One card of the hand. `index` only numbers the key hint; the caller wires the pointer. */
export function practiceCard(s: Season, card: PracticeCard, index: number): HTMLButtonElement {
  const info = cardInfo(s, card);
  const inner = h('span.card-in');
  const key = h('span.card-key', String(index + 1));
  let cls = 'is-basic';
  let label = `${info.name}：${info.text}`;
  if (card.kind === 'basic') {
    const stat = DRILL_STAT[card.key];
    const kinds = XPS.filter((k) => info.xp[k]).length;
    cls = `is-basic ${stat ? `t-${stat}` : 't-all'}`;
    label = `${info.name} ★${card.star}：${info.text}`;
    inner.append(
      h('span.card-band', h('span.card-name', info.name)),
      h('span.pgc-art', stat ? statIcon(stat) : icon(ICON.all, 'ticon'), stars(card.star)),
      xpRow(info, kinds <= 2),
      h('span.pgc-foot', h('u', '全員'), heart(info.trust)));
  } else if (card.kind === 'solo') {
    const m = member(s, card.hero);
    cls = `is-solo t-${m.focus}`;
    inner.append(
      h('span.card-band', h('span.card-name', 'マンツーマン')),
      h('span.pgc-art.is-hero', h('img.px', { src: hero(card.hero).img, alt: '', draggable: false }), h('b', shortName(card.hero))),
      h('span.pgc-aim', statIcon(m.focus), `${STAT_LABEL[m.focus]}を特訓`),
      xpRow(info, false),
      h('span.pgc-foot', h('u', 'ひとり'), heart(info.heroTrust)));
  } else {
    const talent = talentOf(recruit(card.hero).stats).best;
    cls = `special is-special t-${talent}`;
    inner.append(
      h('span.foil'),
      h('span.sp-name', `特別練習「${info.name}」`),
      h('span.sp-hero', h('img.px', { src: hero(card.hero).img, alt: '', draggable: false })),
      h('span.sp-tag', `${shortName(card.hero)}の${STAT_LABEL[talent]}`),
      xpRow(info, false),
      h('span.pgc-foot', h('u', '全員'), heart(info.trust)));
  }
  inner.append(h('span.card-glare'));
  const btn: HTMLButtonElement = h('button.card.pgc', { class: cls, type: 'button', 'aria-label': label, data: { uid: String(card.uid) }, style: { '--i': '0' } }, inner, key);
  tilt(btn, 9);
  return btn;
}

/** What the manager says about a card that is being considered. */
export function cardLine(s: Season, card: PracticeCard): string {
  const info = cardInfo(s, card);
  if (card.kind === 'basic') return `「${info.name}」★${card.star}：${info.text}。`;
  return `${info.text}。`;
}
