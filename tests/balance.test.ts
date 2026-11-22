import { describe, expect, it } from 'vitest';
import { runSeason, type Style } from './bot';
import { SCHEDULE, learned } from '../src/game/season';

/** The first year's matches, one row per match of the calendar (a club that is knocked out plays fewer). */
function report(style: Style, n: number) {
  const rows = new Map<number, { played: number; won: number; us: number; them: number; plays: number }>();
  let champions = 0;
  let springChampions = 0;
  let learnedAtEnd = 0;
  for (let seed = 1; seed <= n; seed += 1) {
    const { season, matches } = runSeason(seed * 7919, style);
    if (season.champion) champions += 1;
    if (season.results.some((r) => r.win && r.opp === 3 && SCHEDULE[r.day]!.stage === 'spring')) springChampions += 1;
    learnedAtEnd += season.members.filter(learned).length;
    season.results.forEach((r, i) => {
      const row = rows.get(r.day) ?? { played: 0, won: 0, us: 0, them: 0, plays: 0 };
      row.played += 1;
      row.won += r.win ? 1 : 0;
      row.us += r.us;
      row.them += r.them;
      row.plays += matches[i]!.n;
      rows.set(r.day, row);
    });
  }
  const table = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([day, r]) => ({
    match: SCHEDULE[day]!.label,
    stage: SCHEDULE[day]!.stage,
    round: SCHEDULE[day]!.round,
    played: r.played,
    win: +(r.won / Math.max(1, r.played)).toFixed(2),
    us: +(r.us / Math.max(1, r.played)).toFixed(1),
    them: +(r.them / Math.max(1, r.played)).toFixed(1),
    plays: +(r.plays / Math.max(1, r.played)).toFixed(1),
  }));
  return { table, champion: champions / n, spring: springChampions / n, learned: learnedAtEnd / n };
}

describe('the first year\'s balance (the computer plays both sides)', () => {
  const sensible = report('sensible', 300);
  const careless = report('careless', 300);
  if (process.env.BALANCE) {
    console.table(sensible.table);
    console.log('sensible: champion (autumn)', sensible.champion, 'spring', sensible.spring, 'specials learned', sensible.learned);
    console.table(careless.table);
    console.log('careless: champion (autumn)', careless.champion, 'spring', careless.spring, 'specials learned', careless.learned);
  }

  it('in both tournaments the practice match is winnable and the final is hard', () => {
    for (const stage of ['spring', 'autumn']) {
      const at = (round: number) => sensible.table.find((r) => r.stage === stage && r.round === round)!;
      expect(at(0).win).toBeGreaterThan(0.6);
      expect(at(1).win).toBeGreaterThan(0.5);
      expect(at(2).win).toBeGreaterThan(0.3);
      expect(at(3).win).toBeGreaterThan(0.2);
      expect(at(3).win).toBeLessThan(0.75);
    }
  });

  it('a careful coach wins the title far more often than a careless one', () => {
    expect(sensible.champion).toBeGreaterThan(0.05);
    expect(sensible.champion).toBeLessThan(0.5);
    expect(sensible.champion).toBeGreaterThan(careless.champion * 1.5);
  });

  it('games have points in them', () => {
    for (const row of sensible.table) expect(row.us + row.them).toBeGreaterThan(14);
  });
});
