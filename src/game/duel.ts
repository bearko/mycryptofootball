// Eleven a side, a match is told through its duels: each team's attacking ace against the other team's defensive ace
// (or two heroes with a history between them: bonds.ts). When the two meet on a play the duel decides a good part of
// it, and its result swings the play both ways. A hero who wins twice in a row (or an ace who breaks away) becomes
// unstoppable — until his rival beats him again, with his own special play or a man-to-man mark.
// Six a side there are no duels. Nothing here rolls dice: the match engine rolls (match.ts).

import { KIND, isRun, type OffType, type SpecialCard } from './cards';
import { hero } from './heroes';
import { rivalLine } from './bonds';
import { defPos, fit, offPos, roleOf, sizeOf, type DefPos, type OffPos, type Role } from './model';
import type { TeamSheet } from './match';

/** A team's two aces: the one who carries its attack, and the one who leads its defense. */
export interface Aces {
  off: number;
  def: number;
}

/** The positions an ace may play. */
export const ACE_OFF: readonly Role[] = ['RB', 'WR', 'TE', 'QB'];
export const ACE_DEF: readonly Role[] = ['LB', 'CB', 'S', 'DL'];

export interface Duel {
  /** the team on offense in this duel (its ace attacks, the other team's hero defends) */
  side: 0 | 1;
  ace: number;
  foe: number;
  /** the duels won by the ace, and by the foe */
  w: number;
  l: number;
  /** how many in a row: positive for the ace, negative for the foe */
  run: number;
  /** the one who cannot be stopped right now */
  beast?: 'ace' | 'foe';
  /** two heroes with a history: what is said when they meet */
  rival?: string;
}

/** How much a duel moves the quality of the play: the winner's side gains this much, the loser's loses it. */
export const DUEL_SWING = 1.3;
/** An unstoppable hero wins this much more often. */
export const BEAST_EDGE = 0.15;
/** Wins in a row that make a hero unstoppable. */
export const BEAST_RUN = 2;

/** The defenders an attacking ace can meet on his plays, the one who usually stops him first. */
export const MARKS: Record<'RB' | 'WR' | 'TE' | 'QB', readonly Role[]> = {
  RB: ['LB', 'DL', 'CB'], WR: ['CB', 'S', 'LB'], TE: ['LB', 'CB', 'S'], QB: ['S', 'CB', 'LB'],
};

/** The kinds of defender a play runs into. */
export const MEETS: Record<OffType, readonly Role[]> = {
  inside: ['DL', 'LB'], outside: ['LB', 'CB'], short: ['CB', 'LB', 'S'], long: ['S', 'CB'],
};

export const offPosOf = (t: TeamSheet, id: number): OffPos | null => offPos(t.lineup).find((p) => t.lineup.off[p] === id) ?? null;
export const defPosOf = (t: TeamSheet, id: number): DefPos | null => defPos(t.lineup).find((p) => t.lineup.def[p] === id) ?? null;

const statsOf = (t: TeamSheet, id: number) => t.players.find((p) => p.id === id)!.stats;

/**
 * The aces a team would pick for itself: the best at an ace's position, a hero with a special play of that unit
 * first. `extra`: something more to weigh (the club weighs how much a hero trusts the coach).
 */
export function suggestAces(t: TeamSheet, extra: (id: number) => number = () => 0): Aces {
  const has = (id: number, side: 'off' | 'def'): boolean => t.specials.some((sp: SpecialCard) => sp.owner === id && KIND[sp.kind].side === side && !sp.tactic);
  const best = <P extends OffPos | DefPos>(list: readonly P[], unit: 'off' | 'def', roles: readonly Role[]): number => {
    let pick = -1;
    let top = -Infinity;
    for (const pos of list) {
      if (!roles.includes(roleOf(pos))) continue;
      const id = (unit === 'off' ? t.lineup.off[pos as OffPos] : t.lineup.def[pos as DefPos])!;
      const v = fit(statsOf(t, id), roleOf(pos)) + (has(id, unit) ? 8 : 0) + extra(id);
      if (v > top) {
        top = v;
        pick = id;
      }
    }
    return pick;
  };
  return { off: best(offPos(t.lineup), 'off', ACE_OFF), def: best(defPos(t.lineup), 'def', ACE_DEF) };
}

/** Is this a pair of aces the team can field (the attacking one at an ace's position of its offense, the other of its defense)? */
export function acesFit(t: TeamSheet, a: Partial<Aces> | undefined): boolean {
  if (!a || a.off == null || a.def == null) return false;
  const o = offPosOf(t, a.off);
  const d = defPosOf(t, a.def);
  return !!o && !!d && ACE_OFF.includes(roleOf(o)) && ACE_DEF.includes(roleOf(d));
}

/** A team's aces in a match: its own choice when it can field it, else its suggestion. */
export const acesOf = (t: TeamSheet): Aces => (acesFit(t, t.aces) ? t.aces! : suggestAces(t));

/**
 * The day's duels: for each team, its attacking ace against the other team's defensive ace. Two heroes with a
 * history between them come first (one of them an ace, if possible). Eleven a side only.
 */
export function setupDuels(teams: [TeamSheet, TeamSheet]): Duel[] {
  if (sizeOf(teams[0].lineup) !== 11) return [];
  return ([0, 1] as const).map((side) => {
    const O = teams[side];
    const D = teams[1 - side]!;
    const ace = acesOf(O).off;
    // the other side's defensive ace, if his position ever meets this ace; else the best of those who usually stop him
    const aceRole = roleOf(offPosOf(O, ace)!) as keyof typeof MARKS;
    const marks = MARKS[aceRole];
    const dAce = acesOf(D).def;
    let foe = dAce;
    if (!marks.includes(roleOf(defPosOf(D, dAce)!))) {
      let top = -Infinity;
      for (const p of defPos(D.lineup)) {
        if (roleOf(p) !== marks[0]) continue;
        const v = fit(statsOf(D, D.lineup.def[p]), roleOf(p));
        if (v > top) {
          top = v;
          foe = D.lineup.def[p];
        }
      }
    }
    // a rivalry: an attacker of this team and a defender of the other with a history between them
    let rival: { ace: number; foe: number; line: string; rank: number } | null = null;
    for (const op of offPos(O.lineup)) {
      if (!ACE_OFF.includes(roleOf(op))) continue;
      const a = O.lineup.off[op];
      for (const dp of defPos(D.lineup)) {
        if (!ACE_DEF.includes(roleOf(dp))) continue;
        const f = D.lineup.def[dp];
        const line = rivalLine(a, f);
        if (!line) continue;
        const rank = (a === ace ? 2 : 0) + (f === foe ? 1 : 0);
        if (!rival || rank > rival.rank) rival = { ace: a, foe: f, line, rank };
      }
    }
    return rival
      ? { side, ace: rival.ace, foe: rival.foe, w: 0, l: 0, run: 0, rival: rival.line }
      : { side, ace, foe, w: 0, l: 0, run: 0 };
  });
}

/** Does this play put the duel's two on each other? The ace has the ball (or throws it), and the play runs at the foe. */
export function meets(t: TeamSheet, foeSide: TeamSheet, du: Duel, type: OffType, carrier: number): boolean {
  const pos = offPosOf(t, du.ace);
  const fp = defPosOf(foeSide, du.foe);
  if (!pos || !fp || !MEETS[type].includes(roleOf(fp))) return false;
  if (du.ace === carrier) return true;
  return roleOf(pos) === 'QB' && !isRun(type);
}

/**
 * How likely the ace is to win the duel: the two heroes' abilities at their positions, the momentum, their own
 * special plays, a mark, and who is unstoppable right now.
 */
export function duelOdds(o: TeamSheet, d: TeamSheet, du: Duel, mom: [number, number], opts: { aceSpecial?: number; foeSpecial?: number; marked?: number } = {}): number {
  const ap = offPosOf(o, du.ace);
  const fp = defPosOf(d, du.foe);
  const a = ap ? fit(statsOf(o, du.ace), roleOf(ap)) : 40;
  const f = fp ? fit(statsOf(d, du.foe), roleOf(fp)) : 40;
  let p = 0.5 + (a - f) / 60 + 0.03 * (mom[du.side] - mom[1 - du.side]!);
  p += 0.15 * (opts.aceSpecial ?? 0);
  p -= 0.2 * (opts.foeSpecial ?? 0);
  p -= 0.2 * (opts.marked ?? 0);
  if (du.beast === 'ace') p += BEAST_EDGE;
  if (du.beast === 'foe') p -= BEAST_EDGE;
  return Math.min(0.92, Math.max(0.08, p));
}

/** A hero's skill as it is named in a duel (his passive skill). */
export const skillOf = (id: number): string => hero(id).passive;

/** How the club has done in its duels so far: won and lost (as the ace, and as the foe). */
export function clubRecord(duels: readonly Duel[] | undefined): { w: number; l: number } {
  let w = 0;
  let l = 0;
  for (const du of duels ?? []) {
    if (du.side === 0) {
      w += du.w;
      l += du.l;
    } else {
      w += du.l;
      l += du.w;
    }
  }
  return { w, l };
}

/** A hero's duels in this match, from his side: won and lost (null when he has none). */
export function heroRecord(duels: readonly Duel[] | undefined, team: 0 | 1, id: number): { w: number; l: number; beast: boolean } | null {
  for (const du of duels ?? []) {
    if (du.side === team && du.ace === id) return { w: du.w, l: du.l, beast: du.beast === 'ace' };
    if (du.side !== team && du.foe === id) return { w: du.l, l: du.w, beast: du.beast === 'foe' };
  }
  return null;
}

/** The heroes unstoppable right now: [team, hero]. */
export function beasts(duels: readonly Duel[] | undefined): { team: 0 | 1; id: number }[] {
  return (duels ?? []).filter((du) => du.beast).map((du) => (du.beast === 'ace' ? { team: du.side, id: du.ace } : { team: (1 - du.side) as 0 | 1, id: du.foe }));
}
