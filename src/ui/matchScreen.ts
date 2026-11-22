// The match, staged like a night-game broadcast: the stadium fills the screen, the scorebug floats on top,
// the hand of play cards slides in while you choose and gets out of the way while the play runs.
//
// One play = deal → huddle (the heroes say how their match-ups look) → choose → both cards clash →
// special cut-ins → the play itself (camera, hit-stop, sound in sync) → telop → scoreboard catches up.
//
// Choosing is two steps: looking at a card (the mouse over it, or a first tap) runs the play through on the turf
// in chalk and names the heroes it is about; a click, or a second tap on the same card, plays it.

import { crowd, duck, playBgm, sfx, vibrate } from '../core/audio';
import { debug, newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, loadMatch, prefs, save, storeMatch } from '../core/save';
import {
  DEF_INFO, DEF_TYPES, KICK_INFO, KIND, OFF_INFO, OFF_TYPES, READ_LABEL, isKick, isRun, type DefType, type OffType, type SpecialCard,
} from '../game/cards';
import { callFor, type Beat, type Call, type CallNames } from '../game/calls';
import { fullNames, hush, prefetchVoice, speak, warmVoice } from '../core/voice/voice';
import { hero } from '../game/heroes';
import {
  FG_POINTS, FIELD, MOM_MAX, PAT_POINTS, QUARTERS, TALKS, TALK_KEYS, TWO_POINTS, at, autoPick, autoTalk, bestAgainst, createMatch,
  createStory, dropStory, storyFresh, isEleven, playsPerQ, showtime,
  fgChance, halftimeTalk, huddle, keyHeroes, kickBlock, kickPicks, kickerOf, onsideChance, outlook, patChance, resolvePlay, senseHint, specialBlock, specialPick,
  usePeek, type Hint, type MatchState, type Pick, type PlayResult, type Voice,
} from '../game/match';
import { ROLE_LABEL, fit, kickFit, roleOf, sizeOf, type DefPos, type OffPos } from '../game/model';
import { clubSheet, finishMatch, labelOf, opponentFor, plan } from '../game/season';
import { cardBack, cardName, playCard } from './cardView';
import { burst, center, confetti, countUp, flash, kick, kinetic, motion, pop, shake, sparks } from './fx';
import { button, closeModal, modal, modalOpen, speech, sprite, ticker } from './kit';
import { route } from './nav';
import { changeList, settingsModal } from './shared';
import { fameReport } from './standing';
import { Stadium } from './stadium';
import { ROUTE_LABEL } from './stadium/choreo';
import { lessonDue } from '../game/tutorial';
import { guideEvent } from './platform';
import { clearGoal, teach } from './tutor';
import { factsOf, heroCard } from './heroCard';
import { showBracket } from './bracket';
import { duelCut, duelScore, duelTag, showDuels } from './duelView';
import { beasts, clubRecord, heroRecord } from '../game/duel';

const BLOCK_TEXT = { side: '', bench: '控えにいる', position: '位置が合わない', momentum: '流れ不足', fourth: '4回目だけ' } as const;

/** "QB", "LB"... and "K" for the kicker. */
const posLabel = (pos: OffPos | DefPos | 'K'): string => (pos === 'K' ? 'K' : ROLE_LABEL[roleOf(pos)]);

const hintText = (hint: Hint, onOffense: boolean): string => {
  if (hint === 'special') return '何か仕掛けてくる…！';
  if (hint === 'kick') return '相手は蹴ってくるぞ';
  if (onOffense) return hint === 'run' ? '相手はランを警戒してる' : hint === 'pass' ? '相手はパスを警戒してる' : '相手が突っこんでくる！';
  return hint === 'run' ? '相手はランの構えだ' : '相手はパスの構えだ';
};

interface Snap {
  score: [number, number]; mom: [number, number]; poss: 0 | 1; down: number; toGo: number; pos: number; quarter: number; left: number; sudden: boolean;
  tfp: boolean;
  ko: boolean;
}

export function matchScreen(): [HTMLElement, () => void] {
  const s = save().season!;
  const p = plan(s);
  if (p.t !== 'match') throw new Error('not a match day');
  // the spring's final and the autumn's (the one that counts)
  const isFinal = (p.cup && p.round === 3) || !!p.summit;
  playBgm(isFinal ? 'final' : 'match');
  crowd.start();

  const sheets = (): [typeof home, typeof away] => [clubSheet(s), opponentFor(s, p)];
  // a new coach's very first match is a told story (the manager's lessons: game/tutorial.ts)
  const told = s.results.length === 0 && lessonDue(s, 'm1');
  const st: MatchState = loadMatch() ?? (told ? createStory(...sheets(), newSeed()) : createMatch(...sheets(), newSeed()));
  storeMatch(st);
  const [home, away] = st.teams;
  /** The coach wants no story: an ordinary match from the first quarter if nothing has been played, else what is left of this one. */
  const leaveStory = (): void => {
    if (storyFresh(st)) {
      const plain = createMatch(...sheets(), newSeed());
      for (const k of Object.keys(st)) delete (st as unknown as Record<string, unknown>)[k];
      Object.assign(st, plain);
    } else dropStory(st);
    storeMatch(st);
    // (an ordinary first match: the booth gives its two short tips)
    taughtOff = false;
    taughtDef = false;
  };
  /** the manager's lesson that goes with the story's next play, and the one card it asks for */
  const storyStep = (): { lesson: string; only?: OffType } | null => {
    if (!st.script) return null;
    if (storyFresh(st)) return { lesson: 'm1' };
    if (st.ko) return { lesson: 'm2' };
    return ({ 5: { lesson: 'm3', only: 'inside' }, 4: { lesson: 'm4', only: 'short' }, 3: { lesson: 'm5' } } as Record<number, { lesson: string; only?: OffType }>)[st.script.length] ?? null;
  };
  /** cards the coach has played in this match (the first ones are steps of the tutorial) */
  let called = 0;
  const firstEver = save().seasons === 0 && s.results.length === 0 && !st.script;
  let taughtOff = !firstEver;
  let taughtDef = !firstEver;
  let alive = true;
  let busy = true;
  let skip: (() => void) | null = null;
  const speed = (): number => (debug.bot ? 12 : save().fast ? 2 : 1);
  /**
   * Eleven a side the coach may call only the big moments (the setting chosen before the match): the other plays are
   * called for him and run quickly. A time-out stops the match for one play of his choosing.
   */
  const flowing = (): boolean => isEleven(st) && prefs().calls !== 'all' && !st.script && !debug.bot;
  const TIMEOUTS = 3;
  /** time-outs left in this half */
  let timeouts = TIMEOUTS;
  /** a time-out has been called: the next play is the coach's */
  let stopNext = false;

  // ------------------------------------------------------------------ skeleton
  const canvas = h('canvas.stadium');
  const bug = h('header.bug');
  const map = h('div.minimap');
  const huddleEl = h('aside.huddle', { 'aria-live': 'polite' });
  // the play-by-play: shouted lines stack up on the right while a play runs
  const casterEl = h('aside.caster', { 'aria-live': 'off' });
  const names: CallNames = { teams: [home.short, away.short], hero: (id) => hero(id).name };
  /** the play being shown runs itself (called for the coach): only its big moments are spoken */
  let quickPlay = false;
  /** a call as it is spoken: head and tail, and the schools by their full names */
  const lineOf = (c: Call): string => fullNames(c.tail ? `${c.head} ${c.tail}` : c.head, [home, away]);
  const shout = (c: Call | null, off: 0 | 1): void => {
    if (!c) return;
    if (!debug.bot && (!quickPlay || c.hot)) speak(lineOf(c), { hot: c.hot });
    for (const old of casterEl.children) old.classList.add('old');
    while (casterEl.children.length > 2) casterEl.firstElementChild!.remove();
    const mine = c.side === 'none' ? '' : (c.side === 'off') === (off === 0) ? 'mine' : 'theirs';
    casterEl.append(h('div.call', { class: `${c.hot ? 'hot' : ''} ${mine}` }, h('b', c.head), c.tail ? h('span', c.tail) : null));
  };
  const keyTags = h('div.keytags', { 'aria-hidden': 'true' });
  /** the heroes the considered card is about, and their tags on the field */
  let keys3: { id: number; el: HTMLElement }[] = [];
  const touchy = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
  /** a gain of this many yards is shown once more */
  const BIG_PLAY = 15;
  const booth = speech('announcer');
  booth.el.classList.add('booth');
  // the booth speaks too, when the voice is free (between plays)
  {
    const say = booth.say;
    booth.say = (line, p) => {
      if (!debug.bot && !quickPlay) speak(fullNames(line, [home, away]), { quiet: true });
      return say(line, p);
    };
  }
  warmVoice();
  const stage = h('div.stage');
  const hand = h('footer.hand');
  const clutch = h('div.clutch-frame', { 'aria-hidden': 'true' }, h('span', '勝負どころ'), h('span', '勝負どころ'));
  /** a hero's scouting sheet, beside him on the field (heroCard.ts) */
  const peekEl = h('div.hcard-layer', { 'aria-live': 'polite' });
  // while the match runs itself: what is going on, and the time-out
  const timeoutBtn = h('button.flow-to', { type: 'button', onclick: () => callTimeout() });
  const flowBar = h('div.flowbar', h('span.flow-tag', h('i', { 'aria-hidden': 'true' }), 'おまかせ進行中'), timeoutBtn);
  const drawFlow = (): void => {
    timeoutBtn.classList.toggle('is-set', stopNext);
    timeoutBtn.disabled = !stopNext && timeouts <= 0;
    timeoutBtn.replaceChildren(h('b', stopNext ? '次は指示する' : 'タイムアウト'), h('span.flow-left', { 'aria-label': `のこり${timeouts}回` }, '●'.repeat(timeouts) + '○'.repeat(TIMEOUTS - timeouts)));
  };
  const callTimeout = (): void => {
    if (stopNext || timeouts <= 0 || !alive) return;
    timeouts -= 1;
    stopNext = true;
    sfx.whistle('short');
    vibrate(16);
    booth.say('タイムアウト！ 次のプレーは監督が指示します', 'guts');
    drawFlow();
  };
  drawFlow();
  const root = h('div.screen.match', canvas, h('div.shade', { 'aria-hidden': 'true' }), clutch, bug, keyTags, huddleEl, casterEl, stage, hand, booth.el, flowBar, peekEl);
  const stadium = new Stadium(canvas, [home, away]);
  stadium.setMotion(save().prefs.motion);

  const insets = (open: boolean): void => {
    const top = bug.getBoundingClientRect().height;
    const bottom = open ? hand.getBoundingClientRect().height : root.getBoundingClientRect().height * 0.06;
    stadium.setSafeArea(top, bottom);
  };

  /** Waits (scaled by the speed setting), unless the screen is tapped. */
  const pause = (ms: number): Promise<void> => new Promise((resolve) => {
    const timer = setTimeout(() => {
      skip = null;
      resolve();
    }, ms / speed());
    skip = () => {
      clearTimeout(timer);
      skip = null;
      resolve();
    };
  });
  /** set by the turn in progress: puts a considered card back */
  let unconsider: () => void = () => undefined;
  stage.addEventListener('click', () => skip?.());

  // ------------------------------------------------------------------ a hero's sheet
  // Between plays, a hero on the field shows his sheet: under the mouse, or tapped (tap him again, or anywhere
  // else, and it goes). While a play runs the field is for skipping, and the sheet stays shut.
  let sheet: { team: 0 | 1; id: number } | null = null;
  let hoverTimer = 0;
  const heroUnder = (e: { clientX: number; clientY: number }, slack: number): { team: 0 | 1; id: number } | null => {
    const r = canvas.getBoundingClientRect();
    return stadium.heroAt(e.clientX - r.left, e.clientY - r.top, slack);
  };
  const closePeek = (): void => {
    clearTimeout(hoverTimer);
    if (!sheet) return;
    sheet = null;
    stadium.mark(null);
    const old = peekEl.firstElementChild as HTMLElement | null;
    if (old) {
      old.classList.add('out');
      setTimeout(() => old.remove(), 150);
    }
  };
  const openPeek = (who: { team: 0 | 1; id: number }): void => {
    if (sheet && sheet.team === who.team && sheet.id === who.id) return;
    peekEl.replaceChildren();
    sheet = who;
    stadium.mark(who);
    const card = heroCard(factsOf({
      team: st.teams[who.team], mine: who.team === 0, id: who.id, members: s.members, season: s.box, match: st.box?.[who.team], booked: false,
    }, heroRecord(st.duels, who.team, who.id)));
    peekEl.append(card);
    placePeek();
    sfx.tap();
  };
  /** keeps the sheet beside its hero, on whichever side has room */
  const placePeek = (): void => {
    const card = peekEl.firstElementChild as HTMLElement | null;
    if (!sheet || !card) return;
    const pos = stadium.screenPos(sheet.team, sheet.id);
    if (!pos) {
      closePeek();
      return;
    }
    const W = root.clientWidth;
    const H = root.clientHeight;
    const w = card.offsetWidth;
    const hh = card.offsetHeight;
    const gap = Math.max(12, pos.h * 0.42);
    const right = pos.x + gap + w <= W - 8 && (pos.x < W * 0.55 || pos.x - gap - w < 8);
    const x = right ? pos.x + gap : pos.x - gap - w;
    const top = bug.getBoundingClientRect().height + 4;
    const y = Math.max(top, Math.min(H - hh - 6, pos.y - pos.h * 0.6 - hh * 0.35));
    card.style.transform = `translate(${Math.round(Math.max(6, x))}px, ${Math.round(y)}px)`;
    card.classList.toggle('on-left', !right);
  };
  // the sheets are for the huddle, while the coach chooses his card: once the play is on, the field is the play's
  const canPeek = (): boolean => alive && !skip && !modalOpen() && hand.classList.contains('in');
  new MutationObserver(() => {
    if (!hand.classList.contains('in')) {
      clearTimeout(hoverTimer);
      closePeek();
    }
  }).observe(hand, { attributes: true, attributeFilter: ['class'] });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const who = canPeek() ? heroUnder(e, 0) : null;
    clearTimeout(hoverTimer);
    if (!who) {
      if (sheet) hoverTimer = window.setTimeout(closePeek, 160);
      return;
    }
    if (sheet && sheet.team === who.team && sheet.id === who.id) return;
    hoverTimer = window.setTimeout(() => canPeek() && openPeek(who), sheet ? 60 : 140);
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(closePeek, 160);
    }
  });
  canvas.addEventListener('click', (e) => {
    if (skip) {
      skip();
      return;
    }
    if (!canPeek()) return;
    // a finger gets a little room around the hero
    const who = heroUnder(e, touchy ? 14 : 0);
    if (!who) closePeek();
    else if (touchy && sheet && sheet.team === who.team && sheet.id === who.id) closePeek();
    else openPeek(who);
  });
  // a finger anywhere but on a card, a button or a hero puts a considered card back (and closes a sheet)
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || skip) return;
    const onField = e.target === canvas && !!heroUnder(e, 14);
    if (!onField && !(e.target as HTMLElement).closest?.('.card, .btn, button')) unconsider();
    if (e.target !== canvas) closePeek();
  });

  // ------------------------------------------------------------------ scorebug
  const snap = (): Snap => ({
    score: [...st.score] as [number, number], mom: [...st.mom] as [number, number], poss: st.poss, down: st.down, toGo: st.toGo,
    pos: st.pos, quarter: st.quarter, left: st.left, sudden: st.sudden, tfp: !!st.tfp, ko: !!st.ko,
  });
  let shown: Snap | null = null;
  const scoreEls: HTMLElement[] = [];
  const flames = (n: number, was: number): HTMLElement =>
    h('span.flames', { title: `流れ ${n}/${MOM_MAX}` }, Array.from({ length: MOM_MAX }, (_, i) => h('i.flame', { class: i < n ? (i >= was ? 'on new' : 'on') : '' })));

  const drawBug = (v: Snap): void => {
    const prev = shown;
    shown = v;
    const team = (t: 0 | 1): HTMLElement => {
      const score = h('b.led.bug-score', String(prev ? prev.score[t] : v.score[t]));
      scoreEls[t] = score;
      const threats = t === 1 ? away.specials.filter((sp) => (KIND[sp.kind].side === 'off') === (v.poss === 1)) : [];
      return h('div.bug-team', { class: `${t === 0 ? 'home' : 'away'} ${v.poss === t ? 'has' : ''}`, style: { '--team': st.teams[t].color } },
        h('span.bug-name', h('i.bug-ball', { 'aria-hidden': 'true' }), st.teams[t].short),
        score,
        h('span.bug-mom', h('em', '流れ'), flames(v.mom[t], prev ? prev.mom[t] : v.mom[t])),
        t === 0 ? duelScore(st) : null,
        threats.length ? h('span.threats', threats.map((sp) => h('i', {
          class: specialBlock(st, 1, sp) === null ? 'armed' : '',
          title: `${hero(sp.owner).name}「${sp.name}」${KIND[sp.kind].tag}／こちらの読み：${READ_LABEL[st.read[1][sp.key] ?? 0]}`,
        }, sprite(sp.owner), h('u', KIND[sp.kind].tag)))) : null);
    };
    const toGoal = FIELD - v.pos;
    const plays = Array.from({ length: playsPerQ(st) }, (_, i) => h('i', { class: i < v.left ? 'on' : '' }));
    bug.replaceChildren(
      team(0),
      h('div.bug-mid',
        h('div.bug-clock', v.sudden ? h('b.hot', '延長') : h('b', `第${v.quarter}Q`), v.sudden ? h('span', '次の1点で決着') : h('span.plays', { class: plays.length > 7 ? 'is-long' : '' }, plays)),
        v.ko ? h('div.bug-down', h('b', 'キックオフ'))
          : v.tfp
          // the try after a touchdown: no downs, one chance
          ? h('div.bug-down.late', h('span.downs', h('i.now.tfp', 'TFP')), h('b', `キック${PAT_POINTS}点・プレー${TWO_POINTS}点`))
          : h('div.bug-down', { class: v.down >= 3 ? 'late' : '' },
            h('span.downs', [1, 2, 3, 4].map((n) => h('i', { class: n < v.down ? 'used' : n === v.down ? 'now' : '' }, String(n)))),
            h('b', v.toGo >= toGoal ? `ゴールまで${toGoal}` : `あと${v.toGo}`), h('span', 'ヤード')),
        map),
      team(1),
      h('div.bug-tools', button('設定', settingsModal, { cls: 'mini alt' })));
    // the little map of the whole field: where the ball is and how far it has to go
    const x = (u: number): number => (v.poss === 0 ? u : FIELD - u) / FIELD * 100;
    map.replaceChildren(
      h('i.map-end.home', { style: { background: home.color } }), h('i.map-end.away', { style: { background: away.color } }),
      ...(v.ko ? [] : [h('i.map-go', { style: { left: `${Math.min(x(v.pos), x(Math.min(FIELD, v.pos + v.toGo)))}%`, width: `${Math.abs(x(Math.min(FIELD, v.pos + v.toGo)) - x(v.pos))}%` } })]),
      h('i.map-ball', { class: v.poss === 0 ? 'right' : 'left', style: { left: `${x(v.pos)}%`, '--team': st.teams[v.poss].color } }));
    // scores count up, new momentum announces itself
    ([0, 1] as const).forEach((t) => {
      if (prev && prev.score[t] !== v.score[t]) {
        kick(scoreEls[t]!, 'bump');
        void countUp(scoreEls[t]!, prev.score[t], v.score[t], 700, String, () => sfx.countTick());
      }
      if (prev && v.mom[t] > prev.mom[t] && t === 0) sfx.momentum(v.mom[t]);
    });
  };

  /**
   * Momentum gained: flames fly from where it was said (the telop) to the scoreboard, and each lights the flame it
   * lands on; the gauge flares and says how much. Without motion they just light.
   */
  const flyFlames = (from: HTMLElement, t: 0 | 1, was: number, n: number): void => {
    const side = bug.querySelector<HTMLElement>(`.bug-team.${t === 0 ? 'home' : 'away'} .bug-mom`);
    const targets = [...(side?.querySelectorAll<HTMLElement>('.flame') ?? [])].slice(was, was + n);
    if (!side || !targets.length) return;
    side.append(h('span.mom-plus', `+${n}`));
    kick(side, 'is-gain');
    const a = from.querySelector('.flame')?.getBoundingClientRect();
    if (!a || !a.width || !motion() || debug.bot) return;
    targets.forEach((f, i) => {
      f.classList.add('wait');
      const b = f.getBoundingClientRect();
      const x0 = a.left + a.width / 2;
      const y0 = a.top + a.height / 2;
      const dx = b.left + b.width / 2 - x0;
      const dy = b.top + b.height / 2 - y0;
      const fly = h('i.flame.on.mom-fly', { style: { left: `${x0}px`, top: `${y0}px` } });
      document.body.append(fly);
      const anim = fly.animate([
        { transform: 'translate(0, 0) rotate(-45deg) scale(1.8)' },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 50}px) rotate(-45deg) scale(1.5)`, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) rotate(-45deg) scale(1)` },
      ], { duration: 620, delay: 150 + i * 130, easing: 'cubic-bezier(0.45, 0, 0.6, 1)', fill: 'backwards' });
      const land = (): void => {
        fly.remove();
        f.classList.remove('wait');
        f.classList.add('ignite');
        const r = f.getBoundingClientRect();
        if (r.width) burst(r.left + r.width / 2, r.top + r.height / 2, { count: 9, color: ['#ffe14a', '#ff7a2e', '#fffbe8'], shape: ['star', 'rect'] });
        if (t === 0) sfx.cardPick();
      };
      anim.onfinish = land;
      anim.oncancel = land;
    });
  };

  const mood = (): number => {
    const close = Math.abs(st.score[0] - st.score[1]) <= 7 ? 0.2 : 0;
    const late = st.quarter >= QUARTERS ? 0.2 : st.quarter >= 3 ? 0.1 : 0;
    return Math.min(1, 0.25 + Math.max(st.mom[0], st.mom[1]) * 0.07 + close + late + (FIELD - st.pos <= 12 ? 0.15 : 0));
  };
  const isClutch = (): boolean => !st.tfp && !st.ko && (st.down >= 3 || FIELD - st.pos <= 10 || (st.quarter >= QUARTERS && st.left <= 3) || st.sudden);

  // ------------------------------------------------------------------ history (what each side has been calling)
  const history: { mine: boolean; name: string; result: string; special: boolean; good: boolean }[] = [];
  const historyEl = (): HTMLElement => h('ol.hand-log', history.length
    ? history.slice(0, 4).map((it) => h('li', { class: `${it.mine ? 'mine' : 'theirs'} ${it.good ? 'good' : ''}` },
      h('i', it.mine ? '自' : '敵'), h('span', { class: it.special ? 'sp' : '' }, it.name), it.result ? h('b', it.result) : null))
    : h('li.none', '両チームの作戦がここに並びます。相手のくせを読もう'));

  // ------------------------------------------------------------------ one turn
  let keys: (e: KeyboardEvent) => void = () => undefined;
  let readyKeys = new Set<string>();

  const turn = (): void => {
    if (!alive) return;
    if (st.over) {
      casterEl.replaceChildren();
      void finish();
      return;
    }
    closePeek();
    stadium.setScene(st);
    // a hero who cannot be stopped burns on the field
    stadium.setBeasts(beasts(st.duels));
    drawBug(snap());
    stage.replaceChildren();
    // the play is over: the play-by-play clears the right side for the huddle
    casterEl.replaceChildren();
    // the told story: the manager speaks before what happens by itself (their kick, the kickoff)
    const step = storyStep();
    if (step && !step.only && step.lesson !== 'm5' && lessonDue(s, step.lesson)) {
      hand.classList.remove('in');
      busy = true;
      void teach(s, step.lesson).then((how) => {
        if (!alive || how === 'none') return;
        if (how === 'skipped') leaveStory();
        turn();
      });
      return;
    }
    const onOffense = st.poss === 0;
    const side = onOffense ? 'off' : 'def';
    const hot = isClutch();
    root.classList.toggle('clutch', hot);
    crowd.tension(hot);
    crowd.setMood(mood());
    stadium.setExcitement(mood());
    // the opponent chooses first, hidden; a sharp hero may sense what is coming
    const theirs = autoPick(st, 1);
    const ko = !!st.ko;
    const hint = ko ? null : senseHint(st, 0, theirs);
    const readerPos = onOffense ? 'QB' : 'S';
    const reader = at(home, readerPos).id;
    const voices = huddle(st, 0);
    const tfp = !!st.tfp;
    // a kickoff just happens, too: theirs always, ours unless there is something to decide (behind, late: the short kick)
    if (ko && (!onOffense || kickPicks(st, 0).length < 2)) {
      hand.classList.remove('in');
      booth.say(onOffense ? `${home.short}のキックオフです` : `${away.short}のキックオフ。しっかり受けて、前へ戻しましょう`, 'idle');
      busy = true;
      void playOut(onOffense ? { type: 'kickoff', star: 1 } : theirs, { type: 'zone', star: 1 });
      return;
    }
    // in the told story nobody calls the defense: their kick just happens
    if (st.script && !onOffense && isKick(theirs.type)) {
      hand.classList.remove('in');
      booth.say(`${away.short}がフィールドゴールをねらいます！`, 'idle');
      busy = true;
      void playOut(theirs, { type: 'zone', star: 1 });
      return;
    }
    // the other team kicks for its extra point: there is nothing to choose, the kick just happens
    if (tfp && !onOffense && isKick(theirs.type)) {
      hand.classList.remove('in');
      booth.say(`${away.short}はキックで${PAT_POINTS}点を取りにきます`, 'idle');
      busy = true;
      void playOut(theirs, { type: 'zone', star: 1 });
      return;
    }
    // only the big moments are the coach's: this one is called for him and runs quickly (a time-out stops it)
    if (flowing() && !ko && !stopNext && !showtime(st)) {
      hand.classList.remove('in');
      busy = true;
      const mine = autoPick(st, 0, theirs, true);
      void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine, true);
      return;
    }
    stopNext = false;
    flowBar.classList.remove('on');
    drawFlow();
    let selected: Pick | null = null;
    let peeked: null | { ok: boolean } = null;
    let cards: Pick[] = [];
    let dealt = false;
    /** the told story asks for one card: the others wait their turn */
    const only = onOffense && !ko ? step?.only : undefined;
    const lockOf = (c: Pick): boolean => !!only && c.type !== only;

    const theirName = (): string => cardName(theirs, onOffense ? 'def' : 'off');
    const prompt = (): void => {
      if (ko) booth.say('負けています。遠くへ蹴るか、オンサイドキックでボールを取り返しにいくか、えらべます', 'guts');
      else if (peeked) booth.say(peeked.ok ? `見えた！ 相手は「${theirName()}」です！` : 'うーん、読めませんでした…。でも好きな作戦をえらべます', peeked.ok ? 'sparkle' : 'sad');
      else if (tfp && onOffense) booth.say(kickerOf(home) ? `タッチダウンのあとの追加点！ キックなら${PAT_POINTS}点、プレーで押しこめば${TWO_POINTS}点` : `追加点のチャンス！ キッカーがいないので、プレーで${TWO_POINTS}点をねらいます`, 'guts');
      else if (tfp) booth.say(`${away.short}が${TWO_POINTS}点をねらってきます。ここを止めましょう！`, 'guts');
      else if (onOffense && !taughtOff) booth.say('攻撃です！ カードの◎は得意な相手、×は苦手な相手。相手の守りを予想してえらびましょう', 'wave');
      else if (!onOffense && !taughtDef) booth.say('守備です！ 相手の作戦を予想して止めましょう。4回で10ヤード進ませなければ交代です', 'wave');
      else if (hot) booth.say(onOffense ? `ここが勝負どころ！ ${st.down}回目、あと${st.toGo}ヤード！` : `止めれば流れが来ます！ ${st.down}回目、あと${st.toGo}ヤード`, 'guts');
      else booth.say(onOffense ? `${st.down}回目の攻撃、あと${st.toGo}ヤード。さあ、どう攻める？` : `${away.short}の攻撃、${st.down}回目。さあ、どう守る？`, 'idle');
    };
    // the huddle: what the heroes on the field think of their match-ups (and what a sharp one senses is coming)
    const voiceRow = (v: Voice | null, k: number): HTMLElement => {
      const read = v === null;
      const id = read ? reader : v.id;
      const pos = read ? readerPos : v.pos;
      const iq = read ? at(home, readerPos).stats.iq : v.iq;
      const trust = iq >= 75 ? 3 : iq >= 50 ? 2 : 1;
      return h('div.voice', {
        class: read ? 'is-read' : `is-${v.tone}`, style: { '--i': String(k) },
        data: read ? {} : { topic: v.topic === 'gap' ? v.points ?? '' : v.topic },
        title: `判断 ${iq}。判断が高いヒーローほど、言うことが当たる`,
      },
      sprite(id),
      h('span.voice-who', h('b', posLabel(pos)), hero(id).name.split('・').pop()!,
        h('i.voice-iq', { class: `iq${trust}` }, '判断', h('u', '●'.repeat(trust) + '○'.repeat(3 - trust)))),
      h('span.voice-text', read ? hintText(hint, onOffense) : v.text));
    };
    const showHuddle = (): void => {
      // (nothing to weigh before a kickoff, and in the told story the manager does the talking)
      if (peeked || ko || st.script) {
        huddleEl.replaceChildren();
        return;
      }
      const rows = [...(hint ? [voiceRow(null, 0)] : []), ...voices.map((v, k) => voiceRow(v, k + (hint ? 1 : 0)))];
      huddleEl.replaceChildren(h('b.huddle-head', 'ハドル'), ...rows);
      rows.forEach((_, k) => setTimeout(() => alive && !busy && sfx.chalk(), 120 + k * 260));
    };
    /** Lights the remarks that are about the play being looked at. */
    const markVoices = (pick: Pick | null): void => {
      const type = pick ? (pick.special ? KIND[pick.special.kind].base : pick.type) : '';
      // a defensive call is about the plays it is meant to stop
      const about: string[] = !pick ? [] : isKick(pick.type) ? ['kick'] : onOffense ? [type]
        : ({ stuff: ['inside'], contain: ['outside'], zone: ['short'], deep: ['long'], blitz: ['long', 'inside'] } as Record<string, string[]>)[type] ?? [];
      for (const el of huddleEl.querySelectorAll<HTMLElement>('.voice')) el.classList.toggle('is-rel', about.includes(el.dataset.topic ?? '-'));
    };
    /** Names the heroes a card is about, on the field. */
    const showKeys = (pick: Pick | null): number[] => {
      const list = pick ? keyHeroes(st, 0, pick) : [];
      keys3 = list.map((k, n) => ({
        id: k.id,
        el: h('div.keytag', { class: n === 0 ? 'is-lead' : '', style: { '--i': String(n) } },
          h('div.keytag-in', n === 0 ? h('em', '主役') : null,
            h('b', posLabel(k.pos)), h('span', hero(k.id).name.split('・').pop()!),
            h('i', String(Math.round(k.pos === 'K' ? kickFit(kickerOf(home)!.stats) : fit(at(home, k.pos).stats, roleOf(k.pos))))))),
      }));
      keyTags.replaceChildren(...keys3.map((k) => k.el));
      return list.map((k) => k.id);
    };

    /** Plays a card. (A "look first" special shows the opponent's card and asks once more.) */
    const playCardNow = (mine: Pick): void => {
      if (busy) return;
      busy = true;
      clearGoal();
      called += 1;
      if (s.results.length === 0 && called <= 2) guideEvent(save(), called === 1 ? 'first_play' : 'second_play');
      unconsider = () => undefined;
      showKeys(null);
      if (mine.special && (mine.special.kind === 'peekOff' || mine.special.kind === 'peekDef')) {
        void runPeek(mine.special);
        return;
      }
      if (onOffense) taughtOff = true;
      else taughtDef = true;
      void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine);
    };

    /** A "look first" special: the hero's moment, then the opponent's card is (maybe) turned over. */
    const runPeek = async (sp: SpecialCard): Promise<void> => {
      const ok = usePeek(st, 0, sp);
      root.classList.add('cine');
      await cutIn(sp, 0, ok ? 1 : 0.2, ok ? '見抜いた！' : '読めない…');
      root.classList.remove('cine');
      peeked = { ok };
      drawBug(snap());
      selected = null;
      stadium.preview(null, side, 0);
      dealt = false;
      showHuddle();
      if (ok) {
        const card = playCard(theirs, onOffense ? 'def' : 'off', { small: true });
        stage.replaceChildren(h('div.revealed', h('span.label.hot', `${away.short}の作戦`), card));
        sfx.cardFlip();
      }
      busy = false;
      drawHand();
      prompt();
    };

    /**
     * Looking at a card (the mouse over it, or a first tap): the play runs itself on the turf in chalk,
     * the heroes it is about are named, and the remarks from the huddle that concern it light up.
     */
    const consider = (pick: Pick | null, el?: HTMLElement): void => {
      if (busy || selected === pick) return;
      selected = pick;
      for (const c of hand.querySelectorAll('.card.selected')) c.classList.remove('selected');
      const stars = showKeys(pick);
      stadium.preview(pick, side, 0, stars);
      markVoices(pick);
      hand.classList.toggle('is-looking', !!pick);
      if (!pick) return;
      el?.classList.add('selected');
      sfx.cardPick();
      if (pick.special) booth.say(`${hero(pick.special.owner).name}の「${pick.special.name}」！ ${KIND[pick.special.kind].text}`, 'sparkle');
      else if (isKick(pick.type)) booth.say(`${KICK_INFO[pick.type].name}。${KICK_INFO[pick.type].text}`, 'idle');
      else {
        const info = onOffense ? OFF_INFO[pick.type as OffType] : DEF_INFO[pick.type as DefType];
        booth.say(`${info.name}。${info.text}`, 'idle');
      }
    };
    unconsider = () => consider(null);

    const drawHand = (): void => {
      const basics: Pick[] = ko ? [] : peeked
        ? (onOffense ? OFF_TYPES : DEF_TYPES).map((type) => cards.find((c) => c.type === type && c.peeked) ?? { type, star: 2, peeked: true })
        : (onOffense ? st.hand.off : st.hand.def);
      const specials = peeked || ko || st.script ? [] : home.specials.filter((sp) => KIND[sp.kind].side === side);
      // kicks: only with a kicker, only with the ball (after a touchdown: the kick for one point)
      const kicks = kickPicks(st, 0).map((k) => cards.find((c) => c.type === k.type) ?? k);
      cards = [...basics, ...kicks, ...specials.map((sp) => cards.find((c) => c.special === sp) ?? specialPick(sp))];
      const firstDeal = !dealt;
      dealt = true;
      const nowReady = new Set<string>();
      const els = cards.map((c, i) => {
        const far = isKick(c.type) ? kickBlock(st, 0, c.type) : null;
        const block = c.special ? specialBlock(st, 0, c.special) : far ? 'position' : lockOf(c) ? 'side' : null;
        const pct = (v: number): string => `成功 ${Math.round(v * 100)}%`;
        const note = c.type === 'fg' ? [`${FG_POINTS}点`, far ? '遠すぎる' : pct(fgChance(st, 0))]
          : c.type === 'pat' ? [`${PAT_POINTS}点`, pct(patChance(home))]
            : c.type === 'punt' ? ['陣地を回復', '相手を遠ざける']
              : c.type === 'kickoff' ? ['遠くへ蹴る', '相手は自陣から']
                : c.type === 'onside' ? ['取り返す', pct(onsideChance(home))] : undefined;
        const el = playCard(c, side, {
          note,
          selected: selected === c, blocked: block ? (far ? '遠すぎる' : BLOCK_TEXT[block] || 'あとで') : null, read: c.special ? st.read[0][c.special.key] ?? 0 : 0,
          mom: st.mom[0], index: i, key: true, deal: firstDeal, ev: block ? null : outlook(st, 0, c),
          onpick: () => {
            // a mouse has already looked (hovering): it plays. A finger looks first, and plays on the second tap
            const mouse = by === 'mouse';
            by = '';
            vibrate(12);
            if (mouse || selected === c) playCardNow(c);
            else consider(c, el);
          },
        });
        let by = '';
        if (!block) {
          el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && consider(c, el));
          el.addEventListener('pointerdown', (e) => {
            by = e.pointerType;
          });
          el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && selected === c && consider(null));
          el.addEventListener('focus', () => el.matches(':focus-visible') && consider(c, el));
        } else if (lockOf(c)) {
          el.addEventListener('click', () => booth.say(`いまは「${cardName(cards.find((x) => !lockOf(x))!, side)}」を出してみましょう`, 'idle'));
        } else if (far) {
          el.addEventListener('click', () => booth.say('ここからでは遠すぎて、フィールドゴールは届きません', 'sad'));
        } else if (c.special) {
          const why = BLOCK_TEXT[block];
          el.addEventListener('click', () => booth.say(`${hero(c.special!.owner).name}の「${c.special!.name}」は、いまは使えません（${why}）`, 'sad'));
        }
        // (a card the story keeps for later stays a whole card: it is only waiting)
        if (block && !lockOf(c)) el.classList.add('spine');
        if (c.special && !block) {
          nowReady.add(c.special.key);
          if (!readyKeys.has(c.special.key)) el.classList.add('ready');
        }
        if (firstDeal) setTimeout(() => alive && sfx.cardDeal(i), i * 70 + 60);
        return el;
      });
      if (firstDeal) {
        if ([...nowReady].some((k) => !readyKeys.has(k))) setTimeout(() => alive && sfx.specialReady(), 500);
        readyKeys = nowReady;
      }
      hand.replaceChildren(
        h('div.hand-side', { class: side },
          h(tfp || ko ? 'b.try' : 'b', ko ? 'キック' : tfp ? 'TFP' : onOffense ? '攻撃' : '守備'),
          h('span', ko ? 'どう蹴る？' : tfp ? (onOffense ? '追加点！' : '止めろ！') : onOffense ? '進めろ！' : '止めろ！'),
          h('i', { 'aria-hidden': 'true' }, onOffense ? '▶▶▶' : '◆◆◆')),
        h('div.hand-cards', els),
        historyEl(),
        h('div.hand-go',
          h('p.hand-tip', touchy ? 'タップで下見、もう一度タップで勝負' : 'かざすと下見、クリックで勝負'),
          button('おまかせ', () => {
            if (busy) return;
            const mine = only ? cards.find((c) => !lockOf(c))! : !peeked ? autoPick(st, 0, theirs)
              : (peeked.ok ? cards.find((c) => c.type === bestAgainst(theirs, onOffense)) : null) ?? cards[0]!;
            playCardNow(mine);
          }, { cls: 'mini alt', key: 'A' })));
      // a crowded hand gives the cards the room: the log steps aside
      const log = hand.querySelector<HTMLElement>('.hand-log')!;
      const row = hand.querySelector<HTMLElement>('.hand-cards')!;
      log.hidden = false;
      if (row.scrollWidth > row.clientWidth + 2 || log.clientWidth < 110) log.hidden = true;
    };

    keys = (e) => {
      if (busy) return;
      const n = Number(e.key);
      if (n >= 1 && n <= cards.length) {
        const c = cards[n - 1]!;
        // a number looks at the card; the same number again plays it
        if ((c.special && specialBlock(st, 0, c.special)) || (isKick(c.type) && kickBlock(st, 0, c.type)) || lockOf(c)) sfx.deny();
        else if (selected === c) playCardNow(c);
        else consider(c, hand.querySelectorAll<HTMLElement>('.hand-cards .card')[n - 1]);
      } else if (e.key === 'a' || e.key === 'A') hand.querySelector<HTMLElement>('.hand-go .btn')?.click();
    };

    drawHand();
    hand.classList.add('in');
    requestAnimationFrame(() => insets(true));
    prompt();
    setTimeout(() => alive && !busy && showHuddle(), 500);
    busy = false;
    // the told story: the cards are on the table, the manager says what they are, then the coach plays
    if (step && lessonDue(s, step.lesson)) {
      busy = true;
      setTimeout(() => {
        if (!alive) return;
        void teach(s, step.lesson).then((how) => {
          if (!alive || how === 'none') return;
          if (how === 'skipped') {
            leaveStory();
            turn();
          } else busy = false;
        });
      }, 700);
      return;
    }
    if (debug.bot) {
      setTimeout(() => {
        if (!alive || busy) return;
        playCardNow(autoPick(st, 0, theirs));
      }, 30);
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (modalOpen()) return;
    if (skip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      skip();
      return;
    }
    keys(e);
  };
  window.addEventListener('keydown', onKey);

  // keep the name tags over the heroes the considered card is about
  let raf = 0;
  const follow = (): void => {
    raf = requestAnimationFrame(follow);
    if (sheet) placePeek();
    for (const k of keys3) {
      const pos = stadium.screenPos(0, k.id);
      k.el.style.visibility = pos ? 'visible' : 'hidden';
      if (pos) k.el.style.transform = `translate(${pos.x}px, ${pos.y - pos.h - 4}px)`;
    }
  };
  raf = requestAnimationFrame(follow);

  // ------------------------------------------------------------------ the special play's moment
  const cutIn = async (sp: SpecialCard, team: 0 | 1, potency: number, verdict?: string): Promise<void> => {
    const mine = team === 0;
    sfx.specialCutin(mine);
    duck(0.6, 1300);
    flash(st.teams[team].color, 260, 0.45);
    vibrate(mine ? [20, 30, 40] : 30);
    const weak = potency < 0.99 && !verdict;
    const el = h('div.cutin', { class: mine ? 'mine' : 'theirs', style: { '--team': st.teams[team].color } },
      h('div.cutin-band'),
      h('div.cutin-words', { 'aria-hidden': 'true' }, sp.name, '　', sp.name),
      h('div.cutin-hero', sprite(sp.owner, 'ghost g2'), sprite(sp.owner, 'ghost g1'), sprite(sp.owner)),
      h('div.cutin-text',
        h('span.cutin-who', `${st.teams[team].short}　${hero(sp.owner).name}`),
        h('b', kinetic(sp.name)),
        h('span.cutin-tag', verdict ?? KIND[sp.kind].tag, weak ? h('u', `読まれて効果 ${Math.round(potency * 100)}%`) : null)));
    stage.append(el);
    await pause(1350);
    el.classList.add('out');
    await pause(180);
    el.remove();
  };

  // ------------------------------------------------------------------ showing a play
  const playOut = async (off: Pick, def: Pick, quick = false): Promise<void> => {
    closePeek();
    quickPlay = quick;
    flowBar.classList.toggle('on', quick);
    const before = snap();
    const res: PlayResult = resolvePlay(st, off, def);
    // what will be said about it is known now: its pieces are made ready while the cards are shown
    prefetchVoice((['snap', 'handoff', 'throw', 'catch', 'drop', 'break', 'steal', 'touchdown', 'kick', 'end'] as Beat[])
      .map((b) => callFor(b, res, names)).filter((c): c is Call => !!c).map(lineOf));
    storeMatch(st);
    const mineOff = res.off === 0;
    /** a touchdown by either side: the offense's, or the other team's on a return (a kickoff, a ball taken away) */
    const scored = res.td || !!res.returnTd;
    const scorer: 0 | 1 = res.returnTd ? ((1 - res.off) as 0 | 1) : res.off;
    const mine = mineOff ? off : def;
    const theirs = mineOff ? def : off;
    keys = () => undefined;
    stadium.preview(null, 'off', 0);
    huddleEl.replaceChildren();
    casterEl.replaceChildren();
    keys3 = [];
    keyTags.replaceChildren();
    stage.replaceChildren();
    hand.classList.remove('in', 'is-looking');
    insets(false);
    crowd.tension(false);

    // ---- the two cards meet (a kick is not a guessing game: it is simply announced)
    const kick = res.kick;
    if (kick) {
      root.classList.add('cine');
      sfx.cardConfirm();
      const call = h('div.telop.plain.quarter', h('div.telop-band'), h('b', kinetic(KICK_INFO[kick.type].name)));
      stage.append(call);
      await pause(750);
      call.remove();
      if (!alive) return;
    } else if (quick) {
      // called for the coach: the two calls are simply named
      root.classList.add('cine');
      const call = h('div.telop.plain.quarter.flowcall', h('div.telop-band'),
        h('b', h('span', cardName(off, 'off')), h('i', '×'), h('span', cardName(def, 'def'))));
      stage.append(call);
      await pause(650);
      call.remove();
      if (!alive) return;
    } else {
      const myCard = playCard(mine, mineOff ? 'off' : 'def', { small: true });
      const theirBack = cardBack();
      const theirCard = playCard(theirs, mineOff ? 'def' : 'off', { small: true });
      const verdictGood = res.edge !== 'even' && (res.edge === 'off') === mineOff;
      const verdict = h('div.verdict', { class: res.edge === 'even' ? 'even' : verdictGood ? 'good' : 'bad' },
        kinetic(res.edge === 'even' ? '五分と五分' : verdictGood ? '読み勝ち！' : '読まれた…'));
      const mineSide = h('div.face.mine', h('span.label', home.short), myCard);
      const theirSide = h('div.face.theirs', h('span.label.hot', away.short), theirBack);
      const face = h('div.faceoff', mineSide, theirSide);
      stage.append(face);
      root.classList.add('cine');
      sfx.cardConfirm();
      await pause(520);
      if (!alive) return;
      theirBack.replaceWith(theirCard);
      theirCard.classList.add('flipped');
      sfx.cardFlip();
      await pause(260);
      if (!alive) return;
      face.classList.add('clash');
      await pause(150);
      if (!alive) return;
      const c = center(face);
      sfx.clash(res.edge === 'even' ? 'even' : verdictGood ? 'good' : 'bad');
      sparks(c.x, c.y, res.edge === 'even' ? '#fffbe8' : verdictGood ? '#ffe14a' : '#ff5a7a', 26, 1.2);
      burst(c.x, c.y, { count: 16, color: ['#fffbe8', '#ffe14a', '#ff5a2e'], shape: ['star', 'tri'], power: 1.3 });
      shake(0.7, 240, stage);
      vibrate(22);
      face.classList.add(res.edge === 'even' ? 'draw' : verdictGood ? 'won' : 'lost');
      face.append(verdict);
      await pause(900);
      if (!alive) return;
      face.classList.add('out');
      await pause(160);
      face.remove();
    }

    // ---- special plays get their moment
    if (off.special) await cutIn(off.special, res.off, res.offPotency);
    if (def.special && !kick) await cutIn(def.special, (1 - res.off) as 0 | 1, res.defPotency);
    if (!alive) return;
    // ---- the day's duel: the two meet on this play
    const cut = duelCut(st, res);
    if (cut) {
      const du = st.duels![res.duel!.i]!;
      sfx.specialCutin(du.side === 0);
      flash('#ff5a2e', 200, 0.35);
      vibrate(24);
      stage.append(cut);
      shout({ head: du.rival ?? '対決！', tail: `${hero(du.ace).name}対${hero(du.foe).name}！`, side: 'none', hot: !!du.rival }, res.off);
      await pause(quick ? 950 : 1500);
      cut.classList.add('out');
      await pause(180);
      cut.remove();
      if (!alive) return;
    }
    root.classList.remove('cine');

    // ---- the play itself: sound, shake and the phone's buzz follow the picture
    booth.say(kick ? `${hero(kick.kicker).name}が蹴る！` : off.special ? `${hero(off.special.owner).name}が行く！` : isRun(off.type as OffType) ? 'ボールを持って、走る！' : '下がって、投げる！', 'idle');
    sfx.whistle('short');
    const call = (beat: Beat, route?: string): void => shout(callFor(beat, res, names, route), res.off);
    await stadium.play(res, speed() * (quick ? 1.7 : 1), {
      onSnap: () => {
        sfx.snap();
        call('snap');
      },
      onHandoff: () => {
        sfx.handoff();
        call('handoff');
      },
      onThrow: (long, route) => {
        sfx.throwBall(long);
        call('throw', route ? ROUTE_LABEL[route] : undefined);
        // a deep ball hangs in the air and the whole stadium holds its breath
        if (long) crowd.ooh();
      },
      onKick: () => {
        sfx.impact(0.55);
        sfx.throwBall(true);
        vibrate(18);
        call('kick');
        if (kick && (kick.type === 'fg' || kick.type === 'pat')) crowd.ooh();
      },
      onCatch: () => {
        sfx.catchBall();
        crowd.roar(0.4);
        call('catch');
      },
      onDrop: () => {
        sfx.dropBall();
        (mineOff ? crowd.groan : crowd.ooh)();
        call('drop');
      },
      onImpact: (power) => {
        sfx.impact(power);
        if (power >= 0.5) shake(power * 0.7, 180 + power * 140);
        if (power >= 0.3) vibrate(10 + Math.round(power * 45));
      },
      onSteal: () => {
        sfx.steal();
        flash('#ffffff', 200, 0.5);
        // our stand erupts; when it is our ball that is gone, their corner of the stadium does
        // (an onside kick won back is the kicking team's joy)
        if (kick ? !mineOff : mineOff) {
          crowd.groan();
          crowd.roar(0.45);
        } else crowd.roar(1);
        call('steal');
      },
      onBreak: () => {
        sfx.breakaway();
        crowd.roar(mineOff ? 0.75 : 0.35);
        call('break');
      },
      onTouchdown: () => {
        sfx.touchdown(scorer === 0);
        crowd.roar(scorer === 0 ? 1 : 0.5);
        flash(st.teams[scorer].color, 380, 0.6);
        vibrate([30, 40, 30, 40, 80]);
        call('touchdown');
      },
    });
    if (!alive) return;
    call('end');
    // the stand answers the big stops as loudly as the scores
    if (res.outcome === 'sack') {
      if (mineOff) {
        crowd.groan();
        crowd.roar(0.4);
      } else crowd.roar(0.95);
      shake(0.5, 260);
    } else if (res.turnover === 'downs' && !res.tfp) (mineOff ? crowd.groan : () => crowd.roar(0.9))();
    else if (kick && kick.type === 'fg') (kick.good === mineOff ? () => crowd.roar(0.85) : crowd.groan)();
    else if (!kick && !res.td && res.outcome === 'gain' && res.yards >= 15) crowd.roar(mineOff ? 0.85 : 0.4);

    // ---- telop: what happened
    const tried = !!res.tfp && !kick;
    const koff = kick?.type === 'kickoff';
    const onside = kick?.type === 'onside';
    const good = kick ? kick.good && kick.type !== 'punt' && !koff : tried ? res.points > 0 : res.td || res.firstDown || res.yards >= 5;
    const forMe = res.returnTd ? scorer === 0 : kick ? (kick.type === 'punt' ? mineOff : kick.good === mineOff)
      : tried ? (res.points > 0) === mineOff
        : res.turnover ? !mineOff : mineOff ? good : !good && res.yards <= 2;
    /** who stars in a return touchdown: the one who ran it back */
    const runner = res.returnTd ? (kick ? kick.returner ?? res.carrier : res.defender) : null;
    let head: string;
    if (res.returnTd) head = koff ? 'リターンタッチダウン！' : res.turnover === 'int' ? 'インターセプトからTD！' : 'ファンブルからTD！';
    else if (kick) {
      head = kick.type === 'punt' ? `パント ${kick.dist}ヤード`
        : koff ? (kick.ret ? `${kick.ret}ヤードのリターン` : 'タッチバック')
        : onside ? (kick.good ? 'オンサイドキック成功！' : 'オンサイドキック失敗')
        : kick.type === 'fg' ? (kick.good ? 'フィールドゴール！' : 'フィールドゴール失敗')
          : kick.good ? 'キック成功！' : 'キック失敗';
    } else if (tried) head = res.points ? `${TWO_POINTS}点成功！` : `${TWO_POINTS}点ならず`;
    else if (res.td) head = 'タッチダウン！';
    else if (res.turnover === 'int') head = 'インターセプト！';
    else if (res.turnover === 'fumble') head = 'ファンブル！';
    else if (res.turnover === 'downs') head = '攻守交代！';
    else if (res.firstDown) head = 'ファーストダウン！';
    else if (res.outcome === 'sack') head = 'サック！';
    else if (res.outcome === 'incomplete') head = 'パス失敗';
    else if (res.outcome === 'nogain' || res.outcome === 'loss') head = 'ストップ！';
    else head = `${res.yards}ヤード前進`;
    const extra = (kick || tried) && !res.returnTd;
    const yardsText = extra ? '' : res.outcome === 'incomplete' || res.turnover === 'int' ? '' : `${res.yards > 0 ? '+' : ''}${res.yards}`;
    const sack = !kick && !tried && res.outcome === 'sack';
    const big = scored || (!!res.turnover && !kick) || (kick?.type === 'fg') || !!onside || sack;
    if (res.td && mineOff && s.results.length === 0) guideEvent(save(), 'first_td');
    if (scored) {
      stadium.celebrate('td', scorer);
      if (scorer === 0) confetti([home.color, '#fffbe8', '#ff5a2e', '#37e3ff'], 1.6);
    } else if (extra) {
      if (res.points) {
        sfx.firstDown();
        (mineOff ? () => crowd.roar(0.7) : crowd.groan)();
        stadium.celebrate('turnover', res.off);
      } else if (kick?.type === 'punt' || koff) sfx.gain(6);
      else if (onside && kick!.good) {
        sfx.turnover(forMe);
        stadium.celebrate('turnover', res.off);
      } else sfx.stopped(forMe);
    } else if (res.turnover) {
      stadium.celebrate('turnover', (1 - res.off) as 0 | 1);
      sfx.turnover(forMe);
    } else if (res.firstDown) {
      sfx.firstDown();
      if (mineOff) crowd.roar(0.5);
    } else if (res.yards > 0 && res.outcome === 'gain') sfx.gain(res.yards);
    else sfx.stopped(forMe);
    // a number pops out of the ball carrier on the field
    const who = stadium.screenPos(res.off, res.carrier);
    if (yardsText && who && !scored) {
      const r = canvas.getBoundingClientRect();
      pop(r.left + who.x, r.top + who.y - 40 * who.scale, yardsText, res.yards > 0 ? (mineOff ? '' : 'bad') : mineOff ? 'bad' : 'cool');
    }
    const telop = h('div.telop', { class: `${(kick?.type === 'punt' || koff) && !res.returnTd ? 'plain' : forMe ? 'good' : mineOff || scored || res.turnover || extra ? 'bad' : 'plain'} ${big ? 'big' : ''}` },
      h('div.telop-band'),
      big ? h('div.telop-hero', sprite(runner ?? (onside ? (kick!.good ? res.defender : kick!.returner ?? res.defender) : res.td || kick ? res.carrier : res.defender))) : null,
      h('b', kinetic(head)),
      runner != null ? h('span.telop-who', hero(runner).name)
        : sack || res.turnover === 'int' || res.turnover === 'fumble' ? h('span.telop-who', hero(res.defender).name) : res.td ? h('span.telop-who', hero(res.carrier).name) : null,
      extra && res.points ? h('span.telop-yards', `+${res.points}`, h('i', '点')) : null,
      yardsText && !res.td && !res.turnover && (res.firstDown || res.yards < 0) ? h('span.telop-yards', yardsText, h('i', 'ヤード')) : null);
    // momentum gained on this play: said under the telop (the club's first), then it flies to the scoreboard
    const gained = ([0, 1] as const).map((t) => Math.max(0, res.momAfter[t] - res.momBefore[t]));
    const momSide: 0 | 1 | null = gained[0] ? 0 : gained[1] ? 1 : null;
    const momTag = momSide === null ? null : h('span.telop-mom', { class: momSide === 0 ? 'mine' : 'theirs' },
      h('i.flame.on'), h('span.telop-mom-n', `${momSide === 1 ? `${away.short}に` : ''}流れ +${gained[momSide]}`),
      res.momWhy[momSide] ? h('em', res.momWhy[momSide]) : null);
    if (momTag) telop.append(momTag);
    const dTag = duelTag(st, res);
    if (dTag) telop.append(dTag);
    stage.append(telop);
    // the play-by-play steps down out of the telop's way
    root.classList.toggle('telop-up', true);
    booth.say(res.lines[res.lines.length - 1] ?? head, scored ? (scorer === 0 ? 'cheer' : 'sad') : forMe ? 'guts' : 'idle');

    const outcomeText = res.returnTd ? '被TD' : extra ? (res.points ? `+${res.points}点` : kick?.type === 'punt' ? `${kick.dist}yd` : onside && kick!.good ? '成功' : '失敗')
      : res.td ? 'TD' : res.turnover ? '交代' : res.outcome === 'incomplete' ? '失敗' : yardsText;
    // (an ordinary kickoff is nobody's call: it is not written down)
    if (!koff) history.unshift({ mine: mineOff, name: tried ? `${TWO_POINTS}点ねらい` : cardName(off, 'off'), result: outcomeText, special: !!off.special, good: mineOff ? good : false });
    if (!kick) history.unshift({ mine: !mineOff, name: cardName(def, 'def'), result: '', special: !!def.special, good: false });

    await pause(big ? 900 : quick ? 260 : 500);
    if (!alive) return;
    // the scoreboard catches up: score rolls, momentum lights, the ball moves on the little map
    // (a quarter that ended is shown with its last play gone; the next turn turns the page)
    drawBug(res.period ? { ...snap(), quarter: before.quarter, left: Math.max(0, before.left - 1) } : snap());
    if (momTag && momSide !== null) flyFlames(momTag, momSide, res.momBefore[momSide], gained[momSide]!);
    await pause(big ? 1500 : quick ? 520 : 900);
    if (!alive) return;
    telop.classList.add('out');
    await pause(200);
    telop.remove();
    root.classList.remove('telop-up');

    // ---- once more, from another angle: a touchdown, a big gain, a ball taken away. A tap skips it
    const worthAnotherLook = !kick && !tried && (res.td || res.returnTd || res.turnover === 'int' || res.turnover === 'fumble' || (res.outcome === 'gain' && res.yards >= BIG_PLAY));
    if (worthAnotherLook && (!quick || scored) && prefs().replay && !debug.bot) {
      const tag = h('div.replay-tag', h('i'), h('b', 'リプレイ'), h('span', touchy ? 'タップでとばす' : 'クリックでとばす'));
      root.append(tag);
      sfx.transition();
      skip = () => {
        skip = null;
        stadium.skip();
      };
      await stadium.replay(res, speed());
      skip = null;
      tag.remove();
      if (!alive) return;
    }

    // ---- the clock
    if (res.period === 'half' || res.period === 'sudden') {
      sfx.whistle('long');
      sfx.halftime();
      const half = res.period === 'half';
      if (half) halftimeTalk(st, 1, autoTalk(st, 1));
      // a new half, a new set of time-outs
      if (half) {
        timeouts = TIMEOUTS;
        drawFlow();
      }
      if (debug.bot) {
        if (half) halftimeTalk(st, 0, autoTalk(st, 0));
      } else {
        await new Promise<void>((resolve) => {
          const done = (): void => {
            storeMatch(st);
            closeModal();
            resolve();
          };
          modal(h('div.period',
            h('div.period-score', h('span', { style: { color: home.color } }, home.short), h('b.led', String(st.score[0])), h('i', '-'), h('b.led', String(st.score[1])), h('span', { style: { color: away.color } }, away.short)),
            half ? h('p', 'ロッカールームで、後半に向けてひとこと。どれかひとつ') : h('p', '次に点を取ったほうの勝ちです！'),
            half ? h('div.talks', TALK_KEYS.map((key, i) => h('button.talk', {
              type: 'button', style: { '--i': String(i) },
              onclick: (e: MouseEvent) => {
                halftimeTalk(st, 0, key);
                sfx.stamp();
                vibrate(20);
                burst(e.clientX, e.clientY, { count: 18, color: ['#ffe14a', '#fffbe8'], shape: ['star', 'rect'] });
                done();
              },
            }, h('b', TALKS[key].name), h('span', TALKS[key].text))))
              : h('div.modal-actions', button('延長戦へ', done, { cls: 'big go' }))), { sticky: true, title: half ? 'ハーフタイム' : '同点！ 延長戦' });
        });
      }
    } else if (res.period === 'quarter') {
      sfx.quarter();
      const q = h('div.telop.plain.quarter', h('div.telop-band'), h('b', kinetic(`第${st.quarter}クォーター`)));
      stage.append(q);
      await pause(900);
      q.remove();
    }
    turn();
  };

  // ------------------------------------------------------------------ full time
  const finish = async (): Promise<void> => {
    if (!alive) return;
    closePeek();
    alive = false;
    busy = true;
    quickPlay = false;
    flowBar.classList.remove('on');
    hand.classList.remove('in');
    insets(false);
    crowd.tension(false);
    root.classList.remove('clutch');
    const totals = st.totals;
    const { changes, win, ended, out, fame, gift, trip } = finishMatch(s, st);
    // the spring tournament is over (lost, or won to the end): the summer comes next
    const springEnd = p.cup && p.stage === 'spring' && (out || p.round === 3);
    storeMatch(null);
    if (ended) {
      save().seasons += 1;
      if (s.champion) save().titles += 1;
      if (s.summit === 'won') save().cleared = (save().cleared ?? 0) + 1;
    }
    commit();
    drawBug(snap());
    sfx.whistle('long');
    stage.replaceChildren(h('div.telop.big', { class: win ? 'good' : 'bad' }, h('div.telop-band'), h('b', kinetic('試合終了！'))));
    booth.say(win ? `${home.short}の勝利です！！` : `${away.short}の勝利…。くやしい！`, win ? 'cheer' : 'cry');
    await new Promise((r) => setTimeout(r, debug.bot ? 100 : 1500));
    playBgm('');
    if (win) {
      sfx.win();
      crowd.roar(1);
      stadium.celebrate('win', 0);
      confetti([home.color, '#fffbe8', '#ff5a2e', '#37e3ff'], 3);
    } else sfx.lose();
    stage.replaceChildren();
    const row = (label: string, a: number, b: number, i: number): HTMLElement => {
      const ea = h('td', '0');
      const eb = h('td', '0');
      setTimeout(() => {
        void countUp(ea, 0, a, 600);
        void countUp(eb, 0, b, 600);
      }, 300 + i * 120);
      return h('tr', { class: a > b ? 'lead' : '' }, ea, h('th', label), eb);
    };
    modal(h('div.fulltime', { class: win ? 'win' : 'lose' },
      h('div.fulltime-top',
        h('div.fulltime-head', h('b', kinetic(win ? '勝利！' : '敗北…')),
          springEnd ? h('span.fulltime-note', win ? '春の大会 優勝！ 本番は秋' : '春の大会はここまで。本番は秋！') : null),
        h('div.period-score', h('span', { style: { color: home.color } }, home.short), h('b.led', String(st.score[0])), h('i', '-'), h('b.led', String(st.score[1])), h('span', { style: { color: away.color } }, away.short))),
      h('div.fulltime-mid',
        h('table',
          row('進んだヤード', totals[0].yards, totals[1].yards, 0),
          row('ファーストダウン', totals[0].firstDowns, totals[1].firstDowns, 1),
          row('タッチダウン', totals[0].td, totals[1].td, 2),
          row('ボールを奪った回数', totals[1].turnovers, totals[0].turnovers, 3),
          st.duels?.length ? row('対決の勝ち', clubRecord(st.duels).w, clubRecord(st.duels).l, 4) : null),
        h('div.fulltime-side', fameReport(fame),
          gift || trip ? h('p.fulltime-money', gift ? h('span', '寄付', h('b', `+${gift}万円`)) : null, trip ? h('span', '遠征', h('b.is-cost', `−${trip}万円`)) : null,
            trip ? h('span', '全員に遠征の経験値') : null) : null)),
      changes.length ? h('div.fulltime-changes', { class: changes.length > 12 ? 'is-crowd' : changes.length > 9 ? 'is-many' : '' }, changeList(s, changes)) : null,
      h('div.modal-actions', button(ended ? '結果を見る' : 'グラウンドへもどる', () => {
        closeModal();
        // a round of the tournament: its results go onto the bracket first
        if (p.cup && (p.stage === 'spring' || p.stage === 'autumn')) {
          void showBracket(root, s, p.stage, 'update').then(() => {
            commit();
            route();
          });
        } else route();
      }, { cls: 'big go' }))), { sticky: true, cls: 'wide', quiet: true });
  };

  root.append(ticker([
    `${labelOf(s, p)}　${home.name} 対 ${away.name}`, '4回の攻撃で10ヤード進めば攻撃続行', '同じ特別作戦は使うたびに読まれる',
    'カードの◎は得意な相手、×は苦手な相手', 'カードの右上は期待値の目安（10段階）', 'ハドルの意見は、判断が高いヒーローほど当たる', `${away.name}：${isFinal ? '王者の風格' : '油断は禁物'}`,
  ], '中継'));
  root.addEventListener('shown', () => {
    insets(false);
    sfx.whistle('long');
    crowd.roar(0.5);
    // eleven a side, before the kickoff: the day's duels
    if (st.duels?.length && st.n === 0 && st.ko && !debug.bot) void showDuels(root, st).then(() => alive && turn());
    else turn();
  }, { once: true });

  return [root, () => {
    alive = false;
    hush();
    skip?.();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    crowd.tension(false);
    crowd.stop();
    stadium.destroy();
  }];
}
