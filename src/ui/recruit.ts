import { blip } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { hero, recruit, specialOf, talentOf } from '../game/heroes';
import { ROLE_LABEL, STAT_LABEL, fit, type Role } from '../game/model';
import { ROSTER_SIZE, signRecruits } from '../game/season';
import { route } from './nav';
import { button, manager, specialText, sprite, statBars, talentChip } from './parts';

const ROLES: Role[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'CB', 'S'];

/** The two positions a hero suits best on each unit. */
export function bestRoles(stats: Parameters<typeof fit>[0]): string {
  const top = (roles: Role[]): string => [...roles].sort((a, b) => fit(stats, b) - fit(stats, a)).slice(0, 1).map((r) => ROLE_LABEL[r]).join('');
  return `攻撃は${top(ROLES.slice(0, 4))}、守備は${top(ROLES.slice(4))}向き`;
}

export function recruitScreen(): HTMLElement {
  const season = save().season!;
  const picked: number[] = [];
  let focus = season.candidates[0]!;
  const root = h('div.screen.recruit');

  const toggle = (id: number): void => {
    const i = picked.indexOf(id);
    if (i >= 0) picked.splice(i, 1);
    else if (picked.length < ROSTER_SIZE) picked.push(id);
    else {
      blip.no();
      return;
    }
    blip.pick();
    draw();
  };

  const draw = (): void => {
    const r = recruit(focus);
    const hr = hero(focus);
    const sp = specialOf(focus, r.kind);
    const isIn = picked.includes(focus);
    const left = ROSTER_SIZE - picked.length;
    root.replaceChildren(
      h('header.bar',
        h('h2', '入部説明会'),
        h('p', `9人から${ROSTER_SIZE}人えらぶ。最初にえらんだヒーローが主将になり、特別作戦を最初から使えます`)),
      h('div.recruit-body',
        h('div.recruit-grid', season.candidates.map((id) => {
          const order = picked.indexOf(id);
          return h('button.tile', {
            type: 'button',
            class: [id === focus ? 'focus' : '', order >= 0 ? 'in' : ''].join(' '),
            onclick: () => {
              if (focus === id) toggle(id);
              else {
                focus = id;
                blip.tap();
                draw();
              }
            },
          },
          sprite(id),
          h('span.tile-name', hero(id).name),
          talentChip(recruit(id).stats),
          order >= 0 ? h('span.tile-mark', order === 0 ? '主将' : `${order + 1}`) : null);
        })),
        h('div.recruit-detail',
          h('div.detail-head', sprite(focus, 'big'),
            h('div', h('h3', hr.name), h('p.blurb', r.blurb),
              h('p.fit', `${STAT_LABEL[talentOf(r.stats).best]}の一芸。${bestRoles(r.stats)}`))),
          statBars(r.stats),
          h('div.special-note', h('b', `特別作戦「${sp.name}」`), h('span', specialText(sp))),
          button(isIn ? '入部をとりやめる' : left > 0 ? '入部させる' : `${ROSTER_SIZE}人えらび済み`, () => toggle(focus), isIn ? 'ghost' : 'primary'))),
      h('footer.bar',
        manager(left > 0 ? `あと${left}人えらべます。6つの能力がそろうと戦いやすいですよ！` : 'この7人でいきましょう、監督！', left > 0 ? 'pointer_up' : 'sparkle'),
        button('この7人ではじめる', () => {
          if (picked.length !== ROSTER_SIZE) {
            blip.no();
            return;
          }
          signRecruits(season, picked);
          commit();
          route();
        }, picked.length === ROSTER_SIZE ? 'primary big' : 'big off')));
  };
  draw();
  return root;
}
