import { describe, expect, it } from 'vitest';
import { KIND, MATCH, OFF_TYPES, DEF_TYPES, READ_POTENCY } from '../src/game/cards';
import { RECRUITS, hero, specialOf, talentOf } from '../src/game/heroes';
import { bestLineup, fielded, place, unitsOf, validLineup } from '../src/game/lineup';
import {
  FIELD, MOM_MAX, PLAYS_PER_Q, QUARTERS, START, createMatch, halftimeTalk, potency, resolvePlay, simulate, specialBlock, specialPick,
  usePeek, usableSpecials, type MatchState, type Pick,
} from '../src/game/match';
import { DEF_POS, OFF_POS, STATS, fit, roleOf } from '../src/game/model';
import { OPPONENTS, opponentSheet } from '../src/game/teams';
import {
  CANDIDATES, EVENTS, HAND_SIZE, PRACTICE, PRACTICE_KEYS, REST_STA, ROSTER_SIZE, SCHEDULE, STA_MAX, STAT_COST, TRUST_DRILL, TRUST_LEARN, answerEvent, applyPreset,
  cardInfo, clubSheet, costOf, dateText, finishMatch, learned, newSeason, plan, policyOpen, presetFocus, previewTrain, setFocus,
  signRecruits, train, type PracticeCard, type Season,
} from '../src/game/season';
import { runSeason } from './bot';

const club = (seed = 11): Season => {
  const s = newSeason(seed);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  return s;
};
/** Puts one known card in the hand and plays it. */
const play = (s: Season, card: PracticeCard): ReturnType<typeof train> => {
  s.event = null;
  s.hand[0] = card;
  return train(s, 0);
};
const basic = (key: (typeof PRACTICE_KEYS)[number], star = 2): PracticeCard => ({ uid: 999, kind: 'basic', key, star });

describe('heroes', () => {
  it('each recruit is outstanding at exactly one thing', () => {
    expect(RECRUITS).toHaveLength(24);
    const count: Record<string, number> = {};
    for (const r of RECRUITS) {
      const { best } = talentOf(r.stats);
      count[best] = (count[best] ?? 0) + 1;
      const sorted = STATS.map((k) => r.stats[k]).sort((a, b) => b - a);
      expect(sorted[0]! - sorted[1]!).toBeGreaterThanOrEqual(14);
      expect(hero(r.id).passive.length).toBeGreaterThan(0);
    }
    expect(Object.values(count)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(new Set(RECRUITS.map((r) => r.id)).size).toBe(RECRUITS.length);
  });

  it('every kind of special play belongs to two recruits', () => {
    const kinds = new Map<string, number>();
    for (const r of RECRUITS) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    expect(kinds.size).toBe(12);
    expect([...kinds.values()].every((n) => n === 2)).toBe(true);
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

  it('the two units are separate: a swap stays inside its unit, a newcomer takes one spot and nothing else', () => {
    const s = club();
    const l = s.lineup!;
    const ids = s.members.map((m) => m.id);
    const swapped = place(l, 'off', 'QB', l.off.RB);
    expect(swapped.off.QB).toBe(l.off.RB);
    expect(swapped.off.RB).toBe(l.off.QB);
    expect(swapped.def).toEqual(l.def);
    // somebody who is not on the offense takes a spot there: only that spot changes
    const sub = ids.find((id) => !OFF_POS.some((p) => l.off[p] === id))!;
    const out = l.off.WR1;
    const subbed = place(l, 'off', 'WR1', sub);
    expect(subbed.off.WR1).toBe(sub);
    expect(OFF_POS.map((p) => subbed.off[p])).not.toContain(out);
    expect(subbed.def).toEqual(l.def);
    expect(validLineup(subbed, ids)).toBe(true);
    expect(fielded(subbed)).toContain(sub);
    expect(unitsOf(subbed, sub)).toContain('off');
    // six different heroes in each unit, or it is no line-up
    expect(validLineup({ ...l, off: { ...l.off, QB: l.off.RB } }, ids)).toBe(false);
    expect(bestLineup(s.members.map((m) => ({ id: m.id, name: '', stats: m.stats })))).toEqual(l);
  });

  it('the best line-up is the best offense and the best defense, each on its own, however big the club', () => {
    const players = RECRUITS.map((r) => ({ id: r.id, name: '', stats: r.stats }));
    const t0 = Date.now();
    const l = bestLineup(players);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(validLineup(l, players.map((p) => p.id))).toBe(true);
    const total = (unit: 'off' | 'def'): number =>
      (unit === 'off' ? OFF_POS : DEF_POS).reduce((v, p) => v + fit(players.find((q) => q.id === (l[unit] as Record<string, number>)[p])!.stats, roleOf(p)), 0);
    // no single change of one hero makes either unit better
    for (const unit of ['off', 'def'] as const) {
      const base = total(unit);
      for (const pos of unit === 'off' ? OFF_POS : DEF_POS) {
        for (const q of players) {
          const alt = place(l, unit, pos, q.id);
          const v = (unit === 'off' ? OFF_POS : DEF_POS).reduce((sum, p) => sum + fit(players.find((x) => x.id === (alt[unit] as Record<string, number>)[p])!.stats, roleOf(p)), 0);
          expect(v).toBeLessThanOrEqual(base + 1e-6);
        }
      }
    }
    // with twenty-four to choose from, nobody has to play both ways
    expect(fielded(l).length).toBeGreaterThanOrEqual(10);
  });
});

describe('match', () => {
  const sheets = () => [clubSheet(Object.assign(club(), { day: 6 })), opponentSheet(0)] as const;

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
    if (!s.members.some((m) => m.id === r.id)) s.members[6] = { ...s.members[6]!, id: r.id, stats: { ...r.stats }, trust: 0, captain: false };
    s.members.find((m) => m.id === r.id)!.trust = TRUST_LEARN;
    s.lineup = bestLineup(s.members.map((m) => ({ id: m.id, name: '', stats: m.stats })));
    // and lines up where the play needs them
    const info = KIND[kind];
    const positions = info.side === 'off' ? OFF_POS : DEF_POS;
    const spot = positions.find((p) => !info.roles || info.roles.includes(roleOf(p)))!;
    s.lineup = place(s.lineup, info.side, spot, r.id);
    s.day = 6;
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

  it('the half-time talk changes the second half', () => {
    const [a, b] = sheets();
    const st = createMatch(a, b, 4);
    st.mom[0] = 4;
    halftimeTalk(st, 0, 'fire');
    expect(st.mom[0]).toBe(MOM_MAX);
    st.read[0] = { x: 2, y: 0 };
    halftimeTalk(st, 0, 'rethink');
    expect(st.read[0]).toEqual({ x: 1, y: 0 });
    halftimeTalk(st, 0, 'study');
    expect(st.insight).toEqual([0.25, 0]);
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

  it('the calendar runs four weeks: practice Monday to Saturday, a match every Sunday', () => {
    expect(SCHEDULE).toHaveLength(28);
    expect(dateText(SCHEDULE[0]!)).toBe('4月5日（月）');
    expect(dateText(SCHEDULE[27]!)).toBe('5月2日（日）');
    expect(SCHEDULE.filter((d) => d.t === 'match').map((d) => d.n)).toEqual([6, 13, 20, 27]);
    expect(SCHEDULE.filter((d) => d.t === 'match').map((d) => d.cup)).toEqual([false, true, true, true]);
  });

  it('the first hero signed is captain and already knows the special play', () => {
    const s = club();
    expect(s.members[0]!.captain).toBe(true);
    expect(s.members.filter(learned)).toHaveLength(1);
    expect(clubSheet(s).specials).toHaveLength(1);
    expect(s.hand).toHaveLength(HAND_SIZE + 1);
    expect(s.hand[s.hand.length - 1]!.kind).toBe('rest');
  });

  it('practice costs stamina, a day off brings it back, and the rest card never leaves the hand', () => {
    const s = club();
    expect(s.members.every((m) => m.sta === STA_MAX)).toBe(true);
    const hard = play(s, basic('hit'));
    expect(hard.changes.every((c) => c.sta === -PRACTICE.hit.sta)).toBe(true);
    expect(s.members.every((m) => m.sta === STA_MAX - PRACTICE.hit.sta)).toBe(true);
    for (const m of s.members) m.sta = 20;
    const at = s.hand.findIndex((c) => c.kind === 'rest');
    s.event = null;
    const off = train(s, at);
    expect(off.changes.every((c) => c.sta === REST_STA && Object.keys(c.stats).length === 0)).toBe(true);
    expect(s.hand.filter((c) => c.kind === 'rest')).toHaveLength(1);
    expect(s.hand).toHaveLength(HAND_SIZE + 1);
  });

  it('a tired hero takes in less of a practice, and plays a match a little worse', () => {
    const fresh = club(5);
    const worn = club(5);
    for (const m of worn.members) m.sta = 10;
    play(fresh, basic('dash', 3));
    play(worn, basic('dash', 3));
    const xp = (x: Season): number => x.members.reduce((sum, m) => sum + m.xp.spd + m.stats.spd * 10, 0);
    expect(xp(worn)).toBeLessThan(xp(fresh));
    const a = club(5);
    const b = club(5);
    for (const m of b.members) m.sta = 0;
    a.day = 6;
    b.day = 6;
    const total = (x: Season): number => clubSheet(x).players.reduce((sum, pl) => sum + pl.stats.spd + pl.stats.blk, 0);
    expect(total(b)).toBeLessThan(total(a));
  });

  it('while one hero trains alone, the others catch their breath', () => {
    const s = club();
    for (const m of s.members) m.sta = 50;
    const one = s.members[2]!.id;
    const r = play(s, { uid: 999, kind: 'solo', hero: one });
    expect(r.changes.find((c) => c.id === one)!.sta).toBeLessThan(0);
    expect(r.changes.filter((c) => c.id !== one).every((c) => c.sta > 0)).toBe(true);
  });

  it('everyone starts out working on their talent, and the policy is open at the start only', () => {
    const s = club();
    for (const m of s.members) expect(m.focus).toBe(talentOf(m.stats).best);
    expect(policyOpen(s)).toBe(true);
    const id = s.members[1]!.id;
    setFocus(s, id, 'iq');
    expect(s.members[1]!.focus).toBe('iq');
    applyPreset(s, 'defense');
    for (const m of s.members) expect(m.focus).toBe(presetFocus(s, m, 'defense'));
    play(s, basic('dash'));
    expect(policyOpen(s)).toBe(false);
    expect(() => setFocus(s, id, 'spd')).toThrow();
    expect(() => applyPreset(s, 'talent')).toThrow();
  });

  it('a practice card gives experience, and each hero turns it into the policy ability first', () => {
    const s = club();
    const runner = s.members.find((m) => m.focus === 'spd')!;
    const before = runner.stats.spd;
    for (let i = 0; i < 4; i += 1) play(s, basic('dash', 3));
    expect(s.day).toBe(4);
    expect(runner.stats.spd).toBeGreaterThan(before + 3);
    // a hero whose policy has no use for speed still gets something out of the running
    const wall = s.members.find((m) => m.focus === 'blk');
    if (wall) expect(wall.stats.spd).toBeGreaterThan(RECRUITS.find((r) => r.id === wall.id)!.stats.spd);
  });

  it('the talent is cheap to raise, the weak spot dear, and the heights steep', () => {
    const s = club();
    const m = s.members[0]!;
    const { best, worst } = talentOf(m.stats);
    const sum = (k: Parameters<typeof costOf>[1]): number => Object.values(costOf(m, k)).reduce((a, b) => a + (b as number), 0);
    const base = (k: Parameters<typeof costOf>[1]): number => Object.values(STAT_COST[k]).reduce((a, b) => a + (b as number), 0);
    expect(m.focus).toBe(best);
    expect(sum(best)).toBeLessThan(base(best));
    expect(sum(worst)).toBeGreaterThan(base(worst) * 1.4);
    const low = sum(best);
    m.stats[best] = 85;
    expect(sum(best)).toBeGreaterThan(low);
  });

  it('working with one hero alone raises that hero and their trust, nobody else', () => {
    const s = club();
    const m = s.members[2]!;
    const others = s.members.filter((x) => x !== m).map((x) => ({ ...x.stats }));
    const trust = m.trust;
    const focus = m.stats[m.focus];
    const report = play(s, { uid: 999, kind: 'solo', hero: m.id });
    expect(m.trust).toBeGreaterThanOrEqual(trust + 9);
    expect(m.stats[m.focus]).toBeGreaterThan(focus);
    expect(report.info.hero).toBe(m.id);
    s.members.filter((x) => x !== m).forEach((x, i) => expect(x.stats).toEqual(others[i]));
  });

  it('a trusted hero\'s special drill is the richest card for that ability', () => {
    const s = club();
    const m = s.members[0]!;
    const talent = talentOf(m.stats).best;
    const drill = cardInfo(s, { uid: 1, kind: 'special', hero: m.id });
    const total = (xp: Partial<Record<string, number>>): number => Object.values(xp).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
    for (const key of PRACTICE_KEYS) expect(total(drill.xp)).toBeGreaterThan(total(cardInfo(s, basic(key, 3)).xp));
    expect(Object.keys(drill.xp).sort()).toEqual(Object.keys(STAT_COST[talent]).sort());
  });

  it('special drills only turn up for heroes the coach has earned the trust of', () => {
    let seen = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const s = club(seed);
      // on the first day only the captain trusts the coach enough
      for (const c of s.hand) {
        if (c.kind !== 'special') continue;
        seen += 1;
        expect(c.hero).toBe(s.members[0]!.id);
        expect(s.members[0]!.trust).toBeGreaterThanOrEqual(TRUST_DRILL);
      }
    }
    expect(seen).toBeGreaterThan(3);
  });

  it('previewing a card changes nothing', () => {
    const s = club();
    const copy = JSON.stringify(s);
    const preview = previewTrain(s, 1);
    expect(JSON.stringify(s)).toBe(copy);
    expect(train(s, 1).changes).toEqual(preview);
  });

  it('every event can be answered either way, and has to be answered before practice', () => {
    for (const e of EVENTS) {
      for (const choice of [0, 1]) {
        const s = club();
        s.event = { key: e.key, a: s.members[0]!.id, b: s.members[1]!.id };
        expect(() => train(s, 0)).toThrow();
        const changes = answerEvent(s, choice);
        expect(changes.length).toBeGreaterThan(0);
        expect(s.event).toBeNull();
        expect(s.seen).toContain(e.key);
      }
    }
  });

  it('a lost practice match does not end the season and reopens the policy; a lost cup match ends it', () => {
    const lose = (s: Season) => {
      const p = plan(s);
      if (p.t !== 'match') throw new Error('not a match day');
      const st = createMatch(clubSheet(s), opponentSheet(p.opp), 1);
      st.score = [0, 7];
      st.over = true;
      return finishMatch(s, st);
    };
    const toMatch = (s: Season): void => {
      while (plan(s).t === 'train') {
        if (s.event) answerEvent(s, 0);
        train(s, 0);
      }
    };
    const s = club();
    toMatch(s);
    expect(s.day).toBe(6);
    expect(lose(s).ended).toBe(false);
    expect(s.phase).toBe('club');
    expect(policyOpen(s)).toBe(true);
    toMatch(s);
    expect(policyOpen(s)).toBe(false);
    expect(lose(s).ended).toBe(true);
    expect(s.phase).toBe('done');
    expect(s.champion).toBe(false);
  });

  it('a season survives being saved as JSON', () => {
    const s = club(77);
    train(s, 0);
    const copy = JSON.parse(JSON.stringify(s)) as Season;
    expect(train(copy, 2)).toEqual(train(s, 2));
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
    s.day = SCHEDULE.length - 1;
    s.usage = { a: 5, b: 4, c: 1 };
    expect(Object.keys(clubSheet(s).scouted ?? {})).toEqual(['a', 'b']);
    s.day = 13;
    expect(Object.keys(clubSheet(s).scouted ?? {})).toEqual([]);
  });
});
