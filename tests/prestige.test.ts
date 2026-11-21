import { describe, expect, it } from 'vitest';
import { runCareer, runSeason } from './bot';
import { RECRUITS } from '../src/game/heroes';
import { validLineup } from '../src/game/lineup';
import { FAME_AFTER_DOWN, FAME_AFTER_UP, FAME_LOSS, FAME_MAX, FAME_WIN, TIERS, TOP_TIER, applyResult } from '../src/game/prestige';
import { ROSTER_SIZE, SCHEDULE, cupOf, growth, handSize, joinCount, labelOf, mend, newSeason, nextYear, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';

describe('the club\'s standing', () => {
  it('seven steps: the roster reaches eleven at the third and twenty-two at the fifth', () => {
    expect(TIERS.map((t) => t.name)).toEqual(['素人', '同好会', '弱小', '注目株', '中堅', '強豪', '名門']);
    expect(TIERS[0]!.roster).toBe(ROSTER_SIZE);
    expect(TIERS[2]!.roster).toBe(11);
    expect(TIERS[4]!.roster).toBe(22);
    expect(TIERS[TOP_TIER]!.roster).toBeLessThanOrEqual(RECRUITS.length);
    for (let i = 1; i < TIERS.length; i += 1) {
      expect(TIERS[i]!.roster).toBeGreaterThanOrEqual(TIERS[i - 1]!.roster);
      expect(TIERS[i]!.hand).toBeGreaterThanOrEqual(TIERS[i - 1]!.hand);
      expect(TIERS[i]!.level).toBeGreaterThan(TIERS[i - 1]!.level);
    }
    expect(TIERS[TOP_TIER]!.hand).toBeGreaterThan(TIERS[0]!.hand);
  });

  it('wins fill the gauge, defeats drain it', () => {
    for (let m = 0; m < 4; m += 1) {
      const up = applyResult({ tier: 3, fame: 40 }, m, true);
      expect(up.delta).toBe(FAME_WIN[m]);
      expect(up.after.fame).toBe(40 + FAME_WIN[m]!);
      expect(up.moved).toBe(0);
      const down = applyResult({ tier: 3, fame: 40 }, m, false);
      expect(down.delta).toBe(FAME_LOSS[m]);
      expect(down.after.fame).toBe(40 + FAME_LOSS[m]!);
    }
  });

  it('a full gauge takes the club up a step, an empty one down a step', () => {
    const up = applyResult({ tier: 2, fame: 80 }, 2, true);
    expect(up.after).toEqual({ tier: 3, fame: FAME_AFTER_UP });
    expect(up.moved).toBe(1);
    const down = applyResult({ tier: 2, fame: 10 }, 1, false);
    expect(down.after).toEqual({ tier: 1, fame: FAME_AFTER_DOWN });
    expect(down.moved).toBe(-1);
    // the ends of the ladder
    expect(applyResult({ tier: 0, fame: 5 }, 1, false).after).toEqual({ tier: 0, fame: 0 });
    expect(applyResult({ tier: TOP_TIER, fame: 90 }, 3, true).after).toEqual({ tier: TOP_TIER, fame: FAME_MAX });
  });

  it('beginners who reach the semi-final become a club at once', () => {
    const r = applyResult({ tier: 0, fame: 0 }, 1, true);
    expect(r.after.tier).toBe(1);
    expect(r.moved).toBe(1);
    // the practice match alone does not do it
    expect(applyResult({ tier: 0, fame: 0 }, 0, true).after.tier).toBe(0);
  });

  it('the schools the club meets are as strong as its standing', () => {
    const avg = (league: number): number => {
      const t = opponentSheet(2, league);
      return t.players.reduce((v, p) => v + Object.values(p.stats).reduce((a, b) => a + b, 0), 0) / t.players.length;
    };
    for (let i = 1; i < TIERS.length; i += 1) expect(avg(i)).toBeGreaterThan(avg(i - 1));
    expect(opponentSheet(2)).toEqual(opponentSheet(2, 0));
  });
});

describe('the years of a club', () => {
  it('a new club is in its first year, beginners with an empty gauge', () => {
    const s = newSeason(3);
    expect([s.year, s.tier, s.fame, s.league]).toEqual([1, 0, 0, 0]);
    expect(joinCount(s)).toBe(ROSTER_SIZE);
    expect(cupOf(s)).toBe('地区大会');
    expect(handSize(s)).toBe(TIERS[0]!.hand);
  });

  it('every match moves the gauge, and winning the first round makes beginners a club', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { season: s } = runSeason(seed * 31);
      const wonFirst = s.results.some((r) => r.opp === 1 && r.win);
      if (wonFirst) expect(s.tier).toBeGreaterThanOrEqual(1);
      else expect(s.tier).toBe(0);
      expect(s.fame).toBeGreaterThanOrEqual(0);
      expect(s.fame).toBeLessThanOrEqual(FAME_MAX);
      // the opponents stayed those of the year's start
      expect(s.league).toBe(0);
    }
  });

  it('the next year: everybody stays and keeps what they learned; a club with room holds a briefing', () => {
    const { season: s } = runSeason(7 * 31);
    const before = JSON.parse(JSON.stringify(s.members)) as typeof s.members;
    s.tier = 2;
    s.fame = 40;
    nextYear(s, 99);
    expect(s.year).toBe(2);
    expect(s.league).toBe(2);
    expect(cupOf(s)).toBe('県大会');
    expect(labelOf(s, SCHEDULE[13]!)).toBe('県大会 1回戦');
    expect(labelOf(s, SCHEDULE[6]!)).toBe('練習試合');
    expect(s.results).toEqual([]);
    expect(s.day).toBe(0);
    expect(s.phase).toBe('recruit');
    const room = TIERS[2]!.roster - ROSTER_SIZE;
    expect(joinCount(s)).toBe(room);
    expect(s.candidates.length).toBeGreaterThan(room);
    for (const id of s.candidates) expect(before.some((m) => m.id === id)).toBe(false);
    const captain = before.find((m) => m.captain)!.id;
    signRecruits(s, s.candidates.slice(0, room));
    expect(s.members.length).toBe(TIERS[2]!.roster);
    expect(s.phase).toBe('club');
    // the old hands are who they were (rested), the captain is still the captain
    for (const old of before) {
      const m = s.members.find((x) => x.id === old.id)!;
      expect(m.stats).toEqual(old.stats);
      expect(m.trust).toBe(old.trust);
    }
    expect(s.members.filter((m) => m.captain).map((m) => m.id)).toEqual([captain]);
    // the newcomers of a club with a name are better than plain beginners
    const fresh = s.members[s.members.length - 1]!;
    const plain = RECRUITS.find((r) => r.id === fresh.id)!.stats;
    expect(fresh.stats.spd).toBe(plain.spd + TIERS[2]!.join);
    expect(validLineup(s.lineup!, s.members.map((m) => m.id))).toBe(true);
    expect(s.hand.filter((c) => c.kind !== 'rest').length).toBe(TIERS[2]!.hand);
    // the month's review counts from the new year's first day
    expect(growth(s).total).toBe(0);
  });

  it('a club with no room goes straight back to practice', () => {
    const { season: s } = runSeason(5 * 31);
    s.tier = 0;
    nextYear(s, 5);
    expect(s.phase).toBe('club');
    expect(s.members.length).toBe(ROSTER_SIZE);
    expect(() => nextYear(s, 6)).toThrow();
  });

  it('a season saved before the standing existed is a beginners\' first year', () => {
    const s = newSeason(3);
    signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
    const old = s as unknown as Record<string, unknown>;
    delete old.year;
    delete old.tier;
    delete old.fame;
    delete old.league;
    mend(s);
    expect([s.year, s.tier, s.fame, s.league]).toEqual([1, 0, 0, 0]);
  });

  it('over the years a careful coach climbs, one step after another, and the club grows with its standing', () => {
    let reached = 0;
    let top = 0;
    const N = 12;
    for (let i = 1; i <= N; i += 1) {
      const { season: s, log } = runCareer(i * 7919, 8);
      expect(s.members.length).toBeLessThanOrEqual(TIERS[Math.max(...log.map((l) => l.tier))]!.roster);
      expect(validLineup(s.lineup!, s.members.map((m) => m.id))).toBe(true);
      if (log.some((l) => l.tier >= 2)) reached += 1;
      top = Math.max(top, ...log.map((l) => l.tier));
      // never more than one step a match, so never more than four a year
      for (let y = 1; y < log.length; y += 1) expect(Math.abs(log[y]!.tier - log[y - 1]!.tier)).toBeLessThanOrEqual(4);
    }
    expect(reached / N).toBeGreaterThan(0.8);
    expect(top).toBeGreaterThanOrEqual(4);
  }, 120000);
});
