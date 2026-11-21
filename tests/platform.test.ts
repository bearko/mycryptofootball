import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveData } from '../src/core/save';
import { ROSTER_SIZE, newSeason, signRecruits, train } from '../src/game/season';
import { LESSONS, endLessons, lessonsOver, markLesson, skipScene } from '../src/game/tutorial';

type Sent = [number, string];
const g = globalThis as unknown as { window?: unknown };

/** a save as the game keeps it, with a club a new coach has just founded */
function fresh(guide = true): SaveData {
  const season = newSeason(11);
  if (guide) {
    season.guide = true;
    season.tut = [];
  }
  return { v: 1, season, match: null, mute: false, fast: false, prefs: {} as SaveData['prefs'], seasons: 0, titles: 0, helpSeen: false };
}

async function load(sdk: 'ok' | 'none' | 'broken'): Promise<{ p: typeof import('../src/ui/platform'); sent: Sent[]; inits: Record<string, unknown>[] }> {
  vi.resetModules();
  const sent: Sent[] = [];
  const inits: Record<string, unknown>[] = [];
  const api = {
    init: (o: Record<string, unknown>) => { inits.push(o); return Promise.resolve({ ok: true }); },
    tutorialStep: (step: number, id: string) => { if (sdk === 'broken') throw new Error('down'); sent.push([step, id]); return Promise.resolve({ ok: true }); },
    unlockTrophy: () => Promise.reject(new Error('not registered')),
    submitScore: () => Promise.resolve({ ok: false }),
    rta: { start: () => Promise.resolve({}), checkpoint: () => Promise.resolve({}), abort: () => undefined },
    chat: { open: () => undefined, setVisible: () => undefined },
  };
  g.window = { addEventListener: () => undefined, ...(sdk === 'none' ? {} : { BearkoGames: api }) };
  const p = await import('../src/ui/platform');
  p.startPlatform();
  return { p, sent, inits };
}

describe('the door to the shared platform', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('starts the SDK as this title, with the chat as a window that the game opens itself', async () => {
    const { inits, p } = await load('ok');
    expect(inits.length).toBe(1);
    expect(inits[0]!.game).toBe('football');
    expect(typeof inits[0]!.version).toBe('string');
    expect(inits[0]!.chat).toEqual({ layout: 'float', button: false });
    expect(inits[0]!.presence).toBeUndefined();
    expect(p.platformOn()).toBe(true);
  });

  it('reports the steps of a new coach\'s first week in order, each once; the last one when the lessons are over', async () => {
    const { p, sent } = await load('ok');
    const d = fresh();
    const s = d.season!;
    p.trackGuide(d);
    expect(sent).toEqual([[0, 'start']]);
    p.guideEvent(d, 'captain');
    p.guideEvent(d, 'captain');
    signRecruits(s, s.candidates.slice(0, ROSTER_SIZE));
    p.trackGuide(d);
    p.guideEvent(d, 'policy_done');
    s.event = null;
    train(s, 0);
    p.trackGuide(d);
    p.trackGuide(d);
    expect(sent.map((x) => x[1])).toEqual(['start', 'captain', 'recruit_done', 'policy_done', 'first_practice']);
    // the first match: it has begun when there is a saved match; the cards played are told by the screen
    s.day = 6;
    d.match = { n: 0, quarter: 3 } as SaveData['match'];
    p.trackGuide(d);
    p.guideEvent(d, 'first_play');
    p.guideEvent(d, 'second_play');
    p.guideEvent(d, 'first_td');
    d.match = null;
    s.results.push({ day: 6, opp: 0, us: 6, them: 3, win: true });
    s.day = 7;
    p.trackGuide(d);
    expect(sent.map((x) => x[1]).pop()).toBe('match_done');
    // the manager's last lesson
    for (const l of LESSONS) markLesson(s, l.id);
    expect(lessonsOver(s)).toBe(true);
    p.trackGuide(d);
    p.trackGuide(d);
    const ids = sent.map((x) => x[1]);
    expect(ids).toEqual(Object.keys(p.STEPS));
    // the numbers go up with the steps, within 0..99, and the last one is 'done'
    const nums = Object.values(p.STEPS);
    expect(sent.map((x) => x[0])).toEqual(nums);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    expect(nums[0]).toBe(0);
    expect(Math.max(...nums)).toBeLessThanOrEqual(99);
    expect(Object.keys(p.STEPS).pop()).toBe('done');
    for (const id of Object.keys(p.STEPS)) expect(/^[a-z0-9_-]{1,40}$/.test(id)).toBe(true);
  });

  it('a coach who waves the lessons away is done with the tutorial there and then', async () => {
    const { p, sent } = await load('ok');
    const d = fresh();
    p.trackGuide(d);
    skipScene(d.season!, 'recruit');
    p.trackGuide(d);
    expect(sent.map((x) => x[1])).toEqual(['start']);
    endLessons(d.season!);
    p.trackGuide(d);
    expect(sent.map((x) => x[1])).toEqual(['start', 'done']);
  });

  it('says nothing about a club that was not founded from the title, or about later years', async () => {
    const { p, sent } = await load('ok');
    const old = fresh(false);
    p.trackGuide(old);
    p.guideEvent(old, 'captain');
    const later = fresh();
    later.season!.year = 2;
    p.trackGuide(later);
    p.trackGuide({ ...fresh(), season: null });
    expect(sent).toEqual([]);
  });

  it('the game goes on when the SDK is missing or its calls fail', async () => {
    for (const sdk of ['none', 'broken'] as const) {
      const { p } = await load(sdk);
      const d = fresh();
      expect(() => {
        p.trackGuide(d);
        p.guideEvent(d, 'captain');
        p.unlockTrophy('x');
        p.submitScore({ a: 1 });
        p.rta.start('r');
        p.rta.checkpoint('c', 1);
        p.rta.abort();
        p.openChat();
      }).not.toThrow();
      expect(p.platformOn()).toBe(sdk === 'broken');
    }
    // no window at all (a test, a tool)
    vi.resetModules();
    delete g.window;
    const p = await import('../src/ui/platform');
    expect(() => {
      p.startPlatform();
      p.trackGuide(fresh());
    }).not.toThrow();
  });
});
