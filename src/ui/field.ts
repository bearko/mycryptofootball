// The field: a canvas that shows both teams lined up and plays back each play.
//
// Everything is laid out in "drive coordinates": u = yards from the attacking team's own goal line,
// v = sideways position (0..WIDTH). The club (team 0) attacks to the right, the opponent to the left.

import { clamp } from '../core/rng';
import { isRun, type DefType, type OffType } from '../game/cards';
import { hero } from '../game/heroes';
import { FIELD, type MatchState, type PlayResult, type TeamSheet } from '../game/match';
import { DEF_POS, OFF_POS, type DefPos, type OffPos } from '../game/model';

const WIDTH = 24;
const END = 5;
const SPAN = FIELD + END * 2;

type UV = [number, number];
interface Key { t: number; u: number; v: number }
interface Actor {
  team: 0 | 1;
  id: number;
  u: number;
  v: number;
  path: Key[];
  phase: number;
  moving: boolean;
  star: boolean;
}
type BallSeg =
  | { t0: number; t1: number; kind: 'held'; id: number; team: 0 | 1 }
  | { t0: number; t1: number; kind: 'air'; from: UV; to: UV; height: number }
  | { t0: number; t1: number; kind: 'ground'; at: UV };

const images = new Map<number, HTMLImageElement>();
function image(id: number): HTMLImageElement {
  let img = images.get(id);
  if (!img) {
    img = new Image();
    img.src = hero(id).img;
    images.set(id, img);
  }
  return img;
}

function formation(los: number, call?: DefType): { off: Record<OffPos, UV>; def: Record<DefPos, UV> } {
  const off: Record<OffPos, UV> = {
    OL1: [los - 1.9, 8.5], OL2: [los - 1.9, 15.5], QB: [los - 5, 12], RB: [los - 8.2, 12.8],
    WR1: [los - 1.9, 2.6], WR2: [los - 1.9, 21.4],
  };
  const def: Record<DefPos, UV> = {
    DL1: [los + 1.9, 8.5], DL2: [los + 1.9, 15.5], LB: [los + 5.6, 12], CB1: [los + 4.6, 3], CB2: [los + 4.6, 21], S: [los + 11, 12],
  };
  if (call === 'stuff') { def.LB = [los + 3.6, 12]; def.CB1 = [los + 4, 6]; def.CB2 = [los + 4, 18]; def.S = [los + 8, 12]; }
  if (call === 'contain') { def.CB1 = [los + 2.6, 2.4]; def.CB2 = [los + 2.6, 21.6]; def.LB = [los + 5, 12]; }
  if (call === 'zone') { def.CB1 = [los + 5.8, 4.5]; def.CB2 = [los + 5.8, 19.5]; def.LB = [los + 6.6, 12]; }
  if (call === 'deep') { def.CB1 = [los + 9, 4.5]; def.CB2 = [los + 9, 19.5]; def.S = [los + 15, 12]; }
  if (call === 'blitz') { def.LB = [los + 2.4, 12]; def.S = [los + 7, 12]; def.CB1 = [los + 3.2, 4.5]; def.CB2 = [los + 3.2, 19.5]; }
  return { off, def };
}

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Field {
  private ctx: CanvasRenderingContext2D;
  private actors: Actor[] = [];
  private ball: BallSeg[] = [];
  private offense: 0 | 1 = 0;
  private los = 15;
  private toGo = 10;
  /** progress of the play being shown (0..1), or -1 when idle */
  private t = -1;
  private raf = 0;
  private started = 0;
  private duration = 1;
  private done: (() => void) | null = null;
  private impact: { at: UV; t: number } | null = null;
  private w = 0;
  private h = 0;
  private observer: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, private teams: [TeamSheet, TeamSheet]) {
    this.ctx = canvas.getContext('2d')!;
    for (const t of teams) for (const p of t.players) image(p.id);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    const loop = (now: number): void => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.done?.();
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width);
    this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Both teams lined up for the next play. */
  setScene(st: MatchState): void {
    this.t = -1;
    this.offense = st.poss;
    this.los = st.pos;
    this.toGo = st.toGo;
    this.ball = [];
    this.impact = null;
    this.lineUp(st.poss, st.pos);
  }

  private lineUp(offense: 0 | 1, los: number, call?: DefType): void {
    const f = formation(los, call);
    const O = this.teams[offense];
    const D = this.teams[1 - offense]!;
    const actors: Actor[] = [];
    for (const p of OFF_POS) actors.push(this.actor(offense, O.lineup.off[p], f.off[p]));
    for (const p of DEF_POS) actors.push(this.actor((1 - offense) as 0 | 1, D.lineup.def[p], f.def[p]));
    this.actors = actors;
  }

  private actor(team: 0 | 1, id: number, at: UV): Actor {
    return { team, id, u: at[0], v: at[1], path: [], phase: (id * 37 + team * 11) % 100 / 100, moving: false, star: false };
  }

  private find(team: 0 | 1, id: number): Actor {
    return this.actors.find((a) => a.team === team && a.id === id)!;
  }

  /** Plays back one play; resolves when it has been shown. */
  play(res: PlayResult, speed: number): Promise<void> {
    const o = res.off;
    const d = (1 - o) as 0 | 1;
    const los = res.before.pos;
    const type = res.offPick.type as OffType;
    const call = res.defPick.special ? undefined : (res.defPick.type as DefType);
    this.offense = o;
    this.los = los;
    this.toGo = res.before.toGo;
    this.lineUp(o, los, call);
    const O = this.teams[o];
    const D = this.teams[d];
    const a = (pos: OffPos): Actor => this.find(o, O.lineup.off[pos]);
    const b = (pos: DefPos): Actor => this.find(d, D.lineup.def[pos]);
    const go = (ac: Actor, ...keys: [number, number, number][]): void => {
      ac.path = [{ t: 0, u: ac.u, v: ac.v }, ...keys.map(([t, u, v]) => ({ t, u, v }))];
    };
    const qb = a('QB');
    const rb = a('RB');
    const carrier = this.find(o, res.carrier);
    const defender = this.find(d, res.defender);
    const end = los + res.yards;
    const side = res.n % 2 ? 4.4 : 19.6;
    const ball: BallSeg[] = [];
    if (res.offPick.special) this.find(o, res.offPick.special.owner).star = true;
    if (res.defPick.special) this.find(d, res.defPick.special.owner).star = true;

    // the two lines push each other
    const push = res.outcome === 'gain' ? clamp(res.yards * 0.3, 0.3, 1.8) : -0.9;
    for (const p of ['OL1', 'OL2'] as const) go(a(p), [0.3, a(p).u + 0.9 + push, a(p).v], [0.85, a(p).u + 0.9 + push, a(p).v]);
    for (const p of ['DL1', 'DL2'] as const) go(b(p), [0.3, b(p).u - 0.9 + push, b(p).v], [0.85, b(p).u - 0.9 + push, b(p).v]);

    if (isRun(type)) {
      const lane = type === 'inside' ? 12 + (res.n % 3 - 1) * 0.8 : side;
      go(qb, [0.2, los - 5.8, 12.4], [0.85, los - 5.4, 12.4]);
      const stop = res.td ? FIELD + 2.6 : end;
      if (type === 'inside') go(rb, [0.08, rb.u, rb.v], [0.3, los - 2.2, lane], [0.85, stop, lane]);
      else go(rb, [0.08, rb.u, rb.v], [0.38, los - 3.5, lane], [0.85, stop, lane + (lane < 12 ? 0.8 : -0.8)]);
      for (const p of ['WR1', 'WR2'] as const) go(a(p), [0.5, a(p).u + 3.5, a(p).v], [0.85, a(p).u + 4, a(p).v]);
      ball.push({ t0: 0, t1: 0.18, kind: 'held', id: qb.id, team: o });
      if (res.outcome === 'fumble') {
        ball.push({ t0: 0.18, t1: 0.7, kind: 'held', id: rb.id, team: o });
        ball.push({ t0: 0.7, t1: 0.84, kind: 'air', from: [stop, lane], to: [stop + 1.2, lane + 1], height: 1.6 });
        ball.push({ t0: 0.84, t1: 1, kind: 'held', id: defender.id, team: d });
        go(defender, [0.7, stop + 0.8, lane], [0.84, stop + 1.2, lane + 1], [1, stop - 1, lane + 1]);
      } else {
        ball.push({ t0: 0.18, t1: 1, kind: 'held', id: rb.id, team: o });
        if (!res.td) go(defender, [0.3, defender.u, defender.v], [0.85, stop + 0.7, lane]);
        else go(defender, [0.85, Math.min(FIELD, defender.u + 4), lane + 2]);
      }
      this.chase(d, D, defender, [stop, lane]);
      this.impact = res.td ? null : { at: [stop, lane], t: 0.85 };
    } else {
      const deep = type === 'long' ? 18 : 5;
      const caught = res.outcome === 'gain' || res.outcome === 'nogain';
      const sack = res.outcome === 'sack';
      const depth = clamp(caught ? Math.min(res.yards, deep) : deep, 1, FIELD - los + 2);
      const recv = carrier === qb || carrier === rb ? a('WR1') : carrier;
      const other = recv === a('WR1') ? a('WR2') : a('WR1');
      const rv = recv.v < 12 ? recv.v + (type === 'long' ? 1 : 3.5) : recv.v - (type === 'long' ? 1 : 3.5);
      const spot: UV = [los + depth, rv];
      const stop = res.td ? FIELD + 2.6 : end;
      const dropU = sack ? los - 6.5 : los - 7.6;
      go(qb, [0.3, dropU, 12], [sack ? 0.62 : 0.85, sack ? end : dropU, 12]);
      go(rb, [0.3, los - 5.4, 15], [0.85, los - 5.2, 15]);
      go(other, [0.6, other.u + (type === 'long' ? 12 : 6), other.v], [0.85, other.u + (type === 'long' ? 14 : 7), other.v]);
      if (sack) {
        go(recv, [0.62, spot[0], spot[1]]);
        go(defender, [0.2, defender.u, defender.v], [0.62, dropU + 0.6, 12.3], [0.8, end + 0.6, 12.3]);
        ball.push({ t0: 0, t1: 1, kind: 'held', id: qb.id, team: o });
        this.impact = { at: [end, 12], t: 0.66 };
      } else {
        go(recv, [0.66, spot[0], spot[1]], [0.85, caught ? stop : spot[0] + 1, spot[1]]);
        ball.push({ t0: 0, t1: 0.42, kind: 'held', id: qb.id, team: o });
        ball.push({ t0: 0.42, t1: 0.68, kind: 'air', from: [dropU, 12], to: spot, height: type === 'long' ? 7 : 3 });
        if (caught) {
          ball.push({ t0: 0.68, t1: 1, kind: 'held', id: recv.id, team: o });
          if (!res.td) go(defender, [0.4, defender.u, defender.v], [0.85, stop + 0.7, spot[1]]);
          this.impact = res.td ? null : { at: [stop, spot[1]], t: 0.85 };
        } else if (res.outcome === 'int') {
          go(defender, [0.66, spot[0] + 0.3, spot[1]], [0.9, spot[0] - 4, spot[1]]);
          ball.push({ t0: 0.68, t1: 1, kind: 'held', id: defender.id, team: d });
        } else {
          go(defender, [0.66, spot[0] + 0.6, spot[1] + 0.4], [0.85, spot[0] + 0.6, spot[1] + 0.4]);
          ball.push({ t0: 0.68, t1: 0.8, kind: 'air', from: spot, to: [spot[0] + 1.8, spot[1] + 1], height: 1.2 });
          ball.push({ t0: 0.8, t1: 1, kind: 'ground', at: [spot[0] + 1.8, spot[1] + 1] });
        }
      }
      this.chase(d, D, defender, caught ? [stop, spot[1]] : spot);
    }
    this.ball = ball;
    for (const ac of this.actors) ac.moving = ac.path.length > 0;

    this.duration = 2300 / speed;
    this.started = performance.now();
    this.t = 0;
    return new Promise((resolve) => {
      this.done = resolve;
    });
  }

  /** Defenders who are not the one making the play drift toward where it ends. */
  private chase(d: 0 | 1, D: TeamSheet, defender: Actor, to: UV): void {
    for (const p of ['LB', 'CB1', 'CB2', 'S'] as const) {
      const ac = this.find(d, D.lineup.def[p]);
      if (ac === defender || ac.path.length) continue;
      ac.path = [{ t: 0, u: ac.u, v: ac.v }, { t: 0.25, u: ac.u, v: ac.v },
        { t: 0.9, u: ac.u + (to[0] + 1.5 - ac.u) * 0.55, v: ac.v + (to[1] - ac.v) * 0.45 }];
    }
  }

  private frame(now: number): void {
    if (this.t >= 0) {
      // the frame's time stamp can be a hair earlier than the moment the play was started
      this.t = clamp((now - this.started) / this.duration, 0, 1);
      for (const ac of this.actors) {
        if (!ac.path.length) continue;
        const keys = ac.path;
        let i = 0;
        while (i < keys.length - 2 && this.t > keys[i + 1]!.t) i += 1;
        const k0 = keys[i]!;
        const k1 = keys[Math.min(i + 1, keys.length - 1)]!;
        const f = k1.t > k0.t ? clamp((this.t - k0.t) / (k1.t - k0.t), 0, 1) : 1;
        const e = ease(f);
        ac.u = k0.u + (k1.u - k0.u) * e;
        ac.v = k0.v + (k1.v - k0.v) * e;
        ac.moving = this.t < 0.95 && f > 0 && f < 1;
      }
      if (this.t >= 1) {
        this.t = -2; // finished: hold the last picture until the next scene
        const done = this.done;
        this.done = null;
        done?.();
      }
    }
    this.draw(now);
  }

  // ------------------------------------------------------------------ drawing

  private x(u: number, offense = this.offense): number {
    const yard = offense === 0 ? END + u : END + FIELD - u;
    return (yard / SPAN) * this.w;
  }

  private y(v: number): number {
    const top = this.h * 0.14;
    return top + (v / WIDTH) * (this.h * 0.8);
  }

  private draw(now: number): void {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const yardW = w / SPAN;
    // turf in five-yard bands
    for (let i = 0; i < SPAN / 5; i += 1) {
      ctx.fillStyle = i % 2 ? '#2c7a4b' : '#2f8451';
      ctx.fillRect(i * 5 * yardW, 0, 5 * yardW + 1, h);
    }
    // end zones: each team defends its own color
    const zone = (x0: number, color: string, label: string, flip: boolean): void => {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x0, 0, END * yardW, h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.save();
      ctx.translate(x0 + (END * yardW) / 2, h / 2);
      ctx.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
      ctx.font = `${Math.round(Math.min(END * yardW * 0.5, h * 0.12))}px "Dela Gothic One", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    zone(0, this.teams[0].color, this.teams[0].short, false);
    zone((END + FIELD) * yardW, this.teams[1].color, this.teams[1].short, true);
    // yard lines
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, h * 0.006);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(h * 0.075)}px "Dela Gothic One", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let yd = 0; yd <= FIELD; yd += 5) {
      const px = (END + yd) * yardW;
      ctx.globalAlpha = yd % 10 === 0 ? 1 : 0.45;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      if (yd % 10 === 0 && yd > 0 && yd < FIELD) ctx.fillText(String(Math.min(yd, FIELD - yd)), px, h * 0.11);
    }
    ctx.globalAlpha = 1;
    // where the play starts, and how far the offense has to go
    const lx = this.x(this.los);
    const fx = this.x(Math.min(FIELD, this.los + this.toGo));
    ctx.lineWidth = Math.max(2, h * 0.012);
    ctx.strokeStyle = '#7fd4ff';
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, h);
    ctx.stroke();
    if (this.los + this.toGo < FIELD) {
      ctx.strokeStyle = '#ffd84a';
      ctx.beginPath();
      ctx.moveTo(fx, 0);
      ctx.lineTo(fx, h);
      ctx.stroke();
    }

    // heroes, the ones further down the screen drawn last
    const size = clamp(h * 0.22, 30, 104);
    const order = [...this.actors].sort((p, q) => p.v - q.v);
    const t = Math.max(0, this.t === -2 ? 1 : this.t);
    const holder = this.holder(t);
    for (const ac of order) {
      const px = this.x(ac.u);
      const py = this.y(ac.v);
      const hop = ac.moving ? Math.abs(Math.sin(now / 70 + ac.phase * 6)) * size * 0.07 : Math.sin(now / 420 + ac.phase * 6) * size * 0.012;
      const color = this.teams[ac.team].color;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(px, py, size * 0.3, size * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (ac.star && this.t !== -1) {
        ctx.strokeStyle = '#fff6a8';
        ctx.lineWidth = Math.max(2, size * 0.05);
        ctx.beginPath();
        ctx.ellipse(px, py, size * 0.42 + Math.sin(now / 90) * 2, size * 0.17, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const img = image(ac.id);
      if (img.complete && img.naturalWidth) {
        // the art faces left; a team that attacks to the right is mirrored
        const attackRight = (ac.team === 0) === true;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(px, py - hop);
        if (attackRight) ctx.scale(-1, 1);
        ctx.drawImage(img, -size / 2, -size * 0.92, size, size);
        ctx.restore();
      }
      if (holder && holder.id === ac.id && holder.team === ac.team) this.drawBall(px + (ac.team === 0 ? 1 : -1) * size * 0.16, py - size * 0.32 - hop, size, 0);
    }
    // the ball when nobody holds it
    const seg = this.ball.find((s) => t >= s.t0 && t <= s.t1);
    if (seg && seg.kind === 'air') {
      const f = clamp((t - seg.t0) / (seg.t1 - seg.t0), 0, 1);
      const u = seg.from[0] + (seg.to[0] - seg.from[0]) * f;
      const v = seg.from[1] + (seg.to[1] - seg.from[1]) * f;
      const lift = Math.sin(Math.PI * f) * seg.height * (this.h / WIDTH);
      this.drawBall(this.x(u), this.y(v) - size * 0.3, size, lift);
    } else if (seg && seg.kind === 'ground') {
      this.drawBall(this.x(seg.at[0]), this.y(seg.at[1]), size, 0);
    }
    // a puff where the play is stopped
    if (this.impact && this.t !== -1) {
      const f = clamp((t - this.impact.t) / 0.15, 0, 1);
      if (f > 0 && f < 1) {
        ctx.strokeStyle = `rgba(255,255,255,${1 - f})`;
        ctx.lineWidth = Math.max(2, size * 0.06);
        ctx.beginPath();
        ctx.ellipse(this.x(this.impact.at[0]), this.y(this.impact.at[1]) - size * 0.2, size * (0.2 + f * 0.6), size * (0.12 + f * 0.3), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private holder(t: number): { id: number; team: 0 | 1 } | null {
    if (!this.ball.length) {
      // idle: the quarterback has it
      const qb = this.teams[this.offense].lineup.off.QB;
      return this.t === -1 ? { id: qb, team: this.offense } : null;
    }
    const seg = this.ball.find((s) => t >= s.t0 && t <= s.t1) ?? this.ball[this.ball.length - 1]!;
    return seg.kind === 'held' ? { id: seg.id, team: seg.team } : null;
  }

  private drawBall(px: number, py: number, size: number, lift: number): void {
    const { ctx } = this;
    const r = size * 0.11;
    if (lift > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(px, py + size * 0.3, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#8a4b22';
    ctx.strokeStyle = '#3d1f0c';
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.beginPath();
    ctx.ellipse(px, py - lift, r * 1.25, r * 0.8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px - r * 0.5, py - lift);
    ctx.lineTo(px + r * 0.5, py - lift - r * 0.15);
    ctx.stroke();
  }
}
