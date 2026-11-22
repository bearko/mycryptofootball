// The review: how every hero's abilities have changed since this part of the year began (the spring, the summer, the
// camp, the autumn), with the rank each one stands at. It opens by itself on the first day of the next part (looking
// back on the one just over), and from the practice ground at any time (so far).

import { sfx } from '../core/audio';
import { h } from '../core/dom';
import { hero } from '../game/heroes';
import { RANKS, STATS, STAT_LABEL, rank } from '../game/model';
import { SCHEDULE, STAGE_NAME, growth, spanText, type Season } from '../game/season';
import { TALENT_COLOR, button, closeModal, modal, portrait, rankChip, statIcon } from './kit';
import { talentOf } from '../game/heroes';

const day = (n: number): string => `${SCHEDULE[n]!.month}月${SCHEDULE[n]!.date}日`;
/** the last date a calendar slot covers ("5月16日" for the fortnight from May 3) */
function until(n: number): string {
  const d = SCHEDULE[n]!;
  if (d.days <= 1) return day(n);
  const end = spanText(d).split('〜')[1]!;
  return end.includes('月') ? end : `${d.month}月${end}`;
}

export function reviewModal(s: Season, opts: { closed: boolean; onClose?: () => void }): void {
  const g = growth(s, opts.closed);
  const stage = STAGE_NAME[SCHEDULE[g.to]!.stage];
  const title = opts.closed ? `${stage}${stage === '夏合宿' ? '' : 'の期間'}の成長` : 'この期間の成長';
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
      h('p.rv-when', `${day(g.from)}〜${until(g.to)}`),
      h('p.rv-total', 'チーム全体で ', h('b', g.total > 0 ? `+${g.total}` : String(g.total)), ups ? h('span', `ランクアップ ${ups}`) : null)),
    h('div.rv-table', head, ...rows),
    h('div.modal-actions',
      h('p.rv-legend', ...RANKS.map((r, i) => h('span', h('i.rank', { class: `r-${r.name}` }, r.name), i < RANKS.length - 1 ? `${r.min}〜${RANKS[i + 1]!.min - 1}` : `${r.min}〜`))),
      button(opts.closed ? 'つぎもがんばろう' : 'とじる', () => {
      closeModal();
      opts.onClose?.();
    }, opts.closed ? { cls: 'go' } : { sound: 'back' }))), { cls: 'wide rv-panel', title, sticky: opts.closed, quiet: true });
  (ups ? sfx.trustUp : sfx.open)();
}
