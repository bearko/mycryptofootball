// The club room: calendar, roster, the next opponent, and the doors to practice, line-up and match.

import { blip, playBgm, se } from '../core/audio';
import { debug } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { KIND } from '../game/cards';
import { hero, recruit, specialOf } from '../game/heroes';
import { isStarter } from '../game/lineup';
import { DEF_POS, OFF_POS, ROLE_LABEL, roleOf } from '../game/model';
import { OPPONENTS, aces } from '../game/teams';
import {
  SCHEDULE, TEAM_NAME, TRUST_BOOST, TRUST_LEARN, answerEvent, boosted, changeText, eventDef, learned, member, nextMatch,
  plan, scoutedKeys, startWeek, type Change, type Member, type Season,
} from '../game/season';
import { lineupScreen } from './lineupScreen';
import { matchScreen } from './matchScreen';
import { show } from './nav';
import { button, closeModal, helpModal, manager, modal, muteButton, specialText, sprite, statBars, trustBar } from './parts';
import { bestRoles } from './recruit';
import { trainingScreen } from './training';

/** Where a member plays: "司令塔 / セーフティ", or "控え". */
export function positions(s: Season, id: number): string {
  const l = s.lineup!;
  if (!isStarter(l, id)) return '控え';
  const off = OFF_POS.find((p) => l.off[p] === id)!;
  const def = DEF_POS.find((p) => l.def[p] === id)!;
  return `${ROLE_LABEL[roleOf(off)]} / ${ROLE_LABEL[roleOf(def)]}`;
}

/** A list of what changed for whom, with new special plays called out. */
export function changeList(s: Season, changes: Change[]): HTMLElement {
  return h('ul.changes', changes.map((c) => h('li', { class: c.learnedNow || c.boostedNow ? 'news' : '' },
    sprite(c.id),
    h('div',
      h('b', hero(c.id).name),
      h('span', changeText(c).join('　') || '変化なし'),
      c.learnedNow ? h('em', `特別作戦「${hero(c.id).passive}」を覚えた！`) : null,
      c.boostedNow ? h('em', `「${hero(c.id).passive}」がさらに強くなった！`) : null),
    trustBar(member(s, c.id).trust))));
}

export function memberModal(s: Season, m: Member): void {
  const r = recruit(m.id);
  const sp = specialOf(m.id, r.kind, boosted(m));
  const state = boosted(m) ? '強化ずみ' : learned(m) ? `習得ずみ（信頼${TRUST_BOOST}で強化）` : `信頼${TRUST_LEARN}で習得（いま${m.trust}）`;
  modal(h('div.member',
    h('div.detail-head', sprite(m.id, 'big'),
      h('div', h('h3', hero(m.id).name, m.captain ? h('span.chip', '主将') : null),
        h('p.blurb', r.blurb),
        h('p.fit', `いまは ${positions(s, m.id)}。${bestRoles(m.stats)}`))),
    statBars(m.stats, r.stats),
    h('div.trust-row', h('span', `信頼 ${m.trust}`), trustBar(m.trust)),
    h('div.special-note', { class: learned(m) ? 'on' : '' },
      h('b', `特別作戦「${sp.name}」`, h('i', state)),
      h('span', specialText(sp))),
    button('とじる', closeModal, 'primary')));
}

function eventModal(s: Season, after: () => void): void {
  const e = s.event!;
  const def = eventDef(e.key);
  const body = h('div.event',
    h('h2', def.title),
    h('p', def.text(hero(e.a).name, hero(e.b).name)),
    h('div.event-choices', def.choices.map((c, i) => h('button.btn.choice', {
      type: 'button',
      onclick: () => {
        blip.pick();
        const changes = answerEvent(s, i);
        commit();
        if (changes.some((c2) => c2.learnedNow)) se('get');
        modal(h('div.event',
          h('h2', def.title),
          changeList(s, changes),
          button('OK', () => {
            closeModal();
            after();
          }, 'primary')), { sticky: true });
      },
    }, h('b', c.label), h('span', c.note)))));
  modal(body, { sticky: true });
}

function tip(s: Season): [string, string] {
  const p = plan(s);
  const locked = s.members.filter((m) => !learned(m)).length;
  if (p.t === 'match') return [`${p.label}です。編成を確かめたら、試合へ行きましょう！`, 'both_arms_up'];
  if (s.week === 0) return ['まずは練習です。マンツーマンで見てあげると、信頼がぐっと上がりますよ。', 'pointer_up'];
  if (locked >= 4) return ['信頼が40たまると特別作戦を覚えます。だれから育てるかが腕の見せどころ！', 'talk'];
  return ['得意を伸ばすか、守備の穴をうめるか。次の相手を見て決めましょう。', 'smile'];
}

let debugApplied = false;
function applyDebug(s: Season): void {
  if (debugApplied) return;
  debugApplied = true;
  if (debug.trust !== null) for (const m of s.members) m.trust = debug.trust;
  if (debug.week !== null) {
    s.week = Math.max(0, Math.min(SCHEDULE.length - 1, debug.week));
    startWeek(s);
  }
}

export function clubScreen(): HTMLElement {
  const s = save().season!;
  applyDebug(s);
  const p = plan(s);
  const next = nextMatch(s);
  playBgm('club');
  const rerender = (): void => show(clubScreen());

  const calendar = h('ol.calendar', SCHEDULE.map((w, i) => {
    const res = s.results.find((r) => r.week === i);
    const label = w.t === 'train' ? '練習' : w.label.replace('地区大会 ', '');
    return h('li', { class: [w.t, i === s.week ? 'now' : '', i < s.week ? 'past' : '', w.t === 'match' && w.cup ? 'cup' : ''].join(' ') },
      h('span', label),
      res ? h('b', { class: res.win ? 'win' : 'lose' }, `${res.win ? '○' : '●'}${res.us}-${res.them}`) : null);
  }));

  const roster = h('div.roster', s.members.map((m) => h('button.mate', {
    type: 'button',
    class: isStarter(s.lineup!, m.id) ? '' : 'bench',
    onclick: () => {
      blip.tap();
      memberModal(s, m);
    },
  },
  sprite(m.id),
  h('span.mate-name', hero(m.id).name),
  h('span.mate-pos', positions(s, m.id)),
  trustBar(m.trust),
  h('span.mate-play', { class: learned(m) ? 'on' : '' }, learned(m) ? `★ ${KIND[recruit(m.id).kind].tag}` : `信頼 ${m.trust}/${TRUST_LEARN}`),
  m.captain ? h('span.tile-mark', '主将') : null)));

  let scout: HTMLElement | null = null;
  if (next) {
    const opp = OPPONENTS[next.opp]!;
    const weeks = SCHEDULE.findIndex((w) => w === next) - s.week;
    const studied = p.t === 'match' ? scoutedKeys(s) : [];
    scout = h('aside.scout',
      h('p.scout-when', weeks > 0 ? `${next.label}まで あと${weeks}週` : `今週は ${next.label}`),
      h('h3', { style: { color: opp.color } }, opp.name),
      h('p', opp.style),
      h('ul.aces', aces(next.opp).map((a) => h('li', sprite(a.id), h('div', h('b', a.name), h('span', `「${a.play}」${a.tag}`))))),
      studied.length ? h('p.warn', `相手はこちらの「${studied.map((k) => hero(Number(k)).passive).join('」「')}」を研究している。最初から少し読まれる`) : null,
      next.cup ? h('p.scout-note', '負けたら今年はここまで') : h('p.scout-note', '負けても大会には進める'));
  }

  const [line, pose] = tip(s);
  const act = p.t === 'train'
    ? button('練習をはじめる', () => show(trainingScreen()), 'primary big')
    : button('試合へ', () => {
      storeMatch(null);
      show(...matchScreen());
    }, 'primary big');

  const el = h('div.screen.club',
    h('header.bar',
      h('h2', `${TEAM_NAME} アメフト部`),
      h('div.bar-right', muteButton(), button('あそびかた', helpModal, 'ghost mini'), button('タイトル', () => {
        save().season = s;
        commit();
        import('./title').then((m) => show(m.titleScreen()));
      }, 'ghost mini'))),
    calendar,
    h('div.club-body', h('section', h('h3.sec', '部員（タップでくわしく）'), roster), scout),
    h('footer.bar', manager(line, pose), h('div.row', button('編成', () => show(lineupScreen(rerender)), 'big'), act)));

  if (s.event && p.t === 'train') setTimeout(() => eventModal(s, rerender), 60);
  else if (!save().helpSeen) {
    save().helpSeen = true;
    commit();
    setTimeout(helpModal, 60);
  }
  return el;
}

