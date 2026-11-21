// Who plays where: an offense and a defense (six a side, or eleven), chosen separately.
// In a small club the same heroes play both ways; a bigger one can field two different units.

import { DEF_POS_OF, OFF_POS_OF, defPos, fit, kickFit, offPos, roleOf, sizeOf, type DefPos, type Lineup, type OffPos, type Player, type Size } from './model';

/**
 * The best way to fill the given positions from these players: every position a different hero, the highest total fit.
 * (The assignment problem, solved exactly with the Hungarian method: eleven positions from two dozen heroes is far
 * too many line-ups to try one by one.) Among positions of the same kind, the lower number gets the better hero.
 */
function bestUnit<P extends OffPos | DefPos>(players: Player[], positions: readonly P[]): { score: number; map: Record<P, number> } {
  const n = positions.length;
  const m = players.length;
  const val = positions.map((pos) => players.map((p) => fit(p.stats, roleOf(pos))));
  // rows are positions (1..n), columns are players (1..m); cost = -fit
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const match = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    match[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = match[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = -val[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[match[j]!]! += delta;
          v[j]! -= delta;
        } else minv[j]! -= delta;
      }
      j0 = j1;
    } while (match[j0] !== 0);
    do {
      const j1 = way[j0]!;
      match[j0] = match[j1]!;
      j0 = j1;
    } while (j0);
  }
  const pick = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j += 1) if (match[j]) pick[match[j]! - 1] = j - 1;
  // positions of one kind are the same job: hand them out in order of ability, so the answer does not depend on chance
  const kinds = new Map<string, number[]>();
  positions.forEach((pos, k) => {
    const r = roleOf(pos);
    kinds.set(r, [...(kinds.get(r) ?? []), k]);
  });
  for (const ks of kinds.values()) {
    const who = ks.map((k) => pick[k]!).sort((a, b) => val[ks[0]!]![b]! - val[ks[0]!]![a]! || a - b);
    ks.forEach((k, i) => {
      pick[k] = who[i]!;
    });
  }
  const map = {} as Record<P, number>;
  let score = 0;
  positions.forEach((pos, k) => {
    map[pos] = players[pick[k]!]!.id;
    score += val[k]![pick[k]!]!;
  });
  return { score, map };
}

/** The strongest offense and the strongest defense this club can field (a hero may play in both). */
export function bestLineup(players: Player[], size: Size = 6): Lineup {
  if (players.length < size) throw new Error(`a team needs ${size} players`);
  const lineup: Lineup = { off: bestUnit(players, OFF_POS_OF[size]).map, def: bestUnit(players, DEF_POS_OF[size]).map };
  return { ...lineup, k: bestKicker(players, lineup) };
}

/**
 * The club's best kicker. Between equals the hero who does not start gets the job
 * (somebody who would otherwise only watch).
 */
export function bestKicker(players: Player[], l: Lineup): number | null {
  if (!players.length) return null;
  const on = new Set(fielded(l));
  return [...players].sort((a, b) => kickFit(b.stats) - kickFit(a.stats) || Number(on.has(a.id)) - Number(on.has(b.id)))[0]!.id;
}

/** The kicker of a line-up, if that hero is (still) in the club. */
export const kickerOf = (l: Lineup, roster: number[]): number | null => (l.k != null && roster.includes(l.k) ? l.k : null);

/** Everybody who takes the field: the offense and the defense (a hero who plays both ways is listed once). */
export const fielded = (l: Lineup): number[] => [...new Set([...offPos(l).map((p) => l.off?.[p]), ...defPos(l).map((p) => l.def?.[p])])].filter((id): id is number => id != null);
/** @deprecated the old name of fielded() */
export const starters = fielded;
export const isStarter = (l: Lineup, id: number): boolean => fielded(l).includes(id);
/** The units a hero plays in. */
export const unitsOf = (l: Lineup, id: number): ('off' | 'def')[] => [
  ...(offPos(l).some((p) => l.off[p] === id) ? ['off' as const] : []),
  ...(defPos(l).some((p) => l.def[p] === id) ? ['def' as const] : []),
];

/**
 * Puts a hero at a position of one unit and returns the new line-up. The two units are separate:
 *  - a hero already in that unit swaps places with whoever is there
 *  - anybody else takes the spot, and the hero who had it leaves that unit (and only that unit)
 */
export function place(l: Lineup, unit: 'off' | 'def', pos: OffPos | DefPos, id: number): Lineup {
  const off = { ...l.off };
  const def = { ...l.def };
  const map: Record<string, number> = unit === 'off' ? off : def;
  const out = map[pos]!;
  if (out === id) return l;
  const from = Object.keys(map).find((k) => map[k] === id);
  if (from) map[from] = out;
  map[pos] = id;
  return { off, def, k: l.k ?? null };
}

/** True when each unit is complete (six or eleven different heroes of this roster, the same number on both). */
export function validLineup(l: Lineup, roster: number[], size: Size = sizeOf(l)): boolean {
  if (sizeOf(l) !== size) return false;
  const o = OFF_POS_OF[size].map((p) => l.off[p]);
  const d = DEF_POS_OF[size].map((p) => l.def[p]);
  if (new Set(o).size !== size || new Set(d).size !== size) return false;
  if (Object.keys(l.off).length !== size || Object.keys(l.def).length !== size) return false;
  return [...o, ...d].every((id) => id != null && roster.includes(id));
}
