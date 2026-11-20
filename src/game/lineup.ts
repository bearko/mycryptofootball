// Who plays where. The same six heroes play both offense and defense.

import { DEF_POS, OFF_POS, fit, roleOf, type DefPos, type Lineup, type OffPos, type Player } from './model';

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((it, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([it, ...p]);
  });
  return out;
}

function bestUnit<P extends OffPos | DefPos>(six: Player[], positions: readonly P[]): { score: number; map: Record<P, number> } {
  let best = { score: -1, map: {} as Record<P, number> };
  for (const perm of permutations(six)) {
    let score = 0;
    perm.forEach((p, i) => {
      score += fit(p.stats, roleOf(positions[i]!));
    });
    if (score > best.score) {
      const map = {} as Record<P, number>;
      perm.forEach((p, i) => {
        map[positions[i]!] = p.id;
      });
      best = { score, map };
    }
  }
  return best;
}

/** The six starters and their positions with the highest total fit. */
export function bestLineup(players: Player[]): Lineup {
  if (players.length < 6) throw new Error('a team needs six players');
  let best: { score: number; lineup: Lineup } | null = null;
  const choose = (start: number, picked: Player[]): void => {
    if (picked.length === 6) {
      const off = bestUnit(picked, OFF_POS);
      const def = bestUnit(picked, DEF_POS);
      const score = off.score + def.score;
      if (!best || score > best.score) best = { score, lineup: { off: off.map, def: def.map } };
      return;
    }
    for (let i = start; i < players.length; i += 1) choose(i + 1, [...picked, players[i]!]);
  };
  choose(0, []);
  return best!.lineup;
}

export const starters = (l: Lineup): number[] => OFF_POS.map((p) => l.off[p]);
export const isStarter = (l: Lineup, id: number): boolean => starters(l).includes(id);

/**
 * Puts a hero at a position and returns the new line-up.
 *  - a starter: swaps places with whoever is there (within that unit)
 *  - a hero from the bench: takes over both of the replaced hero's positions
 */
export function place(l: Lineup, unit: 'off' | 'def', pos: OffPos | DefPos, id: number): Lineup {
  const off = { ...l.off };
  const def = { ...l.def };
  const map: Record<string, number> = unit === 'off' ? off : def;
  const out = map[pos]!;
  if (out === id) return l;
  if (isStarter(l, id)) {
    const from = Object.keys(map).find((k) => map[k] === id)!;
    map[from] = out;
    map[pos] = id;
  } else {
    for (const m of [off, def] as Record<string, number>[]) {
      for (const k of Object.keys(m)) if (m[k] === out) m[k] = id;
    }
  }
  return { off, def };
}

/** True when the line-up is six different heroes of this roster, the same six on both units. */
export function validLineup(l: Lineup, roster: number[]): boolean {
  const o = OFF_POS.map((p) => l.off[p]);
  const d = DEF_POS.map((p) => l.def[p]);
  if (new Set(o).size !== 6 || new Set(d).size !== 6) return false;
  return o.every((id) => roster.includes(id) && d.includes(id));
}
