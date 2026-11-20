// A soundboard for every sound in the game, and a measuring bench for them (open with ?analyze=1 to run it at once).
// Dev only: nothing links here and the production build does not include it.

import '@fontsource/dela-gothic-one/japanese-400.css';
import '@fontsource/dotgothic16/japanese-400.css';

import {
  applyVolumes, audioDebug, crowd, duck, playBgm, renderOffline, se, setMuffled, sfx, toggleMute, unlockAudio, vibrate, type BgmKey,
} from '../src/core/audio';
import { h } from '../src/core/dom';
import { prefs, save } from '../src/core/save';
import catalog from '../src/generated/catalog.json';

// ---------------------------------------------------------------------------------------------- small parts

type Child = Parameters<typeof h>[2];

/** Every button also unlocks the audio, so the first click anywhere already makes sound. */
function btn(label: string, code: string, fn: () => void, cls = ''): HTMLButtonElement {
  return h('button', {
    class: cls,
    onclick: () => {
      unlockAudio();
      fn();
    },
  }, label, h('small', code));
}

interface Slider {
  el: HTMLElement;
  get: () => number;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput?: (v: number) => void): Slider {
  const input = h('input', { type: 'range', min, max, step, value });
  const out = h('output', String(value));
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput?.(Number(input.value));
  });
  return { el: h('label.slider', label, input, out), get: () => Number(input.value) };
}

const row = (...c: Child[]): HTMLElement => h('div.row', ...c);
const section = (title: string, note: string, ...c: Child[]): HTMLElement => h('section', h('h2', title), h('p', note), ...c);

/** Fires `fn(i)` n times, `gap` ms apart: for hearing how a repeated sound holds up. */
function burst(n: number, gap: number, fn: (i: number) => void): void {
  for (let i = 0; i < n; i += 1) setTimeout(() => fn(i), i * gap);
}

// ---------------------------------------------------------------------------------------------- the board

function mixSection(): HTMLElement {
  const depth = slider('深さ', 0, 1, 0.05, 0.55);
  const ms = slider('長さ(ms)', 100, 3000, 100, 700);
  const muffle = btn('こもらせる', 'setMuffled', () => {
    const on = !muffle.classList.contains('on');
    muffle.classList.toggle('on', on);
    setMuffled(on);
  });
  const mute = btn('ミュート', 'toggleMute', () => mute.classList.toggle('on', toggleMute()));
  mute.classList.toggle('on', save().mute);
  const bgm = (label: string, key: BgmKey): HTMLButtonElement => btn(label, `playBgm('${key}')`, () => playBgm(key), key ? '' : 'cold');
  return section('BGM とミックス', '曲の切り替えは約0.6秒のクロスフェード。大きな音は自動で曲を下げます。',
    row(bgm('部活', 'club'), bgm('試合', 'match'), bgm('決勝', 'final'), bgm('止める', '')),
    row(btn('曲を一瞬下げる', 'duck', () => duck(depth.get(), ms.get())), depth.el, ms.el),
    row(muffle, mute, btn('振動', 'vibrate', () => vibrate([30, 40, 80]))),
    row(
      slider('BGM 音量', 0, 1, 0.05, prefs().bgm, (v) => {
        prefs().bgm = v;
        applyVolumes();
      }).el,
      slider('効果音 音量', 0, 1, 0.05, prefs().se, (v) => {
        prefs().se = v;
        applyVolumes();
      }).el,
    ));
}

function uiSection(): HTMLElement {
  return section('インターフェース', 'スネアのリム、テナー、シンバル。小さい音ほど短く、静かに。',
    row(
      btn('ホバー', 'hover', () => sfx.hover()),
      btn('タップ', 'tap', () => sfx.tap()),
      btn('もどる', 'back', () => sfx.back()),
      btn('できない', 'deny', () => sfx.deny()),
      btn('スイッチ ON', 'toggle(true)', () => sfx.toggle(true)),
      btn('スイッチ OFF', 'toggle(false)', () => sfx.toggle(false)),
    ),
    row(
      btn('ひらく', 'open', () => sfx.open()),
      btn('とじる', 'close', () => sfx.close()),
      btn('画面の切り替え', 'transition', () => sfx.transition(), 'hot'),
      btn('ページをめくる', 'pageTurn', () => sfx.pageTurn()),
      btn('スタンプ', 'stamp', () => sfx.stamp(), 'hot'),
    ),
    row(
      btn('文字送り', 'typeTick', () => sfx.typeTick()),
      btn('セリフ1行ぶん', 'typeTick ×24', () => burst(24, 38, () => sfx.typeTick())),
      btn('カウント', 'countTick', () => sfx.countTick()),
      btn('数字が増える', 'countTick ×16', () => burst(16, 45, () => sfx.countTick())),
    ),
    row(
      btn('入れ替え', 'swap', () => sfx.swap()),
      btn('つかむ', 'drag', () => sfx.drag()),
      btn('置く', 'drop', () => sfx.drop()),
    ));
}

function cardSection(): HTMLElement {
  const index = slider('何枚目', 0, 6, 1, 0);
  return section('カード', '紙の音にスネアとブラスを重ねる。ぶつかった後の響きで読み合いの結果がわかる。',
    row(
      btn('配る', 'cardDeal(i)', () => sfx.cardDeal(index.get())),
      index.el,
      btn('手札を配る', 'cardDeal 0..4', () => burst(5, 80, (i) => sfx.cardDeal(i))),
    ),
    row(
      btn('カードにホバー', 'cardHover', () => sfx.cardHover()),
      btn('えらぶ', 'cardPick', () => sfx.cardPick()),
      btn('決定', 'cardConfirm', () => sfx.cardConfirm(), 'hot'),
      btn('めくる', 'cardFlip', () => sfx.cardFlip()),
    ),
    row(
      btn('激突：読み勝ち', "clash('good')", () => sfx.clash('good'), 'hot'),
      btn('激突：読まれた', "clash('bad')", () => sfx.clash('bad'), 'cold'),
      btn('激突：五分', "clash('even')", () => sfx.clash('even')),
      btn('チョークで作戦を描く', 'chalk', () => sfx.chalk()),
    ));
}

function matchSection(): HTMLElement {
  const power = slider('強さ', 0, 1, 0.05, 0.6);
  const yards = slider('ヤード', 0, 30, 1, 6);
  const level = slider('流れ', 1, 5, 1, 3);
  return section('試合', 'ホイッスル、ボール、ぶつかり合い、そして結果のファンファーレ。',
    row(
      btn('笛：短い', "whistle('short')", () => sfx.whistle('short')),
      btn('笛：長い', "whistle('long')", () => sfx.whistle('long')),
      btn('スナップ', 'snap', () => sfx.snap()),
      btn('手渡し', 'handoff', () => sfx.handoff()),
    ),
    row(
      btn('パス：短い', 'throwBall(false)', () => sfx.throwBall(false)),
      btn('パス：長い', 'throwBall(true)', () => sfx.throwBall(true)),
      btn('キャッチ', 'catchBall', () => sfx.catchBall()),
      btn('落球', 'dropBall', () => sfx.dropBall()),
    ),
    row(btn('ぶつかる', 'impact(power)', () => sfx.impact(power.get())), power.el,
      btn('独走', 'breakaway', () => sfx.breakaway()),
      btn('ボールを奪う', 'steal', () => sfx.steal())),
    row(btn('前進', 'gain(yards)', () => sfx.gain(yards.get())), yards.el,
      btn('ファーストダウン', 'firstDown', () => sfx.firstDown(), 'hot')),
    row(
      btn('タッチダウン：自分', 'touchdown(true)', () => sfx.touchdown(true), 'hot'),
      btn('タッチダウン：相手', 'touchdown(false)', () => sfx.touchdown(false), 'cold'),
      btn('攻守交代：奪った', 'turnover(true)', () => sfx.turnover(true), 'hot'),
      btn('攻守交代：失った', 'turnover(false)', () => sfx.turnover(false), 'cold'),
      btn('止めた', 'stopped(true)', () => sfx.stopped(true), 'hot'),
      btn('止められた', 'stopped(false)', () => sfx.stopped(false), 'cold'),
    ),
    row(btn('流れが上がる', 'momentum(level)', () => sfx.momentum(level.get())), level.el,
      btn('流れ 1→5', 'momentum 1..5', () => burst(5, 260, (i) => sfx.momentum(i + 1)))),
    row(
      btn('特別作戦が使える', 'specialReady', () => sfx.specialReady()),
      btn('特別作戦：自分', 'specialCutin(true)', () => sfx.specialCutin(true), 'hot'),
      btn('特別作戦：相手', 'specialCutin(false)', () => sfx.specialCutin(false), 'cold'),
    ),
    row(
      btn('クォーター終了', 'quarter', () => sfx.quarter()),
      btn('ハーフタイム', 'halftime', () => sfx.halftime()),
      btn('勝利', 'win', () => sfx.win(), 'hot'),
      btn('敗北', 'lose', () => sfx.lose(), 'cold'),
    ));
}

function clubSection(): HTMLElement {
  const step = slider('段', 0, 9, 1, 0);
  return section('部活', 'グロッケンとやわらかいブラス。育つ手ごたえの音。',
    row(btn('能力アップ', 'statUp(step)', () => sfx.statUp(step.get())), step.el,
      btn('能力が続けて上がる', 'statUp 0..5', () => burst(6, 110, (i) => sfx.statUp(i)))),
    row(
      btn('信頼アップ', 'trustUp', () => sfx.trustUp()),
      btn('特別作戦を習得', 'learn', () => sfx.learn(), 'hot'),
      btn('入部', 'recruit', () => sfx.recruit()),
      btn('主将が決まる', 'captain', () => sfx.captain(), 'hot'),
      btn('練習開始', 'practice', () => sfx.practice()),
      btn('イベント発生', 'event', () => sfx.event()),
    ));
}

function crowdSection(): HTMLElement {
  const power = slider('強さ', 0, 1, 0.05, 0.7);
  const stomp = btn('足ぶみと手拍子', 'tension', () => {
    const on = !stomp.classList.contains('on');
    stomp.classList.toggle('on', on);
    crowd.tension(on);
  });
  return section('観客', 'ざわめきは盛り上がり(mood)で大きく、明るくなる。足ぶみ・足ぶみ・手拍子は小節の終わりで止まる。',
    row(
      btn('ざわめき開始', 'crowd.start', () => crowd.start(), 'on'),
      btn('ざわめき終了', 'crowd.stop', () => {
        crowd.stop();
        stomp.classList.remove('on');
      }, 'cold'),
      slider('盛り上がり', 0, 1, 0.05, 0.3, (v) => crowd.setMood(v)).el,
    ),
    row(btn('歓声', 'crowd.roar(power)', () => crowd.roar(power.get()), 'hot'), power.el,
      btn('おおっ', 'crowd.ooh', () => crowd.ooh()),
      btn('ああ…', 'crowd.groan', () => crowd.groan(), 'cold'),
      stomp));
}

// ---------------------------------------------------------------------------------------------- a whole drive

type Step = [at: number, text: string, fn: () => void];

const DRIVE: Step[] = [
  [0, '試合の曲。スタンドがざわつく', () => {
    playBgm('match');
    crowd.start();
    crowd.setMood(0.35);
  }],
  [500, '審判の笛。自陣15ヤードから', () => sfx.whistle('short')],
  [1300, '作戦カードが配られる', () => burst(3, 90, (i) => sfx.cardDeal(i))],
  [2200, '「外ラン」をえらぶ', () => sfx.cardPick()],
  [2800, '決定', () => sfx.cardConfirm()],
  [3400, 'カードをめくって激突。読み勝ち！', () => {
    sfx.cardFlip();
    setTimeout(() => {
      sfx.clash('good');
      crowd.ooh();
    }, 350);
  }],
  [5000, 'スナップ、ランナーへ手渡し', () => {
    sfx.snap();
    setTimeout(() => sfx.handoff(), 220);
  }],
  [5900, '外へ走る。タックル。+6ヤード', () => {
    sfx.impact(0.5);
    setTimeout(() => sfx.gain(6), 260);
    crowd.setMood(0.45);
  }],
  [7300, 'もういちどラン。抜けた！', () => {
    sfx.snap();
    setTimeout(() => sfx.handoff(), 200);
    setTimeout(() => sfx.breakaway(), 520);
    crowd.setMood(0.6);
  }],
  [8700, '強いタックルで止まる。ファーストダウン！', () => {
    sfx.impact(0.85);
    vibrate(40);
    setTimeout(() => {
      sfx.firstDown();
      crowd.roar(0.5);
    }, 320);
    setTimeout(() => sfx.momentum(2), 1100);
  }],
  [10800, 'スタンドが足ぶみを始める', () => {
    crowd.tension(true);
    crowd.setMood(0.72);
  }],
  [13000, '特別作戦が使える', () => sfx.specialReady()],
  [14400, '特別作戦！（曲が下がる）', () => sfx.specialCutin(true)],
  [17400, 'スナップ、ロングパス', () => {
    sfx.snap();
    setTimeout(() => sfx.throwBall(true), 420);
  }],
  [18650, 'キャッチ！ そのままエンドゾーンへ', () => {
    sfx.catchBall();
    crowd.roar(0.6);
    crowd.setMood(0.9);
  }],
  [19500, 'タッチダウン！', () => {
    sfx.touchdown(true);
    crowd.roar(1);
    crowd.tension(false);
    crowd.setMood(1);
    vibrate([60, 40, 120]);
  }],
  [23200, '笛。スタンドが落ち着く', () => {
    sfx.whistle('long');
    crowd.setMood(0.4);
  }],
];

let driveTimers: Array<ReturnType<typeof setTimeout>> = [];

function driveSection(): HTMLElement {
  const log = h('div', { id: 'log' });
  const stop = (): void => {
    driveTimers.forEach(clearTimeout);
    driveTimers = [];
  };
  return h('section.wide', h('h2', '1ドライブを通しで再生'),
    h('p', '笛 → カード → ラン → タックル → ファーストダウン → 特別作戦 → ロングパス → タッチダウンまで、約25秒。'),
    row(
      btn('ドライブを再生', 'DRIVE', () => {
        stop();
        log.replaceChildren();
        for (const [at, text, fn] of DRIVE) {
          driveTimers.push(setTimeout(() => {
            fn();
            log.append(h('div', h('time', `${(at / 1000).toFixed(1)}s`), text));
            log.scrollTop = log.scrollHeight;
          }, at));
        }
      }, 'hot'),
      btn('止める', 'stop', () => {
        stop();
        crowd.tension(false);
        crowd.stop();
        playBgm('');
      }, 'cold'),
    ),
    log);
}

// ---------------------------------------------------------------------------------------------- measuring

interface Case {
  id: string;
  /** sounds in one family are compared with each other */
  family: 'tick' | 'ui' | 'card' | 'match' | 'big' | 'club' | 'crowd';
  seconds: number;
  run: () => void;
}

const c = (id: string, family: Case['family'], run: () => void, seconds = 2.5): Case => ({ id, family, seconds, run });

const CASES: Case[] = [
  c('hover', 'tick', () => sfx.hover(), 1),
  c('typeTick', 'tick', () => sfx.typeTick(), 1),
  c('countTick', 'tick', () => sfx.countTick(), 1),
  c('cardHover', 'tick', () => sfx.cardHover(), 1),
  c('drag', 'tick', () => sfx.drag(), 1),
  c('tap', 'ui', () => sfx.tap(), 1),
  c('back', 'ui', () => sfx.back(), 1.5),
  c('deny', 'ui', () => sfx.deny(), 1.5),
  c('toggle(true)', 'ui', () => sfx.toggle(true), 1.5),
  c('toggle(false)', 'ui', () => sfx.toggle(false), 1.5),
  c('open', 'ui', () => sfx.open(), 1.5),
  c('close', 'ui', () => sfx.close(), 1.5),
  c('pageTurn', 'ui', () => sfx.pageTurn(), 1.5),
  c('swap', 'ui', () => sfx.swap(), 1.5),
  c('drop', 'ui', () => sfx.drop(), 1.5),
  c('transition', 'ui', () => sfx.transition(), 3),
  c('stamp', 'ui', () => sfx.stamp(), 2),
  c('cardDeal(0)', 'card', () => sfx.cardDeal(0), 1),
  c('cardDeal(6)', 'card', () => sfx.cardDeal(6), 1),
  c('cardPick', 'card', () => sfx.cardPick(), 1.5),
  c('cardConfirm', 'card', () => sfx.cardConfirm(), 2),
  c('cardFlip', 'card', () => sfx.cardFlip(), 1.5),
  c('clash(good)', 'card', () => sfx.clash('good'), 3),
  c('clash(bad)', 'card', () => sfx.clash('bad'), 3),
  c('clash(even)', 'card', () => sfx.clash('even'), 2),
  c('chalk', 'card', () => sfx.chalk(), 1.5),
  c('whistle(short)', 'match', () => sfx.whistle('short'), 2.5),
  c('whistle(long)', 'match', () => sfx.whistle('long'), 3),
  c('snap', 'match', () => sfx.snap(), 1.5),
  c('handoff', 'match', () => sfx.handoff(), 1),
  c('throwBall(short)', 'match', () => sfx.throwBall(false), 1.5),
  c('throwBall(long)', 'match', () => sfx.throwBall(true), 2),
  c('catchBall', 'match', () => sfx.catchBall(), 1.5),
  c('dropBall', 'match', () => sfx.dropBall(), 1.5),
  c('impact(0.1)', 'match', () => sfx.impact(0.1), 1.5),
  c('impact(0.5)', 'match', () => sfx.impact(0.5), 1.5),
  c('impact(1)', 'match', () => sfx.impact(1), 2),
  c('breakaway', 'match', () => sfx.breakaway(), 2.5),
  c('steal', 'match', () => sfx.steal(), 2),
  c('gain(0)', 'match', () => sfx.gain(0), 1),
  c('gain(3)', 'match', () => sfx.gain(3), 1),
  c('gain(8)', 'match', () => sfx.gain(8), 1.5),
  c('gain(20)', 'match', () => sfx.gain(20), 1.5),
  c('momentum(1)', 'match', () => sfx.momentum(1), 2),
  c('momentum(5)', 'match', () => sfx.momentum(5), 2.5),
  c('stopped(mine)', 'match', () => sfx.stopped(true), 2),
  c('stopped(theirs)', 'match', () => sfx.stopped(false), 2),
  c('quarter', 'match', () => sfx.quarter(), 3),
  c('halftime', 'match', () => sfx.halftime(), 5),
  c('firstDown', 'big', () => sfx.firstDown(), 3),
  c('turnover(mine)', 'big', () => sfx.turnover(true), 3),
  c('turnover(theirs)', 'big', () => sfx.turnover(false), 3),
  c('specialReady', 'big', () => sfx.specialReady(), 3),
  c('specialCutin(mine)', 'big', () => sfx.specialCutin(true), 5),
  c('specialCutin(theirs)', 'big', () => sfx.specialCutin(false), 4),
  c('touchdown(mine)', 'big', () => sfx.touchdown(true), 5),
  c('touchdown(theirs)', 'big', () => sfx.touchdown(false), 4),
  c('win', 'big', () => sfx.win(), 6),
  c('lose', 'big', () => sfx.lose(), 7),
  c('statUp(0)', 'club', () => sfx.statUp(0), 1.5),
  c('statUp(9)', 'club', () => sfx.statUp(9), 1.5),
  c('trustUp', 'club', () => sfx.trustUp(), 2.5),
  c('learn', 'club', () => sfx.learn(), 3.5),
  c('recruit', 'club', () => sfx.recruit(), 2.5),
  c('captain', 'club', () => sfx.captain(), 4),
  c('practice', 'club', () => sfx.practice(), 2.5),
  c('event', 'club', () => sfx.event(), 2.5),
  c('crowd.roar(0.3)', 'crowd', () => crowd.roar(0.3), 4),
  c('crowd.roar(1)', 'crowd', () => crowd.roar(1), 5),
  c('crowd.ooh', 'crowd', () => crowd.ooh(), 2.5),
  c('crowd.groan', 'crowd', () => crowd.groan(), 3),
  c('crowd.tension', 'crowd', () => crowd.tension(true), 4),
  c('crowd bed mood 0.2', 'crowd', () => {
    crowd.setMood(0.2);
    crowd.start();
  }, 5),
  c('crowd bed mood 1', 'crowd', () => {
    crowd.setMood(1);
    crowd.start();
  }, 5),
];

export interface Measure {
  id: string;
  family: string;
  /** ms from the first audible sample until the sound has died away (-56 dBFS, 10 ms windows) */
  ms: number;
  /** ms of silence before the first audible sample */
  onset: number;
  peak: number;
  /** dBFS over the audible part */
  rms: number;
  /** loudest 50 ms, K-weighted (close to how loud it feels, and to what a phone speaker passes), in dB */
  loud: number;
  /** the same, after a 400 Hz low cut: roughly what is left on a phone speaker */
  phone: number;
  /** spectral centroid in Hz */
  centroid: number;
  /** peak of the same sound before the limiter */
  raw: number;
}

const db = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -120);

/** The two filters of the K-weighting curve at 48 kHz: a high shelf and a low cut. */
function kWeight(x: Float32Array): Float32Array {
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
    { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] },
  ];
  let cur = x;
  for (const { b, a } of stages) {
    const y = new Float32Array(cur.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < cur.length; i += 1) {
      const v = b[0]! * cur[i]! + b[1]! * x1 + b[2]! * x2 - a[0]! * y1 - a[1]! * y2;
      x2 = x1;
      x1 = cur[i]!;
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    cur = y;
  }
  return cur;
}

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k, b2 = a + len / 2;
        const tr = re[b2]! * cr - im[b2]! * ci;
        const ti = re[b2]! * ci + im[b2]! * cr;
        re[b2] = re[a]! - tr;
        im[b2] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Second-order Butterworth high-pass. */
function highpass(x: Float32Array, hz: number, sr: number): Float32Array {
  const w = Math.tan((Math.PI * hz) / sr);
  const n = 1 / (1 + Math.SQRT2 * w + w * w);
  const b0 = n, b1 = -2 * n, b2 = n;
  const a1 = 2 * (w * w - 1) * n, a2 = (1 - Math.SQRT2 * w + w * w) * n;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i]!;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** The loudest 50 ms of a signal, as mean square. */
function loudest(x: Float32Array, sr: number): number {
  const w = Math.floor(sr * 0.05);
  let best = 0, acc = 0;
  for (let i = 0; i < x.length; i += 1) {
    acc += x[i]! ** 2;
    if (i >= w) acc -= x[i - w]! ** 2;
    if (i >= w - 1) best = Math.max(best, acc / w);
  }
  return best;
}

function peakOf(buf: AudioBuffer): number {
  let p = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i += 1) p = Math.max(p, Math.abs(d[i]!));
  }
  return p;
}

function centroidOf(x: Float32Array, from: number, to: number, sr: number): number {
  const N = 2048;
  let num = 0, den = 0;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let at = from; at < to; at += N / 2) {
    for (let i = 0; i < N; i += 1) {
      const v = at + i < to ? x[at + i] ?? 0 : 0;
      re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k += 1) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      num += p * ((k * sr) / N);
      den += p;
    }
  }
  return den > 0 ? num / den : 0;
}

function measure(id: string, family: string, buf: AudioBuffer): Measure {
  const sr = buf.sampleRate;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const n = l.length;
  const mono = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
    mono[i] = (l[i]! + r[i]!) / 2;
  }
  const win = Math.floor(sr * 0.01);
  let first = -1, last = -1;
  for (let i = 0; i + win <= n; i += win) {
    let s = 0;
    for (let k = 0; k < win; k += 1) s += mono[i + k]! ** 2;
    if (Math.sqrt(s / win) > 0.0016) {
      if (first < 0) first = i;
      last = i + win;
    }
  }
  if (first < 0) return { id, family, ms: 0, onset: 0, peak, rms: -120, loud: -120, phone: -120, centroid: 0, raw: 0 };
  // refine the start to the sample
  let start = first;
  for (let i = Math.max(0, first - win); i < first + win; i += 1) {
    if (Math.abs(mono[i]!) > 0.002) {
      start = i;
      break;
    }
  }
  let sum = 0;
  for (let i = start; i < last; i += 1) sum += mono[i]! ** 2;
  const k = kWeight(mono);
  const lufs = (ms: number): number => Math.round((10 * Math.log10(Math.max(ms, 1e-12)) - 0.691) * 10) / 10;
  return {
    id, family,
    ms: Math.round(((last - start) / sr) * 1000),
    onset: Math.round((start / sr) * 1000),
    peak: Math.round(peak * 1000) / 1000,
    rms: Math.round(db(Math.sqrt(sum / (last - start))) * 10) / 10,
    loud: lufs(loudest(k, sr)),
    phone: lufs(loudest(highpass(k, 400, sr), sr)),
    centroid: Math.round(centroidOf(mono, start, last, sr)),
    raw: 0,
  };
}

export interface Report {
  /** the effects volume everything was measured at */
  se: number;
  rows: Measure[];
  /** the loudest moment of the game over the match music, every volume at 1 */
  fullMix: { peak: number; rms: number } | null;
  /** a quiet sine through the limiter: output / input (should be 1) */
  unity: number;
  problems: string[];
}

async function analyze(onRow?: (m: Measure) => void): Promise<Report> {
  const keep = { se: prefs().se, bgm: prefs().bgm };
  const rows: Measure[] = [];
  const problems: string[] = [];
  let fullMix: Report['fullMix'] = null;
  let unity = 0;
  try {
    // measure with the effects at full volume: the worst case for clipping
    prefs().se = 1;
    prefs().bgm = 1;
    for (const k of CASES) {
      const buf = await renderOffline(k.seconds, k.run);
      if (!buf) {
        problems.push(`${k.id}: 計測できなかった`);
        continue;
      }
      const m = measure(k.id, k.family, buf);
      const raw = await renderOffline(k.seconds, k.run, { bypass: true });
      m.raw = raw ? Math.round(peakOf(raw) * 1000) / 1000 : 0;
      rows.push(m);
      onRow?.(m);
    }
    const mix = await renderOffline(7, () => {
      crowd.setMood(1);
      crowd.start();
      crowd.tension(true);
      sfx.touchdown(true);
      crowd.roar(1);
      sfx.impact(1);
      sfx.whistle('long');
    }, { bgm: 'match' });
    if (mix) {
      const m = measure('full mix', 'mix', mix);
      fullMix = { peak: m.peak, rms: m.rms };
      rows.push(m);
      onRow?.(m);
    }
    unity = await unityGain();
  } finally {
    prefs().se = keep.se;
    prefs().bgm = keep.bgm;
  }

  const by = (id: string): Measure | undefined => rows.find((m) => m.id === id);
  const need = (ok: boolean, text: string): void => {
    if (!ok) problems.push(text);
  };
  for (const m of rows) {
    need(m.peak > 0.004, `${m.id}: 無音`);
    need(m.peak < 0.95, `${m.id}: クリップ (peak ${m.peak})`);
    need(m.onset <= 25 || m.id.startsWith('crowd'), `${m.id}: 出だしが遅い (${m.onset}ms)`);
    if (m.family === 'tick') need(m.ms < 120, `${m.id}: 短い音のはずが ${m.ms}ms`);
  }
  need((by('tap')?.ms ?? 0) < 120, `tap: ${by('tap')?.ms}ms`);
  const louder = (a: string, b: string, by2 = 0): void => {
    const x = by(a), y = by(b);
    if (x && y) need(x.loud >= y.loud + by2, `${a} (${x.loud}dB) は ${b} (${y.loud}dB) より ${by2}dB 以上大きいはず`);
  };
  louder('tap', 'hover', 6);
  louder('tap', 'typeTick', 4);
  louder('cardPick', 'cardHover', 6);
  louder('cardConfirm', 'tap', 3);
  louder('cardConfirm', 'cardPick', 1);
  louder('stamp', 'tap', 4);
  louder('clash(good)', 'cardConfirm', 0);
  louder('impact(1)', 'impact(0.5)', 2);
  louder('impact(0.5)', 'impact(0.1)', 2);
  louder('gain(20)', 'gain(3)', 1);
  louder('momentum(5)', 'momentum(1)', 1);
  louder('firstDown', 'gain(20)', 2);
  louder('touchdown(mine)', 'firstDown', 1);
  louder('touchdown(mine)', 'touchdown(theirs)', 2);
  louder('crowd.roar(1)', 'crowd.roar(0.3)', 3);
  louder('crowd bed mood 1', 'crowd bed mood 0.2', 6);
  louder('whistle(long)', 'whistle(short)', 0);
  // the touchdown is the biggest synthesized moment of the game
  const td = by('touchdown(mine)');
  if (td) {
    for (const m of rows) {
      if (m === td || m.family === 'mix' || ['win', 'lose', 'specialCutin(mine)'].includes(m.id)) continue;
      need(td.loud >= m.loud - 0.5, `touchdown(mine) (${td.loud}dB) より ${m.id} (${m.loud}dB) が大きい`);
      need(td.rms + 10 * Math.log10(td.ms) >= m.rms + 10 * Math.log10(Math.max(1, m.ms)) || m.family === 'crowd',
        `touchdown(mine) より ${m.id} のほうがエネルギーが大きい`);
    }
  }
  need(Math.abs(unity - 1) < 0.06, `リミッターの素通しゲインが 1 でない (${unity.toFixed(3)})`);
  return { se: 1, rows, fullMix, unity, problems };
}

/**
 * Plays a catalog sample far below the compressor's knee and compares what comes out with what went in:
 * the limiter must be transparent (gain 1) when nothing big is happening.
 */
async function unityGain(): Promise<number> {
  try {
    const url = (catalog.se as Record<string, string>)['hit'];
    if (!url) return 0;
    const src = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await (await fetch(url)).arrayBuffer());
    prefs().se = 1;
    const out = await renderOffline(src.duration + 0.2, () => se('hit', 0.1), { sampleRate: src.sampleRate });
    return out ? peakOf(out) / (peakOf(src) * 0.1) : 0;
  } catch {
    return 0;
  }
}

let runAnalysis: () => Promise<void> = async () => undefined;

function analysisSection(): HTMLElement {
  const body = h('tbody');
  const verdict = h('div', { id: 'verdict' });
  const table = h('div.tablewrap', h('table',
    h('thead', h('tr', h('th', '音'), h('th', '種類'), h('th', '長さ ms'), h('th', '出だし ms'), h('th', 'ピーク'), h('th', 'RMS dB'), h('th', '大きさ dB'), h('th', 'スマホ dB'), h('th', '重心 Hz'), h('th', '素のピーク'))),
    body));
  const run = async (): Promise<void> => {
    body.replaceChildren();
    verdict.textContent = '計測中…';
    const report = await analyze((m) => {
      body.append(h('tr',
        h('td', m.id), h('td', m.family), h('td', m.ms), h('td', m.onset),
        h('td', { class: m.peak >= 0.95 || m.peak < 0.004 ? 'bad' : '' }, m.peak.toFixed(3)),
        h('td', m.rms.toFixed(1)),
        h('td', m.loud.toFixed(1), h('span.bar', { style: { width: `${Math.max(0, (m.loud + 60) * 1.6)}px` } })),
        h('td', m.phone.toFixed(1)), h('td', m.centroid), h('td', m.raw.toFixed(3))));
    });
    (window as unknown as { __analysis?: Report }).__analysis = report;
    verdict.replaceChildren(
      h('div', `効果音の音量 1.0 で計測。リミッターの素通しゲイン ${report.unity.toFixed(3)}。`
        + (report.fullMix ? ` 全部同時（曲＋観客＋タッチダウン）のピーク ${report.fullMix.peak.toFixed(3)}。` : '')),
      ...(report.problems.length
        ? report.problems.map((p) => h('div.bad', `✗ ${p}`))
        : [h('div.ok', '✓ 無音なし・クリップなし・短い音は120ms未満・大きさの順番も想定どおり')]));
  };
  runAnalysis = run;
  return h('section.wide', h('h2', '計測'),
    h('p', 'すべての音をオフラインで描き出して、長さ・ピーク・RMS・聞こえの大きさ（K特性、いちばん大きい50ms）・スマホのスピーカーで残る大きさ（400Hz以下を切る）・スペクトル重心・リミッター前のピークを測る。'),
    row(btn('全部を計測する', 'analyze', () => void run(), 'hot')),
    verdict, table);
}

// ---------------------------------------------------------------------------------------------- status and meter

function meter(): void {
  const status = document.getElementById('status')!;
  const canvas = document.getElementById('meter') as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const data = new Float32Array(2048);
  let hold = 0;
  const draw = (): void => {
    requestAnimationFrame(draw);
    const d = audioDebug();
    status.replaceChildren(
      d.unlocked ? h('b', '音は有効') : h('b.off', 'どこかを押すと音が出ます'),
      ` ／ context: ${d.state} ／ 発音数: ${d.voices}`);
    const { width: w, height: ht } = canvas;
    g.fillStyle = '#06081a';
    g.fillRect(0, 0, w, ht);
    if (!d.tap) return;
    d.tap.getFloatTimeDomainData(data);
    let peak = 0;
    g.strokeStyle = '#37e3ff';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i]!;
      peak = Math.max(peak, Math.abs(v));
      const x = (i / data.length) * w, y = ht / 2 - v * (ht / 2);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    hold = Math.max(peak, hold * 0.97);
    g.fillStyle = hold > 0.9 ? '#ff5a7a' : '#ffe14a';
    g.fillRect(0, ht - 8, w * Math.min(1, hold), 8);
    g.fillStyle = '#ff5a7a';
    g.fillRect(w * 0.9, ht - 12, 2, 12);
  };
  draw();
}

// ---------------------------------------------------------------------------------------------- start

const board = document.getElementById('board')!;
board.append(mixSection(), uiSection(), cardSection(), matchSection(), clubSection(), crowdSection(), driveSection(), analysisSection());
meter();

// for scripted checks
(window as unknown as Record<string, unknown>).__lab = { sfx, crowd, se, prefs, playBgm, duck, setMuffled, applyVolumes, toggleMute, vibrate, unlockAudio, audioDebug, analyze, renderOffline, CASES, DRIVE };

// ?analyze=1 measures straight away (offline rendering needs no gesture and does not unlock the live audio)
if (new URLSearchParams(location.search).has('analyze')) void runAnalysis();
