// Who plays where: an offense of six and a defense of six, chosen separately.
// In a small club the same heroes play both ways; a bigger one can field two different units.

import { DEF_POS, OFF_POS, fit, kickFit, roleOf, type DefPos, type Lineup, type OffPos, type Player } from './model';

/**
 * The best way to fill the given positions from these players: every position a different hero, the highest total fit.
 * (Branch and bound: the positions are filled in order, best candidate first, and a branch is dropped as soon as even
 * the best imaginable rest could not beat what has been found.)
 */
function bestUnit<P extends OffPos | DefPos>(players: Player[], positions: readonly P[]): { score: number; map: Record<P, number> } {
  const fits = positions.map((pos) => players.map((p, i) => ({ i, v: fit(p.stats, roleOf(pos)) })).sort((a, b) => b.v - a.v || a.i - b.i));
  const rest = positions.map((_, k) => fits.slice(k).reduce((v, f) => v + f[0]!.v, 0));
  let bestScore = -1;
  let bestPick: number[] = [];
  const used = new Set<number>();
  const pick: number[] = [];
  const go = (k: number, score: number): void => {
    if (k === positions.length) {
      if (score > bestScore + 1e-9) {
        bestScore = score;
        bestPick = [...pick];
      }
      return;
    }
    if (score + rest[k]! <= bestScore + 1e-9) return;
    for (const f of fits[k]!) {
      if (used.has(f.i)) continue;
      used.add(f.i);
      pick.push(f.i);
      go(k + 1, score + f.v);
      pick.pop();
      used.delete(f.i);
    }
  };
  go(0, 0);
  const map = {} as Record<P, number>;
  positions.forEach((pos, k) => {
    map[pos] = players[bestPick[k]!]!.id;
  });
  return { score: bestScore, map };
}

/** The strongest offense and the strongest defense this club can field (a hero may play in both). */
export function bestLineup(players: Player[]): Lineup {
  if (players.length < 6) throw new Error('a team needs six players');
  const lineup: Lineup = { off: bestUnit(players, OFF_POS).map, def: bestUnit(players, DEF_POS).map };
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
export const fielded = (l: Lineup): number[] => [...new Set([...OFF_POS.map((p) => l.off?.[p]), ...DEF_POS.map((p) => l.def?.[p])])].filter((id): id is number => id != null);
/** @deprecated the old name of fielded() */
export const starters = fielded;
export const isStarter = (l: Lineup, id: number): boolean => fielded(l).includes(id);
/** The units a hero plays in. */
export const unitsOf = (l: Lineup, id: number): ('off' | 'def')[] => [
  ...(OFF_POS.some((p) => l.off[p] === id) ? ['off' as const] : []),
  ...(DEF_POS.some((p) => l.def[p] === id) ? ['def' as const] : []),
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

/** True when each unit is six different heroes of this roster. */
export function validLineup(l: Lineup, roster: number[]): boolean {
  const o = OFF_POS.map((p) => l.off[p]);
  const d = DEF_POS.map((p) => l.def[p]);
  if (new Set(o).size !== 6 || new Set(d).size !== 6) return false;
  return [...o, ...d].every((id) => roster.includes(id));
}
