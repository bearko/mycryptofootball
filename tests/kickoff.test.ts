import { describe, expect, it } from 'vitest';
import { isKickoff } from '../src/game/cards';
import {
  FIELD, FIRST_MATCH, KICKOFF_FROM, ONSIDE_YARDS, PLAYS_PER_Q, QUARTERS, START, TD_POINTS, FG_POINTS, autoPick, canOnside, createMatch, createStory,
  dropStory, huddle, kickBlock, kickPicks, kickoffKicker, onsideChance, outlook, resolvePlay, returnerOf, storyFresh, type MatchState, type Pick,
  type PlayResult, type TeamSheet,
} from '../src/game/match';
import { ROSTER_SIZE, clubSheet, newSeason, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';
import { WIDTH } from '../src/ui/stadium/assets';
import { buildScript, kickoffForm, lineUp, specOf } from '../src/ui/stadium/choreo';
import { opened } from './open';

const HOME: TeamSheet = (() => {
  const s = newSeason(5);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  s.day = 6;
  return clubSheet(s);
})();
const KO: Pick = { type: 'kickoff', star: 1 };
const ON: Pick = { type: 'onside', star: 1 };
const ZONE: Pick = { type: 'zone', star: 1 };
/** a kickoff by team 0 with the given score, quarter and plays left */
const kicking = (seed: number, score: [number, number], quarter: number, left = 3, away = opponentSheet(1)): MatchState => {
  const st = createMatch(HOME, away, seed);
  st.poss = 0;
  st.pos = KICKOFF_FROM;
  st.ko = true;
  st.score = score;
  st.quarter = quarter;
  st.left = left;
  return st;
};

describe('the kickoff', () => {
  it('opens the match: the team that does not get the ball first kicks it, nothing else can be played, no play goes off the clock', () => {
    const pos: number[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const st = createMatch(HOME, opponentSheet(seed % 4), seed);
      const kicker = st.poss;
      expect(st.ko).toBe(true);
      expect(kicker).toBe(1 - st.first);
      expect(st.pos).toBe(KICKOFF_FROM);
      expect(kickPicks(st, kicker).map((p) => p.type)).toEqual(['kickoff']);
      expect(kickPicks(st, (1 - kicker) as 0 | 1)).toEqual([]);
      expect(kickBlock(st, kicker, 'fg')).toBe('time');
      expect(huddle(st, 0)).toEqual([]);
      expect(() => resolvePlay(createMatch(HOME, opponentSheet(0), seed), { type: 'inside', star: 1 }, ZONE)).toThrow();
      expect(autoPick(st, kicker).type).toBe('kickoff');
      const res = resolvePlay(st, autoPick(st, kicker), autoPick(st, (1 - kicker) as 0 | 1));
      expect(res.kick!.type).toBe('kickoff');
      expect(res.off).toBe(kicker);
      expect(res.kick!.kicker).toBe(kickoffKicker(st.teams[kicker]).id);
      expect(res.kick!.returner).toBe(returnerOf(st.teams[st.first]).id);
      expect(res.points).toBe(0);
      expect(res.period).toBeNull();
      expect(st.ko).toBe(false);
      expect(st.poss).toBe(st.first);
      expect(st.quarter).toBe(1);
      expect(st.left).toBe(PLAYS_PER_Q);
      expect(st.down).toBe(1);
      expect(st.pos).toBeGreaterThanOrEqual(3);
      expect(st.pos).toBeLessThanOrEqual(30);
      expect(res.kick!.spot).toBe(st.pos);
      // caught and run back, or into the end zone and out to the twelve
      if (res.kick!.ret) expect(st.pos).toBe(FIELD - KICKOFF_FROM - res.kick!.dist + res.kick!.ret);
      else expect(st.pos).toBe(12);
      expect(st.hand.off).toHaveLength(3);
      pos.push(st.pos);
    }
    // a drive starts about where it always did
    const mean = pos.reduce((a, b) => a + b, 0) / pos.length;
    expect(Math.abs(mean - START)).toBeLessThan(2);
    expect(new Set(pos).size).toBeGreaterThan(8);
  });

  it('follows every score (the team that scored kicks), and begins the second half (the team that kicked off first receives)', () => {
    let scores = 0;
    let halves = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const st = createMatch(HOME, opponentSheet(seed % 4), seed);
      for (let guard = 0; !st.over && guard < 400; guard += 1) {
        const o = st.poss;
        const def = autoPick(st, (1 - o) as 0 | 1);
        const before = [...st.score];
        const wasTry = !!st.tfp;
        const res = resolvePlay(st, autoPick(st, o, def), def);
        if (st.over) break;
        if (res.period === 'half') {
          halves += 1;
          expect(st.ko).toBe(true);
          expect(st.poss).toBe(st.first);
        } else if ((wasTry || (res.kick?.type === 'fg' && res.kick.good)) && !res.period) {
          scores += 1;
          expect(st.score[o]).toBeGreaterThanOrEqual(before[o]!);
          expect(st.ko).toBe(true);
          expect(st.poss).toBe(o);
        } else if (!res.period) expect(!!st.ko).toBe(false);
        if (st.ko) expect(st.pos).toBe(KICKOFF_FROM);
      }
    }
    expect(halves).toBe(40);
    expect(scores).toBeGreaterThan(60);
  });
});

describe('the onside kick', () => {
  it('is offered only to a team that is behind in the last quarter, six a side or eleven', () => {
    for (const away of [opponentSheet(1), opponentSheet(1, 2)]) {
      const home = away.players.length > 8 ? opponentSheet(0, 2) : HOME;
      const st = createMatch(home, away, 3);
      st.poss = 0;
      st.ko = true;
      const set = (score: [number, number], quarter: number): MatchState => Object.assign(st, { score, quarter });
      expect(canOnside(set([0, 7], QUARTERS), 0)).toBe(true);
      expect(kickPicks(st, 0).map((p) => p.type)).toEqual(['kickoff', 'onside']);
      expect(kickBlock(st, 0, 'onside')).toBeNull();
      expect(outlook(st, 0, ON)).toBe(Math.max(1, Math.round(onsideChance(home) * 10)));
      expect(outlook(st, 0, KO)).toBeNull();
      for (const [score, quarter] of [[[7, 7], QUARTERS], [[14, 7], QUARTERS], [[0, 7], QUARTERS - 1], [[0, 7], 1]] as [[number, number], number][]) {
        expect(canOnside(set(score, quarter), 0)).toBe(false);
        expect(kickPicks(st, 0).map((p) => p.type)).toEqual(['kickoff']);
        expect(kickBlock(st, 0, 'onside')).toBe('time');
        expect(() => resolvePlay(st, ON, ZONE)).toThrow();
      }
    }
  });

  it('now and then wins the ball back a few yards on; usually the other team falls on it, close to the goal', () => {
    let won = 0;
    const N = 400;
    for (let seed = 1; seed <= N; seed += 1) {
      const st = kicking(seed, [0, 7], QUARTERS);
      const res = resolvePlay(st, ON, ZONE);
      expect(res.kick!.type).toBe('onside');
      expect(res.kick!.dist).toBe(ONSIDE_YARDS);
      expect(st.ko).toBe(false);
      expect(st.left).toBe(3);
      expect(st.down).toBe(1);
      if (res.kick!.good) {
        won += 1;
        expect(st.poss).toBe(0);
        expect(st.pos).toBe(KICKOFF_FROM + ONSIDE_YARDS);
      } else {
        expect(st.poss).toBe(1);
        expect(FIELD - st.pos).toBe(KICKOFF_FROM + ONSIDE_YARDS);
      }
    }
    expect(Math.abs(won / N - onsideChance(HOME))).toBeLessThan(0.06);
    expect(onsideChance(HOME)).toBeGreaterThan(0.1);
    expect(onsideChance(HOME)).toBeLessThan(0.35);
  });

  it('the computer tries it when it is behind and the game is running out, not before', () => {
    let late = 0;
    let early = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const a = kicking(seed, [0, 7], QUARTERS, 2);
      if (autoPick(a, 0).type === 'onside') late += 1;
      const b = kicking(seed, [0, 7], QUARTERS, PLAYS_PER_Q);
      if (autoPick(b, 0).type === 'onside') early += 1;
      expect(autoPick(kicking(seed, [0, 7], 2), 0).type).toBe('kickoff');
      expect(autoPick(kicking(seed, [7, 0], QUARTERS, 1), 0).type).toBe('kickoff');
    }
    expect(late).toBeGreaterThan(150);
    expect(early).toBe(0);
  });
});

describe('the kickoff on the field', () => {
  const sides: [TeamSheet, TeamSheet][] = [[HOME, opponentSheet(1)], [opponentSheet(0, 2), opponentSheet(1, 2)]];

  it('both teams line up, each hero once, nobody on top of anybody; the kicker is there even if he does not play defense', () => {
    for (const teams of sides) {
      const size = teams[0].players.length > 8 ? 11 : 6;
      for (const recv of [0, 1] as const) {
        const K = teams[1 - recv]!;
        const outsider = K.players.find((p) => !Object.values(K.lineup.def).includes(p.id));
        for (const kicker of [kickoffKicker(K).id, K.lineup.def.DL1, ...(outsider ? [outsider.id] : [])]) {
          const form = kickoffForm(teams, recv, FIELD - KICKOFF_FROM, kicker);
          expect(form.length).toBe(size * 2);
          expect(new Set(form.map((f) => `${f.team}:${f.id}`)).size).toBe(size * 2);
          expect(form.filter((f) => f.team === recv).length).toBe(size);
          expect(form.some((f) => f.team !== recv && f.id === kicker)).toBe(true);
          expect(form.some((f) => f.team === recv && f.id === returnerOf(teams[recv]).id)).toBe(true);
          for (let i = 0; i < form.length; i += 1) {
            const a = form[i]!;
            expect(a.at[0]).toBeGreaterThan(0);
            expect(a.at[0]).toBeLessThan(FIELD);
            expect(a.at[1]).toBeGreaterThan(0.5);
            expect(a.at[1]).toBeLessThan(WIDTH - 0.5);
            // the team that kicks stands behind the ball, the other one at least ten yards from it
            if (a.team === recv) expect(a.at[0]).toBeLessThanOrEqual(FIELD - KICKOFF_FROM - 10);
            else expect(a.at[0]).toBeGreaterThan(FIELD - KICKOFF_FROM);
            for (let j = i + 1; j < form.length; j += 1) {
              expect(Math.hypot(a.at[0] - form[j]!.at[0], a.at[1] - form[j]!.at[1]), `${a.pos} ${form[j]!.pos}`).toBeGreaterThan(1.1);
            }
          }
          expect(lineUp(teams, recv, FIELD - KICKOFF_FROM, undefined, kicker).length).toBe(size * 2);
        }
      }
    }
  });

  it('every kickoff of a few games is a whole script: the ball is somewhere all the time, and ends with the team that has it', () => {
    let deep = 0;
    let short = 0;
    for (const teams of sides) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const list: { res: PlayResult; st: MatchState }[] = [];
        const st = createMatch(teams[0], teams[1], seed);
        for (let guard = 0; !st.over && guard < 400; guard += 1) {
          const def = autoPick(st, (1 - st.poss) as 0 | 1);
          const res = resolvePlay(st, autoPick(st, st.poss, def), def);
          if (res.kick && isKickoff(res.kick.type)) list.push({ res, st: { ...st } });
        }
        // and a short one each way, won and lost
        for (let k = 0; k < 4; k += 1) {
          const on = createMatch(teams[0], teams[1], seed * 10 + k);
          on.poss = (k % 2) as 0 | 1;
          on.ko = true;
          on.pos = KICKOFF_FROM;
          on.quarter = QUARTERS;
          on.score = on.poss === 0 ? [0, 7] : [7, 0];
          list.push({ res: resolvePlay(on, ON, ZONE), st: { ...on } });
        }
        for (const { res, st: after } of list) {
          const spec = specOf(res);
          expect(spec.off).toBe(1 - res.off);
          expect(spec.los).toBe(FIELD - KICKOFF_FROM);
          expect(spec.down).toBeUndefined();
          for (const fast of [false, true]) {
            const sc = buildScript(teams, spec, () => null, fast);
            expect(sc.plans.length).toBe(teams[0].players.length > 8 ? 22 : 12);
            for (const p of sc.plans) {
              let last = -1;
              for (const key of p.keys) {
                expect(Number.isFinite(key.x) && Number.isFinite(key.z)).toBe(true);
                expect(key.t).toBeGreaterThan(last);
                last = key.t;
                expect(key.x).toBeGreaterThanOrEqual(-4.4);
                expect(key.x).toBeLessThanOrEqual(FIELD + 4.4);
              }
              expect(last).toBeLessThanOrEqual(sc.dur);
            }
            // the ball: one piece after the other, no gap
            expect(sc.ball[0]!.t0).toBe(0);
            for (let i = 1; i < sc.ball.length; i += 1) expect(sc.ball[i]!.t0).toBeCloseTo(sc.ball[i - 1]!.t1, 5);
            const end = sc.ball[sc.ball.length - 1]!;
            expect(end.kind).toBe('held');
            // whoever holds it at the end plays for the team that has the ball now
            if (end.kind === 'held') expect(end.team).toBe(after.poss);
            expect(sc.cues.filter((c) => c.c === 'kick').length).toBe(1);
            expect(sc.cues[sc.cues.length - 1]!.c).toBe('end');
            expect(sc.design).toEqual([]);
          }
          if (res.kick!.type === 'onside') short += 1;
          else deep += 1;
        }
      }
    }
    expect(deep).toBeGreaterThan(100);
    expect(short).toBeGreaterThan(90);
  });
});

describe('the first match as a story', () => {
  const calls: Pick[][] = [
    [{ type: 'inside', star: 1 }, { type: 'short', star: 1 }, { type: 'inside', star: 1 }, { type: 'short', star: 1 }, { type: 'outside', star: 1 }],
    [{ type: 'long', star: 1 }, { type: 'long', star: 1 }, { type: 'long', star: 1 }, { type: 'long', star: 1 }, { type: 'long', star: 1 }],
    [{ type: 'outside', star: 1 }, { type: 'inside', star: 1 }, { type: 'outside', star: 1 }, { type: 'inside', star: 1 }, { type: 'short', star: 1 }],
  ];

  it('the visitors kick a field goal, the coach takes over, and whatever is called the drive ends in the winning touchdown as time runs out', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const mine of calls) {
        const st = createStory(HOME, opponentSheet(0), seed);
        expect(storyFresh(st)).toBe(true);
        expect(st.quarter).toBe(QUARTERS - 1);
        expect(st.poss).toBe(1);
        expect(st.score).toEqual([0, 0]);
        // nobody is calling the plays: the other team simply kicks
        const fg = autoPick(st, 1);
        expect(fg.type).toBe('fg');
        expect(kickPicks(st, 0)).toEqual([]);
        const first = resolvePlay(st, fg, autoPick(st, 0));
        expect(first.kick!.good).toBe(true);
        expect(st.score).toEqual([0, FG_POINTS]);
        expect(first.period).toBe('quarter');
        expect(st.quarter).toBe(QUARTERS);
        expect(st.left).toBe(FIRST_MATCH.length - 1);
        expect(storyFresh(st)).toBe(false);
        // they kick off, an ordinary kick: there is no short one in the story, for either side
        expect(st.ko).toBe(true);
        expect(st.poss).toBe(1);
        expect(canOnside(st, 1)).toBe(false);
        expect(autoPick(st, 1).type).toBe('kickoff');
        resolvePlay(st, autoPick(st, 1), autoPick(st, 0));
        expect(st.poss).toBe(0);
        expect(st.pos).toBe(START);
        const start = st.pos;
        let gained = 0;
        mine.forEach((pick, i) => {
          expect(st.over).toBe(false);
          expect(st.poss).toBe(0);
          // every play is on the table, no kicks, and nothing to read
          expect(st.hand.off.map((c) => c.type)).toEqual(['inside', 'outside', 'short', 'long']);
          expect(kickPicks(st, 0)).toEqual([]);
          expect(huddle(st, 0)).toEqual([]);
          const res = resolvePlay(st, pick, autoPick(st, 1));
          expect(res.outcome).toBe('gain');
          expect(res.turnover).toBeNull();
          expect(res.yards).toBeGreaterThan(0);
          gained += res.yards;
          expect(res.td).toBe(i === mine.length - 1);
          if (i === 0) expect(res.yards).toBe(7);
          if (i === 1) {
            expect(res.yards).toBe(11);
            expect(res.firstDown).toBe(true);
          }
        });
        expect(gained).toBe(FIELD - start);
        expect(st.over).toBe(true);
        expect(st.score).toEqual([TD_POINTS, FG_POINTS]);
        expect(st.script).toBeUndefined();
        expect(st.tfp).toBeFalsy();
      }
    }
  });

  it('dropped, what is left is an ordinary match: it can be lost', () => {
    let lost = 0;
    let won = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const st = createStory(HOME, opponentSheet(3), seed);
      resolvePlay(st, autoPick(st, 1), autoPick(st, 0));
      dropStory(st);
      expect(st.script).toBeUndefined();
      expect(st.hand.off).toHaveLength(3);
      for (let guard = 0; !st.over && guard < 200; guard += 1) {
        const def = autoPick(st, (1 - st.poss) as 0 | 1);
        resolvePlay(st, autoPick(st, st.poss, def), def);
      }
      expect(st.over).toBe(true);
      if (st.score[0] > st.score[1]) won += 1;
      else lost += 1;
    }
    expect(lost).toBeGreaterThan(10);
    expect(won + lost).toBe(60);
  });

  it('an ordinary match is never a story', () => {
    expect(createMatch(HOME, opponentSheet(0), 1).script).toBeUndefined();
    expect(opened(HOME, opponentSheet(0), 1).script).toBeUndefined();
  });
});
