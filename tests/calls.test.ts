import { describe, expect, it } from 'vitest';
import { callFor, type Beat, type CallNames } from '../src/game/calls';
import { isKick, isRun, type OffType } from '../src/game/cards';
import { hero } from '../src/game/heroes';
import { autoPick, createMatch, resolvePlay, type PlayResult, type TeamSheet } from '../src/game/match';
import { ROSTER_SIZE, clubSheet, newSeason, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';
import { WIDTH } from '../src/ui/stadium/assets';
import { ROUTE_LABEL, buildScript, routeWay, routesFor, specOf, type RouteName } from '../src/ui/stadium/choreo';

const HOME: TeamSheet = (() => {
  const s = newSeason(5);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  s.day = 6;
  return clubSheet(s);
})();
const NAMES: CallNames = { teams: ['マイクリ', '相手校'], hero: (id) => hero(id).name };
const BEATS: Beat[] = ['snap', 'handoff', 'throw', 'catch', 'drop', 'break', 'steal', 'touchdown', 'kick', 'end'];

function plays(): { res: PlayResult; teams: [TeamSheet, TeamSheet] }[] {
  const out: { res: PlayResult; teams: [TeamSheet, TeamSheet] }[] = [];
  for (let seed = 1; seed <= 10; seed += 1) {
    const st = createMatch(HOME, opponentSheet(seed % 4), seed);
    for (let guard = 0; !st.over && guard < 400; guard += 1) {
      const def = autoPick(st, (1 - st.poss) as 0 | 1);
      out.push({ res: resolvePlay(st, autoPick(st, st.poss, def), def), teams: [st.teams[0], st.teams[1]] });
    }
  }
  return out;
}

describe('the play-by-play', () => {
  const all = plays();

  it('has something sensible to say at every beat of every play, and says the same thing every time', () => {
    for (const { res } of all) {
      for (const beat of BEATS) {
        const c = callFor(beat, res, NAMES, 'スラント');
        if (!c) continue;
        expect(c.head.length).toBeGreaterThan(1);
        expect(c.head.length).toBeLessThanOrEqual(12);
        expect(`${c.head}${c.tail ?? ''}`).not.toMatch(/undefined|null|NaN/);
        expect(callFor(beat, res, NAMES, 'スラント')).toEqual(c);
      }
      // the play always opens with a call
      expect(callFor('snap', res, NAMES)).not.toBeNull();
    }
  });

  it('shouts the big moments: a sack, a ball taken away and a touchdown are hot, and good for the right side', () => {
    let sacks = 0;
    let steals = 0;
    let scores = 0;
    for (const { res } of all) {
      if (res.kick || res.tfp) continue;
      if (res.outcome === 'sack') {
        sacks += 1;
        const c = callFor('end', res, NAMES)!;
        expect(c.hot).toBe(true);
        expect(c.side).toBe('def');
        expect(c.head).toMatch(/サ.*ック/);
        expect(c.tail).toContain(hero(res.defender).name);
      }
      if (res.turnover === 'int' || res.turnover === 'fumble') {
        steals += 1;
        const c = callFor('steal', res, NAMES)!;
        expect(c.hot).toBe(true);
        expect(c.side).toBe('def');
        // said once: the end of the play adds nothing
        expect(callFor('end', res, NAMES)).toBeNull();
      }
      if (res.td) {
        scores += 1;
        const c = callFor('touchdown', res, NAMES)!;
        expect(c.hot).toBe(true);
        expect(c.side).toBe('off');
      }
    }
    expect(sacks).toBeGreaterThan(1);
    expect(steals).toBeGreaterThan(3);
    expect(scores).toBeGreaterThan(10);
  });

  it('names the route when the ball is thrown', () => {
    const pass = all.find(({ res }) => !isKick(res.offPick.type) && !isRun(res.offPick.type as OffType))!;
    const c = callFor('throw', pass.res, NAMES, 'ロングポスト')!;
    expect(`${c.head}${c.tail}`).toContain('ロングポスト');
  });
});

describe('the route tree', () => {
  const all = plays();
  const NAMES_OF = Object.keys(ROUTE_LABEL) as RouteName[];

  it('every route goes from the line of scrimmage to the spot asked for, inside the field', () => {
    for (const name of NAMES_OF) {
      for (const [v0, inward] of [[2.6, 1], [21.4, -1]] as const) {
        for (const depth of [1, 4, 9, 14, 20, 30]) {
          const way = routeWay(name, 10, v0, depth, inward, 42);
          expect(way.length).toBeGreaterThanOrEqual(2);
          const last = way[way.length - 1]!;
          expect(last[0]).toBeCloseTo(10 + depth, 5);
          for (const [, v] of way) {
            expect(v).toBeGreaterThan(0.5);
            expect(v).toBeLessThan(WIDTH - 0.5);
          }
        }
      }
    }
  });

  it('short and long passes pick from their own part of the tree', () => {
    expect(routesFor(false, 2)).toContain('lookin');
    expect(routesFor(false, 6)).toContain('slant');
    expect(routesFor(true, 12)).toContain('squarein');
    expect(routesFor(true, 25)).toContain('up');
    for (const d of [1, 5, 9]) for (const r of routesFor(false, d)) expect(routesFor(true, 20)).not.toContain(r);
  });

  it('over a few games nearly the whole tree is run, and the two receivers never run the same route', () => {
    const seen = new Set<RouteName>();
    for (const { res, teams } of all) {
      const spec = specOf(res);
      if (spec.kick || isRun(spec.type)) continue;
      const sc = buildScript(teams, spec, () => null, false);
      if (spec.outcome === 'sack') {
        expect(sc.route).toBeUndefined();
        continue;
      }
      expect(sc.route).toBeDefined();
      seen.add(sc.route!);
      const [a, b] = sc.design;
      expect(JSON.stringify(a!.way.slice(1).map((p) => [Math.round(Math.abs(p[0] - a!.way[0]![0])), Math.round(Math.abs(p[1] - a!.way[0]![1]))])))
        .not.toBe(JSON.stringify(b!.way.slice(1).map((p) => [Math.round(Math.abs(p[0] - b!.way[0]![0])), Math.round(Math.abs(p[1] - b!.way[0]![1]))])));
    }
    expect(seen.size).toBeGreaterThanOrEqual(14);
  });
});
