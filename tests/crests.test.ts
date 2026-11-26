// Every school (and the club) has a crest, and its art is in the catalog the asset sync writes.
import { describe, expect, it } from 'vitest';
import catalog from '../src/generated/catalog.json';
import { SCHOOLS } from '../src/game/teams';
import { TEAM_CREST } from '../src/game/season';

const crests = ((catalog as { crests?: unknown }).crests ?? {}) as Record<string, { img: string }>;
const trophies = (catalog as { trophies?: { cup: string[]; summit: string } }).trophies;

describe('the crests and the trophies', () => {
  it('give each school and the club its own crest, with its art', () => {
    const ids = [TEAM_CREST, ...SCHOOLS.map((t) => t.crest)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !crests[String(id)]?.img)).toEqual([]);
  });

  it('have the gold, silver and bronze cups and the summit trophy', () => {
    expect(trophies?.cup).toHaveLength(3);
    expect(trophies?.summit).toBeTruthy();
  });
});
