// The weekly practice: one card per group, plus up to two one-on-one sessions.

import { blip, se } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { hero } from '../game/heroes';
import { STAT_LABEL } from '../game/model';
import {
  GROUPS, GROUP_HINT, GROUP_LABEL, GROUP_TRUST, PRACTICE, SOLO_KEYS, SOLO_PER_WEEK, SOLO_TRUST, gainOf, groupMembers, train,
  type Member, type PracticeCard, type PracticeKey, type TrainingChoice,
} from '../game/season';
import { changeList, memberModal } from './club';
import { route } from './nav';
import { button, closeModal, manager, modal, sprite, stars } from './parts';

const gainText = (m: Member, card: PracticeCard): string => {
  const p = PRACTICE[card.key];
  return p.main ? `+${gainOf(m, card)}` : '全+1';
};

export function trainingScreen(): HTMLElement {
  const s = save().season!;
  const deal = s.deal!;
  const choice: TrainingChoice = { groups: { backs: 0, recv: 0, line: 0 }, solo: {} };
  const root = h('div.screen.training');

  const soloLeft = (): number => SOLO_PER_WEEK - Object.keys(choice.solo).length;

  const soloPicker = (m: Member): void => {
    const set = (key: PracticeKey | null): void => {
      if (key) choice.solo[m.id] = key;
      else delete choice.solo[m.id];
      blip.pick();
      closeModal();
      draw();
    };
    const has = choice.solo[m.id];
    const can = has !== undefined || soloLeft() > 0;
    modal(h('div.solo',
      h('div.detail-head', sprite(m.id, 'big'),
        h('div', h('h3', `${hero(m.id).name}とマンツーマン`),
          h('p.blurb', can ? `グループ練習の代わりに、ふたりで特訓します。信頼 +${SOLO_TRUST}（グループ練習は +${GROUP_TRUST}）` : `マンツーマンは週に${SOLO_PER_WEEK}人までです。`))),
      can ? h('div.solo-grid', SOLO_KEYS.map((key) => h('button.btn.choice', {
        type: 'button', class: has === key ? 'primary' : '', onclick: () => set(key),
      }, h('b', PRACTICE[key].name), h('span', `${STAT_LABEL[PRACTICE[key].main!]} ${gainText(m, { key, star: 2 })}`)))) : null,
      h('div.row',
        button('くわしく見る', () => memberModal(s, m), 'ghost'),
        has ? button('グループ練習にもどす', () => set(null), 'ghost') : null,
        button('とじる', closeModal))));
  };

  const run = (): void => {
    const changes = train(s, choice);
    commit();
    se(changes.some((c) => c.learnedNow || c.boostedNow) ? 'get' : 'up');
    modal(h('div.event',
      h('h2', '練習の成果'),
      changeList(s, changes),
      button('OK', () => {
        closeModal();
        route();
      }, 'primary')), { sticky: true, cls: 'wide' });
  };

  const draw = (): void => {
    root.replaceChildren(
      h('header.bar',
        h('h2', `第${s.week + 1}週の練習`),
        h('p', `グループごとに練習カードを1枚。ヒーローをタップするとマンツーマン（あと${soloLeft()}人）`)),
      h('div.groups', GROUPS.map((g) => {
        const members = groupMembers(s, g);
        const active = members.filter((m) => !choice.solo[m.id]);
        return h('section.group',
          h('h3.sec', GROUP_LABEL[g], h('i', GROUP_HINT[g])),
          h('div.group-members', members.length ? members.map((m) => h('button.who', {
            type: 'button', class: choice.solo[m.id] ? 'solo' : '',
            onclick: () => {
              blip.tap();
              soloPicker(m);
            },
          }, sprite(m.id), h('span', choice.solo[m.id] ? `特訓:${PRACTICE[choice.solo[m.id]!].name}` : hero(m.id).name))) : h('p.empty', 'だれもいません')),
          h('div.practice-cards', deal[g].map((card, i) => {
            const p = PRACTICE[card.key];
            return h('button.pcard', {
              type: 'button', class: choice.groups[g] === i ? 'selected' : '',
              onclick: () => {
                choice.groups[g] = i;
                blip.pick();
                draw();
              },
            },
            h('span.pcard-name', p.name), stars(card.star),
            h('span.pcard-text', p.text),
            h('span.pcard-gain', active.map((m) => h('i', sprite(m.id), gainText(m, card)))));
          })));
      })),
      h('footer.bar',
        manager(soloLeft() > 0 ? '★が多いカードほど伸びます。得意な能力はとくに伸びやすいですよ。' : '準備OKです！', 'talk'),
        h('div.row', button('もどる', route, 'big'), button('この内容で練習する', run, 'primary big'))));
  };
  draw();
  return root;
}

