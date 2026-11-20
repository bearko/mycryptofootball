// One season of the club: recruiting, weekly practice, and the tournament.
// Plain data in, plain data out, so a season can be saved as JSON at any moment.

import { Rng, clamp } from '../core/rng';
import { READ_MAX } from './cards';
import { RECRUITS, hero, recruit, specialOf, talentOf } from './heroes';
import { bestLineup, starters, validLineup } from './lineup';
import type { MatchState, TeamSheet } from './match';
import { OFF_POS, STATS, STAT_LABEL, roleOf, type Lineup, type Player, type Stat, type Stats } from './model';

export const ROSTER_SIZE = 7;
export const CANDIDATES = 9;
export const TRUST_LEARN = 40;
export const TRUST_BOOST = 80;
export const TRUST_MAX = 100;
export const SOLO_PER_WEEK = 2;
/** trust gained from a week of group practice / from a one-on-one session */
export const GROUP_TRUST = 2;
export const SOLO_TRUST = 12;

export const TEAM_NAME = 'マイクリ学園';
export const TEAM_SHORT = 'マイクリ';
export const TEAM_COLOR = '#ffd84a';

export type WeekPlan = { t: 'train' } | { t: 'match'; opp: number; label: string; cup: boolean };
export const SCHEDULE: readonly WeekPlan[] = [
  { t: 'train' },
  { t: 'train' },
  { t: 'match', opp: 0, label: '練習試合', cup: false },
  { t: 'train' },
  { t: 'train' },
  { t: 'match', opp: 1, label: '地区大会 1回戦', cup: true },
  { t: 'train' },
  { t: 'match', opp: 2, label: '地区大会 準決勝', cup: true },
  { t: 'train' },
  { t: 'match', opp: 3, label: '地区大会 決勝', cup: true },
];

export interface Member {
  id: number;
  stats: Stats;
  trust: number;
  captain: boolean;
}

export interface MatchRecord {
  week: number;
  opp: number;
  us: number;
  them: number;
  win: boolean;
}

// ------------------------------------------------------------------ practice

export type PracticeKey = 'dash' | 'pass' | 'catch' | 'hit' | 'tackle' | 'study' | 'game';
export interface Practice {
  name: string;
  main: Stat | null;
  sub: Stat | null;
  trust: number;
  text: string;
}
export const PRACTICE: Record<PracticeKey, Practice> = {
  dash: { name: '走りこみ', main: 'spd', sub: null, trust: 0, text: '走力が上がる' },
  pass: { name: 'パス練習', main: 'pas', sub: 'cat', trust: 0, text: 'パスが上がる。捕球も少し' },
  catch: { name: 'キャッチ練習', main: 'cat', sub: 'spd', trust: 0, text: '捕球が上がる。走力も少し' },
  hit: { name: '当たり稽古', main: 'blk', sub: 'tkl', trust: 0, text: 'ブロックが上がる。タックルも少し' },
  tackle: { name: 'タックル練習', main: 'tkl', sub: 'blk', trust: 0, text: 'タックルが上がる。ブロックも少し' },
  study: { name: '作戦会議', main: 'iq', sub: null, trust: 2, text: '判断が上がる。信頼も少し' },
  game: { name: 'ミニゲーム', main: null, sub: null, trust: 5, text: '全能力が少しずつ上がり、信頼が大きく上がる' },
};
export const PRACTICE_KEYS = Object.keys(PRACTICE) as PracticeKey[];
/** What a one-on-one session can be. */
export const SOLO_KEYS: PracticeKey[] = ['dash', 'pass', 'catch', 'hit', 'tackle', 'study'];

export type Group = 'backs' | 'recv' | 'line';
export const GROUPS: readonly Group[] = ['backs', 'recv', 'line'];
export const GROUP_LABEL: Record<Group, string> = { backs: 'バックス', recv: 'レシーバー', line: 'ライン' };
export const GROUP_HINT: Record<Group, string> = { backs: '司令塔・ランナー', recv: 'パスを捕る2人', line: '壁になる2人' };

export interface PracticeCard {
  key: PracticeKey;
  star: number;
}

export interface WeekEvent {
  key: string;
  a: number;
  b: number;
}

export interface Season {
  v: 1;
  seed: number;
  /** state of the season's random generator */
  rs: number;
  phase: 'recruit' | 'club' | 'done';
  candidates: number[];
  members: Member[];
  lineup: Lineup | null;
  week: number;
  /** this week's dealt practice cards, per group */
  deal: Record<Group, PracticeCard[]> | null;
  event: WeekEvent | null;
  /** events already seen */
  seen: string[];
  results: MatchRecord[];
  /** how often each special play has been called this season */
  usage: Record<string, number>;
  champion: boolean;
}

// ------------------------------------------------------------------ start and recruiting

export function newSeason(seed: number): Season {
  const rng = new Rng(seed);
  // nine of the twelve come to the briefing; every ability is represented at least once
  let candidates: number[] = [];
  for (;;) {
    candidates = rng.shuffle(RECRUITS.map((r) => r.id)).slice(0, CANDIDATES);
    const talents = new Set(candidates.map((id) => talentOf(recruit(id).stats).best));
    if (talents.size === STATS.length) break;
  }
  candidates.sort((a, b) => RECRUITS.findIndex((r) => r.id === a) - RECRUITS.findIndex((r) => r.id === b));
  return {
    v: 1, seed, rs: rng.s, phase: 'recruit', candidates, members: [], lineup: null, week: 0,
    deal: null, event: null, seen: [], results: [], usage: {}, champion: false,
  };
}

const rngOf = (s: Season): Rng => new Rng(s.rs);
const keep = (s: Season, rng: Rng): void => {
  s.rs = rng.s;
};

/** Signs the chosen heroes. The first one picked becomes captain and already trusts the coach. */
export function signRecruits(s: Season, ids: number[]): void {
  if (ids.length !== ROSTER_SIZE) throw new Error(`pick ${ROSTER_SIZE} heroes`);
  const rng = rngOf(s);
  s.members = ids.map((id, i) => ({
    id,
    stats: { ...recruit(id).stats },
    trust: i === 0 ? TRUST_LEARN : rng.int(5, 15),
    captain: i === 0,
  }));
  s.lineup = bestLineup(s.members.map(asPlayer));
  s.phase = 'club';
  s.week = 0;
  keep(s, rng);
  startWeek(s);
}

export const asPlayer = (m: Member): Player => ({ id: m.id, name: hero(m.id).name, stats: m.stats });
export const member = (s: Season, id: number): Member => s.members.find((m) => m.id === id)!;
export const learned = (m: Member): boolean => m.trust >= TRUST_LEARN;
export const boosted = (m: Member): boolean => m.trust >= TRUST_BOOST;
export const plan = (s: Season): WeekPlan => SCHEDULE[Math.min(s.week, SCHEDULE.length - 1)]!;

/** The next match on the calendar from this week on (null after the last one). */
export function nextMatch(s: Season): (WeekPlan & { t: 'match' }) | null {
  for (let w = s.week; w < SCHEDULE.length; w += 1) {
    const p = SCHEDULE[w]!;
    if (p.t === 'match') return p;
  }
  return null;
}

// ------------------------------------------------------------------ the week

/** Which practice group each member belongs to: by position for starters, by talent for the bench. */
export function groupOf(s: Season, id: number): Group {
  const l = s.lineup!;
  const pos = OFF_POS.find((p) => l.off[p] === id);
  if (pos) {
    const role = roleOf(pos);
    return role === 'WR' ? 'recv' : role === 'OL' ? 'line' : 'backs';
  }
  const best = talentOf(member(s, id).stats).best;
  return best === 'cat' ? 'recv' : best === 'blk' || best === 'tkl' ? 'line' : 'backs';
}

export const groupMembers = (s: Season, g: Group): Member[] => s.members.filter((m) => groupOf(s, m.id) === g);

function star(rng: Rng): number {
  const r = rng.next();
  return r < 0.45 ? 1 : r < 0.82 ? 2 : 3;
}

/** What each group's practice most naturally is; one of these is always on offer. */
const GROUP_CORE: Record<Group, PracticeKey[]> = {
  backs: ['dash', 'pass', 'study'],
  recv: ['catch', 'dash'],
  line: ['hit', 'tackle'],
};

/** Sets up the week: deals practice cards and maybe an event (training weeks only). */
export function startWeek(s: Season): void {
  s.deal = null;
  s.event = null;
  if (plan(s).t !== 'train') return;
  const rng = rngOf(s);
  const deal = {} as Record<Group, PracticeCard[]>;
  for (const g of GROUPS) {
    const core = rng.pick(GROUP_CORE[g]);
    const rest = rng.shuffle(PRACTICE_KEYS.filter((k) => k !== core)).slice(0, 2);
    deal[g] = [core, ...rest].map((key) => ({ key, star: star(rng) }));
  }
  s.deal = deal;
  const fresh = EVENTS.filter((e) => !s.seen.includes(e.key));
  if (fresh.length && s.week > 0) {
    const e = rng.pick(fresh);
    const [a, b] = rng.shuffle(s.members.map((m) => m.id));
    s.event = { key: e.key, a: a!, b: b! };
  }
  keep(s, rng);
}

export interface Change {
  id: number;
  stats: Partial<Stats>;
  trust: number;
  learnedNow: boolean;
  boostedNow: boolean;
}

function grow(m: Member, k: Stat, amount: number): number {
  const before = m.stats[k];
  let v = amount;
  if (before >= 80) v = Math.max(1, Math.round(v / 2));
  m.stats[k] = clamp(before + v, 1, 99);
  return m.stats[k] - before;
}

function addTrust(m: Member, v: number): number {
  const before = m.trust;
  m.trust = clamp(before + v, 0, TRUST_MAX);
  return m.trust - before;
}

/** How much a practice card raises its main ability for this hero. */
export function gainOf(m: Member, card: PracticeCard): number {
  const p = PRACTICE[card.key];
  if (!p.main) return 1;
  const { best, worst } = talentOf(m.stats);
  const apt = p.main === best ? 1.4 : p.main === worst ? 0.6 : 1;
  return Math.max(1, Math.round((2 + card.star) * apt));
}

function practice(m: Member, card: PracticeCard, change: Change): void {
  const p = PRACTICE[card.key];
  const add = (k: Stat, v: number): void => {
    const got = grow(m, k, v);
    if (got) change.stats[k] = (change.stats[k] ?? 0) + got;
  };
  if (p.main) add(p.main, gainOf(m, card));
  else for (const k of STATS) add(k, card.star >= 3 ? 2 : 1);
  if (p.sub) add(p.sub, card.star >= 3 ? 2 : 1);
}

export interface TrainingChoice {
  /** index of the dealt card chosen for each group */
  groups: Record<Group, number>;
  /** one-on-one sessions: member id -> practice (at most SOLO_PER_WEEK) */
  solo: Record<number, PracticeKey>;
}

const blankChange = (id: number): Change => ({ id, stats: {}, trust: 0, learnedNow: false, boostedNow: false });

function withMilestones(s: Season, run: (changes: Map<number, Change>) => void): Change[] {
  const was = new Map(s.members.map((m) => [m.id, { l: learned(m), b: boosted(m) }]));
  const changes = new Map(s.members.map((m) => [m.id, blankChange(m.id)]));
  run(changes);
  for (const m of s.members) {
    const c = changes.get(m.id)!;
    c.learnedNow = !was.get(m.id)!.l && learned(m);
    c.boostedNow = !was.get(m.id)!.b && boosted(m);
  }
  return [...changes.values()];
}

/** Runs the week's practice and moves on to the next week. */
export function train(s: Season, choice: TrainingChoice): Change[] {
  if (plan(s).t !== 'train' || !s.deal) throw new Error('not a practice week');
  const soloIds = Object.keys(choice.solo).map(Number);
  if (soloIds.length > SOLO_PER_WEEK) throw new Error('too many one-on-one sessions');
  const deal = s.deal;
  const out = withMilestones(s, (changes) => {
    for (const m of s.members) {
      const c = changes.get(m.id)!;
      const solo = choice.solo[m.id];
      if (solo) {
        practice(m, { key: solo, star: 2 }, c);
        c.trust += addTrust(m, SOLO_TRUST + PRACTICE[solo].trust);
      } else {
        const card = deal[groupOf(s, m.id)][choice.groups[groupOf(s, m.id)]]!;
        practice(m, card, c);
        c.trust += addTrust(m, GROUP_TRUST + PRACTICE[card.key].trust);
      }
    }
  });
  s.week += 1;
  startWeek(s);
  return out;
}

// ------------------------------------------------------------------ events

export interface EventChoice {
  label: string;
  /** what it does, shown on the button */
  note: string;
  run: (s: Season, e: WeekEvent, add: (id: number, what: Stat | 'trust' | 'best', v: number) => void) => void;
}
export interface EventDef {
  key: string;
  title: string;
  text: (a: string, b: string) => string;
  choices: EventChoice[];
}

const everyone = (s: Season, f: (id: number) => void): void => s.members.forEach((m) => f(m.id));

export const EVENTS: readonly EventDef[] = [
  {
    key: 'late',
    title: '居残り練習',
    text: (a) => `日が暮れても、${a}がひとりでグラウンドに残っている。`,
    choices: [
      { label: '最後まで付き合う', note: '信頼 +10', run: (_s, e, add) => add(e.a, 'trust', 10) },
      { label: 'そっと見守る', note: '得意な能力 +3', run: (_s, e, add) => add(e.a, 'best', 3) },
    ],
  },
  {
    key: 'quarrel',
    title: '言い争い',
    text: (a, b) => `${a}と${b}が、練習のやり方で言い争っている。`,
    choices: [
      { label: 'ふたりの話を聞く', note: 'ふたりの信頼 +6', run: (_s, e, add) => { add(e.a, 'trust', 6); add(e.b, 'trust', 6); } },
      { label: '走って頭を冷やさせる', note: 'ふたりの走力 +3、信頼 -2', run: (_s, e, add) => {
        for (const id of [e.a, e.b]) { add(id, 'spd', 3); add(id, 'trust', -2); }
      } },
    ],
  },
  {
    key: 'gift',
    title: '差し入れ',
    text: () => '商店街のみなさんから、おにぎりの差し入れが届いた。',
    choices: [
      { label: 'みんなで食べる', note: '全員の信頼 +4', run: (s, _e, add) => everyone(s, (id) => add(id, 'trust', 4)) },
      { label: '食べたら筋トレだ', note: '全員のブロック・タックル +1、信頼 +1', run: (s, _e, add) => everyone(s, (id) => {
        add(id, 'blk', 1); add(id, 'tkl', 1); add(id, 'trust', 1);
      }) },
    ],
  },
  {
    key: 'rain',
    title: '雨の日',
    text: () => '朝からどしゃ降り。グラウンドは使えそうにない。',
    choices: [
      { label: '部室で作戦の勉強', note: '全員の判断 +2', run: (s, _e, add) => everyone(s, (id) => add(id, 'iq', 2)) },
      { label: '廊下でダッシュ', note: '全員の走力 +2', run: (s, _e, add) => everyone(s, (id) => add(id, 'spd', 2)) },
    ],
  },
  {
    key: 'idea',
    title: 'ひらめき',
    text: (a) => `${a}が、ノートを手に駆けこんできた。「監督、いい作戦を思いついたんです！」`,
    choices: [
      { label: 'じっくり聞く', note: '信頼 +15', run: (_s, e, add) => add(e.a, 'trust', 15) },
      { label: 'みんなに発表させる', note: '本人の信頼 +8、全員の判断 +1', run: (s, e, add) => {
        add(e.a, 'trust', 8);
        everyone(s, (id) => add(id, 'iq', 1));
      } },
    ],
  },
  {
    key: 'slump',
    title: '伸び悩み',
    text: (a) => `${a}が、うまくいかない練習に肩を落としている。`,
    choices: [
      { label: '得意を伸ばそうと励ます', note: '得意な能力 +2、信頼 +5', run: (_s, e, add) => { add(e.a, 'best', 2); add(e.a, 'trust', 5); } },
      { label: '基礎からやり直す', note: '全能力 +1', run: (_s, e, add) => STATS.forEach((k) => add(e.a, k, 1)) },
    ],
  },
];

export const eventDef = (key: string): EventDef => EVENTS.find((e) => e.key === key)!;

/** Applies the chosen answer to this week's event. */
export function answerEvent(s: Season, choice: number): Change[] {
  const e = s.event;
  if (!e) return [];
  const def = eventDef(e.key);
  const out = withMilestones(s, (changes) => {
    def.choices[choice]!.run(s, e, (id, what, v) => {
      const m = member(s, id);
      const c = changes.get(id)!;
      if (what === 'trust') c.trust += addTrust(m, v);
      else {
        const k = what === 'best' ? talentOf(m.stats).best : what;
        const got = grow(m, k, v);
        if (got) c.stats[k] = (c.stats[k] ?? 0) + got;
      }
    });
  });
  s.seen.push(e.key);
  s.event = null;
  return out.filter((c) => c.trust !== 0 || Object.keys(c.stats).length > 0);
}

// ------------------------------------------------------------------ matches

/** The club as the match engine sees it. */
export function clubSheet(s: Season): TeamSheet {
  const l = s.lineup!;
  if (!validLineup(l, s.members.map((m) => m.id))) throw new Error('invalid line-up');
  const p = plan(s);
  const scouted: Record<string, number> = {};
  if (p.t === 'match' && p.opp >= 2) {
    // the stronger schools have watched the club's games: its favorite plays are no longer new to them
    const top = Object.entries(s.usage).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
    for (const [key] of top.slice(0, p.opp - 1)) scouted[key] = Math.min(READ_MAX, 1);
  }
  return {
    name: TEAM_NAME,
    short: TEAM_SHORT,
    color: TEAM_COLOR,
    players: s.members.map(asPlayer),
    lineup: l,
    specials: s.members.filter(learned).map((m) => specialOf(m.id, recruit(m.id).kind, boosted(m))),
    runBias: 0.5,
    smart: 0.7,
    scouted,
  };
}

/** Which of the club's special plays the coming opponent has studied. */
export const scoutedKeys = (s: Season): string[] => Object.keys(clubSheet(s).scouted ?? {});

/** Books a finished match (the club is team 0) and moves the calendar on. */
export function finishMatch(s: Season, st: MatchState): { changes: Change[]; win: boolean; ended: boolean } {
  const p = plan(s);
  if (p.t !== 'match') throw new Error('not a match week');
  const win = st.score[0] > st.score[1];
  s.results.push({ week: s.week, opp: p.opp, us: st.score[0], them: st.score[1], win });
  for (const [key, n] of Object.entries(st.totals[0].specials)) s.usage[key] = (s.usage[key] ?? 0) + n;
  const on = starters(s.lineup!);
  const changes = withMilestones(s, (ch) => {
    for (const m of s.members) {
      if (!on.includes(m.id)) continue;
      ch.get(m.id)!.trust += addTrust(m, win ? 4 : 2);
    }
  }).filter((c) => c.trust !== 0);
  let ended = false;
  if (p.cup && !win) ended = true;
  if (s.week >= SCHEDULE.length - 1) {
    ended = true;
    s.champion = win && p.cup;
  }
  if (ended) s.phase = 'done';
  else {
    s.week += 1;
    startWeek(s);
  }
  return { changes, win, ended };
}

/** A short description of a change, e.g. "走力 +4". */
export const changeText = (c: Change): string[] => [
  ...STATS.filter((k) => c.stats[k]).map((k) => `${STAT_LABEL[k]} ${c.stats[k]! > 0 ? '+' : ''}${c.stats[k]}`),
  ...(c.trust ? [`信頼 ${c.trust > 0 ? '+' : ''}${c.trust}`] : []),
];
