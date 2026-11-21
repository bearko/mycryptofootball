// The drawn stand-in for the practice ground: a field at sunset with the heroes as sprites, and a short
// sprite version of every drill. Only used when the 3D stadium cannot stage practice.

import { h } from '../../core/dom';
import { recruit, talentOf } from '../../game/heroes';
import { member, type Season } from '../../game/season';
import { ease, kick, motion, tween } from '../fx';
import { STAT_DRILL, figure, idleLife } from './bits';
import type { Ground } from './ground';

/** Where the seven stand: x in % of the width, y (feet) in % of the free band between calendar and hand. */
const SPOTS: [number, number][] = [[14, 82], [38, 82], [62, 82], [86, 82], [26, 44], [50, 44], [74, 44]];

export function fallbackGround(s: Season): Ground {
  const figs = new Map<number, HTMLElement>();
  const band = h('div.pgf-band', s.members.map((m, i) => {
    const f = figure(m.id);
    figs.set(m.id, f);
    const [x, y] = SPOTS[i % SPOTS.length]!;
    return h('span.pgf-spot', { style: { left: `${x}%`, top: `${y}%` } }, f);
  }));
  const el = h('div.pgf', { 'aria-hidden': 'true' },
    h('div.pgf-sky', h('i.pgf-sun'), h('i.sky-cloud.c1'), h('i.sky-cloud.c2'), h('i.sky-cloud.c3'), h('i.sky-bird.b1'), h('i.sky-bird.b2'), h('i.pgf-far')),
    h('div.pgf-turf'),
    band);
  let life = false;
  let cancel: (() => void) | null = null;
  const rem = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 12;
  const imgOf = (f: Element): Element | null => f.querySelector('img');

  const drill: Ground['drill'] = (kind, opts, hooks) => {
    cancel?.();
    return new Promise((resolve) => {
      const full = motion();
      const T = (full ? 1500 : 500) / Math.max(0.25, opts.speed ?? 1);
      const u = rem();
      const base = el.getBoundingClientRect();
      const timers: number[] = [];
      const anims: Animation[] = [];
      const props: HTMLElement[] = [];
      let over = false;
      const end = (): void => {
        if (over) return;
        over = true;
        cancel = null;
        timers.forEach((t) => clearTimeout(t));
        anims.forEach((a) => a.cancel());
        props.forEach((p) => p.remove());
        el.classList.remove('is-drill');
        hooks.onEnd?.();
        resolve();
      };
      cancel = end;
      const at = (f: number, fn: () => void): void => {
        timers.push(window.setTimeout(() => {
          if (!over && el.isConnected) fn();
        }, f * T));
      };
      const move = (f: Element, frames: Keyframe[], o: KeyframeAnimationOptions): void => {
        if (full) anims.push(f.animate(frames, o));
      };
      const prop = <E extends HTMLElement>(p: E): E => {
        props.push(p);
        el.append(p);
        return p;
      };
      const spot = (f: Element): { x: number; y: number } => {
        const r = f.getBoundingClientRect();
        return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height * 0.45 };
      };
      const hop = (f: Element): void => kick(imgOf(f), 'hop');
      const toss = (b: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, height: number, ms: number, done: () => void): void => {
        b.style.opacity = '1';
        hooks.onThrow?.();
        void tween(ms, (t) => {
          if (over) return;
          b.style.transform = `translate(${from.x + (to.x - from.x) * t}px, ${from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * height}px) rotate(${t * 540}deg)`;
        }, ease.linear).then(() => {
          if (!over) done();
        });
      };

      el.classList.add('is-drill');
      const everyone = s.members.map((m) => figs.get(m.id)!);
      const leadFig = opts.lead !== undefined ? figs.get(opts.lead) ?? null : null;
      // one-on-one: only that hero works; a hero's own drill: everyone does what that hero is best at
      const who = kind === 'solo' && leadFig ? [leadFig] : everyone;
      const key = kind === 'solo' ? STAT_DRILL[member(s, opts.lead!).focus]
        : kind === 'special' ? STAT_DRILL[talentOf(recruit(opts.lead!).stats).best] : kind;
      if (kind !== 'solo' && kind !== 'special') hooks.onWhistle?.();
      else at(0.05, () => {
        hooks.onWhistle?.();
        if (leadFig) hop(leadFig);
      });
      if (leadFig) leadFig.classList.add('is-lead');
      const pairs: [HTMLElement, HTMLElement | null][] = [];
      for (let i = 0; i < who.length; i += 2) pairs.push([who[i]!, who[i + 1] ?? null]);

      if (key === 'dash') {
        who.forEach((f, i) => {
          const dir = 1;
          const dx = u * 6.5;
          move(f, [
            { transform: 'translateX(0)', easing: 'ease-in' },
            { transform: `translateX(${dx}px) skewX(${-10 * dir}deg)`, offset: 0.42 },
            { transform: `translateX(${dx}px) scaleX(-1)`, offset: 0.5, easing: 'ease-in' },
            { transform: `translateX(0) scaleX(-1) skewX(${-10 * dir}deg)`, offset: 0.92 },
            { transform: 'translateX(0)' },
          ], { duration: T * 0.86, delay: T * (0.06 + i * 0.012) });
        });
        for (let k = 0; k < 9; k += 1) at(0.1 + k * 0.09, () => hooks.onStep?.());
      } else if (key === 'pass' || key === 'catch') {
        pairs.forEach(([a, b], n) => {
          const pa = spot(a);
          const pb = b ? spot(b) : { x: pa.x, y: pa.y - u * 0.5 };
          const ball = prop(h('i.fball.pgf-ball'));
          [0, 1, 2].forEach((k) => at(0.1 + n * 0.04 + k * 0.26, () => {
            const [from, to, catcher] = k % 2 ? [pb, pa, a] : [pa, pb, b ?? a];
            toss(ball, from, to, b ? u * 4 : u * 5.5, T * 0.2, () => {
              hooks.onCatch?.();
              hop(catcher);
              if (k === 2) ball.style.opacity = '0';
            });
          }));
        });
      } else if (key === 'hit' || key === 'tackle') {
        const hits = [0.34, 0.66];
        pairs.forEach(([a, b]) => {
          const ra = a.getBoundingClientRect();
          const lunge = (len: number): Keyframe[] => [
            { transform: 'translateX(0)' },
            ...hits.flatMap((t) => [
              { transform: `translateX(${-Math.sign(len) * u}px) rotate(${-Math.sign(len) * 6}deg)`, offset: t - 0.1, easing: 'ease-in' },
              { transform: `translateX(${len}px) rotate(${Math.sign(len) * 10}deg)`, offset: t },
              { transform: 'translateX(0)', offset: t + 0.14 },
            ]),
            { transform: 'translateX(0)' },
          ];
          if (b) {
            const rb = b.getBoundingClientRect();
            const gap = rb.left - ra.right;
            move(a, lunge(gap / 2 + u * 0.8), { duration: T });
            move(b, lunge(-(gap / 2 + u * 0.8)), { duration: T });
          } else {
            const pad = prop(h('i.pgf-pad', { style: { left: `${ra.right - base.left + u * 3.4}px`, top: `${ra.top - base.top + ra.height * 0.1}px` } }));
            move(a, lunge(u * 4.2), { duration: T });
            hits.forEach((t) => at(t, () => pad.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(16deg)' }, { transform: 'rotate(0)' }], { duration: 300 })));
          }
        });
        hits.forEach((t, n) => at(t, () => hooks.onImpact?.(0.55 + n * 0.3)));
      } else if (key === 'study') {
        prop(h('div.pgf-board', h('i'), h('i'), h('i')));
        [0.12, 0.36, 0.6].forEach((t) => at(t, () => hooks.onChalk?.()));
        who.forEach((f, i) => {
          at(0.3 + i * 0.03, () => hop(f));
          at(0.68 + i * 0.03, () => hop(f));
        });
      } else {
        // the mini game: everyone bounces, the ball goes round
        who.forEach((f, i) => move(f, [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${u}px, ${-u * 1.4}px) rotate(7deg)` },
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-u * 0.7}px, ${-u}px) rotate(-7deg)` },
          { transform: 'translate(0, 0)' },
        ], { duration: T * 0.3, iterations: 3, delay: T * (0.05 + i * 0.02), easing: 'ease-in-out' }));
        const ball = prop(h('i.fball.pgf-ball'));
        const pts = who.map(spot);
        if (pts.length === 1) pts.push({ x: pts[0]!.x + u * 5, y: pts[0]!.y });
        [0, 1, 2, 3].forEach((k) => at(0.1 + k * 0.2, () => {
          toss(ball, pts[k % pts.length]!, pts[(k + 3) % pts.length]!, u * 3.6, T * 0.17, () => {
            hooks.onCatch?.();
            if (k === 3) ball.style.opacity = '0';
          });
        }));
      }

      who.forEach((f, i) => at(0.74 + i * 0.03, () => {
        hop(f);
        for (const [id, fig] of figs) if (fig === f) hooks.onPayoff?.(id);
      }));
      at(1, () => {
        leadFig?.classList.remove('is-lead');
        end();
      });
    });
  };

  return {
    el,
    real: false,
    drill,
    hint: (kind, lead) => {
      for (const [id, f] of figs) {
        const on = kind !== null && (kind !== 'solo' || id === lead);
        f.classList.toggle('is-hint', on);
        f.classList.toggle('is-lead', kind !== null && id === lead);
      }
    },
    pos: (id) => {
      const f = figs.get(id);
      if (!f || !el.isConnected) return null;
      if (!life) {
        life = true;
        idleLife(el, () => [...figs.values()]);
      }
      const base = el.getBoundingClientRect();
      const r = f.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, y: r.bottom - base.top, scale: r.height / 64, h: r.height };
    },
    safe: (top, bottom) => {
      el.style.setProperty('--st', `${top}px`);
      el.style.setProperty('--sb', `${bottom}px`);
    },
    destroy: () => cancel?.(),
  };
}
