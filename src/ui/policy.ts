// 「ミーティング」 the training policy: which one ability each hero works on.
// It can be changed at a milestone only (the first day, the day after the practice match);
// at any other time the same panel opens just to be read.

import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { hero, recruit, talentOf } from '../game/heroes';
import { STATS, STAT_LABEL, type Stat } from '../game/model';
import { PRESET_LABEL, applyPreset, policyOpen, presetFocus, setFocus, type Member, type Preset, type Season } from '../game/season';
import { burst, center, kick, ring } from './fx';
import { ICON, icon, shortName } from './ground/bits';
import { TALENT_COLOR, button, closeModal, modal, portrait, rankChip, statIcon } from './kit';
import { guideEvent } from './platform';
import { positions } from './shared';

const PRESETS: Preset[] = ['talent', 'offense', 'defense'];

export function policyPanel(s: Season, onClose: () => void): void {
  const open = policyOpen(s);
  const done = (): void => {
    closeModal();
    onClose();
  };

  interface Col { m: Member; el: HTMLElement; stats: Map<Stat, HTMLElement> }
  const cols: Col[] = s.members.map((m, i) => {
    const { best, worst } = talentOf(recruit(m.id).stats);
    const stats = new Map<Stat, HTMLElement>();
    const where = positions(s, m.id).split(' / ');
    const el = h('div.pol-col', { style: { '--i': String(i) } },
      h('div.pol-who',
        portrait(m.id, { color: TALENT_COLOR[best] }),
        h('b', shortName(m.id)),
        h('span', where.map((w) => h('i', w)))),
      h('div.pol-stats', STATS.map((k) => {
        const mark = k === best ? h('i.pol-rec', { title: '得意：少ない経験でのびる' }, 'おすすめ') : k === worst ? h('i.pol-hard', { title: '苦手：のびにくい' }, '△') : null;
        const inner = [statIcon(k), h('b', String(m.stats[k]), rankChip(m.stats[k])), h('span', { class: STAT_LABEL[k].length > 3 ? 'is-long' : '' }, STAT_LABEL[k]), mark];
        const label = `${hero(m.id).name}：${STAT_LABEL[k]} ${m.stats[k]}${k === best ? '（おすすめ・得意）' : k === worst ? '（苦手）' : ''}`;
        const cell: HTMLElement = open
          ? h('button.pol-stat', {
            type: 'button', class: `t-${k}`, 'aria-label': label,
            onclick: (ev: MouseEvent) => {
              if (m.focus === k) {
                sfx.tap();
                kick(cell, 'is-nudge');
                return;
              }
              setFocus(s, m.id, k);
              sfx.cardPick();
              vibrate(10);
              const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(cell);
              ring(at.x, at.y, TALENT_COLOR[k]);
              burst(at.x, at.y, { count: 7, power: 0.45, size: 0.7, color: [TALENT_COLOR[k], '#fffbe8'] });
              draw();
              kick(el.querySelector('.portrait'), 'hop');
            },
          }, inner)
          : h('div.pol-stat', { class: `t-${k}`, 'aria-label': label }, inner);
        if (k === best) cell.classList.add('is-best');
        if (k === worst) cell.classList.add('is-worst');
        stats.set(k, cell);
        return cell;
      })));
    return { m, el, stats };
  });

  const presets = new Map<Preset, HTMLButtonElement>();
  for (const key of PRESETS) {
    presets.set(key, button(PRESET_LABEL[key].name, () => {
      applyPreset(s, key);
      sfx.stamp();
      vibrate([10, 30, 10]);
      draw();
      cols.forEach((c, i) => setTimeout(() => kick(c.el.querySelector('.portrait'), 'hop'), i * 45));
    }, { cls: 'alt', quiet: true }));
    presets.get(key)!.title = PRESET_LABEL[key].text;
  }

  /** Lights the chosen ability of every hero, and the preset that matches everyone (if one does). */
  function draw(): void {
    for (const c of cols) {
      for (const [k, cell] of c.stats) {
        const on = c.m.focus === k;
        if (on && !cell.classList.contains('is-on')) kick(cell, 'is-pick');
        cell.classList.toggle('is-on', on);
        if (open) cell.setAttribute('aria-pressed', String(on));
      }
    }
    for (const [key, btn] of presets) btn.classList.toggle('is-on', s.members.every((m) => m.focus === presetFocus(s, m, key)));
  }
  draw();

  const body = h('div.pol', { class: open ? 'is-open' : 'is-locked' },
    h('div.pol-lead',
      h('p', open
        ? ['ヒーローごとに', h('b', '伸ばす能力を1つ'), '決めます。練習の経験は、まずその能力になります。']
        : [icon(ICON.lock), h('b', '次に変えられるのは節目だけ'), '（練習試合の次の日）。いまは見るだけです。']),
      h('p.pol-legend', h('span', h('i.pol-rec', 'おすすめ'), '得意'), h('span', h('i.pol-hard', '△'), '苦手'))),
    h('div.pol-grid', cols.map((c) => c.el)),
    h('div.pol-foot',
      open ? h('div.pol-presets', h('span', 'まとめて', h('br'), '決める'), [...presets.values()]) : null,
      open
        ? button('この方針でいく', () => {
          guideEvent(save(), 'policy_done');
          commit();
          vibrate(16);
          done();
        }, { cls: 'go big', sound: 'confirm' })
        : button('とじる', done, { sound: 'back' })));
  modal(body, { title: open ? 'ミーティング：練習の方針' : '練習の方針', cls: 'wide pol-panel', sticky: open });
}
