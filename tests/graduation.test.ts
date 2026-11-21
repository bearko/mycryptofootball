import { describe, expect, it } from 'vitest';
import { FOUNDERS, RECRUITS } from '../src/game/heroes';
import { validLineup } from '../src/game/lineup';
import { TIERS } from '../src/game/prestige';
import {
  GRADES, ROSTER_SIZE, clubSheet, clubSize, founding, genOf, graduating, joinCount, mend, needsCaptain, newSeason, nextYear, signRecruits,
  type Season,
} from '../src/game/season';
import { runCareer, runSeason } from './bot';

/** ends the year as it stands and begins the next (signing the first heroes at the briefing, if there is one) */
function turn(s: Season, seed: number): void {
  s.phase = 'done';
  nextYear(s, seed);
  if ((s.phase as string) === 'recruit') signRecruits(s, s.candidates.slice(0, joinCount(s)));
}

describe('graduation', () => {
  it('a new club is seven first-years, drawn from the heroes of the first generation', () => {
    const s = newSeason(21);
    expect(founding(s)).toBe(true);
    for (const id of s.candidates) expect(RECRUITS.findIndex((r) => r.id === id)).toBeLessThan(FOUNDERS);
    signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
    expect(s.members.every((m) => m.grade === 1)).toBe(true);
    expect(s.members.filter((m) => m.captain).length).toBe(1);
    expect(graduating(s)).toEqual([]);
    expect(s.alumni).toEqual({});
  });

  it('everybody moves up a year, and the third-years leave when theirs is over', () => {
    const { season: s } = runSeason(7 * 31);
    const founders = s.members.map((m) => m.id);
    turn(s, 1);
    expect(s.year).toBe(2);
    expect(s.members.filter((m) => founders.includes(m.id)).every((m) => m.grade === 2)).toBe(true);
    expect(s.left).toEqual([]);
    turn(s, 2);
    expect(graduating(s).map((m) => m.id).sort()).toEqual([...founders].sort());
    const trained = Object.fromEntries(s.members.map((m) => [m.id, m.stats.spd]));
    turn(s, 3);
    expect(s.year).toBe(4);
    // the founders are gone and remembered; nobody else is
    for (const id of founders) {
      expect(s.members.some((m) => m.id === id)).toBe(false);
      expect(s.alumni[id]).toEqual({ n: 1, year: 3 });
    }
    expect([...(s.left ?? [])].sort()).toEqual([...founders].sort());
    expect(Object.keys(s.alumni).length).toBe(founders.length);
    // the others kept what they had learned
    for (const m of s.members) if (trained[m.id] !== undefined && m.grade > 1) expect(m.stats.spd).toBe(trained[m.id]);
    // the club is full again and can play
    expect(s.members.length).toBe(TIERS[s.tier]!.roster);
    expect(validLineup(s.lineup!, s.members.map((m) => m.id), clubSize(s))).toBe(true);
    expect(() => clubSheet(s)).not.toThrow();
    expect(s.members.every((m) => m.grade >= 1 && m.grade <= GRADES)).toBe(true);
  });

  it('there is always a captain: when he graduates the oldest of those who stay takes over', () => {
    const { season: s } = runSeason(9 * 31);
    s.tier = 2;
    turn(s, 1); // four newcomers
    turn(s, 2);
    const next = [...s.members].filter((m) => m.grade < GRADES).sort((a, b) => b.grade - a.grade || b.trust - a.trust)[0]!;
    turn(s, 3);
    expect(s.members.filter((m) => m.captain).map((m) => m.id)).toEqual([next.id]);
    expect(needsCaptain(s)).toBe(false);
  });

  it('a club whose heroes have all graduated starts over: seven newcomers, the first of them captain', () => {
    const { season: s } = runSeason(5 * 31);
    s.tier = 0;
    turn(s, 1);
    s.tier = 0;
    turn(s, 2);
    s.tier = 0;
    s.phase = 'done';
    nextYear(s, 3);
    expect(s.members).toEqual([]);
    expect(s.phase).toBe('recruit');
    expect(founding(s)).toBe(false);
    expect(needsCaptain(s)).toBe(true);
    expect(joinCount(s)).toBe(ROSTER_SIZE);
    const ids = s.candidates.slice(0, ROSTER_SIZE);
    signRecruits(s, ids);
    expect(s.members.filter((m) => m.captain).map((m) => m.id)).toEqual([ids[0]]);
    expect(s.members.every((m) => m.grade === 1)).toBe(true);
    expect(() => clubSheet(s)).not.toThrow();
  });

  it('a hero who graduated does not come back the next spring; later a second of the name may join', () => {
    const { season: s } = runSeason(11 * 31);
    const founders = s.members.map((m) => m.id);
    turn(s, 1);
    turn(s, 2);
    s.phase = 'done';
    nextYear(s, 3);
    for (const id of s.candidates) expect(founders).not.toContain(id);
    signRecruits(s, s.candidates.slice(0, joinCount(s)));
    expect(genOf(s, founders[0]!)).toBe(2);
    // years later one of them is at the briefing again, as the second of the name
    let back: number | undefined;
    for (let y = 4; y < 40 && back === undefined; y += 1) {
      s.phase = 'done';
      nextYear(s, 100 + y);
      back = s.candidates.find((id) => (s.alumni[id]?.n ?? 0) >= 1);
      if ((s.phase as string) === 'recruit') {
        const pick = back !== undefined ? [back, ...s.candidates.filter((id) => id !== back)] : s.candidates;
        signRecruits(s, pick.slice(0, joinCount(s)));
      }
    }
    expect(back).toBeDefined();
    const again = s.members.find((m) => m.id === back)!;
    expect(again.gen).toBe(2);
    expect(again.grade).toBe(1);
  });

  it('the briefing brings heroes of every ability, more than there is room for', () => {
    const { season: s } = runSeason(13 * 31);
    s.tier = 4;
    s.phase = 'done';
    nextYear(s, 5);
    const room = TIERS[4]!.roster - s.members.length;
    expect(joinCount(s)).toBe(room);
    expect(s.candidates.length).toBeGreaterThan(room);
    const talents = new Set(s.candidates.map((id) => {
      const st = RECRUITS.find((r) => r.id === id)!.stats;
      return Object.entries(st).sort((a, b) => b[1] - a[1])[0]![0];
    }));
    expect(talents.size).toBe(6);
    expect(new Set(s.candidates).size).toBe(s.candidates.length);
  });

  it('a club saved before school years existed gets them: nobody leaves at once, the oldest third is in its last year', () => {
    const { season: s } = runSeason(3 * 31);
    s.tier = 2;
    turn(s, 1);
    s.year = 5;
    for (const m of s.members) delete (m as unknown as Record<string, unknown>).grade;
    delete (s as unknown as Record<string, unknown>).alumni;
    mend(s);
    expect(s.alumni).toEqual({});
    const grades = s.members.map((m) => m.grade);
    expect(grades.every((g) => g >= 1 && g <= GRADES)).toBe(true);
    expect(grades.filter((g) => g === GRADES).length).toBeLessThanOrEqual(Math.ceil(s.members.length / 3));
    expect(grades[grades.length - 1]).toBe(1);
    // a young club: the founders are in the year the club is in
    const { season: t } = runSeason(3 * 31);
    for (const m of t.members) delete (m as unknown as Record<string, unknown>).grade;
    mend(t);
    expect(t.members.every((m) => m.grade === 1)).toBe(true);
  });

  it('over many years the club keeps playing: full squads, valid line-ups, heroes of every generation', () => {
    for (let i = 1; i <= 8; i += 1) {
      const { season: s, log } = runCareer(i * 7919, 14);
      expect(log.length).toBe(14);
      expect(s.members.length).toBeGreaterThanOrEqual(ROSTER_SIZE);
      expect(validLineup(s.lineup!, s.members.map((m) => m.id), clubSize(s))).toBe(true);
      expect(s.members.every((m) => m.grade >= 1 && m.grade <= GRADES)).toBe(true);
      expect(s.members.filter((m) => m.captain).length).toBe(1);
      expect(Object.keys(s.alumni).length).toBeGreaterThan(10);
      expect(new Set(s.members.map((m) => m.id)).size).toBe(s.members.length);
    }
  }, 180000);
});
