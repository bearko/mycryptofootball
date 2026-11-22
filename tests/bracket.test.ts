import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BRACKET_SCHOOLS, CLUB, CLUB_GAME, bookRound, clubOpponent, clubReach, freshGames, makeBracket, markSeen, pairOf, ratingOf } from '../src/game/bracket';
import { SCHEDULE, schoolId } from '../src/game/season';
import { runSeason } from './bot';

describe('the bracket', () => {
  it('eight teams: the club first, seven schools of its tournament; the two strongest only meet in the final', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const league of [0, 2, 4, 6]) {
        const b = makeBracket(league, new Rng(seed));
        expect(b.field[0]).toBe(CLUB);
        expect(new Set(b.field).size).toBe(8);
        const pool = BRACKET_SCHOOLS[[0, 0, 1, 1, 2, 3, 3][league]!]!;
        for (const id of b.field.slice(1)) expect(pool).toContain(id);
        // the club meets one of the two weakest first
        expect(ratingOf(league, b.field[1]!)).toBeLessThanOrEqual(1);
        const top = [pool[6]!, pool[5]!].map((id) => b.field.indexOf(id));
        expect(top.every((i) => i >= 4)).toBe(true);
        expect(Math.floor(top[0]! / 2)).not.toBe(Math.floor(top[1]! / 2));
      }
    }
  });

  it('the club\'s next opponent is whoever came through; once it is out the rest is played', () => {
    const rng = new Rng(5);
    const b = makeBracket(2, rng);
    expect(clubOpponent(b, 1)).toBe(b.field[1]);
    expect(clubOpponent(b, 2)).toBeNull();
    bookRound(b, 1, true, [21, 7], 2, rng);
    expect(b.won.slice(0, 4).every((w) => w != null)).toBe(true);
    expect(b.won[0]).toBe(CLUB);
    expect(b.score[0]).toEqual([21, 7]);
    expect(clubOpponent(b, 2)).toBe(b.won[1]);
    expect(freshGames(b)).toEqual([0, 1, 2, 3]);
    markSeen(b, [0, 1, 2, 3]);
    bookRound(b, 2, false, [7, 14], 2, rng);
    expect(b.won[4]).toBe(pairOf(b, 4)[1]);
    expect(b.score[4]).toEqual([14, 7]);
    expect(b.won.every((w) => w != null)).toBe(true);
    expect(clubReach(b)).toBe(2);
    expect(freshGames(b)).toEqual([4, 5, 6]);
    for (const g of [0, 1, 2, 3, 4, 5, 6]) {
      const [x, y] = pairOf(b, g);
      expect([x, y]).toContain(b.won[g]);
      expect(b.score[g]![0]).toBeGreaterThan(b.score[g]![1]);
    }
    expect(CLUB_GAME).toEqual([-1, 0, 4, 6]);
  });

  it('in a season, the club meets the schools its brackets bring', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { season: s } = runSeason(seed * 97);
      for (const stage of ['spring', 'autumn'] as const) {
        const b = s.cups![stage]!;
        const games = s.results.filter((r) => SCHEDULE[r.day]!.stage === stage && r.opp > 0);
        for (const r of games) {
          const [x, y] = pairOf(b, CLUB_GAME[r.opp]!);
          expect([x, y]).toContain(CLUB);
          expect([x, y]).toContain(schoolId(s, r.m));
          expect(b.won[CLUB_GAME[r.opp]!] === CLUB).toBe(r.win);
        }
        // the bracket is played to its end
        expect(b.won.every((w) => w != null)).toBe(true);
      }
    }
  });
});
