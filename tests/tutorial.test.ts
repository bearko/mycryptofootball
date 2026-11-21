import { describe, expect, it } from 'vitest';
import { FIRST_MATCH } from '../src/game/match';
import { newSeason } from '../src/game/season';
import {
  END, GISTS, GIST_MAX, LESSONS, SCENES, SCENE_NAME, TALK_MAX, endLessons, lessonDue, lessonsOver, markLesson, plain, skipScene, tutorOn, words,
  type TalkCtx,
} from '../src/game/tutorial';

const CTXS: TalkCtx[] = [{ touch: true, win: true }, { touch: false, win: true }, { touch: true, win: false }, { touch: false, win: false }];
const pagesOf = (c: TalkCtx): string[] => LESSONS.flatMap((l) => l.pages.map((p) => words(p.text, c)));
const all = (): string => CTXS.flatMap(pagesOf).map(plain).join('\n');

describe('what the manager says', () => {
  it('a little at a time: every page is short, at most two sentences, polite, and speaks to the coach as 監督', () => {
    for (const c of CTXS) {
      for (const l of LESSONS) {
        // a lesson is a few pages, then the coach does something
        expect(l.pages.length).toBeGreaterThanOrEqual(1);
        expect(l.pages.length).toBeLessThanOrEqual(3);
        for (const p of l.pages) {
          const text = plain(words(p.text, c));
          expect(text.length, text).toBeLessThanOrEqual(TALK_MAX);
          expect(text.split(/[。！？…]+/).filter((x) => x.trim()).length, text).toBeLessThanOrEqual(2);
          // です・ます: a polite ending somewhere on every page, and no plain-form ones
          expect(/(だ|である|だよ|だね|だぞ)[。！]/.test(text), text).toBe(false);
          expect(/です|ます|ません|ました|ください|しょう/.test(text), text).toBe(true);
          // highlight marks come in pairs
          const raw = words(p.text, c);
          expect((raw.match(/\[\[/g) ?? []).length).toBe((raw.match(/\]\]/g) ?? []).length);
        }
        if (l.goal) expect(words(l.goal, c).length).toBeLessThanOrEqual(24);
      }
    }
    const text = all();
    expect(text).toContain('監督');
    expect(/あなた|きみ|プレイヤー/.test(text)).toBe(false);
  });

  it('tells the things a new coach has to know', () => {
    const text = all();
    // the world
    for (const must of ['マイン', '創部1年目', '6人制', '大会を勝ち抜く', '部員が増え', 'マイクリボウル', '全国大会の優勝']) expect(text, must).toContain(must);
    // the game on the field
    for (const must of ['前へ', '相手の陣地', 'ラン', 'パス', '3点', '6点', 'タッチダウン', 'キック']) expect(text, must).toContain(must);
    // what a run and a pass are good and bad at
    const m = LESSONS.filter((l) => l.scene === 'match').flatMap((l) => l.pages.map((p) => plain(words(p.text, CTXS[0]!)))).join('');
    expect(m).toContain('手がたく');
    expect(m).toContain('一気に');
    expect(m).toContain('うばわれ');
    // the numbers she quotes are the ones the story plays
    expect(m).toContain(`${FIRST_MATCH[1]!.yards}ヤード進みました`);
  });

  it('every scene has a name, lessons with ids of their own, and a gist of a few short lines', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    expect(LESSONS.some((l) => l.id === END)).toBe(false);
    for (const scene of SCENES) {
      expect(SCENE_NAME[scene].length).toBeGreaterThan(1);
      expect(LESSONS.some((l) => l.scene === scene)).toBe(true);
      const g = GISTS[scene];
      expect(g.length).toBeGreaterThanOrEqual(2);
      expect(g.length).toBeLessThanOrEqual(5);
      for (const line of g) {
        expect(line.text.length, line.text).toBeLessThanOrEqual(GIST_MAX);
        expect(line.text.length, line.text).toBeGreaterThanOrEqual(8);
      }
    }
    // the lessons come scene by scene, in the order of the week
    const order = LESSONS.map((l) => SCENES.indexOf(l.scene));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // the gists keep what matters when a scene is skipped
    const gist = Object.values(GISTS).flat().map((x) => x.text).join('\n');
    for (const must of ['創部1年目', '6人制', '大会を勝ち抜くと部員が増える', 'マイクリボウル', '前（相手の陣地）', 'ラン', 'パス', '3点', '6点']) expect(gist, must).toContain(must);
  });
});

describe('who is taught, and for how long', () => {
  it('only a club that was given lessons, in its first year, until the last one', () => {
    const s = newSeason(3);
    expect(tutorOn(s)).toBe(false);
    expect(lessonDue(s, 'r1')).toBe(false);
    markLesson(s, 'r1');
    skipScene(s, 'club');
    endLessons(s);
    expect(s.tut).toBeUndefined();
    expect(lessonsOver(s)).toBe(false);
    s.tut = [];
    expect(tutorOn(s)).toBe(true);
    expect(lessonDue(s, 'r1')).toBe(true);
    markLesson(s, 'r1');
    markLesson(s, 'r1');
    expect(s.tut).toEqual(['r1']);
    expect(lessonDue(s, 'r1')).toBe(false);
    expect(lessonDue(s, 'r2')).toBe(true);
    s.year = 2;
    expect(tutorOn(s)).toBe(false);
    s.year = 1;
    for (const l of LESSONS) markLesson(s, l.id);
    expect(lessonsOver(s)).toBe(true);
    expect(tutorOn(s)).toBe(false);
    expect(lessonDue(s, 'a1')).toBe(false);
  });

  it('skipping a scene drops its lessons and leaves the others; skipping the last one, or waving them all away, ends it', () => {
    const s = newSeason(3);
    s.tut = [];
    skipScene(s, 'recruit');
    expect(lessonDue(s, 'r1') || lessonDue(s, 'r2') || lessonDue(s, 'r3')).toBe(false);
    expect(lessonDue(s, 'c1')).toBe(true);
    expect(tutorOn(s)).toBe(true);
    skipScene(s, 'match');
    expect(lessonDue(s, 'm1')).toBe(false);
    expect(lessonDue(s, 'a1')).toBe(true);
    skipScene(s, 'after');
    expect(lessonsOver(s)).toBe(true);
    const t = newSeason(4);
    t.tut = [];
    endLessons(t);
    endLessons(t);
    expect(t.tut).toEqual([END]);
    expect(lessonDue(t, 'r1')).toBe(false);
  });
});
