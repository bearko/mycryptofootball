import { opened } from './open';
import { describe, expect, it } from 'vitest';
import {
  FG_POINTS, FIELD, KICKOFF_FROM, PAT_POINTS, PLAYS_PER_Q, START, TD_POINTS, TRY_YARDS, TWO_POINTS, autoPick, createMatch, deal, fgChance, huddle, keyHeroes,
  kickBlock, kickPicks, kickerOf, outlook, patChance, resolvePlay, simulate, type MatchState, type Pick, type TeamSheet,
} from '../src/game/match';
import { bestKicker, bestLineup } from '../src/game/lineup';
import { STATS, kickFit } from '../src/game/model';
import { ROSTER_SIZE, asPlayer, clubSheet, newSeason, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';

const BASE: TeamSheet = (() => {
  const s = newSeason(3);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  s.day = 6;
  return clubSheet(s);
})();
const tuned = (t: TeamSheet, by: number): TeamSheet => ({
  ...t,
  players: t.players.map((p) => {
    const stats = { ...p.stats };
    for (const k of STATS) stats[k] = Math.max(1, Math.min(99, stats[k] + by));
    return { ...p, stats };
  }),
});
const noKicker = (t: TeamSheet): TeamSheet => ({ ...t, lineup: { ...t.lineup, k: null } });
const match = (home: TeamSheet, seed = 7, pos = 30): MatchState => {
  const st = opened(home, opponentSheet(1), seed);
  st.poss = 0;
  st.pos = pos;
  deal(st);
  return st;
};
const kick = (type: 'fg' | 'punt' | 'pat'): Pick => ({ type, star: 1 });
const call = (type: 'stuff' | 'zone' | 'blitz' = 'zone'): Pick => ({ type, star: 1 });
/** plays until team 0 scores a touchdown from close in; returns the state waiting for the try */
const afterTouchdown = (home: TeamSheet, seed: number): MatchState | null => {
  const st = match(tuned(home, 30), seed, FIELD - 2);
  for (let i = 0; i < 4 && st.poss === 0 && !st.tfp; i += 1) resolvePlay(st, { type: 'inside', star: 3 }, { type: 'deep', star: 1 });
  return st.tfp && st.poss === 0 ? st : null;
};

describe('the kicker', () => {
  it('a new club and every school have one: the best foot (the substitute, between equals)', () => {
    const s = newSeason(3);
    signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
    const players = s.members.map(asPlayer);
    expect(s.lineup!.k).toBe(bestKicker(players, s.lineup!));
    const best = Math.max(...players.map((p) => kickFit(p.stats)));
    expect(kickFit(players.find((p) => p.id === s.lineup!.k)!.stats)).toBe(best);
    expect(bestLineup(players).k).toBe(s.lineup!.k);
    for (let i = 0; i < 4; i += 1) expect(kickerOf(opponentSheet(i))).not.toBeNull();
  });

  it('without a kicker there are no kick cards, and a kick cannot be played', () => {
    const st = match(noKicker(BASE));
    expect(kickPicks(st, 0)).toEqual([]);
    expect(kickBlock(st, 0, 'fg')).toBe('nobody');
    expect(() => resolvePlay(st, kick('fg'), call())).toThrow();
    // the team without the ball has none either
    expect(kickPicks(match(BASE), 1)).toEqual([]);
  });

  it('with one, a field goal and a punt are in the hand; the field goal only from close enough', () => {
    const near = match(BASE, 7, FIELD - 12);
    expect(kickPicks(near, 0).map((p) => p.type)).toEqual(['fg', 'punt']);
    expect(kickBlock(near, 0, 'fg')).toBeNull();
    expect(kickBlock(match(BASE, 7, 5), 0, 'fg')).toBe('far');
    expect(kickBlock(near, 0, 'pat')).toBe('time');
    expect(fgChance(near, 0)).toBeGreaterThan(fgChance(match(BASE, 7, FIELD - 26), 0));
    expect(fgChance(match(tuned(BASE, 25), 7, FIELD - 26), 0)).toBeGreaterThan(fgChance(match(tuned(BASE, -25), 7, FIELD - 26), 0));
  });
});

describe('a field goal', () => {
  it('is three points and the ball goes to the other team; a miss gives it away where it lies', () => {
    let made = 0;
    let missed = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const st = match(BASE, seed, FIELD - 18);
      const left = st.left;
      const res = resolvePlay(st, kick('fg'), call());
      expect(res.kick!.type).toBe('fg');
      expect(res.outcome).toBe('kick');
      expect(st.left).toBe(left - 1);
      if (res.kick!.good) {
        made += 1;
        expect(st.score).toEqual([FG_POINTS, 0]);
        expect(res.points).toBe(FG_POINTS);
        // the team that scored kicks off next
        expect(st.ko).toBe(true);
        expect(st.poss).toBe(0);
        expect(st.pos).toBe(KICKOFF_FROM);
        expect(res.turnover).toBeNull();
      } else {
        missed += 1;
        expect(st.score).toEqual([0, 0]);
        expect(res.turnover).toBe('miss');
        expect(st.poss).toBe(1);
        expect(st.ko).toBeFalsy();
        expect(st.pos).toBe(18);
      }
    }
    const p = fgChance(match(BASE, 1, FIELD - 18), 0);
    expect(Math.abs(made / 200 - p)).toBeLessThan(0.12);
    expect(missed).toBeGreaterThan(0);
  });

  it('goes in more often from close in than from far out', () => {
    const rate = (pos: number): number => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed += 1) if (resolvePlay(match(BASE, seed, pos), kick('fg'), call()).kick!.good) n += 1;
      return n / 300;
    };
    expect(rate(FIELD - 8)).toBeGreaterThan(rate(FIELD - 24) + 0.15);
  });
});

describe('a punt', () => {
  it('sends the other team back: it starts much farther from the goal than after a failed fourth down', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const st = match(BASE, seed, 15);
      const res = resolvePlay(st, kick('punt'), call());
      expect(res.turnover).toBe('punt');
      expect(st.poss).toBe(1);
      expect(st.down).toBe(1);
      // without the punt they would start 15 yards from our goal line, that is at 35
      expect(st.pos).toBeLessThan(FIELD - 15 - 7);
      expect(st.pos).toBeGreaterThanOrEqual(3);
      expect(res.kick!.dist).toBe(res.yards);
      expect(st.score).toEqual([0, 0]);
    }
  });

  it('into the end zone, the ball comes out to the ten', () => {
    const st = match(BASE, 3, FIELD - 5);
    resolvePlay(st, kick('punt'), call());
    expect(st.pos).toBe(10);
  });
});

describe('the try after a touchdown', () => {
  it('a touchdown is six points and the same team plays once more from close in, off the clock', () => {
    let seen = 0;
    for (let seed = 1; seed <= 40 && seen < 12; seed += 1) {
      const st = match(tuned(BASE, 30), seed, FIELD - 2);
      const left = st.left;
      const res = resolvePlay(st, { type: 'inside', star: 3 }, { type: 'deep', star: 1 });
      if (!res.td) continue;
      seen += 1;
      expect(res.points).toBe(TD_POINTS);
      expect(st.score).toEqual([TD_POINTS, 0]);
      expect(st.tfp).toBe(true);
      expect(st.poss).toBe(0);
      expect(FIELD - st.pos).toBe(TRY_YARDS);
      // the clock waits for the try
      expect(st.left).toBe(left);
      expect(kickPicks(st, 0).map((p) => p.type)).toEqual(['pat']);
      expect(kickBlock(st, 0, 'fg')).toBe('time');
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('the kick is one point; made or missed, a kickoff to the other team comes next and one play is gone', () => {
    let made = 0;
    let n = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const st = afterTouchdown(BASE, seed);
      if (!st) continue;
      n += 1;
      const left = st.left;
      const res = resolvePlay(st, kick('pat'), call());
      expect(res.tfp).toBe(true);
      expect(st.tfp).toBe(false);
      expect(st.ko).toBe(true);
      expect(st.poss).toBe(0);
      expect(st.pos).toBe(KICKOFF_FROM);
      expect(st.left === left - 1 || st.left === PLAYS_PER_Q).toBe(true);
      expect(st.score[0]).toBe(TD_POINTS + (res.kick!.good ? PAT_POINTS : 0));
      if (res.kick!.good) made += 1;
    }
    expect(n).toBeGreaterThan(40);
    expect(Math.abs(made / n - patChance(tuned(BASE, 30)))).toBeLessThan(0.15);
  });

  it('a play instead is two points for reaching the end zone and nothing otherwise', () => {
    let two = 0;
    let none = 0;
    for (let seed = 1; seed <= 160; seed += 1) {
      const st = afterTouchdown(BASE, seed);
      if (!st) continue;
      const strong = seed % 2 === 0;
      const res = resolvePlay(st, { type: 'inside', star: strong ? 3 : 1 }, { type: strong ? 'deep' : 'stuff', star: strong ? 1 : 3 });
      expect(res.tfp).toBe(true);
      expect(res.td).toBe(false);
      expect(st.ko).toBe(true);
      expect(st.poss).toBe(0);
      expect([0, TWO_POINTS]).toContain(res.points);
      expect(st.score[0]).toBe(TD_POINTS + res.points);
      if (res.points) two += 1;
      else none += 1;
    }
    expect(two).toBeGreaterThan(10);
    expect(none).toBeGreaterThan(10);
  });

  it('the play is the gamble: between even teams it comes off far less often than the kick, and the card says so', () => {
    let made = 0;
    let n = 0;
    let shown = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const st = match(BASE, seed, FIELD - TRY_YARDS);
      st.tfp = true;
      st.down = 1;
      st.toGo = TRY_YARDS;
      const mine: Pick = { type: seed % 2 ? 'inside' : 'short', star: 2 };
      shown += outlook(st, 0, mine)!;
      expect(outlook(st, 0, kick('pat'))).toBe(Math.round(patChance(BASE) * 10));
      const res = resolvePlay(st, mine, autoPick(st, 1));
      n += 1;
      if (res.points) made += 1;
    }
    expect(made / n).toBeGreaterThan(0.3);
    expect(made / n).toBeLessThan(patChance(BASE) - 0.2);
    // the number on the card is the chance of getting there, out of ten: near what really happens
    expect(Math.abs(shown / n / 10 - made / n)).toBeLessThan(0.25);
  });

  it('without a kicker only the play is left', () => {
    const st = afterTouchdown(noKicker(BASE), 4) ?? afterTouchdown(noKicker(BASE), 5) ?? afterTouchdown(noKicker(BASE), 6);
    expect(st).not.toBeNull();
    expect(kickPicks(st!, 0)).toEqual([]);
    expect(autoPick(st!, 0).type).not.toBe('pat');
  });
});

describe('what the player is shown about a kick', () => {
  it('the number on a kick is its chance; the kicker is the hero it is about; on fourth down the kicker speaks', () => {
    const st = match(BASE, 7, FIELD - 10);
    st.down = 4;
    const v = outlook(st, 0, kick('fg'))!;
    expect(v).toBe(Math.max(1, Math.min(10, Math.round(fgChance(st, 0) * 10))));
    expect(outlook(st, 0, kick('punt'))).toBeNull();
    expect(keyHeroes(st, 0, kick('fg'))[0]).toEqual({ id: BASE.lineup.k, pos: 'K' });
    const voices = huddle(st, 0);
    expect(voices[1]!.topic).toBe('kick');
    expect(voices[1]!.id).toBe(BASE.lineup.k);
    expect(voices[0]!.id).not.toBe(voices[1]!.id);
  });
});

describe('whole games with kicks', () => {
  it('are still the same for the same seed, end, and now and then somebody kicks', () => {
    let fgs = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const a = simulate(BASE, opponentSheet(2), seed);
      const b = simulate(BASE, opponentSheet(2), seed);
      expect(a.score).toEqual(b.score);
      expect(a.over).toBe(true);
      expect(a.tfp).toBeFalsy();
      for (const sc of a.score) if (sc % TD_POINTS !== 0 && sc % (TD_POINTS + PAT_POINTS) !== 0) fgs += 1;
    }
    expect(fgs).toBeGreaterThan(0);
  });
});
