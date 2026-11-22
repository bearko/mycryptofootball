import { describe, expect, it } from 'vitest';
import { isKick, isRun } from '../src/game/cards';
import { bestLineup, fielded, validLineup } from '../src/game/lineup';
import {
  FIELD, PLAYS_PER_Q, PLAYS_PER_Q_11, autoPeek, autoPick, createMatch, group, isEleven, playsPerQ, resolvePlay, showtime, simulate, unitSummary,
  type PlayResult, type TeamSheet,
} from '../src/game/match';
import { DEF_POS_OF, OFF_POS_OF, defPos, offPos, roleOf, sizeOf } from '../src/game/model';
import { TIERS } from '../src/game/prestige';
import { asPlayer, clubSheet, clubSize, mend, nextYear, signRecruits, type Season } from '../src/game/season';
import { SCHOOLS, opponentSheet } from '../src/game/teams';
import { WIDTH } from '../src/ui/stadium/assets';
import { buildScript, evalKeys, formation, lineUp, specOf } from '../src/ui/stadium/choreo';
import { buildDrill, stationsFor, type DrillActor, type DrillKind, type Post } from '../src/ui/stadium/ground';
import { runSeason } from './bot';

/** a club that begins a year at the given standing, its briefing held */
function clubAt(tier: number, seed = 9): Season {
  const { season: s } = runSeason(seed * 31);
  s.tier = tier;
  s.fame = 40;
  nextYear(s, seed);
  if (s.phase === 'recruit') signRecruits(s, s.candidates.slice(0, TIERS[tier]!.roster - s.members.length));
  return s;
}

describe('eleven a side', () => {
  it('the eleven positions are the six and five more on each unit', () => {
    expect(OFF_POS_OF[11].length).toBe(11);
    expect(DEF_POS_OF[11].length).toBe(11);
    for (const p of OFF_POS_OF[6]) expect(OFF_POS_OF[11]).toContain(p);
    for (const p of DEF_POS_OF[6]) expect(DEF_POS_OF[11]).toContain(p);
    const count = (list: readonly string[], role: string): number => list.filter((p) => roleOf(p as never) === role).length;
    expect(['QB', 'RB', 'WR', 'TE', 'OL'].map((r) => count(OFF_POS_OF[11], r))).toEqual([1, 1, 3, 1, 5]);
    expect(['DL', 'LB', 'CB', 'S'].map((r) => count(DEF_POS_OF[11], r))).toEqual([4, 3, 2, 2]);
  });

  it('the district plays six a side, the prefecture and above eleven', () => {
    expect(TIERS.map((t) => t.size)).toEqual([6, 6, 11, 11, 11, 11, 11]);
    expect(clubSize(clubAt(1))).toBe(6);
    const s = clubAt(2);
    expect(s.members.length).toBe(11);
    expect(clubSize(s)).toBe(11);
    expect(sizeOf(s.lineup!)).toBe(11);
    expect(validLineup(s.lineup!, s.members.map((m) => m.id), 11)).toBe(true);
    // eleven heroes, eleven a side: everybody plays both ways
    expect(fielded(s.lineup!).length).toBe(11);
    const sheet = clubSheet(s);
    const sum = unitSummary(sheet);
    for (const v of Object.values(sum)) expect(Number.isFinite(v) && v > 0).toBe(true);
    expect(group(sheet, 'OL').length).toBe(5);
    expect(group(sheet, 'WR', 'TE').length).toBe(4);
  });

  it('a club of twenty-two fields two different units', () => {
    const s = clubAt(4);
    expect(s.members.length).toBe(22);
    expect(clubSize(s)).toBe(11);
    expect(fielded(s.lineup!).length).toBeGreaterThanOrEqual(14);
    const t0 = Date.now();
    const l = bestLineup(s.members.map(asPlayer), 11);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(l.off).toEqual(s.lineup!.off);
  });

  it('a club that falls back to the district plays six again, and one that is too small for eleven plays six', () => {
    const s = clubAt(2);
    s.phase = 'done';
    s.tier = 1;
    nextYear(s, 4);
    expect(s.phase).toBe('club');
    expect(clubSize(s)).toBe(6);
    expect(sizeOf(s.lineup!)).toBe(6);
    expect(validLineup(s.lineup!, s.members.map((m) => m.id), 6)).toBe(true);
    const small = clubAt(1);
    small.league = 2;
    expect(clubSize(small)).toBe(6);
  });

  it('a season saved with a line-up of six in the prefecture gets its eleven', () => {
    const s = clubAt(2);
    s.lineup = bestLineup(s.members.map(asPlayer), 6);
    mend(s);
    expect(sizeOf(s.lineup!)).toBe(11);
    expect(() => clubSheet(s)).not.toThrow();
  });

  it('every school has eleven for the bigger game, each at one position on either unit', () => {
    SCHOOLS.forEach((team, i) => {
      if (!team.more.length) return; // a school that only plays in the district
      const t = opponentSheet(i % 4, 2, 11, i);
      expect(t.players.length).toBe(11);
      expect(validLineup(t.lineup, t.players.map((p) => p.id), 11)).toBe(true);
      expect(new Set(t.players.map((p) => p.id)).size).toBe(11);
      // six a side they are who they always were
      expect(opponentSheet(i % 4, 0, 6, i).players.map((p) => p.id)).toEqual(t.players.slice(0, 6).map((p) => p.id));
    });
  });

  const HOME = clubSheet(Object.assign(clubAt(2), { day: 13 }));
  function plays(): { res: PlayResult; teams: [TeamSheet, TeamSheet] }[] {
    const out: { res: PlayResult; teams: [TeamSheet, TeamSheet] }[] = [];
    for (let seed = 1; seed <= 6; seed += 1) {
      const st = createMatch(HOME, opponentSheet(seed % 4, 2), seed);
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

  it('is the same game for the same seed, and has points in it', () => {
    const a = simulate(HOME, opponentSheet(1, 2), 77);
    const b = simulate(HOME, opponentSheet(1, 2), 77);
    expect(a.score).toEqual(b.score);
    let points = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const st = simulate(HOME, opponentSheet(seed % 4, 2), seed);
      points += st.score[0] + st.score[1];
    }
    expect(points / 20).toBeGreaterThan(10);
  });

  it('plays ten plays a quarter and scores about twice as much as six a side, from more ways than one', () => {
    const six = createMatch(opponentSheet(0), opponentSheet(1), 3);
    expect(playsPerQ(six)).toBe(PLAYS_PER_Q);
    expect(six.left).toBe(PLAYS_PER_Q);
    const eleven = createMatch(opponentSheet(0, 2), opponentSheet(3, 2), 3);
    expect(isEleven(eleven)).toBe(true);
    expect(playsPerQ(eleven)).toBe(PLAYS_PER_Q_11);
    expect(eleven.left).toBe(PLAYS_PER_Q_11);
    const totals = (league: number): { points: number; plays: number; returns: number; breaks: number; show: number } => {
      const out = { points: 0, plays: 0, returns: 0, breaks: 0, show: 0 };
      for (let seed = 1; seed <= 120; seed += 1) {
        const st = createMatch(opponentSheet(seed % 4, league), opponentSheet((seed + 1) % 4, league), seed);
        while (!st.over) {
          if (!st.ko && !st.tfp && showtime(st)) out.show += 1;
          const d = autoPick(st, (1 - st.poss) as 0 | 1);
          const res = resolvePlay(st, autoPick(st, st.poss, d), d);
          if (!res.kick && !res.tfp) out.plays += 1;
          if (res.returnTd) {
            out.returns += 1;
            // the other side scored: it tries for more next
            expect(st.poss).toBe(1 - res.off);
            expect(st.tfp || st.over).toBe(true);
          }
          if (res.breakaway) out.breaks += 1;
        }
        out.points += st.score[0] + st.score[1];
      }
      return out;
    };
    const a = totals(0);
    const b = totals(2);
    // six a side: none of the new ways to score
    expect(a.returns + a.breaks).toBe(0);
    expect(b.points / 120).toBeGreaterThan(35);
    expect(b.points / 120).toBeLessThan(65);
    expect(b.points).toBeGreaterThan(a.points * 1.6);
    expect(b.returns).toBeGreaterThan(5);
    expect(b.breaks / 120).toBeGreaterThan(1);
    // the coach who calls only the big moments calls about two in five of them
    expect(b.show / b.plays).toBeGreaterThan(0.25);
    expect(b.show / b.plays).toBeLessThan(0.5);
  });

  it('a kickoff run back and a ball taken away and run back are pictured all the way into the end zone', () => {
    const teams: [TeamSheet, TeamSheet] = [HOME, opponentSheet(0, 2)];
    let seen = 0;
    for (let seed = 1; seed <= 300 && seen < 6; seed += 1) {
      const st = createMatch(...teams, seed);
      while (!st.over) {
        const d = autoPick(st, (1 - st.poss) as 0 | 1);
        const res = resolvePlay(st, autoPick(st, st.poss, d), d);
        if (!res.returnTd) continue;
        seen += 1;
        const sc = buildScript(teams, specOf(res), () => null, false);
        expect(sc.tTD).toBeGreaterThan(0);
        expect(sc.cues.some((c) => c.c === 'td')).toBe(true);
        // the one who ran it back ends up behind the goal line he ran at
        const scorer = (1 - res.off) as 0 | 1;
        const who = res.kick ? res.kick.returner! : res.defender;
        const plan = sc.plans.find((p) => p.team === scorer && p.id === who)!;
        const tmp = { x: 0, z: 0 };
        evalKeys(plan.keys, sc.dur, tmp);
        const goal = scorer === 0 ? FIELD : 0;
        expect(scorer === 0 ? tmp.x > goal : tmp.x < goal, `${res.kick?.type ?? res.turnover} ${tmp.x}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it('twenty-two heroes line up, nobody on top of anybody, whatever the defense calls', () => {
    for (const call of [undefined, 'stuff', 'contain', 'zone', 'deep', 'blitz'] as const) {
      for (const los of [3, 25, 48]) {
        const spots = lineUp([HOME, opponentSheet(0, 2)], 0, los, call);
        expect(spots.length).toBe(22);
        for (let i = 0; i < spots.length; i += 1) {
          expect(spots[i]!.z).toBeGreaterThan(0.5);
          expect(spots[i]!.z).toBeLessThan(WIDTH - 0.5);
          for (let j = i + 1; j < spots.length; j += 1) {
            expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z), `${call} ${spots[i]!.pos} ${spots[j]!.pos}`).toBeGreaterThan(1.1);
          }
        }
        const f = formation(los, call, 11);
        // seven on the line of scrimmage or right behind it, like the rules want
        expect(OFF_POS_OF[11].filter((p) => f.off[p][0] >= los - 2).length).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('every play is a complete script for all twenty-two', () => {
    const all = plays();
    const tmp = { x: 0, z: 0 };
    let passes = 0;
    let toTE = 0;
    for (const { res, teams } of all) {
      const spec = specOf(res);
      const sc = buildScript(teams, spec, () => null, false);
      expect(sc.plans.length).toBe(22);
      expect(new Set(sc.plans.map((p) => `${p.team}:${p.id}`)).size).toBe(22);
      for (const p of sc.plans) {
        let last = -1;
        for (const k of p.keys) {
          expect(Number.isFinite(k.x) && Number.isFinite(k.z) && Number.isFinite(k.t)).toBe(true);
          expect(k.t).toBeGreaterThanOrEqual(last);
          last = k.t;
          expect(k.z).toBeGreaterThanOrEqual(-0.8);
          expect(k.z).toBeLessThanOrEqual(WIDTH + 0.8);
        }
        evalKeys(p.keys, sc.dur, tmp);
        expect(Number.isFinite(tmp.x)).toBe(true);
      }
      const O = teams[spec.off];
      if (spec.kick || isRun(spec.type)) continue;
      passes += 1;
      // one receiver gets the ball, the other three go out as well
      expect(sc.design.map((d) => d.kind).sort()).toEqual(['decoy', 'decoy', 'decoy', 'route']);
      const targets = group(O, 'WR', 'TE').map((p) => O.lineup.off[p as keyof typeof O.lineup.off]);
      expect(sc.design.map((d) => d.id).sort()).toEqual([...targets].sort());
      if (spec.carrier === O.lineup.off.TE) toTE += 1;
      for (const d of sc.design) for (const [x] of d.way) expect(x >= -5 && x <= FIELD + 5).toBe(true);
    }
    expect(passes).toBeGreaterThan(30);
    // the tight end is thrown to now and then (short passes), not all the time
    expect(toTE).toBeGreaterThan(0);
    expect(toTE).toBeLessThan(passes * 0.6);
  });

  it('the practice ground has a place for each of twelve heroes, and every drill something for each of them', () => {
    const s = clubAt(3);
    const l = s.lineup!;
    const posts: Record<number, Post> = {};
    for (const m of s.members) {
      const off = offPos(l).find((p) => l.off[p] === m.id);
      const def = defPos(l).find((p) => l.def[p] === m.id);
      posts[m.id] = { off: off ? roleOf(off) : null, def: def ? roleOf(def) : null };
    }
    const ids = [...fielded(l), ...s.members.map((m) => m.id).filter((id) => !fielded(l).includes(id))].slice(0, 12);
    const st = stationsFor(ids, posts);
    expect(new Set(st.map((x) => `${x.x.toFixed(2)},${x.z.toFixed(2)}`)).size).toBe(ids.length);
    const te = l.off.TE;
    if (ids.includes(te)) expect(['tossA', 'tossB']).toContain(st[ids.indexOf(te)]!.job);
    const actors: DrillActor[] = ids.map((id, i) => ({ id, x: st[i]!.x, z: st[i]!.z, off: posts[id]!.off, def: posts[id]!.def }));
    for (const kind of ['dash', 'pass', 'catch', 'hit', 'tackle', 'study', 'game', 'special'] as DrillKind[]) {
      const plan = buildDrill(kind, actors, ids[0], 'cat');
      expect(plan.dur).toBeGreaterThanOrEqual(plan.end);
      for (const a of actors) {
        const keys = plan.keys.get(a.id)!;
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) expect(Number.isFinite(k.x) && Number.isFinite(k.z) && Number.isFinite(k.t)).toBe(true);
        expect(plan.cues.some((c) => c.c === 'payoff' && c.who === a.id), `${kind}: no payoff for ${a.id}`).toBe(true);
      }
    }
  });
});
