// 「部室」 the club room: the hub between weeks.
// A drawn room at dusk with the seven heroes hanging around, the road to the title across the top,
// the next opponent as a taped poster, the weekly event as a small scene, and one clear way forward.

import { playBgm, sfx, vibrate } from '../core/audio';
import { debug } from '../core/debug';
import { h } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { hero } from '../game/heroes';
import { isStarter } from '../game/lineup';
import {
  SCHEDULE, TEAM_NAME, TRUST_LEARN, TRUST_MAX, answerEvent, boosted, eventDef, learned, nextMatch, plan, scoutedKeys, startWeek,
  type Change, type Member, type Season,
} from '../game/season';
import { OPPONENTS, aces } from '../game/teams';
import { burst, center, kick, kinetic, motion, ring, shake, typewriter } from './fx';
import { button, closeModal, gauge, modal, modalOpen, portrait, speech, sprite } from './kit';
import { lineupScreen } from './lineupScreen';
import { matchScreen } from './matchScreen';
import { show } from './nav';
import { changeList, helpModal, memberModal, settingsModal } from './shared';
import { titleScreen } from './title';
import { trainingScreen } from './training';

/** The week the room was last seen in: the ball on the road rolls on from there. */
let lastWeek: number | null = null;

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

/** The name a team-mate would shout: "ウィリアム・テル" becomes "テル". */
export function shortName(id: number): string {
  const parts = hero(id).name.split('・');
  return parts[parts.length - 1]!;
}

/** A hero as a living sprite: the outer span is free for scripted moves, the middle one turns round, the image breathes and hops. */
export function figure(id: number): HTMLElement {
  return h('span.herofig', { style: { '--d': `${-((id * 7) % 13) / 10}s` } }, h('span.herofig-turn', sprite(id)));
}

/**
 * Keeps a group of sprites alive: now and then one of them hops or turns round.
 * Stops by itself once the host has left the page. Call it when the screen is shown.
 */
export function idleLife(host: HTMLElement, figs: () => HTMLElement[]): void {
  if (!motion()) return;
  const beat = (): void => {
    if (!host.isConnected) return;
    const all = figs();
    if (all.length && !modalOpen() && !host.classList.contains('is-busy')) {
      const f = all[Math.floor(Math.random() * all.length)]!;
      if (Math.random() < 0.55) kick(f.querySelector('img'), 'hop');
      else f.classList.toggle('is-flip');
    }
    setTimeout(beat, 700 + Math.random() * 1500);
  };
  setTimeout(beat, 900);
}

/** Runs f once the open pop-up has gone (the manager reacts to what was just looked at). */
function whenModalCloses(host: HTMLElement, f: () => void): void {
  const t = window.setInterval(() => {
    if (!host.isConnected) {
      clearInterval(t);
      return;
    }
    if (modalOpen()) return;
    clearInterval(t);
    f();
  }, 120);
}

const svg = (body: string, cls = ''): HTMLElement => {
  const el = h('i.cico', { class: cls, 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24">${body}</svg>`;
  return el;
};
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const WARN = '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>';
const EVENT_ICON: Record<string, string> = {
  late: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  quarrel: '<path d="M12 2l2.4 6.2L21 6l-3.6 5.6L22 16l-6.6.2L14 22l-3-5-5.6 2.6 1.8-6L2 10l6.4-.6z"/>',
  gift: '<path d="M12 3c2 0 9 12 9 15s-3 3-9 3-9 0-9-3 7-15 9-15z"/><path d="M8.5 21v-6h7v6"/>',
  rain: '<path d="M6 14a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 18 6.5a4 4 0 0 1 0 7.5z"/><path d="M8 17l-1 3M12.5 17l-1 3M17 17l-1 3"/>',
  idea: '<path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-.8.8-1 1.6-1 2.5H9c0-.9-.2-1.7-1-2.5z"/>',
  slump: '<path d="M6 16a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 18 8.5a4 4 0 0 1 0 7.5z"/><path d="M9 20h6"/>',
};

// ------------------------------------------------------------------ what the manager says

type Line = [text: string, pose: string];

function closestToLearning(s: Season): Member | null {
  const locked = s.members.filter((m) => !learned(m)).sort((a, b) => b.trust - a.trust);
  return locked[0] ?? null;
}

function arriveLine(s: Season): Line {
  const p = plan(s);
  const last = s.results[s.results.length - 1];
  if (p.t === 'match') {
    if (s.week >= SCHEDULE.length - 1) return ['ついに決勝です！ ここまで来たら、あとは思いきりぶつかるだけ！', 'cheer'];
    if (p.cup) return [`今日は${p.label}。負けたら終わり…！ 編成を確かめたら、いざ試合へ！`, 'cheer'];
    return ['今日は練習試合です。負けても大会には出られます。思いきり試しましょう！', 'point'];
  }
  if (last && last.week === s.week - 1) {
    return last.win
      ? [`${OPPONENTS[last.opp]!.name}に勝ちました！ この勢いのまま、もっと強くなりましょう！`, 'sparkle']
      : ['くやしい…！ でも大会はこれからです。練習で取り返しましょう、監督！', 'cry'];
  }
  if (s.week === 0) return ['ようこそ、監督！ まずは練習です。マンツーマンで見てあげると、信頼がぐっと上がりますよ。', 'wave'];
  const near = closestToLearning(s);
  if (near && s.members.filter((m) => !learned(m)).length >= 4) {
    return [`信頼が${TRUST_LEARN}たまると特別作戦を覚えます。いちばん近いのは${shortName(near.id)}（あと${TRUST_LEARN - near.trust}）ですよ。`, 'point'];
  }
  const next = nextMatch(s);
  return [`次の相手は${next ? OPPONENTS[next.opp]!.name : 'まだ先'}。得意を伸ばすか、守りの穴をうめるか…腕の見せどころです！`, 'smile'];
}

function memberLine(s: Season, m: Member): Line {
  const name = shortName(m.id);
  if (!isStarter(s.lineup!, m.id)) return [`${name}はいま控えです。「編成」で、いつでも入れかえられますよ。`, 'think'];
  if (boosted(m)) return [`${name}とはもう、あうんの呼吸ですね。「${hero(m.id).passive}」も強化ずみです！`, 'sparkle'];
  if (learned(m)) return [`${name}の「${hero(m.id).passive}」、試合のここぞで使いましょう！`, 'wink'];
  return [`${name}はあと信頼${TRUST_LEARN - m.trust}で特別作戦を覚えます。マンツーマンが近道ですよ。`, 'point'];
}

function eventLine(changes: Change[]): Line {
  const got = changes.find((c) => c.learnedNow);
  if (got) return [`${shortName(got.id)}が特別作戦「${hero(got.id).passive}」を覚えました！ やりましたね！`, 'cheer'];
  if (changes.some((c) => c.trust < 0)) return ['きびしくするのも監督の仕事…ですよね。さあ、練習です！', 'think'];
  return ['いい判断だと思います！ さあ、今週の練習をはじめましょう。', 'smile'];
}

// ------------------------------------------------------------------ the weekly event: a small scene

function eventScene(s: Season, after: (changes: Change[]) => void): void {
  const e = s.event!;
  const def = eventDef(e.key);
  const [na, nb] = [hero(e.a).name, hero(e.b).name];
  const text = def.text(na, nb);
  // who is in the scene: the heroes the text names, or the whole club
  const cast = text.includes(na) ? (text.includes(nb) ? [e.a, e.b] : [e.a]) : s.members.map((m) => m.id);
  const line = h('p.ev-text');
  const paper = h('div.ev-paper.paper.tape', line);
  const body = h('div.ev-body', { class: `cast${Math.min(cast.length, 3)}` },
    h('div.ev-cast', cast.map((id, i) => portrait(id, { cls: i % 2 ? 'is-turned' : '', color: i % 2 ? '#37e3ff' : '#ffe14a', delay: i * 0.23 }))),
    paper);
  let picked = false;
  const choices = h('div.ev-choices', def.choices.map((c, i) => {
    const slab: HTMLButtonElement = h('button.ev-choice', {
      type: 'button', class: i ? 'is-b' : '', style: { '--i': String(i) },
      onclick: (ev: MouseEvent) => {
        if (picked) return;
        picked = true;
        typing.skip();
        const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(slab);
        sfx.stamp();
        vibrate([18, 30, 26]);
        shake(0.5, 220);
        ring(at.x, at.y, '#ff5a2e', 1.8);
        burst(at.x, at.y, { count: 16, color: ['#ff5a2e', '#ffe14a', '#fffbe8'], shape: ['star', 'rect'] });
        slab.classList.add('is-picked');
        choices.classList.add('is-decided');
        const changes = answerEvent(s, i);
        commit();
        setTimeout(() => {
          if (!scene.isConnected) return;
          sfx.pageTurn();
          const result = h('div.ev-result.panel',
            h('p.ev-picked', h('span.label.hot', 'えらんだ答え'), h('b', c.label)),
            changeList(s, changes),
            h('div.modal-actions', button('OK', () => {
              closeModal();
              after(changes);
            }, { cls: 'go', sound: 'confirm' })));
          body.replaceWith(result);
          choices.remove();
        }, 620);
      },
    },
    h('span.ev-face',
      h('b', c.label),
      h('span.ev-fx', c.note.split('、').map((n) => h('i', { class: n.includes('-') ? 'is-minus bad-mark' : n.includes('信頼') ? 'is-heart' : '' }, n)))),
    h('i.ev-stamp', '決定'));
    return slab;
  }));
  const scene = h('div.ev', { data: { key: e.key } },
    h('div.ev-head', svg(EVENT_ICON[e.key] ?? EVENT_ICON.idea!, 'ev-icon'), h('span.label.hot', '今週のできごと'), h('h2', kinetic(def.title))),
    body, choices);
  modal(scene, { sticky: true, cls: 'scene', quiet: true });
  sfx.event();
  const typing = typewriter(line, text, { cps: 26, onTick: () => sfx.typeTick() });
  paper.addEventListener('click', () => typing.skip());
}

// ------------------------------------------------------------------ the screen

export function clubScreen(): HTMLElement {
  const s = save().season!;
  applyDebug(s);
  const p = plan(s);
  const next = nextMatch(s);
  const matchDay = p.t === 'match';
  const final = matchDay && s.week >= SCHEDULE.length - 1;
  playBgm('club');
  const came = lastWeek;
  const rolling = came !== null && came < s.week && motion();

  const coach = speech('manager');

  // ---- 「優勝への道」: ten stops, a ball on this week's
  const stops = SCHEDULE.map((w, i) => {
    const res = s.results.find((r) => r.week === i);
    const cls = [`is-${w.t}`, i < s.week ? 'is-past' : '', i === s.week && !rolling ? 'is-now' : '', w.t === 'match' && w.cup ? 'is-cup' : ''].join(' ');
    return h('li.stop', { class: cls, style: { '--i': String(i) } },
      w.t === 'train'
        ? [h('i.stop-mark', i < s.week ? '✓' : String(i + 1)), h('span.stop-name', '練習')]
        : [h('span.stop-flag', w.cup ? h('i.stop-hot') : null, w.label.replace('地区大会 ', ''))],
      res ? h('b.stop-pin', { class: `${res.win ? 'is-win' : 'is-lose'} ${rolling && i === came ? 'is-fresh' : ''}` }, `${res.win ? '○' : '●'}${res.us}-${res.them}`) : null);
  });
  const ball = h('div.road-ball', { style: { '--w': String(rolling ? came : s.week) } }, h('i.fball'));
  const road = h('div.road.pad', { 'aria-label': `優勝への道：第${s.week + 1}週` },
    h('span.label.dark', '優勝への道'),
    h('div.road-track',
      h('i.road-line'), h('i.road-done', { style: { '--w': String(rolling ? came : s.week) } }),
      h('ol.road-stops', stops), ball),
    h('span.road-goal', { title: '地区優勝' }, h('i.road-cup'), '優勝'));

  // ---- the seven members in the room
  const order = [...s.members].sort((a, b) => Number(isStarter(s.lineup!, a.id)) - Number(isStarter(s.lineup!, b.id)));
  let opening = false;
  const mate = (m: Member, i: number): HTMLButtonElement => {
    const bench = !isStarter(s.lineup!, m.id);
    const fig = figure(m.id);
    const bubble = h('span.mate-bubble', `${shortName(m.id)}！`);
    const state = boosted(m)
      ? h('span.mate-state.is-on', { title: '特別作戦を強化ずみ' }, '★★ 強化')
      : learned(m)
        ? h('span.mate-state.is-on', { title: '特別作戦を習得ずみ' }, '★ 習得')
        : h('span.mate-state', { title: `信頼${TRUST_LEARN}で特別作戦を覚える` }, svg(LOCK), `${m.trust}/${TRUST_LEARN}`);
    const btn: HTMLButtonElement = h('button.mate', {
      type: 'button', class: `${bench ? 'is-bench' : ''} ${learned(m) ? 'is-learned' : ''}`, style: { '--i': String(i) },
      'aria-label': `${hero(m.id).name}（信頼${m.trust}）`,
      onclick: (ev: MouseEvent) => {
        if (opening) return;
        opening = true;
        sfx.tap();
        vibrate(8);
        const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(fig);
        ring(at.x, at.y);
        burst(at.x, at.y, { count: 6, power: 0.45, size: 0.7, color: ['#ffe14a', '#fffbe8'] });
        kick(fig.querySelector('img'), 'hop');
        kick(btn, 'is-say');
        setTimeout(() => {
          opening = false;
          if (!el.isConnected) return;
          memberModal(s, m);
          whenModalCloses(el, () => coach.say(...memberLine(s, m)));
        }, motion() ? 380 : 60);
      },
    },
    bubble, fig,
    bench ? h('span.mate-seat') : null,
    m.captain ? h('span.mate-cap', '主将') : null,
    bench ? h('span.mate-sub', '控え') : null,
    learned(m) ? h('i.mate-star', boosted(m) ? '★★' : '★') : null,
    h('span.mate-plate',
      h('span.mate-name', shortName(m.id)),
      h('span.mate-trust', gauge(m.trust / TRUST_MAX, { cls: 'trust', marks: [TRUST_LEARN / TRUST_MAX] }), state)));
    return btn;
  };
  const squad = h('div.squad');
  const drawSquad = (): void => squad.replaceChildren(...order.map(mate));
  drawSquad();

  // ---- the next opponent: a poster taped to the wall
  let poster: HTMLElement | null = null;
  let warn: HTMLElement | null = null;
  if (next) {
    const opp = OPPONENTS[next.opp]!;
    const weeks = SCHEDULE.findIndex((w) => w === next) - s.week;
    const studied = matchDay ? scoutedKeys(s) : [];
    const stars = aces(next.opp);
    poster = h('aside.poster', { class: weeks > 0 ? '' : 'is-today', style: { '--oc': opp.color } },
      h('div.poster-in.paper.tape',
        h('div.poster-top',
          h('span.poster-kind', next.label),
          h('span.poster-when', weeks > 0 ? ['あと', h('b', String(weeks)), '週'] : h('b', '今日！'))),
        h('div.poster-vs', h('i', 'VS'), h('h3', opp.name)),
        h('p.poster-style', opp.style),
        h('ul.poster-aces', { class: stars.length > 3 ? 'is-many' : '' }, stars.map((a, i) => h('li', { style: { '--i': String(i) } },
          h('span.ace-face', sprite(a.id)),
          h('span.ace-text', h('b', `「${a.play}」`), h('i', a.tag))))),
        h('span.poster-note', { class: next.cup ? 'is-cup' : '' }, next.cup ? '負けたら終わり' : '負けても大会へ進める')));
    if (studied.length) {
      warn = h('div.scout-warn', { role: 'alert' },
        svg(WARN), h('b', '研究されている！'),
        h('span', `「${studied.map((k) => hero(Number(k)).passive).join('」「')}」は、最初から少し読まれる`));
    }
  }

  // ---- the ways out
  const act = matchDay
    ? button('試合へ', () => {
      vibrate(24);
      storeMatch(null);
      show(...matchScreen());
    }, { cls: 'go big', sound: 'confirm' })
    : button('練習をはじめる', () => show(trainingScreen()), { cls: 'go big', sound: 'confirm' });
  const rerender = (): void => show(clubScreen());

  const el = h('div.screen.club', { class: `${matchDay ? 'is-matchday' : ''} ${final ? 'is-final' : ''}` },
    h('div.room', { 'aria-hidden': 'true' },
      h('div.room-wall'),
      h('div.room-floor'),
      h('div.room-heat'),
      h('div.room-words', h('span', matchDay ? 'GAME DAY ' : 'CLUB ROOM '), h('span', matchDay ? 'GAME DAY ' : 'CLUB ROOM '))),
    h('header.head.pad',
      h('h2', '部室'),
      matchDay ? h('span.label.hot.day-tag', final ? '決勝の日' : '試合の日') : null,
      h('p', `${TEAM_NAME} アメフト部`, h('br'), `第${s.week + 1}週 ／ 全${SCHEDULE.length}週`),
      h('div.row',
        button('設定', settingsModal, 'alt'),
        button('あそびかた', helpModal, 'alt'),
        button('タイトル', () => {
          save().season = s;
          commit();
          show(...titleScreen());
        }, { cls: 'alt', sound: 'back' }))),
    road,
    h('div.club-main.pad',
      h('div.room-stage',
        h('div.room-props', { 'aria-hidden': 'true' },
          h('div.room-lockers', [0, 1, 2, 3].map((i) => h('i', { class: i === 2 ? 'is-ajar' : '' }, h('u'))), h('b.room-helmet')),
          h('div.room-window',
            h('div.room-sky', h('i.room-sun'), h('i.sky-cloud.c1'), h('i.sky-cloud.c2'), h('i.sky-cloud.c3'), h('i.sky-bird.b1'), h('i.sky-bird.b2'), h('i.room-town')),
            h('i.room-sash')),
          h('div.room-pennant', h('span', 'めざせ'), h('b', '地区優勝')),
          h('div.room-board', boardArt(), h('i.room-magnet.m1'), h('i.room-magnet.m2'), h('u', '一芸で勝つ！')),
          h('i.room-light'), h('i.room-motes')),
        warn,
        squad),
      poster),
    h('footer.foot.pad', coach.el, h('div.row', button('編成', () => show(lineupScreen(rerender)), 'alt big'), act)));

  el.addEventListener('shown', () => {
    lastWeek = s.week;
    coach.say(...arriveLine(s));
    idleLife(el, () => [...squad.querySelectorAll<HTMLElement>('.herofig')]);
    let wait = 420;
    if (rolling) {
      wait = 1900;
      const fresh = road.querySelector('.stop-pin.is-fresh');
      if (fresh) {
        setTimeout(() => {
          sfx.stamp();
          const c = center(fresh);
          ring(c.x, c.y, '#fffbe8', 0.8);
        }, 260);
      }
      // the ball rolls on to this week's stop
      setTimeout(() => {
        if (!el.isConnected) return;
        sfx.swap();
        ball.classList.add('is-rolling');
        ball.style.setProperty('--w', String(s.week));
        road.querySelector<HTMLElement>('.road-done')!.style.setProperty('--w', String(s.week));
      }, 560);
      setTimeout(() => {
        if (!el.isConnected) return;
        ball.classList.remove('is-rolling');
        kick(ball, 'is-land');
        stops[s.week]!.classList.add('is-now');
        sfx.tap();
        vibrate(10);
        const c = center(ball);
        ring(c.x, c.y, '#ffe14a', 1.1);
        burst(c.x, c.y + 6, { count: 8, power: 0.4, size: 0.6, color: ['#fffbe8', '#ffe14a'], shape: 'dot' });
      }, 1560);
    }
    if (s.event && p.t === 'train') {
      setTimeout(() => {
        if (!el.isConnected || !s.event) return;
        eventScene(s, (changes) => {
          drawSquad();
          coach.say(...eventLine(changes));
          for (const c of changes) kick(squad.querySelector(`.mate:nth-child(${order.findIndex((m) => m.id === c.id) + 1}) img`), 'hop');
        });
      }, wait);
    } else if (!save().helpSeen) {
      save().helpSeen = true;
      commit();
      setTimeout(() => {
        if (el.isConnected) helpModal();
      }, wait);
    }
  });
  return el;
}

/** The play on the board: O and X in marker, one route that keeps redrawing itself. */
function boardArt(): HTMLElement {
  const box = h('span.room-board-art');
  const o = (x: number, y: number): string => `<circle class="o" cx="${x}" cy="${y}" r="3.4"/>`;
  const x = (cx: number, cy: number): string => `<path class="x" d="M${cx - 3},${cy - 3}l6,6M${cx + 3},${cy - 3}l-6,6"/>`;
  box.innerHTML = `<svg viewBox="0 0 100 56" aria-hidden="true">
    ${[[30, 14], [50, 10], [70, 14], [40, 22], [60, 22]].map(([a, b]) => x(a!, b!)).join('')}
    ${[[22, 36], [40, 36], [50, 36], [60, 36], [78, 36], [50, 46]].map(([a, b]) => o(a!, b!)).join('')}
    <path class="route" pathLength="1" d="M50,46 Q58,44 64,34 T88,8"/>
    <path class="route tip" pathLength="1" d="M80,9 L88,7 L88,16"/>
  </svg>`;
  return box;
}
