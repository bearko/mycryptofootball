// One season of the club: recruiting, daily practice, and the tournament.
// Plain data in, plain data out, so a season can be saved as JSON at any moment.
//
// How practice works:
//  - every hero has a training policy: the one ability they are working on (`focus`). It is set when the season
//    starts and can only be changed at a milestone (see `policyOpen`)
//  - each practice day the coach plays ONE practice card from the hand. A card hands out experience in four
//    colours (power, speed, technique, brains) to the heroes
//  - each hero turns that experience into abilities on their own: first into the policy ability, and whatever
//    colours the policy has no use for into the other abilities their positions need
//  - practice costs stamina. A tired hero (under half) takes in less, and plays a match a little worse;
//    the rest card, always in the hand, brings stamina back

import { Rng, clamp } from '../core/rng';
import { READ_MAX } from './cards';
import { RECRUITS, hero, recruit, specialOf, talentOf } from './heroes';
import { bestKicker, bestLineup, starters, validLineup } from './lineup';
import type { MatchState, TeamSheet } from './match';
import { applyResult, tierOf, type FameChange } from './prestige';
import { ROLE_WEIGHTS, STATS, STAT_LABEL, STAT_MAX, defPos, offPos, rankIndex, roleOf, type Lineup, type Player, type Size, type Stat, type Stats } from './model';

export const ROSTER_SIZE = 7;
export const CANDIDATES = 9;
/** trust at which a hero's special practice card may turn up / the special play is learned / it gets stronger */
export const TRUST_DRILL = 20;
export const TRUST_LEARN = 40;
export const TRUST_BOOST = 80;
export const TRUST_MAX = 100;
/** practice cards dealt to the hand (the rest card, always there, comes on top) */
export const HAND_SIZE = 5;
export const STA_MAX = 100;
/** under this a hero is tired: practice sticks less, and they play a match a little worse */
export const STA_TIRED = 50;
/** stamina a rest day gives back / a starter spends in a match / the others regain while one hero trains alone */
export const REST_STA = 45;
export const MATCH_STA = 10;
const SOLO_REST = 8;
const SOLO_COST = 16;
const DRILL_COST = 12;

export const TEAM_NAME = 'マイクリ学園';
export const TEAM_SHORT = 'マイクリ';
export const TEAM_COLOR = '#ffd84a';

// ------------------------------------------------------------------ the calendar

export interface DayPlan {
  /** 0-based day of the season */
  n: number;
  month: number;
  date: number;
  /** 0 = Monday ... 6 = Sunday */
  dow: number;
  t: 'train' | 'match';
  /** matches only */
  opp: number;
  label: string;
  cup: boolean;
}
export const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;
const MATCHES = [
  { label: '練習試合', cup: false },
  { label: '地区大会 1回戦', cup: true },
  { label: '地区大会 準決勝', cup: true },
  { label: '地区大会 決勝', cup: true },
];

/** Four weeks from Monday, April 5: practice Monday to Saturday, a match every Sunday. */
export const SCHEDULE: readonly DayPlan[] = Array.from({ length: MATCHES.length * 7 }, (_, n) => {
  const day = 5 + n;
  const month = day > 30 ? 5 : 4;
  const dow = n % 7;
  const week = Math.floor(n / 7);
  const match = dow === 6;
  return {
    n, month, date: day > 30 ? day - 30 : day, dow, t: match ? 'match' as const : 'train' as const,
    opp: match ? week : -1, label: match ? MATCHES[week]!.label : '練習', cup: match ? MATCHES[week]!.cup : false,
  };
});
export const dateText = (d: DayPlan): string => `${d.month}月${d.date}日（${DOW[d.dow]}）`;

// ------------------------------------------------------------------ experience

export type Xp = 'pow' | 'spd' | 'tec' | 'int';
export const XPS: readonly Xp[] = ['pow', 'spd', 'tec', 'int'];
export const XP_LABEL: Record<Xp, string> = { pow: 'パワー', spd: 'スピード', tec: 'テクニック', int: 'ずのう' };
export type XpBag = Record<Xp, number>;
const noXp = (): XpBag => ({ pow: 0, spd: 0, tec: 0, int: 0 });

/** How much dearer an ability is while it is not the hero's policy. */
export const OFF_POLICY = 1.6;

/** Experience needed to raise an ability by one point. */
export const STAT_COST: Record<Stat, Partial<XpBag>> = {
  spd: { spd: 10 },
  pas: { tec: 7, int: 3 },
  cat: { tec: 6, spd: 4 },
  blk: { pow: 10 },
  tkl: { pow: 6, spd: 4 },
  iq: { int: 10 },
};

export interface Member {
  id: number;
  stats: Stats;
  trust: number;
  captain: boolean;
  /** experience not yet turned into abilities */
  xp: XpBag;
  /** stamina, 0 to STA_MAX */
  sta: number;
  /** the training policy: the ability this hero is working on */
  focus: Stat;
}

export const tired = (m: Member): boolean => m.sta < STA_TIRED;
/** How much of a practice a hero takes in at this stamina (1 when fresh, down to 0.4 when spent). */
export const intake = (sta: number): number => (sta >= STA_TIRED ? 1 : 0.4 + (0.6 * Math.max(0, sta)) / STA_TIRED);
/** How well a hero plays a match at this stamina (1 when fresh, down to 0.9 when spent). */
export const condition = (sta: number): number => (sta >= STA_TIRED ? 1 : 0.9 + (0.1 * Math.max(0, sta)) / STA_TIRED);

/** What one more point of an ability costs this hero now (the talent is cheap, the weak spot dear, the heights steep). */
export function costOf(m: Member, k: Stat): Partial<XpBag> {
  const { best, worst } = talentOf(recruit(m.id).stats);
  let mul = k === best ? 0.7 : k === worst ? 1.4 : 1;
  if (m.stats[k] >= 90) mul *= 2.6;
  else if (m.stats[k] >= 80) mul *= 1.8;
  // practice aimed at the policy sticks; everything else is picked up along the way, at a price
  if (k !== m.focus) mul *= OFF_POLICY;
  const out: Partial<XpBag> = {};
  for (const [c, v] of Object.entries(STAT_COST[k])) out[c as Xp] = (v as number) * mul;
  return out;
}

function pay(m: Member, k: Stat): boolean {
  if (m.stats[k] >= 99) return false;
  const cost = costOf(m, k);
  for (const [c, v] of Object.entries(cost)) if (m.xp[c as Xp] < (v as number) - 1e-9) return false;
  for (const [c, v] of Object.entries(cost)) m.xp[c as Xp] -= v as number;
  m.stats[k] += 1;
  return true;
}

/** How much each ability matters to a hero where they play now (bench: their talent). */
export function needOf(l: Lineup | null, m: Member): Partial<Stats> {
  const out: Partial<Stats> = {};
  const add = (role: keyof typeof ROLE_WEIGHTS): void => {
    for (const [k, w] of Object.entries(ROLE_WEIGHTS[role])) out[k as Stat] = (out[k as Stat] ?? 0) + (w as number);
  };
  if (l) {
    for (const p of offPos(l)) if (l.off[p] === m.id) add(roleOf(p));
    for (const p of defPos(l)) if (l.def[p] === m.id) add(roleOf(p));
  }
  if (!Object.keys(out).length) out[talentOf(m.stats).best] = 1;
  return out;
}

/** Turns stored experience into abilities, following the hero's policy. Returns the points gained. */
function convert(m: Member, l: Lineup | null): Partial<Stats> {
  const gained: Partial<Stats> = {};
  const up = (k: Stat): void => {
    let guard = 0;
    while (guard < 40 && pay(m, k)) {
      guard += 1;
      gained[k] = (gained[k] ?? 0) + 1;
    }
  };
  // the policy ability first
  up(m.focus);
  // colours the policy has no use for go to the other abilities the hero's positions need
  const reserved = new Set(Object.keys(STAT_COST[m.focus]));
  const need = needOf(l, m);
  const others = STATS.filter((k) => k !== m.focus && !Object.keys(STAT_COST[k]).some((c) => reserved.has(c)))
    .sort((a, b) => (need[b] ?? 0) - (need[a] ?? 0));
  for (const k of others) up(k);
  return gained;
}

// ------------------------------------------------------------------ practice cards

export type PracticeKey = 'dash' | 'pass' | 'catch' | 'hit' | 'tackle' | 'study' | 'game';
export interface Practice {
  name: string;
  xp: Partial<XpBag>;
  /** trust every member gains */
  trust: number;
  /** stamina it costs everyone */
  sta: number;
  text: string;
}
export const PRACTICE: Record<PracticeKey, Practice> = {
  dash: { name: '走りこみ', xp: { spd: 12 }, trust: 0, sta: 14, text: 'ひたすら走る' },
  pass: { name: 'パス練習', xp: { tec: 8, int: 4 }, trust: 0, sta: 10, text: '投げて、投げて、投げる' },
  catch: { name: 'キャッチ練習', xp: { tec: 7, spd: 5 }, trust: 0, sta: 10, text: '走りながら捕る' },
  hit: { name: '当たり稽古', xp: { pow: 12 }, trust: 0, sta: 14, text: '体をぶつけ合う' },
  tackle: { name: 'タックル練習', xp: { pow: 7, spd: 5 }, trust: 0, sta: 14, text: '追いかけて、倒す' },
  study: { name: '作戦会議', xp: { int: 10 }, trust: 1, sta: 3, text: '黒板を囲んで作戦を練る。信頼も少し上がる' },
  game: { name: 'ミニゲーム', xp: { pow: 3, spd: 3, tec: 3, int: 3 }, trust: 2, sta: 10, text: 'みんなで試合形式。信頼が上がる' },
};
export const PRACTICE_KEYS = Object.keys(PRACTICE) as PracticeKey[];
export const STAR_MUL = [0, 1.2, 1.6, 2];

/** The special practice a trusted hero can run, by that hero's talent. */
export const DRILL_NAME: Record<Stat, string> = {
  spd: '鬼ごっこ', pas: '的当て', cat: '空中キャッチ', blk: '押しくらべ', tkl: '一騎打ち', iq: '兵法講義',
};
const DRILL_TOTAL = 31;
const SOLO_TOTAL = 38;
const SOLO_TRUST = 10;

export type PracticeCard =
  /** an ordinary drill for everyone */
  | { uid: number; kind: 'basic'; key: PracticeKey; star: number }
  /** the coach works with one hero alone: a lot of experience for the policy ability, and trust */
  | { uid: number; kind: 'solo'; hero: number }
  /** a trusted hero runs their own special drill for the whole team */
  | { uid: number; kind: 'special'; hero: number }
  /** a day off: no experience, stamina comes back. Always in the hand */
  | { uid: number; kind: 'rest' };

export interface CardInfo {
  name: string;
  text: string;
  /** experience each hero gets (for 'solo': only that hero) */
  xp: Partial<XpBag>;
  /** trust for everyone / extra trust for the card's hero */
  trust: number;
  heroTrust: number;
  hero: number | null;
  star: number;
  /** stamina change for the heroes who take part (negative: it costs) / for the others (one-on-one only) */
  sta: number;
  others: number;
}

/** Spreads an amount of experience over the colours an ability needs. */
function xpFor(k: Stat, total: number): Partial<XpBag> {
  const cost = STAT_COST[k];
  const sum = Object.values(cost).reduce((a, b) => a + (b as number), 0);
  const out: Partial<XpBag> = {};
  for (const [c, v] of Object.entries(cost)) out[c as Xp] = Math.round((total * (v as number)) / sum * 10) / 10;
  return out;
}

export function cardInfo(s: Season, card: PracticeCard): CardInfo {
  if (card.kind === 'basic') {
    const p = PRACTICE[card.key];
    const xp: Partial<XpBag> = {};
    for (const [c, v] of Object.entries(p.xp)) xp[c as Xp] = Math.round((v as number) * STAR_MUL[card.star]! * 10) / 10;
    return { name: p.name, text: p.text, xp, trust: p.trust, heroTrust: 0, hero: null, star: card.star, sta: -p.sta, others: 0 };
  }
  if (card.kind === 'rest') {
    return { name: '休養', text: '練習は休み。全員の体力が戻る', xp: {}, trust: 0, heroTrust: 0, hero: null, star: 0, sta: REST_STA, others: 0 };
  }
  const m = member(s, card.hero);
  const name = hero(card.hero).name;
  if (card.kind === 'solo') {
    return {
      name: 'マンツーマン', text: `${name}とふたりで特訓。${STAT_LABEL[m.focus]}がぐんと伸び、信頼が大きく上がる`,
      xp: xpFor(m.focus, SOLO_TOTAL), trust: 0, heroTrust: SOLO_TRUST, hero: card.hero, star: 0, sta: -SOLO_COST, others: SOLO_REST,
    };
  }
  const talent = talentOf(recruit(card.hero).stats).best;
  return {
    name: DRILL_NAME[talent], text: `${name}の特別練習。全員の${STAT_LABEL[talent]}の経験がどっさり入る`,
    xp: xpFor(talent, DRILL_TOTAL), trust: 1, heroTrust: 2, hero: card.hero, star: 0, sta: -DRILL_COST, others: 0,
  };
}

// ------------------------------------------------------------------ the season

export interface MatchRecord {
  day: number;
  opp: number;
  us: number;
  them: number;
  win: boolean;
}

export interface WeekEvent {
  key: string;
  a: number;
  b: number;
}

export interface Season {
  v: 2;
  seed: number;
  /** state of the season's random generator */
  rs: number;
  phase: 'recruit' | 'club' | 'done';
  candidates: number[];
  members: Member[];
  lineup: Lineup | null;
  /** index into SCHEDULE */
  day: number;
  /** practice cards in hand */
  hand: PracticeCard[];
  /** next card id */
  uid: number;
  /** a milestone: the training policy may be changed until the next practice card is played */
  meeting: boolean;
  event: WeekEvent | null;
  /** events already seen */
  seen: string[];
  results: MatchRecord[];
  /** how often each special play has been called this season */
  usage: Record<string, number>;
  champion: boolean;
  /** every hero's abilities as they stood when the month began (or when he joined): what the month's review compares with */
  base?: Record<number, Stats>;
  /** index into SCHEDULE of the day `base` was taken */
  baseDay?: number;
  /** which year of the club this is (1 = the first) */
  year: number;
  /** the club's standing: an index into TIERS, and the gauge (0..FAME_MAX) */
  tier: number;
  fame: number;
  /** the standing the year began with: it decides the tournament and how strong the other schools are, all year */
  league: number;
  /** a new month has begun: the review of the last one is shown before the day's practice */
  review?: boolean;
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
    v: 2, seed, rs: rng.s, phase: 'recruit', candidates, members: [], lineup: null, day: 0,
    hand: [], uid: 1, meeting: false, event: null, seen: [], results: [], usage: {}, champion: false,
    year: 1, tier: 0, fame: 0, league: 0,
  };
}

const rngOf = (s: Season): Rng => new Rng(s.rs);
const keep = (s: Season, rng: Rng): void => {
  s.rs = rng.s;
};

/** How many heroes sign at this briefing: seven when the club is founded, later as many as its standing has room for. */
export function joinCount(s: Season): number {
  if (!s.members.length) return ROSTER_SIZE;
  return Math.max(0, Math.min(tierOf(s.tier).roster - s.members.length, s.candidates.length));
}

/**
 * How many a side the club plays this year: the tournament of the standing it began the year with decides
 * (six in the district, eleven from the prefecture up). A club too small for eleven plays six.
 */
export const clubSize = (s: Season): Size => (tierOf(s.league).size === 11 && s.members.length >= 11 ? 11 : 6);

/** Makes sure the club has a line-up it can play with this year (the best one, when the old one no longer fits). */
export function fitLineup(s: Season): void {
  const size = clubSize(s);
  if (s.members.length < size) return;
  if (!s.lineup || !validLineup(s.lineup, s.members.map((m) => m.id), size)) s.lineup = bestLineup(s.members.map(asPlayer), size);
}

/**
 * Signs the chosen heroes. When the club is founded the first one picked becomes captain and already trusts the coach.
 * In later years the newcomers join the heroes who are there (and start on the bench).
 */
export function signRecruits(s: Season, ids: number[]): void {
  const want = joinCount(s);
  if (ids.length !== want) throw new Error(`pick ${want} heroes`);
  const rng = rngOf(s);
  const founding = !s.members.length;
  // a school with a name draws better beginners
  const plus = founding ? 0 : tierOf(s.tier).join;
  const joined: Member[] = ids.map((id, i) => {
    const base = recruit(id).stats;
    const stats = { ...base };
    for (const k of STATS) stats[k] = clamp(base[k] + plus, 1, STAT_MAX);
    return {
      id, stats,
      trust: founding && i === 0 ? TRUST_LEARN : rng.int(5, 15),
      captain: founding && i === 0,
      xp: noXp(),
      sta: STA_MAX,
      focus: talentOf(base).best,
    };
  });
  s.members = [...s.members, ...joined];
  s.candidates = [];
  if (founding) s.lineup = null;
  fitLineup(s);
  s.phase = 'club';
  s.day = 0;
  s.meeting = true;
  markMonth(s);
  keep(s, rng);
  startDay(s);
}

/**
 * The season is over: the same club goes into its next year. Everybody stays (and keeps what they have learned);
 * the standing the club has reached decides the tournament, the other schools, and whether new heroes may join.
 */
export function nextYear(s: Season, seed: number): void {
  if (s.phase !== 'done') throw new Error('the season is not over');
  const rng = new Rng(seed);
  s.seed = seed;
  s.year += 1;
  s.league = s.tier;
  s.day = 0;
  s.results = [];
  s.usage = {};
  s.seen = [];
  s.event = null;
  s.champion = false;
  s.hand = [];
  s.review = false;
  for (const m of s.members) m.sta = STA_MAX;
  const room = tierOf(s.tier).roster - s.members.length;
  const have = new Set(s.members.map((m) => m.id));
  const pool = rng.shuffle(RECRUITS.map((r) => r.id).filter((id) => !have.has(id)));
  if (room > 0 && pool.length) {
    // a few more come to the briefing than there is room for, so there is a choice to make
    s.candidates = pool.slice(0, Math.min(pool.length, room + Math.min(3, Math.max(1, Math.round(room / 2)))));
    s.candidates.sort((a, b) => RECRUITS.findIndex((r) => r.id === a) - RECRUITS.findIndex((r) => r.id === b));
    s.phase = 'recruit';
    keep(s, rng);
    return;
  }
  s.candidates = [];
  s.phase = 'club';
  s.meeting = true;
  fitLineup(s);
  markMonth(s);
  keep(s, rng);
  startDay(s);
}

/** The name of a day's match in this club's tournament ("県大会 準決勝"), and the same without the tournament. */
export const cupOf = (s: Season): string => tierOf(s.league).cup;
export const labelOf = (s: Season, d: DayPlan): string => (d.cup ? d.label.replace('地区大会', cupOf(s)) : d.label);
export const roundOf = (d: DayPlan): string => d.label.replace('地区大会 ', '');
/** How many practice cards are dealt each day at the club's standing. */
export const handSize = (s: Season): number => tierOf(s.tier).hand;

// ------------------------------------------------------------------ the month's review

/** Remembers everybody's abilities as they are now: the next review counts from here. */
export function markMonth(s: Season): void {
  s.base = Object.fromEntries(s.members.map((m) => [m.id, { ...m.stats }]));
  s.baseDay = Math.min(s.day, SCHEDULE.length - 1);
  s.review = false;
}

export interface GrowthRow {
  id: number;
  before: Stats;
  after: Stats;
  /** points gained over all six abilities */
  total: number;
  /** abilities whose rank went up */
  ups: Stat[];
}

export interface Growth {
  /** the period looked back on: from this day (index into SCHEDULE) … */
  from: number;
  /** … to this one, inclusive */
  to: number;
  rows: GrowthRow[];
  total: number;
}

/**
 * How everybody has grown since the month began. `closed`: the month is over (the review on the first day of the
 * next month looks back as far as yesterday); otherwise it counts up to today.
 */
export function growth(s: Season, closed = false): Growth {
  const rows: GrowthRow[] = s.members.map((m) => {
    const before = s.base?.[m.id] ?? m.stats;
    return {
      id: m.id, before: { ...before }, after: { ...m.stats },
      total: STATS.reduce((v, k) => v + (m.stats[k] - before[k]), 0),
      ups: STATS.filter((k) => rankIndex(m.stats[k]) > rankIndex(before[k])),
    };
  });
  const today = Math.min(s.day, SCHEDULE.length - 1);
  return { from: Math.min(s.baseDay ?? 0, today), to: closed ? Math.max(0, today - 1) : today, rows, total: rows.reduce((v, r) => v + r.total, 0) };
}

export const asPlayer = (m: Member): Player => ({ id: m.id, name: hero(m.id).name, stats: m.stats });
export const member = (s: Season, id: number): Member => s.members.find((m) => m.id === id)!;
export const learned = (m: Member): boolean => m.trust >= TRUST_LEARN;
export const boosted = (m: Member): boolean => m.trust >= TRUST_BOOST;
export const plan = (s: Season): DayPlan => SCHEDULE[Math.min(s.day, SCHEDULE.length - 1)]!;

/** The next match on the calendar from today on (null after the last one). */
export function nextMatch(s: Season): DayPlan | null {
  for (let d = s.day; d < SCHEDULE.length; d += 1) if (SCHEDULE[d]!.t === 'match') return SCHEDULE[d]!;
  return null;
}

// ------------------------------------------------------------------ the training policy

/** True at a milestone (the season's start, the day after the practice match): the policy may be changed. */
export const policyOpen = (s: Season): boolean => s.phase === 'club' && s.meeting;

export function setFocus(s: Season, id: number, k: Stat): void {
  if (!policyOpen(s)) throw new Error('the training policy can only be changed at a milestone');
  member(s, id).focus = k;
}

export type Preset = 'talent' | 'offense' | 'defense';
export const PRESET_LABEL: Record<Preset, { name: string; text: string }> = {
  talent: { name: '得意を伸ばす', text: '全員、いちばん得意な能力をさらに伸ばす' },
  offense: { name: '攻撃に合わせる', text: '攻撃のポジションでいちばん使う能力を伸ばす' },
  defense: { name: '守備に合わせる', text: '守備のポジションでいちばん使う能力を伸ばす' },
};

/** The ability a preset would give this hero. */
export function presetFocus(s: Season, m: Member, preset: Preset): Stat {
  const talent = talentOf(recruit(m.id).stats).best;
  if (preset === 'talent' || !s.lineup) return talent;
  const positions: readonly string[] = preset === 'offense' ? offPos(s.lineup) : defPos(s.lineup);
  const map: Record<string, number> = preset === 'offense' ? s.lineup.off : s.lineup.def;
  const pos = positions.find((p) => map[p] === m.id);
  if (!pos) return talent;
  const w = ROLE_WEIGHTS[roleOf(pos as Parameters<typeof roleOf>[0])];
  return (Object.keys(w) as Stat[]).sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0))[0]!;
}

export function applyPreset(s: Season, preset: Preset): void {
  if (!policyOpen(s)) throw new Error('the training policy can only be changed at a milestone');
  for (const m of s.members) m.focus = presetFocus(s, m, preset);
}

// ------------------------------------------------------------------ a practice day

function star(rng: Rng): number {
  const r = rng.next();
  return r < 0.45 ? 1 : r < 0.82 ? 2 : 3;
}

function drawCard(s: Season, rng: Rng): PracticeCard {
  const uid = s.uid;
  s.uid += 1;
  const inHand = (kind: string, id: number): boolean => s.hand.some((c) => c.kind === kind && 'hero' in c && c.hero === id);
  // a trusted hero offers their own drill: the more of them, the more often
  const trusted = s.members.filter((m) => m.trust >= TRUST_DRILL && !inHand('special', m.id));
  if (trusted.length && !s.hand.some((c) => c.kind === 'special') && rng.chance(Math.min(0.3, 0.07 * trusted.length))) {
    return { uid, kind: 'special', hero: rng.pick(trusted).id };
  }
  // a chance to work with one hero alone
  if (s.hand.filter((c) => c.kind === 'solo').length < 2 && rng.chance(0.24)) {
    const free = s.members.filter((m) => !inHand('solo', m.id));
    if (free.length) return { uid, kind: 'solo', hero: rng.pick(free).id };
  }
  const count = (key: PracticeKey): number => s.hand.filter((c) => c.kind === 'basic' && c.key === key).length;
  const keys = PRACTICE_KEYS.filter((k) => count(k) === 0);
  return { uid, kind: 'basic', key: rng.pick(keys.length ? keys : PRACTICE_KEYS), star: star(rng) };
}

/** Days on which something happens in the club before practice. */
const EVENT_DAYS = [2, 9, 16, 23];

/** Sets up the day: tops the hand up, maybe an event. */
export function startDay(s: Season): void {
  s.event = null;
  // the first day of a new month: look back at the last one before anything else
  if (s.phase === 'club' && s.day > 0 && s.day < SCHEDULE.length && SCHEDULE[s.day]!.month !== SCHEDULE[s.day - 1]!.month) s.review = true;
  if (s.phase !== 'club' || plan(s).t !== 'train') return;
  const rng = rngOf(s);
  // the rest card is always there, at the end of the hand
  const rest = s.hand.find((c) => c.kind === 'rest') ?? { uid: s.uid++, kind: 'rest' as const };
  s.hand = s.hand.filter((c) => c.kind !== 'rest');
  while (s.hand.length < handSize(s)) s.hand.push(drawCard(s, rng));
  s.hand.push(rest);
  if (EVENT_DAYS.includes(s.day)) {
    const fresh = EVENTS.filter((e) => !s.seen.includes(e.key));
    if (fresh.length) {
      const e = rng.pick(fresh);
      const [a, b] = rng.shuffle(s.members.map((m) => m.id));
      s.event = { key: e.key, a: a!, b: b! };
    }
  }
  keep(s, rng);
}

export interface Change {
  id: number;
  stats: Partial<Stats>;
  trust: number;
  /** stamina gained or spent */
  sta: number;
  learnedNow: boolean;
  boostedNow: boolean;
  /** the hero's special practice became available */
  drillNow: boolean;
}

function grow(m: Member, k: Stat, amount: number): number {
  const before = m.stats[k];
  m.stats[k] = clamp(before + amount, 1, STAT_MAX);
  return m.stats[k] - before;
}

function addSta(m: Member, v: number): number {
  const before = m.sta;
  m.sta = clamp(Math.round(before + v), 0, STA_MAX);
  return m.sta - before;
}

function addTrust(m: Member, v: number): number {
  const before = m.trust;
  m.trust = clamp(before + v, 0, TRUST_MAX);
  return m.trust - before;
}

const blankChange = (id: number): Change => ({ id, stats: {}, trust: 0, sta: 0, learnedNow: false, boostedNow: false, drillNow: false });

function withMilestones(s: Season, run: (changes: Map<number, Change>) => void): Change[] {
  const was = new Map(s.members.map((m) => [m.id, m.trust]));
  const changes = new Map(s.members.map((m) => [m.id, blankChange(m.id)]));
  run(changes);
  for (const m of s.members) {
    const c = changes.get(m.id)!;
    const before = was.get(m.id)!;
    c.learnedNow = before < TRUST_LEARN && m.trust >= TRUST_LEARN;
    c.boostedNow = before < TRUST_BOOST && m.trust >= TRUST_BOOST;
    c.drillNow = before < TRUST_DRILL && m.trust >= TRUST_DRILL;
  }
  return [...changes.values()];
}

export interface DayReport {
  card: PracticeCard;
  info: CardInfo;
  changes: Change[];
}

/** Plays one practice card from the hand: experience, abilities, trust; then the calendar moves on a day. */
export function train(s: Season, index: number): DayReport {
  const card = s.hand[index];
  if (s.phase !== 'club' || plan(s).t !== 'train' || !card) throw new Error('no practice to run');
  if (s.event) throw new Error('answer the event first');
  const info = cardInfo(s, card);
  const changes = withMilestones(s, (ch) => {
    for (const m of s.members) {
      const c = ch.get(m.id)!;
      const mine = info.hero === m.id;
      const takesPart = card.kind !== 'solo' || mine;
      // a tired hero takes in less of the practice
      const share = intake(m.sta);
      if (takesPart) for (const [k, v] of Object.entries(info.xp)) m.xp[k as Xp] += (v as number) * share;
      const got = convert(m, s.lineup);
      for (const [k, v] of Object.entries(got)) c.stats[k as Stat] = (c.stats[k as Stat] ?? 0) + (v as number);
      c.sta += addSta(m, takesPart ? info.sta : info.others);
      // being on the ground together builds a little trust, every other day (a day off is a day off)
      const base = card.kind === 'rest' ? 0 : s.day % 2;
      c.trust += addTrust(m, base + info.trust + (mine ? info.heroTrust : 0));
    }
  });
  s.hand.splice(index, 1);
  s.meeting = false;
  s.day += 1;
  startDay(s);
  return { card, info, changes };
}

/** What playing a card would do, without doing it (for showing who gains what). */
export function previewTrain(s: Season, index: number): Change[] {
  const copy = JSON.parse(JSON.stringify(s)) as Season;
  copy.event = null;
  return train(copy, index).changes;
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
    text: () => '朝からどしゃ降り。グラウンドは水たまりだらけだ。',
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

/** Applies the chosen answer to today's event. */
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
  if (!validLineup(l, s.members.map((m) => m.id), clubSize(s))) throw new Error('invalid line-up');
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
    // tired heroes play a little worse
    players: s.members.map((m) => {
      const c = condition(m.sta);
      const stats = { ...m.stats };
      if (c < 1) for (const k of STATS) stats[k] = Math.max(1, Math.round(stats[k] * c));
      return { ...asPlayer(m), stats };
    }),
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
export function finishMatch(s: Season, st: MatchState): { changes: Change[]; win: boolean; ended: boolean; fame: FameChange } {
  const p = plan(s);
  if (p.t !== 'match') throw new Error('not a match day');
  const win = st.score[0] > st.score[1];
  s.results.push({ day: s.day, opp: p.opp, us: st.score[0], them: st.score[1], win });
  for (const [key, n] of Object.entries(st.totals[0].specials)) s.usage[key] = (s.usage[key] ?? 0) + n;
  const on = starters(s.lineup!);
  const changes = withMilestones(s, (ch) => {
    for (const m of s.members) {
      if (!on.includes(m.id)) continue;
      ch.get(m.id)!.trust += addTrust(m, win ? 4 : 2);
      ch.get(m.id)!.sta += addSta(m, -MATCH_STA);
    }
  }).filter((c) => c.trust !== 0 || c.sta !== 0);
  // the club's standing: the gauge moves with every result
  const fame = applyResult({ tier: s.tier, fame: s.fame }, p.opp, win);
  s.tier = fame.after.tier;
  s.fame = fame.after.fame;
  let ended = false;
  if (p.cup && !win) ended = true;
  if (s.day >= SCHEDULE.length - 1) {
    ended = true;
    s.champion = win && p.cup;
  }
  if (ended) s.phase = 'done';
  else {
    // the practice match is the milestone before the tournament: the policy may be reviewed
    if (!p.cup) s.meeting = true;
    s.day += 1;
    startDay(s);
  }
  return { changes, win, ended, fame };
}

/** Brings a season saved by an earlier version up to date (stamina and the rest card came later). */
export function mend(s: Season): Season {
  for (const m of s.members) if (typeof m.sta !== 'number') m.sta = STA_MAX;
  // the club's standing and its years came later: a season saved before them is the first year of a beginners' club
  if (typeof s.year !== 'number') s.year = 1;
  if (typeof s.tier !== 'number') s.tier = 0;
  if (typeof s.fame !== 'number') s.fame = 0;
  if (typeof s.league !== 'number') s.league = s.tier;
  // eleven a side came later: a club that plays in the prefecture or above gets a line-up of eleven
  if (s.phase !== 'recruit') fitLineup(s);
  // kickers came later still: the club's best foot gets the job
  if (s.lineup && s.lineup.k === undefined) s.lineup.k = bestKicker(s.members.map(asPlayer), s.lineup);
  // a season begun before the month's review existed: it counts from today
  if (s.phase === 'club' && !s.base) markMonth(s);
  if (s.phase === 'club' && plan(s).t === 'train' && !s.hand.some((c) => c.kind === 'rest')) {
    s.hand.push({ uid: s.uid, kind: 'rest' });
    s.uid += 1;
  }
  return s;
}

/** A short description of a change, e.g. "走力 +4". */
export const changeText = (c: Change): string[] => [
  ...STATS.filter((k) => c.stats[k]).map((k) => `${STAT_LABEL[k]} ${c.stats[k]! > 0 ? '+' : ''}${c.stats[k]}`),
  ...(c.trust ? [`信頼 ${c.trust > 0 ? '+' : ''}${c.trust}`] : []),
  ...(c.sta ? [`体力 ${c.sta > 0 ? '+' : ''}${c.sta}`] : []),
];
