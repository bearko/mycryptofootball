// The match, staged like a night-game broadcast: the stadium fills the screen, the scorebug floats on top,
// the hand of play cards slides in while you choose and gets out of the way while the play runs.
//
// One play = deal → choose (chalk preview on the turf) → both cards clash → special cut-ins → the play itself
// (camera, hit-stop, sound in sync) → telop → scoreboard catches up.

import { crowd, duck, playBgm, sfx, vibrate } from '../core/audio';
import { debug, newSeed } from '../core/debug';
import { h } from '../core/dom';
import { commit, loadMatch, save, storeMatch } from '../core/save';
import {
  DEF_INFO, DEF_TYPES, KIND, OFF_INFO, OFF_TYPES, READ_LABEL, isRun, type DefType, type OffType, type SpecialCard,
} from '../game/cards';
import { hero } from '../game/heroes';
import {
  FIELD, MOM_MAX, PLAYS_PER_Q, QUARTERS, TALKS, TALK_KEYS, at, autoPick, autoTalk, bestAgainst, createMatch, halftimeTalk, resolvePlay,
  senseHint, specialBlock, specialPick, usePeek, type Hint, type MatchState, type Pick, type PlayResult,
} from '../game/match';
import { opponentSheet } from '../game/teams';
import { SCHEDULE, clubSheet, finishMatch, plan } from '../game/season';
import { cardBack, cardName, playCard } from './cardView';
import { burst, center, confetti, countUp, flash, kick, kinetic, pop, shake, sparks } from './fx';
import { button, closeModal, modal, modalOpen, speech, sprite, ticker } from './kit';
import { route } from './nav';
import { changeList, settingsModal } from './shared';
import { Stadium } from './stadium';

const BLOCK_TEXT = { side: '', bench: '控えにいる', position: '位置が合わない', momentum: '流れ不足' } as const;

const hintText = (hint: Hint, onOffense: boolean): string => {
  if (hint === 'special') return '何か仕掛けてくる…！';
  if (onOffense) return hint === 'run' ? '相手はランを警戒してる' : hint === 'pass' ? '相手はパスを警戒してる' : '相手が突っこんでくる！';
  return hint === 'run' ? '相手はランの構えだ' : '相手はパスの構えだ';
};

interface Snap {
  score: [number, number]; mom: [number, number]; poss: 0 | 1; down: number; toGo: number; pos: number; quarter: number; left: number; sudden: boolean;
}

export function matchScreen(): [HTMLElement, () => void] {
  const s = save().season!;
  const p = plan(s);
  if (p.t !== 'match') throw new Error('not a match week');
  const isFinal = s.week === SCHEDULE.length - 1;
  playBgm(isFinal ? 'final' : 'match');
  crowd.start();

  const st: MatchState = loadMatch() ?? createMatch(clubSheet(s), opponentSheet(p.opp), newSeed());
  storeMatch(st);
  const [home, away] = st.teams;
  const firstEver = save().seasons === 0 && s.results.length === 0;
  let taughtOff = !firstEver;
  let taughtDef = !firstEver;
  let alive = true;
  let busy = true;
  let skip: (() => void) | null = null;
  const speed = (): number => (debug.bot ? 12 : save().fast ? 2 : 1);

  // ------------------------------------------------------------------ skeleton
  const canvas = h('canvas.stadium');
  const bug = h('header.bug');
  const map = h('div.minimap');
  const sense = h('div.sense');
  const booth = speech('announcer');
  booth.el.classList.add('booth');
  const stage = h('div.stage');
  const hand = h('footer.hand');
  const clutch = h('div.clutch-frame', { 'aria-hidden': 'true' }, h('span', '勝負どころ'), h('span', '勝負どころ'));
  const root = h('div.screen.match', canvas, h('div.shade', { 'aria-hidden': 'true' }), clutch, bug, sense, stage, hand, booth.el);
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
  stage.addEventListener('click', () => skip?.());
  canvas.addEventListener('click', () => skip?.());

  // ------------------------------------------------------------------ scorebug
  const snap = (): Snap => ({
    score: [...st.score] as [number, number], mom: [...st.mom] as [number, number], poss: st.poss, down: st.down, toGo: st.toGo,
    pos: st.pos, quarter: st.quarter, left: st.left, sudden: st.sudden,
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
        threats.length ? h('span.threats', threats.map((sp) => h('i', {
          class: specialBlock(st, 1, sp) === null ? 'armed' : '',
          title: `${hero(sp.owner).name}「${sp.name}」${KIND[sp.kind].tag}／こちらの読み：${READ_LABEL[st.read[1][sp.key] ?? 0]}`,
        }, sprite(sp.owner), h('u', KIND[sp.kind].tag)))) : null);
    };
    const toGoal = FIELD - v.pos;
    const plays = Array.from({ length: PLAYS_PER_Q }, (_, i) => h('i', { class: i < v.left ? 'on' : '' }));
    bug.replaceChildren(
      team(0),
      h('div.bug-mid',
        h('div.bug-clock', v.sudden ? h('b.hot', '延長') : h('b', `第${v.quarter}Q`), v.sudden ? h('span', '次の1点で決着') : h('span.plays', plays)),
        h('div.bug-down', { class: v.down >= 3 ? 'late' : '' },
          h('span.downs', [1, 2, 3, 4].map((n) => h('i', { class: n < v.down ? 'used' : n === v.down ? 'now' : '' }, String(n)))),
          h('b', v.toGo >= toGoal ? `ゴールまで${toGoal}` : `あと${v.toGo}`), h('span', 'ヤード')),
        map),
      team(1),
      h('div.bug-tools', button('設定', settingsModal, { cls: 'mini alt' })));
    // the little map of the whole field: where the ball is and how far it has to go
    const x = (u: number): number => (v.poss === 0 ? u : FIELD - u) / FIELD * 100;
    map.replaceChildren(
      h('i.map-end.home', { style: { background: home.color } }), h('i.map-end.away', { style: { background: away.color } }),
      h('i.map-go', { style: { left: `${Math.min(x(v.pos), x(Math.min(FIELD, v.pos + v.toGo)))}%`, width: `${Math.abs(x(Math.min(FIELD, v.pos + v.toGo)) - x(v.pos))}%` } }),
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

  const mood = (): number => {
    const close = Math.abs(st.score[0] - st.score[1]) <= 7 ? 0.2 : 0;
    const late = st.quarter >= QUARTERS ? 0.2 : st.quarter >= 3 ? 0.1 : 0;
    return Math.min(1, 0.25 + Math.max(st.mom[0], st.mom[1]) * 0.07 + close + late + (FIELD - st.pos <= 12 ? 0.15 : 0));
  };
  const isClutch = (): boolean => st.down >= 3 || FIELD - st.pos <= 10 || (st.quarter >= QUARTERS && st.left <= 3) || st.sudden;

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
      void finish();
      return;
    }
    stadium.setScene(st);
    drawBug(snap());
    stage.replaceChildren();
    const onOffense = st.poss === 0;
    const side = onOffense ? 'off' : 'def';
    const hot = isClutch();
    root.classList.toggle('clutch', hot);
    crowd.tension(hot);
    crowd.setMood(mood());
    stadium.setExcitement(mood());
    // the opponent chooses first, hidden; a sharp hero may sense what is coming
    const theirs = autoPick(st, 1);
    const hint = senseHint(st, 0, theirs);
    const reader = at(home, onOffense ? 'QB' : 'S').id;
    let selected: Pick | null = null;
    let peeked: null | { ok: boolean } = null;
    let cards: Pick[] = [];
    let dealt = false;

    const theirName = (): string => cardName(theirs, onOffense ? 'def' : 'off');
    const prompt = (): void => {
      if (peeked) booth.say(peeked.ok ? `見えた！ 相手は「${theirName()}」です！` : 'うーん、読めませんでした…。でも好きな作戦をえらべます', peeked.ok ? 'sparkle' : 'sad');
      else if (onOffense && !taughtOff) booth.say('攻撃です！ カードの◎は得意な相手、×は苦手な相手。相手の守りを予想してえらびましょう', 'wave');
      else if (!onOffense && !taughtDef) booth.say('守備です！ 相手の作戦を予想して止めましょう。4回で10ヤード進ませなければ交代です', 'wave');
      else if (hot) booth.say(onOffense ? `ここが勝負どころ！ ${st.down}回目、あと${st.toGo}ヤード！` : `止めれば流れが来ます！ ${st.down}回目、あと${st.toGo}ヤード`, 'guts');
      else booth.say(onOffense ? `${st.down}回目の攻撃、あと${st.toGo}ヤード。さあ、どう攻める？` : `${away.short}の攻撃、${st.down}回目。さあ、どう守る？`, 'idle');
    };
    // what the reading hero senses floats over that hero on the field
    const showSense = (): void => {
      if (!hint || peeked) {
        sense.replaceChildren();
        return;
      }
      sense.replaceChildren(h('div.sense-bubble', h('b', hero(reader).name), hintText(hint, onOffense)));
      sfx.chalk();
    };

    const confirm = (): void => {
      if (busy || !selected) return;
      const mine = selected;
      if (mine.special && (mine.special.kind === 'peekOff' || mine.special.kind === 'peekDef')) {
        busy = true;
        void runPeek(mine.special);
        return;
      }
      busy = true;
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
      dealt = false;
      sense.replaceChildren();
      if (ok) {
        const card = playCard(theirs, onOffense ? 'def' : 'off', { small: true });
        stage.replaceChildren(h('div.revealed', h('span.label.hot', `${away.short}の作戦`), card));
        sfx.cardFlip();
      }
      busy = false;
      drawHand();
      prompt();
    };

    const choose = (pick: Pick): void => {
      if (busy) return;
      if (selected === pick) {
        confirm();
        return;
      }
      selected = pick;
      sfx.cardPick();
      vibrate(8);
      stadium.preview(pick, side, 0);
      if (pick.special) booth.say(`${hero(pick.special.owner).name}の「${pick.special.name}」！ ${KIND[pick.special.kind].text}`, 'sparkle');
      else {
        const info = onOffense ? OFF_INFO[pick.type as OffType] : DEF_INFO[pick.type as DefType];
        booth.say(`${info.name}。${info.text}`, 'idle');
      }
      drawHand();
    };

    const drawHand = (): void => {
      const basics: Pick[] = peeked
        ? (onOffense ? OFF_TYPES : DEF_TYPES).map((type) => cards.find((c) => c.type === type && c.peeked) ?? { type, star: 2, peeked: true })
        : (onOffense ? st.hand.off : st.hand.def);
      const specials = peeked ? [] : home.specials.filter((sp) => KIND[sp.kind].side === side);
      cards = [...basics, ...specials.map((sp) => cards.find((c) => c.special === sp) ?? specialPick(sp))];
      const firstDeal = !dealt;
      dealt = true;
      const nowReady = new Set<string>();
      const els = cards.map((c, i) => {
        const block = c.special ? specialBlock(st, 0, c.special) : null;
        const el = playCard(c, side, {
          selected: selected === c, blocked: block ? BLOCK_TEXT[block] : null, read: c.special ? st.read[0][c.special.key] ?? 0 : 0,
          mom: st.mom[0], index: i, key: true, deal: firstDeal, onpick: () => choose(c),
        });
        if (block) el.classList.add('spine');
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
          h('b', onOffense ? '攻撃' : '守備'),
          h('span', onOffense ? '進めろ！' : '止めろ！'),
          h('i', { 'aria-hidden': 'true' }, onOffense ? '▶▶▶' : '◆◆◆')),
        h('div.hand-cards', els),
        historyEl(),
        h('div.hand-go',
          button(selected ? 'これでいく！' : 'カードをえらぶ', confirm, { cls: selected ? 'big go' : 'big off', sound: 'confirm' }),
          button('おまかせ', () => {
            if (busy) return;
            busy = true;
            const mine = !peeked ? autoPick(st, 0, theirs)
              : selected ?? (peeked.ok ? cards.find((c) => c.type === bestAgainst(theirs, onOffense)) : null) ?? cards[0]!;
            void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine);
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
        if (!c.special || !specialBlock(st, 0, c.special)) choose(c);
        else sfx.deny();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        confirm();
      } else if (e.key === 'a' || e.key === 'A') hand.querySelector<HTMLElement>('.hand-go .btn.mini')?.click();
    };

    drawHand();
    hand.classList.add('in');
    requestAnimationFrame(() => insets(true));
    prompt();
    setTimeout(() => alive && !busy && showSense(), 650);
    busy = false;
    if (debug.bot) {
      setTimeout(() => {
        if (!alive || busy) return;
        busy = true;
        const mine = autoPick(st, 0, theirs);
        void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine);
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

  // keep the "sense" bubble glued to the hero who is reading the play
  let raf = 0;
  const follow = (): void => {
    raf = requestAnimationFrame(follow);
    if (!sense.firstChild) return;
    const id = at(home, st.poss === 0 ? 'QB' : 'S').id;
    const pos = stadium.screenPos(0, id);
    if (!pos) return;
    sense.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
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
  const playOut = async (off: Pick, def: Pick): Promise<void> => {
    const before = snap();
    const res: PlayResult = resolvePlay(st, off, def);
    storeMatch(st);
    const mineOff = res.off === 0;
    const mine = mineOff ? off : def;
    const theirs = mineOff ? def : off;
    keys = () => undefined;
    stadium.preview(null, 'off', 0);
    sense.replaceChildren();
    stage.replaceChildren();
    hand.classList.remove('in');
    insets(false);
    crowd.tension(false);

    // ---- the two cards meet
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

    // ---- special plays get their moment
    if (off.special) await cutIn(off.special, res.off, res.offPotency);
    if (def.special) await cutIn(def.special, (1 - res.off) as 0 | 1, res.defPotency);
    if (!alive) return;
    root.classList.remove('cine');

    // ---- the play itself: sound, shake and the phone's buzz follow the picture
    booth.say(off.special ? `${hero(off.special.owner).name}が行く！` : isRun(off.type as OffType) ? 'ボールを持って、走る！' : '下がって、投げる！', 'idle');
    sfx.whistle('short');
    await stadium.play(res, speed(), {
      onSnap: () => sfx.snap(),
      onHandoff: () => sfx.handoff(),
      onThrow: (long) => sfx.throwBall(long),
      onCatch: () => {
        sfx.catchBall();
        crowd.roar(0.4);
      },
      onDrop: () => {
        sfx.dropBall();
        (mineOff ? crowd.groan : crowd.ooh)();
      },
      onImpact: (power) => {
        sfx.impact(power);
        shake(0.4 + power * 0.9, 200 + power * 160);
        vibrate(15 + Math.round(power * 45));
      },
      onSteal: () => {
        sfx.steal();
        flash('#ffffff', 200, 0.5);
        (mineOff ? crowd.groan : () => crowd.roar(0.9))();
      },
      onBreak: () => {
        sfx.breakaway();
        crowd.roar(mineOff ? 0.7 : 0.3);
      },
      onTouchdown: () => {
        sfx.touchdown(mineOff);
        crowd.roar(mineOff ? 1 : 0.35);
        flash(st.teams[res.off].color, 380, 0.6);
        vibrate([30, 40, 30, 40, 80]);
      },
    });
    if (!alive) return;

    // ---- telop: what happened
    const good = res.td || res.firstDown || res.yards >= 5;
    const forMe = res.turnover ? !mineOff : mineOff ? good : !good && res.yards <= 2;
    let head: string;
    if (res.td) head = 'タッチダウン！';
    else if (res.turnover === 'int') head = 'インターセプト！';
    else if (res.turnover === 'fumble') head = 'ファンブル！';
    else if (res.turnover === 'downs') head = '攻守交代！';
    else if (res.firstDown) head = 'ファーストダウン！';
    else if (res.outcome === 'sack') head = 'つかまえた！';
    else if (res.outcome === 'incomplete') head = 'パス失敗';
    else if (res.outcome === 'nogain' || res.outcome === 'loss') head = 'ストップ！';
    else head = `${res.yards}ヤード前進`;
    const yardsText = res.outcome === 'incomplete' || res.turnover === 'int' ? '' : `${res.yards > 0 ? '+' : ''}${res.yards}`;
    const big = res.td || !!res.turnover;
    if (res.td) {
      stadium.celebrate('td', res.off);
      if (mineOff) confetti([home.color, '#fffbe8', '#ff5a2e', '#37e3ff'], 1.6);
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
    if (yardsText && who && !res.td) {
      const r = canvas.getBoundingClientRect();
      pop(r.left + who.x, r.top + who.y - 40 * who.scale, yardsText, res.yards > 0 ? (mineOff ? '' : 'bad') : mineOff ? 'bad' : 'cool');
    }
    const telop = h('div.telop', { class: `${forMe ? 'good' : mineOff || res.td || res.turnover ? 'bad' : 'plain'} ${big ? 'big' : ''}` },
      h('div.telop-band'),
      big ? h('div.telop-hero', sprite(res.td ? res.carrier : res.defender)) : null,
      h('b', kinetic(head)),
      yardsText && !res.td && !res.turnover && (res.firstDown || res.yards < 0) ? h('span.telop-yards', yardsText, h('i', 'ヤード')) : null);
    stage.append(telop);
    booth.say(res.lines[res.lines.length - 1] ?? head, res.td ? (mineOff ? 'cheer' : 'sad') : forMe ? 'guts' : 'idle');

    history.unshift({ mine: mineOff, name: cardName(off, 'off'), result: res.td ? 'TD' : res.turnover ? '交代' : res.outcome === 'incomplete' ? '失敗' : yardsText, special: !!off.special, good: mineOff ? good : false });
    history.unshift({ mine: !mineOff, name: cardName(def, 'def'), result: '', special: !!def.special, good: false });

    await pause(big ? 900 : 500);
    if (!alive) return;
    // the scoreboard catches up: score rolls, momentum lights, the ball moves on the little map
    drawBug({ ...snap(), quarter: before.quarter, left: Math.max(0, before.left - 1) });
    await pause(big ? 1500 : 900);
    if (!alive) return;
    telop.classList.add('out');
    await pause(200);
    telop.remove();

    // ---- the clock
    if (res.period === 'half' || res.period === 'sudden') {
      sfx.whistle('long');
      sfx.halftime();
      const half = res.period === 'half';
      if (half) halftimeTalk(st, 1, autoTalk(st, 1));
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
    alive = false;
    busy = true;
    hand.classList.remove('in');
    insets(false);
    crowd.tension(false);
    root.classList.remove('clutch');
    const totals = st.totals;
    const { changes, win, ended } = finishMatch(s, st);
    storeMatch(null);
    if (ended) {
      save().seasons += 1;
      if (s.champion) save().titles += 1;
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
      h('div.fulltime-head', h('b', kinetic(win ? '勝利！' : '敗北…'))),
      h('div.period-score', h('span', { style: { color: home.color } }, home.short), h('b.led', String(st.score[0])), h('i', '-'), h('b.led', String(st.score[1])), h('span', { style: { color: away.color } }, away.short)),
      h('table',
        row('進んだヤード', totals[0].yards, totals[1].yards, 0),
        row('ファーストダウン', totals[0].firstDowns, totals[1].firstDowns, 1),
        row('タッチダウン', totals[0].td, totals[1].td, 2),
        row('ボールを奪った回数', totals[1].turnovers, totals[0].turnovers, 3)),
      changes.length ? changeList(s, changes) : null,
      h('div.modal-actions', button(ended ? '結果を見る' : '部室へもどる', () => {
        closeModal();
        route();
      }, { cls: 'big go' }))), { sticky: true, cls: 'wide', quiet: true });
  };

  root.append(ticker([
    `${p.label}　${home.name} 対 ${away.name}`, '4回の攻撃で10ヤード進めば攻撃続行', '同じ特別作戦は使うたびに読まれる',
    'カードの◎は得意な相手、×は苦手な相手', `${away.name}：${isFinal ? '王者の風格' : '油断は禁物'}`,
  ], '中継'));
  root.addEventListener('shown', () => {
    insets(false);
    sfx.whistle('long');
    crowd.roar(0.5);
    turn();
  }, { once: true });

  return [root, () => {
    alive = false;
    skip?.();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    crowd.tension(false);
    crowd.stop();
    stadium.destroy();
  }];
}
