// A stand-in for a sensible player, used to check the balance of a season.

import { Rng } from '../src/core/rng';
import { recruit, talentOf } from '../src/game/heroes';
import { bestLineup, isStarter } from '../src/game/lineup';
import { simulate, type MatchState } from '../src/game/match';
import { STATS, type Stat } from '../src/game/model';
import { opponentSheet } from '../src/game/teams';
import {
  STAT_COST, STA_MAX, STA_TIRED, TRUST_LEARN, answerEvent, asPlayer, cardInfo, clubSheet, costOf, finishMatch, intake, joinCount, needOf, newSeason,
  nextMatch, nextYear, plan, policyOpen, setFocus, signRecruits, train,
  type PracticeCard, type Season, type Xp,
} from '../src/game/season';

export type Style = 'sensible' | 'careless';

/** Picks the heroes who join: one of each ability first, then whoever is left. */
function pickRecruits(s: Season, rng: Rng, style: Style): number[] {
  const n = joinCount(s);
  if (style === 'careless') return rng.shuffle(s.candidates).slice(0, n);
  const picked: number[] = [];
  const seen = new Set<Stat>();
  for (const id of rng.shuffle(s.candidates)) {
    const t = talentOf(recruit(id).stats).best;
    if (!seen.has(t)) {
      seen.add(t);
      picked.push(id);
    }
  }
  for (const id of rng.shuffle(s.candidates)) if (picked.length < n && !picked.includes(id)) picked.push(id);
  return picked.slice(0, n);
}

/** How much a practice card is worth to the club today. */
function value(s: Season, card: PracticeCard): number {
  const info = cardInfo(s, card);
  const next = nextMatch(s);
  const eve = !!next && next.n - s.day === 1;
  let v = 0;
  for (const m of s.members) {
    const weight = isStarter(s.lineup!, m.id) ? 1 : 0.4;
    const mine = info.hero === m.id;
    const takesPart = card.kind !== 'solo' || mine;
    if (takesPart) {
      for (const [c, amount] of Object.entries(info.xp)) v += weight * (amount as number) * intake(m.sta) * (c in STAT_COST[m.focus] ? 1 : 0.45);
    }
    // stamina: worth little while fresh, a lot once a hero would be tired (and most of all the day before a match)
    const after = Math.max(0, Math.min(STA_MAX, m.sta + (takesPart ? info.sta : info.others)));
    const short = (x: number): number => Math.max(0, STA_TIRED + 10 - x);
    v += weight * (short(m.sta) - short(after)) * (eve ? 1.2 : 0.55);
    const trust = info.trust + (mine ? info.heroTrust : 0);
    v += weight * trust * (m.trust < TRUST_LEARN ? 1.5 : 0.3);
  }
  return v;
}

/** Chooses each hero's policy: the ability that pays best for where they play, per point of experience. */
function setPolicy(s: Season): void {
  for (const m of s.members) {
    const need = needOf(s.lineup, m);
    let best: Stat = m.focus;
    let bestV = -1;
    for (const k of STATS) {
      const cost = Object.values(costOf(m, k)).reduce((a, b) => a + (b as number), 0);
      const v = (need[k] ?? 0) / cost;
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    setFocus(s, m.id, best);
  }
}

export interface SeasonRun {
  season: Season;
  matches: MatchState[];
}

/** Plays the year the club is in to its end (recruiting first, when a briefing is due). */
function playYear(s: Season, rng: Rng, style: Style, matches: MatchState[]): void {
  if (s.phase === 'recruit') signRecruits(s, pickRecruits(s, rng, style));
  let guard = 0;
  while (s.phase === 'club' && guard < 80) {
    guard += 1;
    const p = plan(s);
    if (p.t === 'train') {
      if (style === 'sensible' && policyOpen(s)) setPolicy(s);
      if (s.event) answerEvent(s, style === 'careless' ? rng.int(0, 1) : 0);
      let pick = rng.int(0, s.hand.length - 1);
      if (style === 'sensible') {
        let best = -1;
        s.hand.forEach((c, i) => {
          const v = value(s, c);
          if (v > best) {
            best = v;
            pick = i;
          }
        });
      }
      train(s, pick);
    } else {
      // a sensible coach looks at the line-up again before every match
      if (style === 'sensible') s.lineup = bestLineup(s.members.map(asPlayer));
      const st = simulate(clubSheet(s), opponentSheet(p.opp, s.league), rng.int(1, 2 ** 31 - 1));
      matches.push(st);
      finishMatch(s, st);
    }
  }
}

/** Plays a whole season with the computer calling the club's plays too. */
export function runSeason(seed: number, style: Style = 'sensible'): SeasonRun {
  const rng = new Rng(seed ^ 0x5eed);
  const s = newSeason(seed);
  const matches: MatchState[] = [];
  playYear(s, rng, style, matches);
  return { season: s, matches };
}

export interface YearLog { year: number; league: number; tier: number; fame: number; members: number; wins: number; played: number; champion: boolean; avg: number }

/** Plays the same club for several years. */
export function runCareer(seed: number, years: number, style: Style = 'sensible'): { season: Season; log: YearLog[] } {
  const rng = new Rng(seed ^ 0x5eed);
  const s = newSeason(seed);
  const log: YearLog[] = [];
  for (let y = 0; y < years; y += 1) {
    if (y > 0) nextYear(s, rng.int(1, 2 ** 31 - 1));
    const league = s.league;
    playYear(s, rng, style, []);
    const on = s.members.filter((m) => isStarter(s.lineup!, m.id));
    log.push({
      year: s.year, league, tier: s.tier, fame: s.fame, members: s.members.length,
      wins: s.results.filter((r) => r.win).length, played: s.results.length, champion: s.champion,
      avg: on.reduce((v, m) => v + STATS.reduce((a, k) => a + m.stats[k], 0) / STATS.length, 0) / Math.max(1, on.length),
    });
  }
  return { season: s, log };
}

export type { Xp };
