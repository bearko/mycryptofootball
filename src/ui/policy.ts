// 「ミーティング」 the training policy: which one ability each hero works on.
// It can be changed at a milestone only (the first day, the day after the practice match);
// at any other time the same panel opens just to be read.

import { tr } from '../core/i18n';
import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { hero, recruit, talentOf } from '../game/heroes';
import { ROLE_FULL, ROLE_LABEL, STATS, STAT_LABEL, type Stat } from '../game/model';
import {
  GROUP_ROLES, PRESET_LABEL, applyPreset, clubSize, clubTacticLv, groupFocus, groupMembers, hasTactic, policyOpen, presetFocus, roleStats, setFocus, setGroupFocus, setTactic, suggestedTactic, tacticOf, tacticOpen,
  type Member, type Preset, type Season,
} from '../game/season';
import { TACTIC, TACTICS, TACTIC_LV_MAX } from '../game/tactics';
import { burst, center, kick, ring } from './fx';
import { ICON, icon, shortName } from './ground/bits';
import { TALENT_COLOR, button, closeModal, gradeChip, modal, portrait, rankChip, statIcon } from './kit';
import { guideEvent } from './platform';
import { positions } from './shared';
import { clearGoal, teach } from './tutor';

const PRESETS: Preset[] = ['talent', 'offense', 'defense'];

/**
 * Eleven a side, the club's colour: the four to choose from (at a meeting), the manager's suggestion marked, the
 * chosen one's strength and weakness, and how far the club has come with it. A new colour starts again from level 1.
 */
function tacticRow(s: Season): HTMLElement {
  const open = tacticOpen(s);
  const rec = suggestedTactic(s);
  const note = h('p.pol-tac-note');
  const lv = h('span.pol-tac-lv');
  const btns = TACTICS.map((t) => {
    const info = TACTIC[t];
    const inner = [h('b', info.name), h('small', info.kind), t === rec ? h('i.pol-rec', 'おすすめ') : null];
    return open
      ? h('button.pol-tac-btn', {
        type: 'button', style: { '--tc': info.color },
        onclick: () => {
          if (tacticOf(s) === t && s.tactic) return;
          setTactic(s, t);
          sfx.stamp();
          vibrate(12);
          draw();
        },
      }, inner)
      : h('div.pol-tac-btn', { style: { '--tc': info.color } }, inner);
  });
  function draw(): void {
    const now = tacticOf(s)!;
    TACTICS.forEach((t, i) => {
      btns[i]!.classList.toggle('is-on', t === now);
      if (open) btns[i]!.setAttribute('aria-pressed', String(t === now));
    });
    const level = clubTacticLv(s);
    lv.replaceChildren('練度 ', h('em', '★'.repeat(level)), '☆'.repeat(TACTIC_LV_MAX - level));
    const info = TACTIC[now];
    note.replaceChildren(h('span.is-good', '強み'), info.good, h('span.is-bad', '弱み'), info.bad);
    if (open) note.append(h('small', '色を変えると練度は1から'));
  }
  draw();
  return h('div.pol-tac',
    h('div.pol-tac-head', h('b', 'チームの色'), lv, open ? null : h('small', '春のミーティングで変えられます')),
    h('div.pol-tac-btns', { role: open ? 'group' : undefined, 'aria-label': 'チームの色' }, btns),
    note);
}

export function policyPanel(s: Season, onClose: () => void): void {
  const open = policyOpen(s);
  const done = (): void => {
    clearGoal();
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
        h('b', shortName(m.id), gradeChip(m.grade)),
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

  // eleven a side: the policy a position at a time. A tap gives everybody at that position the next ability it uses
  const groups = open && clubSize(s) === 11
    ? GROUP_ROLES.filter((role) => groupMembers(s, role).length).map((role) => {
      const btn = h('button.pol-group', {
        type: 'button', title: `${ROLE_FULL[role]}の全員に、同じ能力を伸ばさせる（押すたびに次の能力）`,
        onclick: () => {
          const opts = roleStats(role);
          const now = groupFocus(s, role);
          const next = opts[(now ? opts.indexOf(now) + 1 : 0) % opts.length]!;
          setGroupFocus(s, role, next);
          sfx.cardPick();
          vibrate(10);
          draw();
          for (const c of cols) if (groupMembers(s, role).includes(c.m)) kick(c.el.querySelector('.portrait'), 'hop');
        },
      });
      return { role, btn };
    })
    : [];
  const drawGroups = (): void => {
    for (const { role, btn } of groups) {
      const k = groupFocus(s, role);
      btn.replaceChildren(h('b', ROLE_LABEL[role]), k ? h('span', { class: `t-${k}` }, statIcon(k), STAT_LABEL[k]) : h('span.is-mixed', 'ばらばら'));
      btn.classList.toggle('is-set', !!k);
    }
  };

  /** Lights the chosen ability of every hero, and the preset that matches everyone (if one does). */
  function draw(): void {
    drawGroups();
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
    hasTactic(s) ? tacticRow(s) : null,
    h('div.pol-lead',
      h('p', open
        ? ['ヒーローごとに', h('b', '伸ばす能力を1つ'), '決めます。練習の経験は、まずその能力になります。']
        : [icon(ICON.lock), h('b', '次に変えられるのは節目だけ'), '（練習試合の次の日）。いまは見るだけです。']),
      h('p.pol-legend', h('span', h('i.pol-rec', 'おすすめ'), '得意'), h('span', h('i.pol-hard', '△'), '苦手'))),
    groups.length ? h('div.pol-groups', h('span', 'ポジション', h('br'), 'ごとに'), groups.map((g) => g.btn)) : null,
    h('div.pol-grid', cols.map((c) => c.el)),
    h('div.pol-foot',
      open ? h('div.pol-presets', h('span', ...tr('まとめて\n決める').split('\n').flatMap((t, i) => (i ? [h('br'), t] : [t]))), [...presets.values()]) : null,
      open
        ? button('この方針でいく', () => {
          guideEvent(save(), 'policy_done');
          commit();
          vibrate(16);
          done();
        }, { cls: 'go big', sound: 'confirm' })
        : button('とじる', done, { sound: 'back' })));
  modal(body, { title: open ? 'ミーティング：練習の方針' : '練習の方針', cls: 'wide pol-panel', sticky: open });
  // the first meeting of a new coach: the manager says what is decided here
  if (open) setTimeout(() => body.isConnected && void teach(s, 'c2'), 500);
}
