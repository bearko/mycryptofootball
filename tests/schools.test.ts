import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { KIND } from '../src/game/cards';
import { RECRUITS, hero } from '../src/game/heroes';
import { roleOf } from '../src/game/model';
import { TIERS } from '../src/game/prestige';
import { MATCH_COUNT, mend, nextYear, schoolAt, schoolId } from '../src/game/season';
import { BRACKET_SCHOOLS } from '../src/game/bracket';
import { CUP_SCHOOLS, FIRST_DRAW, ROUNDS, SCHOOLS, aces, complete, cupIndex, drawSchools, opponentSheet } from '../src/game/teams';
import { runCareer, runSeason } from './bot';

describe('the schools', () => {
  it('each has its own heroes (nobody plays for two schools, nobody is a hero the club can sign)', () => {
    const seen = new Map<number, string>();
    for (const t of SCHOOLS) {
      for (const p of [...t.players, ...t.more]) {
        expect(() => hero(p.id)).not.toThrow();
        expect(seen.has(p.id), `${hero(p.id).name}: ${seen.get(p.id)} and ${t.name}`).toBe(false);
        seen.set(p.id, t.name);
        expect(RECRUITS.some((r) => r.id === p.id)).toBe(false);
      }
    }
    expect(new Set(SCHOOLS.map((t) => t.name)).size).toBe(SCHOOLS.length);
    expect(new Set(SCHOOLS.map((t) => t.short)).size).toBe(SCHOOLS.length);
  });

  it('each has six for the district game; the ones met in bigger tournaments have eleven', () => {
    SCHOOLS.forEach((t, i) => {
      expect(t.players.length).toBe(6);
      const big = CUP_SCHOOLS.some((pool, cup) => cup > 0 && pool.includes(i));
      if (big) expect(complete(t), t.name).toBe(true);
      else expect([0, 5]).toContain(t.more.length);
      expect(CUP_SCHOOLS.some((pool) => pool.includes(i)), `${t.name} plays nowhere`).toBe(true);
    });
  });

  it('the aces stand where their special plays can be called, and the first of them play six a side', () => {
    for (const t of SCHOOLS) {
      expect(t.aces.length).toBeGreaterThanOrEqual(5);
      expect(new Set(t.aces).size).toBe(t.aces.length);
      for (const id of t.aces) {
        const p = t.players.find((x) => x.id === id);
        expect(p, `${t.name}: ace ${id} does not play six a side`).toBeDefined();
        const info = KIND[p!.ace!];
        const role = roleOf(info.side === 'off' ? p!.off : p!.def);
        expect(!info.roles || info.roles.includes(role), `${t.name}: ${hero(id).name} cannot call ${p!.ace} as ${role}`).toBe(true);
        // a school never looks at the coach's card first
        expect(p!.ace!.startsWith('peek')).toBe(false);
      }
    }
  });

  it('a school is as strong as the round it is met in, and has more aces ready in later rounds', () => {
    SCHOOLS.forEach((_, i) => {
      let last = -1;
      for (let round = 0; round < 4; round += 1) {
        const sheet = opponentSheet(round, 0, 6, i);
        const sum = sheet.players.reduce((v, p) => v + Object.values(p.stats).reduce((a, b) => a + b, 0), 0);
        expect(sum).toBeGreaterThan(last);
        last = sum;
        expect(sheet.specials.length).toBe(Math.min(ROUNDS[round]!.aces, 5));
        expect(aces(i, round, 6).length).toBe(sheet.specials.length);
        for (const sp of sheet.specials) expect(sheet.players.some((p) => p.id === sp.owner)).toBe(true);
      }
    });
    // a school that reads well reads better than the others in the same round
    const brainy = SCHOOLS.findIndex((t) => (t.smart ?? 0) > 0);
    expect(opponentSheet(1, 0, 6, brainy).smart).toBeGreaterThan(opponentSheet(1, 0, 6, 0).smart);
  });

  it('every tournament has its own schools, and the year\'s four are met weakest first', () => {
    expect(CUP_SCHOOLS.length).toBe(4);
    expect(TIERS.map((_, tier) => cupIndex(tier))).toEqual([0, 0, 1, 1, 2, 3, 3]);
    CUP_SCHOOLS.forEach((pool, cup) => {
      expect(pool.length).toBeGreaterThanOrEqual(5);
      expect(new Set(pool).size).toBe(pool.length);
      const league = TIERS.findIndex((_, tier) => cupIndex(tier) === cup);
      const met = new Set<number>();
      const finals = new Set<number>();
      const draws = new Set<string>();
      for (let seed = 1; seed <= 200; seed += 1) {
        const d = drawSchools(league, new Rng(seed));
        expect(d.length).toBe(4);
        expect(new Set(d).size).toBe(4);
        for (const id of d) expect(pool).toContain(id);
        expect(d.map((id) => pool.indexOf(id))).toEqual([...d.map((id) => pool.indexOf(id))].sort((a, b) => a - b));
        d.forEach((id) => met.add(id));
        finals.add(d[3]!);
        draws.add(d.join());
      }
      expect(met.size).toBe(pool.length);
      // the final is not always the same school, and never one of the weakest
      expect(finals.size).toBeGreaterThanOrEqual(2);
      expect(finals.has(pool[0]!)).toBe(false);
      expect(draws.size).toBeGreaterThanOrEqual(5);
    });
    // a strong school of one tournament is met again in the next
    expect(CUP_SCHOOLS[1]!.filter((id) => CUP_SCHOOLS[0]!.includes(id)).length).toBeGreaterThanOrEqual(2);
  });

  it('a club\'s first practice match is always the same; the tournaments\' schools come from their brackets; from the second year the draw changes', () => {
    const { season: s } = runSeason(3 * 31);
    expect(s.draw[0]).toBe(FIRST_DRAW[0]);
    expect(s.draw.length).toBe(MATCH_COUNT);
    // every school the club met in a tournament stood in that tournament's bracket
    for (const r of s.results.filter((x) => x.opp > 0)) {
      const b = r.m < 4 ? s.cups!.spring! : s.cups!.autumn!;
      expect(b.field).toContain(s.draw[r.m]);
    }
    // the autumn's schools are of the tournament the club reached by then
    for (const id of s.draw.slice(5)) expect(CUP_SCHOOLS[cupIndex(s.league)]).toContain(id);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const { season: t } = runSeason(3 * 31);
      t.tier = 2;
      nextYear(t, seed);
      expect(t.draw.length).toBe(MATCH_COUNT);
      for (const id of t.draw) expect([...CUP_SCHOOLS[1]!, ...BRACKET_SCHOOLS[1]!]).toContain(id);
      // the spring's four in order of strength, the June practice match one of the others when there is one
      expect([t.draw[0], t.draw[2], t.draw[3]].includes(t.draw[4]!)).toBe(false);
      expect(schoolId(t, 0)).toBe(t.draw[0]);
      seen.add(t.draw.join());
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('a season saved before the draw existed keeps its schools', () => {
    const { season: s } = runSeason(5 * 31);
    delete (s as unknown as Record<string, unknown>).draw;
    mend(s);
    expect(s.draw.slice(0, 4)).toEqual([...FIRST_DRAW]);
    expect(s.draw.length).toBe(MATCH_COUNT);
    const { season: t } = runSeason(5 * 31);
    t.league = 4;
    delete (t as unknown as Record<string, unknown>).draw;
    mend(t);
    for (const id of t.draw) expect(CUP_SCHOOLS[2]).toContain(id);
  });

  it('over the years a club meets many schools', () => {
    const met = new Set<number>();
    // whole careers run through every tournament's draws without a hitch
    for (let i = 1; i <= 6; i += 1) expect(runCareer(i * 7919, 10).log.length).toBe(10);
    const { season: s } = runCareer(7919, 1);
    for (let y = 0; y < 10; y += 1) {
      s.draw.forEach((id) => met.add(id));
      s.phase = 'done';
      s.tier = Math.min(6, s.tier + 1);
      nextYear(s, 100 + y);
      if ((s.phase as string) === 'recruit') s.phase = 'club';
    }
    expect(met.size).toBeGreaterThanOrEqual(10);
  }, 120000);
});
