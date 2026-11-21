import { describe, expect, it } from 'vitest';
import { isRun, type OffType } from '../src/game/cards';
import { bench, bookMatch, forty, lineOf, passerRating, played, rolesOf, type Box, type Line } from '../src/game/boxscore';
import { autoPick, createMatch, resolvePlay, type MatchState, type PlayResult, type TeamSheet } from '../src/game/match';
import { STAT_MAX, defPos, offPos, type Stats } from '../src/game/model';
import { ROSTER_SIZE, clubSheet, newSeason, nextYear, signRecruits } from '../src/game/season';
import { opponentSheet } from '../src/game/teams';
import { runCareer, runSeason } from './bot';

const HOME: TeamSheet = (() => {
  const s = newSeason(5);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  return clubSheet(s);
})();

/** a whole match with the computer on both sides, every play kept */
function playMatch(home: TeamSheet, away: TeamSheet, seed: number): { st: MatchState; plays: PlayResult[] } {
  const st = createMatch(home, away, seed);
  const plays: PlayResult[] = [];
  for (let g = 0; !st.over && g < 500; g += 1) {
    const def = autoPick(st, (1 - st.poss) as 0 | 1);
    plays.push(resolvePlay(st, autoPick(st, st.poss, def), def));
  }
  return { st, plays };
}
const sum = (box: Box, key: keyof Line): number => Object.values(box).reduce((a, l) => a + (l[key] ?? 0), 0);

describe('the box score', () => {
  it('adds up to what the plays did, for both teams, six a side and eleven', () => {
    for (const [home, away] of [[HOME, opponentSheet(2)], [opponentSheet(0, 2), opponentSheet(3, 2)]] as [TeamSheet, TeamSheet][]) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const { st, plays } = playMatch(home, away, seed);
        for (const t of [0, 1] as const) {
          const box = st.box![t];
          const mine = plays.filter((p) => p.off === t && !p.kick && !p.tfp);
          const runs = mine.filter((p) => isRun(p.offPick.type as OffType));
          const passes = mine.filter((p) => !isRun(p.offPick.type as OffType));
          const caught = passes.filter((p) => ['gain', 'nogain', 'loss'].includes(p.outcome));
          expect(sum(box, 'car')).toBe(runs.length);
          expect(sum(box, 'ry')).toBe(runs.reduce((a, p) => a + p.yards, 0));
          expect(sum(box, 'att')).toBe(passes.filter((p) => p.outcome !== 'sack').length);
          expect(sum(box, 'cmp')).toBe(caught.length);
          expect(sum(box, 'rec')).toBe(caught.length);
          expect(sum(box, 'py')).toBe(caught.reduce((a, p) => a + p.yards, 0));
          expect(sum(box, 'cy')).toBe(sum(box, 'py'));
          expect(sum(box, 'tgt')).toBe(sum(box, 'att'));
          expect(sum(box, 'ptd')).toBe(sum(box, 'ctd'));
          expect(sum(box, 'rtd') + sum(box, 'ptd')).toBe(mine.filter((p) => p.td).length);
          expect(sum(box, 'pi')).toBe(passes.filter((p) => p.outcome === 'int').length);
          expect(sum(box, 'sk')).toBe(passes.filter((p) => p.outcome === 'sack').length);
          // only the quarterback throws; every offensive play counts once for each of the heroes on the field
          const qb = st.teams[t].lineup.off.QB;
          expect(box[qb]?.att ?? 0).toBe(sum(box, 'att'));
          expect(sum(box, 'os')).toBe(mine.length * offPos(st.teams[t].lineup).length);
          // what the other side's defense was credited with
          const other = st.box![(1 - t) as 0 | 1];
          const theirs = plays.filter((p) => p.off === (1 - t) && !p.kick && !p.tfp);
          expect(sum(box, 'ds')).toBe(theirs.length * defPos(st.teams[t].lineup).length);
          expect(sum(other, 'int')).toBe(sum(box, 'pi'));
          expect(sum(other, 'sck')).toBe(sum(box, 'sk'));
          expect(sum(other, 'ff')).toBe(sum(box, 'fum'));
          // the kicks
          const kicks = plays.filter((p) => p.off === t && p.kick);
          expect(sum(box, 'fga')).toBe(kicks.filter((p) => p.kick!.type === 'fg').length);
          expect(sum(box, 'fgm') * 3 + sum(box, 'xpm')).toBe(kicks.reduce((a, p) => a + p.points, 0));
          expect(sum(box, 'ko')).toBe(kicks.filter((p) => p.kick!.type === 'kickoff' || p.kick!.type === 'onside').length);
          // nobody has a number that is not whole, and only the yards can be below zero
          for (const l of Object.values(box)) {
            for (const [k, v] of Object.entries(l)) {
              expect(Number.isInteger(v)).toBe(true);
              if (!['py', 'ry', 'cy', 'ly', 'rlong', 'clong'].includes(k)) expect(v, k).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it('goes into the season match by match, with a match for everyone who played, and starts again each year', () => {
    const { season, matches } = runSeason(11);
    const box = season.box!;
    expect(Object.keys(box).length).toBeGreaterThan(5);
    // the quarterback of every match: his attempts are the club's
    const att = matches.reduce((a, m) => a + sum(m.box![0], 'att'), 0);
    expect(sum(box, 'att')).toBe(att);
    for (const [id, l] of Object.entries(box)) {
      const n = matches.filter((m) => played(m.box![0][Number(id)])).length;
      expect(l.gp ?? 0, id).toBe(n);
    }
    // a hero's longest run is the longest of his matches
    const rb = Object.entries(box).sort((a, b) => (b[1].car ?? 0) - (a[1].car ?? 0))[0]!;
    expect(rb[1].rlong).toBe(Math.max(...matches.map((m) => m.box![0][Number(rb[0])]?.rlong ?? 0)));
    nextYear(season, 3);
    expect(season.box).toEqual({});
    const { season: later } = runCareer(4, 2);
    expect(Object.values(later.box!).some((l) => (l.gp ?? 0) > 0)).toBe(true);
  });

  it('a season and a match in progress make one line (a missing one is nothing)', () => {
    const season: Box = { 7: { gp: 2, car: 10, ry: 40, rlong: 12 } };
    const match: Box = { 7: { car: 3, ry: 25, rlong: 18, os: 9 } };
    expect(lineOf(7, season, match)).toEqual({ gp: 2, car: 13, ry: 65, rlong: 18, os: 9 });
    expect(lineOf(8, season, match)).toEqual({});
    expect(lineOf(7, undefined, match)).toEqual(match[7]);
    const into: Box = {};
    bookMatch(into, match);
    bookMatch(into, { 7: { tk: 1 }, 9: {} });
    expect(into[7]).toEqual({ car: 3, ry: 25, rlong: 18, os: 9, gp: 1, tk: 1 });
    expect(into[9]?.gp).toBeUndefined();
  });

  it('the passer rating runs from 0 to 158.3', () => {
    expect(passerRating({})).toBeNull();
    expect(passerRating({ att: 10, cmp: 10, py: 200, ptd: 3 })).toBe(158.3);
    expect(passerRating({ att: 10, cmp: 0, pi: 5 })).toBe(0);
    expect(passerRating({ att: 20, cmp: 13, py: 150, ptd: 1, pi: 1 })).toBe(83.3);
  });

  it('tells which unit a hero plays on, and whether he kicks', () => {
    const r = rolesOf(HOME, HOME.lineup.off.QB);
    expect(r.off).toBe('QB');
    const k = HOME.lineup.k;
    if (k != null) expect(rolesOf(HOME, k).kicker).toBe(true);
    expect(rolesOf(HOME, -1)).toEqual({ off: null, def: null, kicker: false });
  });
});

describe('the scouting sheet', () => {
  const at = (spd: number, blk: number, tkl: number): Stats => ({ spd, pas: 30, cat: 30, blk, tkl, iq: 30 });
  it('the faster the hero, the quicker his 40-yard dash: from about 4.3 seconds to about 6', () => {
    for (const id of [1, 2, 30001, 5019]) {
      let last = Infinity;
      for (let spd = 0; spd <= STAT_MAX; spd += 10) {
        const t = forty(at(spd, 30, 30), id);
        expect(t).toBeLessThanOrEqual(last + 0.11);
        last = t;
        expect(t).toBeGreaterThanOrEqual(4.22);
        expect(t).toBeLessThanOrEqual(6.4);
        expect(Math.round(t * 100) / 100).toBe(t);
      }
      expect(forty(at(STAT_MAX, 30, 30), id)).toBeLessThan(4.5);
      expect(forty(at(10, 30, 30), id)).toBeGreaterThan(5.7);
      // the same hero, the same number, every time
      expect(forty(at(55, 30, 30), id)).toBe(forty(at(55, 30, 30), id));
    }
  });
  it('the stronger blocker or tackler lifts more, in fives', () => {
    for (const id of [1, 2, 30001]) {
      const lo = bench(at(30, 10, 10), id);
      const hi = bench(at(30, STAT_MAX, 90), id);
      expect(hi).toBeGreaterThan(lo + 60);
      expect(lo % 5).toBe(0);
      expect(hi % 5).toBe(0);
      expect(lo).toBeGreaterThanOrEqual(40);
      expect(hi).toBeLessThanOrEqual(160);
    }
  });
});
