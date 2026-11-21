// The month's review: how every hero's abilities have changed since the month began, with the rank each one stands at.
// It opens by itself on the first day of a new month (looking back on the month just ended), and from the practice
// ground at any time (the month so far).

import { sfx } from '../core/audio';
import { h } from '../core/dom';
import { hero } from '../game/heroes';
import { RANKS, STATS, STAT_LABEL, rank } from '../game/model';
import { SCHEDULE, growth, type Season } from '../game/season';
import { TALENT_COLOR, button, closeModal, modal, portrait, rankChip, statIcon } from './kit';
import { talentOf } from '../game/heroes';

const day = (n: number): string => `${SCHEDULE[n]!.month}月${SCHEDULE[n]!.date}日`;

export function reviewModal(s: Season, opts: { closed: boolean; onClose?: () => void }): void {
  const g = growth(s, opts.closed);
  const title = opts.closed ? `${SCHEDULE[g.to]!.month}月の成長` : '今月の成長';
  const ups = g.rows.reduce((n, r) => n + r.ups.length, 0);
  const head = h('div.rv-row.rv-head',
    h('span'),
    ...STATS.map((k) => h('span.rv-stat', { class: `t-${k}` }, statIcon(k), STAT_LABEL[k])),
    h('span.rv-sum', '合計'));
  const rows = g.rows.map((r, i) => {
    const best = talentOf(r.after).best;
    return h('div.rv-row', { style: { '--i': String(i) } },
      h('div.rv-who', portrait(r.id, { color: TALENT_COLOR[best] }), h('b', hero(r.id).name)),
      ...STATS.map((k) => {
        const d = r.after[k] - r.before[k];
        const up = r.ups.includes(k);
        return h('div.rv-cell', { class: `${d > 0 ? 'grew' : d < 0 ? 'fell' : ''} ${up ? 'up' : ''}`, 'aria-label': `${STAT_LABEL[k]} ${r.after[k]}（ランク${rank(r.after[k])}）${d ? `、${d > 0 ? '+' : ''}${d}` : ''}` },
          h('span.rv-now', up ? [rankChip(r.before[k]), h('u', '▶')] : null, rankChip(r.after[k]), h('b', String(r.after[k]))),
          h('span.rv-diff', d ? `${d > 0 ? '+' : ''}${d}` : '±0'));
      }),
      h('div.rv-sum', { class: r.total > 0 ? 'grew' : '' }, r.total > 0 ? `+${r.total}` : String(r.total)));
  });
  modal(h('div.review',
    h('div.rv-top',
      h('p.rv-when', `${day(g.from)}〜${day(g.to)}`),
      h('p.rv-total', 'チーム全体で ', h('b', g.total > 0 ? `+${g.total}` : String(g.total)), ups ? h('span', `ランクアップ ${ups}`) : null)),
    h('div.rv-table', head, ...rows),
    h('div.modal-actions',
      h('p.rv-legend', ...RANKS.map((r, i) => h('span', h('i.rank', { class: `r-${r.name}` }, r.name), i < RANKS.length - 1 ? `${r.min}〜${RANKS[i + 1]!.min - 1}` : `${r.min}〜`))),
      button(opts.closed ? '今月もがんばろう' : 'とじる', () => {
      closeModal();
      opts.onClose?.();
    }, opts.closed ? { cls: 'go' } : { sound: 'back' }))), { cls: 'wide rv-panel', title, sticky: opts.closed, quiet: true });
  (ups ? sfx.trustUp : sfx.open)();
}
