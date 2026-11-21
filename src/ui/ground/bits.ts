// Small parts the practice ground is built from: short names, living sprites, line icons and experience chips.

import { h } from '../../core/dom';
import { hero } from '../../game/heroes';
import type { Stat } from '../../game/model';
import { XP_LABEL, type PracticeKey, type Xp } from '../../game/season';
import { kick, motion } from '../fx';
import { modalOpen, sprite } from '../kit';

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
 * Stops by itself once the host has left the page.
 */
export function idleLife(host: HTMLElement, figs: () => HTMLElement[]): void {
  if (!motion()) return;
  const beat = (): void => {
    if (!host.isConnected) return;
    const all = figs();
    if (all.length && !modalOpen() && !host.classList.contains('is-drill')) {
      const f = all[Math.floor(Math.random() * all.length)]!;
      if (Math.random() < 0.55) kick(f.querySelector('img'), 'hop');
      else f.classList.toggle('is-flip');
    }
    setTimeout(beat, 700 + Math.random() * 1500);
  };
  setTimeout(beat, 900);
}

/** A line icon (24 × 24 view box, stroked). */
export function icon(body: string, cls = ''): HTMLElement {
  const el = h('i.cico', { class: cls, 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24">${body}</svg>`;
  return el;
}
export const ICON = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  all: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  whistle: '<circle cx="9" cy="14" r="6"/><circle cx="9" cy="14" r="1.4"/><path d="M13.5 9.5H22v4.5h-7"/><path d="M6 5l1 2M10.5 3.5v2.5"/>',
};

/** The ability an ordinary drill is about (the mini game is about everything). */
export const DRILL_STAT: Record<PracticeKey, Stat | null> = { dash: 'spd', pass: 'pas', catch: 'cat', hit: 'blk', tackle: 'tkl', study: 'iq', game: null };
/** ...and the ordinary drill that looks most like work on an ability. */
export const STAT_DRILL: Record<Stat, PracticeKey> = { spd: 'dash', pas: 'pass', cat: 'catch', blk: 'hit', tkl: 'tackle', iq: 'study' };

/** Experience has a shape as well as a colour: power ■, speed ▶, technique ●, brains ◆. */
export const XP_GLYPH: Record<Xp, string> = { pow: '■', spd: '▶', tec: '●', int: '◆' };
export const XP_COLOR: Record<Xp, string> = { pow: '#ff9a3d', spd: '#ffe14a', tec: '#37e3ff', int: '#b69bff' };

/** "■ パワー 12" (or just "■12" when space is short). */
export function xpChip(k: Xp, v: number, word = false): HTMLElement {
  return h('span.xp', { class: `is-${k}`, title: `${XP_LABEL[k]}の経験 ${Math.round(v)}` },
    h('i', XP_GLYPH[k]), word ? h('u', XP_LABEL[k]) : null, h('b', String(Math.round(v))));
}
