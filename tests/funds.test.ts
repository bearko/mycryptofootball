import { describe, expect, it } from 'vitest';
import { createMatch } from '../src/game/match';
import { SCHOOLS } from '../src/game/teams';
const SCHOOLS_NAME = (id: number): string => SCHOOLS[id]!.name;
import { ALLOWANCE, CAMP_KEYS, CAMP_SITE, FAC_PRICE, campCost, LV_MUL, REST_LV, START_MONEY, donationOf, tripCost } from '../src/game/funds';
import {
  PRACTICE, ROSTER_SIZE, SCHEDULE, buyFacility, cardInfo, clubSheet, facLv, finishMatch, isTrip, mend, moneyOf, newSeason, opponentFor, plan,
  CAMP_ASK, campOf, campOpen, campPrice, nextYear, setCamp, train, setTrip, signRecruits, stageStart, startDay, tripOpen, tripSchool, type Season,
} from '../src/game/season';

const club = (): Season => {
  const s = newSeason(11);
  signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
  return s;
};

describe('facilities and money', () => {
  it('a new club has every facility at level 1 and a little money', () => {
    const s = club();
    expect(moneyOf(s)).toBe(START_MONEY + ALLOWANCE[0]!);
    expect(Object.values(s.fac!).every((v) => v === 1)).toBe(true);
  });

  it('a drill\'s stars are its facility\'s level; buying takes it up (and the cards in hand follow)', () => {
    const s = club();
    const card = { uid: 999, kind: 'basic' as const, key: 'hit' as const, star: 1 };
    s.hand.unshift(card);
    expect(cardInfo(s, card).xp.pow).toBeCloseTo(PRACTICE.hit.xp.pow! * LV_MUL[1]!, 1);
    s.money = 100;
    expect(buyFacility(s, 'hit')).toBe(true);
    expect(facLv(s, 'hit')).toBe(2);
    expect(moneyOf(s)).toBe(100 - FAC_PRICE[2]!);
    expect(card.star).toBe(2);
    expect(cardInfo(s, card).star).toBe(2);
    expect(cardInfo(s, card).xp.pow).toBeCloseTo(PRACTICE.hit.xp.pow! * LV_MUL[2]!, 1);
    // the club room gives back more stamina
    buyFacility(s, 'rest');
    expect(cardInfo(s, { uid: 1, kind: 'rest' }).sta).toBe(REST_LV[2]);
    // not without the money, and not past level 5
    s.money = 0;
    expect(buyFacility(s, 'dash')).toBe(false);
    s.money = 1000;
    for (let i = 0; i < 9; i += 1) buyFacility(s, 'dash');
    expect(facLv(s, 'dash')).toBe(5);
  });

  it('money comes in with each part of the year', () => {
    const s = club();
    const before = moneyOf(s);
    s.day = stageStart('camp');
    startDay(s);
    expect(moneyOf(s)).toBe(before + ALLOWANCE[s.tier]!);
    expect(s.paid).toBe(ALLOWANCE[s.tier]);
  });

  it('a win brings a gift; a trip costs, meets a school of the tournament above, and teaches everybody', () => {
    const s = club();
    s.day = SCHEDULE.findIndex((d) => d.stage === 'summer' && d.t === 'match');
    s.stageAt = stageStart('summer');
    expect(tripOpen(s)).toBe(true);
    s.money = 50;
    setTrip(s, true);
    expect(isTrip(s)).toBe(true);
    expect(opponentFor(s).name).toBe(SCHOOLS_NAME(tripSchool(s)));
    const xp = s.members.map((m) => ({ ...m.xp }));
    const st = createMatch(clubSheet(s), opponentFor(s), 1);
    st.score = [14, 21];
    st.over = true;
    const res = finishMatch(s, st);
    expect(res.trip).toBe(tripCost(s.league));
    expect(res.gift).toBe(0);
    expect(moneyOf(s)).toBe(50 - tripCost(s.league));
    expect(s.trip).toBeUndefined();
    // everybody learned something (some of it already turned into abilities)
    expect(res.changes.some((c) => Object.keys(c.stats).length > 0) || s.members.some((m, i) => m.xp.pow > xp[i]!.pow)).toBe(true);
    expect(s.results[s.results.length - 1]!.school).toBeDefined();
    // a win at home brings the supporters' gift
    const t = club();
    t.day = 6;
    const m2 = createMatch(clubSheet(t), opponentFor(t), 1);
    m2.score = [21, 7];
    m2.over = true;
    const before = moneyOf(t);
    expect(finishMatch(t, m2).gift).toBe(donationOf(0, 0));
    expect(moneyOf(t)).toBe(before + donationOf(0, 0));
    expect(plan(t).n).toBe(7);
  });

  it('a season saved before money existed gets facilities at level 1 and some money', () => {
    const s = club();
    delete s.fac;
    delete s.money;
    mend(s);
    expect(facLv(s, 'game')).toBe(1);
    expect(moneyOf(s)).toBeGreaterThan(0);
  });
});

describe('the summer camp\'s place', () => {
  it('the further it goes, the more it costs and does; the school is free', () => {
    expect(campCost('school', 6)).toBe(0);
    for (let i = 1; i < CAMP_KEYS.length; i += 1) {
      const [a, b] = [CAMP_KEYS[i - 1]!, CAMP_KEYS[i]!];
      expect(campCost(b, 0)).toBeGreaterThan(campCost(a, 0));
      expect(campCost(b, 4)).toBeGreaterThanOrEqual(campCost(b, 0));
      expect(CAMP_SITE[b].xp).toBeGreaterThanOrEqual(CAMP_SITE[a].xp);
      expect(CAMP_SITE[b].sta).toBeLessThanOrEqual(CAMP_SITE[a].sta);
    }
  });

  it('is asked on the last practice before the camp, paid at once, and does what it says at the camp', () => {
    const s = club();
    expect(SCHEDULE[CAMP_ASK]!.stage).toBe('summer');
    expect(SCHEDULE[CAMP_ASK + 1]!.stage).toBe('camp');
    s.day = CAMP_ASK - 1;
    expect(campOpen(s)).toBe(false);
    s.day = CAMP_ASK;
    s.stageAt = stageStart('summer');
    expect(campOpen(s)).toBe(true);
    s.money = campPrice(s, 'center') - 1;
    expect(setCamp(s, 'center')).toBe(false);
    s.money = 30;
    expect(setCamp(s, 'highland')).toBe(true);
    expect(moneyOf(s)).toBe(30 - campPrice(s, 'highland'));
    expect(campOpen(s)).toBe(false);
    expect(setCamp(s, 'center')).toBe(false);
    // the camp: the place's own effect, and a whole new hand
    startDay(s);
    const old = s.hand.map((c) => c.uid);
    train(s, 0);
    expect(plan(s).stage).toBe('camp');
    expect(campOf(s)).toBe('highland');
    expect(s.hand.some((c) => old.includes(c.uid))).toBe(false);
    const card = s.hand.find((c) => c.kind === 'basic')!;
    const school = { ...s, camp: 'school' as const };
    expect(cardInfo(s, card).xp.pow ?? cardInfo(s, card).xp.spd ?? 0).toBeGreaterThanOrEqual(cardInfo(school, card).xp.pow ?? cardInfo(school, card).xp.spd ?? 0);
    expect(cardInfo(s, card).sta).toBeGreaterThan(cardInfo(school, card).sta);
  });

  it('a club that never decided goes to the school, and the next year asks again', () => {
    const s = club();
    s.day = CAMP_ASK;
    s.stageAt = stageStart('summer');
    startDay(s);
    train(s, 0);
    expect(s.camp).toBe('school');
    s.phase = 'done';
    nextYear(s, 7);
    expect(s.camp).toBeUndefined();
  });
});
