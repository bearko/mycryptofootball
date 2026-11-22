// The alumni's room (OB会): the OB points the graduates left, the shop (lunch boxes and medals), and the medal game.
// Everything is one tap: a price buys, a lunch box in hand is opened, a bet spins the reels.

import catalog from '../generated/catalog.json';
import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { BENTO, BENTO_KEYS, BETS, MEDAL_PACK, MEDAL_RATE, PAIR, TRIPLE, type BentoKey } from '../game/alumni';
import { buyBento, buyMedals, cashMedals, itemCount, medalsOf, moneyOf, obOfClub, playSlot, useBento, type Season } from '../game/season';
import { burst } from './fx';
import { button, closeModal, modal } from './kit';

const ITEMS = ((catalog as { items?: unknown }).items ?? { bento: [], medal: [] }) as Record<'bento' | 'medal', { name: string; img: string }[]>;
const bentoArt = (k: BentoKey): { name: string; img: string } | undefined => ITEMS.bento[BENTO[k].art];
const medalArt = (i: number): string => ITEMS.medal[i]?.img ?? '';

/** What a lunch box does, in a few words. */
export const bentoText = (k: BentoKey): string => (BENTO[k].sta >= 100 ? '全員の体力が満タン・信頼 +2' : `全員の体力 +${BENTO[k].sta}`);

/** The alumni's room. `onChange`: stamina, money or the hand may have changed (the ground is drawn again). */
export function alumniModal(s: Season, onChange: () => void): void {
  const body = h('div.ob');
  let spinning = false;
  const reels = [0, 1, 2].map(() => h('span.ob-reel', h('img.px', { src: medalArt(0), alt: '', draggable: false })));
  const result = h('p.ob-result', 'メダルを賭けて回す。左の2つがそろえば2倍、3つそろえばもっと');
  const money = (n: number): string => `${n}万円`;

  const pop = (e: MouseEvent | null, color: string[]): void => {
    if (e) burst(e.clientX, e.clientY, { count: 14, color, shape: ['star', 'rect'] });
  };
  const draw = (): void => {
    const pts = obOfClub(s);
    const medals = medalsOf(s);
    body.replaceChildren(
      h('div.ob-top',
        h('span.ob-pts', h('small', 'OBポイント'), h('b', String(pts))),
        h('span.ob-medals', h('img.px', { src: medalArt(0), alt: '' }), h('small', 'メダル'), h('b', `${medals}枚`)),
        h('span.ob-money', h('small', '部費'), h('b', money(moneyOf(s)))),
        h('p.ob-how', '卒業した部員が、OBポイントをのこしてくれる（育つほど・信頼が高いほど多い）')),
      h('section.ob-shop',
        h('h4', '売店'),
        h('div.ob-grid',
          ...BENTO_KEYS.map((k, i) => {
            const art = bentoArt(k);
            const have = itemCount(s, k);
            const price = BENTO[k].price;
            return h('div.ob-item', { style: { '--i': String(i) }, data: { k } },
              h('span.ob-art', art ? h('img.px', { src: art.img, alt: '', draggable: false }) : null, have ? h('i.ob-have', `×${have}`) : null),
              h('b.ob-name', art?.name ?? ''),
              h('span.ob-eff', bentoText(k)),
              h('span.ob-btns',
                h('button.fac-buy', {
                  type: 'button', class: pts >= price ? 'go' : 'off',
                  onclick: (e: MouseEvent) => {
                    if (!buyBento(s, k)) return void sfx.deny();
                    sfx.learn();
                    vibrate(16);
                    pop(e, ['#ffe14a', '#fffbe8']);
                    onChange();
                    draw();
                  },
                }, h('span', '買う'), h('b', `${price}pt`)),
                have ? h('button.fac-buy.ob-eat', {
                  type: 'button',
                  onclick: (e: MouseEvent) => {
                    useBento(s, k);
                    sfx.trustUp();
                    vibrate([12, 30, 12]);
                    pop(e, ['#7dff8a', '#fffbe8', '#ffe14a']);
                    onChange();
                    draw();
                  },
                }, h('span', '食べる')) : null));
          }),
          h('div.ob-item.is-medal', { style: { '--i': '4' } },
            h('span.ob-art', h('img.px', { src: medalArt(0), alt: '', draggable: false })),
            h('b.ob-name', `MCHメダル ${MEDAL_PACK.medals}枚`),
            h('span.ob-eff', 'メダルゲームで使う'),
            h('span.ob-btns', h('button.fac-buy', {
              type: 'button', class: pts >= MEDAL_PACK.price ? 'go' : 'off',
              onclick: (e: MouseEvent) => {
                if (!buyMedals(s)) return void sfx.deny();
                sfx.countTick();
                pop(e, ['#ffe14a', '#c0c8ff']);
                onChange();
                draw();
              },
            }, h('span', '買う'), h('b', `${MEDAL_PACK.price}pt`)))))),
      h('section.ob-slot',
        h('h4', 'MCHスロット'),
        h('div.ob-machine', h('div.ob-reels', reels), result),
        h('div.ob-bets',
          ...BETS.map((bet) => h('button.ob-bet', {
            type: 'button', class: medals >= bet && !spinning ? '' : 'off', disabled: spinning,
            onclick: () => void roll(bet),
          }, h('b', `${bet}枚`), h('span', 'で回す'))),
          h('button.ob-cash', {
            type: 'button', class: medals >= MEDAL_RATE.medals && !spinning ? '' : 'off', disabled: spinning,
            onclick: (e: MouseEvent) => {
              if (!cashMedals(s)) return void sfx.deny();
              sfx.learn();
              pop(e, ['#ffe14a', '#7dff8a']);
              onChange();
              draw();
            },
          }, h('span', `${MEDAL_RATE.medals}枚を部費に`), h('b', `+${money(MEDAL_RATE.money)}`))),
        h('ol.ob-pay', TRIPLE.map((v, i) => h('li', h('span', [0, 1, 2].map(() => h('img.px', { src: medalArt(i), alt: '' }))), h('b', `×${v}`))),
          h('li', h('span', h('img.px', { src: medalArt(0), alt: '' }), h('img.px', { src: medalArt(0), alt: '' }), h('i', '？')), h('b', `×${PAIR}`)))));
  };

  /** Spins the reels: they run, then stop one by one on what the season's dice said. */
  const roll = async (bet: number): Promise<void> => {
    if (spinning) return;
    const out = playSlot(s, bet);
    if (!out) return void sfx.deny();
    spinning = true;
    onChange();
    draw();
    sfx.tap();
    result.textContent = '…';
    result.className = 'ob-result';
    const timers = reels.map((el, i) => {
      el.classList.add('is-spin');
      return window.setInterval(() => {
        (el.firstElementChild as HTMLImageElement).src = medalArt(Math.floor(Math.random() * 5));
      }, 70);
    });
    for (let i = 0; i < 3; i += 1) {
      await new Promise((r) => setTimeout(r, i === 0 ? 450 : 320));
      clearInterval(timers[i]);
      reels[i]!.classList.remove('is-spin');
      (reels[i]!.firstElementChild as HTMLImageElement).src = medalArt(out.reels[i]!);
      reels[i]!.classList.add('is-stop');
      setTimeout(() => reels[i]!.classList.remove('is-stop'), 300);
      sfx.stamp();
    }
    if (out.hit) {
      result.textContent = out.hit === 'triple' ? `そろった！！ +${out.pay}枚` : `2つそろった！ +${out.pay}枚`;
      result.className = `ob-result is-${out.hit}`;
      (out.hit === 'triple' ? sfx.win : sfx.firstDown)();
      const r = reels[1]!.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, { count: out.hit === 'triple' ? 30 : 12, color: ['#ffe14a', '#fffbe8', '#ff5a2e'], shape: ['star', 'rect'] });
    } else {
      result.textContent = 'はずれ…';
      sfx.stopped(false);
    }
    spinning = false;
    onChange();
    draw();
  };

  draw();
  modal(h('div', body, h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { title: 'OB会', cls: 'wide ob-panel' });
  sfx.open();
}
