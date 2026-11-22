import { describe, expect, it } from 'vitest';
import { KIND } from '../src/game/cards';
import { BONDS, bondKey, bondsOf } from '../src/game/bonds';
import { RECRUITS } from '../src/game/heroes';
import { BOND_STEPS, ROSTER_SIZE, answerEvent, bondCards, bondProgress, clubBonds, clubSheet, newSeason, plan, signRecruits, train, type Season } from '../src/game/season';

/** a new club with these heroes among its founders */
const clubWith = (ids: number[], without: number[] = []): Season => {
  const s = newSeason(21);
  const rest = RECRUITS.map((r) => r.id).filter((id) => !ids.includes(id) && !without.includes(id));
  signRecruits(s, [...ids, ...rest].slice(0, ROSTER_SIZE));
  return s;
};

describe('the bonds', () => {
  it('are between two heroes the club can sign, each with a three-part story of short lines and a play of their own', () => {
    const recruits = new Set(RECRUITS.map((r) => r.id));
    expect(new Set(BONDS.map(bondKey)).size).toBe(BONDS.length);
    for (const b of BONDS) {
      expect(recruits.has(b.a) && recruits.has(b.b), b.title).toBe(true);
      expect(b.a).not.toBe(b.b);
      expect(KIND[b.kind]).toBeDefined();
      expect(b.talk).toHaveLength(BOND_STEPS);
      for (const talk of b.talk) {
        expect(talk.length).toBeGreaterThanOrEqual(2);
        // both of them speak, and each line fits a bubble
        expect(new Set(talk.map(([who]) => who)).size).toBe(2);
        for (const [, text] of talk) expect(text.length, text).toBeLessThanOrEqual(22);
      }
    }
    expect(bondsOf(5019).length).toBe(2);
  });

  it('talk after practice now and then once both are in the club; the third talk gives them a special play', () => {
    const s = clubWith([5019, 3018]);
    const b = BONDS.find((x) => x.a === 5019 && x.b === 3018)!;
    expect(clubBonds(s)).toContain(b);
    const steps: number[] = [];
    for (let day = 0; day < 60 && plan(s).t === 'train' && bondProgress(s, b) < BOND_STEPS; day += 1) {
      if (s.event) answerEvent(s, 0);
      if (plan(s).t !== 'train') break;
      const r = train(s, 0);
      if (r.bond) steps.push(r.bond.step);
      // (a match day: skip past it)
      while (plan(s).t !== 'train' && s.day < 27) s.day += 1;
    }
    expect(steps).toEqual([1, 2, 3].slice(0, steps.length));
    expect(steps.length).toBeGreaterThan(0);
    s.bonds = { [bondKey(b)]: BOND_STEPS };
    const cards = bondCards(s);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.key).toBe(`bond:${bondKey(b)}`);
    expect([b.a, b.b]).toContain(cards[0]!.owner);
    expect(cards[0]!.name).toBe(b.name);
    expect(clubSheet(s).specials.some((sp) => sp.key === cards[0]!.key)).toBe(true);
  });

  it('a club without both of them hears nothing of their story', () => {
    const s = clubWith([5019], [3018]);
    expect(clubBonds(s).some((b) => b.b === 3018)).toBe(false);
    for (let day = 0; day < 5; day += 1) {
      if (s.event) answerEvent(s, 0);
      const r = train(s, 0);
      expect(r.bond?.key === '5019-3018').toBe(false);
    }
    expect(bondCards(s)).toHaveLength(0);
  });
});
