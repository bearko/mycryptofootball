// Who did what: every hero's numbers for a match and for the season (the box score), and the figures a
// scouting sheet gives for a player's body (the 40-yard dash, the bench press). Nothing here uses the match's dice.
//
// A match keeps one box per team (`MatchState.box`), filled after every play by `tally`; when the match is
// over the club's box is added to the season's (`Season.box`, emptied when a new year begins).
//
// What is counted is what the plays say: who threw, who carried or was thrown to, who made the stop.
// A lineman on offense is credited with what his line did while he was in it (the runs behind him, the sacks
// let through). The try after a touchdown counts only as a kick (made or missed), not as yards.

import { isRun, type OffType } from './cards';
import type { MatchState, PlayResult, TeamSheet } from './match';
import { defPos, offPos, roleOf, type Role, type Stats } from './model';

/** One hero's numbers. Every field is optional (a save keeps only what happened). */
export interface Line {
  /** matches played in (counted when a match goes into the season) */
  gp?: number;
  /** plays on the field with the offense / the defense */
  os?: number;
  ds?: number;
  // passing: attempts, completions, yards, touchdowns, interceptions thrown, times sacked
  att?: number;
  cmp?: number;
  py?: number;
  ptd?: number;
  pi?: number;
  sk?: number;
  // running: carries, yards, touchdowns, fumbles lost, longest run
  car?: number;
  ry?: number;
  rtd?: number;
  fum?: number;
  rlong?: number;
  // receiving: times thrown to, catches, yards, touchdowns, longest catch
  tgt?: number;
  rec?: number;
  cy?: number;
  ctd?: number;
  clong?: number;
  // a lineman on offense: the runs behind him (carries, yards) and the sacks let through
  lc?: number;
  ly?: number;
  lsk?: number;
  // defense: tackles, sacks, tackles for a loss, interceptions, passes defended (interceptions too), fumbles taken away
  tk?: number;
  sck?: number;
  tfl?: number;
  int?: number;
  pd?: number;
  ff?: number;
  // kicking: field goals tried / made / longest made, tries after a touchdown tried / made, punts and their yards, kickoffs
  fga?: number;
  fgm?: number;
  fgl?: number;
  xpa?: number;
  xpm?: number;
  pn?: number;
  pny?: number;
  ko?: number;
  // kickoffs run back, and their yards
  kr?: number;
  kry?: number;
}
export type LineKey = keyof Line;
/** fields that keep the best one, not the sum */
const LONGEST: readonly LineKey[] = ['rlong', 'clong', 'fgl'];

/** A box: hero id -> his line. */
export type Box = Record<number, Line>;

const bump = (box: Box, id: number, key: LineKey, by = 1): void => {
  const line = (box[id] ??= {});
  if (LONGEST.includes(key)) line[key] = Math.max(line[key] ?? 0, by);
  else line[key] = (line[key] ?? 0) + by;
};

/** b added into a (a is changed and returned). */
export function addLine(a: Line, b: Line | undefined): Line {
  if (!b) return a;
  for (const [k, v] of Object.entries(b) as [LineKey, number][]) {
    if (typeof v !== 'number') continue;
    a[k] = LONGEST.includes(k) ? Math.max(a[k] ?? 0, v) : (a[k] ?? 0) + v;
  }
  return a;
}
/** The lines of several boxes for one hero, summed. */
export const lineOf = (id: number, ...boxes: (Box | undefined)[]): Line => boxes.reduce<Line>((a, b) => addLine(a, b?.[id]), {});

/** Did this line take part in the match at all? */
export const played = (l: Line | undefined): boolean =>
  !!l && ((l.os ?? 0) + (l.ds ?? 0) + (l.fga ?? 0) + (l.xpa ?? 0) + (l.pn ?? 0) + (l.ko ?? 0) + (l.kr ?? 0)) > 0;

/** Writes what a play did into the match's boxes. Called by resolvePlay after every play. */
export function tally(st: MatchState, res: PlayResult): void {
  const box = (st.box ??= [{}, {}]);
  const o = res.off;
  const d = (1 - o) as 0 | 1;
  const O = st.teams[o];
  const D = st.teams[d];
  const k = res.kick;
  if (k) {
    const kb = box[o];
    if (k.type === 'fg') {
      bump(kb, k.kicker, 'fga');
      if (k.good) {
        bump(kb, k.kicker, 'fgm');
        bump(kb, k.kicker, 'fgl', k.dist);
      }
    } else if (k.type === 'pat') {
      bump(kb, k.kicker, 'xpa');
      if (k.good) bump(kb, k.kicker, 'xpm');
    } else if (k.type === 'punt') {
      bump(kb, k.kicker, 'pn');
      bump(kb, k.kicker, 'pny', k.dist);
    } else {
      bump(kb, k.kicker, 'ko');
      if (k.type === 'kickoff' && k.returner != null && (k.ret ?? 0) > 0) {
        bump(box[d], k.returner, 'kr');
        bump(box[d], k.returner, 'kry', k.ret);
      }
    }
    return;
  }
  // (a try for two points is no part of anybody's yards)
  if (res.tfp) return;
  const ob = box[o];
  const db = box[d];
  const line = offPos(O.lineup).filter((p) => roleOf(p) === 'OL').map((p) => O.lineup.off[p]);
  for (const p of offPos(O.lineup)) bump(ob, O.lineup.off[p], 'os');
  for (const p of defPos(D.lineup)) bump(db, D.lineup.def[p], 'ds');
  const type = res.offPick.type as OffType;
  const y = res.yards;
  const moved = res.outcome === 'gain' || res.outcome === 'nogain' || res.outcome === 'loss';
  if (isRun(type)) {
    bump(ob, res.carrier, 'car');
    bump(ob, res.carrier, 'ry', y);
    bump(ob, res.carrier, 'rlong', y);
    for (const id of line) {
      bump(ob, id, 'lc');
      bump(ob, id, 'ly', y);
    }
    if (res.td) bump(ob, res.carrier, 'rtd');
    if (res.outcome === 'fumble') {
      bump(ob, res.carrier, 'fum');
      bump(db, res.defender, 'ff');
    } else if (moved && !res.td) {
      bump(db, res.defender, 'tk');
      if (y < 0) bump(db, res.defender, 'tfl');
    }
    return;
  }
  if (res.outcome === 'sack') {
    bump(ob, res.passer, 'sk');
    for (const id of line) bump(ob, id, 'lsk');
    bump(db, res.defender, 'sck');
    bump(db, res.defender, 'tk');
    bump(db, res.defender, 'tfl');
    return;
  }
  bump(ob, res.passer, 'att');
  bump(ob, res.carrier, 'tgt');
  if (res.outcome === 'incomplete') bump(db, res.defender, 'pd');
  else if (res.outcome === 'int') {
    bump(ob, res.passer, 'pi');
    bump(db, res.defender, 'int');
    bump(db, res.defender, 'pd');
  } else if (moved) {
    bump(ob, res.passer, 'cmp');
    bump(ob, res.passer, 'py', y);
    bump(ob, res.carrier, 'rec');
    bump(ob, res.carrier, 'cy', y);
    bump(ob, res.carrier, 'clong', y);
    if (res.td) {
      bump(ob, res.passer, 'ptd');
      bump(ob, res.carrier, 'ctd');
    } else bump(db, res.defender, 'tk');
  }
}

/** The club's box of a finished match goes into the season's (and every hero who played gets a match). */
export function bookMatch(season: Box, match: Box | undefined): void {
  if (!match) return;
  for (const [key, l] of Object.entries(match)) {
    const id = Number(key);
    const into = (season[id] ??= {});
    addLine(into, l);
    if (played(l)) into.gp = (into.gp ?? 0) + 1;
  }
}

/**
 * The passer rating the pro game uses (0 to 158.3): completions, yards, touchdowns and interceptions per attempt,
 * each capped. null with no attempts.
 */
export function passerRating(l: Line): number | null {
  const att = l.att ?? 0;
  if (!att) return null;
  const cap = (v: number): number => Math.max(0, Math.min(2.375, v));
  const a = cap(((l.cmp ?? 0) / att - 0.3) * 5);
  const b = cap(((l.py ?? 0) / att - 3) * 0.25);
  const c = cap(((l.ptd ?? 0) / att) * 20);
  const d = cap(2.375 - ((l.pi ?? 0) / att) * 25);
  return Math.round(((a + b + c + d) / 6) * 1000) / 10;
}

/** What a hero does for his team in this match: his positions on each unit, and whether he kicks. */
export function rolesOf(t: TeamSheet, id: number): { off: Role | null; def: Role | null; kicker: boolean } {
  const op = offPos(t.lineup).find((p) => t.lineup.off[p] === id);
  const dp = defPos(t.lineup).find((p) => t.lineup.def[p] === id);
  return { off: op ? roleOf(op) : null, def: dp ? roleOf(dp) : null, kicker: t.lineup.k === id };
}

// ------------------------------------------------------------------ the scouting sheet

/** a small number of his own for every hero (the same every time): two heroes with the same stats still differ a little */
const own = (id: number, salt: number): number => ((((id * 2654435761) ^ (salt * 40503)) >>> 0) % 1000) / 1000 - 0.5;

/**
 * The 40-yard dash, in seconds (two decimals). Speed decides it: a sprinter at the top of the scale runs it in
 * about 4.3, a slow lineman well over 5.
 */
export function forty(stats: Stats, id: number): number {
  const t = 6.05 - stats.spd * 0.0145 + own(id, 1) * 0.1;
  return Math.round(Math.min(6.4, Math.max(4.22, t)) * 100) / 100;
}

/** The bench press, in kilograms (in fives). Blocking and tackling are the strength it shows. */
export function bench(stats: Stats, id: number): number {
  const hi = Math.max(stats.blk, stats.tkl);
  const lo = Math.min(stats.blk, stats.tkl);
  const kg = 40 + (0.6 * hi + 0.4 * lo) * 0.85 + own(id, 2) * 10;
  return Math.max(40, Math.round(kg / 5) * 5);
}
