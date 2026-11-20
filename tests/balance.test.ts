import { describe, expect, it } from 'vitest';
import { runSeason, type Style } from './bot';
import { OPPONENTS } from '../src/game/teams';
import { learned } from '../src/game/season';

function report(style: Style, n: number) {
  const rounds = OPPONENTS.map(() => ({ played: 0, won: 0, us: 0, them: 0, plays: 0 }));
  let champions = 0;
  let learnedAtEnd = 0;
  for (let seed = 1; seed <= n; seed += 1) {
    const { season, matches } = runSeason(seed * 7919, style);
    if (season.champion) champions += 1;
    learnedAtEnd += season.members.filter(learned).length;
    season.results.forEach((r, i) => {
      const row = rounds[r.opp]!;
      row.played += 1;
      row.won += r.win ? 1 : 0;
      row.us += r.us;
      row.them += r.them;
      row.plays += matches[i]!.n;
    });
  }
  const table = rounds.map((r, i) => ({
    team: OPPONENTS[i]!.name,
    played: r.played,
    win: +(r.won / Math.max(1, r.played)).toFixed(2),
    us: +(r.us / Math.max(1, r.played)).toFixed(1),
    them: +(r.them / Math.max(1, r.played)).toFixed(1),
    plays: +(r.plays / Math.max(1, r.played)).toFixed(1),
  }));
  return { table, champion: champions / n, learned: learnedAtEnd / n };
}

describe('season balance (the computer plays both sides)', () => {
  const sensible = report('sensible', 300);
  const careless = report('careless', 300);
  if (process.env.BALANCE) {
    console.table(sensible.table);
    console.log('sensible: champion', sensible.champion, 'specials learned', sensible.learned);
    console.table(careless.table);
    console.log('careless: champion', careless.champion, 'specials learned', careless.learned);
  }

  it('the practice match is winnable and the final is hard', () => {
    const [practice, first, semi, final] = sensible.table;
    expect(practice!.win).toBeGreaterThan(0.6);
    expect(first!.win).toBeGreaterThan(0.5);
    expect(semi!.win).toBeGreaterThan(0.35);
    expect(final!.win).toBeGreaterThan(0.2);
    expect(final!.win).toBeLessThan(0.75);
  });

  it('a careful coach wins the title far more often than a careless one', () => {
    expect(sensible.champion).toBeGreaterThan(0.08);
    expect(sensible.champion).toBeLessThan(0.5);
    expect(sensible.champion).toBeGreaterThan(careless.champion * 1.5);
  });

  it('games have points in them', () => {
    for (const row of sensible.table) expect(row.us + row.them).toBeGreaterThan(14);
  });
});
