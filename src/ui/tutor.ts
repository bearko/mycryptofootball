// The manager's lessons on the screen: she steps in front of whatever is shown and talks, a page per tap;
// then she steps aside and leaves a small note of what to do next, with a ring around the thing to press.
// What she says is game/tutorial.ts. A scene can be skipped (its gist is shown instead), and every scene can be
// heard again from the settings.

import { sfx, vibrate } from '../core/audio';
import { h } from '../core/dom';
import { commit, save } from '../core/save';
import type { Season } from '../game/season';
import {
  GISTS, LESSONS, SCENES, SCENE_NAME, endLessons, lessonDue, lessonOf, markLesson, skipScene, tutorOn, words,
  type Gist, type Page, type Scene, type TalkCtx,
} from '../game/tutorial';
import { playCard } from './cardView';
import { kick, motion } from './fx';
import { button, charPose, charTalk, closeModal, modal } from './kit';

export type Taught = 'done' | 'skipped' | 'none';

const touchy = (): boolean => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
/** how the first match went, for the words that depend on it */
const ctxOf = (s: Season | null): TalkCtx => ({ touch: touchy(), win: s?.results[0] ? s.results[0].win : true });

// ------------------------------------------------------------------ the ring and the note

let ringEl: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;
let target = '';
let raf = 0;

/** Keeps the ring (and the note beside it) on the thing it points at, wherever that moves. */
function follow(): void {
  raf = requestAnimationFrame(follow);
  const el = target ? document.querySelector<HTMLElement>(target) : null;
  const r = el?.getBoundingClientRect();
  const on = !!r && r.width > 0 && r.height > 0;
  if (ringEl) {
    ringEl.hidden = !on;
    if (on) {
      ringEl.style.left = `${r.left}px`;
      ringEl.style.top = `${r.top}px`;
      ringEl.style.width = `${r.width}px`;
      ringEl.style.height = `${r.height}px`;
    }
  }
  if (noteEl) {
    const w = noteEl.offsetWidth;
    const hh = noteEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // above the thing if there is room, else below it; something big carries the note on its upper edge.
    // With nothing to point at: top centre
    let x = vw / 2 - w / 2;
    let y = vh * 0.2;
    if (on) {
      x = Math.max(6, Math.min(vw - w - 6, r.left + r.width / 2 - w / 2));
      if (r.height > vh * 0.4) y = Math.max(4, r.top - hh * 0.5);
      else y = r.top - hh - 10 >= 4 ? r.top - hh - 10 : Math.min(vh - hh - 4, r.bottom + 10);
    }
    noteEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}

function point(sel: string | undefined, note: string | null): void {
  target = sel ?? '';
  ringEl?.remove();
  noteEl?.remove();
  ringEl = null;
  noteEl = null;
  cancelAnimationFrame(raf);
  if (!sel && !note) return;
  if (sel) {
    ringEl = h('div.tutor-ring', { 'aria-hidden': 'true', hidden: true });
    document.body.append(ringEl);
  }
  if (note) {
    noteEl = h('div.tutor-note', { role: 'status' }, h('img.px', { src: charPose('manager', 'point'), alt: '' }), h('span', note));
    document.body.append(noteEl);
  }
  follow();
}

/** Takes the note of what to do next away (it has been done). */
export function clearGoal(): void {
  if (!talking) point(undefined, null);
}

// ------------------------------------------------------------------ the talk

let talking: { close: () => void } | null = null;

/** Rich text: [[words]] highlighted; every letter its own span so the line can type itself in. */
function letters(text: string): { nodes: Node[]; chars: HTMLElement[] } {
  const nodes: Node[] = [];
  const chars: HTMLElement[] = [];
  for (const part of text.split(/(\[\[.*?\]\])/)) {
    const key = part.startsWith('[[');
    const made = [...(key ? part.slice(2, -2) : part)].map((ch) => h('i', ch));
    chars.push(...made);
    if (key) nodes.push(h('b.tutor-key', made));
    else nodes.push(...made);
  }
  return { nodes, chars };
}

interface TalkOpts {
  /** shown beside the skip button: which scene this is */
  scene: Scene;
  /** the last page closes with this word on the hint */
  last?: string;
}

/**
 * Shows the pages one tap at a time. Resolves 'read' when they were read to the end, 'skip' when the coach
 * pressed the skip button, 'closed' when the screen went away under her.
 */
function talk(pages: Page[], ctx: TalkCtx, opts: TalkOpts): Promise<'read' | 'skip' | 'closed'> {
  talking?.close();
  point(undefined, null);
  return new Promise((resolve) => {
    let i = 0;
    let timer = 0;
    let mouth = 0;
    let typing = false;
    let chars: HTMLElement[] = [];
    let shownAt = 0;
    const face = h('img.px', { src: charPose('manager'), alt: '', draggable: false });
    const text = h('p.tutor-text', { 'aria-live': 'polite' });
    const dots = h('span.tutor-dots', { 'aria-hidden': 'true' });
    const next = h('span.tutor-next', { 'aria-hidden': 'true' });
    const skip = button('スキップ', (e) => {
      e.stopPropagation();
      end('skip');
    }, { cls: 'mini alt', sound: 'back' });
    const box = h('div.tutor-box', { role: 'dialog', 'aria-label': `マネージャーの説明：${SCENE_NAME[opts.scene]}` },
      h('div.tutor-who', face),
      h('div.tutor-main', h('span.tutor-name', 'マネージャー', h('b', 'マイン')), text, h('div.tutor-foot', dots, next)),
      skip);
    const layer = h('div.tutor', box);
    const frames = charTalk('manager');

    const settle = (): void => {
      typing = false;
      clearTimeout(timer);
      clearInterval(mouth);
      for (const c of chars) c.classList.add('on');
      face.src = charPose('manager', pages[i]!.pose);
      box.classList.add('is-ready');
    };
    const show = (): void => {
      const pg = pages[i]!;
      const line = words(pg.text, ctx);
      const made = letters(line);
      chars = made.chars;
      text.replaceChildren(...made.nodes);
      dots.replaceChildren(...pages.map((_, k) => h('i', { class: k === i ? 'on' : k < i ? 'was' : '' })));
      next.textContent = i < pages.length - 1 ? (ctx.touch ? 'タップで次へ ▼' : 'クリックで次へ ▼') : (opts.last ?? (ctx.touch ? 'タップで閉じる ▼' : 'クリックで閉じる ▼'));
      box.classList.toggle('is-top', !!pg.top);
      box.classList.remove('is-ready');
      kick(box, 'is-page');
      point(pg.look, null);
      shownAt = performance.now();
      if (!motion()) {
        settle();
        return;
      }
      typing = true;
      let n = 0;
      let f = 0;
      mouth = window.setInterval(() => {
        f += 1;
        face.src = frames[f % frames.length] || charPose('manager', pg.pose);
      }, 130);
      const tick = (): void => {
        if (!typing) return;
        const c = chars[n];
        if (!c) {
          settle();
          return;
        }
        c.classList.add('on');
        if (n % 2 === 0 && c.textContent?.trim()) sfx.typeTick();
        n += 1;
        timer = window.setTimeout(tick, /[、。！？…]/.test(c.textContent ?? '') ? 110 : 24);
      };
      timer = window.setTimeout(tick, 60);
    };
    const advance = (): void => {
      // (a tap that was already on its way when the page came up does not count)
      if (performance.now() - shownAt < 180) return;
      if (typing) {
        settle();
        return;
      }
      sfx.tap();
      vibrate(8);
      if (i < pages.length - 1) {
        i += 1;
        show();
      } else end('read');
    };
    const onKey = (e: KeyboardEvent): void => {
      // while she talks, the keys are hers: nothing underneath is played by accident
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advance();
      } else if (e.key === 'Escape') end('skip');
    };
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      talking = null;
      clearTimeout(timer);
      clearInterval(mouth);
      typing = false;
      window.removeEventListener('keydown', onKey, true);
      point(undefined, null);
      layer.classList.add('is-out');
      setTimeout(() => layer.remove(), 160);
    };
    function end(how: 'read' | 'skip' | 'closed'): void {
      if (closed) return;
      close();
      resolve(how);
    }
    layer.addEventListener('click', advance);
    window.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    // closed from outside (the screen changes): what was not read is left for another time
    talking = { close: () => end('closed') };
    sfx.open();
    show();
  });
}

// ------------------------------------------------------------------ lessons

/**
 * Gives a lesson if it is due. 'done': read to the end (the note of what to do next is up); 'skipped': the coach
 * skipped the scene and has closed its gist; 'none': it was not due, nothing was shown.
 */
export async function teach(s: Season, id: string): Promise<Taught> {
  const lesson = lessonOf(id);
  if (!lesson || !lessonDue(s, id)) return 'none';
  const ctx = ctxOf(s);
  const how = await talk(lesson.pages, ctx, { scene: lesson.scene });
  // the screen was left while she talked: the lesson waits for the next visit
  if (how === 'closed') return 'none';
  if (how === 'read') {
    markLesson(s, id);
    commit();
    point(lesson.look, lesson.goal ? words(lesson.goal, ctx) : null);
    return 'done';
  }
  skipScene(s, lesson.scene);
  commit();
  await gist(lesson.scene, s);
  return 'skipped';
}

/** The picture beside a line of a gist: the real button, the real card, or a small mark. */
function gistPic(g: Gist): HTMLElement {
  const p = g.pic;
  if (!p) return h('span.gist-pic');
  if ('btn' in p) {
    const b = button(p.btn, () => undefined, { cls: `mini ${p.cls ?? ''}`, quiet: true });
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    return h('span.gist-pic.is-btn', b);
  }
  if ('card' in p) {
    const c = playCard({ type: p.card, star: 1 }, 'off', { small: true });
    c.tabIndex = -1;
    c.setAttribute('aria-hidden', 'true');
    return h('span.gist-pic.is-card', c);
  }
  return h('span.gist-pic.is-mark', h('i', p.mark));
}

/**
 * The gist of a scene, in a pop-up of its own (whatever pop-up the screen has open stays as it is underneath).
 * Resolves when it is closed. `s`: offer to end the lessons for good.
 */
function gist(scene: Scene, s: Season | null): Promise<void> {
  return new Promise((resolve) => {
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        done();
      }
    };
    let over = false;
    const done = (): void => {
      if (over) return;
      over = true;
      window.removeEventListener('keydown', onKey, true);
      layer.classList.add('closing');
      setTimeout(() => layer.remove(), 170);
      resolve();
    };
    const more = !!s && tutorOn(s);
    const layer = h('div.modal.gist-layer',
      h('div.modal-panel.gist-panel', { role: 'dialog', 'aria-label': `${SCENE_NAME[scene]}のまとめ` },
        h('div.modal-title', h('h2', `${SCENE_NAME[scene]}のまとめ`)),
        h('ul.gist', GISTS[scene].map((g, i) => h('li', { style: { '--i': String(i) } }, gistPic(g), h('span', g.text)))),
        h('div.modal-actions',
          more ? button('この先の説明もいらない', () => {
            endLessons(s);
            commit();
            done();
          }, { cls: 'mini alt', sound: 'back' }) : null,
          button('わかった', done, { cls: 'go' }))));
    window.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    sfx.open();
  });
}

/** Everything of a scene once more (from the settings): no ring to follow, nothing is marked. */
export async function replay(scene: Scene): Promise<void> {
  const s = save().season;
  const pages = LESSONS.filter((l) => l.scene === scene).flatMap((l) => l.pages).map((p) => ({ ...p, look: undefined, top: false }));
  if ((await talk(pages, ctxOf(s), { scene })) === 'skip') await gist(scene, null);
}

/** The list of scenes to hear again (opened from the settings). */
export function lessonsModal(): void {
  modal(h('div.lessons',
    h('p', 'マネージャーのマインが、もう一度説明します。聞きたい場面をえらんでください。'),
    h('div.lessons-list', SCENES.map((scene, i) => {
      const b = button(SCENE_NAME[scene], () => {
        closeModal();
        void replay(scene);
      }, { cls: 'alt' });
      b.style.setProperty('--i', String(i));
      return b;
    })),
    h('div.modal-actions', button('とじる', closeModal, { sound: 'back' }))), { title: 'チュートリアル' });
}

/** The screen is changing: whatever the manager was saying or pointing at goes away. */
export function closeTutor(): void {
  talking?.close();
  point(undefined, null);
}
