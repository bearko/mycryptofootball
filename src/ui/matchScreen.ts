// The match: scoreboard on top, the field in the middle, the hand of play cards at the bottom.

import { blip, playBgm, se } from '../core/audio';
import { debug, newSeed } from '../core/debug';
import { h, wait } from '../core/dom';
import { commit, loadMatch, save, storeMatch } from '../core/save';
import {
  DEF_INFO, DEF_TYPES, KIND, OFF_INFO, OFF_TYPES, isRun, type DefType, type OffType, type SpecialCard,
} from '../game/cards';
import { hero } from '../game/heroes';
import {
  FIELD, MOM_MAX, at, autoPick, bestAgainst, createMatch, resolvePlay, senseHint, specialBlock, specialPick, usePeek,
  type Hint, type MatchState, type Pick, type PlayResult,
} from '../game/match';
import { opponentSheet } from '../game/teams';
import { SCHEDULE, clubSheet, finishMatch, plan } from '../game/season';
import { changeList } from './club';
import { Field } from './field';
import { route } from './nav';
import { button, closeModal, modal, muteButton, playCard, specialText, sprite } from './parts';

const BLOCK_TEXT = { side: '', bench: '控えにいる', position: '位置が合わない', momentum: '流れが足りない' } as const;

const hintText = (hint: Hint, onOffense: boolean): string => {
  if (hint === 'special') return '相手は何か仕掛けてくる！';
  if (onOffense) return hint === 'run' ? '相手はランを警戒している' : hint === 'pass' ? '相手はパスを警戒している' : '相手は突っこんでくる気配';
  return hint === 'run' ? '相手はランの構え' : '相手はパスの構え';
};

export function matchScreen(): [HTMLElement, () => void] {
  const s = save().season!;
  const p = plan(s);
  if (p.t !== 'match') throw new Error('not a match week');
  const isFinal = s.week === SCHEDULE.length - 1;
  playBgm(isFinal ? 'final' : 'match');

  let st: MatchState = loadMatch() ?? createMatch(clubSheet(s), opponentSheet(p.opp), newSeed());
  storeMatch(st);
  const [home, away] = st.teams;
  const firstEver = save().seasons === 0 && s.results.length === 0;
  let taughtOff = !firstEver;
  let taughtDef = !firstEver;
  let alive = true;
  let busy = false;
  let skip: (() => void) | null = null;

  // ------------------------------------------------------------------ skeleton
  const canvas = h('canvas.field');
  const hud = h('header.sb');
  const callout = h('div.callout');
  const banner = h('div.banner');
  const faceoff = h('div.faceoff');
  const cutin = h('div.cutin');
  const hand = h('footer.hand');
  /** the last few plays, newest first: what each side called and what came of it */
  const history: { mine: boolean; off: boolean; name: string; result: string; special: boolean }[] = [];
  const stage = h('div.stage', canvas, faceoff, cutin, banner, callout);
  const root = h('div.screen.match', hud, stage, hand);
  const field = new Field(canvas, [home, away]);
  const speed = (): number => (debug.bot ? 12 : save().fast ? 2 : 1);

  /** Waits, unless the screen is tapped (then moves on at once). */
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

  // ------------------------------------------------------------------ scoreboard
  interface Snap { score: [number, number]; mom: [number, number]; poss: 0 | 1; down: number; toGo: number; pos: number; quarter: number; left: number; sudden: boolean }
  const snap = (): Snap => ({
    score: [...st.score] as [number, number], mom: [...st.mom] as [number, number], poss: st.poss, down: st.down, toGo: st.toGo,
    pos: st.pos, quarter: st.quarter, left: st.left, sudden: st.sudden,
  });
  const pips = (n: number, max: number, cls: string): HTMLElement =>
    h('span.pips', { class: cls }, Array.from({ length: max }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
  const drawHud = (v: Snap): void => {
    const team = (t: 0 | 1): HTMLElement => h('div.sb-team', { class: `${t === 0 ? 'home' : 'away'} ${v.poss === t ? 'has' : ''}` },
      h('span.sb-name', { style: { color: st.teams[t].color } }, st.teams[t].short, v.poss === t ? h('i.ballmark', '攻撃中') : null),
      h('span.sb-score', v.score[t]),
      h('span.sb-mom', h('em', '流れ'), pips(v.mom[t], MOM_MAX, 'mom')));
    const toGoal = FIELD - v.pos;
    hud.replaceChildren(
      team(0),
      h('div.sb-mid',
        h('span.sb-clock', v.sudden ? '延長：次の得点で決着' : `第${v.quarter}Q　残り${v.left}プレー`),
        h('span.sb-down', pips(v.down, 4, 'down'), `${v.down}回目`,
          h('b', v.toGo >= toGoal ? `ゴールまで${toGoal}ヤード` : `あと${v.toGo}ヤード`)),
        h('span.sb-tools', muteButton(), h('button.btn.ghost.mini', {
          type: 'button',
          onclick: (e: Event) => {
            save().fast = !save().fast;
            commit();
            (e.currentTarget as HTMLElement).textContent = save().fast ? '速さ ×2' : '速さ ×1';
          },
        }, save().fast ? '速さ ×2' : '速さ ×1'))),
      team(1));
  };

  // ------------------------------------------------------------------ one turn
  const turn = (): void => {
    if (!alive) return;
    if (st.over) {
      finish();
      return;
    }
    busy = false;
    field.setScene(st);
    drawHud(snap());
    banner.replaceChildren();
    faceoff.replaceChildren();
    const onOffense = st.poss === 0;
    const side = onOffense ? 'off' : 'def';
    // the opponent chooses first, hidden; a sharp hero may sense what is coming
    const theirs = autoPick(st, 1);
    const hint = senseHint(st, 0, theirs);
    const reader = hero(at(home, onOffense ? 'QB' : 'S').id).name;
    let selected: Pick | null = null;
    let peeked: null | { ok: boolean } = null;

    const say = (text: string, cls = ''): void => {
      callout.className = `callout ${cls}`;
      callout.textContent = text;
    };
    const idle = (): void => {
      if (peeked) say(peeked.ok ? `見えた！ 相手は「${theirName()}」。好きな作戦をえらぼう` : '読めなかった… それでも好きな作戦をえらべる', peeked.ok ? 'hint' : '');
      else if (hint) say(`${reader}の読み：${hintText(hint, onOffense)}`, 'hint');
      else if (onOffense && !taughtOff) say('攻撃です。カードの◎は得意な相手、×は苦手な相手。相手の守備を予想してえらぼう');
      else if (!onOffense && !taughtDef) say('守備です。相手の作戦を予想して止めよう。4回で10ヤード進ませなければ攻守交代');
      else say(onOffense ? '攻撃の作戦をえらんでください' : '守備の作戦をえらんでください');
    };
    const theirName = (): string => theirs.special ? theirs.special.name
      : onOffense ? DEF_INFO[theirs.type as DefType].name : OFF_INFO[theirs.type as OffType].name;

    const confirm = (): void => {
      if (busy || !selected) return;
      const mine = selected;
      if (mine.special && (mine.special.kind === 'peekOff' || mine.special.kind === 'peekDef')) {
        peeked = { ok: usePeek(st, 0, mine.special) };
        se('special');
        drawHud(snap());
        selected = null;
        drawHand();
        idle();
        return;
      }
      busy = true;
      if (onOffense) taughtOff = true;
      else taughtDef = true;
      void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine);
    };

    const choose = (pick: Pick): void => {
      if (busy) return;
      if (selected === pick) {
        confirm();
        return;
      }
      selected = pick;
      blip.pick();
      if (pick.special) say(`${hero(pick.special.owner).name}の「${pick.special.name}」：${specialText(pick.special)}`, 'info');
      else {
        const info = onOffense ? OFF_INFO[pick.type as OffType] : DEF_INFO[pick.type as DefType];
        say(`${info.name}：${info.text}。${info.good}に強く、${info.bad}に弱い`, 'info');
      }
      drawHand();
    };

    let cards: Pick[] = [];
    const drawHand = (): void => {
      const basics: Pick[] = peeked
        ? (onOffense ? OFF_TYPES : DEF_TYPES).map((type) => cards.find((c) => c.type === type && c.peeked) ?? { type, star: 2, peeked: true })
        : (onOffense ? st.hand.off : st.hand.def);
      const specials = peeked ? [] : home.specials.filter((sp) => KIND[sp.kind].side === side);
      const specialPicks = specials.map((sp) => cards.find((c) => c.special === sp) ?? specialPick(sp));
      cards = [...basics, ...specialPicks];
      const blockOf = (sp: SpecialCard): string | null => {
        const b = specialBlock(st, 0, sp);
        return b ? BLOCK_TEXT[b] : null;
      };
      hand.replaceChildren(
        h('div.hand-side', { class: side },
          h('b', onOffense ? '攻撃' : '守備'),
          h('span', onOffense ? '進めろ！' : '止めろ！')),
        h('div.hand-cards', cards.map((c) => playCard(c, side, {
          selected: selected === c,
          blocked: c.special ? blockOf(c.special) : null,
          read: c.special ? st.read[0][c.special.key] ?? 0 : 0,
          mom: st.mom[0],
          onpick: () => choose(c),
        }))),
        h('ol.history', history.length ? history.slice(0, 6).map((it) => h('li', { class: it.mine ? 'mine' : 'theirs' },
          h('i', it.mine ? '自分' : '相手'), h('span', { class: it.special ? 'sp' : '' }, it.name), h('b', it.result)))
          : h('li.none', 'ここに、両チームが使った作戦が並びます。相手のくせを読もう')),
        h('div.hand-actions',
          button('決定', confirm, selected ? 'primary big' : 'big off'),
          button('おまかせ', () => {
            if (busy) return;
            busy = true;
            const mine = !peeked ? autoPick(st, 0, theirs)
              : selected ?? (peeked.ok ? cards.find((c) => c.type === bestAgainst(theirs, onOffense)) : null) ?? cards[0]!;
            void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine);
          }, 'ghost')));
    };
    keys = (e) => {
      if (busy) return;
      const n = Number(e.key);
      if (n >= 1 && n <= cards.length) {
        const c = cards[n - 1]!;
        if (!c.special || !specialBlock(st, 0, c.special)) choose(c);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        confirm();
      }
    };
    drawHand();
    idle();
    if (debug.bot) {
      setTimeout(() => {
        if (!alive || busy) return;
        busy = true;
        const mine = autoPick(st, 0, theirs);
        void playOut(onOffense ? mine : theirs, onOffense ? theirs : mine);
      }, 30);
    }
  };

  let keys: (e: KeyboardEvent) => void = () => undefined;
  const onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('.modal')) return;
    if (skip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      skip();
      return;
    }
    keys(e);
  };
  window.addEventListener('keydown', onKey);

  // ------------------------------------------------------------------ showing a play
  const playOut = async (off: Pick, def: Pick): Promise<void> => {
    const before = snap();
    const res = resolvePlay(st, off, def);
    storeMatch(st);
    const mineOff = res.off === 0;
    hand.classList.add('wait');
    callout.className = 'callout';
    callout.textContent = '';

    // both cards face to face
    blip.flip();
    const mine = mineOff ? off : def;
    const theirs = mineOff ? def : off;
    const edge = res.edge === 'even' ? '五分と五分' : (res.edge === 'off') === mineOff ? '読み勝ち！' : '読まれた…';
    faceoff.replaceChildren(
      h('div.face', h('span', home.short), playCard(mine, mineOff ? 'off' : 'def', { small: true })),
      h('div.face-edge', { class: res.edge === 'even' ? 'even' : (res.edge === 'off') === mineOff ? 'good' : 'bad' }, edge),
      h('div.face', h('span', away.short), playCard(theirs, mineOff ? 'def' : 'off', { small: true })));
    await pause(1100);
    if (!alive) return;

    // special plays get their moment
    for (const [pick, t, pot] of [[off, res.off, res.offPotency], [def, 1 - res.off, res.defPotency]] as [Pick, number, number][]) {
      if (!pick.special) continue;
      se('special');
      cutin.replaceChildren(h('div.cutin-band', { style: { '--team': st.teams[t]!.color } },
        sprite(pick.special.owner, 'big'),
        h('div', h('span', hero(pick.special.owner).name), h('b', pick.special.name),
          h('i', pot < 0.99 ? `${KIND[pick.special.kind].tag}（読まれて効果${Math.round(pot * 100)}%）` : KIND[pick.special.kind].tag))));
      await pause(1300);
      cutin.replaceChildren();
      if (!alive) return;
    }
    faceoff.replaceChildren();

    if (!isRun(off.type as OffType)) setTimeout(() => blip.throw(), 800 / speed());
    await field.play(res, speed());
    if (!alive) return;

    // what happened
    const good = res.td || res.firstDown || res.yards >= 5;
    const forMe = res.turnover ? !mineOff : mineOff ? good : !good && res.yards <= 2;
    let head = '';
    if (res.td) head = 'タッチダウン！';
    else if (res.turnover === 'int') head = 'インターセプト！';
    else if (res.turnover === 'fumble') head = 'ファンブル！';
    else if (res.turnover === 'downs') head = '攻守交代';
    else if (res.firstDown) head = `+${res.yards}ヤード　ファーストダウン！`;
    else if (res.outcome === 'sack') head = `サック！ ${res.yards}ヤード`;
    else if (res.outcome === 'incomplete') head = 'パス失敗';
    else if (res.outcome === 'nogain') head = 'ストップ！';
    else head = `${res.yards > 0 ? '+' : ''}${res.yards}ヤード`;
    if (res.td) {
      blip.cheer();
      se(mineOff ? 'up' : 'down', 0.5);
    } else if (res.turnover) (forMe ? blip.first : blip.bad)();
    else if (res.firstDown) blip.first();
    else se(res.yards <= 0 ? 'bighit' : 'hit', 0.5);
    const short = res.td ? 'TD' : res.turnover ? '交代' : res.outcome === 'incomplete' ? '失敗' : res.outcome === 'sack' ? `${res.yards}` : `${res.yards > 0 ? '+' : ''}${res.yards}`;
    const nameOf = (pk: Pick, isOff: boolean): string => pk.special ? pk.special.name
      : isOff ? OFF_INFO[pk.type as OffType].name : DEF_INFO[pk.type as DefType].name;
    history.unshift({ mine: mineOff, off: true, name: nameOf(off, true), result: short, special: !!off.special });
    history.unshift({ mine: !mineOff, off: false, name: nameOf(def, false), result: '', special: !!def.special });
    banner.replaceChildren(h('div.banner-box', { class: forMe ? 'good' : mineOff || res.td || res.turnover ? 'bad' : 'plain' },
      h('b', head), h('span', res.lines.join(' '))));
    drawHud({ ...snap(), down: before.down, toGo: before.toGo, pos: before.pos, poss: before.poss, quarter: before.quarter, left: Math.max(0, before.left - 1) });
    await pause(res.td || res.turnover ? 2000 : 1300);
    if (!alive) return;
    hand.classList.remove('wait');

    if (res.period === 'half' || res.period === 'sudden') {
      blip.whistle();
      if (!debug.bot) await new Promise<void>((resolve) => {
        modal(h('div.period',
          h('h2', res.period === 'half' ? 'ハーフタイム' : '同点！ 延長戦'),
          h('p.period-score', `${home.short} ${st.score[0]} - ${st.score[1]} ${away.short}`),
          h('p', res.period === 'half' ? `後半は${st.teams[st.poss].short}の攻撃から` : '次に点を取ったほうの勝ちです'),
          button('つづける', () => {
            closeModal();
            resolve();
          }, 'primary')), { sticky: true });
      });
    } else if (res.period === 'quarter') blip.whistle();
    turn();
  };

  // ------------------------------------------------------------------ full time
  const finish = (): void => {
    alive = false;
    const totals = st.totals;
    const { changes, win, ended } = finishMatch(s, st);
    storeMatch(null);
    if (ended) {
      save().seasons += 1;
      if (s.champion) save().titles += 1;
    }
    commit();
    playBgm('');
    se(win ? 'win' : 'lose');
    const row = (label: string, a: number, b: number): HTMLElement => h('tr', h('td', a), h('th', label), h('td', b));
    modal(h('div.fulltime', { class: win ? 'win' : 'lose' },
      h('h2', win ? '勝利！' : '敗北…'),
      h('p.period-score', `${home.short} ${st.score[0]} - ${st.score[1]} ${away.short}`),
      h('table',
        row('進んだヤード', totals[0].yards, totals[1].yards),
        row('ファーストダウン', totals[0].firstDowns, totals[1].firstDowns),
        row('タッチダウン', totals[0].td, totals[1].td),
        row('ボールを失った回数', totals[0].turnovers, totals[1].turnovers)),
      changes.length ? changeList(s, changes) : null,
      button(ended ? '結果を見る' : '部室へもどる', () => {
        closeModal();
        route();
      }, 'primary')), { sticky: true, cls: 'wide' });
  };

  turn();
  return [root, () => {
    alive = false;
    skip?.();
    window.removeEventListener('keydown', onKey);
    field.destroy();
  }];
}

