// Pieces shared by several screens: hero sprites, ability bars, play cards, pop-ups.

import catalog from '../generated/catalog.json';
import { blip, toggleMute } from '../core/audio';
import { h } from '../core/dom';
import { save } from '../core/save';
import {
  DEF_INFO, KIND, OFF_INFO, READ_LABEL, isRun, type DefType, type OffType, type SpecialCard,
} from '../game/cards';
import { hero, talentOf } from '../game/heroes';
import type { Pick } from '../game/match';
import { ROLE_LABEL, STATS, STAT_LABEL, type Stats } from '../game/model';
import { TRUST_BOOST, TRUST_LEARN, TRUST_MAX } from '../game/season';

const CHARS = catalog.chars as Record<string, string>;

export function sprite(id: number, cls = ''): HTMLImageElement {
  return h('img.sprite', { class: cls, src: hero(id).img, alt: '', draggable: false });
}

export const stars = (n: number): HTMLElement =>
  h('span.stars', { title: `★${n}` }, '★'.repeat(n), h('i', '★'.repeat(3 - n)));

export function statBars(stats: Stats, compare?: Stats): HTMLElement {
  const { best } = talentOf(stats);
  return h('div.bars', STATS.map((k) => {
    const diff = compare ? stats[k] - compare[k] : 0;
    return h('div.bar', { class: k === best ? 'best' : '' },
      h('span.bar-name', STAT_LABEL[k]),
      h('span.bar-track', h('span.bar-fill', { style: { width: `${stats[k]}%` } })),
      h('span.bar-num', stats[k], diff > 0 ? h('b', ` +${diff}`) : null));
  }));
}

export function trustBar(trust: number): HTMLElement {
  return h('div.trust', { title: `信頼 ${trust}` },
    h('span.trust-fill', { style: { width: `${(trust / TRUST_MAX) * 100}%` } }),
    h('span.trust-mark', { style: { left: `${(TRUST_LEARN / TRUST_MAX) * 100}%` } }),
    h('span.trust-mark', { style: { left: `${(TRUST_BOOST / TRUST_MAX) * 100}%` } }));
}

/** The small chip that names a hero's one great ability. */
export const talentChip = (stats: Stats): HTMLElement => h('span.chip.talent', STAT_LABEL[talentOf(stats).best]);

// ------------------------------------------------------------------ play diagrams

type Pt = [number, number];
const O_LINE: Pt[] = [[42, 48], [58, 48]];
const O_WR: Pt[] = [[12, 48], [88, 48]];
const O_QB: Pt = [50, 56];
const O_RB: Pt = [50, 65];
const X_ALL: Pt[] = [[42, 40], [58, 40], [50, 30], [14, 34], [86, 34], [50, 13]];

const o = ([x, y]: Pt, cls = ''): string => `<circle class="o ${cls}" cx="${x}" cy="${y}" r="3.6"/>`;
const x = ([cx, cy]: Pt, cls = ''): string =>
  `<path class="x ${cls}" d="M${cx - 3},${cy - 3}l6,6M${cx + 3},${cy - 3}l-6,6"/>`;

const OFF_ART: Record<OffType, string> = {
  inside: '<path class="run" d="M50,62 L50,20"/><path class="head" d="M45,26 L50,18 L55,26"/>',
  outside: '<path class="run" d="M50,64 Q78,64 82,22"/><path class="head" d="M76,27 L82,19 L87,28"/>',
  short: '<path class="route" d="M12,45 L12,33 L28,33"/><path class="pass" d="M49,54 L30,35"/><path class="head" d="M30,42 L29,34 L37,35"/>',
  long: '<path class="route" d="M88,45 L85,10"/><path class="pass" d="M52,54 Q72,24 84,11"/><path class="head" d="M77,13 L85,9 L86,18"/>',
};
const DEF_ART: Record<DefType, string> = {
  stuff: '<rect class="zone" x="34" y="26" width="32" height="22" rx="3"/>',
  contain: '<rect class="zone" x="4" y="24" width="20" height="26" rx="3"/><rect class="zone" x="76" y="24" width="20" height="26" rx="3"/>',
  zone: '<rect class="zone" x="6" y="22" width="88" height="15" rx="3"/>',
  deep: '<rect class="zone" x="6" y="4" width="88" height="17" rx="3"/>',
  blitz: '<path class="rush" d="M42,40 L47,52M58,40 L53,52M50,30 L50,50M14,34 L42,54M86,34 L58,54"/><path class="head" d="M46,47 L50,53 L54,47"/>',
};

/** The little chalk drawing on a card: O is the offense (bottom), X the defense (top). */
export function diagram(type: OffType | DefType, side: 'off' | 'def'): HTMLElement {
  const off = side === 'off';
  const box = h('div.art', { class: off ? 'art-off' : 'art-def' });
  box.innerHTML = `<svg viewBox="0 0 100 72" aria-hidden="true">
    <path class="los" d="M4,44 H96"/>
    ${X_ALL.map((p) => x(p)).join('')}
    ${[...O_LINE, ...O_WR, O_QB, O_RB].map((p) => o(p)).join('')}
    ${off ? OFF_ART[type as OffType] : DEF_ART[type as DefType]}
  </svg>`;
  return box;
}

// ------------------------------------------------------------------ cards

export interface CardOpts {
  onpick?: () => void;
  selected?: boolean;
  /** why it cannot be played */
  blocked?: string | null;
  /** read level of a special (how well the other side knows it) */
  read?: number;
  /** momentum the team has now (to light the cost pips) */
  mom?: number;
  face?: 'up' | 'down';
  small?: boolean;
}

export function playCard(pick: Pick, side: 'off' | 'def', opts: CardOpts = {}): HTMLButtonElement {
  const sp = pick.special;
  const cls = [side, sp ? 'special' : '', opts.selected ? 'selected' : '', opts.blocked ? 'blocked' : '', opts.small ? 'small' : '']
    .filter(Boolean).join(' ');
  const btn = h('button.card', {
    class: cls, type: 'button',
    onclick: () => {
      if (opts.blocked) {
        blip.no();
        return;
      }
      opts.onpick?.();
    },
  });
  if (opts.face === 'down') {
    btn.classList.add('down');
    btn.append(h('div.card-back', '?'));
    return btn;
  }
  if (sp) {
    const info = KIND[sp.kind];
    btn.append(
      h('div.card-top', h('span.card-name', sp.name)),
      h('div.card-hero', sprite(sp.owner), h('span.card-owner', hero(sp.owner).name)),
      h('div.card-tag', info.tag, sp.boost ? h('b', ' 強化') : null),
      h('div.card-foot',
        h('span.cost', { title: `流れを${info.cost}使う` },
          Array.from({ length: info.cost }, (_, i) => h('i', { class: (opts.mom ?? 99) > i ? 'on' : '' }))),
        opts.blocked ? h('span.why', opts.blocked)
          : h('span.read', { class: `r${opts.read ?? 0}` }, READ_LABEL[opts.read ?? 0]!)),
    );
    return btn;
  }
  const info = side === 'off' ? OFF_INFO[pick.type as OffType] : DEF_INFO[pick.type as DefType];
  const kind = side === 'off' ? (isRun(pick.type as OffType) ? 'ラン' : 'パス') : '守備';
  btn.append(
    h('div.card-top', h('span.card-name', info.name), stars(pick.star)),
    diagram(pick.type, side),
    h('div.card-vs', h('span.good', `◎ ${info.good}`), h('span.bad', `× ${info.bad}`)),
    h('span.card-kind', kind),
  );
  return btn;
}

/** What a special play does, in words, with where its owner has to line up. */
export function specialText(sp: SpecialCard): string {
  const info = KIND[sp.kind];
  const where = info.roles ? `${info.roles.map((r) => ROLE_LABEL[r]).join('か')}で出場中に使える` : '出場していれば使える';
  return `${info.text}。${info.side === 'off' ? '攻撃' : '守備'}の作戦・流れ${info.cost}・${where}`;
}

// ------------------------------------------------------------------ pop-ups

let modalRoot: HTMLElement | null = null;

export function closeModal(): void {
  modalRoot?.remove();
  modalRoot = null;
}

/** A centered panel over the screen. `sticky` panels cannot be dismissed by tapping outside. */
export function modal(content: HTMLElement, opts: { sticky?: boolean; cls?: string } = {}): HTMLElement {
  closeModal();
  const panel = h('div.modal-panel', { class: opts.cls ?? '', onclick: (e: Event) => e.stopPropagation() }, content);
  modalRoot = h('div.modal', { onclick: () => { if (!opts.sticky) closeModal(); } }, panel);
  document.body.append(modalRoot);
  return modalRoot;
}

export function button(label: string | Node, onclick: () => void, cls = ''): HTMLButtonElement {
  return h('button.btn', {
    class: cls, type: 'button',
    onclick: () => {
      blip.tap();
      onclick();
    },
  }, label);
}

/** The club manager with one line to say. */
export function manager(text: string, pose: keyof typeof CHARS | string = 'talk'): HTMLElement {
  return h('div.manager',
    h('img.sprite', { src: CHARS[pose] ?? CHARS.talk, alt: '', draggable: false }),
    h('p', text));
}

export function muteButton(): HTMLButtonElement {
  const label = (): string => (save().mute ? '音 OFF' : '音 ON');
  const b: HTMLButtonElement = h('button.btn.ghost.mini', {
    type: 'button',
    onclick: () => {
      toggleMute();
      b.textContent = label();
    },
  }, label());
  return b;
}

export function helpModal(): void {
  const rule = (title: string, text: string): HTMLElement => h('li', h('b', title), h('span', text));
  modal(h('div.help',
    h('h2', 'あそびかた'),
    h('ul',
      rule('目標', '地区大会で3回勝って優勝する。負けたらその年はおしまい。'),
      rule('攻撃', '4回の攻撃で10ヤード進めば、また4回攻められる。相手側の端まで運べばタッチダウンで7点。'),
      rule('作戦カード', '攻撃も守備も、毎回配られるカードから1枚えらぶ。相手のカードとの相性（◎と×）で結果が大きく変わる。'),
      rule('ヒーロー', '全員が一芸もち。得意に合うポジションに置くと活躍する。同じ6人が攻撃も守備もする。'),
      rule('特別作戦', '練習で信頼が40たまると、ヒーローごとの特別作戦を覚える。試合中にたまる「流れ」を使って出す。'),
      rule('読まれる', '同じ特別作戦は、使うたびに相手に読まれて弱くなる。ここぞで使おう。'),
    ),
    button('とじる', closeModal, 'primary')));
}
