import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game/match';
import { TIERS, TOP_TIER } from '../src/game/prestige';
import { SCHEDULE, SUMMIT_DAY, SUMMIT_MATCH, clubSheet, finishMatch, inSummit, isFinal, nextMatch, nextYear, opponentFor, plan, signRecruits, startDay, type Season } from '../src/game/season';
import { PRO_SCHOOL, SCHOOLS } from '../src/game/teams';
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
const FINAL = SCHEDULE.find((d) => isFinal(d))!;
/** plays the match of the day with this score */
const result = (s: Season, us: number, them: number): ReturnType<typeof finishMatch> => {
  const st = createMatch(clubSheet(s), opponentFor(s), 1);
  st.score = [us, them];
  st.over = true;
  return finishMatch(s, st);
};
const atFinal = (s: Season): void => {
  s.day = FINAL.n;
  s.stageAt = SCHEDULE.findIndex((d) => d.stage === 'autumn');
  startDay(s);
};

describe('the summit', () => {
  it('a club at the top that wins the nation goes on to the corporate champion; anybody else is done', () => {
    const top = clubAt(TOP_TIER);
    atFinal(top);
    const won = result(top, 28, 14);
    expect(won.ended).toBe(false);
    expect(top.champion).toBe(true);
    expect(top.day).toBe(SUMMIT_DAY);
    expect(inSummit(top)).toBe(true);
    expect(plan(top).summit).toBe(true);
    expect(nextMatch(top)).toBe(SUMMIT_MATCH);
    // the summit: the corporate champion, eleven a side
    top.day = SUMMIT_MATCH.n;
    const pro = opponentFor(top);
    expect(pro.name).toBe(SCHOOLS[PRO_SCHOOL]!.name);
    expect(pro.players).toHaveLength(11);
    const end = result(top, 35, 31);
    expect(end.ended).toBe(true);
    expect(top.summit).toBe('won');
    expect(top.phase).toBe('done');

    // one step below the top, the title ends the year
    const below = clubAt(TOP_TIER - 2);
    atFinal(below);
    const done = result(below, 21, 7);
    expect(done.ended).toBe(true);
    expect(below.champion).toBe(true);
    expect(below.summit).toBeUndefined();
  });

  it('the summit is not a match to look forward to before it is earned, and a new year starts without it', () => {
    const s = clubAt(TOP_TIER);
    s.day = FINAL.n - 3;
    expect(nextMatch(s)).toBe(FINAL);
    expect(inSummit(s)).toBe(false);
    atFinal(s);
    result(s, 7, 21);
    expect(s.phase).toBe('done');
    expect(s.summit).toBeUndefined();
    s.summit = 'lost';
    nextYear(s, 5);
    expect(s.summit).toBeUndefined();
  });
});
