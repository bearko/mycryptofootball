// The calendar strip: twenty-eight days as tiles on a track. It starts at yesterday (older days are done with),
// today is the big tile next to it, and the rest of the strip is what is coming: the days ahead, as far as fits.
// When a day passes the strip slides one tile and the ball rolls on.

import { h } from '../../core/dom';
import { DOW, SCHEDULE, dateText, nextMatch, plan, type Season } from '../../game/season';
import { OPPONENTS } from '../../game/teams';
import { kick } from '../fx';

export interface Calendar {
  el: HTMLElement;
  /** Brings the strip in line with the season. `from`: the day to slide on from (null: just place). */
  set: (s: Season, from?: number | null) => void;
}

const short = (label: string): string => label.replace('地区大会 ', '');

export function calendar(s: Season): Calendar {
  const tiles = SCHEDULE.map((d) => {
    const opp = d.t === 'match' ? OPPONENTS[d.opp]! : null;
    const dow = d.dow === 5 ? 'is-sat' : d.dow === 6 ? 'is-sun' : '';
    return h('li.cal-day', { class: `is-${d.t} ${dow} ${d.cup ? 'is-cup' : ''}`, style: { '--oc': opp?.color ?? '' } },
      h('span.cal-date', h('b', String(d.date)), h('i', DOW[d.dow])),
      h('span.cal-full', dateText(d)),
      d.t === 'match'
        ? h('span.cal-flag', d.cup ? h('i.cal-hot') : null, short(d.label))
        : h('i.cal-mark'),
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
        if (d.t === 'match') text = d.cup ? '負けたら終わり' : '試合の日！';
        else if (next) text = next.n - n === 1 ? `あしたは${short(next.label)}` : `あと${next.n - n}日で${short(next.label)}`;
      } else if (d.t === 'train') text = n < st.day ? '✓' : '';
      if (note.textContent !== text) note.textContent = text;
      note.className = `cal-note ${cls}`;
    });
    // the strip starts at yesterday
    el.style.setProperty('--o', String(Math.max(0, st.day - 1)));
    el.classList.toggle('is-first', st.day === 0);
    el.setAttribute('aria-label', `カレンダー：きょうは${dateText(plan(st))}`);
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
