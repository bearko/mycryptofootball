// The practice ground: the hub of the season and the practice itself, on one screen.
// Back to front: the ground with the heroes on it, the calendar strip across the top, a small tag pinned to
// every hero, and along the bottom the hand of practice cards (or, on a match day, the opponent and one button).
// One tap on a card plays the day: the heroes run the drill, numbers pop out of them, the calendar slides on.

import { playBgm, sfx, vibrate } from '../core/audio';
import { h, wait } from '../core/dom';
import { commit, save, storeMatch } from '../core/save';
import { hero } from '../game/heroes';
import { STATS, STAT_LABEL, type Stat } from '../game/model';
import {
  SCHEDULE, TEAM_NAME, TRUST_LEARN, TRUST_MAX, XPS, boosted, cardInfo, learned, member, nextMatch, plan, policyOpen, previewTrain,
  scoutedKeys, train, type CardInfo, type Change, type DayPlan, type Member, type Season,
} from '../game/season';
import { OPPONENTS, aces } from '../game/teams';
import { burst, center, flip, kick, motion, pop, ring, shake } from './fx';
import { ICON, XP_GLYPH, icon, shortName, xpChip } from './ground/bits';
import { calendar } from './ground/calendar';
import { makeGround } from './ground/ground';
import { cardLine, drillKind, practiceCard } from './ground/pcard';
import { cutIn, eventScene, type Prize } from './ground/scenes';
import { button, gauge, modalOpen, speech, sprite, statIcon } from './kit';
import { lineupScreen } from './lineupScreen';
import { matchScreen } from './matchScreen';
import { show } from './nav';
import { policyPanel } from './policy';
import { memberModal, settingsModal } from './shared';
import { titleScreen } from './title';

/** The season whose opening meeting has been held (it opens by itself only once). */
let metFor: number | null = null;
/** The day the ground was last seen on: the calendar slides on from there. */
let seen: { seed: number; day: number } | null = null;

type Line = [text: string, pose: string];
interface Pt { x: number; y: number }

/** What the heroes mutter while they warm up, by the ability they are working on. */
const MUTTER: Record<Stat, string[]> = {
  spd: ['もう1本、走ります！', '風になるぞ…！', '足が軽い！'],
  pas: ['ねらって…えいっ！', '肩があったまってきた。', 'いいところに投げますよ。'],
  cat: ['どんな球でも捕るよ！', 'ナイスボール、こい！', '手に吸いつく感じ…！'],
  blk: ['どっしり、かまえる！', '押しまけないぞ！', 'ここは通さん！'],
  tkl: ['つかまえてやる！', 'まっすぐ、ぶつかる！', '次は止める！'],
  iq: ['ふむ、なるほど…。', '次の手を読んでいます。', '作戦どおりにいきましょう。'],
};

const rem = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 12;
const shortLabel = (d: DayPlan): string => d.label.replace('地区大会 ', '');

// ------------------------------------------------------------------ what the manager says

function contextLine(s: Season): Line {
  const p = plan(s);
  const last = s.results[s.results.length - 1];
  if (p.t === 'match') {
    if (s.day >= SCHEDULE.length - 1) return ['ついに決勝です！ ここまで来たら、あとは思いきりぶつかるだけ！', 'cheer'];
    if (p.cup) return [`今日は${shortLabel(p)}。負けたら今年はここまで…！ いざ、試合へ！`, 'cheer'];
    return ['今日は練習試合です。負けても大会には出られます。思いきり試しましょう！', 'point'];
  }
  if (policyOpen(s) && s.day > 0) return ['練習試合、おつかれさまでした！ いまだけ「方針」を見直せます。カードを出すと締め切りです。', 'point'];
  if (last && last.day === s.day - 1) {
    return last.win
      ? [`${OPPONENTS[last.opp]!.name}に勝ちました！ この勢いで、次の試合まで鍛えましょう！`, 'sparkle']
      : ['くやしい…！ でも大会はこれからです。練習で取り返しましょう、監督！', 'cry'];
  }
  if (s.day === 0) return ['下のカードが今日の練習メニュー。1枚えらぶと1日進みます。', 'wave'];
  const next = nextMatch(s);
  if (next && next.n - s.day === 1) return [`あしたは${shortLabel(next)}！ 仕上げの1枚をえらびましょう。`, 'cheer'];
  const near = s.members.filter((m) => !learned(m)).sort((a, b) => b.trust - a.trust)[0];
  if (near && TRUST_LEARN - near.trust <= 12) {
    return [`${shortName(near.id)}はあと信頼${TRUST_LEARN - near.trust}で特別作戦を覚えます。マンツーマンのカードが近道ですよ。`, 'point'];
  }
  if (next) return [`${OPPONENTS[next.opp]!.name}との${shortLabel(next)}まで、あと${next.n - s.day}日。きょうの1枚をどうぞ！`, 'smile'];
  return ['きょうの1枚をえらびましょう！', 'smile'];
}

function prizeLine(id: number, prize: Prize): Line {
  const name = shortName(id);
  if (prize === 'learned') return [`${name}が特別作戦「${hero(id).passive}」を覚えました！ 試合で使えますよ。`, 'cheer'];
  if (prize === 'boosted') return [`${name}の「${hero(id).passive}」がさらに強くなりました！`, 'sparkle'];
  return [`${name}の特別練習が、カードに出てくるようになりました！`, 'sparkle'];
}

const prizesOf = (changes: Change[]): [number, Prize][] => changes.flatMap((c): [number, Prize][] => [
  ...(c.learnedNow ? [[c.id, 'learned'] as [number, Prize]] : []),
  ...(c.boostedNow ? [[c.id, 'boosted'] as [number, Prize]] : []),
  ...(c.drillNow && !c.learnedNow ? [[c.id, 'drill'] as [number, Prize]] : []),
]);

// ------------------------------------------------------------------ the screen

export function clubScreen(): [HTMLElement, () => void] {
  const s = save().season!;
  playBgm('club');
  const ground = makeGround(s);
  const coach = speech('manager');
  coach.el.classList.add('pg-coach');
  const bubble = coach.el.querySelector<HTMLElement>('.bubble')!;
  let alive = true;
  let busy = false;
  /** the card being considered (its uid) */
  let hot: number | null = null;
  let talk = 0;
  let skipNow: (() => void) | null = null;

  // ---- the calendar strip
  const came = seen && seen.seed === s.seed && seen.day < s.day ? seen.day : null;
  const cal = calendar(s);
  cal.set(came === null ? s : { ...s, day: came });

  const policyBtn = button('方針', () => openPolicy(), 'alt');
  const policyTag = h('span.pg-now', 'いまだけ見直せます');
  const drawPolicyBtn = (): void => {
    const on = policyOpen(s) && s.day > 0;
    policyBtn.classList.toggle('is-open', on);
    policyTag.hidden = !on;
  };
  const top = h('header.pg-top',
    h('div.pg-school', h('b', TEAM_NAME), h('span', 'アメフト部')),
    cal.el,
    h('nav.pg-menu',
      button('編成', () => show(lineupScreen(() => show(...clubScreen()))), 'alt'),
      h('span.pg-policy', policyBtn, policyTag),
      button('設定', settingsModal, 'alt'),
      button('タイトル', () => {
        save().season = s;
        commit();
        show(...titleScreen());
      }, { cls: 'alt', sound: 'back' })));

  // ---- a tag pinned to every hero on the ground
  interface Tag { el: HTMLButtonElement; tag: HTMLElement; aim: HTMLElement; state: HTMLElement; fill: HTMLElement; badge: HTMLElement; say: HTMLElement; step: number; home: number; dx: number; bx: number }
  const tags = new Map<number, Tag>();
  const drawTag = (m: Member): void => {
    const t = tags.get(m.id)!;
    t.aim.className = `pg-aim t-${m.focus}`;
    t.aim.replaceChildren(statIcon(m.focus));
    t.aim.title = `方針：${STAT_LABEL[m.focus]}`;
    t.state.className = `pg-state ${learned(m) ? 'is-on' : ''}`;
    t.state.replaceChildren(boosted(m) ? '★★' : learned(m) ? '★' : icon(ICON.lock));
    t.state.title = learned(m) ? '特別作戦を習得ずみ' : `信頼${TRUST_LEARN}で特別作戦を覚える（いま${m.trust}）`;
    t.fill.style.width = `${(m.trust / TRUST_MAX) * 100}%`;
    t.el.setAttribute('aria-label', `${hero(m.id).name}（方針：${STAT_LABEL[m.focus]}、信頼${m.trust}）`);
  };
  const heroes = h('div.pg-heroes', s.members.map((m) => {
    const g = gauge(m.trust / TRUST_MAX, { cls: 'trust', marks: [TRUST_LEARN / TRUST_MAX] });
    const t: Tag = {
      el: h('button.pg-hero', { type: 'button', hidden: true }), tag: h('span.pg-tag'),
      aim: h('span.pg-aim'), state: h('span.pg-state'), fill: g.firstElementChild as HTMLElement, badge: h('span.pg-badge'), say: h('span.pg-say'),
      step: 0, home: 0, dx: 0, bx: 0,
    };
    t.tag.append(h('span.pg-line', t.aim, h('span.pg-name', shortName(m.id)), t.state), g);
    t.el.append(h('span.pg-hit'), t.say, t.badge, t.tag);
    t.el.addEventListener('click', (ev) => {
      if (busy) return;
      sfx.tap();
      vibrate(8);
      const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(t.el);
      ring(at.x, at.y);
      memberModal(s, m);
    });
    tags.set(m.id, t);
    drawTag(m);
    return t.el;
  }));
  let raf = 0;
  /** Every frame: the tags follow their heroes; where two would overlap, the one further back steps down or up. */
  const follow = (): void => {
    raf = requestAnimationFrame(follow);
    const width = root.clientWidth;
    const floor = root.clientHeight - (vs ?? hand).offsetHeight;
    const seenNow: { t: Tag; x: number; y: number; w: number; hh: number }[] = [];
    for (const m of s.members) {
      const t = tags.get(m.id)!;
      const p = ground.pos(m.id);
      if (!p) {
        t.el.hidden = true;
        continue;
      }
      t.el.hidden = false;
      t.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      t.el.style.setProperty('--h', `${Math.round(p.h)}px`);
      t.el.style.zIndex = String(Math.round(p.y));
      seenNow.push({ t, x: p.x, y: p.y, w: t.tag.offsetWidth, hh: t.tag.offsetHeight });
    }
    // nearest heroes keep their natural place
    seenNow.sort((a, b) => b.y - a.y);
    const taken: { l: number; r: number; t: number; b: number }[] = [];
    // the manager's bubble may reach up into the ground: tags keep clear of it
    const base = root.getBoundingClientRect();
    const say = bubble.getBoundingClientRect();
    if (say.top - base.top < floor) taken.push({ l: say.left - base.left, r: say.right - base.left, t: say.top - base.top, b: say.bottom - base.top });
    for (const it of seenNow) {
      const dx = Math.max(4 - (it.x - it.w / 2), Math.min(0, width - 4 - (it.x + it.w / 2)));
      const l = it.x - it.w / 2 + dx;
      const step = it.hh + 3;
      // a hero standing in front of the hand has the tag lifted to the edge of the ground (it follows at once);
      // steps away from another tag are whole tag heights (they ease)
      const home = Math.round(Math.min(0, floor - 4 - it.hh - it.y));
      const free = (n: number): boolean => {
        const top = it.y + home + n * step;
        if (n > 0 && top + it.hh > floor - 2) return false;
        return !taken.some((o) => l < o.r + 4 && o.l < l + it.w + 4 && top < o.b + 2 && o.t < top + it.hh + 2);
      };
      // stay where the tag already is if that is still free: no flicker between two places
      const n = [it.t.step, 0, 1, -1, 2, -2, -3, -4, -5].find(free) ?? 0;
      if (n !== it.t.step || home !== it.t.home || dx !== it.t.dx) {
        it.t.step = n;
        it.t.home = home;
        it.t.dx = dx;
        it.t.tag.style.setProperty('--dy', `${n * step}px`);
        it.t.tag.style.setProperty('--home', `${home}px`);
        it.t.tag.style.setProperty('--dx', `${dx.toFixed(0)}px`);
      }
      taken.push({ l, r: l + it.w, t: it.y + home + n * step, b: it.y + home + n * step + it.hh });
      // what a considered card would give stays on screen too
      if (it.t.badge.classList.contains('is-on')) {
        const bw = it.t.badge.offsetWidth;
        const bx = Math.round(Math.max(4 - (it.x - bw / 2), Math.min(0, width - 4 - (it.x + bw / 2))));
        if (bx !== it.t.bx) {
          it.t.bx = bx;
          it.t.badge.style.setProperty('--bx', `${bx}px`);
        }
      }
    }
  };
  /** Where numbers pop out of a hero: the chest (they rise from there to above the head). */
  const chestOf = (id: number): Pt | null => {
    const p = ground.pos(id);
    return p ? { x: p.x, y: p.y - p.h * 0.6 } : null;
  };

  // ---- considering a card: who would gain what
  const clearBadges = (): void => {
    for (const t of tags.values()) t.badge.classList.remove('is-on');
  };
  const showBadges = (changes: Change[], info: CardInfo, solo: boolean): void => {
    for (const c of changes) {
      const t = tags.get(c.id);
      if (!t) continue;
      const gets = !solo || info.hero === c.id;
      const parts: HTMLElement[] = STATS.filter((k) => c.stats[k]).map((k) => h('i', { class: `t-${k}` }, statIcon(k), `+${c.stats[k]}`, h('u', STAT_LABEL[k])));
      if (c.trust >= 2 || (c.trust > 0 && info.hero === c.id)) parts.push(h('i.is-heart', `♥+${c.trust}`));
      // nothing turns into an ability yet: the experience is being saved up
      if (!parts.length && gets) parts.push(h('i.is-save', { title: '経験がたまる' }, XPS.filter((k) => info.xp[k]).map((k) => xpChip(k, info.xp[k]!))));
      t.badge.replaceChildren(...parts);
      t.badge.classList.toggle('is-on', parts.length > 0);
    }
  };
  const setHot = (uid: number | null): void => {
    if (busy || hot === uid) return;
    hot = uid;
    for (const [id, el] of cardEls) el.classList.toggle('selected', id === uid);
    clearTimeout(talk);
    const i = uid === null ? -1 : s.hand.findIndex((c) => c.uid === uid);
    const card = s.hand[i];
    if (!card) {
      ground.hint(null);
      clearBadges();
      return;
    }
    const info = cardInfo(s, card);
    ground.hint(drillKind(card), info.hero ?? undefined);
    showBadges(previewTrain(s, i), info, card.kind === 'solo');
    talk = window.setTimeout(() => {
      if (alive && hot === uid) coach.say(cardLine(s, card), 'point');
    }, 180);
  };

  // ---- what a hero gets: experience flies in, numbers pop out
  const flyXp = (from: Pt, to: Pt, info: CardInfo): void => {
    if (!motion()) return;
    XPS.filter((k) => info.xp[k]).forEach((k, n) => {
      for (let j = 0; j < 2; j += 1) {
        const el = h('i.pg-xp', { class: `is-${k}` }, XP_GLYPH[k]);
        root.append(el);
        const bend = (Math.random() - 0.5) * rem() * 8;
        const a = el.animate([
          { transform: `translate(${from.x}px, ${from.y}px) scale(0.3)`, opacity: 0 },
          { transform: `translate(${(from.x + to.x) / 2 + bend}px, ${(from.y + to.y) / 2 - rem() * 3}px) scale(1.2) rotate(180deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(0.6) rotate(360deg)`, opacity: 1 },
        ], { duration: 380, delay: n * 45 + j * 80, easing: 'cubic-bezier(.3,0,.3,1)', fill: 'both' });
        a.onfinish = () => el.remove();
      }
    });
  };
  const gain = (c: Change, n: number, from: Pt | null, info: CardInfo | null, loud: boolean): void => {
    const m = member(s, c.id);
    const t = tags.get(c.id);
    const head = chestOf(c.id);
    drawTag(m);
    if (!t || !head) return;
    const u = rem();
    if (from && info) flyXp(from, head, info);
    const stats = STATS.filter((k) => c.stats[k]);
    const lines: [string, string][] = stats.map((k) => [`${c.stats[k]! > 0 ? '+' : ''}${c.stats[k]} ${STAT_LABEL[k]}`, `small pg-pop t-${k}`]);
    if (c.trust >= 2 || c.trust < 0 || (c.trust > 0 && loud)) lines.push([`♥${c.trust > 0 ? '+' : ''}${c.trust}`, `small pg-pop ${c.trust > 0 ? 'is-heart' : 'bad'}`]);
    lines.forEach(([text, cls], j) => setTimeout(() => {
      if (alive) pop(head.x, head.y - j * u * 1.9, text, cls);
    }, (from ? 240 : 0) + j * 110));
    if (stats.length) setTimeout(() => sfx.statUp(n), from ? 240 : 0);
    else if (lines.length) setTimeout(() => sfx.trustUp(), from ? 240 : 0);
    if (lines.length) kick(t.el, 'is-up');
  };

  // ---- the hand of practice cards
  let cardEls = new Map<number, HTMLButtonElement>();
  const cardRow = h('div.pg-cards');
  const handSide = h('div.pg-side', h('b', '練習'), h('span', 'メニュー'), h('i', '1枚で1日'));
  const hand = h('footer.pg-hand', handSide, cardRow);

  const wire = (el: HTMLButtonElement, uid: number): void => {
    let touch = false;
    let inside = false;
    let lastTouch = 0;
    const within = (e: PointerEvent): boolean => {
      const r = el.getBoundingClientRect();
      const pad = rem() * 1.6;
      return e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad * 2;
    };
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') setHot(uid);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && hot === uid) setHot(null);
    });
    // touch: press considers, release on the card plays, sliding off cancels
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || busy) return;
      touch = true;
      inside = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* not every browser lets a button capture */
      }
      sfx.cardPick();
      vibrate(8);
      setHot(uid);
    });
    el.addEventListener('pointermove', (e) => {
      if (!touch) return;
      const now = within(e);
      if (now === inside) return;
      inside = now;
      el.classList.toggle('is-off', !now);
      setHot(now ? uid : null);
    });
    el.addEventListener('pointerup', () => {
      if (!touch) return;
      touch = false;
      lastTouch = performance.now();
      el.classList.remove('is-off');
      if (inside) void play(uid);
      else {
        sfx.back();
        setHot(null);
      }
    });
    el.addEventListener('pointercancel', () => {
      touch = false;
      el.classList.remove('is-off');
      setHot(null);
    });
    el.addEventListener('click', () => {
      if (performance.now() - lastTouch > 600) void play(uid);
    });
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) setHot(uid);
    });
  };

  /** Brings the hand in line with the season: cards that stay keep their element, new ones are dealt in. */
  const drawHand = (deal: 'all' | 'new' | 'none', fresh = false): void => {
    if (fresh) cardEls = new Map();
    const stay = [...cardEls.values()].filter((el) => el.isConnected && !el.classList.contains('is-played'));
    stay.forEach((el) => el.classList.remove('deal'));
    const settle = flip(stay);
    const next = new Map<number, HTMLButtonElement>();
    let dealt = 0;
    s.hand.forEach((card, i) => {
      let el = cardEls.get(card.uid);
      if (!el) {
        el = practiceCard(s, card, i);
        wire(el, card.uid);
        if (deal !== 'none') {
          el.classList.add('deal');
          el.style.setProperty('--i', String(deal === 'all' ? i : dealt));
          const n = deal === 'all' ? i : dealt;
          setTimeout(() => {
            if (alive) sfx.cardDeal(i);
          }, n * 70 + 40);
          dealt += 1;
        }
      } else el.querySelector('.card-key')!.textContent = String(i + 1);
      next.set(card.uid, el);
    });
    cardEls = next;
    cardRow.replaceChildren(...next.values());
    settle();
  };

  // ---- match day: the opponent and one button
  const goMatch = (): void => {
    vibrate(24);
    storeMatch(null);
    show(...matchScreen());
  };
  const vsBanner = (p: DayPlan): HTMLElement => {
    const opp = OPPONENTS[p.opp]!;
    const studied = scoutedKeys(s);
    const stars = aces(p.opp);
    return h('footer.pg-vs', { style: { '--oc': opp.color } },
      studied.length ? h('div.vs-warn', { role: 'alert' }, icon(ICON.warn), h('b', '研究されている！'),
        h('span', `「${studied.map((k) => hero(Number(k)).passive).join('」「')}」は、最初から少し読まれる`)) : null,
      h('div.vs-main',
        h('span.vs-kind', p.label),
        h('div.vs-name', h('i', 'VS'), h('h3', opp.name)),
        h('p.vs-style', opp.style),
        h('span.vs-note', { class: p.cup ? 'is-cup' : '' }, p.cup ? '負けたら今年はここまで' : '負けても大会へ進める')),
      h('ul.vs-aces', { class: stars.length > 3 ? 'is-many' : '' },
        h('li.vs-cap', '要注意のエース'),
        stars.map((a, i) => h('li', { style: { '--i': String(i) } },
          h('span.ace-face', sprite(a.id)),
          h('span.ace-text', h('b', `「${a.play}」`), h('i', a.tag))))),
      h('div.vs-go', button('試合へ', goMatch, { cls: 'go big', sound: 'confirm', key: 'Enter' })));
  };
  let vs: HTMLElement | null = null;

  const root = h('div.screen.club', ground.el, h('div.pg-shade', { 'aria-hidden': 'true' }), heroes, top, hand, coach.el);

  /** Tells the ground how much of it the calendar and the hand cover. */
  const measure = (): void => {
    if (!root.isConnected) return;
    // both bars are pinned to an edge: their heights are what they cover (never mind a slide-in in progress)
    ground.safe(top.offsetHeight, (vs ?? hand).offsetHeight);
  };
  /** Practice day or match day: what sits along the bottom. */
  const drawMode = (deal: 'all' | 'new' | 'none', fresh = false): void => {
    const p = plan(s);
    const match = p.t === 'match';
    root.classList.toggle('is-matchday', match);
    root.classList.toggle('is-final', match && s.day >= SCHEDULE.length - 1);
    if (match) {
      if (!vs) {
        vs = vsBanner(p);
        hand.replaceWith(vs);
      }
    } else {
      if (vs) {
        vs.replaceWith(hand);
        vs = null;
      }
      drawHand(deal, fresh);
    }
    drawPolicyBtn();
    measure();
  };

  // ---- one tap plays the day
  const celebrate = async (changes: Change[]): Promise<void> => {
    for (const [id, prize] of prizesOf(changes)) {
      if (!alive) return;
      coach.say(...prizeLine(id, prize));
      await cutIn(root, s, id, prize);
    }
  };
  const play = async (uid: number): Promise<void> => {
    const i = s.hand.findIndex((c) => c.uid === uid);
    const cardEl = cardEls.get(uid);
    if (busy || i < 0 || !cardEl || s.event || plan(s).t !== 'train' || modalOpen()) return;
    hot = null;
    clearTimeout(talk);
    clearBadges();
    ground.hint(null);
    busy = true;
    root.classList.add('is-busy');
    const from = s.day;
    const card = s.hand[i]!;
    const report = train(s, i);
    commit();
    seen = { seed: s.seed, day: s.day };
    const byId = new Map(report.changes.map((c) => [c.id, c]));
    sfx.cardConfirm();
    vibrate(16);

    // a tap anywhere fast-forwards the turn
    let fast = false;
    const skipped = new Promise<void>((resolve) => {
      skipNow = () => {
        fast = true;
        resolve();
      };
    });
    // (a press, not a click: the click that follows the tap which played the card must not count)
    const veil = h('button.pg-skip', {
      type: 'button', 'aria-label': '早送り',
      onpointerdown: () => {
        sfx.tap();
        skipNow?.();
      },
    });
    root.append(veil);

    // the card flies to the ground
    const box = root.getBoundingClientRect();
    const low = hand.getBoundingClientRect().top - box.top;
    const high = top.getBoundingClientRect().bottom - box.top;
    const spot: Pt = { x: box.width / 2, y: high + (low - high) * 0.5 };
    cardEl.classList.remove('selected');
    if (motion()) {
      const c0 = center(cardEl);
      cardEl.animate([
        { transform: 'translateY(-1.3rem) rotate(-1.5deg)', opacity: 1 },
        { transform: `translate(${spot.x - c0.x}px, ${spot.y - c0.y}px) scale(0.45) rotate(-14deg)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${spot.x - c0.x}px, ${spot.y - c0.y}px) scale(0.2) rotate(-20deg)`, opacity: 0 },
      ], { duration: 260, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' });
      await Promise.race([wait(230), skipped]);
    }
    cardEl.classList.add('is-played');
    if (!alive) return;
    ring(spot.x, spot.y, '#ffe14a', 1.6);
    burst(spot.x, spot.y, { count: 12, color: ['#ffe14a', '#fffbe8', '#ff5a2e'], shape: ['star', 'rect'] });
    coach.say(`「${report.info.name}」、はじめ！`, 'cheer');

    // the drill, with sound on its beats; everyone's share pops out as it lands
    let n = 0;
    const paid = new Set<number>();
    const payoff = (id: number): void => {
      const c = byId.get(id);
      if (!alive || !c || paid.has(id)) return;
      paid.add(id);
      gain(c, n, spot, card.kind !== 'solo' || report.info.hero === id ? report.info : null, report.info.hero === id);
      n += 1;
    };
    if (!fast) {
      // the drill is over when its last beat has landed; the picture may go on settling behind the next card
      let landed: () => void = () => undefined;
      const over = new Promise<void>((resolve) => {
        landed = resolve;
      });
      await Promise.race([
        over,
        ground.drill(drillKind(card), { lead: report.info.hero ?? undefined, speed: 1 }, {
          onEnd: () => landed(),
          onStep: () => sfx.countTick(),
          onThrow: () => sfx.throwBall(false),
          onCatch: () => sfx.catchBall(),
          onImpact: (power) => {
            sfx.impact(power);
            vibrate(12);
            shake(0.22 * power, 140);
          },
          onChalk: () => sfx.chalk(),
          onWhistle: () => sfx.whistle('short'),
          onPayoff: payoff,
        }).catch(() => undefined),
        skipped,
      ]);
    }
    if (!alive) return;
    for (const c of report.changes) payoff(c.id);
    veil.remove();
    skipNow = null;

    // the day passes: the calendar slides, the new card is dealt
    sfx.swap();
    cal.set(s, from);
    drawMode('new');
    await celebrate(report.changes);
    if (!alive) return;
    root.classList.remove('is-busy');
    busy = false;
    arrive(false);
  };

  // ---- the event of the day, the meeting, and what the manager says on arriving
  const openEvent = (): void => {
    if (!alive || !s.event) return;
    eventScene(s, (changes, label) => {
      if (!alive) return;
      coach.say(`「${label}」ですね。${changes.some((c) => c.trust < 0) ? 'きびしくするのも監督の仕事です。' : 'いい判断だと思います！'} さあ、きょうの1枚を。`, 'smile');
      changes.forEach((c, n) => setTimeout(() => {
        if (alive) gain(c, n, null, null, true);
      }, 120 + n * 70));
      for (const m of s.members) drawTag(m);
      setTimeout(() => {
        if (alive) void celebrate(changes);
      }, 500);
    });
  };
  function openPolicy(): void {
    const open = policyOpen(s);
    policyPanel(s, () => {
      if (!alive) return;
      for (const m of s.members) drawTag(m);
      // a one-on-one card trains whatever the policy says: redraw the hand after a meeting
      if (open && plan(s).t === 'train') drawHand('none', true);
      if (open) coach.say(s.day === 0 ? '方針は決まりました！ 下のカードが今日の練習メニュー。1枚えらぶと1日進みます。' : '方針はこれでいきましょう。さあ、きょうの1枚を！', 'wave');
    });
  }
  const arrive = (first: boolean): void => {
    if (!alive) return;
    if (s.event && plan(s).t === 'train') {
      coach.say('おや、グラウンドで何かあったようです。', 'think');
      setTimeout(openEvent, first ? 650 : 350);
      return;
    }
    coach.say(...contextLine(s));
    if (first && policyOpen(s) && s.day === 0 && metFor !== s.seed) {
      metFor = s.seed;
      openPolicy();
    }
  };

  // ---- keys: 1-5 play, arrows consider, Enter plays what is considered
  const onKey = (e: KeyboardEvent): void => {
    if (!alive || modalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    const onButton = document.activeElement instanceof HTMLButtonElement;
    if (busy) {
      if (e.key === 'Enter' || e.key === ' ') skipNow?.();
      return;
    }
    if (plan(s).t !== 'train') {
      if (e.key === 'Enter' && !onButton) goMatch();
      return;
    }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= s.hand.length) {
      e.preventDefault();
      void play(s.hand[n - 1]!.uid);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const at = s.hand.findIndex((c) => c.uid === hot);
      const to = at < 0 ? (e.key === 'ArrowRight' ? 0 : s.hand.length - 1) : (at + (e.key === 'ArrowRight' ? 1 : -1) + s.hand.length) % s.hand.length;
      sfx.hover();
      setHot(s.hand[to]!.uid);
    } else if ((e.key === 'Enter' || e.key === ' ') && hot !== null && !onButton) {
      e.preventDefault();
      void play(hot);
    } else if (e.key === 'Escape') setHot(null);
  };
  window.addEventListener('keydown', onKey);

  // ---- the heroes mutter while they warm up
  let mutter = 0;
  const murmur = (): void => {
    mutter = window.setTimeout(murmur, 3200 + Math.random() * 2600);
    if (!alive || busy || hot !== null || modalOpen() || !motion() || plan(s).t !== 'train') return;
    const m = s.members[Math.floor(Math.random() * s.members.length)]!;
    const t = tags.get(m.id)!;
    const lines = MUTTER[m.focus];
    t.say.textContent = lines[Math.floor(Math.random() * lines.length)]!;
    kick(t.el, 'is-say');
  };

  drawMode('none');
  const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  sizes?.observe(root);

  root.addEventListener('shown', () => {
    measure();
    raf = requestAnimationFrame(follow);
    mutter = window.setTimeout(murmur, 2600);
    if (plan(s).t === 'train') drawHand('all', true);
    if (came !== null) {
      sfx.swap();
      cal.set(s, came);
    }
    seen = { seed: s.seed, day: s.day };
    arrive(true);
  }, { once: true });

  return [root, () => {
    alive = false;
    skipNow?.();
    cancelAnimationFrame(raf);
    clearTimeout(mutter);
    clearTimeout(talk);
    sizes?.disconnect();
    window.removeEventListener('keydown', onKey);
    ground.destroy();
  }];
}
