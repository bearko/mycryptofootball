import { describe, expect, it } from 'vitest';
import { autoPick, colourOf, createMatch, resolvePlay, simulate, type TeamSheet } from '../src/game/match';
import { TIERS } from '../src/game/prestige';
import { clubSheet, clubTacticLv, finishMatch, hasTactic, nextYear, plan, setTactic, signRecruits, suggestedTactic, tacticOf, tacticOpen, type Season } from '../src/game/season';
import { TACTICS, edgeOf, suggestTactic, tacticLevel, tacticPower, type Tactic } from '../src/game/tactics';
import { SCHOOLS, opponentSheet } from '../src/game/teams';
import type { Stats } from '../src/game/model';
import { runSeason } from './bot';
import { opened } from './open';

/** a club that begins a year at the given standing, its briefing held */
function clubAt(tier: number, seed = 9): Season {
  const { season: s } = runSeason(seed * 31);
  s.tier = tier;
  s.fame = 40;
  nextYear(s, seed);
  if (s.phase === 'recruit') signRecruits(s, s.candidates.slice(0, TIERS[tier]!.roster - s.members.length));
  return s;
}
const with_ = (t: TeamSheet, tactic: Tactic | undefined, lv = 3): TeamSheet => ({ ...t, tactic, tacticLv: lv });

describe('the colours', () => {
  it('each has a small edge on the next, round the circle', () => {
    expect(edgeOf('iron', 'speed')).toBe(1);
    expect(edgeOf('speed', 'ground')).toBe(1);
    expect(edgeOf('ground', 'air')).toBe(1);
    expect(edgeOf('air', 'iron')).toBe(1);
    expect(edgeOf('speed', 'iron')).toBe(-1);
    expect(edgeOf('speed', 'air')).toBe(0);
    expect(edgeOf('royal', 'iron')).toBe(0);
    expect(edgeOf(undefined, 'iron')).toBe(0);
  });

  it('grow with wins, from level 1 to 5', () => {
    expect([0, 1, 2, 4, 5, 9, 13, 14, 40].map(tacticLevel)).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
    expect(tacticPower(1)).toBeCloseTo(0.7);
    expect(tacticPower(5)).toBeCloseTo(1.1);
  });

  it('the manager suggests what the heroes suit', () => {
    const at = (o: Partial<Stats>): { stats: Stats } => ({ stats: { spd: 30, pas: 30, cat: 30, blk: 30, tkl: 30, iq: 30, ...o } });
    expect(suggestTactic([at({ spd: 70 }), at({ spd: 60 })])).toBe('speed');
    expect(suggestTactic([at({ tkl: 70 }), at({ tkl: 60 })])).toBe('iron');
    expect(suggestTactic([at({ blk: 70 }), at({ blk: 60 })])).toBe('ground');
    expect(suggestTactic([at({ pas: 80, cat: 60 }), at({ cat: 60 })])).toBe('air');
  });

  it('every school that plays eleven a side has one, and the two best are the all-round kind', () => {
    for (const league of [2, 3, 4, 5, 6]) {
      for (const school of [2, 3, 5, 6, 7, 8, 9, 10, 11, 12]) {
        const t = opponentSheet(2, league, 11, school);
        expect(t.tactic, SCHOOLS[school]!.name).toBeTruthy();
        expect(t.tacticLv).toBeGreaterThanOrEqual(1);
        expect(t.tacticLv).toBeLessThanOrEqual(5);
      }
    }
    expect(SCHOOLS.filter((x) => x.tactic === 'royal').length).toBe(2);
    // six a side: none
    expect(opponentSheet(2, 0).tactic).toBeUndefined();
  });

  it('do nothing six a side', () => {
    const st = createMatch(with_(opponentSheet(0), 'speed'), with_(opponentSheet(1), 'iron'), 1);
    expect(colourOf(st, 0)).toEqual({ k: 0 });
  });

  it('make the match: speed against speed scores far more than iron against iron, and the edge counts', () => {
    const total = (a: Tactic, b: Tactic): { points: number; aWins: number } => {
      let points = 0;
      let aWins = 0;
      for (let g = 0; g < 120; g += 1) {
        const x = with_(opponentSheet(3, 4, 11, [8, 9, 10, 11][g % 4]!), a);
        const y = with_(opponentSheet(3, 4, 11, [9, 10, 11, 8][g % 4]!), b);
        const st = simulate(g % 2 ? x : y, g % 2 ? y : x, 900 + g);
        points += st.score[0] + st.score[1];
        if ((g % 2 ? st.score[0] - st.score[1] : st.score[1] - st.score[0]) > 0) aWins += 1;
      }
      return { points: points / 120, aWins: aWins / 120 };
    };
    const fast = total('speed', 'speed');
    const walls = total('iron', 'iron');
    expect(fast.points).toBeGreaterThan(walls.points * 1.6);
    expect(fast.points).toBeGreaterThan(55);
    expect(walls.points).toBeLessThan(40);
    // a small edge, not a sure thing
    const e = total('iron', 'speed');
    expect(e.aWins).toBeGreaterThan(0.5);
    expect(e.aWins).toBeLessThan(0.8);
  });

  it('a team that throws stops the clock late with an incomplete pass; a team that runs, ahead, runs it down', () => {
    const home = opponentSheet(3, 4, 11, 9);
    const away = opponentSheet(3, 4, 11, 8);
    let stopped = 0;
    let ran = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const [mine, field] of [['air', 'stop'], ['ground', 'run']] as const) {
        const st = opened(with_(home, mine), with_(away, 'royal'), seed);
        st.poss = 0;
        st.quarter = 4;
        st.left = 4;
        if (mine === 'ground') st.score = [7, 0];
        const left = st.left;
        const d = autoPick(st, 1);
        const res = resolvePlay(st, { type: mine === 'air' ? 'long' : 'inside', star: 1 }, d);
        if (res.clock === 'stop') {
          stopped += 1;
          expect(res.outcome).toBe('incomplete');
          expect(st.left).toBe(left);
        }
        if (res.clock === 'run') {
          ran += 1;
          expect(st.left).toBe(left - 2);
        }
        expect(res.clock === undefined || res.clock === field).toBe(true);
      }
    }
    expect(stopped).toBeGreaterThan(10);
    expect(ran).toBeGreaterThan(50);
  });
});

describe("the club's colour", () => {
  it('six a side there is none; eleven a side the suggestion stands until chosen', () => {
    expect(hasTactic(clubAt(1))).toBe(false);
    expect(tacticOf(clubAt(1))).toBeUndefined();
    const s = clubAt(2);
    expect(hasTactic(s)).toBe(true);
    expect(s.tactic).toBeUndefined();
    expect(tacticOf(s)).toBe(suggestedTactic(s));
    expect(clubTacticLv(s)).toBe(1);
    expect(clubSheet(s).tactic).toBe(suggestedTactic(s));
  });

  it('may be changed at the meeting only; a new colour starts from level 1, and changing back gives the old one back', () => {
    const s = clubAt(2);
    s.tactic = 'ground';
    s.tacticWins = 6;
    expect(tacticOpen(s)).toBe(true);
    setTactic(s, 'air');
    expect(s.tactic).toBe('air');
    expect(clubTacticLv(s)).toBe(1);
    setTactic(s, 'royal');
    expect(s.tactic).toBe('air');
    setTactic(s, 'ground');
    expect(s.tactic).toBe('ground');
    expect(s.tacticWins).toBe(6);
    expect(clubTacticLv(s)).toBe(3);
    s.meeting = false;
    expect(tacticOpen(s)).toBe(false);
    setTactic(s, 'iron');
    expect(s.tactic).toBe('ground');
  });

  it('becomes the club’s with its first match eleven a side, and every win takes it further', () => {
    const s = clubAt(2);
    s.meeting = false;
    while (plan(s).t !== 'match') {
      s.day += 1;
    }
    const st = simulate(clubSheet(s), opponentSheet(plan(s).opp, s.league, 11, 3), 5);
    st.score = [21, 7];
    finishMatch(s, st);
    expect(TACTICS).toContain(s.tactic);
    expect(s.tacticWins).toBe(1);
  });
});
