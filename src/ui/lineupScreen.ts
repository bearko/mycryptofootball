// 編成: the coach's chalkboard. Two formations drawn in chalk (offense: the other side is up, defense: the other side is down),
// the heroes are round magnets. The same six play both units; the seventh sits on the bench.
// Drag a magnet (or tap it, then tap a spot): while a hero is held, every spot shows the grade that hero would have there.

import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import { KIND } from '../game/cards';
import { hero, recruit, talentOf } from '../game/heroes';
import { bestLineup, isStarter, place } from '../game/lineup';
import { unitSummary } from '../game/match';
import {
  DEF_POS, OFF_POS, ROLE_HINT, ROLE_LABEL, ROLE_WEIGHTS, STAT_LABEL, fit, grade, roleOf,
  type DefPos, type Lineup, type OffPos, type Role, type Stat,
} from '../game/model';
import { asPlayer, clubSheet, learned, member } from '../game/season';
import { burst, center, countUp, kick, motion, pop, ring, sparks } from './fx';
import { TALENT_COLOR, backdrop, button, cheerAt, modalOpen, portrait, speech, statIcon } from './kit';
import { bestRoles } from './shared';

type Unit = 'off' | 'def';
type Pos = OffPos | DefPos;
type Grade = ReturnType<typeof grade>;
type Sum = ReturnType<typeof unitSummary>;

const RANK: Record<Grade, number> = { D: 0, C: 1, B: 2, A: 3, S: 4 };
const UNIT_LABEL: Record<Unit, string> = { off: '攻撃', def: '守備' };

/** Where each position stands on its board, in % of the field (the offense looks up, the defense looks down). */
const OFF_AT: Record<OffPos, [number, number]> = { WR1: [11, 22], OL1: [37, 21], OL2: [63, 21], WR2: [89, 22], QB: [50, 52.5], RB: [70, 83.5] };
const DEF_AT: Record<DefPos, [number, number]> = { S: [50, 15], LB: [50, 46], CB1: [11, 55], CB2: [89, 55], DL1: [36, 77], DL2: [64, 77] };

const METERS: { key: keyof Sum; label: string; unit: Unit }[] = [
  { key: 'runOff', label: 'ラン', unit: 'off' },
  { key: 'passOff', label: 'パス', unit: 'off' },
  { key: 'runDef', label: 'ラン守備', unit: 'def' },
  { key: 'passDef', label: 'パス守備', unit: 'def' },
];

interface Slot {
  key: string;
  unit: Unit | 'bench';
  pos: Pos | null;
  role: Role | null;
  el: HTMLButtonElement;
  /** where the magnet sits */
  seat: HTMLElement;
  /** "this hero would be an A here" */
  tag: HTMLElement;
}

interface Was { key: string; unit: Unit | 'bench'; id: number; rect: DOMRect }

/** The name on a magnet: the last part of a name written with "・" (like the back of a uniform). */
const shortName = (name: string): string => name.split('・').pop() ?? name;

/** A chalk line with an arrow head, as SVG paths. `d` must end at (x, y) coming from (px, py). */
function arrow(cls: string, d: string, px: number, py: number, x: number, y: number, size: number): string {
  const a = Math.atan2(y - py, x - px);
  const wing = (da: number): string => `${(x - Math.cos(a + da) * size).toFixed(1)},${(y - Math.sin(a + da) * size).toFixed(1)}`;
  return `<path class="${cls} draw" pathLength="1" d="${d}"/><path class="${cls} head draw" pathLength="1" d="M${wing(0.5)} L${x.toFixed(1)},${y.toFixed(1)} L${wing(-0.5)}"/>`;
}

export function lineupScreen(back: () => void): HTMLElement {
  const s = save().season!;
  const players = s.members.map(asPlayer);
  let held: number | null = null;
  /** the spot under the pointer or the keyboard focus (what the note explains) */
  let hover: Slot | null = null;
  let drag: { id: number; pointer: number; from: Slot; x: number; y: number; ghost: HTMLElement | null; over: Slot | null } | null = null;
  let skipClick = false;
  let noteKey = '';
  let lastLine = '';
  let live = false;

  const statsOf = (id: number) => member(s, id).stats;
  const benchId = (): number => s.members.find((m) => !isStarter(s.lineup!, m.id))!.id;
  const heroAt = (slot: Slot): number =>
    slot.unit === 'off' ? s.lineup!.off[slot.pos as OffPos] : slot.unit === 'def' ? s.lineup!.def[slot.pos as DefPos] : benchId();
  const gradeAt = (id: number, slot: Slot): Grade | null => (slot.role ? grade(fit(statsOf(id), slot.role)) : null);
  const total = (l: Lineup): number =>
    OFF_POS.reduce((v, p) => v + fit(statsOf(l.off[p]), roleOf(p)), 0) + DEF_POS.reduce((v, p) => v + fit(statsOf(l.def[p]), roleOf(p)), 0);

  /** Can this hero call their special play from this spot? null: nothing to show (not learned, or the play belongs to the other unit). */
  const starAt = (id: number, slot: Slot): null | boolean => {
    if (!learned(member(s, id))) return null;
    if (slot.unit === 'bench') return false;
    const info = KIND[recruit(id).kind];
    if (info.side !== slot.unit) return null;
    return !info.roles || info.roles.includes(slot.role!);
  };

  // ---------------------------------------------------------------- the spots

  const slots: Slot[] = [];
  const bySlotEl = new Map<Element, Slot>();

  const makeSlot = (unit: Unit | 'bench', pos: Pos | null, at?: [number, number]): Slot => {
    const role = pos ? roleOf(pos) : null;
    const seat = h('span.lu-seat');
    const tag = h('span.lu-if', { 'aria-hidden': 'true' });
    const el: HTMLButtonElement = h('button.lu-slot', {
      type: 'button', class: unit, style: at ? { left: `${at[0]}%`, top: `${at[1]}%`, '--i': String(slots.length) } : { '--i': String(slots.length) },
    }, h('span.lu-role', role ? ROLE_LABEL[role] : '控え'), h('span.lu-socket', { 'aria-hidden': 'true' }), seat, tag);
    const slot: Slot = { key: pos ? `${unit}:${pos}` : 'bench', unit, pos, role, el, seat, tag };
    slots.push(slot);
    bySlotEl.set(el, slot);

    el.addEventListener('click', () => {
      if (skipClick) {
        skipClick = false;
        return;
      }
      tap(slot);
    });
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && !drag?.ghost) look(slot);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !drag?.ghost && hover === slot) look(null);
    });
    el.addEventListener('focus', () => look(slot));
    el.addEventListener('blur', () => hover === slot && look(null));

    // dragging: the magnet follows the finger once it has moved a little
    el.addEventListener('pointerdown', (e) => {
      if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { id: heroAt(slot), pointer: e.pointerId, from: slot, x: e.clientX, y: e.clientY, ghost: null, over: null };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 12;
      if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > rem * 0.7) lift();
      if (drag.ghost) follow(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      if (drag.ghost) {
        skipClick = true;
        setTimeout(() => {
          skipClick = false;
        }, 60);
        release();
      }
      drag = null;
    });
    el.addEventListener('pointercancel', (e) => {
      if (!drag || drag.pointer !== e.pointerId) return;
      if (drag.ghost) putBack();
      drag = null;
    });
    return slot;
  };

  /** A hero as a magnet: portrait on a coloured disc, name, grade stamp, and whether the special play works from here. */
  const magnet = (id: number, slot: Slot): HTMLElement => {
    const best = talentOf(statsOf(id)).best;
    const g = gradeAt(id, slot);
    const star = starAt(id, slot);
    const name = hero(id).name;
    const unit = slot.unit === 'bench' ? '控え' : `${UNIT_LABEL[slot.unit]}の${ROLE_LABEL[slot.role!]}`;
    const starNote = star === null ? '' : star ? '、特別作戦を使える' : '、特別作戦は使えない';
    slot.el.setAttribute('aria-label', `${unit}：${name}${g ? `（適性${g}${starNote}）` : starNote}`);
    return h('span.lu-mag', { class: `t-${best}`, data: { id: String(id) } },
      portrait(id, { color: TALENT_COLOR[best] }),
      h('span.lu-name', shortName(name)),
      g ? h('span.lu-grade', { class: `g${g}` }, g) : null,
      star === null ? null : h('span.lu-star', { class: star ? 'on' : 'no' }, '★', star ? null : h('i', '×')));
  };

  // ---------------------------------------------------------------- the boards

  const chalkOf: Record<Unit, HTMLElement> = { off: h('div.lu-chalk'), def: h('div.lu-chalk') };
  /** What the chalk colours mean, written in a free corner of the board. */
  const key = (rows: [string, string][]): HTMLElement => h('div.lu-key', { 'aria-hidden': 'true' }, rows.map(([cls, word]) => h('span', { class: cls }, h('i'), word)));
  const fieldOf: Record<Unit, HTMLElement> = {
    off: h('div.lu-field', chalkOf.off, h('span.lu-dir', { 'aria-hidden': 'true' }, '▲ 相手側'),
      key([['run', '走る道'], ['pass', 'パスの道']]), OFF_POS.map((p) => makeSlot('off', p, OFF_AT[p]).el)),
    def: h('div.lu-field', chalkOf.def, h('span.lu-dir', { 'aria-hidden': 'true' }, '▼ 相手側'),
      key([['rush', '止めにいく'], ['zone', '見はる']]), DEF_POS.map((p) => makeSlot('def', p, DEF_AT[p]).el)),
  };
  const bench = makeSlot('bench', null);

  /** Draws the play lines of one board in chalk, sized to the board as it is right now. */
  const drawChalk = (unit: Unit, animate: boolean): void => {
    const box = chalkOf[unit];
    const W = fieldOf[unit].clientWidth;
    const H = fieldOf[unit].clientHeight;
    if (!W || !H) return;
    const u = W / 100;
    const v = H / 100;
    const head = Math.max(6, W * 0.022);
    const P = (at: [number, number]): [number, number] => [at[0] * u, at[1] * v];
    const parts: string[] = [];
    let los = '';
    if (unit === 'off') {
      const top = 0.8 * v;
      los = `<path class="los" d="M${2 * u},${4.5 * v} H${98 * u}"/>`;
      const [qx, qy] = P(OFF_AT.QB);
      const [rx, ry] = P(OFF_AT.RB);
      // the runner's lane: off the quarterback's hip and up through the gap outside the line
      const gx = 76 * u;
      parts.push(arrow('run', `M${rx},${ry} C${rx},${ry - 22 * v} ${gx},${qy} ${gx},${30 * v} L${gx},${top}`, gx, 30 * v, gx, top, head));
      // the receivers run upfield; the quarterback's throws reach them
      for (const [wr, dir] of [['WR1', 1], ['WR2', -1]] as const) {
        const [wx, wy] = P(OFF_AT[wr]);
        parts.push(arrow('route', `M${wx},${wy} L${wx},${top}`, wx, wy, wx, top, head * 0.8));
        const tx = wx + dir * 11.5 * u;
        const ty = wy + 4 * v;
        const cx = (qx + tx) / 2;
        const cy = ty - 1 * v;
        parts.push(arrow('pass', `M${qx},${qy} Q${cx},${cy} ${tx},${ty}`, cx, cy, tx, ty, head * 0.8));
      }
    } else {
      const bottom = 99.6 * v;
      los = `<path class="los" d="M${2 * u},${96.5 * v} H${98 * u}"/>`;
      const [sx, sy] = P(DEF_AT.S);
      const [lx, ly] = P(DEF_AT.LB);
      for (const dir of [-1, 1]) {
        // the safety watches both deep halves, the linebacker chases to either side
        const ex = sx + dir * 30 * u;
        parts.push(arrow('zone', `M${sx},${sy} Q${sx + dir * 20 * u},${sy - 4 * v} ${ex},${sy + 14 * v}`, sx + dir * 20 * u, sy - 4 * v, ex, sy + 14 * v, head * 0.8));
        const kx = lx + dir * 21 * u;
        parts.push(arrow('rush', `M${lx},${ly} Q${lx + dir * 16 * u},${ly + 1 * v} ${kx},${ly + 12 * v}`, lx + dir * 16 * u, ly + 1 * v, kx, ly + 12 * v, head * 0.8));
      }
      for (const dl of ['DL1', 'DL2'] as const) {
        const [x, y] = P(DEF_AT[dl]);
        parts.push(arrow('rush', `M${x},${y} L${x},${bottom}`, x, y, x, bottom, head));
      }
      for (const cb of ['CB1', 'CB2'] as const) {
        const [x, y] = P(DEF_AT[cb]);
        parts.push(arrow('zone', `M${x},${y} L${x},${bottom}`, x, y, x, bottom, head * 0.8));
      }
    }
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <filter id="lu-rough-${unit}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${unit === 'off' ? 3 : 8}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${(W * 0.006).toFixed(2)}"/></filter>
      ${los}<g filter="url(#lu-rough-${unit})">${parts.join('')}</g></svg>`;
    box.classList.toggle('drawn', !animate);
    if (animate) kick(box, 'drawing');
  };

  // ---------------------------------------------------------------- meters

  const meterEls = new Map<keyof Sum, { el: HTMLElement; fill: HTMLElement; num: HTMLElement; value: number }>();
  const makeMeter = (m: (typeof METERS)[number]): HTMLElement => {
    const fill = h('i');
    const num = h('b.led', '0');
    const el = h('div.lu-meter', { class: m.unit }, h('span', m.label), h('div.lu-led', fill), num);
    meterEls.set(m.key, { el, fill, num, value: 0 });
    return el;
  };
  const metersOf = (unit: Unit): HTMLElement => h('div.lu-meters', METERS.filter((m) => m.unit === unit).map(makeMeter));

  /** Springs the gauges to the current values; with `shout`, each gauge that moved says by how much. */
  const syncMeters = (shout: boolean): number => {
    const sum = unitSummary(clubSheet(s));
    let net = 0;
    let n = 0;
    for (const m of METERS) {
      const g = meterEls.get(m.key)!;
      const to = Math.round(sum[m.key]);
      const d = to - g.value;
      g.fill.style.width = `${Math.max(0, Math.min(100, sum[m.key]))}%`;
      g.el.setAttribute('aria-label', `${m.label} ${to}`);
      if (d) {
        void countUp(g.num, g.value, to, 450, String, () => sfx.countTick());
        if (shout) {
          const c = center(g.num);
          pop(c.x, c.y, d > 0 ? `+${d}` : `${d}`, d > 0 ? 'small' : 'small bad');
          kick(g.el, d > 0 ? 'up' : 'down');
          if (d > 0) {
            const k = n;
            setTimeout(() => sfx.statUp(k), 90 * k);
            n += 1;
          }
        }
      }
      net += d;
      g.value = to;
    }
    return net;
  };

  // ---------------------------------------------------------------- the note: what the spot under the pointer is

  const note = h('div.lu-note.paper.tape');
  const weights = (role: Role): HTMLElement[] =>
    (Object.entries(ROLE_WEIGHTS[role]) as [Stat, number][]).sort((a, b) => b[1] - a[1]).map(([k, w]) =>
      h('div.lu-w', { class: `t-${k}` }, statIcon(k), h('span', STAT_LABEL[k]), h('i', { style: { '--w': String(w) } })));
  const gradeChip = (g: Grade): HTMLElement => h('span.lu-grade', { class: `g${g}` }, g);

  const drawNote = (): void => {
    const slot = drag?.over ?? hover;
    const id = slot ? heroAt(slot) : null;
    const who = held !== null ? held : id;
    const key = `${slot?.key ?? ''}:${who ?? ''}:${held ?? ''}`;
    if (key === noteKey) return;
    noteKey = key;
    if (slot?.role && slot.unit !== 'bench' && who !== null) {
      const g = gradeAt(who, slot)!;
      note.replaceChildren(
        h('span.label', { class: slot.unit === 'def' ? 'cyan' : '' }, UNIT_LABEL[slot.unit]),
        h('b.lu-note-role', ROLE_LABEL[slot.role]),
        h('p', ROLE_HINT[slot.role]),
        h('div.lu-ws', weights(slot.role)),
        h('p.lu-note-fit', `${shortName(hero(who).name)}なら`, gradeChip(g)));
    } else if (slot) {
      note.replaceChildren(
        h('span.label.dark', '控え'),
        h('b.lu-note-role', 'ベンチ'),
        h('p', '試合には出ない7人目。先発のだれかと、いつでも入れかえられます。'));
    } else {
      note.replaceChildren(
        h('span.label.dark', '見かた'),
        h('p.lu-legend', (['S', 'A', 'B', 'C', 'D'] as Grade[]).map(gradeChip)),
        h('p.lu-scale', h('span', '◎ 向いている'), h('span', '苦手 ×')),
        h('p.lu-legend', h('span.lu-star.on', '★'), '特別作戦を使える'),
        h('p.lu-legend', h('span.lu-star.no', '★', h('i', '×')), '場所が合わない'));
    }
    kick(note, 'flip');
  };

  // ---------------------------------------------------------------- the manager, the hint line

  const hint = h('p');
  const mgr = speech('manager');
  const tell = (line: string, pose: string): void => {
    if (line === lastLine) return;
    lastLine = line;
    mgr.say(line, pose);
  };

  /** One useful sentence about the board as it stands. */
  const advise = (): void => {
    const l = s.lineup!;
    if (held !== null) {
      tell(`${hero(held).name}は、${bestRoles(statsOf(held))}ですよ。`, 'point');
      return;
    }
    // a special play that is learned but cannot be called from where its owner stands
    const order = [...s.members].sort((a, b) => Number(b.captain) - Number(a.captain));
    for (const m of order) {
      if (!learned(m) || !isStarter(l, m.id)) continue;
      const info = KIND[recruit(m.id).kind];
      const slot = slots.find((x) => x.unit === info.side && heroAt(x) === m.id)!;
      if (starAt(m.id, slot) === false) {
        const where = info.roles!.map((r) => ROLE_LABEL[r]).join('か');
        tell(`${hero(m.id).name}の特別作戦は、${UNIT_LABEL[info.side]}で${where}に置くと使えます（いまは★×）。`, 'point');
        return;
      }
    }
    const weak = slots.filter((x) => x.role && gradeAt(heroAt(x), x) === 'D')[0];
    const b = s.members.find((m) => m.id === benchId())!;
    if (weak) tell(`${UNIT_LABEL[weak.unit as Unit]}の${ROLE_LABEL[weak.role!]}が苦手そうです（D）。「おまかせ」で並べ直せますよ。`, 'think');
    else if (learned(b)) tell(`控えの${hero(b.id).name}は特別作戦を覚えています。出番を作るのも手ですよ。`, 'think');
    else if (total(l) >= total(bestLineup(players)) - 0.01) tell('いまの並びが、いちばん力を出せます！ これでいきましょう。', 'sparkle');
    else tell('同じ6人が攻撃も守備もします。両方のボードの文字を見くらべてみましょう。', 'idle');
  };

  // ---------------------------------------------------------------- marking: who is held, what every spot would give

  const mark = (): void => {
    root.classList.toggle('holding', held !== null);
    const st = held !== null ? statsOf(held) : null;
    const bestOf: Record<string, number> = { off: -1, def: -1 };
    if (st) for (const x of slots) if (x.role) bestOf[x.unit] = Math.max(bestOf[x.unit]!, fit(st, x.role));
    const twin = held ?? (hover ? heroAt(hover) : null);
    for (const x of slots) {
      const id = heroAt(x);
      const own = held !== null && id === held;
      x.el.classList.toggle('home', own);
      x.el.classList.toggle('target', held !== null && !own);
      x.el.classList.toggle('twin', twin !== null && id === twin && x !== hover && !own);
      x.el.classList.toggle('lifted', !!drag?.ghost && drag.from === x);
      x.el.classList.toggle('over', !!drag?.ghost && drag.over === x);
      x.el.setAttribute('aria-pressed', String(own));
      if (st && !own && x.role) {
        const v = fit(st, x.role);
        const g = grade(v);
        const top = v >= bestOf[x.unit]! - 0.01;
        x.tag.className = `lu-if g${g}${top ? ' best' : ''}`;
        x.tag.replaceChildren(g, top ? h('i', '◎') : '');
      } else if (st && !own) {
        x.tag.className = 'lu-if word';
        x.tag.replaceChildren('交代');
      } else {
        x.tag.className = 'lu-if';
        x.tag.replaceChildren();
      }
    }
    hint.textContent = held !== null
      ? `${shortName(hero(held).name)}をどこに置く？ 光った文字が、そこでの適性（◎がいちばん）`
      : 'マグネットをつかんで、置きたい場所へ。同じ6人が攻撃も守備もします';
    drawNote();
  };

  const look = (slot: Slot | null): void => {
    if (hover === slot) return;
    hover = slot;
    mark();
  };

  // ---------------------------------------------------------------- putting magnets on the board

  const wasNow = (): Was[] => slots.map((x) => ({ key: x.key, unit: x.unit, id: heroAt(x), rect: (x.seat.firstElementChild ?? x.seat).getBoundingClientRect() }));

  /**
   * Makes the board show the line-up. Magnets that changed place glide there from where that hero was
   * (`was`: the board before the change; `origin`: a hero that comes from somewhere else, like the finger).
   */
  const render = (was: Was[] | null, opts: { origin?: Map<number, DOMRect>; stagger?: boolean } = {}): number => {
    let moved = 0;
    for (const x of slots) {
      const id = heroAt(x);
      const old = x.seat.firstElementChild as HTMLElement | null;
      if (old && Number(old.dataset.id) === id) continue;
      const mag = magnet(id, x);
      x.seat.replaceChildren(mag);
      if (!was || !motion()) continue;
      const mine = was.filter((w) => w.id === id);
      const from = opts.origin?.get(id) ?? (mine.find((w) => w.unit === x.unit) ?? mine.find((w) => w.unit === 'bench') ?? mine[0])?.rect;
      if (!from) continue;
      const to = mag.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const delay = opts.stagger ? moved * 60 : 0;
      moved += 1;
      x.el.classList.add('moving');
      const a = mag.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(1.12) rotate(-5deg)` },
        { transform: 'translate(0, 0) scale(1.12) rotate(2deg)', offset: 0.78 },
        { transform: 'none' },
      ], { duration: 400, delay, fill: 'backwards', easing: 'cubic-bezier(0.25, 1.1, 0.4, 1)' });
      a.onfinish = () => {
        x.el.classList.remove('moving');
        kick(mag, 'clack');
        if (opts.stagger && root.isConnected) sfx.drop();
      };
    }
    return moved;
  };

  interface Snap { grades: Map<string, Grade>; stars: Set<number> }
  const snap = (): Snap => {
    const grades = new Map<string, Grade>();
    const stars = new Set<number>();
    for (const x of slots) {
      const id = heroAt(x);
      const g = gradeAt(id, x);
      if (g) grades.set(`${x.unit}:${id}`, g);
      if (starAt(id, x)) stars.add(id);
    }
    return { grades, stars };
  };

  /** Applies a new line-up: saves it, moves the magnets, and reports what got better or worse. */
  const change = (next: Lineup, opts: { origin?: Map<number, DOMRect>; stagger?: boolean } = {}): void => {
    const before = snap();
    const was = wasNow();
    const offBefore = JSON.stringify(s.lineup!.off);
    const defBefore = JSON.stringify(s.lineup!.def);
    s.lineup = next;
    held = null;
    commit();
    const moved = render(was, opts);
    const settle = motion() ? 380 + (opts.stagger ? moved * 60 : 0) : 0;
    const after = snap();

    // grade stamps: better ones stamp in with a little celebration, worse ones sag
    let ups = 0;
    for (const x of slots) {
      if (!x.role) continue;
      const id = heroAt(x);
      const g = after.grades.get(`${x.unit}:${id}`)!;
      const g0 = before.grades.get(`${x.unit}:${id}`);
      const badge = x.seat.querySelector<HTMLElement>('.lu-grade');
      if (!badge || !g0 || g0 === g) continue;
      const up = RANK[g] > RANK[g0];
      badge.classList.add(up ? 'up' : 'down');
      if (up) {
        ups += 1;
        setTimeout(() => {
          if (!badge.isConnected) return;
          const c = center(badge);
          ring(c.x, c.y, '#ffe14a', 0.9);
          sparks(c.x, c.y, '#fff6b0', 10, 0.5);
        }, settle + 120);
      }
    }
    const newStars = [...after.stars].filter((id) => !before.stars.has(id));
    setTimeout(() => {
      if (!root.isConnected) return;
      if (ups) {
        sfx.stamp();
        vibrate(14);
      }
      const net = syncMeters(true);
      for (const id of newStars) {
        const star = slots.map((x) => (heroAt(x) === id ? x.seat.querySelector('.lu-star.on') : null)).find(Boolean);
        if (star) cheerAt(star, '#ffe14a');
      }
      if (newStars.length) {
        sfx.learn();
        tell(`${hero(newStars[0]!).name}の特別作戦「${hero(newStars[0]!).passive}」が使えるようになりました！`, 'cheer');
      } else if (opts.stagger) tell('いちばん力の出る並びにしました！ 気になるところは、動かしてみてください。', 'sparkle');
      else if (net >= 2) tell(`ナイスです！ チームの力が +${net} 上がりました。`, 'cheer');
      else if (net <= -2) tell(`うーん、チームの力が ${net} …。元にもどすか、ほかの場所もためしてみましょう。`, 'think');
      else {
        lastLine = '';
        advise();
      }
    }, settle);

    if (JSON.stringify(next.off) !== offBefore) drawChalk('off', true);
    if (JSON.stringify(next.def) !== defBefore) drawChalk('def', true);
    sfx.chalk();
    mark();
  };

  /** Puts the held hero on a spot (or cancels when that changes nothing). */
  const putOn = (slot: Slot, origin?: Map<number, DOMRect>): boolean => {
    const id = held;
    if (id === null) return false;
    const l = s.lineup!;
    let next = l;
    if (slot.unit !== 'bench') next = place(l, slot.unit, slot.pos!, id);
    else if (isStarter(l, id)) next = place(l, 'off', OFF_POS.find((p) => l.off[p] === id)!, benchId());
    if (next === l) return false;
    sfx.drop();
    setTimeout(() => root.isConnected && sfx.swap(), 70);
    vibrate(12);
    const c = center(slot.el);
    ring(c.x, c.y, '#fffbe8', 1.3);
    burst(c.x, c.y, { color: ['#fffbe8', '#ffe14a'], count: 8, power: 0.5, size: 0.6, shape: 'dot' });
    change(next, { origin });
    return true;
  };

  const pick = (id: number, quiet = false): void => {
    held = id;
    if (!quiet) sfx.drag();
    lastLine = '';
    advise();
    mark();
  };
  const letGo = (): void => {
    if (held === null) return;
    for (const x of slots) if (heroAt(x) === held) kick(x.seat.firstElementChild, 'clack');
    held = null;
    sfx.drop();
    lastLine = '';
    advise();
    mark();
  };

  /** Tap, then tap: the first tap picks a hero up, the second puts them down. */
  const tap = (slot: Slot): void => {
    hover = slot; // on a touch screen there is no hover: the note explains the spot that was tapped
    const here = heroAt(slot);
    const c = center(slot.el);
    if (held === null) {
      pick(here);
      ring(c.x, c.y, TALENT_COLOR[talentOf(statsOf(here)).best], 1.1);
    } else if (held === here) letGo();
    else putOn(slot);
  };

  // ---------------------------------------------------------------- dragging

  const lift = (): void => {
    if (!drag) return;
    const mag = drag.from.seat.firstElementChild as HTMLElement | null;
    if (!mag) return;
    const ghost = mag.cloneNode(true) as HTMLElement;
    ghost.classList.add('lu-ghost');
    ghost.style.width = `${mag.getBoundingClientRect().width}px`;
    root.append(ghost);
    drag.ghost = ghost;
    pick(drag.id);
    vibrate(8);
  };
  const follow = (x: number, y: number): void => {
    if (!drag?.ghost) return;
    const lean = Math.max(-14, Math.min(14, (x - drag.x) * 0.6));
    drag.x = x;
    drag.y = y;
    drag.ghost.style.left = `${x}px`;
    drag.ghost.style.top = `${y}px`;
    drag.ghost.style.setProperty('--lean', `${lean}deg`);
    const el = document.elementFromPoint(x, y)?.closest('.lu-slot');
    const over = el ? bySlotEl.get(el) ?? null : null;
    const valid = over && heroAt(over) !== drag.id ? over : null;
    if (valid !== drag.over) {
      drag.over = valid;
      if (valid) sfx.hover();
      mark();
    }
  };
  /** The dragged magnet flies home: nothing changes. */
  const putBack = (): void => {
    const d = drag;
    if (!d?.ghost) return;
    const ghost = d.ghost;
    const from = d.from;
    d.ghost = null;
    d.over = null;
    held = null;
    sfx.back();
    lastLine = '';
    advise();
    mark();
    if (!motion()) {
      ghost.remove();
      return;
    }
    const home = from.seat.getBoundingClientRect();
    const now = ghost.getBoundingClientRect();
    const dx = home.left + home.width / 2 - (now.left + now.width / 2);
    const dy = home.top + home.height / 2 - (now.top + now.height / 2);
    from.el.classList.add('returning');
    ghost.animate([{ transform: 'translate(-50%, -62%) scale(1.18)' }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1)` }],
      { duration: 220, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' }).onfinish = () => {
      ghost.remove();
      from.el.classList.remove('returning');
      kick(from.seat.firstElementChild, 'clack');
    };
  };
  const release = (): void => {
    const d = drag;
    if (!d?.ghost) return;
    const over = d.over;
    if (!over) {
      putBack();
      return;
    }
    const origin = new Map([[d.id, d.ghost.getBoundingClientRect()]]);
    d.ghost.remove();
    d.ghost = null;
    d.over = null;
    if (!putOn(over, origin)) letGo();
  };

  // ---------------------------------------------------------------- buttons

  const auto = button('おまかせ', () => {
    const best = bestLineup(players);
    if (total(best) <= total(s.lineup!) + 0.01) {
      held = null;
      mark();
      for (const x of slots) kick(x.seat.querySelector('.portrait'), 'hop');
      lastLine = '';
      tell('もう、いちばん力の出る並びになっています！', 'sparkle');
      return;
    }
    held = null;
    vibrate([10, 30, 10]);
    change(best, { stagger: true });
  }, { cls: 'alt' });
  const ok = button('これでOK', () => {
    window.removeEventListener('keydown', onKey);
    back();
  }, { sound: 'confirm' });

  // ---------------------------------------------------------------- the screen

  const board = h('section.lu-board',
    h('div.lu-half.off', h('span.label', '攻撃'), fieldOf.off, metersOf('off')),
    h('div.lu-half.def', h('span.label.cyan', '守備'), fieldOf.def, metersOf('def')));
  const side = h('aside.lu-side', h('div.lu-bench', bench.el, h('span.lu-seatwood', { 'aria-hidden': 'true' })), note);
  const root = h('div.screen.lineup',
    backdrop(['FORMATION', '作戦ボード'], ['#0f4a4a', '#090d24', '#37e3ff']),
    h('header.head.pad', h('h2', '編成'), hint),
    h('main.lu-body.pad', board, side),
    h('footer.foot.pad', mgr.el, h('div.row', auto, ok)));

  const onKey = (e: KeyboardEvent): void => {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    if (modalOpen() || e.key !== 'Escape' || held === null) return;
    e.preventDefault();
    if (drag?.ghost) {
      putBack();
      drag = null;
    } else letGo();
  };
  window.addEventListener('keydown', onKey);

  render(null);
  mark();

  // the magnets snap on and the chalk draws itself once the screen is really visible
  const enter = (): void => {
    if (live) return;
    live = true;
    root.classList.add('live');
    drawChalk('off', true);
    drawChalk('def', true);
    sfx.chalk();
    if (motion()) slots.forEach((_, i) => setTimeout(() => root.isConnected && sfx.hover(), 60 + i * 45));
    setTimeout(() => {
      if (!root.isConnected) return;
      syncMeters(false);
      advise();
    }, 450);
  };
  root.addEventListener('shown', enter);
  setTimeout(enter, 1400);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (!live) return;
      drawChalk('off', false);
      drawChalk('def', false);
    }).observe(fieldOf.off);
  }
  return root;
}
