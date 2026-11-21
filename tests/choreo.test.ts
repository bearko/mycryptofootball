import { describe, expect, it } from 'vitest';
import { isRun } from '../src/game/cards';
import { FIELD, autoPeek, autoPick, createMatch, resolvePlay, type PlayResult, type TeamSheet } from '../src/game/match';
import { isKick } from '../src/game/cards';
import { ROSTER_SIZE, clubSheet, newSeason, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';
import { END, WIDTH } from '../src/ui/stadium/assets';
import { buildScript, evalKeys, specOf } from '../src/ui/stadium/choreo';

const HOME: TeamSheet = (() => {
  const s = newSeason(5);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  s.day = 6;
  return clubSheet(s);
})();

/** every play of a few whole games, as the picture gets them */
function plays(): { res: PlayResult; teams: [TeamSheet, TeamSheet] }[] {
  const out: { res: PlayResult; teams: [TeamSheet, TeamSheet] }[] = [];
  for (let seed = 1; seed <= 6; seed += 1) {
    const st = createMatch(HOME, opponentSheet(seed % 4), seed);
    for (let guard = 0; !st.over && guard < 400; guard += 1) {
      const o = st.poss;
      const d = (1 - o) as 0 | 1;
      const def0 = autoPick(st, d);
      const off = autoPick(st, o, def0);
      const def = def0.special || off.peeked || isKick(off.type) ? def0 : (autoPeek(st, d, off) ?? def0);
      out.push({ res: resolvePlay(st, off, def), teams: [st.teams[0], st.teams[1]] });
    }
  }
  return out;
}

describe('the play as it was drawn up (the lines the picture shows over a play)', () => {
  const all = plays();

  it('a run has the runner\'s way, a pass a route for the receiver and one for the other: all on the field, going forward', () => {
    let runs = 0;
    let passes = 0;
    for (const { res, teams } of all) {
      const spec = specOf(res);
      const sc = buildScript(teams, spec, () => null, false);
      const O = teams[spec.off];
      if (spec.kick) {
        expect(sc.design).toEqual([]);
        continue;
      }
      for (const d of sc.design) {
        expect(d.team).toBe(spec.off);
        expect(d.way.length).toBeGreaterThanOrEqual(3);
        for (const [x, z] of d.way) {
          expect(x).toBeGreaterThanOrEqual(-END);
          expect(x).toBeLessThanOrEqual(FIELD + END);
          expect(z).toBeGreaterThanOrEqual(0);
          expect(z).toBeLessThanOrEqual(WIDTH);
        }
        // it ends farther toward the goal the offense attacks than it starts
        const first = d.way[0]!;
        const last = d.way[d.way.length - 1]!;
        expect((last[0] - first[0]) * sc.dir).toBeGreaterThan(0);
      }
      if (isRun(spec.type)) {
        runs += 1;
        expect(sc.design.map((d) => d.kind)).toEqual(['run']);
        expect(sc.design[0]!.id).toBe(O.lineup.off.RB);
      } else {
        passes += 1;
        expect(sc.design.map((d) => d.kind).sort()).toEqual(['decoy', 'route']);
        const ids = sc.design.map((d) => d.id).sort();
        expect(ids).toEqual([O.lineup.off.WR1, O.lineup.off.WR2].sort());
        // the route ends where the pass is thrown to
        const route = sc.design.find((d) => d.kind === 'route')!;
        const end = route.way[route.way.length - 1]!;
        expect(Math.abs(end[0] - sc.spotX)).toBeLessThan(0.01);
      }
    }
    expect(runs).toBeGreaterThan(20);
    expect(passes).toBeGreaterThan(20);
  });

  it('the hero really sets off along the line drawn for him', () => {
    const tmp = { x: 0, z: 0 };
    for (const { res, teams } of all) {
      const spec = specOf(res);
      if (spec.kick) continue;
      const sc = buildScript(teams, spec, () => null, false);
      for (const d of sc.design) {
        const plan = sc.plans.find((p) => p.team === d.team && p.id === d.id)!;
        evalKeys(plan.keys, sc.snap, tmp);
        expect(Math.hypot(tmp.x - d.way[0]![0], tmp.z - d.way[0]![1])).toBeLessThan(0.8);
      }
    }
  });
});

describe('the sideline sign', () => {
  it('says which down it is and how far there is to go', async () => {
    const { sticksText } = await import('../src/ui/stadium/sticks');
    expect(sticksText({ down: 1, toGo: 10, tfp: false, gainX: 30 })).toBe('1st & 10');
    expect(sticksText({ down: 2, toGo: 7, tfp: false, gainX: 30 })).toBe('2nd & 7');
    expect(sticksText({ down: 3, toGo: 1, tfp: false, gainX: 30 })).toBe('3rd & 1');
    // the goal line is nearer than ten yards: there is no line to reach but the goal
    expect(sticksText({ down: 4, toGo: 6, tfp: false, gainX: null })).toBe('4th & GOAL');
    expect(sticksText({ down: 1, toGo: 3, tfp: true, gainX: null })).toBe('TFP');
  });

  it('every play carries its down to the picture', () => {
    const st = createMatch(HOME, opponentSheet(1), 3);
    for (let i = 0; i < 12 && !st.over; i += 1) {
      const down = st.down;
      const o = st.poss;
      const def = autoPick(st, (1 - o) as 0 | 1);
      const res = resolvePlay(st, autoPick(st, o, def), def);
      // (a kickoff has no down: the sign stays away)
      expect(specOf(res).down).toBe(res.kick?.type === 'kickoff' || res.kick?.type === 'onside' ? undefined : down);
    }
  });
});
