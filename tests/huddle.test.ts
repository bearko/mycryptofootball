import { describe, expect, it } from 'vitest';
import { OFF_TYPES, type OffType } from '../src/game/cards';
import {
  at, createMatch, deal, defRating, huddle, keyHeroes, offRating, outlook, specialPick, type MatchState, type TeamSheet,
} from '../src/game/match';
import { STATS } from '../src/game/model';
import { ROSTER_SIZE, clubSheet, newSeason, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';

const BASE: TeamSheet = (() => {
  const s = newSeason(3);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  s.day = 6;
  return clubSheet(s);
})();
const sheet = (): TeamSheet => BASE;
/** the same team with everyone's abilities moved by `by`, and (optionally) everyone's judgment set */
const tuned = (t: TeamSheet, by: number, iq?: number): TeamSheet => ({
  ...t,
  players: t.players.map((p) => {
    const stats = { ...p.stats };
    for (const k of STATS) stats[k] = Math.max(1, Math.min(99, stats[k] + by));
    if (iq !== undefined) stats.iq = iq;
    return { ...p, stats };
  }),
});
const match = (home: TeamSheet, poss: 0 | 1, seed = 7): MatchState => {
  const st = createMatch(home, opponentSheet(1), seed);
  st.poss = poss;
  deal(st);
  return st;
};

describe('the number on a play card', () => {
  it('is a 1 to 10 for every card in the hand, on offense and on defense', () => {
    for (const poss of [0, 1] as const) {
      for (let seed = 1; seed < 30; seed += 1) {
        const st = match(sheet(), poss, seed);
        for (const c of poss === 0 ? st.hand.off : st.hand.def) {
          const v = outlook(st, 0, c)!;
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it('goes up with the stars on the card and with the heroes behind it', () => {
    for (const poss of [0, 1] as const) {
      const weak = match(tuned(sheet(), -25), poss);
      const even = match(sheet(), poss);
      const strong = match(tuned(sheet(), 25), poss);
      for (const type of poss === 0 ? OFF_TYPES : (['stuff', 'contain', 'zone', 'deep', 'blitz'] as const)) {
        const v = (st: MatchState, star: number): number => outlook(st, 0, { type, star })!;
        expect(v(even, 3)).toBeGreaterThanOrEqual(v(even, 1));
        expect(v(strong, 2)).toBeGreaterThan(v(weak, 2));
      }
    }
  });

  it('does not touch the match (no dice are rolled), and has nothing to say about a "look first" special', () => {
    const st = match(sheet(), 0);
    const before = st.rng.s;
    for (const c of st.hand.off) outlook(st, 0, c);
    huddle(st, 0);
    keyHeroes(st, 0, st.hand.off[0]!);
    expect(st.rng.s).toBe(before);
    const peek = st.teams.flatMap((t) => t.specials).find((sp) => sp.kind === 'peekOff' || sp.kind === 'peekDef');
    if (peek) expect(outlook(st, 0, specialPick(peek))).toBeNull();
  });
});

describe('the heroes a card is about', () => {
  it('are on the field, the ball carrier or the passer first; a special play puts its owner first', () => {
    const st = match(sheet(), 0);
    const me = st.teams[0];
    expect(keyHeroes(st, 0, { type: 'inside', star: 1 })[0]!.id).toBe(me.lineup.off.RB);
    expect(keyHeroes(st, 0, { type: 'long', star: 1 })[0]!.id).toBe(me.lineup.off.QB);
    const d = match(sheet(), 1);
    expect(keyHeroes(d, 0, { type: 'deep', star: 1 })[0]!.id).toBe(me.lineup.def.S);
    for (const sp of me.specials) {
      const side = sp.kind in { steal: 1, wall: 1, roar: 1, rush: 1, peekDef: 1 } ? d : st;
      expect(keyHeroes(side, 0, specialPick(sp))[0]!.id).toBe(sp.owner);
    }
    for (const k of keyHeroes(st, 0, { type: 'short', star: 2 })) expect(Object.values(me.lineup.off)).toContain(k.id);
  });
});

describe('the huddle', () => {
  it('two different heroes of the unit on the field speak, the same way every time for the same moment', () => {
    for (const poss of [0, 1] as const) {
      for (let n = 0; n < 12; n += 1) {
        const st = match(sheet(), poss, 20 + n);
        st.n = n;
        const a = huddle(st, 0);
        expect(a).toHaveLength(2);
        expect(a[0]!.id).not.toBe(a[1]!.id);
        expect(huddle(st, 0)).toEqual(a);
        const unit = [...Object.values(poss === 0 ? st.teams[0].lineup.off : st.teams[0].lineup.def), st.teams[0].lineup.k];
        for (const v of a) {
          expect(unit).toContain(v.id);
          expect(v.text.length).toBeGreaterThan(3);
          if (v.pos !== 'K') expect(at(st.teams[0], v.pos).id).toBe(v.id);
        }
      }
    }
  });

  it('a sharp hero is right about the match-up far more often than a dull one', () => {
    const hits = (iq: number): number => {
      let right = 0;
      let said = 0;
      for (const by of [-18, 18]) {
        for (let seed = 1; seed <= 150; seed += 1) {
          const st = match(tuned(sheet(), by, iq), seed % 2 ? 0 : 1, seed);
          st.n = seed;
          const [me, opp] = st.teams;
          for (const v of huddle(st, 0)) {
            if (v.topic === 'gap') continue;
            said += 1;
            const type = v.topic as OffType;
            const real = st.poss === 0 ? offRating(me, type) - defRating(opp, type) : defRating(me, type) - offRating(opp, type);
            if ((real >= 3 && v.tone === 'good') || (real <= -3 && v.tone === 'bad') || (Math.abs(real) < 3 && v.tone === 'even')) right += 1;
          }
        }
      }
      return right / said;
    };
    const sharp = hits(92);
    const dull = hits(25);
    expect(sharp).toBeGreaterThan(0.85);
    expect(dull).toBeLessThan(0.7);
    expect(sharp - dull).toBeGreaterThan(0.2);
  });
});
