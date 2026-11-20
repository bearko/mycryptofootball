// Development page for auditioning the stadium renderer. Not part of the game and not linked from it.
//
// URL parameters (all optional):
//   auto=1            keep playing a real match by itself
//   speed=1|2|12      playback speed
//   force=longtd|runtd|shorttd|int|sack|bigrun|special|defspecial|fumble|incomplete|stuff   show this outcome first
//   delay=ms          with force: how long to wait before the forced play (default 900)
//   loop=1            with force: repeat the forced play forever
//   preview=inside|outside|short|long|stuff|contain|zone|deep|blitz   chalk this card
//   attract=1         title-screen mode
//   motion=0          reduced motion
//   exc=0..1          crowd excitement
//   safe=none|choose|play|auto   which interface insets to simulate (auto: choose while idle, play during a play)
//   ui=0              hide the control strip
//   q=auto|0.5..1     resolution scale (default auto, like the game; q=1 keeps screenshots sharp on a slow machine)
//   seed=, home=, away= (0..3), pos=, poss=   set up the match

import '@fontsource/dela-gothic-one/japanese-400.css';
import '@fontsource/dela-gothic-one/latin-400.css';
import '@fontsource/dotgothic16/japanese-400.css';
import '@fontsource/dotgothic16/latin-400.css';
import { DEF_INFO, DEF_TYPES, KIND, OFF_INFO, OFF_TYPES, type DefType, type OffType } from '../src/game/cards';
import {
  FIELD, autoPeek, autoPick, createMatch, resolvePlay, specialPick,
  type MatchState, type Pick, type PlayResult,
} from '../src/game/match';
import { opponentSheet } from '../src/game/teams';
import { Stadium, type PlayHooks } from '../src/ui/stadium';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : d);
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const home = opponentSheet(num('home', 3));
const away = opponentSheet(num('away', 0));
let seed = num('seed', 7);
let st: MatchState = createMatch(home, away, seed);
if (q.has('pos')) st.pos = num('pos', st.pos);
if (q.has('poss')) st.poss = num('poss', 0) ? 1 : 0;

const canvas = el<HTMLCanvasElement>('c');
const stadium = new Stadium(canvas, [home, away]);
let speed = num('speed', 1);
let auto = q.get('auto') === '1';
let busy = false;
let motion = q.get('motion') !== '0';
let attract = q.get('attract') === '1';
type Safe = 'none' | 'choose' | 'play' | 'auto';
let safe: Safe = (q.get('safe') as Safe) ?? 'auto';
const log: string[] = [];

if (q.get('ui') === '0') document.body.classList.add('bare');
stadium.setMotion(motion);
let quality: 'auto' | number = !q.has('q') || q.get('q') === 'auto' ? 'auto' : num('q', 1);
stadium.setQuality(quality);
stadium.setExcitement(num('exc', 0.25));

// ------------------------------------------------------------------ simulated interface insets

const insetTop = el('inset-top');
const insetBottom = el('inset-bottom');
function applySafe(phase: 'choose' | 'play'): void {
  const mode = safe === 'auto' ? phase : safe;
  const h = canvas.getBoundingClientRect().height;
  const top = mode === 'none' ? 0 : Math.round(h * 0.14);
  const bottom = mode === 'none' ? 0 : Math.round(h * (mode === 'choose' ? 0.38 : 0.08));
  insetTop.style.height = `${top}px`;
  insetBottom.style.height = `${bottom}px`;
  insetTop.style.display = top ? 'flex' : 'none';
  insetBottom.style.display = bottom ? 'flex' : 'none';
  stadium.setSafeArea(top, bottom);
}
let phase: 'choose' | 'play' = 'choose';
window.addEventListener('resize', () => applySafe(phase));

// ------------------------------------------------------------------ plays

const hooks: PlayHooks = {
  onSnap: () => log.push('snap'),
  onHandoff: () => log.push('handoff'),
  onThrow: (long) => log.push(long ? 'throw-long' : 'throw'),
  onCatch: () => log.push('catch'),
  onDrop: () => log.push('drop'),
  onImpact: (p) => log.push(`impact ${p.toFixed(2)}`),
  onSteal: () => log.push('steal'),
  onBreak: () => log.push('break'),
  onTouchdown: () => log.push('touchdown'),
  onEnd: () => log.push('end'),
};

function real(): PlayResult {
  const o = st.poss;
  const d = (1 - o) as 0 | 1;
  const def0 = autoPick(st, d);
  const off = autoPick(st, o, def0);
  const def = def0.special || off.peeked ? def0 : (autoPeek(st, d, off) ?? def0);
  return resolvePlay(st, off, def);
}

/** A hand-made result on top of the current state (the state itself is left alone). */
function forced(kind: string): PlayResult {
  const o = st.poss;
  const d = (1 - o) as 0 | 1;
  const O = st.teams[o];
  const D = st.teams[d];
  const base: PlayResult = {
    n: st.n + 1, off: o, offPick: { type: 'inside', star: 1 }, defPick: { type: 'zone', star: 1 },
    before: { pos: st.pos, down: st.down, toGo: st.toGo, quarter: st.quarter, left: st.left },
    outcome: 'gain', yards: 4, td: false, firstDown: false, turnover: null, edge: 'even',
    passer: O.lineup.off.QB, carrier: O.lineup.off.RB, defender: D.lineup.def.LB,
    offPotency: 0, defPotency: 0, momBefore: [st.mom[0], st.mom[1]], momAfter: [st.mom[0], st.mom[1]], period: null, lines: [],
  };
  const toGoal = FIELD - st.pos;
  switch (kind) {
    case 'longtd':
      return { ...base, offPick: { type: 'long', star: 3 }, defPick: { type: 'stuff', star: 1 }, yards: toGoal, td: true, carrier: O.lineup.off.WR1, defender: D.lineup.def.S };
    case 'shorttd':
      return { ...base, offPick: { type: 'short', star: 2 }, defPick: { type: 'blitz', star: 1 }, yards: toGoal, td: true, carrier: O.lineup.off.WR2, defender: D.lineup.def.CB2 };
    case 'int':
      return { ...base, offPick: { type: 'long', star: 1 }, defPick: { type: 'deep', star: 3 }, outcome: 'int', yards: 0, turnover: 'int', carrier: O.lineup.off.WR2, defender: D.lineup.def.S };
    case 'sack':
      return { ...base, offPick: { type: 'long', star: 1 }, defPick: { type: 'blitz', star: 3 }, outcome: 'sack', yards: Math.max(-6, 1 - st.pos), defender: D.lineup.def.LB, carrier: O.lineup.off.WR1 };
    case 'bigrun':
      return { ...base, offPick: { type: 'outside', star: 3 }, defPick: { type: 'blitz', star: 1 }, yards: Math.max(3, Math.min(27, toGoal - 3)), defender: D.lineup.def.CB1 };
    case 'runtd':
      return { ...base, offPick: { type: 'outside', star: 3 }, defPick: { type: 'blitz', star: 1 }, yards: toGoal, td: true, defender: D.lineup.def.CB1 };
    case 'fumble':
      return { ...base, offPick: { type: 'inside', star: 1 }, defPick: { type: 'stuff', star: 3 }, outcome: 'fumble', yards: 0, turnover: 'fumble', defender: D.lineup.def.DL1 };
    case 'incomplete':
      return { ...base, offPick: { type: 'short', star: 1 }, defPick: { type: 'zone', star: 2 }, outcome: 'incomplete', yards: 0, carrier: O.lineup.off.WR1, defender: D.lineup.def.CB1 };
    case 'stuff':
      return { ...base, offPick: { type: 'inside', star: 1 }, defPick: { type: 'stuff', star: 3 }, outcome: 'loss', yards: -2, defender: D.lineup.def.DL2 };
    case 'defspecial': {
      const sp = D.specials.find((s) => KIND[s.kind].side === 'def' && s.kind !== 'peekDef');
      if (!sp) return forced('stuff');
      return { ...base, offPick: { type: 'inside', star: 1 }, defPick: specialPick(sp), outcome: 'nogain', yards: 0, defender: sp.owner, defPotency: 1 };
    }
    case 'special': {
      const sp = O.specials.find((s) => KIND[s.kind].side === 'off' && s.kind !== 'peekOff');
      if (!sp) return forced('defspecial');
      const pick = specialPick(sp);
      const pass = pick.type === 'long' || pick.type === 'short';
      const wr = O.lineup.off.WR1 === sp.owner || O.lineup.off.WR2 === sp.owner ? sp.owner : O.lineup.off.WR1;
      return {
        ...base, offPick: pick, defPick: { type: 'contain', star: 1 }, yards: Math.min(pass ? 24 : 16, toGoal - 2),
        carrier: pass ? wr : O.lineup.off.RB, defender: D.lineup.def[pass ? 'S' : 'CB1'], offPotency: 1,
      };
    }
    default:
      return real();
  }
}

async function next(kind?: string): Promise<void> {
  if (busy) return;
  busy = true;
  attract = false;
  const res = kind ? forced(kind) : real();
  log.length = 0;
  phase = 'play';
  applySafe(phase);
  stadium.setExcitement(res.before.pos > 35 ? 0.7 : 0.3);
  await stadium.play(res, speed, hooks);
  if (res.td) {
    stadium.celebrate('td', res.off);
    stadium.setExcitement(1);
  } else if (res.turnover === 'int' || res.turnover === 'fumble') stadium.celebrate('turnover', (1 - res.off) as 0 | 1);
  await wait((res.td ? 2600 : 900) / Math.min(speed, 4));
  if (st.over) {
    stadium.celebrate('win', st.score[0] >= st.score[1] ? 0 : 1);
    await wait(4000 / Math.min(speed, 4));
    seed += 1;
    st = createMatch(home, away, seed);
  }
  stadium.setScene(st);
  stadium.setExcitement(num('exc', 0.25));
  phase = 'choose';
  applySafe(phase);
  busy = false;
}

async function autoLoop(): Promise<void> {
  const first = q.get('force');
  let n = 0;
  while (auto) {
    await wait(busy ? 200 : 1300 / Math.min(speed, 4));
    if (!auto || busy || attract) continue;
    await next(first && (n === 0 || q.get('loop') === '1') ? first : undefined);
    n += 1;
  }
}

function showPreview(type: string | null): void {
  if (!type) {
    stadium.preview(null, 'off', st.poss);
    return;
  }
  const off = (OFF_TYPES as readonly string[]).includes(type);
  if (type === 'special' || type === 'defspecial') {
    const team = st.teams[type === 'special' ? st.poss : 1 - st.poss]!;
    const sp = team.specials.find((s) => KIND[s.kind].side === (type === 'special' ? 'off' : 'def'));
    if (sp) stadium.preview(specialPick(sp), type === 'special' ? 'off' : 'def', st.poss);
    return;
  }
  const pick: Pick = { type: type as OffType | DefType, star: 2 };
  stadium.preview(pick, off ? 'off' : 'def', off ? st.poss : ((1 - st.poss) as 0 | 1));
}

// ------------------------------------------------------------------ control strip

const bar = el('bar');
function btn(label: string, fn: (b: HTMLButtonElement) => void, on = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (on) b.classList.add('on');
  b.addEventListener('click', () => fn(b));
  bar.append(b);
  return b;
}
const sep = (): void => {
  const s = document.createElement('span');
  s.className = 'sep';
  bar.append(s);
};

btn('次のプレー', () => void next());
btn('自動', (b) => {
  auto = !auto;
  b.classList.toggle('on', auto);
  if (auto) void autoLoop();
}, auto);
btn(`速さ ×${speed}`, (b) => {
  speed = speed === 1 ? 2 : speed === 2 ? 12 : 1;
  b.textContent = `速さ ×${speed}`;
});
sep();
for (const [label, kind] of [['ロングTD', 'longtd'], ['ランTD', 'runtd'], ['インターセプト', 'int'], ['サック', 'sack'], ['外ラン大', 'bigrun'], ['特別作戦', 'special'], ['守備の特別', 'defspecial'], ['ファンブル', 'fumble'], ['パス失敗', 'incomplete'], ['ロス', 'stuff']] as const) {
  btn(label, () => void next(kind));
}
sep();
for (const t of OFF_TYPES) btn(OFF_INFO[t].name, () => showPreview(t));
for (const t of DEF_TYPES) btn(DEF_INFO[t].name, () => showPreview(t));
btn('特別(攻)', () => showPreview('special'));
btn('特別(守)', () => showPreview('defspecial'));
btn('消す', () => showPreview(null));
sep();
btn('タイトル用', () => {
  attract = true;
  stadium.attract();
});
btn('試合に戻る', () => {
  attract = false;
  stadium.setScene(st);
});
btn(motion ? '動き：フル' : '動き：ひかえめ', (b) => {
  motion = !motion;
  stadium.setMotion(motion);
let quality: 'auto' | number = !q.has('q') || q.get('q') === 'auto' ? 'auto' : num('q', 1);
stadium.setQuality(quality);
  b.textContent = motion ? '動き：フル' : '動き：ひかえめ';
});
btn(`UIの重なり：${safe}`, (b) => {
  safe = safe === 'auto' ? 'choose' : safe === 'choose' ? 'play' : safe === 'play' ? 'none' : 'auto';
  b.textContent = `UIの重なり：${safe}`;
  applySafe(phase);
});
btn(`解像度：${quality}`, (b) => {
  quality = quality === 'auto' ? 1 : quality === 1 ? 0.7 : 'auto';
  stadium.setQuality(quality);
  b.textContent = `解像度：${quality}`;
});
btn('祝う', () => stadium.celebrate('td', st.poss));
btn('優勝', () => stadium.celebrate('win', 0));
{
  const label = document.createElement('label');
  label.textContent = '盛り上がり ';
  const r = document.createElement('input');
  r.type = 'range';
  r.min = '0';
  r.max = '1';
  r.step = '0.05';
  r.value = String(num('exc', 0.25));
  r.addEventListener('input', () => stadium.setExcitement(Number(r.value)));
  label.append(r);
  bar.append(label);
}

// a name tag that follows the quarterback, to check screenPos()
const info = el('info');
const tag = el('tag');
function tick(): void {
  const s = stadium.stats();
  info.textContent = `${(1000 / Math.max(1, s.avg)).toFixed(0)} fps  frame ${s.avg.toFixed(1)} ms (worst ${s.worst.toFixed(1)})  draw ${s.cpuAvg.toFixed(2)} ms (worst ${s.cpuWorst.toFixed(2)})  particles ${s.particles}  quality ${s.quality.toFixed(2)}\n${log.join(' > ')}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
function follow(): void {
  const id = st.teams[st.poss].lineup.off.QB;
  const p = attract ? null : stadium.screenPos(st.poss, id);
  if (p && !document.body.classList.contains('bare')) {
    tag.style.display = 'block';
    tag.style.left = `${p.x}px`;
    tag.style.top = `${p.y + 4}px`;
    tag.textContent = st.teams[st.poss].players.find((x) => x.id === id)?.name ?? '';
  } else tag.style.display = 'none';
  requestAnimationFrame(follow);
}
requestAnimationFrame(follow);

// ------------------------------------------------------------------ start

applySafe(phase);
if (attract) stadium.attract();
else stadium.setScene(st);
if (q.has('preview')) setTimeout(() => showPreview(q.get('preview')), 300);
if (auto) void autoLoop();
else if (q.has('force')) setTimeout(() => void next(q.get('force')!), num('delay', 900));

Object.assign(window, { __lab: { stadium, next, forced, showPreview, log, state: () => st, stats: () => stadium.stats(), busy: () => busy } });
