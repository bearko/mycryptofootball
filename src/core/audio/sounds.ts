// Every effect in the game, written as a small score for the kit. Each recipe gets the engine and a start time
// and schedules everything up front (no timers), so the same code runs live and in an offline render.
//
// Pitches are semitones from middle C. The key is C: C-E-G wherever a sound is "good", E-flat and A-flat when it is not.

import { clamp, duckMusic, noise, rnd, sample, tone, type Engine } from './engine';
import { bass, bell, blip, brass, chalk, cymbal, flam, flick, pop, rim, roll, slap, snare, swell, swish, thud, tom, whistle, whoosh } from './kit';

const C = 0, D = 2, Eb = 3, E = 4, F = 5, G = 7, Ab = 8, A = 9, Bb = 10;
const lo = (n: number): number => n - 12;
const hi = (n: number): number => n + 12;

// round-robin counters, so a repeated sound is never the same sound twice
let rr = 0;
const turn = <T>(list: readonly T[]): T => list[(rr += 1) % list.length]!;

/** The fanfare used when the sampled jingles are missing. */
function fanfare(e: Engine, t: number, v: number): void {
  brass(e, t, [lo(Ab), C, Eb, hi(C)], 0.19, v * 0.9);
  brass(e, t + 0.24, [lo(Bb), D, F, hi(D)], 0.19, v * 0.95);
  brass(e, t + 0.48, [lo(C), C, E, G, hi(E)], 1.05, v, { vib: true, verb: 0.25 });
  brass(e, t + 0.8, [hi(G)], 0.7, v * 0.7, { vib: true, verb: 0.25 });
}

function sadFigure(e: Engine, t: number, v: number): void {
  brass(e, t, [G], 0.2, v, { bright: 0.6, soft: true });
  brass(e, t + 0.24, [F], 0.2, v, { bright: 0.55, soft: true });
  brass(e, t + 0.48, [Eb], 0.2, v, { bright: 0.5, soft: true });
  brass(e, t + 0.72, [lo(C), lo(G), C], 0.7, v, { bright: 0.5, soft: true, fall: true, verb: 0.25 });
}

export const R = {
  // ------------------------------------------------------------------------------------------ interface
  hover(e: Engine, t: number): void {
    rim(e, t, 0.13, turn([1.12, 1.2, 1.06]));
  },
  tap(e: Engine, t: number): void {
    const p = turn([1, 1.05, 0.96]);
    rim(e, t, 0.62, p);
    tone(e, { t, f: 392 * p, f2: 330 * p, dur: 0.04, peak: 0.1, type: 'triangle', a: 0.001 });
  },
  back(e: Engine, t: number): void {
    tom(e, t, lo(G), 0.42, 0.6);
    tom(e, t + 0.07, lo(C), 0.5, 0.75);
  },
  deny(e: Engine, t: number): void {
    // "uh-uh": two muted low blats a semitone apart, on a damped drum
    for (const [at, v] of [[0, 0.7], [0.13, 0.6]] as const) {
      brass(e, t + at, [lo(C), lo(C) + 1], 0.07, v * 0.46, { bright: 0.8, verb: 0.03 });
      tom(e, t + at, lo(C), 0.36, 0.45);
    }
  },
  toggle(e: Engine, t: number, on: boolean): void {
    rim(e, t, 0.35, on ? 0.95 : 1.1);
    tom(e, t, on ? lo(G) : C, 0.34, 0.5);
    tom(e, t + 0.065, on ? C : lo(G), 0.44, 0.55);
  },
  open(e: Engine, t: number): void {
    swish(e, t, 0.6, true, 0.09);
    rim(e, t + 0.07, 0.42);
    tom(e, t + 0.07, E, 0.44, 0.7);
  },
  close(e: Engine, t: number): void {
    swish(e, t, 0.5, false, 0.09);
    cymbal(e, t + 0.03, 0.55, 0, true);
    tom(e, t + 0.03, lo(C), 0.32, 0.6);
  },
  transition(e: Engine, t: number): void {
    roll(e, t, 0.26, 0.15, 0.6);
    snare(e, t + 0.27, 0.6);
    bass(e, t + 0.27, 0.5);
    cymbal(e, t + 0.27, 0.5, 0.75);
  },
  pageTurn(e: Engine, t: number): void {
    swish(e, t, 0.62, true, 0.13);
    flick(e, t + 0.11, 0.3, 0.8);
  },
  typeTick(e: Engine, t: number): void {
    blip(e, t, turn([hi(hi(C)), hi(hi(C)), hi(G), hi(hi(C)), hi(hi(E))]), 0.42);
  },
  countTick(e: Engine, t: number): void {
    rim(e, t, 0.16, 1.3);
    bell(e, t, hi(hi(turn([G, G, hi(C)]))), 0.3, 0.07);
  },
  stamp(e: Engine, t: number): void {
    bass(e, t, 0.8, true);
    slap(e, t, 0.8, true);
    snare(e, t, 0.5);
    cymbal(e, t, 0.4, 0, true);
  },
  swap(e: Engine, t: number): void {
    flick(e, t, 0.5, 0.9);
    tom(e, t, lo(G), 0.32, 0.5);
    flick(e, t + 0.075, 0.5, 1.25);
    tom(e, t + 0.075, C, 0.4, 0.5);
  },
  drag(e: Engine, t: number): void {
    flick(e, t, 0.36, 1.3);
    swish(e, t, 0.25, true, 0.06);
  },
  drop(e: Engine, t: number): void {
    slap(e, t, 0.7);
    tom(e, t, lo(C), 0.34, 0.5);
  },

  // ------------------------------------------------------------------------------------------ cards
  cardDeal(e: Engine, t: number, index: number): void {
    const i = clamp(index, 0, 12);
    flick(e, t, 0.55, 1 + i * 0.065);
    rim(e, t + 0.004, 0.16, 0.9 + i * 0.07);
  },
  cardHover(e: Engine, t: number): void {
    flick(e, t, 0.2, rnd(1.1, 1.3));
  },
  cardPick(e: Engine, t: number): void {
    flick(e, t, 0.4, 1.1);
    flam(e, t, 0.5);
    tom(e, t + 0.03, E, 0.3, 0.5);
  },
  cardConfirm(e: Engine, t: number): void {
    bass(e, t, 0.55);
    slap(e, t, 0.6, true);
    snare(e, t, 0.36);
    brass(e, t + 0.005, [C, G, hi(C)], 0.1, 0.5);
  },
  cardFlip(e: Engine, t: number): void {
    swish(e, t, 0.6, true, 0.09);
    slap(e, t + 0.1, 0.62);
    flick(e, t + 0.1, 0.3, 0.9);
  },
  clash(e: Engine, t: number, edge: 'good' | 'bad' | 'even'): void {
    // the hit is the same for everyone; only the tail says who read whom
    slap(e, t, 0.8, true);
    bass(e, t, 0.7);
    snare(e, t, 0.8);
    noise(e, { t, f: 1700, q: 0.7, dur: 0.07, peak: 0.2, a: 0.001 });
    const at = t + 0.13;
    if (edge === 'good') {
      brass(e, at, [lo(G), C, G], 0.09, 0.7);
      brass(e, at + 0.12, [C, E, G, hi(C)], 0.3, 0.8, { verb: 0.22 });
      cymbal(e, at + 0.12, 0.55, 0.8);
      bell(e, at + 0.12, hi(hi(C)), 0.5, 0.5);
    } else if (edge === 'bad') {
      brass(e, at, [Eb], 0.11, 0.62, { bright: 0.6 });
      brass(e, at + 0.14, [lo(C), lo(G), C], 0.34, 0.66, { bright: 0.5, fall: true });
      cymbal(e, at, 0.5, 0, true);
      tom(e, at + 0.14, lo(C), 0.5);
    } else {
      tom(e, at, lo(G), 0.5, 0.7);
      tom(e, at + 0.1, lo(G), 0.5, 0.7);
      rim(e, at + 0.1, 0.4);
      cymbal(e, t, 0.4, 0, true);
    }
  },
  chalk(e: Engine, t: number): void {
    rim(e, t, 0.14, 1.5);
    chalk(e, t, rnd(0.15, 0.19), 0.9);
    chalk(e, t + 0.23, rnd(0.07, 0.1), 0.8);
  },

  // ------------------------------------------------------------------------------------------ match
  whistle(e: Engine, t: number, kind: 'short' | 'long' = 'short'): void {
    if (kind === 'long') whistle(e, t, 0.72, 1);
    else whistle(e, t, 0.14, 0.82);
  },
  snap(e: Engine, t: number): void {
    pop(e, t, 0.66);
    snare(e, t, 0.26, true);
    bass(e, t, 0.3);
    // the two lines firing out of their stance
    noise(e, { t: t + 0.01, f: 1300, q: 0.7, dur: 0.11, peak: 0.13, a: 0.02, src: 'pink', rate: 1.5 });
  },
  handoff(e: Engine, t: number): void {
    pop(e, t, 0.34, 0.85);
    swish(e, t, 0.3, true, 0.07);
  },
  throwBall(e: Engine, t: number, long: boolean): void {
    if (long) whoosh(e, t, 0.72, 0.68, true);
    else whoosh(e, t, 0.3, 0.5);
    pop(e, t, 0.14, 1.2);
  },
  catchBall(e: Engine, t: number): void {
    pop(e, t, 0.82);
    rim(e, t, 0.3);
    tom(e, t + 0.012, G, 0.24, 0.45);
  },
  dropBall(e: Engine, t: number): void {
    // off the fingers, then two dull bounces on the turf
    pop(e, t, 0.5, 0.72);
    pop(e, t + 0.17, 0.3, 0.6);
    pop(e, t + 0.3, 0.17, 0.55);
    tom(e, t + 0.02, lo(E), 0.3, 0.6);
    tom(e, t + 0.17, lo(C), 0.24, 0.5);
  },
  impact(e: Engine, t: number, power: number): void {
    thud(e, t, power);
  },
  breakaway(e: Engine, t: number): void {
    // a run up the tenors while the snares swell: he is loose
    [lo(C), lo(E), lo(G), C, E].forEach((n, i) => tom(e, t + i * 0.07, n, 0.36 + i * 0.07, 0.6));
    roll(e, t, 0.36, 0.15, 0.6);
    whoosh(e, t + 0.05, 0.42, 0.5);
    snare(e, t + 0.36, 0.62);
    cymbal(e, t + 0.36, 0.45, 0.6);
  },
  steal(e: Engine, t: number): void {
    swish(e, t, 0.8, false, 0.07);
    pop(e, t + 0.06, 0.8, 1.15);
    flam(e, t + 0.04, 0.72);
    cymbal(e, t + 0.07, 0.75, 0, true);
    brass(e, t + 0.07, [C, G], 0.08, 0.55);
  },
  gain(e: Engine, t: number, yards: number): void {
    if (!(yards > 0)) {
      tom(e, t, lo(C), 0.32, 0.45);
      return;
    }
    const y = Math.min(yards, 25);
    const v = 0.3 + (y / 25) * 0.36;
    const notes = y < 4 ? [C] : y < 10 ? [C, E] : [C, E, G];
    notes.forEach((n, i) => {
      tom(e, t + i * 0.065, n, v + i * 0.05, 0.55);
      if (i === notes.length - 1) rim(e, t + i * 0.065, v * 0.7);
    });
  },
  firstDown(e: Engine, t: number): void {
    flam(e, t, 0.62);
    brass(e, t, [lo(G), C, G], 0.1, 0.74);
    bass(e, t + 0.14, 0.72);
    brass(e, t + 0.14, [C, E, G, hi(C)], 0.36, 0.86, { verb: 0.22 });
    cymbal(e, t + 0.14, 0.5, 0.8);
    tom(e, t + 0.14, C, 0.4);
  },
  touchdown(e: Engine, t: number, mine: boolean): void {
    if (!mine) {
      duckMusic(e, 0.4, 1500);
      bass(e, t, 0.8, true);
      cymbal(e, t, 0.6, 0, true);
      sadFigure(e, t + 0.02, 0.62);
      bass(e, t + 0.74, 0.62, true);
      tom(e, t + 0.24, lo(G), 0.36);
      tom(e, t + 0.48, lo(E), 0.36);
      return;
    }
    duckMusic(e, 0.65, 2200);
    // two lifting chords under a snare roll, then the whole band on the home chord
    bass(e, t, 1, true);
    cymbal(e, t, 0.75, 0.9);
    roll(e, t, 0.47, 0.3, 0.85);
    bass(e, t + 0.24, 0.8);
    tom(e, t + 0.36, lo(G), 0.6, 0.6);
    tom(e, t + 0.42, C, 0.7, 0.6);
    fanfare(e, t, 1.2);
    const hit = t + 0.48;
    bass(e, hit, 0.9, true);
    snare(e, hit, 0.8);
    cymbal(e, hit, 1, 1.9);
    [hi(hi(C)), hi(hi(E)), hi(hi(G)), hi(hi(hi(C)))].forEach((n, i) => bell(e, hit + 0.06 * i, n, 0.5, 0.7));
    // the drumline signs off
    snare(e, hit + 0.62, 0.55);
    snare(e, hit + 0.73, 0.62);
    flam(e, hit + 0.84, 0.86);
    bass(e, hit + 0.87, 0.9, true);
    cymbal(e, hit + 0.87, 0.7, 1.2);
  },
  turnover(e: Engine, t: number, mine: boolean): void {
    if (mine) {
      flam(e, t, 0.7);
      brass(e, t, [C, E, G], 0.08, 0.72);
      brass(e, t + 0.1, [E, G, hi(C)], 0.08, 0.76);
      brass(e, t + 0.2, [G, hi(C), hi(E)], 0.32, 0.84, { verb: 0.22 });
      bass(e, t + 0.2, 0.72);
      cymbal(e, t + 0.2, 0.6, 0.9);
      tom(e, t + 0.1, lo(G), 0.4, 0.6);
    } else {
      duckMusic(e, 0.3, 900);
      bass(e, t, 0.72, true);
      cymbal(e, t, 0.55, 0, true);
      brass(e, t + 0.01, [G], 0.15, 0.6, { bright: 0.6, soft: true });
      brass(e, t + 0.18, [Eb], 0.15, 0.6, { bright: 0.55, soft: true });
      brass(e, t + 0.35, [lo(C), lo(G), C], 0.5, 0.64, { bright: 0.5, soft: true, fall: true });
      tom(e, t + 0.35, lo(C), 0.45);
    }
  },
  stopped(e: Engine, t: number, mine: boolean): void {
    if (mine) {
      thud(e, t, 0.7);
      snare(e, t + 0.09, 0.56);
      snare(e, t + 0.18, 0.7);
      brass(e, t + 0.18, [C, G, hi(C)], 0.1, 0.66);
    } else {
      thud(e, t, 0.5);
      tom(e, t + 0.06, C, 0.4, 0.6);
      tom(e, t + 0.15, lo(G), 0.42, 0.7);
      tom(e, t + 0.24, lo(C), 0.46, 0.9);
    }
  },
  momentum(e: Engine, t: number, level: number): void {
    const l = Math.round(clamp(level, 1, 5));
    const note = [C, E, G, hi(C), hi(E)][l - 1]!;
    tom(e, t, note > G ? note - 12 : note, 0.3 + l * 0.04, 0.6);
    rim(e, t, 0.2 + l * 0.02, 0.9 + l * 0.06);
    bell(e, t, hi(note), 0.36 + l * 0.05, 0.3 + l * 0.05);
    if (l >= 4) brass(e, t, [note - 12, note - 5, note], 0.09, 0.34 + (l - 4) * 0.14);
    if (l === 5) {
      cymbal(e, t, 0.34, 0.6);
      bell(e, t + 0.07, hi(hi(G)), 0.4, 0.4);
      bell(e, t + 0.14, hi(hi(hi(C))), 0.44, 0.5);
    }
  },
  specialReady(e: Engine, t: number): void {
    swell(e, t, 0.3, 0.5);
    rim(e, t, 0.3, 1.2);
    rim(e, t + 0.1, 0.34, 1.3);
    brass(e, t + 0.3, [G, hi(C)], 0.09, 0.4);
    brass(e, t + 0.42, [hi(C), hi(E)], 0.24, 0.44, { verb: 0.25 });
    bell(e, t + 0.3, hi(hi(G)), 0.4, 0.4);
    bell(e, t + 0.42, hi(hi(hi(C))), 0.46, 0.7);
    tom(e, t + 0.3, C, 0.36, 0.6);
  },
  specialCutin(e: Engine, t: number, mine: boolean): void {
    duckMusic(e, 0.75, mine ? 2400 : 1500);
    // a stick click right now, the breath of a reversed cymbal, then the hit
    rim(e, t, 0.5, 0.9);
    snare(e, t, 0.3, true);
    swell(e, t, 0.16, 0.9);
    const hit = t + 0.16;
    bass(e, hit, 1, true);
    snare(e, hit, 0.8);
    cymbal(e, hit, 0.9, 1.5);
    if (mine) {
      // the sampled jingle carries the tune; without it the brass plays the hit
      roll(e, hit + 0.04, 0.45, 0.45, 0.08);
      if (!sample(e, hit, 'special', 0.52)) {
        brass(e, hit, [lo(C), lo(G), C, G, hi(C)], 0.7, 0.95, { vib: true, verb: 0.25 });
        brass(e, hit + 0.3, [hi(E)], 0.4, 0.6, { verb: 0.25 });
      }
    } else {
      // the other bench: a low minor hit that drops onto the flat sixth
      brass(e, hit, [lo(C), lo(G), Eb], 0.2, 0.8, { bright: 0.75 });
      brass(e, hit + 0.26, [lo(lo(Ab)), lo(Eb), lo(Ab), C], 0.6, 0.8, { bright: 0.7, verb: 0.25 });
      bass(e, hit + 0.26, 0.8, true);
      roll(e, hit + 0.3, 0.5, 0.4, 0.08);
    }
  },
  quarter(e: Engine, t: number): void {
    whistle(e, t, 0.11, 0.8);
    whistle(e, t + 0.19, 0.4, 0.95);
    snare(e, t + 0.62, 0.5);
    bass(e, t + 0.62, 0.5);
  },
  halftime(e: Engine, t: number): void {
    whistle(e, t, 0.85, 1);
    // the drumline marches the teams off: four beats at 150 bpm
    const b = 0.2;
    const at = t + 0.95;
    bass(e, at, 0.7);
    snare(e, at + b, 0.55);
    snare(e, at + b * 1.5, 0.4, true);
    bass(e, at + b * 2, 0.6);
    tom(e, at + b * 2.5, lo(G), 0.45, 0.6);
    tom(e, at + b * 3, C, 0.5, 0.6);
    tom(e, at + b * 3.5, E, 0.55, 0.6);
    flam(e, at + b * 4 - 0.03, 0.7);
    bass(e, at + b * 4, 0.7, true);
    cymbal(e, at + b * 4, 0.6, 1.1);
  },
  win(e: Engine, t: number): void {
    duckMusic(e, 0.8, 3500);
    roll(e, t, 0.38, 0.25, 0.9);
    const hit = t + 0.4;
    bass(e, hit, 1, true);
    cymbal(e, hit, 1, 2);
    if (!sample(e, hit, 'win', 0.52)) fanfare(e, hit, 1.1);
  },
  lose(e: Engine, t: number): void {
    duckMusic(e, 0.8, 4000);
    bass(e, t, 0.85, true);
    cymbal(e, t, 0.6, 0, true);
    if (!sample(e, t + 0.05, 'lose', 0.5)) sadFigure(e, t + 0.05, 0.7);
  },

  // ------------------------------------------------------------------------------------------ club
  statUp(e: Engine, t: number, step: number): void {
    // up the pentatonic scale, one note per step, two octaves at most
    const s = Math.round(clamp(step, 0, 9));
    const note = hi([C, D, E, G, A][s % 5]!) + 12 * Math.floor(s / 5);
    bell(e, t, note, 0.62, 0.34);
    tom(e, t, note - 24, 0.22, 0.45);
    rim(e, t, 0.14, 1.2);
  },
  trustUp(e: Engine, t: number): void {
    brass(e, t, [E, G], 0.16, 0.42, { soft: true, bright: 0.8 });
    brass(e, t + 0.2, [G, hi(C)], 0.3, 0.46, { soft: true, bright: 0.85, verb: 0.25 });
    bell(e, t, hi(hi(E)), 0.5, 0.4);
    bell(e, t + 0.1, hi(hi(G)), 0.5, 0.4);
    bell(e, t + 0.2, hi(hi(hi(C))), 0.6, 0.7);
  },
  learn(e: Engine, t: number): void {
    flam(e, t, 0.66);
    bass(e, t + 0.03, 0.66);
    cymbal(e, t + 0.03, 0.6, 1);
    if (!sample(e, t + 0.03, 'get', 0.8)) {
      [hi(C), hi(E), hi(G), hi(hi(C))].forEach((n, i) => bell(e, t + 0.03 + i * 0.07, n, 0.7, 0.6));
      brass(e, t + 0.03, [C, E, G, hi(C)], 0.4, 0.7, { verb: 0.25 });
    }
  },
  recruit(e: Engine, t: number): void {
    tom(e, t, lo(C), 0.45, 0.6);
    tom(e, t + 0.07, lo(G), 0.5, 0.6);
    tom(e, t + 0.14, C, 0.56, 0.6);
    const hit = t + 0.21;
    snare(e, hit, 0.5);
    bass(e, hit, 0.55);
    brass(e, hit, [C, E, G], 0.26, 0.66, { verb: 0.2 });
    bell(e, hit, hi(hi(G)), 0.5, 0.5);
  },
  captain(e: Engine, t: number): void {
    roll(e, t, 0.34, 0.2, 0.75);
    const hit = t + 0.35;
    bass(e, hit, 0.7, true);
    brass(e, hit, [lo(F), C, F, A], 0.28, 0.7);
    brass(e, hit + 0.34, [lo(C), C, E, G, hi(C)], 0.75, 0.8, { vib: true, verb: 0.25 });
    bass(e, hit + 0.34, 0.75, true);
    cymbal(e, hit + 0.34, 0.7, 1.4);
  },
  practice(e: Engine, t: number): void {
    whistle(e, t, 0.12, 0.8);
    rim(e, t + 0.26, 0.6, 1.1);
    rim(e, t + 0.42, 0.6, 1.1);
    snare(e, t + 0.58, 0.6);
    bass(e, t + 0.58, 0.5);
  },
  event(e: Engine, t: number): void {
    swish(e, t, 0.4, true, 0.08);
    rim(e, t + 0.05, 0.3, 1.2);
    bell(e, t + 0.05, hi(G), 0.56, 0.3);
    bell(e, t + 0.15, hi(hi(C)), 0.6, 0.35);
    bell(e, t + 0.25, hi(hi(E)), 0.66, 0.6);
  },
};
