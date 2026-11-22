import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BENTO, MEDAL_PACK, MEDAL_RATE, obOf, slotReturn, spin } from '../src/game/alumni';
import { GRADES, STA_MAX, buyBento, buyMedals, cashMedals, graduating, itemCount, medalsOf, moneyOf, nextYear, obOfClub, playSlot, shopOpen, useBento } from '../src/game/season';
import { runCareer, runSeason } from './bot';

describe('the alumni', () => {
  it('a graduate leaves OB points: more for a better hero, a trusting one, a captain', () => {
    const stats = (v: number) => ({ spd: v, pas: v, cat: v, blk: v, tkl: v, iq: v });
    expect(obOf({ stats: stats(30), trust: 0, captain: false })).toBe(6);
    expect(obOf({ stats: stats(90), trust: 100, captain: true })).toBe(4 + 6 + 4 + 5);
    // three years on, the founders graduate and leave their points
    expect(shopOpen(runSeason(11).season)).toBe(false);
    const s = runCareer(11, 3).season;
    const leaving = graduating(s);
    expect(leaving.length).toBeGreaterThan(0);
    expect(leaving.every((m) => m.grade >= GRADES)).toBe(true);
    const want = leaving.reduce((v, m) => v + obOf(m), 0);
    nextYear(s, 9);
    expect(s.obGain).toBe(want);
    expect(obOfClub(s)).toBe(want);
    expect(shopOpen(s)).toBe(true);
  });

  it('a lunch box costs points and gives everybody stamina; medals can be bought, played and cashed', () => {
    const s = runSeason(5).season;
    s.ob = 100;
    for (const m of s.members) m.sta = 20;
    expect(buyBento(s, 'sand')).toBe(true);
    expect(obOfClub(s)).toBe(100 - BENTO.sand.price);
    expect(itemCount(s, 'sand')).toBe(1);
    const changes = useBento(s, 'sand');
    expect(itemCount(s, 'sand')).toBe(0);
    expect(changes.length).toBe(s.members.length);
    expect(s.members.every((m) => m.sta === 20 + BENTO.sand.sta)).toBe(true);
    // the grandest fills everybody up
    s.ob = 100;
    buyBento(s, 'gojubako');
    useBento(s, 'gojubako');
    expect(s.members.every((m) => m.sta === STA_MAX)).toBe(true);
    // not enough points: nothing is bought
    s.ob = 3;
    expect(buyBento(s, 'onigiri')).toBe(false);
    expect(buyMedals(s)).toBe(false);
    s.ob = 50;
    expect(buyMedals(s)).toBe(true);
    expect(medalsOf(s)).toBe(MEDAL_PACK.medals);
    // a spin takes the bet and pays what came up
    const before = medalsOf(s);
    const out = playSlot(s, 3)!;
    expect(medalsOf(s)).toBe(before - 3 + out.pay);
    s.medals = MEDAL_RATE.medals;
    const money = moneyOf(s);
    expect(cashMedals(s)).toBe(true);
    expect(moneyOf(s)).toBe(money + MEDAL_RATE.money);
    expect(playSlot(s, 1)).toBeNull();
  });

  it('the medal game gives back a little less than it takes, and hits often enough to be fun', () => {
    expect(slotReturn()).toBeGreaterThan(0.85);
    expect(slotReturn()).toBeLessThan(1);
    const rng = new Rng(42);
    let paid = 0;
    let hits = 0;
    const N = 20000;
    for (let i = 0; i < N; i += 1) {
      const r = spin(rng, 1);
      paid += r.pay;
      if (r.hit) hits += 1;
    }
    expect(paid / N).toBeGreaterThan(0.8);
    expect(paid / N).toBeLessThan(1.05);
    expect(hits / N).toBeGreaterThan(0.18);
  });
});
