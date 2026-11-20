// The parts every screen is built from: slanted buttons, hero portraits, ability icons and the radar,
// gauges, the talking manager, pop-ups, the ticker and the living background.

import catalog from '../generated/catalog.json';
import { setMuffled, sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { hero, talentOf } from '../game/heroes';
import { STATS, STAT_LABEL, type Stat, type Stats } from '../game/model';
import { TRUST_BOOST, TRUST_LEARN, TRUST_MAX } from '../game/season';
import { burst, center, kick, ring, tween, typewriter, type Typing } from './fx';

const CHARS = catalog.chars as Record<string, string>;

// ------------------------------------------------------------------ buttons

export interface BtnOpts { cls?: string; key?: string; quiet?: boolean; sound?: 'tap' | 'back' | 'confirm' }

/** A slanted slab button. Every press answers with a sound, a ring and a few sparks. */
export function button(label: string | Node | (string | Node)[], onclick: (e: MouseEvent) => void, opts: BtnOpts | string = {}): HTMLButtonElement {
  const o: BtnOpts = typeof opts === 'string' ? { cls: opts } : opts;
  const btn: HTMLButtonElement = h('button.btn', {
    class: o.cls ?? '', type: 'button',
    onclick: (e: MouseEvent) => {
      if (btn.classList.contains('off')) {
        sfx.deny();
        kick(btn, 'nope');
        return;
      }
      if (!o.quiet) {
        if (o.sound === 'back') sfx.back();
        else if (o.sound === 'confirm') sfx.cardConfirm();
        else sfx.tap();
      }
      const c = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : center(btn);
      ring(c.x, c.y);
      burst(c.x, c.y, { count: 7, power: 0.5, size: 0.7, color: ['#ffe14a', '#fffbe8', '#ff5a2e'] });
      onclick(e);
    },
  }, h('span.btn-face', label, o.key ? h('span.key', o.key) : null));
  return btn;
}

let hoverAt = 0;
/** Hover ticks for every button, wired once for the whole page (mouse only). */
export function wireHover(): void {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = (e.target as Element | null)?.closest?.('button');
    const from = (e.relatedTarget as Element | null)?.closest?.('button');
    if (!t || t === from) return;
    const now = performance.now();
    if (now - hoverAt < 50) return;
    hoverAt = now;
    if (t.classList.contains('card')) sfx.cardHover();
    else sfx.hover();
  });
}

// ------------------------------------------------------------------ heroes

/** A hero's sprite on a halftone sun, breathing. */
export function portrait(id: number, opts: { cls?: string; color?: string; delay?: number } = {}): HTMLElement {
  return h('div.portrait', { class: opts.cls ?? '', style: { '--pc': opts.color ?? '', '--d': `${-(opts.delay ?? (id % 7) * 0.2)}s` } },
    h('img', { src: hero(id).img, alt: '', draggable: false }));
}

/** A bare sprite (no backdrop). */
export const sprite = (id: number, cls = ''): HTMLImageElement => h('img.px', { class: cls, src: hero(id).img, alt: '', draggable: false });

const ICON: Record<Stat, string> = {
  spd: '<path d="M3 5l7 7-7 7M12 5l7 7-7 7"/>',
  pas: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  cat: '<path d="M4 9v4a8 8 0 0 0 16 0V9"/><circle cx="12" cy="7" r="3"/>',
  blk: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  tkl: '<path d="M12 2l2.6 5.6L21 6l-2.4 6 4.4 4-6.4.8L15 23l-3-5-3 5-1.6-6.2L1 16l4.4-4L3 6l6.4 1.6z"/>',
  iq: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
export const TALENT_COLOR: Record<Stat, string> = { spd: '#ffe14a', pas: '#37e3ff', cat: '#9dff5c', blk: '#ff9a3d', tkl: '#ff5a7a', iq: '#b69bff' };

export function statIcon(k: Stat): HTMLElement {
  const el = h('span.ticon', { class: `t-${k}` });
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  return el;
}

/** The chip that names a hero's one great ability (colour + icon + word). */
export function talentChip(stats: Stats): HTMLElement {
  const { best } = talentOf(stats);
  const el = h('span.talent', { class: `t-${best}` });
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[best]}</svg>`;
  el.append(STAT_LABEL[best]);
  return el;
}

export interface Radar { el: HTMLElement; set: (stats: Stats, was?: Stats) => void }

/** The six abilities as a hexagon that morphs when the hero changes. */
export function radar(initial: Stats, was?: Stats): Radar {
  const R = 40;
  const pt = (i: number, v: number): [number, number] => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return [50 + Math.cos(a) * R * v, 46 + Math.sin(a) * R * v];
  };
  const poly = (vals: number[]): string => vals.map((v, i) => pt(i, v).map((n) => n.toFixed(2)).join(',')).join(' ');
  const el = h('div.radar');
  el.innerHTML = `<svg viewBox="0 0 100 92" aria-hidden="true">
    ${[0.33, 0.66, 1].map((k) => `<polygon class="web" points="${poly(STATS.map(() => k))}"/>`).join('')}
    ${STATS.map((_, i) => `<line class="axis" x1="50" y1="46" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}"/>`).join('')}
    <polygon class="was"/><polygon class="shape"/>
    ${STATS.map(() => '<circle class="dot" r="1.6"/>').join('')}
  </svg>`;
  const shape = el.querySelector<SVGPolygonElement>('.shape')!;
  const wasEl = el.querySelector<SVGPolygonElement>('.was')!;
  const dots = [...el.querySelectorAll<SVGCircleElement>('.dot')];
  const tags = STATS.map((k, i) => {
    const [x, y] = pt(i, 1.3);
    const tag = h('div.radar-tag', { class: `t-${k}`, style: { left: `${x}%`, top: `${(y / 92) * 100}%` } }, h('b', statIcon(k), h('span.radar-num', '0'), h('u')), STAT_LABEL[k]);
    el.append(tag);
    return tag;
  });
  let cur = STATS.map(() => 0);
  const draw = (vals: number[]): void => {
    shape.setAttribute('points', poly(vals));
    vals.forEach((v, i) => {
      const [x, y] = pt(i, v);
      dots[i]!.setAttribute('cx', String(x));
      dots[i]!.setAttribute('cy', String(y));
    });
  };
  const set = (stats: Stats, before?: Stats): void => {
    const { best } = talentOf(stats);
    el.style.setProperty('--rc', TALENT_COLOR[best]);
    const from = cur;
    const to = STATS.map((k) => 0.12 + (stats[k] / 100) * 0.88);
    cur = to;
    void tween(420, (t) => draw(to.map((v, i) => from[i]! + (v - from[i]!) * t)));
    wasEl.setAttribute('points', before ? poly(STATS.map((k) => 0.12 + (before[k] / 100) * 0.88)) : '');
    STATS.forEach((k, i) => {
      const tag = tags[i]!;
      tag.classList.toggle('best', k === best);
      tag.querySelector('.radar-num')!.textContent = String(stats[k]);
      const d = before ? stats[k] - before[k] : 0;
      tag.querySelector('u')!.textContent = d > 0 ? `+${d}` : '';
    });
  };
  set(initial, was);
  return { el, set };
}

/** A slanted gauge with optional tick marks (0..1 positions). */
export function gauge(value: number, opts: { cls?: string; marks?: number[]; color?: string } = {}): HTMLElement {
  return h('div.gauge', { class: opts.cls ?? '', style: { '--gc': opts.color ?? '' } },
    h('i', { style: { width: `${Math.max(0, Math.min(1, value)) * 100}%` } }),
    (opts.marks ?? []).map((m) => h('b', { style: { left: `${m * 100}%` } })));
}

export const trustGauge = (trust: number): HTMLElement =>
  gauge(trust / TRUST_MAX, { cls: 'trust', marks: [TRUST_LEARN / TRUST_MAX, TRUST_BOOST / TRUST_MAX] });

export const stars = (n: number): HTMLElement => h('span.stars', { title: `★${n}` }, '★'.repeat(n), h('i', '★'.repeat(3 - n)));

// ------------------------------------------------------------------ the people who talk

type Who = 'manager' | 'announcer';
const TALK: Record<Who, string[]> = {
  manager: ['navi_ain_speak_00_talk', 'navi_ain_speak_01_talk'],
  announcer: ['chris_speak_02_talk', 'chris_speak_03_talk'],
};
const REST: Record<Who, Record<string, string>> = {
  manager: {
    idle: 'navi_ain_11_idle', point: 'navi_ain_00_pointer_up', cheer: 'navi_ain_02_both_arms_up', smile: 'navi_ain_06_smile',
    sparkle: 'navi_ain_08_sparkle', cry: 'navi_ain_09_cry', wink: 'navi_ain_05_wink', think: 'navi_ain_01_arms_crossed', wave: 'navi_ain_03_wave',
  },
  announcer: {
    idle: 'chris_09_idle', cheer: 'chris_03_cheer', guts: 'chris_04_guts_pose', smile: 'chris_05_smile', laugh: 'chris_06_laugh',
    sad: 'chris_08_sad', sparkle: 'chris_07_sparkle', cry: 'chris_cry_01_cry', wave: 'chris_02_wave',
  },
};

export interface Speech { el: HTMLElement; say: (text: string, pose?: string) => Typing }

/**
 * A character with a speech bubble. The text types itself in while the character's mouth moves,
 * and the bubble springs to the size of each new line.
 */
export function speech(who: Who = 'manager', first?: string, pose = 'idle'): Speech {
  const img = h('img', { src: CHARS[REST[who].idle!] ?? '', alt: '', draggable: false });
  const text = h('span.say');
  const ghost = h('span.ghost');
  const bubble = h('div.bubble', ghost, text);
  const el = h('div.speech', h('div.speech-who', img), bubble);
  let timer = 0;
  let typing: Typing | null = null;
  const say = (line: string, p = 'idle'): Typing => {
    typing?.skip();
    clearInterval(timer);
    ghost.textContent = line;
    kick(bubble, 'grow');
    const rest = CHARS[REST[who][p] ?? REST[who].idle!] ?? '';
    const frames = TALK[who].map((k) => CHARS[k] ?? rest);
    let f = 0;
    el.classList.add('talking');
    timer = window.setInterval(() => {
      f += 1;
      img.src = frames[f % frames.length]!;
    }, 130);
    const t = typewriter(text, line, { cps: 42, onTick: () => sfx.typeTick() });
    typing = t;
    void t.done.then(() => {
      if (typing !== t) return;
      clearInterval(timer);
      el.classList.remove('talking');
      img.src = rest;
    });
    return t;
  };
  bubble.addEventListener('click', () => typing?.skip());
  if (first) say(first, pose);
  return { el, say };
}

// ------------------------------------------------------------------ pop-ups

let modalRoot: HTMLElement | null = null;

export function closeModal(): void {
  const m = modalRoot;
  if (!m) return;
  modalRoot = null;
  setMuffled(false);
  m.classList.add('closing');
  setTimeout(() => m.remove(), 170);
}

export const modalOpen = (): boolean => !!modalRoot;

/** A panel over the screen. `sticky` panels cannot be dismissed by tapping outside. */
export function modal(content: HTMLElement, opts: { sticky?: boolean; cls?: string; title?: string; quiet?: boolean } = {}): HTMLElement {
  if (modalRoot) {
    modalRoot.remove();
    modalRoot = null;
  }
  const panel = h('div.modal-panel', { class: opts.cls ?? '', onclick: (e: Event) => e.stopPropagation() },
    opts.title ? h('div.modal-title', h('h2', opts.title)) : null, content);
  modalRoot = h('div.modal', {
    onclick: () => {
      if (opts.sticky) return;
      sfx.close();
      closeModal();
    },
  }, panel);
  document.body.append(modalRoot);
  setMuffled(true);
  if (!opts.quiet) sfx.open();
  return modalRoot;
}

// ------------------------------------------------------------------ scenery

/** The background every menu screen sits on: gradient, drifting halftone, slanted beams and giant ghost lettering. */
export function backdrop(words: [string, string], colors?: [string, string, string]): HTMLElement {
  const row = (text: string, cls: string): HTMLElement => h('div.bg-words', { class: cls }, h('span', text), h('span', text));
  return h('div.bg', {
    'aria-hidden': 'true',
    style: colors ? { '--scene-a': colors[0], '--scene-b': colors[1], '--scene-c': colors[2] } : {},
  }, row(words[0], 'w1'), row(words[1], 'w2'));
}

/** The news strip. It keeps running, whatever the screen is doing. */
export function ticker(items: string[], live = 'LIVE'): HTMLElement {
  const run = (): HTMLElement => h('div.ticker-run', items.map((t) => h('span', t)));
  return h('div.ticker', h('div.ticker-live', live), run(), run());
}

/** Small celebration at an element: sparks, a ring and a buzz in the hand. */
export function cheerAt(el: Element, color = '#ffe14a'): void {
  const c = center(el);
  ring(c.x, c.y, color, 1.6);
  burst(c.x, c.y, { color: [color, '#fffbe8'], count: 18, shape: ['star', 'rect'] });
  vibrate(18);
}
