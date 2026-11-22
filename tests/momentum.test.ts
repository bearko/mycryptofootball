import { describe, expect, it } from 'vitest';
import { autoPick, resolvePlay } from '../src/game/match';
import { opponentSheet } from '../src/game/teams';
import { opened } from './open';

describe('momentum', () => {
  it('every gain says why (for the tag under the telop)', () => {
    let gains = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const st = opened(opponentSheet(1), opponentSheet(2), seed);
      for (let n = 0; n < 30 && !st.over && !st.ko; n += 1) {
        if (st.tfp) break;
        const res = resolvePlay(st, autoPick(st, st.poss), autoPick(st, (1 - st.poss) as 0 | 1));
        for (const t of [0, 1] as const) {
          if (res.momAfter[t] > res.momBefore[t]) {
            gains += 1;
            expect(res.momWhy[t]).not.toBe('');
          }
        }
      }
    }
    expect(gains).toBeGreaterThan(20);
  });
});
