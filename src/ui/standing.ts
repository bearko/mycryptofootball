// The club's standing ("格") on the screen: the chip on the practice ground, the ladder with what every step gives,
// and what a match did to the gauge.

import { sfx } from '../core/audio';
import { h } from '../core/dom';
import { FAME_LOSS, FAME_WEIGHT, FAME_MAX, FAME_WIN, TIERS, tierOf, type FameChange } from '../game/prestige';
import type { Season } from '../game/season';
import { button, closeModal, modal } from './kit';

/** The gauge: a slanted bar, `from`..`to` in gauge points (it fills or drains once it is on the screen). */
function bar(to: number, from = to): HTMLElement {
  const fill = h('i', { style: { width: `${(from / FAME_MAX) * 100}%` } });
  const el = h('span.st-bar', { class: to < from ? 'is-down' : to > from ? 'is-up' : '' }, fill);
  if (to !== from) setTimeout(() => {
    fill.style.width = `${(to / FAME_MAX) * 100}%`;
  }, 500);
  return el;
}

/** The gauge as it stands. */
export const fameBar = (fame: number): HTMLElement => bar(fame);

/** "同好会" as a plate in the step's colour. */
export const tierPlate = (tier: number): HTMLElement => h('b.st-tier', { class: `st-${tier}` }, tierOf(tier).name);

/** What stepping up to a standing brings, as short lines. */
function perks(tier: number): string[] {
  const now = tierOf(tier);
  const was = tierOf(tier - 1);
  const out: string[] = [];
  if (now.roster > was.roster) out.push(`部員 ${now.roster}人まで`);
  if (now.hand > was.hand) out.push(`練習カード ${now.hand}枚`);
  if (now.cup !== was.cup) out.push(`${now.cup}に出場`);
  if (now.size !== was.size) out.push(`来年から${now.size}人制`);
  return out;
}

/** The chip on the practice ground: which year, the standing, the gauge. A tap opens the ladder. */
export function standingChip(s: Season): HTMLButtonElement {
  const el: HTMLButtonElement = h('button.st-chip', {
    type: 'button', 'aria-label': `${s.year}年目。格：${tierOf(s.tier).name}（ゲージ ${s.fame}/${FAME_MAX}）。押すと格の一覧`,
    onclick: () => {
      sfx.tap();
      standingModal(s);
    },
  }, h('span.st-year', `${s.year}年目`), tierPlate(s.tier), bar(s.fame));
  return el;
}

export function standingModal(s: Season): void {
  const rows = TIERS.map((t, i) => h('li', { class: i === s.tier ? 'is-now' : i < s.tier ? 'is-done' : '' },
    tierPlate(i),
    h('span.st-what', h('span', `部員 ${t.roster}人`), h('span', `練習カード ${t.hand}枚`), h('span', `${t.cup}（${t.size}人制）`)),
    i === s.tier ? h('span.st-here', bar(s.fame), h('i', `${s.fame}/${FAME_MAX}`)) : null)).reverse();
  modal(h('div.standing',
    h('p.st-lead', '試合に勝つとゲージがたまり、いっぱいになると格が上がります。負けると減り、なくなると格が下がります。'),
    h('ol.st-ladder', rows),
    h('p.st-rule',
      h('span', `勝ち：練習試合 +${FAME_WIN[0]}／1回戦 +${FAME_WIN[1]}／準決勝 +${FAME_WIN[2]}／決勝 +${FAME_WIN[3]}`),
      h('span', `負け：練習試合 ${FAME_LOSS[0]}／1回戦 ${FAME_LOSS[1]}／準決勝 ${FAME_LOSS[2]}／決勝 ${FAME_LOSS[3]}`),
      h('span', `時期の重み：春 ×${FAME_WEIGHT.spring}／初夏 ×${FAME_WEIGHT.summer}／秋 ×${FAME_WEIGHT.autumn}（秋の大会が本番）`),
      h('span', '大会と対戦校の強さは、春は年のはじめの格、秋は秋に入ったときの格で決まります。部員は春と5月の入部説明会でふえます。')),
    h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { cls: 'wide', title: `格：${tierOf(s.tier).name}（${s.year}年目）` });
}

/** What a match did to the standing: for the full-time panel. */
export function fameReport(c: FameChange): HTMLElement {
  const up = c.moved > 0;
  const down = c.moved < 0;
  // the gauge of the standing the club ends on; after a step it starts from the edge it came in by
  const from = up ? 0 : down ? FAME_MAX : c.before.fame;
  const news = up
    ? h('span.st-news.is-up', h('b', '昇格！'), tierPlate(c.before.tier), h('i', '▶'), tierPlate(c.after.tier), h('em', perks(c.after.tier).join('・')))
    : down ? h('span.st-news.is-down', h('b', '降格…'), tierPlate(c.before.tier), h('i', '▶'), tierPlate(c.after.tier)) : null;
  return h('div.st-report', { class: up ? 'is-up' : down ? 'is-down' : c.delta >= 0 ? 'is-gain' : 'is-loss' },
    h('span.st-label', '格'), tierPlate(c.after.tier), bar(c.after.fame, from),
    h('b.st-delta', `${c.delta > 0 ? '+' : ''}${c.delta}`), news);
}
