// The club's facilities and its money (部費): what each facility is at, what the next level does and costs. One tap
// on a facility's price buys it (the practice cards in hand follow at once). Opened from the practice ground.

import catalog from '../generated/catalog.json';
import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { ALLOWANCE, FACILITY, FAC_KEYS, FAC_MAX, LV_MUL, RARITY, REST_LV, donationOf, nextPrice, type FacKey } from '../game/funds';
import { tierOf } from '../game/prestige';
import { buyFacility, canBuy, facLv, moneyOf, type Season } from '../game/season';
import { burst } from './fx';
import { button, closeModal, modal } from './kit';

const ART = ((catalog as { drills?: unknown }).drills ?? {}) as Record<string, { name: string; img: string }[]>;
/** the Extension that stands for a facility at a level (Common at 1 … Legendary at 5) */
export const facArt = (k: FacKey, lv: number): { name: string; img: string } | null => {
  const set = ART[k] ?? [];
  return set[Math.min(set.length, Math.max(1, lv)) - 1] ?? null;
};
/** "×1.8" for a drill, "+56" for the club room */
export const facEffect = (k: FacKey, lv: number): string => (k === 'rest' ? `体力 +${REST_LV[lv]}` : `経験値 ×${LV_MUL[lv]!.toFixed(1)}`);
const money = (n: number): string => `${n}万円`;

/** The facilities pop-up. `onBuy`: something was bought (the hand is to be drawn again). */
export function facilitiesModal(s: Season, onBuy: () => void): void {
  const body = h('div.fac');
  const draw = (): void => {
    const income = ALLOWANCE[Math.max(0, Math.min(ALLOWANCE.length - 1, s.tier))]!;
    body.replaceChildren(
      h('div.fac-top',
        h('span.fac-money', h('small', '部費'), h('b', money(moneyOf(s)))),
        h('p.fac-how', `春・初夏・夏合宿・秋のはじめに ${money(income)}（格「${tierOf(s.tier).name}」）。試合に勝つと寄付（大会の決勝 ${money(donationOf(3, s.league))}）`)),
      h('div.fac-grid', FAC_KEYS.map((k, i) => {
        const lv = facLv(s, k);
        const art = facArt(k, lv);
        const price = nextPrice(lv);
        const btn = price == null
          ? h('span.fac-max', '最大')
          : h('button.fac-buy', {
            type: 'button', class: canBuy(s, k) ? 'go' : 'off',
            onclick: (e: MouseEvent) => {
            if (!buyFacility(s, k)) {
              sfx.deny();
              return;
            }
            sfx.learn();
            vibrate(20);
            burst(e.clientX, e.clientY, { count: 16, color: ['#ffe14a', '#fffbe8', '#37e3ff'], shape: ['star', 'rect'] });
            onBuy();
            draw();
            body.querySelector(`[data-k="${k}"]`)?.classList.add('is-up');
            },
          }, h('span', `Lv${lv + 1}へ`), h('b', money(price)));
        return h('div.fac-item', { data: { k }, class: `lv${lv}`, style: { '--i': String(i) }, title: `${RARITY[lv]}・${art?.name ?? ''}` },
          h('span.fac-art', art ? h('img.px', { src: art.img, alt: art.name, draggable: false }) : null),
          h('b.fac-name', FACILITY[k].name),
          h('span.fac-lv', h('em', `Lv${lv}`), h('i', '★'.repeat(lv)), h('u', '★'.repeat(FAC_MAX - lv)), h('small', RARITY[lv])),
          h('span.fac-eff', FACILITY[k].what, h('b', facEffect(k, lv).replace(/^.* /, '')), price != null ? h('i', `→${facEffect(k, lv + 1).replace(/^.* /, '')}`) : null),
          btn);
      })));
  };
  draw();
  modal(h('div', body, h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { title: '設備と部費', cls: 'wide fac-panel' });
  sfx.open();
}
