import { describe, expect, it } from 'vitest';
import { callFor, type Beat } from '../src/game/calls';
import { autoPick, createMatch, resolvePlay } from '../src/game/match';
import { opponentSheet } from '../src/game/teams';
import { hero } from '../src/game/heroes';
import { PIECES, VOICE_BYTES } from '../src/core/voice/pieces';
import { PIECES_EN, VOICE_BYTES_EN } from '../src/core/voice/pieces-en';
import { setLang, tr } from '../src/core/i18n';
import { cut, fullNames, scramble } from '../src/core/voice/voice';

const BEATS: Beat[] = ['snap', 'handoff', 'throw', 'catch', 'drop', 'break', 'steal', 'touchdown', 'kick', 'end'];

describe("the announcer's voice", () => {
  it('cuts a line into the recorded pieces it is made of, names and numbers included', () => {
    const said = (t: string): string[] | undefined => cut(t)?.map((p) => PIECES[p]![0]);
    expect(said('タッチダウン！ マイクリ学園に6点')).toEqual(['タッチダウン！', 'マイクリ学園', 'に', '6点']);
    expect(said('ゴール前8ヤード、押しこめるか！')).toEqual(['ゴール前', '8ヤード', '、押しこめるか！']);
    // a line with words nobody recorded is not spoken
    expect(cut('こんにちは')).toBeNull();
    expect(cut('')).toBeNull();
    // the schools are said by their full names
    const t = [{ short: '白虎工', name: '白虎工業' }];
    expect(fullNames('白虎工のボール！ 白虎工業', t)).toBe('白虎工業のボール！ 白虎工業');
  });

  it('the packed pieces lie end to end, and scrambling twice gives the bytes back', () => {
    let at = 0;
    for (const [, o, n] of PIECES) {
      expect(o).toBe(at);
      expect(n).toBeGreaterThan(200);
      at += n;
    }
    expect(at).toBe(VOICE_BYTES);
    const b = new Uint8Array([1, 2, 3, 250]);
    expect([...scramble(scramble(b.slice(), 77), 77)]).toEqual([...b]);
  });

  it('the English announcer cuts at the edges of words', () => {
    const said = (t: string): string[] | undefined => cut(t, true)?.map((p) => PIECES_EN[p]![0]);
    expect(said('Touchdown!! Sarutobi Sasuke scores!')).toEqual(['Touchdown!!', 'Sarutobi Sasuke', 'scores!']);
    expect(said('7 yards to go! MyCrypto Academy goes for it!')).toEqual(['7', 'yards to go!', 'MyCrypto Academy', 'goes for it!']);
    // a word is not made of the start of another ("Kick" is no part of "Kickoff!")
    expect(cut('Hello there', true)).toBeNull();
    let at = 0;
    for (const [, o, n] of PIECES_EN) {
      expect(o).toBe(at);
      at += n;
    }
    expect(at).toBe(VOICE_BYTES_EN);
  });

  it('can say almost every call of real matches in English too', () => {
    setLang('en');
    try {
      let all = 0;
      const missed = new Map<string, number>();
      for (const league of [0, 2, 4, 6]) {
        for (let seed = 1; seed <= 12; seed += 1) {
          const home = opponentSheet(seed % 4, league);
          const away = opponentSheet((seed + 2) % 4, league);
          const st = createMatch(home, away, seed);
          const names = { teams: [home.short, away.short] as [string, string], hero: (id: number) => hero(id).name };
          while (!st.over) {
            const d = autoPick(st, (1 - st.poss) as 0 | 1);
            const res = resolvePlay(st, autoPick(st, st.poss, d), d);
            for (const b of BEATS) {
              const c = callFor(b, res, names, 'スラント');
              if (!c) continue;
              // as the match screen gives it: the shout and what follows, each put into English
              const line = [c.head, c.tail].filter((t): t is string => !!t).map((t) => tr(fullNames(t, [home, away]))).join(' ');
              all += 1;
              if (!cut(line, true)) missed.set(line, (missed.get(line) ?? 0) + 1);
            }
          }
        }
      }
      const miss = [...missed.values()].reduce((a, b) => a + b, 0);
      expect(miss / all, [...missed.keys()].slice(0, 12).join(' / ')).toBeLessThan(0.03);
    } finally {
      setLang('ja');
    }
  });

  it('can say almost every call of real matches, six a side and eleven', () => {
    let all = 0;
    const missed = new Map<string, number>();
    for (const league of [0, 2, 4]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const home = opponentSheet(seed % 4, league);
        const away = opponentSheet((seed + 2) % 4, league);
        const st = createMatch(home, away, seed);
        const names = { teams: [home.short, away.short] as [string, string], hero: (id: number) => hero(id).name };
        while (!st.over) {
          const d = autoPick(st, (1 - st.poss) as 0 | 1);
          const res = resolvePlay(st, autoPick(st, st.poss, d), d);
          for (const b of BEATS) {
            const c = callFor(b, res, names, 'スラント');
            if (!c) continue;
            const line = fullNames(c.tail ? `${c.head} ${c.tail}` : c.head, [home, away]);
            all += 1;
            if (!cut(line)) missed.set(line, (missed.get(line) ?? 0) + 1);
          }
        }
      }
    }
    const miss = [...missed.values()].reduce((a, b) => a + b, 0);
    expect(miss / all, [...missed.keys()].slice(0, 12).join(' / ')).toBeLessThan(0.03);
  });
});
