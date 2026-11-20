import { describe, expect, it } from 'vitest';
import { KIND, MATCH, OFF_TYPES, DEF_TYPES, READ_POTENCY } from '../src/game/cards';
import { RECRUITS, hero, specialOf, talentOf } from '../src/game/heroes';
import { bestLineup, isStarter, place, starters, validLineup } from '../src/game/lineup';
import {
  FIELD, MOM_MAX, PLAYS_PER_Q, QUARTERS, START, createMatch, potency, resolvePlay, simulate, specialBlock, specialPick,
  usePeek, usableSpecials, type MatchState, type Pick,
} from '../src/game/match';
import { DEF_POS, OFF_POS, STATS, fit, roleOf } from '../src/game/model';
import { OPPONENTS, opponentSheet } from '../src/game/teams';
import {
  CANDIDATES, EVENTS, ROSTER_SIZE, SCHEDULE, TRUST_LEARN, answerEvent, clubSheet, finishMatch, learned, newSeason, plan,
  signRecruits, train, type Season,
} from '../src/game/season';
import { runSeason } from './bot';

const club = (seed = 11): Season => {
  const s = newSeason(seed);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  return s;
};
const groups0 = { backs: 0, recv: 0, line: 0 };

describe('heroes', () => {
  it('each recruit is outstanding at exactly one thing', () => {
    expect(RECRUITS).toHaveLength(12);
    const count: Record<string, number> = {};
    for (const r of RECRUITS) {
      const { best } = talentOf(r.stats);
      count[best] = (count[best] ?? 0) + 1;
      const sorted = STATS.map((k) => r.stats[k]).sort((a, b) => b - a);
      expect(sorted[0]! - sorted[1]!).toBeGreaterThanOrEqual(14);
      expect(hero(r.id).passive.length).toBeGreaterThan(0);
    }
    expect(Object.values(count)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('every kind of special play belongs to one recruit', () => {
    expect(new Set(RECRUITS.map((r) => r.kind)).size).toBe(RECRUITS.length);
  });

  it('opponents field six heroes who are not recruits, with a full line-up', () => {
    OPPONENTS.forEach((t, i) => {
      const sheet = opponentSheet(i);
      expect(sheet.players).toHaveLength(6);
      expect(validLineup(sheet.lineup, sheet.players.map((p) => p.id))).toBe(true);
      for (const p of t.players) {
        expect(RECRUITS.some((r) => r.id === p.id)).toBe(false);
        if (p.ace) expect(p.ace.startsWith('peek')).toBe(false);
      }
    });
  });
});

describe('cards', () => {
  it('every play has exactly one call that shuts it down, and every call shuts something down', () => {
    for (const o of OFF_TYPES) expect(DEF_TYPES.filter((d) => MATCH[o][d] <= -1.4).length).toBeGreaterThanOrEqual(1);
    for (const d of DEF_TYPES) expect(OFF_TYPES.some((o) => MATCH[o][d] <= -0.6)).toBe(true);
    for (const d of DEF_TYPES) expect(OFF_TYPES.some((o) => MATCH[o][d] >= 0.8)).toBe(true);
  });
});

describe('line-up', () => {
  it('the best line-up puts each hero where the talent is', () => {
    const s = club();
    const l = s.lineup!;
    expect(validLineup(l, s.members.map((m) => m.id))).toBe(true);
    const qb = s.members.find((m) => m.id === l.off.QB)!;
    expect(fit(qb.stats, 'QB')).toBeGreaterThanOrEqual(Math.max(...s.members.map((m) => fit(m.stats, 'QB'))) - 25);
  });

  it('swapping starters keeps the same six; a substitute takes over both positions', () => {
    const s = club();
    const l = s.lineup!;
    const swapped = place(l, 'off', 'QB', l.off.RB);
    expect(swapped.off.QB).toBe(l.off.RB);
    expect(swapped.off.RB).toBe(l.off.QB);
    expect(swapped.def).toEqual(l.def);
    const bench = s.members.find((m) => !isStarter(l, m.id))!.id;
    const out = l.off.WR1;
    const subbed = place(l, 'off', 'WR1', bench);
    expect(starters(subbed)).toContain(bench);
    expect(starters(subbed)).not.toContain(out);
    expect(DEF_POS.map((p) => subbed.def[p])).toContain(bench);
    expect(validLineup(subbed, s.members.map((m) => m.id))).toBe(true);
    expect(bestLineup(s.members.map((m) => ({ id: m.id, name: '', stats: m.stats })))).toEqual(l);
  });
});

describe('match', () => {
  const sheets = () => [clubSheet(Object.assign(club(), { week: 2 })), opponentSheet(0)] as const;

  it('is the same game for the same seed', () => {
    const [a, b] = sheets();
    const x = simulate(a, b, 42);
    const y = simulate(a, b, 42);
    expect(x.score).toEqual(y.score);
    expect(x.n).toBe(y.n);
    expect(simulate(a, b, 43).totals).not.toEqual(x.totals);
  });

  it('lasts four quarters and ends with a winner', () => {
    const [a, b] = sheets();
    for (let seed = 1; seed <= 60; seed += 1) {
      const st = simulate(a, b, seed);
      expect(st.over).toBe(true);
      expect(st.n).toBeGreaterThanOrEqual(QUARTERS * PLAYS_PER_Q);
      expect(st.score[0]).not.toBe(st.score[1]);
      expect(st.pos).toBeGreaterThan(0);
      expect(st.pos).toBeLessThan(FIELD);
    }
  });

  it('deals three plays and three calls', () => {
    const [a, b] = sheets();
    const st = createMatch(a, b, 5);
    expect(st.hand.off).toHaveLength(3);
    expect(st.hand.def).toHaveLength(3);
    expect(new Set(st.hand.off.map((c) => c.type)).size).toBe(3);
    expect(st.pos).toBe(START);
  });

  it('four plays without ten yards hands the ball over where it is', () => {
    const [a, b] = sheets();
    const st = createMatch(a, b, 9);
    const o = st.poss;
    // a long pass into deep coverage, four times
    let last;
    for (let i = 0; i < 4 && st.poss === o; i += 1) {
      last = resolvePlay(st, { type: 'long', star: 1 }, { type: 'deep', star: 3 });
      if (last.turnover) break;
    }
    expect(st.poss).toBe(1 - o);
    expect(last!.turnover).not.toBeNull();
    expect(st.down).toBe(1);
  });

  const withSpecial = (kind: Parameters<typeof specialOf>[1], seed = 3): { st: MatchState; pick: Pick } => {
    const s = club();
    const r = RECRUITS.find((x) => x.kind === kind)!;
    // make sure the owner is on the team and has learned the play
    if (!s.members.some((m) => m.id === r.id)) s.members[6] = { id: r.id, stats: { ...r.stats }, trust: 0, captain: false };
    s.members.find((m) => m.id === r.id)!.trust = TRUST_LEARN;
    s.lineup = bestLineup(s.members.map((m) => ({ id: m.id, name: '', stats: m.stats })));
    // and lines up where the play needs them
    const info = KIND[kind];
    const positions = info.side === 'off' ? OFF_POS : DEF_POS;
    const spot = positions.find((p) => !info.roles || info.roles.includes(roleOf(p)))!;
    s.lineup = place(s.lineup, info.side, spot, r.id);
    s.week = 2;
    const st = createMatch(clubSheet(s), opponentSheet(0), seed);
    const sp = st.teams[0].specials.find((x) => x.kind === kind)!;
    return { st, pick: specialPick(sp) };
  };

  it('a special play costs momentum and gets weaker each time it is seen', () => {
    const { st, pick } = withSpecial('powerRun');
    st.poss = 0;
    st.mom[0] = MOM_MAX;
    const sp = pick.special!;
    if (specialBlock(st, 0, sp) === null) {
      expect(potency(st, 0, sp)).toBe(READ_POTENCY[0]);
      const res = resolvePlay(st, pick, { type: 'contain', star: 1 });
      expect(res.momBefore[0] - KIND.powerRun.cost).toBeLessThanOrEqual(res.momAfter[0] + 0);
      expect(st.read[0][sp.key]).toBe(1);
      expect(potency(st, 0, sp)).toBe(READ_POTENCY[1]);
      expect(st.totals[0].specials[sp.key]).toBe(1);
    }
  });

  it('a special play is not offered without momentum, on the wrong unit, or from the bench', () => {
    const { st, pick } = withSpecial('sureLong');
    const sp = pick.special!;
    st.poss = 1;
    expect(specialBlock(st, 0, sp)).toBe('side');
    st.poss = 0;
    st.mom[0] = 0;
    expect(specialBlock(st, 0, sp)).toBe('momentum');
    st.mom[0] = MOM_MAX;
    expect(usableSpecials(st, 0).map((x) => x.key)).toContain(sp.key);
    // moved away from quarterback: the play is no longer available
    const l = st.teams[0].lineup;
    st.teams[0].lineup = place(l, 'off', 'OL1', sp.owner);
    expect(specialBlock(st, 0, sp)).toBe('position');
  });

  it('a wall holds a run to almost nothing', () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { st, pick } = withSpecial('wall', seed);
      st.poss = 1;
      st.mom[0] = MOM_MAX;
      const res = resolvePlay(st, { type: 'inside', star: 3 }, pick);
      expect(res.yards).toBeLessThanOrEqual(1);
      total += res.yards;
    }
    expect(total).toBeLessThan(40);
  });

  it('looking first spends momentum and works less and less', () => {
    let ok = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const { st, pick } = withSpecial('peekOff', seed);
      st.poss = 0;
      st.mom[0] = MOM_MAX;
      expect(usePeek(st, 0, pick.special!)).toBe(true);
      expect(st.mom[0]).toBe(MOM_MAX - KIND.peekOff.cost);
      st.read[0][pick.special!.key] = 3;
      if (usePeek(st, 0, pick.special!)) ok += 1;
    }
    expect(ok).toBeGreaterThan(20);
    expect(ok).toBeLessThan(90);
  });
});

describe('season', () => {
  it('nine heroes come to the briefing, covering every ability', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const s = newSeason(seed);
      expect(s.candidates).toHaveLength(CANDIDATES);
      expect(new Set(s.candidates.map((id) => talentOf(RECRUITS.find((r) => r.id === id)!.stats).best)).size).toBe(6);
    }
  });

  it('the first hero signed is captain and already knows the special play', () => {
    const s = club();
    expect(s.members[0]!.captain).toBe(true);
    expect(s.members.filter(learned)).toHaveLength(1);
    expect(clubSheet(s).specials).toHaveLength(1);
  });

  it('practice raises abilities, the talent fastest, and one-on-one builds trust', () => {
    const s = club();
    const before = JSON.parse(JSON.stringify(s.members)) as Season['members'];
    const soloId = s.members[1]!.id;
    const changes = train(s, { groups: groups0, solo: { [soloId]: 'dash' } });
    expect(s.week).toBe(1);
    for (const m of s.members) {
      const was = before.find((x) => x.id === m.id)!;
      expect(STATS.reduce((sum, k) => sum + m.stats[k] - was.stats[k], 0)).toBeGreaterThan(0);
      expect(m.trust).toBeGreaterThanOrEqual(was.trust);
    }
    const solo = changes.find((c) => c.id === soloId)!;
    const other = changes.find((c) => c.id === s.members[2]!.id)!;
    expect(solo.trust).toBeGreaterThan(other.trust + 5);
    expect(solo.stats.spd).toBeGreaterThan(0);
  });

  it('refuses more one-on-one sessions than the week allows', () => {
    const s = club();
    const solo = Object.fromEntries(s.members.slice(0, 3).map((m) => [m.id, 'dash' as const]));
    expect(() => train(s, { groups: groups0, solo })).toThrow();
  });

  it('every event can be answered either way', () => {
    for (const e of EVENTS) {
      for (const choice of [0, 1]) {
        const s = club();
        s.event = { key: e.key, a: s.members[0]!.id, b: s.members[1]!.id };
        const changes = answerEvent(s, choice);
        expect(changes.length).toBeGreaterThan(0);
        expect(s.event).toBeNull();
        expect(s.seen).toContain(e.key);
      }
    }
  });

  it('a lost practice match does not end the season; a lost cup match does', () => {
    const lose = (s: Season) => {
      const p = plan(s);
      if (p.t !== 'match') throw new Error('not a match week');
      const st = createMatch(clubSheet(s), opponentSheet(p.opp), 1);
      st.score = [0, 7];
      st.over = true;
      return finishMatch(s, st);
    };
    const s = club();
    train(s, { groups: groups0, solo: {} });
    train(s, { groups: groups0, solo: {} });
    expect(lose(s).ended).toBe(false);
    expect(s.phase).toBe('club');
    train(s, { groups: groups0, solo: {} });
    train(s, { groups: groups0, solo: {} });
    expect(lose(s).ended).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.champion).toBe(false);
  });

  it('a season survives being saved as JSON', () => {
    const s = club(77);
    train(s, { groups: groups0, solo: {} });
    const copy = JSON.parse(JSON.stringify(s)) as Season;
    expect(train(copy, { groups: groups0, solo: {} })).toEqual(train(s, { groups: groups0, solo: {} }));
    expect(copy).toEqual(s);
  });

  it('a whole season can be played to the end', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const { season } = runSeason(seed);
      expect(season.phase).toBe('done');
      expect(season.results.length).toBeGreaterThanOrEqual(2);
      expect(season.results.length).toBeLessThanOrEqual(SCHEDULE.filter((w) => w.t === 'match').length);
      if (season.champion) expect(season.results[season.results.length - 1]!.win).toBe(true);
    }
  });

  it('the strong schools have studied the plays the club leans on', () => {
    const s = club();
    s.week = SCHEDULE.length - 1;
    s.usage = { a: 5, b: 4, c: 1 };
    expect(Object.keys(clubSheet(s).scouted ?? {})).toEqual(['a', 'b']);
    s.week = 5;
    expect(Object.keys(clubSheet(s).scouted ?? {})).toEqual([]);
  });
});
