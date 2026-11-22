// Moments that take the stage for a second or two: the club event (two answers, one tap), the manager's question
// of where the summer camp is to be (one tap), and the cut-in when a special play or a special drill is won. Neither waits for an OK.

import { sfx, vibrate } from '../../core/audio';
import { h } from '../../core/dom';
import { commit } from '../../core/save';
import { hero, recruit, specialOf, talentOf } from '../../game/heroes';
import { CAMP_KEYS, CAMP_SITE, type CampKey } from '../../game/funds';
import { DRILL_NAME, answerEvent, campPrice, moneyOf, setCamp, boosted, eventDef, member, type Change, type Season } from '../../game/season';
import { playCard } from '../cardView';
import { burst, center, flash, glitter, kinetic, motion, ring, shake, typewriter } from '../fx';
import { TALENT_COLOR, charPose, cheerAt, closeModal, modal, portrait } from '../kit';
import { ICON, icon } from './bits';
import { practiceCard } from './pcard';

const EVENT_ICON: Record<string, string> = {
  late: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  quarrel: '<path d="M12 2l2.4 6.2L21 6l-3.6 5.6L22 16l-6.6.2L14 22l-3-5-5.6 2.6 1.8-6L2 10l6.4-.6z"/>',
  gift: '<path d="M12 3c2 0 9 12 9 15s-3 3-9 3-9 0-9-3 7-15 9-15z"/><path d="M8.5 21v-6h7v6"/>',
  rain: '<path d="M6 14a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 18 6.5a4 4 0 0 1 0 7.5z"/><path d="M8 17l-1 3M12.5 17l-1 3M17 17l-1 3"/>',
  idea: '<path d="M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-.8.8-1 1.6-1 2.5H9c0-.9-.2-1.7-1-2.5z"/>',
  slump: '<path d="M6 16a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 18 8.5a4 4 0 0 1 0 7.5z"/><path d="M9 20h6"/>',
};

/**
 * Today's event as a small scene over the ground: the heroes involved, the text typing itself, two big answers.
 * One tap answers; the scene stamps the answer and closes itself, then `after` gets what changed.
 */
export function eventScene(s: Season, after: (changes: Change[], label: string) => void): void {
  const e = s.event!;
  const def = eventDef(e.key);
  const [na, nb] = [hero(e.a).name, hero(e.b).name];
  const text = def.text(na, nb);
  // who is in the scene: the heroes the text names, or the whole club
  const cast = text.includes(na) ? (text.includes(nb) ? [e.a, e.b] : [e.a]) : s.members.map((m) => m.id);
  const line = h('p.ev-text');
  const paper = h('div.ev-paper.paper.tape', line);
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
          closeModal();
          after(changes, c.label);
        }, motion() ? 520 : 200);
      },
    },
    h('span.ev-face',
      h('b', c.label),
      h('span.ev-fx', c.note.split('、').map((n) => h('i', { class: n.includes('-') ? 'is-minus bad-mark' : n.includes('信頼') ? 'is-heart' : '' }, n)))),
    h('i.ev-stamp', '決定'));
    return slab;
  }));
  const scene = h('div.ev', { data: { key: e.key } },
    h('div.ev-head', icon(EVENT_ICON[e.key] ?? EVENT_ICON.idea!, 'ev-icon'), h('span.label.hot', 'きょうのできごと'), h('h2', kinetic(def.title))),
    h('div.ev-body', { class: `cast${Math.min(cast.length, 3)}` },
      h('div.ev-cast', cast.map((id, i) => portrait(id, { cls: i % 2 ? 'is-turned' : '', color: i % 2 ? '#37e3ff' : '#ffe14a', delay: i * 0.23 }))),
      paper),
    choices);
  modal(scene, { sticky: true, cls: 'scene', quiet: true });
  sfx.event();
  const typing = typewriter(line, text, { cps: 30, onTick: () => sfx.typeTick() });
  paper.addEventListener('click', () => typing.skip());
}

const CAMP_ICON = '<path d="M3 20h18M5 20l7-14 7 14M12 6v14M9 20l3-5 3 5"/>';

/** What a camp at a place does, as the chips under its name. */
export function campNotes(s: Season, k: CampKey): { text: string; bad: boolean }[] {
  const site = CAMP_SITE[k];
  const price = campPrice(s, k);
  return [
    { text: price ? `部費 ${price}万円` : '費用なし', bad: price > 0 },
    { text: `練習の効果 ${site.xp}倍`, bad: false },
    ...(site.sta < CAMP_SITE.school.sta ? [{ text: '疲れにくい', bad: false }] : []),
  ];
}

/**
 * The manager asks where the summer camp is to be: the places side by side, what each costs and does. One tap
 * decides (a place the money does not reach does not take the tap); the scene stamps it and closes itself.
 */
export function campScene(s: Season, after: (k: CampKey) => void): void {
  const line = h('p.ev-text');
  const paper = h('div.ev-paper.paper.tape', line);
  let picked = false;
  const choices = h('div.ev-choices.is-camp', CAMP_KEYS.map((k, i) => {
    const site = CAMP_SITE[k];
    const short = moneyOf(s) < campPrice(s, k);
    const slab: HTMLButtonElement = h('button.ev-choice', {
      type: 'button', class: `${i % 2 ? 'is-b' : ''} ${short ? 'is-off' : ''}`, style: { '--i': String(i) },
      'aria-label': `${site.name}：${campNotes(s, k).map((n) => n.text).join('、')}${short ? '（部費が足りません）' : ''}`,
      onclick: (ev: MouseEvent) => {
        if (picked) return;
        if (short || !setCamp(s, k)) {
          sfx.deny();
          slab.classList.remove('is-deny');
          void slab.offsetWidth;
          slab.classList.add('is-deny');
          return;
        }
        picked = true;
        typing.skip();
        const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : center(slab);
        sfx.stamp();
        vibrate([18, 30, 26]);
        ring(at.x, at.y, '#ff5a2e', 1.8);
        burst(at.x, at.y, { count: 16, color: ['#ff5a2e', '#ffe14a', '#fffbe8'], shape: ['star', 'rect'] });
        slab.classList.add('is-picked');
        choices.classList.add('is-decided');
        commit();
        setTimeout(() => {
          closeModal();
          after(k);
        }, motion() ? 520 : 200);
      },
    },
    h('span.ev-face',
      h('b', site.name),
      h('small.ev-what', site.what),
      h('span.ev-fx', campNotes(s, k).map((n) => h('i', { class: n.bad ? 'is-minus is-cost' : '' }, n.text)))),
    h('i.ev-stamp', '決定'));
    return slab;
  }));
  const text = `7月がおわると、いよいよ夏合宿です！ どこで合宿しますか？ 部費はいま${moneyOf(s)}万円です。`;
  const scene = h('div.ev.is-camp',
    h('div.ev-head', icon(CAMP_ICON, 'ev-icon'), h('span.label.hot', 'マネージャーから'), h('h2', kinetic('夏合宿の行き先'))),
    h('div.ev-body.cast1',
      h('div.ev-cast', h('span.ev-mgr', h('img', { src: charPose('manager', 'point'), alt: '', draggable: false }))),
      paper),
    choices);
  modal(scene, { sticky: true, cls: 'scene', quiet: true });
  sfx.event();
  const typing = typewriter(line, text, { cps: 30, onTick: () => sfx.typeTick() });
  paper.addEventListener('click', () => typing.skip());
}

export type Prize = 'learned' | 'boosted' | 'drill';

/**
 * The short celebration when trust pays off: the foil card flips in beside its hero and leaves by itself
 * (about 1.6 s; a tap skips it). Resolves when it has gone.
 */
export function cutIn(host: HTMLElement, s: Season, id: number, prize: Prize): Promise<void> {
  return new Promise((resolve) => {
    const m = member(s, id);
    const r = recruit(id);
    const talent = talentOf(r.stats).best;
    const color = TALENT_COLOR[talent];
    const sp = specialOf(id, r.kind, boosted(m));
    const card = prize === 'drill'
      ? practiceCard(s, { uid: -1, kind: 'special', hero: id }, 0)
      : playCard({ type: 'inside', star: 1, special: sp }, 'off', { read: 0 });
    const holder = h('div.ci-card', h('div.ci-flip', card));
    const title = prize === 'drill' ? `特別練習「${DRILL_NAME[talent]}」` : `「${sp.name}」`;
    const tag = prize === 'learned' ? '特別作戦を覚えた！' : prize === 'boosted' ? '特別作戦がパワーアップ！' : '特別練習のカードが出るように！';
    let over = false;
    const end = (): void => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 200);
      resolve();
    };
    const el = h('button.ci', { type: 'button', class: `is-${prize}`, style: { '--tc': color }, 'aria-label': `${hero(id).name}：${tag}`, onclick: end },
      h('i.ci-rays'),
      holder,
      h('span.ci-side',
        h('span.ci-who', portrait(id, { color }), h('span', h('span.label.hot', tag), h('b', hero(id).name))),
        h('strong', kinetic(title)),
        h('em', prize === 'drill' ? `信頼がたまって、${hero(id).name}が自分の練習を教えてくれる。` : `「${r.line}」`)),
      prize === 'drill' ? icon(ICON.whistle, 'ci-mark') : null);
    host.append(el);
    const timer = window.setTimeout(end, motion() ? 1750 : 1100);
    sfx.cardFlip();
    setTimeout(() => {
      if (over) return;
      sfx.learn();
      flash('#ffe14a', 240, 0.4);
      vibrate([20, 40, 30]);
      cheerAt(holder, color);
      const p = center(holder);
      glitter(p.x, p.y, '#ffe14a', 18);
    }, motion() ? 380 : 40);
  });
}
