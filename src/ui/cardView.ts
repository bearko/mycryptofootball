// Play cards as things you can hold: they lean under the pointer, the chalk play draws itself when picked,
// special plays are foil cards with their hero on them.

import { h } from '../core/dom';
import { sfx } from '../core/audio';
import { DEF_INFO, KIND, OFF_INFO, READ_LABEL, READ_MAX, isRun, type DefType, type OffType, type SpecialCard } from '../game/cards';
import { hero } from '../game/heroes';
import type { Pick } from '../game/match';
import { ROLE_LABEL } from '../game/model';
import { kick, tilt } from './fx';
import { stars } from './kit';

type Pt = [number, number];
const O_LINE: Pt[] = [[40, 48], [60, 48]];
const O_WR: Pt[] = [[12, 48], [88, 48]];
const O_QB: Pt = [50, 57];
const O_RB: Pt = [50, 67];
const X_ALL: Pt[] = [[40, 39], [60, 39], [50, 29], [14, 33], [86, 33], [50, 12]];

const o = ([x, y]: Pt): string => `<circle class="o" cx="${x}" cy="${y}" r="3.8"/>`;
const x = ([cx, cy]: Pt): string => `<path class="x" d="M${cx - 3.2},${cy - 3.2}l6.4,6.4M${cx + 3.2},${cy - 3.2}l-6.4,6.4"/>`;
// pathLength="1" lets CSS draw any of these lines from start to end with one rule
const line = (cls: string, d: string): string => `<path class="${cls} draw" pathLength="1" d="${d}"/>`;

const OFF_ART: Record<OffType, string> = {
  inside: line('run', 'M50,63 L50,20') + line('head', 'M44,27 L50,18 L56,27'),
  outside: line('run', 'M50,65 Q80,65 83,22') + line('head', 'M76,28 L83,19 L89,29'),
  short: line('route', 'M12,44 L12,31 L29,31') + line('pass', 'M49,55 L31,34') + line('head', 'M31,43 L30,33 L39,35'),
  long: line('route', 'M88,44 L85,9') + line('pass', 'M52,55 Q72,24 84,10') + line('head', 'M76,13 L85,8 L87,18'),
};
const DEF_ART: Record<DefType, string> = {
  stuff: '<rect class="zone" x="32" y="24" width="36" height="24" rx="3"/>',
  contain: '<rect class="zone" x="3" y="22" width="22" height="28" rx="3"/><rect class="zone" x="75" y="22" width="22" height="28" rx="3"/>',
  zone: '<rect class="zone" x="5" y="20" width="90" height="17" rx="3"/>',
  deep: '<rect class="zone" x="5" y="3" width="90" height="18" rx="3"/>',
  blitz: line('rush', 'M40,39 L46,52') + line('rush', 'M60,39 L54,52') + line('rush', 'M50,29 L50,50') + line('rush', 'M14,33 L42,54') + line('rush', 'M86,33 L58,54') + line('head', 'M45,47 L50,54 L55,47'),
};

/** The chalk drawing on a card: O is the offense (bottom), X the defense (top). */
export function diagram(type: OffType | DefType, side: 'off' | 'def'): HTMLElement {
  const off = side === 'off';
  const box = h('span.card-art', { class: off ? 'art-off' : 'art-def' });
  box.innerHTML = `<svg viewBox="0 0 100 74" aria-hidden="true">
    <path class="los" d="M3,44 H97"/>
    ${X_ALL.map(x).join('')}${[...O_LINE, ...O_WR, O_QB, O_RB].map(o).join('')}
    ${off ? OFF_ART[type as OffType] : DEF_ART[type as DefType]}
  </svg>`;
  return box;
}

export interface CardOpts {
  onpick?: () => void;
  selected?: boolean;
  /** why it cannot be played */
  blocked?: string | null;
  /** how well the other side already reads this special (0..READ_MAX) */
  read?: number;
  /** the team's momentum now (lights the cost) */
  mom?: number;
  /** position in the hand: used for the deal animation and the number key */
  index?: number;
  /** show the number key hint */
  key?: boolean;
  /** play the deal-in animation */
  deal?: boolean;
  small?: boolean;
}

export const cardName = (pick: Pick, side: 'off' | 'def'): string =>
  pick.special ? pick.special.name : side === 'off' ? OFF_INFO[pick.type as OffType].name : DEF_INFO[pick.type as DefType].name;

export function playCard(pick: Pick, side: 'off' | 'def', opts: CardOpts = {}): HTMLButtonElement {
  const sp = pick.special;
  const kind = side === 'def' ? 'def' : isRun(pick.type as OffType) ? 'run' : 'pass';
  const cls = [side, kind, sp ? 'special' : '', opts.selected ? 'selected' : '', opts.blocked ? 'blocked' : '', opts.small ? 'small' : '', opts.deal ? 'deal' : '']
    .filter(Boolean).join(' ');
  const inner = h('span.card-in');
  const btn: HTMLButtonElement = h('button.card', {
    class: cls, type: 'button', style: { '--i': String(opts.index ?? 0) },
    onclick: () => {
      if (opts.blocked) {
        sfx.deny();
        kick(btn, 'nope');
        return;
      }
      opts.onpick?.();
    },
  }, inner);
  if (sp) {
    const info = KIND[sp.kind];
    const read = opts.read ?? 0;
    inner.append(
      h('span.foil'),
      h('span.sp-name', sp.name),
      h('span.sp-hero', h('img.px', { src: hero(sp.owner).img, alt: '', draggable: false })),
      h('span.sp-tag', info.tag, sp.boost ? h('b', '+') : null),
      h('span.sp-foot',
        h('span.cost', { title: `流れを${info.cost}使う` }, Array.from({ length: info.cost }, (_, i) => h('i.flame', { class: (opts.mom ?? 99) > i ? 'on' : '' }))),
        h('span.read', { class: `r${read}`, title: READ_LABEL[read] ?? '' }, Array.from({ length: READ_MAX }, (_, i) => h('i', { class: i < read ? 'on' : '' })), h('u', READ_LABEL[read] ?? ''))),
    );
    if (opts.blocked) inner.append(h('span.card-why', opts.blocked));
  } else {
    const info = side === 'off' ? OFF_INFO[pick.type as OffType] : DEF_INFO[pick.type as DefType];
    inner.append(
      h('span.card-band', h('span.card-name', info.name), stars(pick.star)),
      diagram(pick.type, side),
      h('span.card-vs', h('i.good', h('u', '◎'), info.good), h('i.bad', h('u', '×'), info.bad)),
      h('span.card-kind', kind === 'run' ? 'ラン' : kind === 'pass' ? 'パス' : '守備'),
    );
  }
  inner.append(h('span.card-glare'));
  if (opts.key && opts.index !== undefined) inner.append(h('span.card-key', String(opts.index + 1)));
  if (!opts.small) tilt(btn, 9);
  return btn;
}

/** The back of a card (the other side's pick before it is turned over). */
export function cardBack(small = true): HTMLElement {
  return h('div.card.back', { class: small ? 'small' : '' }, h('span.card-in', h('span.back-art', '?')));
}

/** What a special play does, in words, with where its owner has to line up. */
export function specialText(sp: SpecialCard): string {
  const info = KIND[sp.kind];
  const where = info.roles ? `${info.roles.map((r) => ROLE_LABEL[r]).join('か')}で出場中に使える` : '出場していれば使える';
  return `${info.text}。${info.side === 'off' ? '攻撃' : '守備'}の作戦／流れ${info.cost}／${where}`;
}
