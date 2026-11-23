// The day's duel as the stadium stages it (stadium/choreo.ts): every play with a duel has its moment, the paths
// stay in order, and the defender the ace steps around does not fly to catch him afterwards.
import { describe, expect, it } from 'vitest';
import { buildScript, evalKeys, type PlaySpec } from '../src/ui/stadium/choreo';
import { opponentSheet } from '../src/game/teams';
import type { TeamSheet } from '../src/game/match';
import type { OffType } from '../src/game/cards';

const teams: [TeamSheet, TeamSheet] = [opponentSheet(0, 4), opponentSheet(1, 4)];
const [O, D] = teams;

function spec(n: number, type: OffType, yards: number, win: boolean, more: Partial<PlaySpec> = {}): PlaySpec {
  const run = type === 'inside' || type === 'outside';
  const carrier = run ? O.lineup.off.RB : O.lineup.off.WR1;
  const defender = run ? D.lineup.def.LB : D.lineup.def.CB1;
  return {
    n, off: 0, type, call: 'zone', outcome: yards > 0 ? 'gain' : 'loss', yards, td: false, los: 30, toGo: 10, down: 1,
    carrier, defender, offStar: null, defStar: null, duel: { ace: carrier, foe: defender, win }, ...more,
  };
}

describe('the day\'s duel in the picture', () => {
  it('has its moment in every kind of play, with every path in order', () => {
    const plays: PlaySpec[] = [];
    for (let n = 0; n < 6; n += 1) {
      for (const type of ['inside', 'outside', 'short', 'long'] as const) {
        plays.push(spec(n, type, 2 + n * 4, true), spec(n, type, -1, false), spec(n, type, 4, false));
        plays.push(spec(n, type, 70, true, { td: true }));
      }
      plays.push(spec(n, 'short', 0, false, { outcome: 'incomplete' }), spec(n, 'long', -6, false, { outcome: 'sack' }));
    }
    for (const sp of plays) {
      const sc = buildScript(teams, sp, () => null, false);
      const what = `${sp.type} ${sp.yards} ${sp.outcome} win=${sp.duel!.win} n=${sp.n}`;
      // (a touchdown run nobody could stop has no moment of its own)
      if (!(sp.td && sc.tDuel < 0)) {
        expect(sc.tDuel, what).toBeGreaterThan(sc.snap);
        expect(sc.tDuel, what).toBeLessThanOrEqual(sc.dur);
      }
      for (const p of sc.plans) for (let i = 1; i < p.keys.length; i += 1) expect(p.keys[i]!.t, what).toBeGreaterThan(p.keys[i - 1]!.t);
      // nobody flies: the defender the ace has stepped around, sampled along his whole path
      if (!sc.cues.some((c) => c.c === 'juke')) continue;
      const foe = sc.plans.find((p) => p.team === 1 && p.id === sp.defender)!;
      const a = { x: 0, z: 0 };
      const b = { x: 0, z: 0 };
      for (let t = sc.snap; t < sc.tEnd; t += 0.05) {
        evalKeys(foe.keys, t, a);
        evalKeys(foe.keys, t + 0.05, b);
        expect(Math.hypot(b.x - a.x, b.z - a.z) / 0.05, `${what} t=${t.toFixed(2)}`).toBeLessThan(24);
      }
    }
  });

  it('lets the ace step around the defender on a run he wins', () => {
    const sc = buildScript(teams, spec(1, 'outside', 14, true), () => null, false);
    expect(sc.cues.some((c) => c.c === 'juke')).toBe(true);
    expect(sc.tDuel).toBeLessThan(sc.tEnd);
    // and no such step when the defender wins: the moment is the hit
    const lost = buildScript(teams, spec(1, 'outside', 1, false), () => null, false);
    expect(lost.cues.some((c) => c.c === 'juke')).toBe(false);
    expect(lost.tDuel).toBeCloseTo(lost.tEnd, 5);
  });
});
