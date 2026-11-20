// 「練習」 the weekly practice: three lanes of a field at sunset.
// One practice card per group, up to two one-on-one sessions, then a short montage of the drills,
// the list of who gained what, and a reveal for every special play that was learned.

import { playBgm, sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { hero, recruit, specialOf, talentOf } from '../game/heroes';
import { STATS, STAT_LABEL } from '../game/model';
import {
  GROUPS, GROUP_HINT, GROUP_LABEL, GROUP_TRUST, PRACTICE, SOLO_KEYS, SOLO_PER_WEEK, SOLO_TRUST, TRUST_LEARN, TRUST_MAX, boosted, gainOf,
  groupMembers, learned, member, train,
  type Change, type Group, type Member, type PracticeCard, type PracticeKey, type TrainingChoice,
} from '../game/season';
import { playCard, specialText } from './cardView';
import { figure, idleLife, shortName } from './club';
import { burst, center, ease, flash, glitter, kick, kinetic, motion, pop, ring, shake, sparks, tilt, tween, typewriter } from './fx';
import { TALENT_COLOR, button, cheerAt, closeModal, gauge, modal, portrait, speech, sprite, stars, statIcon } from './kit';
import { route } from './nav';
import { changeList, memberModal } from './shared';

type Line = [text: string, pose: string];
interface Pt { x: number; y: number }

const icon = (body: string, cls = ''): HTMLElement => {
  const el = h('i.cico', { class: cls, 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24">${body}</svg>`;
  return el;
};
const WHISTLE = '<circle cx="9" cy="14" r="6"/><circle cx="9" cy="14" r="1.4"/><path d="M13.5 9.5H22v4.5h-7"/><path d="M6 5l1 2M10.5 3.5v2.5"/>';
const ALL = '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>';

/** What a card does for one hero, as the number on the preview. */
const gainText = (m: Member, card: PracticeCard): string =>
  (PRACTICE[card.key].main ? `+${gainOf(m, card)}` : `全+${card.star >= 3 ? 2 : 1}`);

const rem = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 12;
const imgOf = (fig: Element): Element | null => fig.querySelector('img');

export function trainingScreen(): HTMLElement {
  const s = save().season!;
  const deal = s.deal!;
  const week = s.week;
  const choice: TrainingChoice = { groups: { backs: 0, recv: 0, line: 0 }, solo: {} };
  playBgm('club');
  let running = false;

  const coach = speech('manager');
  const soloIds = (): number[] => Object.keys(choice.solo).map(Number);
  const soloLeft = (): number => SOLO_PER_WEEK - soloIds().length;

  // ---- what the manager says
  const hintLine = (): Line => {
    const left = soloLeft();
    const near = s.members.filter((m) => !learned(m) && !choice.solo[m.id]).sort((a, b) => b.trust - a.trust)[0];
    if (left > 0 && near) {
      const need = TRUST_LEARN - near.trust;
      return need <= SOLO_TRUST
        ? [`${shortName(near.id)}はあと信頼${need}で特別作戦を覚えます。マンツーマン（+${SOLO_TRUST}）なら今週とどきますよ！`, 'point']
        : [`特別作戦にいちばん近いのは${shortName(near.id)}（あと${need}）。タップしてマンツーマンにすると信頼 +${SOLO_TRUST}です。`, 'point'];
    }
    if (left > 0) return ['★が多いカードほどよく伸びます。◎は得意な能力のしるし。とくに伸びますよ！', 'smile'];
    return ['準備OKです！ 「練習する」で、今週の練習をはじめましょう。', 'cheer'];
  };

  // ---- the three lanes
  interface Lane {
    g: Group; el: HTMLElement; members: Member[]; cardsEl: HTMLElement;
    cards: HTMLButtonElement[]; gains: HTMLElement[]; runners: Map<number, HTMLButtonElement>; figs: Map<number, HTMLElement>;
  }

  const runner = (m: Member, lane: Lane): HTMLButtonElement => {
    const fig = figure(m.id);
    lane.figs.set(m.id, fig);
    const btn: HTMLButtonElement = h('button.runner', {
      type: 'button', 'aria-label': `${hero(m.id).name}とマンツーマン`,
      onclick: (ev: MouseEvent) => {
        if (running) return;
        sfx.tap();
        const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(fig);
        ring(at.x, at.y);
        kick(imgOf(fig), 'hop');
        soloPicker(m);
      },
    },
    h('span.runner-tag', 'マンツーマン'),
    fig,
    h('span.runner-heart', `♥+${SOLO_TRUST}`),
    learned(m) ? h('i.runner-star', { title: '特別作戦を習得ずみ' }, '★') : null,
    h('span.runner-plate', h('span.runner-name', shortName(m.id)), gauge(m.trust / TRUST_MAX, { cls: 'trust', marks: [TRUST_LEARN / TRUST_MAX] })));
    lane.runners.set(m.id, btn);
    return btn;
  };

  const pcard = (lane: Lane, card: PracticeCard, i: number, n: number): HTMLButtonElement => {
    const p = PRACTICE[card.key];
    const gains = h('span.pc-gains');
    lane.gains.push(gains);
    const small = card.star >= 3 ? 2 : 1;
    const btn: HTMLButtonElement = h('button.pc.is-deal', {
      type: 'button', class: p.main ? `t-${p.main}` : 't-all', style: { '--i': String(n) },
      'aria-label': `${p.name} ★${card.star}：${p.text}`,
      onclick: (ev: MouseEvent) => pick(lane, i, ev),
    },
    h('span.pc-in',
      h('span.pc-band', p.main ? statIcon(p.main) : icon(ALL, 'ticon'), h('span.pc-name', p.name), stars(card.star)),
      h('span.pc-what',
        h('span.pc-main', p.main ? STAT_LABEL[p.main] : '全能力', h('u', '↑')),
        p.sub ? h('span.pc-sub', { class: `t-${p.sub}`, title: `${STAT_LABEL[p.sub]}も少し上がる` }, statIcon(p.sub), `+${small}`) : null,
        h('span.pc-trust', { title: '信頼' }, `♥+${GROUP_TRUST + p.trust}`)),
      gains,
      h('span.card-glare')),
    h('i.pc-stamp', 'これ！'));
    tilt(btn, 7);
    return btn;
  };

  const lanes: Lane[] = GROUPS.map((g, gi) => {
    const lane: Lane = { g, el: h('section.lane', { data: { g } }), members: groupMembers(s, g), cardsEl: h('div.lane-cards'), cards: [], gains: [], runners: new Map(), figs: new Map() };
    lane.cards = deal[g].map((card, i) => pcard(lane, card, i, gi * 3 + i));
    lane.cardsEl.append(...lane.cards);
    lane.el.append(
      h('div.lane-tag', h('span.label', GROUP_LABEL[g]), h('span', GROUP_HINT[g])),
      h('i.lane-no', String(gi + 1)),
      h('div.lane-crew', lane.members.length ? lane.members.map((m) => runner(m, lane)) : h('p.lane-empty', 'だれもいません')),
      lane.cardsEl);
    return lane;
  });
  const allFigs = (): HTMLElement[] => lanes.flatMap((l) => [...l.figs.values()]);
  const figOf = (id: number): HTMLElement | null => {
    for (const l of lanes) if (l.figs.has(id)) return l.figs.get(id)!;
    return null;
  };

  // ---- the one-on-one counter: two whistles that get used up
  const soloBox = h('div.solo-box');
  const drawSolo = (): void => {
    const ids = soloIds();
    soloBox.replaceChildren(
      h('span.solo-cap', h('b', 'マンツーマン'), h('span', soloLeft() > 0 ? `あと${soloLeft()}人` : '今週はここまで')),
      ...Array.from({ length: SOLO_PER_WEEK }, (_, i) => {
        const id = ids[i];
        if (id === undefined) {
          return h('button.solo-whistle', {
            type: 'button', 'aria-label': 'マンツーマンの空き',
            onclick: () => {
              if (running) return;
              sfx.tap();
              allFigs().forEach((f, n) => setTimeout(() => kick(imgOf(f), 'hop'), n * 40));
              coach.say('マンツーマンで見たいヒーローを、タップしてください。', 'point');
            },
          }, h('span', icon(WHISTLE), h('b', 'あき')));
        }
        return h('button.solo-whistle.is-used', {
          type: 'button', 'aria-label': `${hero(id).name}とマンツーマン中`,
          onclick: () => {
            if (running) return;
            sfx.tap();
            soloPicker(member(s, id));
          },
        }, h('span', sprite(id), h('b', PRACTICE[choice.solo[id]!].name)));
      }));
  };

  /** Brings every lane in line with the current choice. */
  const refresh = (): void => {
    for (const lane of lanes) {
      const active = lane.members.filter((m) => !choice.solo[m.id]);
      for (const m of lane.members) lane.runners.get(m.id)!.classList.toggle('is-solo', !!choice.solo[m.id]);
      deal[lane.g].forEach((card, i) => {
        const main = PRACTICE[card.key].main;
        lane.cards[i]!.classList.toggle('is-selected', choice.groups[lane.g] === i);
        lane.gains[i]!.replaceChildren(...(active.length
          ? active.map((m) => {
            const t = talentOf(m.stats);
            const hit = !!main && main === t.best;
            const weak = !!main && main === t.worst;
            return h('i.pc-gain', { class: hit ? 'is-hit' : weak ? 'is-weak' : '', title: `${hero(m.id).name}${hit ? '（得意）' : weak ? '（苦手）' : ''}` },
              sprite(m.id), h('b', hit ? '◎' : '', gainText(m, card)));
          })
          : [h('i.pc-none', 'マンツーマン中')]));
      });
    }
    drawSolo();
  };

  const pick = (lane: Lane, i: number, ev: MouseEvent): void => {
    if (running) return;
    const card = lane.cards[i]!;
    const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(card);
    ring(at.x, at.y);
    if (choice.groups[lane.g] === i) {
      sfx.tap();
      kick(card, 'is-nudge');
      return;
    }
    choice.groups[lane.g] = i;
    sfx.cardPick();
    vibrate(12);
    burst(at.x, at.y, { count: 8, power: 0.5, size: 0.7, color: ['#ffe14a', '#fffbe8', '#ff5a2e'] });
    refresh();
    // the lane answers
    const active = lane.members.filter((m) => !choice.solo[m.id]);
    active.forEach((m, n) => setTimeout(() => kick(imgOf(lane.figs.get(m.id)!), 'hop'), 60 + n * 70));
    const dealt = deal[lane.g][i]!;
    const p = PRACTICE[dealt.key];
    const fan = active.find((m) => p.main && talentOf(m.stats).best === p.main);
    if (fan) coach.say(`「${p.name}」は${shortName(fan.id)}の得意にぴったり！ ぐんと伸びますよ。`, 'sparkle');
    else if (dealt.star >= 3) coach.say(`★3の「${p.name}」ですね。いつもよりよく伸びます！`, 'smile');
    else if (p.trust >= 5) coach.say(`「${p.name}」は能力は少しずつですが、みんなの信頼が上がります。`, 'wink');
  };

  // ---- one-on-one: a whistle-and-clipboard moment
  const soloPicker = (m: Member): void => {
    const has = choice.solo[m.id];
    const can = has !== undefined || soloLeft() > 0;
    const t = talentOf(m.stats);
    const set = (key: PracticeKey | null): void => {
      if (key) choice.solo[m.id] = key;
      else delete choice.solo[m.id];
      closeModal();
      refresh();
      const fig = figOf(m.id)!;
      const btn = fig.closest('.runner');
      if (key) {
        sfx.whistle('short');
        vibrate([12, 40, 16]);
        kick(btn, 'is-step');
        kick(imgOf(fig), 'hop');
        setTimeout(() => {
          if (!root.isConnected) return;
          const c = center(fig);
          ring(c.x, c.y, '#ff5a7a', 1.3);
          pop(c.x, c.y - rem() * 1.5, `♥+${SOLO_TRUST + PRACTICE[key].trust}`, 'small is-heart');
          sfx.trustUp();
        }, 220);
        const left = soloLeft();
        coach.say(left > 0
          ? `${shortName(m.id)}とマンツーマン！ 信頼がぐっと上がります。あと${left}人、見られますよ。`
          : `${shortName(m.id)}とマンツーマン！ これで今週のマンツーマンは2人とも決まりです。`, 'cheer');
      } else {
        sfx.back();
        kick(btn, 'is-step');
        coach.say(...hintLine());
      }
    };
    const need = TRUST_LEARN - m.trust;
    modal(h('div.solo',
      h('div.solo-top',
        portrait(m.id, { color: TALENT_COLOR[t.best] }),
        h('div.solo-say',
          h('h3', `${hero(m.id).name}と ふたりで特訓`),
          h('p', can
            ? `グループ練習の代わりに、監督がつきっきりで見ます。信頼が大きく上がります。`
            : `マンツーマンは週に${SOLO_PER_WEEK}人までです。ほかのヒーローを「グループ練習にもどす」と空きます。`),
          h('div.solo-trust',
            h('span.solo-heart', `♥ 信頼 +${SOLO_TRUST}`), h('span.dim', `（グループ練習は +${GROUP_TRUST}）`),
            gauge(m.trust / TRUST_MAX, { cls: 'trust', marks: [TRUST_LEARN / TRUST_MAX] }),
            h('span', learned(m) ? '★ 特別作戦は習得ずみ' : need <= SOLO_TRUST ? `あと${need}で特別作戦。今週とどく！` : `あと${need}で特別作戦`)))),
      can ? h('div.solo-grid', SOLO_KEYS.map((key, i) => {
        const p = PRACTICE[key];
        const hit = p.main === t.best;
        return h('button.solo-pick', {
          type: 'button', class: `t-${p.main} ${has === key ? 'is-on' : ''}`, style: { '--i': String(i) },
          onclick: () => set(key),
        }, statIcon(p.main!), h('b', p.name), h('span', { class: hit ? 'is-hit' : '' }, `${STAT_LABEL[p.main!]} ${hit ? '◎' : ''}${gainText(m, { key, star: 2 })}`));
      })) : null,
      h('div.modal-actions',
        button('くわしく見る', () => memberModal(s, m), 'alt'),
        has ? button('グループ練習にもどす', () => set(null), 'alt') : null,
        button('とじる', closeModal, { sound: 'back' }))), { title: 'マンツーマン', cls: 'wide' });
  };

  // ---- the montage: every lane does its drill for about two and a half seconds
  const montage = (changes: Change[], picks: Record<Group, number>, solo: Record<number, PracticeKey>): Promise<void> => new Promise((resolve) => {
    const full = motion();
    const u = rem();
    const timers: number[] = [];
    const anims: Animation[] = [];
    const extras: HTMLElement[] = [];
    let over = false;
    const live = (): boolean => !over && root.isConnected;
    const at = (ms: number, f: () => void): void => {
      timers.push(window.setTimeout(() => {
        if (live()) f();
      }, full ? ms : ms * 0.3));
    };
    const move = (el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): void => {
      if (full) anims.push(el.animate(frames, opts));
    };
    const prop = <T extends HTMLElement>(el: T): T => {
      extras.push(el);
      root.append(el);
      return el;
    };
    const end = (): void => {
      if (over) return;
      over = true;
      timers.forEach((t) => clearTimeout(t));
      anims.forEach((a) => a.cancel());
      extras.forEach((e) => e.remove());
      resolve();
    };
    const hop = (fig: Element): void => kick(imgOf(fig), 'hop');
    const spot = (fig: Element): Pt => {
      const r = fig.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.45 };
    };

    root.classList.add('is-drill');
    prop(h('button.drill-skip', {
      type: 'button', 'aria-label': 'スキップ',
      onclick: () => {
        sfx.tap();
        end();
      },
    }, h('span', 'タップでスキップ'))).focus();
    prop(h('div.drill-telop', kinetic(`第${week + 1}週の練習！`)));
    sfx.practice();
    vibrate(20);
    coach.say('ファイトー！', 'cheer');

    /** Throws a ball along an arc; `done` runs on the catch. */
    const toss = (el: HTMLElement, from: Pt, to: Pt, height: number, ms: number, done: () => void): void => {
      el.style.opacity = '1';
      sfx.throwBall(false);
      void tween(ms, (t) => {
        if (!live()) return;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * height;
        el.style.transform = `translate(${x}px, ${y}px) rotate(${t * 540}deg)`;
      }, ease.linear).then(() => {
        if (live()) done();
      });
    };
    const impact = (x: number, y: number, n: number): void => {
      sparks(x, y, '#fff6b0', 14, 0.7);
      burst(x, y, { count: 8, shape: 'star', color: ['#ffe14a', '#ff5a2e', '#fffbe8'], power: 0.65 });
      ring(x, y, '#ff5a2e', 1.2);
      sfx.impact(0.45 + n * 0.2);
      shake(0.3, 160);
      vibrate(14);
    };

    lanes.forEach((lane, li) => {
      const key = deal[lane.g][picks[lane.g]]!.key;
      const figs = lane.members.filter((m) => !solo[m.id]).map((m) => lane.figs.get(m.id)!);
      // the cards not chosen are tossed away; the chosen one parks at the far end of the lane as today's menu
      const chosen = lane.cards[picks[lane.g]]!;
      lane.cards.forEach((c) => c.classList.toggle('is-toss', c !== chosen));
      const zone = lane.cardsEl.getBoundingClientRect();
      const cr = chosen.getBoundingClientRect();
      move(chosen, [{ transform: `translateX(${zone.right - cr.right}px) rotate(2.5deg) scale(0.9)` }], { duration: 380, easing: 'cubic-bezier(.2,1.3,.4,1)', fill: 'forwards' });
      if (!figs.length) return;
      const x1 = zone.right - cr.width - u * 1.2;
      const d0 = 260 + li * 70;

      if (key === 'dash') {
        figs.forEach((f, i) => {
          const r = f.getBoundingClientRect();
          const dx = Math.max(u * 6, x1 - r.right - i * u * 1.4);
          move(f, [
            { transform: 'translateX(0)', easing: 'ease-in' },
            { transform: `translateX(${dx}px) skewX(-10deg)`, offset: 0.42 },
            { transform: `translateX(${dx}px) scaleX(-1)`, offset: 0.5, easing: 'ease-in' },
            { transform: 'translateX(0) scaleX(-1) skewX(-10deg)', offset: 0.92 },
            { transform: 'translateX(0)' },
          ], { duration: 1800, delay: d0 + i * 130 });
          for (let k = 0; k < 12; k += 1) {
            at(d0 + 80 + i * 130 + k * 140, () => {
              const b = f.getBoundingClientRect();
              burst(b.left + b.width / 2, b.bottom - u * 0.3, { count: 3, power: 0.22, gravity: 0.1, size: 0.6, life: 0.8, shape: 'dot', color: ['#f3e3b0', '#cdbb86'] });
              if (k % 3 === 0) sfx.countTick();
            });
          }
        });
      } else if (key === 'pass' || key === 'catch') {
        const a = figs[0]!;
        const b = figs.length > 1 ? figs[figs.length - 1]! : null;
        const pa = spot(a);
        let pb: Pt = { x: pa.x, y: pa.y - u * 0.5 };
        if (b) {
          const rb = b.getBoundingClientRect();
          const dx = Math.max(u * 4, Math.min(x1 - rb.right, u * 22));
          pb = { x: rb.left + rb.width / 2 + dx, y: pa.y };
          move(b, [{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)`, offset: 0.13 }, { transform: `translateX(${dx}px)`, offset: 0.88 }, { transform: 'translateX(0)' }],
            { duration: 2200, delay: d0 - 100, easing: 'ease-in-out' });
        }
        const el = prop(h('i.fball.drill-ball'));
        [0, 1, 2, 3].forEach((n) => at(d0 + 300 + n * 470, () => {
          const [from, to, who] = n % 2 ? [pb, pa, a] : [pa, pb, b ?? a];
          toss(el, from, to, b ? u * 4.2 : u * 5.5, 400, () => {
            sfx.catchBall();
            hop(who);
            ring(to.x, to.y, '#fffbe8', 0.8);
            if (n === 3) el.style.opacity = '0';
          });
        }));
      } else if (key === 'hit' || key === 'tackle') {
        const a = figs[0]!;
        const ra = a.getBoundingClientRect();
        const hits = [0.286, 0.524, 0.762];
        const total = 2100;
        const lunge = (base: number, dir: number, len: number): Keyframe[] => [
          { transform: 'translateX(0)' },
          { transform: `translateX(${base}px)`, offset: 0.14 },
          ...hits.flatMap((t) => [
            { transform: `translateX(${base - dir * u}px) rotate(${-dir * 6}deg)`, offset: t - 0.07, easing: 'ease-in' },
            { transform: `translateX(${base + dir * len}px) rotate(${dir * 10}deg)`, offset: t },
            { transform: `translateX(${base}px)`, offset: t + 0.1 },
          ]),
          { transform: `translateX(${base}px)`, offset: 0.9 },
          { transform: 'translateX(0)' },
        ];
        let meet: Pt;
        let pad: HTMLElement | null = null;
        if (figs.length > 1) {
          const b = figs[1]!;
          const rb = b.getBoundingClientRect();
          const out = Math.max(u * 3, Math.min(x1 - rb.right, u * 10));
          const gap = rb.left + out - ra.right;
          const len = gap / 2 + u * 0.9;
          move(a, lunge(0, 1, len), { duration: total, delay: d0 });
          move(b, lunge(out, -1, len), { duration: total, delay: d0 });
          meet = { x: ra.right + gap / 2, y: ra.top + ra.height * 0.5 };
        } else {
          const len = u * 4.6;
          pad = prop(h('i.drill-pad', { style: { left: `${ra.right + len - u * 0.9}px`, top: `${ra.top + ra.height * 0.08}px` } }));
          move(a, lunge(0, 1, len), { duration: total, delay: d0 });
          meet = { x: ra.right + len - u * 0.9, y: ra.top + ra.height * 0.5 };
        }
        hits.forEach((t, n) => at(d0 + t * total, () => {
          impact(meet.x, meet.y, n);
          pad?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(16deg) translateX(0.5rem)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(0)' }], { duration: 360 });
          if (figs[2]) hop(figs[2]);
        }));
      } else if (key === 'study') {
        const last = figs[figs.length - 1]!.getBoundingClientRect();
        const laneBox = lane.el.getBoundingClientRect();
        const board = prop(h('div.drill-board', { style: { left: `${last.right + u * 2.5}px`, top: `${laneBox.top + u * 0.9}px`, height: `${laneBox.height - u * 1.6}px` } }));
        board.innerHTML = `<svg viewBox="0 0 100 50" aria-hidden="true">
          <path class="x" d="M18,10l6,6M24,10l-6,6M44,8l6,6M50,8l-6,6M70,10l6,6M76,10l-6,6"/>
          <circle class="o" cx="22" cy="36" r="4"/><circle cx="47" cy="38" r="4" class="o"/><circle class="o" cx="72" cy="36" r="4"/>
          <path class="go draw" pathLength="1" d="M47,34 Q52,20 80,22 T92,6"/>
          <path class="go draw d2" pathLength="1" d="M22,32 Q24,24 36,22"/>
        </svg>`;
        for (let k = 0; k < 4; k += 1) at(d0 + 250 + k * 380, () => sfx.chalk());
        figs.forEach((f, i) => {
          at(d0 + 500 + i * 160, () => hop(f));
          at(d0 + 1300 + i * 160, () => hop(f));
        });
        at(d0 + 1150, () => {
          const c = spot(figs[0]!);
          pop(c.x, c.y - u * 1.8, 'ひらめいた！', 'small cool');
        });
      } else {
        // the mini game: everyone bounces, the ball goes round
        figs.forEach((f, i) => move(f, [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${u * 1.1}px, ${-u * 1.5}px) rotate(7deg)` },
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-u * 0.7}px, ${-u * 1.1}px) rotate(-7deg)` },
          { transform: 'translate(0, 0)' },
        ], { duration: 540, iterations: 4, delay: d0 + i * 110, easing: 'ease-in-out' }));
        const el = prop(h('i.fball.drill-ball'));
        const pts = figs.map(spot);
        if (pts.length === 1) pts.push({ x: pts[0]!.x + u * 5, y: pts[0]!.y });
        [0, 1, 2, 3, 4].forEach((n) => at(d0 + 250 + n * 390, () => {
          const from = pts[n % pts.length]!;
          const to = pts[(n + 1) % pts.length]!;
          toss(el, from, to, u * 3.6, 330, () => {
            sfx.catchBall();
            burst(to.x, to.y, { count: 5, power: 0.4, size: 0.6, color: ['#ffe14a', '#37e3ff', '#ff5a7a'], shape: 'star' });
            if (n === 4) el.style.opacity = '0';
          });
        }));
      }
    });

    // the heroes with the coach: a whistle, a hop, a heart
    Object.keys(solo).map(Number).forEach((id, n) => {
      const fig = figOf(id);
      if (!fig) return;
      [500, 1100, 1700].forEach((t) => at(t + n * 150, () => hop(fig)));
      at(700 + n * 200, () => sfx.whistle('short'));
    });

    // numbers fly off everyone, on a rising scale
    changes.forEach((c, n) => {
      const fig = figOf(c.id);
      if (!fig) return;
      const best = STATS.filter((k) => c.stats[k]).sort((x, y) => c.stats[y]! - c.stats[x]!)[0];
      at(950 + n * 150, () => {
        const p = spot(fig);
        if (best) {
          pop(p.x, p.y - u * 1.6, `${STAT_LABEL[best]}+${c.stats[best]}`, 'small');
          glitter(p.x, p.y, TALENT_COLOR[best], 4);
        }
        sfx.statUp(n);
      });
      if (solo[c.id] || c.trust >= 5) {
        at(1650 + n * 90, () => {
          const p = spot(fig);
          pop(p.x, p.y - u * 1.6, `♥+${c.trust}`, 'small is-heart');
          sfx.trustUp();
        });
      }
    });
    at(2350, () => sfx.whistle('long'));
    at(2800, end);
  });

  // ---- a special play learned: the foil card flips in beside its hero
  const reveal = (c: Change, last: boolean, next: () => void): void => {
    const m = member(s, c.id);
    const r = recruit(c.id);
    const sp = specialOf(c.id, r.kind, boosted(m));
    const color = TALENT_COLOR[talentOf(m.stats).best];
    const card = playCard({ type: 'inside', star: 1, special: sp }, 'off', { read: 0 });
    const holder = h('div.rv-card', h('div.rv-flip', card));
    const line = h('p.rv-line');
    let ready = false;
    const go = (): void => {
      if (!ready) return;
      ready = false;
      closeModal();
      next();
    };
    const scene = h('div.rv', { onclick: go },
      h('i.rv-rays'),
      holder,
      h('div.rv-side',
        h('div.rv-who', portrait(c.id, { color }), h('div',
          h('span.label.hot', c.learnedNow ? '特別作戦を覚えた！' : '特別作戦がパワーアップ！'),
          h('h3', hero(c.id).name))),
        h('h2', kinetic(`「${sp.name}」`)),
        line,
        h('p.rv-what', specialText(sp)),
        h('div.modal-actions', button(last ? 'OK' : 'つぎへ', go, { cls: 'go', sound: 'confirm' }))));
    modal(scene, { sticky: true, cls: 'scene', quiet: true });
    sfx.cardFlip();
    setTimeout(() => {
      if (!scene.isConnected) return;
      sfx.learn();
      flash('#ffe14a', 260, 0.45);
      vibrate([20, 40, 30, 40, 60]);
      cheerAt(holder, color);
      const p = center(holder);
      glitter(p.x, p.y, '#ffe14a', 22);
      glitter(p.x, p.y, '#37e3ff', 10);
      void typewriter(line, `「${r.line}」`, { cps: 30, onTick: () => sfx.typeTick() });
    }, motion() ? 480 : 60);
    setTimeout(() => {
      ready = true;
    }, 700);
  };

  const results = (changes: Change[]): void => {
    const news = changes.filter((c) => c.learnedNow || c.boostedNow);
    const after = (i: number): void => {
      const c = news[i];
      if (!c) {
        route();
        return;
      }
      sfx.pageTurn();
      reveal(c, i === news.length - 1, () => after(i + 1));
    };
    modal(h('div.results',
      changeList(s, changes),
      h('div.modal-actions', button(news.length ? 'つぎへ' : 'OK', () => {
        closeModal();
        after(0);
      }, { cls: 'go', sound: 'confirm' }))), { sticky: true, cls: 'wide', title: `第${week + 1}週 練習の成果` });
  };

  const run = (): void => {
    if (running) return;
    running = true;
    root.classList.add('is-busy');
    closeModal();
    const picks = { ...choice.groups };
    const solo = { ...choice.solo };
    const changes = train(s, choice);
    commit();
    void montage(changes, picks, solo).then(() => {
      if (root.isConnected) results(changes);
    });
  };

  // ---- the screen
  const root = h('div.screen.training',
    h('div.tfield', { 'aria-hidden': 'true' },
      h('div.tfield-sky', h('i.tfield-sun'), h('i.sky-cloud.c1'), h('i.sky-cloud.c2'), h('i.sky-cloud.c3'), h('i.sky-bird.b1'), h('i.sky-bird.b2'), h('i.tfield-far')),
      h('div.tfield-turf'),
      h('div.tfield-words', h('span', 'PRACTICE '), h('span', 'PRACTICE '))),
    h('header.head.pad',
      h('h2', '練習'),
      h('p', `第${week + 1}週：グループごとに練習カードを1枚えらぶ。`, h('br'), 'ヒーローをタップすると、マンツーマンで特訓'),
      soloBox),
    h('div.lanes.pad', lanes.map((l) => l.el)),
    h('footer.foot.pad', coach.el, h('div.row', button('もどる', route, { cls: 'alt big', sound: 'back' }), button('練習する', run, { cls: 'go big', sound: 'confirm' }))));
  refresh();

  root.addEventListener('shown', () => {
    root.classList.add('is-live');
    lanes.forEach((_, gi) => [0, 1, 2].forEach((i) => setTimeout(() => {
      if (root.isConnected && !running) sfx.cardDeal(gi * 3 + i);
    }, (gi * 3 + i) * 65)));
    coach.say(...hintLine());
    idleLife(root, allFigs);
  });
  return root;
}
