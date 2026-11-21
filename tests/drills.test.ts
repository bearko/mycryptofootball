import { describe, expect, it } from 'vitest';
import { buildDrill, isLine, stationsFor, type DrillActor, type DrillKind, type Post } from '../src/ui/stadium/ground';

const KINDS: DrillKind[] = ['dash', 'pass', 'catch', 'hit', 'tackle', 'study', 'game', 'solo', 'special'];
const IDS = [11, 12, 13, 14, 15, 16, 17];
/** a usual line-up: six heroes play both ways, the seventh sits */
const USUAL: Record<number, Post> = {
  11: { off: 'QB', def: 'S' }, 12: { off: 'RB', def: 'LB' }, 13: { off: 'WR', def: 'CB' }, 14: { off: 'WR', def: 'CB' },
  15: { off: 'OL', def: 'DL' }, 16: { off: 'OL', def: 'DL' }, 17: { off: null, def: null },
};
/** an odd one: the linemen swap with the backs on defense, and one hero only plays defense */
const ODD: Record<number, Post> = {
  11: { off: 'QB', def: 'DL' }, 12: { off: 'RB', def: 'DL' }, 13: { off: 'WR', def: 'CB' }, 14: { off: 'WR', def: null },
  15: { off: 'OL', def: 'LB' }, 16: { off: 'OL', def: 'S' }, 17: { off: null, def: 'CB' },
};

const actorsFor = (posts?: Record<number, Post>): DrillActor[] => {
  const st = stationsFor(IDS, posts);
  return IDS.map((id, i) => ({ id, x: st[i]!.x, z: st[i]!.z, off: posts?.[id]?.off ?? null, def: posts?.[id]?.def ?? null }));
};

describe('the practice ground', () => {
  it('splits the club into position groups: linemen at the sled, the quarterback throwing to the receivers', () => {
    const st = stationsFor(IDS, USUAL);
    const job = (id: number): string => st[IDS.indexOf(id)]!.job;
    expect(job(15)).toBe('sled');
    expect(job(16)).toBe('sled');
    expect(job(11)).toBe('tossA');
    expect(job(13)).toBe('tossB');
    expect(job(14)).toBe('tossB');
    expect(job(12)).toBe('shuttle');
    // the two linemen stand side by side, away from the passing group
    const [a, b, qb] = [st[4]!, st[5]!, st[0]!];
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.1);
    expect(Math.abs(a.z - b.z)).toBeLessThan(2);
    expect(Math.hypot(a.x - qb.x, a.z - qb.z)).toBeGreaterThan(8);
    // nobody shares a spot
    const spots = new Set(st.map((s) => `${s.x},${s.z}`));
    expect(spots.size).toBe(IDS.length);
  });

  it('goes by the position on offense, and by the one on defense only for a hero who plays no offense', () => {
    expect(isLine({ off: 'OL', def: 'S' })).toBe(true);
    expect(isLine({ off: 'QB', def: 'DL' })).toBe(false);
    expect(isLine({ off: null, def: 'DL' })).toBe(true);
    expect(isLine({ off: null, def: null })).toBe(false);
  });

  it('every drill is a complete script for every line-up: finite paths on the ground, and something for everyone', () => {
    for (const posts of [undefined, USUAL, ODD]) {
      for (const kind of KINDS) {
        const actors = actorsFor(posts);
        const who = kind === 'solo' ? actors.filter((a) => a.id === 13) : actors;
        const plan = buildDrill(kind, who, 13, 'cat');
        expect(plan.end).toBeGreaterThan(1);
        expect(plan.dur).toBeGreaterThanOrEqual(plan.end);
        for (const a of who) {
          const keys = plan.keys.get(a.id)!;
          expect(keys.length).toBeGreaterThan(0);
          let last = -1;
          for (const k of keys) {
            expect(Number.isFinite(k.x) && Number.isFinite(k.z) && Number.isFinite(k.t)).toBe(true);
            expect(k.t).toBeGreaterThanOrEqual(last);
            last = k.t;
            expect(k.x).toBeGreaterThan(-4);
            expect(k.x).toBeLessThan(54);
          }
          // each hero visibly gets something out of the drill
          expect(plan.cues.some((c) => c.c === 'payoff' && c.who === a.id), `${kind}: no payoff for ${a.id}`).toBe(true);
        }
        for (const b of plan.balls) expect([...b.from, ...b.to].every(Number.isFinite)).toBe(true);
        expect(plan.cues[plan.cues.length - 1]!.t).toBeLessThanOrEqual(plan.dur + 0.5);
      }
    }
  });

  it('in passing practice the quarterback throws to the others while the linemen work on protection', () => {
    const plan = buildDrill('pass', actorsFor(USUAL), undefined, 'pas');
    const throwers = new Set(plan.cues.filter((c) => c.c === 'throw').map((c) => (c as { who: number }).who));
    expect([...throwers]).toEqual([11]);
    const caught = new Set(plan.cues.filter((c) => c.c === 'catch').map((c) => (c as { who: number }).who));
    expect(caught.has(15) || caught.has(16)).toBe(false);
    // the two linemen meet each other
    expect(plan.cues.some((c) => c.c === 'impact' && c.a === 15 && c.b === 16)).toBe(true);
  });

  it('the linemen take the sled in hitting practice', () => {
    const plan = buildDrill('hit', actorsFor(USUAL), undefined, 'blk');
    expect(plan.focus.sort()).toEqual([15, 16]);
    expect(plan.cues.some((c) => c.c === 'sled')).toBe(true);
  });
});
