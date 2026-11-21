// The practice ground behind the hub screen.
// The real thing is the 3D stadium renderer (the same one the matches use); when it cannot stage practice,
// a drawn field with sprite drills stands in. The screen talks to either through the same small interface.

import { h } from '../../core/dom';
import { prefs } from '../../core/save';
import { DEF_POS, OFF_POS, roleOf, type Role } from '../../game/model';
import { TEAM_COLOR, clubSheet, type PracticeKey, type Season } from '../../game/season';
import { Stadium } from '../stadium';
import { fallbackGround } from './fallback';

export type DrillKind = PracticeKey | 'solo' | 'special';

/** Fired in step with the picture, so the screen can add sound, numbers and haptics. */
export interface DrillHooks {
  onStep?: () => void;
  onThrow?: () => void;
  onCatch?: () => void;
  onImpact?: (power: number) => void;
  onChalk?: () => void;
  onWhistle?: () => void;
  /** this hero has got what the drill gives */
  onPayoff?: (heroId: number) => void;
  onEnd?: () => void;
}

/** Feet of a hero in CSS px from the top-left of the ground; `h` is the sprite's height. */
export interface HeroPos { x: number; y: number; scale: number; h: number }

export interface Ground {
  el: HTMLElement;
  /** true: the 3D stadium; false: the drawn stand-in */
  real: boolean;
  drill: (kind: DrillKind, opts: { lead?: number; speed?: number }, hooks: DrillHooks) => Promise<void>;
  /** a drill is only being considered (null: nothing is) */
  hint: (kind: DrillKind | null, lead?: number) => void;
  pos: (heroId: number) => HeroPos | null;
  /** how much of the top and bottom is covered by the calendar and the hand */
  safe: (top: number, bottom: number) => void;
  destroy: () => void;
}

/** What the stadium offers for practice (it may not be there yet). */
interface PracticeApi {
  ground: (o: { heroes: number[]; day: number; color: string; posts?: Record<number, { off: Role | null; def: Role | null }> }) => void;
  drill: (kind: DrillKind, o: { lead?: number; speed?: number }, hooks?: DrillHooks) => Promise<void>;
  hintDrill: (kind: DrillKind | null, lead?: number) => void;
}

/** Where each member plays: the position on offense and on defense (null: not on that unit). */
export function postsOf(s: Season): Record<number, { off: Role | null; def: Role | null }> {
  const out: Record<number, { off: Role | null; def: Role | null }> = {};
  const l = s.lineup;
  for (const m of s.members) {
    const off = l ? OFF_POS.find((p) => l.off[p] === m.id) : undefined;
    const def = l ? DEF_POS.find((p) => l.def[p] === m.id) : undefined;
    out[m.id] = { off: off ? roleOf(off) : null, def: def ? roleOf(def) : null };
  }
  return out;
}

/** "QB/S", "OL/DL", or "控え" for a hero who starts on neither unit. */
export function postText(p: { off: Role | null; def: Role | null } | undefined): string {
  if (!p || (!p.off && !p.def)) return '控え';
  return [p.off, p.def].filter(Boolean).join('/');
}

export function makeGround(s: Season): Ground {
  const ids = s.members.map((m) => m.id);
  // ?ground=css forces the drawn stand-in (for looking at it on purpose; never linked from the game)
  const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ground') === 'css';
  if (!forced && 'ground' in Stadium.prototype && 'drill' in Stadium.prototype) {
    let st: (Stadium & Partial<PracticeApi>) | null = null;
    try {
      const canvas = h('canvas.stadium');
      const sheet = clubSheet(s);
      const made: Stadium & Partial<PracticeApi> = new Stadium(canvas, [sheet, sheet]);
      st = made;
      made.setMotion(prefs().motion);
      made.ground!({ heroes: ids, day: s.day, color: TEAM_COLOR, posts: postsOf(s) });
      return {
        el: canvas,
        real: true,
        drill: (kind, opts, hooks) => made.drill!(kind, opts, hooks),
        hint: (kind, lead) => made.hintDrill?.(kind, lead),
        pos: (id) => made.screenPos(0, id),
        safe: (top, bottom) => made.setSafeArea(top, bottom),
        destroy: () => made.destroy(),
      };
    } catch {
      // the stand-in below takes over; the half-made stadium must not keep drawing
      try {
        st?.destroy();
      } catch {
        /* nothing to stop */
      }
    }
  }
  return fallbackGround(s);
}
