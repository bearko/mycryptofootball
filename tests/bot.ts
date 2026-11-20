// A stand-in for a sensible player, used to check the balance of a season.

import { Rng } from '../src/core/rng';
import { simulate, type MatchState } from '../src/game/match';
import { DEF_POS, OFF_POS, ROLE_WEIGHTS, roleOf, type Stat } from '../src/game/model';
import { opponentSheet } from '../src/game/teams';
import {
  GROUPS, PRACTICE, ROSTER_SIZE, SOLO_KEYS, SOLO_PER_WEEK, answerEvent, clubSheet, finishMatch, gainOf, groupMembers, learned,
  newSeason, plan, signRecruits, train, type Member, type PracticeCard, type PracticeKey, type Season, type TrainingChoice,
} from '../src/game/season';
import { talentOf, recruit } from '../src/game/heroes';

/** How much one more point of each ability is worth to this member, given where they play. */
function need(s: Season, m: Member): Partial<Record<Stat, number>> {
  const out: Partial<Record<Stat, number>> = {};
  const l = s.lineup!;
  for (const p of OFF_POS) if (l.off[p] === m.id) for (const [k, w] of Object.entries(ROLE_WEIGHTS[roleOf(p)])) out[k as Stat] = (out[k as Stat] ?? 0) + w;
  for (const p of DEF_POS) if (l.def[p] === m.id) for (const [k, w] of Object.entries(ROLE_WEIGHTS[roleOf(p)])) out[k as Stat] = (out[k as Stat] ?? 0) + w;
  return out;
}

function value(s: Season, m: Member, card: PracticeCard): number {
  const p = PRACTICE[card.key];
  const n = need(s, m);
  if (!p.main) return 0.6 + 0.2 * p.trust;
  return gainOf(m, card) * (n[p.main] ?? 0) + (p.sub ? n[p.sub] ?? 0 : 0) + 0.2 * p.trust;
}

export type Style = 'sensible' | 'careless';

/** Picks seven heroes: one of each ability first, then whoever is left. */
function pickRecruits(s: Season, rng: Rng, style: Style): number[] {
  if (style === 'careless') return rng.shuffle(s.candidates).slice(0, ROSTER_SIZE);
  const picked: number[] = [];
  const seen = new Set<Stat>();
  for (const id of rng.shuffle(s.candidates)) {
    const t = talentOf(recruit(id).stats).best;
    if (!seen.has(t)) {
      seen.add(t);
      picked.push(id);
    }
  }
  for (const id of rng.shuffle(s.candidates)) if (picked.length < ROSTER_SIZE && !picked.includes(id)) picked.push(id);
  return picked.slice(0, ROSTER_SIZE);
}

function chooseTraining(s: Season, rng: Rng, style: Style): TrainingChoice {
  const groups = {} as TrainingChoice['groups'];
  for (const g of GROUPS) {
    const cards = s.deal![g];
    if (style === 'careless') groups[g] = rng.int(0, cards.length - 1);
    else {
      let best = 0;
      let bestV = -1;
      cards.forEach((c, i) => {
        const v = groupMembers(s, g).reduce((sum, m) => sum + value(s, m, c), 0);
        if (v > bestV) {
          bestV = v;
          best = i;
        }
      });
      groups[g] = best;
    }
  }
  const solo: Record<number, PracticeKey> = {};
  if (style === 'sensible') {
    const want = s.members.filter((m) => !learned(m)).sort((a, b) => b.trust - a.trust).slice(0, SOLO_PER_WEEK);
    for (const m of want) {
      solo[m.id] = [...SOLO_KEYS].sort((a, b) => value(s, m, { key: b, star: 2 }) - value(s, m, { key: a, star: 2 }))[0]!;
    }
  }
  return { groups, solo };
}

export interface SeasonRun {
  season: Season;
  matches: MatchState[];
}

/** Plays a whole season with the computer calling the club's plays too. */
export function runSeason(seed: number, style: Style = 'sensible'): SeasonRun {
  const rng = new Rng(seed ^ 0x5eed);
  const s = newSeason(seed);
  signRecruits(s, pickRecruits(s, rng, style));
  const matches: MatchState[] = [];
  let guard = 0;
  while (s.phase === 'club' && guard < 40) {
    guard += 1;
    const p = plan(s);
    if (p.t === 'train') {
      if (s.event) answerEvent(s, style === 'careless' ? rng.int(0, 1) : 0);
      train(s, chooseTraining(s, rng, style));
    } else {
      const st = simulate(clubSheet(s), opponentSheet(p.opp), rng.int(1, 2 ** 31 - 1));
      matches.push(st);
      finishMatch(s, st);
    }
  }
  return { season: s, matches };
}
