import { describe, expect, it } from 'vitest';
import { RANKS, STATS, STAT_MAX, rank, rankIndex } from '../src/game/model';
import { ROSTER_SIZE, SCHEDULE, growth, markMonth, mend, newSeason, plan, signRecruits, startDay, train } from '../src/game/season';

describe('ranks', () => {
  it('the scale: G under 20, F under 40, then a letter every ten, SS from 100', () => {
    const want: [number, string][] = [
      [0, 'G'], [19, 'G'], [20, 'F'], [39, 'F'], [40, 'E'], [49, 'E'], [50, 'D'], [59, 'D'], [60, 'C'], [69, 'C'],
      [70, 'B'], [79, 'B'], [80, 'A'], [89, 'A'], [90, 'S'], [99, 'S'], [100, 'SS'], [STAT_MAX, 'SS'],
    ];
    for (const [v, r] of want) expect(rank(v)).toBe(r);
    expect(RANKS.map((r) => r.name)).toEqual(['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS']);
    expect(rankIndex(100)).toBe(8);
    // an ability can be trained past 99, or SS could never be seen
    expect(STAT_MAX).toBeGreaterThan(100);
  });
});

describe('the month\'s review', () => {
  const start = () => {
    const s = newSeason(4);
    signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
    return s;
  };

  it('counts from the day the heroes joined: nothing gained yet', () => {
    const s = start();
    const g = growth(s);
    expect(g.total).toBe(0);
    expect(g.rows.length).toBe(ROSTER_SIZE);
    expect(g.from).toBe(0);
    expect(s.review).toBe(false);
  });

  it('adds up what practice gave, ability by ability, and notices a rank going up', () => {
    const s = start();
    const before = s.members.map((m) => ({ ...m.stats }));
    for (let i = 0; i < 5 && plan(s).t === 'train'; i += 1) {
      s.event = null;
      train(s, 0);
    }
    const g = growth(s);
    s.members.forEach((m, i) => {
      const row = g.rows.find((r) => r.id === m.id)!;
      expect(row.before).toEqual(before[i]);
      expect(row.after).toEqual(m.stats);
      expect(row.total).toBe(STATS.reduce((v, k) => v + m.stats[k] - before[i]![k], 0));
      for (const k of STATS) expect(row.ups.includes(k)).toBe(rankIndex(m.stats[k]) > rankIndex(before[i]![k]));
    });
    expect(g.total).toBeGreaterThan(0);
    // a rank-up is found when there is one
    const m = s.members[0]!;
    s.base![m.id] = { ...m.stats, spd: 39 };
    m.stats.spd = 41;
    expect(growth(s).rows[0]!.ups).toContain('spd');
  });

  it('comes up on the first day of a new month, looks back as far as yesterday, and then counts afresh', () => {
    const s = start();
    const first = SCHEDULE.findIndex((d) => d.month !== SCHEDULE[0]!.month);
    expect(first).toBeGreaterThan(0);
    for (let day = 1; day < SCHEDULE.length; day += 1) {
      s.day = day;
      s.review = false;
      startDay(s);
      expect(!!s.review).toBe(day === first);
    }
    s.day = first;
    s.members[0]!.stats.spd += 7;
    startDay(s);
    const g = growth(s, true);
    expect(g.from).toBe(0);
    expect(g.to).toBe(first - 1);
    expect(SCHEDULE[g.to]!.month).toBe(SCHEDULE[0]!.month);
    expect(g.total).toBe(7);
    markMonth(s);
    expect(s.review).toBe(false);
    expect(growth(s).total).toBe(0);
    expect(growth(s).from).toBe(first);
  });

  it('a season saved before the review existed starts counting from today', () => {
    const s = start();
    delete s.base;
    delete s.baseDay;
    s.day = 9;
    mend(s);
    expect(growth(s).total).toBe(0);
    expect(growth(s).from).toBe(9);
  });
});
