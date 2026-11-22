import { describe, expect, it } from 'vitest';
import { autoPick, createMatch, outlook, resolvePlay, showtime, type MatchState } from '../src/game/match';
import { opponentSheet } from '../src/game/teams';
import { acesFit, acesOf, beasts, clubRecord, duelOdds, heroRecord, setupDuels, suggestAces } from '../src/game/duel';
import { RIVALS, rivalLine } from '../src/game/bonds';
import { RECRUITS } from '../src/game/heroes';
import { SCHOOLS } from '../src/game/teams';
import { offPos, defPos, roleOf } from '../src/game/model';
import { opened } from './open';

const play = (st: MatchState): void => {
  const d = autoPick(st, (1 - st.poss) as 0 | 1);
  resolvePlay(st, autoPick(st, st.poss, d), d);
};

describe('the duels, eleven a side', () => {
  it('six a side has none; eleven a side has one for each team, ace against ace', () => {
    expect(createMatch(opponentSheet(0), opponentSheet(1), 1).duels).toBeUndefined();
    const a = opponentSheet(3, 2, 11, 6);
    const b = opponentSheet(3, 2, 11, 8);
    const st = createMatch(a, b, 1);
    expect(st.duels).toHaveLength(2);
    const [x, y] = st.duels!;
    expect(x!.side).toBe(0);
    expect(y!.side).toBe(1);
    expect(x!.ace).toBe(acesOf(a).off);
    expect(x!.foe).toBe(acesOf(b).def);
    expect(y!.ace).toBe(acesOf(b).off);
    // an ace plays where an ace may play
    for (const t of [a, b]) {
      const ac = suggestAces(t);
      expect(acesFit(t, ac)).toBe(true);
      expect(offPos(t.lineup).some((p) => t.lineup.off[p] === ac.off && ['RB', 'WR', 'TE', 'QB'].includes(roleOf(p)))).toBe(true);
      expect(defPos(t.lineup).some((p) => t.lineup.def[p] === ac.def && ['LB', 'CB', 'S', 'DL'].includes(roleOf(p)))).toBe(true);
    }
    // a choice that is not on the field gives way to the suggestion
    expect(acesOf({ ...a, aces: { off: -5, def: -6 } })).toEqual(suggestAces(a));
  });

  it('two heroes with a history are put up against each other first', () => {
    // every rivalry is between a hero the club can sign and one of a school
    const recruits = new Set(RECRUITS.map((r) => r.id));
    const schools = new Set(SCHOOLS.flatMap((s) => [...s.players, ...s.more].map((p) => p.id)));
    for (const [x, y, line] of RIVALS) {
      expect(recruits.has(x) && schools.has(y), `${x} ${y}`).toBe(true);
      expect(rivalLine(y, x)).toBe(line);
    }
    // a school with 源頼朝 against a side that has 源義経 at an ace's spot
    const raimei = SCHOOLS.findIndex((s) => s.name === '雷鳴館');
    const them = opponentSheet(3, 3, 11, raimei);
    const us = opponentSheet(3, 3, 11, 6);
    const rb = us.lineup.off.RB;
    const re = <T extends Record<string, number>>(m: T): T => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === rb ? 5019 : v])) as T;
    const swapped = { ...us, players: us.players.map((p) => (p.id === rb ? { ...p, id: 5019 } : p)), lineup: { ...us.lineup, off: re(us.lineup.off), def: re(us.lineup.def) } };
    const yoritomo = defPos(them.lineup).find((p) => them.lineup.def[p] === 3051);
    expect(yoritomo).toBeDefined();
    const duels = setupDuels([swapped, them]);
    expect(duels[0]!.ace).toBe(5019);
    expect(duels[0]!.foe).toBe(3051);
    expect(duels[0]!.rival).toBe('兄と弟、因縁の対決！');
  });

  it('a duel is fought now and then, and swings the play; winning twice makes a hero unstoppable for the quarter', () => {
    let duels = 0;
    let born = 0;
    let stopped = 0;
    let matches = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const st = createMatch(opponentSheet(3, 3, 11, 6 + (seed % 6)), opponentSheet(3, 3, 11, 6 + ((seed + 3) % 6)), seed);
      matches += 1;
      let lastQ = st.quarter;
      for (let g = 0; !st.over && g < 600; g += 1) {
        const d = autoPick(st, (1 - st.poss) as 0 | 1);
        const res = resolvePlay(st, autoPick(st, st.poss, d), d);
        // a new quarter: nobody is unstoppable any more
        if (st.quarter !== lastQ) {
          expect(beasts(st.duels)).toHaveLength(0);
          lastQ = st.quarter;
        }
        if (!res.duel) continue;
        duels += 1;
        const du = st.duels![res.duel.i]!;
        expect(res.duel.p).toBeGreaterThan(0);
        expect(res.duel.p).toBeLessThan(1);
        expect(res.defender).toBe(du.foe);
        if (res.duel.born) {
          born += 1;
          // (unless the quarter ended on that very play)
          if (!res.period) expect(du.beast).toBe(res.duel.born);
        }
        if (res.duel.stopped) {
          stopped += 1;
          expect(res.momWhy[res.duel.win ? res.off : 1 - res.off]).toBe('怪物を止めた');
        }
      }
      const r = clubRecord(st.duels);
      expect(r.w + r.l).toBe(st.duels!.reduce((a, x) => a + x.w + x.l, 0));
    }
    // several duels a match, a hero becomes unstoppable once or twice, and is stopped now and then
    expect(duels / matches).toBeGreaterThan(4);
    expect(duels / matches).toBeLessThan(12);
    expect(born / matches).toBeGreaterThan(0.8);
    expect(born / matches).toBeLessThan(2.6);
    expect(stopped).toBeGreaterThan(5);
  });

  it("an unstoppable hero wins more often, and his rival's own special play is the answer", () => {
    const st = opened(opponentSheet(3, 3, 11, 9), opponentSheet(3, 3, 11, 10), 4);
    const du = st.duels![st.poss]!;
    const [o, d] = st.poss === 0 ? st.teams : [st.teams[1], st.teams[0]];
    const base = duelOdds(o, d, du, st.mom);
    du.beast = 'ace';
    const beast = duelOdds(o, d, du, st.mom);
    expect(beast).toBeGreaterThan(base);
    expect(duelOdds(o, d, du, st.mom, { foeSpecial: 1 })).toBeLessThan(beast);
    // the coach of the club is asked to call the play himself when the other side has one
    du.side = 1;
    st.poss = 1;
    expect(showtime(st)).toBe(true);
    expect(heroRecord(st.duels, 1, du.ace)?.beast).toBe(true);
  });

  it('the same seed and the same picks give the same duels, and the card outlook stays a number', () => {
    const run = (): string => {
      const st = createMatch(opponentSheet(3, 2, 11, 6), opponentSheet(3, 2, 11, 7), 77);
      for (let g = 0; !st.over && g < 600; g += 1) {
        if (!st.ko && !st.tfp) for (const c of st.poss === 0 ? st.hand.off : st.hand.def) expect(outlook(st, 0, c)).not.toBeNaN();
        play(st);
      }
      return JSON.stringify([st.score, st.duels]);
    };
    expect(run()).toBe(run());
  });
});
