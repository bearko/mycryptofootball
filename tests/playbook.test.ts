import { describe, expect, it } from 'vitest';
import { DEF_TYPES, OFF_TYPES } from '../src/game/cards';
import { createMatch, deal, outlook } from '../src/game/match';
import { DEF_PLAYS, DEF_PLAY_KEYS, OFF_PLAYS, OFF_PLAY_KEYS, goodBad, handAt, playInfo, playShift, playsAt, playsOfLevel } from '../src/game/playbook';
import { TACTIC_LV_MAX } from '../src/game/tactics';
import { opponentSheet } from '../src/game/teams';

describe('the playbook', () => {
  it('every family has its first play from the start; the others come level by level, a play no better than its family', () => {
    for (const t of OFF_TYPES) expect(playsAt('off', 1, t)).toHaveLength(1);
    for (const t of DEF_TYPES) expect(playsAt('def', 1, t)).toHaveLength(1);
    for (const k of [...OFF_PLAY_KEYS, ...DEF_PLAY_KEYS]) {
      const p = playInfo(k);
      expect(p.lv).toBeGreaterThanOrEqual(1);
      expect(p.lv).toBeLessThanOrEqual(TACTIC_LV_MAX);
      expect(p.text.length, p.name).toBeLessThanOrEqual(40);
      // the shifts add up to about nothing: good against some calls, bad against others
      const sum = Object.values(p.vs).reduce((a, b) => a + (b ?? 0), 0);
      expect(Math.abs(sum), p.name).toBeLessThan(0.15);
      if (p.lv > 1) expect(Object.keys(p.vs).length, p.name).toBeGreaterThan(1);
      const gb = goodBad(k);
      expect(gb.good).not.toBe(gb.bad);
    }
    expect(Object.values(OFF_PLAYS).some((p) => p.name === 'スクリーンパス')).toBe(true);
    expect(Object.values(DEF_PLAYS).some((p) => p.name === 'ブリッツ')).toBe(true);
    for (let lv = 2; lv <= TACTIC_LV_MAX; lv += 1) expect(playsOfLevel(lv).length, `Lv${lv}`).toBeGreaterThan(0);
    expect(playShift('draw', undefined, 'inside', 'blitz')).toBeGreaterThan(0);
    expect(playShift(undefined, 'prevent', 'long', 'deep')).toBeLessThan(0);
  });

  it('eleven a side the hand is named plays of each team\'s level (a card more from level 3); six a side it is not', () => {
    for (const lv of [1, 3, 5]) {
      const home = { ...opponentSheet(1, 4), tacticLv: lv };
      const away = { ...opponentSheet(2, 4), tacticLv: 1 };
      const st = createMatch(home, away, 7);
      for (let i = 0; i < 20; i += 1) {
        st.poss = 0;
        deal(st);
        expect(st.hand.off).toHaveLength(handAt(lv));
        expect(st.hand.def).toHaveLength(handAt(1));
        for (const c of st.hand.off) {
          expect(c.play).toBeDefined();
          expect(playInfo(c.play!).base).toBe(c.type);
          expect(playInfo(c.play!).lv).toBeLessThanOrEqual(lv);
          expect(outlook(st, 0, c)).not.toBeNull();
        }
        // three different families, or four
        expect(new Set(st.hand.off.map((c) => c.type)).size).toBe(st.hand.off.length);
      }
    }
    const six = createMatch(opponentSheet(1, 0), opponentSheet(2, 0), 7);
    deal(six);
    expect(six.hand.off.every((c) => c.play === undefined)).toBe(true);
    expect(six.hand.off).toHaveLength(3);
  });
});
