// The calendar strip: the year's days as tiles on a track (between the tournaments a tile is a fortnight, at the
// camp it is orange). It starts at yesterday (older days are done with),
// today is the big tile next to it, and the rest of the strip is what is coming: the days ahead, as far as fits.
// When a day passes the strip slides one tile and the ball rolls on.

import { h } from '../../core/dom';
import { DOW, SCHEDULE, daysTo, nextMatch, plan, roundOf, schoolAt, spanText, weeksOf, type Season } from '../../game/season';
import { kick } from '../fx';

export interface Calendar {
  el: HTMLElement;
  /** Brings the strip in line with the season. `from`: the day to slide on from (null: just place). */
  set: (s: Season, from?: number | null) => void;
}


export function calendar(s: Season): Calendar {
  const tiles = SCHEDULE.map((d) => {
    const opp = d.t === 'match' ? schoolAt(s, d.m) : null;
    const weeks = weeksOf(d);
    const dow = weeks ? '' : d.dow === 5 ? 'is-sat' : d.dow === 6 ? 'is-sun' : '';
    return h('li.cal-day', { class: `is-${d.t} ${dow} ${d.cup ? 'is-cup' : ''} ${weeks ? 'is-span' : ''} ${d.stage === 'camp' ? 'is-camp' : ''}`, style: { '--oc': opp?.color ?? '' } },
      weeks ? h('span.cal-date', h('b', d.label), h('i', `${Math.round(weeks)}週間`))
        // a day after a fortnight, or the first of a month: with its month, so "4" is not taken for April
        : h('span.cal-date', h('b', d.n > 0 && (SCHEDULE[d.n - 1]!.days > 1 || SCHEDULE[d.n - 1]!.month !== d.month) ? `${d.month}/${d.date}` : String(d.date)), h('i', DOW[d.dow])),
      h('span.cal-full', spanText(d)),
      d.t === 'match'
        ? h('span.cal-flag', d.cup ? h('i.cal-hot') : null, roundOf(d))
        : d.scrim ? h('span.cal-flag', '紅白戦') : h('i.cal-mark'),
      h('span.cal-note'));
  });
  const ball = h('i.fball.cal-ball');
  const track = h('ol.cal-days', tiles);
  const el = h('div.cal', { role: 'group' }, h('div.cal-window', track), ball);

  const draw = (st: Season): void => {
    const next = nextMatch(st);
    tiles.forEach((li, n) => {
      const d = SCHEDULE[n]!;
      li.classList.toggle('is-past', n < st.day);
      li.classList.toggle('is-today', n === st.day);
      const note = li.lastElementChild as HTMLElement;
      const res = st.results.find((r) => r.day === n);
      let text = '';
      let cls = '';
      if (res) {
        text = `${res.win ? '○' : '●'}${res.us}-${res.them}`;
        cls = res.win ? 'is-win' : 'is-lose';
      } else if (n === st.day) {
        const until = next ? daysTo(st, next) : 0;
        if (d.t === 'match') text = d.cup ? (d.stage === 'spring' ? '春の大会' : '負けたら終わり') : '試合の日！';
        else if (next) text = until <= 1 ? `あしたは${roundOf(next)}` : `あと${until}日で${roundOf(next)}`;
      } else if (d.t === 'train') text = n < st.day ? '✓' : '';
      if (note.textContent !== text) note.textContent = text;
      note.className = `cal-note ${cls}`;
    });
    // the strip starts at yesterday
    el.style.setProperty('--o', String(Math.max(0, st.day - 1)));
    el.classList.toggle('is-first', st.day === 0);
    el.setAttribute('aria-label', `カレンダー：きょうは${spanText(plan(st))}`);
  };

  return {
    el,
    set: (st, from = null) => {
      if (from !== null && from < st.day) {
        el.classList.add('is-sliding');
        kick(ball, 'is-roll');
        setTimeout(() => el.classList.remove('is-sliding'), 620);
      }
      draw(st);
    },
  };
}
