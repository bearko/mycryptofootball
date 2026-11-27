// What a club has done over the years (game/feats.ts): kept as the matches end, read for the achievements, the total
// score and the RTA's splits.
import { describe, expect, it } from 'vitest';
import { SCHEDULE, newSeason, type Season } from '../src/game/season';
import { ACHIEVEMENTS, achieved, careerOf, daysPlayed, noteFeat, scoreOf, splitsReached } from '../src/game/feats';
import { runSeason } from './bot';

describe('the club\'s record', () => {
  it('is kept as the matches of a year are played', () => {
    const { season: s } = runSeason(5);
    const c = careerOf(s);
    expect(c.wins).toBe(s.results.filter((r) => r.win).length);
    expect(c.best).toBeGreaterThanOrEqual(s.tier);
    const finals = s.results.filter((r) => r.win && r.opp === 3).length;
    expect(c.titles.reduce((a, b) => a + b, 0)).toBe(finals);
  });

  it('starts from a season saved before it was kept', () => {
    const s = newSeason(3);
    s.tier = 2;
    expect(careerOf(s)).toEqual({ wins: 0, titles: [0, 0, 0, 0], best: 2 });
  });
});

describe('the achievements', () => {
  it('follow what the club has done, in the order a club reaches them', () => {
    const s: Season = newSeason(4);
    expect(achieved(s)).toEqual([]);
    s.career = { wins: 1, titles: [1, 0, 0, 1], best: 6, eleven: true, summits: 1 };
    noteFeat(s, 'special_td');
    noteFeat(s, 'special_td');
    noteFeat(s, 'onside');
    s.alumni = { 5019: { n: 1, year: 3 } };
    expect(achieved(s)).toEqual([...ACHIEVEMENTS]);
    expect(s.career.feats).toEqual(['special_td', 'onside']);
    expect(scoreOf(s)).toEqual({ tier: 6, years: 1, wins: 1, titles: [1, 0, 0, 1], nation: true, summit: true });
  });

  it('give the RTA its splits in order', () => {
    const s = newSeason(4);
    s.career = { wins: 2, titles: [0, 0, 0, 0], best: 1 };
    expect(splitsReached(s)).toEqual(['first_win', 'club']);
  });
});

describe('the days played (the RTA\'s time in the game)', () => {
  it('count the calendar from April 5, across the years', () => {
    const s = newSeason(4);
    expect(daysPlayed(s)).toBe(1);
    const springFinal = SCHEDULE.findIndex((d) => d.cup && d.stage === 'spring' && d.round === 3);
    s.day = springFinal;
    const d = SCHEDULE[springFinal]!;
    expect(`${d.month}/${d.date}`).toBe('5/2');
    expect(daysPlayed(s)).toBe(28);
    s.year = 2;
    expect(daysPlayed(s)).toBe(365 + 28);
  });
});
