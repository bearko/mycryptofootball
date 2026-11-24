// The semi-final and the final: the stronger schools have studied the club's favourite special plays, and the
// match-day banner names them. Those are not only heroes' plays: a play of the colour or two heroes' play counts too.
import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/game/prestige';
import { SCHEDULE, clubSheet, nextYear, plan, scoutedKeys, scoutedNames, signRecruits, startDay, type Season } from '../src/game/season';
import { runSeason } from './bot';

/** an eleven-a-side club on the morning of the autumn semi-final */
function semiFinal(): Season {
  const { season: s } = runSeason(31 * 9);
  s.tier = 3;
  s.fame = 40;
  nextYear(s, 9);
  if (s.phase === 'recruit') signRecruits(s, s.candidates.slice(0, TIERS[3]!.roster - s.members.length));
  s.day = SCHEDULE.findIndex((d) => d.t === 'match' && d.stage === 'autumn' && d.round === 2);
  startDay(s);
  return s;
}

describe('the plays the stronger schools have studied', () => {
  it('are named whatever kind of card they are, so the match day opens', () => {
    const s = semiFinal();
    expect(plan(s).t).toBe('match');
    const tac = clubSheet(s).specials.find((sp) => sp.key.startsWith('tac-'));
    expect(tac).toBeTruthy();
    // a play of the colour used the most, a play of a hero who has left, and the hero's own play of a member
    const own = clubSheet(s).specials.find((sp) => /^\d+$/.test(sp.key));
    s.usage = { [tac!.key]: 9, 'bond:gone': 7, ...(own ? { [own.key]: 5 } : {}) };
    expect(scoutedKeys(s)).toContain(tac!.key);
    const names = scoutedNames(s);
    expect(names).toContain(tac!.name);
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
  });
});
