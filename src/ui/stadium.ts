// The stadium: a pseudo-3D night-game broadcast of the match, drawn with Canvas 2D only.
//
// A look-at camera projects a small 3D world (painted turf, a bowl of stands with a pixel crowd, an LED
// ribbon, floodlight towers) and the heroes stand in it as depth-scaled billboards. A play is a script
// (see stadium/choreo.ts); this file plays it back with camera work, hit-stop, shake and particles.
//
// World: x along the field (0..FIELD between the goal lines), z across (0 far, WIDTH near the main
// camera), y up, in yards. Team 0 attacks toward +x.

import { KIND, isKick, type DefType, type OffType } from '../game/cards';
import { FIELD, type MatchState, type Pick, type PlayResult, type TeamSheet } from '../game/match';
import { OFF_POS } from '../game/model';
import {
  ART, ART_PAD, BANDS, CHALK, CROWD_ROWS, END, FX0, FX1, FZ0, FZ1, RIBBON_H, RIBBON_PPY, SURROUND, WIDTH,
  bakeCrowd, bakeField, bakeRibbon, bakeSprites, heroArt, ledColor, loadFonts, tinted, zoneColor,
  type FieldArt, type HeroArt, type Ribbon, type Sprites, type Tex,
} from './stadium/assets';
import {
  buildScript, evalKeys, formation, lineUp, randomSpec, specOf, worldX,
  type Cue, type Key, type PlaySpec, type Ref, type Script,
} from './stadium/choreo';
import { CHUNK, CONFETTI, Fx, GLINT, MOTE, PUFF, SPARK, burst } from './stadium/fx';
import { Guide } from './stadium/guide';
import {
  BOARD, CART, CENTER, DUMMIES, Ground, SLED, STATIONS, buildDrill, propsOf, spotOf, stationsFor,
  type DrillHooks, type DrillKind, type DrillPlan, type GCue, type Painter, type Post, type Prop, type Station,
} from './stadium/ground';
import {
  Camera, Spring, TAU, clamp, css, damp, easeOut, hash, lerp, mix, noise, rgbOf, sat, scale, seeded, smooth,
  type RGB,
} from './stadium/math';

export type { DrillHooks, DrillKind, Post } from './stadium/ground';

export interface PlayHooks {
  /** fired in sync with the picture so the caller can play sounds / shake DOM / vibrate */
  onSnap?(): void;
  onHandoff?(): void;
  onThrow?(long: boolean): void;
  /** a field goal, a punt, or the kick after a touchdown leaves the foot */
  onKick?(): void;
  onCatch?(): void;
  /** incomplete pass hits the turf */
  onDrop?(): void;
  /** tackle / sack / collision, power 0..1 */
  onImpact?(power: number): void;
  /** interception or fumble recovery */
  onSteal?(): void;
  /** runner breaks into the open (big gain) */
  onBreak?(): void;
  onTouchdown?(): void;
  /** play is dead, picture settles */
  onEnd?(): void;
}

/** Numbers for the lab page: milliseconds per frame over the last few seconds. */
export interface StadiumStats {
  frames: number;
  /** time between frames */
  avg: number;
  worst: number;
  /** time spent in our own update + draw calls */
  cpuAvg: number;
  cpuWorst: number;
  particles: number;
  /** current resolution scale (see setQuality) */
  quality: number;
}

// ------------------------------------------------------------------ the world

/** height of a hero sprite (all 64 texels) in yards: bigger than life so faces read on a phone */
const HERO_H = 3.0;
// the apron around the field and the bowl of stands that rises from it
const AX0 = -11;
const AX1 = FIELD + 11;
const AZ0 = -6;
const AZ1 = WIDTH + 6;
const CHAMFER = 4;
const STAND_D = 24;
const STAND_H = 14.5;
const WALL_H = 1.8;
const RIM_H = 2.4;
const TOWER_H = 42;
const TOWERS: [number, number][] = [[AX0 - 21, AZ0 - 21], [AX1 + 21, AZ0 - 21], [AX0 - 21, AZ1 + 21], [AX1 + 21, AZ1 + 21]];
const MID_X = FIELD / 2;
const MID_Z = WIDTH / 2;

/** How high the stands are above a ground point (0 inside the apron): the camera stays above this. */
function standY(x: number, z: number): number {
  const out = Math.max(AX0 - x, x - AX1, AZ0 - z, z - AZ1, 0);
  if (out <= 0) return 0;
  return WALL_H + Math.min(1.2, out / STAND_D) * (STAND_H - WALL_H);
}

const STEPS = 7;
const ROWS_PER_STEP = 4;

interface Panel {
  /** the slope under the seats: top-left, top-right, bottom-left, bottom-right as seen from the field */
  seat: Float64Array;
  /** the terraces, top one first: each is an upright strip of crowd */
  steps: Float64Array[];
  wall: Float64Array;
  rim: Float64Array;
  /** part of the crowd texture, 0..1 */
  u0: number;
  u1: number;
  /** where this stretch starts along the ribbon, in yards */
  s0: number;
  len: number;
  main: boolean;
  /** distance from the camera this frame */
  dist: number;
}

function buildBowl(): Panel[] {
  const B: [number, number, number, number][] = [
    [AX0 + CHAMFER, AZ0, 0, -1], [AX1 - CHAMFER, AZ0, 0, -1],
    [AX1, AZ0 + CHAMFER, 1, 0], [AX1, AZ1 - CHAMFER, 1, 0],
    [AX1 - CHAMFER, AZ1, 0, 1], [AX0 + CHAMFER, AZ1, 0, 1],
    [AX0, AZ1 - CHAMFER, -1, 0], [AX0, AZ0 + CHAMFER, -1, 0],
  ];
  // which slice of the crowd each stretch shows; team 0's fans sit toward -x
  const U: [number, number][] = [[0, 1], [0.8, 1], [0.56, 1], [0.8, 1], [1, 0], [0.2, 0], [0.44, 0], [0, 0.2]];
  const panels: Panel[] = [];
  let s = 0;
  for (let i = 0; i < 8; i += 1) {
    const a = B[i]!;
    const b = B[(i + 1) % 8]!;
    const ta = [a[0] + a[2] * STAND_D, a[1] + a[3] * STAND_D];
    const tb = [b[0] + b[2] * STAND_D, b[1] + b[3] * STAND_D];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let [u0, u1] = U[i]!;
    let seat = [ta[0]!, STAND_H, ta[1]!, tb[0]!, STAND_H, tb[1]!, a[0], WALL_H, a[1], b[0], WALL_H, b[1]];
    if (u0 > u1) {
      // mirrored: swap left and right instead of sampling the texture backwards
      seat = [tb[0]!, STAND_H, tb[1]!, ta[0]!, STAND_H, ta[1]!, b[0], WALL_H, b[1], a[0], WALL_H, a[1]];
      [u0, u1] = [u1, u0];
    }
    // terraces: upright strips, so the crowd stands up straight from any camera height
    const l = u0 > U[i]![0] || U[i]![0] > U[i]![1] ? [b, tb] as const : [a, ta] as const;
    const r = l[0] === a ? [b, tb] as const : [a, ta] as const;
    const steps: Float64Array[] = [];
    const rise = (STAND_H - WALL_H) / STEPS;
    for (let k = STEPS - 1; k >= 0; k -= 1) {
      const g = k / STEPS;
      const lx = lerp(l[0][0], l[1][0]!, g); const lz = lerp(l[0][1], l[1][1]!, g);
      const rx = lerp(r[0][0], r[1][0]!, g); const rz = lerp(r[0][1], r[1][1]!, g);
      const y0 = WALL_H + k * rise;
      steps.push(Float64Array.from([lx, y0 + rise, lz, rx, y0 + rise, rz, lx, y0, lz, rx, y0, rz]));
    }
    panels.push({
      seat: Float64Array.from(seat),
      steps,
      wall: Float64Array.from([a[0], WALL_H, a[1], b[0], WALL_H, b[1], a[0], 0, a[1], b[0], 0, b[1]]),
      rim: Float64Array.from([ta[0]!, STAND_H + RIM_H, ta[1]!, tb[0]!, STAND_H + RIM_H, tb[1]!, ta[0]!, STAND_H, ta[1]!, tb[0]!, STAND_H, tb[1]!]),
      u0, u1, s0: s, len, main: i % 2 === 0, dist: 0,
    });
    s += len;
  }
  return panels;
}

// ------------------------------------------------------------------ actors

interface Actor extends Ref {
  art: HeroArt;
  pos: string;
  onOffense: boolean;
  /** 0..1, different for every hero: keeps idle motion out of step */
  phase: number;
  x: number; z: number; y: number;
  vx: number; vz: number;
  speed: number;
  /** 0..1 how much of the run cycle shows */
  run: number;
  cyc: number;
  /** +1 looks toward +x */
  face: 1 | -1;
  /** +1 looks toward screen right */
  look: 1 | -1;
  keys: Key[] | null;
  goalX: number; goalZ: number; hasGoal: boolean;
  crouchTo: number; crouch: number;
  jumpT0: number; jumpDur: number; jumpH: number;
  tumT0: number; tumDur: number; tumDir: number; downUntil: number;
  celebrate: boolean; celT0: number;
  /** seconds of white hit flash left */
  flash: number;
  aura: boolean;
  trail: number[];
  trailT: number;
  // practice ground
  /** warm-up station (index into STATIONS) */
  station: number;
  /** carries a ball in its hands */
  carry: boolean;
  /** 0..1: runs on the spot */
  jog: number;
  /** which way to look while standing (0: toward the other team) */
  faceLock: 0 | 1 | -1;
  /** ring colour instead of the team's */
  ring: string | null;
  /** steps forward and waves (a drill is being considered for this hero) */
  wave: boolean;
  /** start of a quick spin on the spot */
  flipT0: number;
  /** time the warm-up routine last ran, to catch its beats */
  rt: number;
  // projection of the feet this frame
  sx: number; sy: number; ss: number; sd: number; vis: boolean;
}

type CamMode = 'ground' | 'establish' | 'calm' | 'track' | 'low' | 'sky' | 'qb' | 'ball' | 'chase' | 'whip' | 'orbit' | 'attract';

interface ChalkLine {
  /** x,y,z triples */
  pts: number[];
  dashed: boolean;
  arrow: boolean;
  delay: number;
  width: number;
  alpha: number;
  /** what travels the line when the play is run through: a player (ring), the ball, or nothing */
  mark: 'run' | 'ball' | null;
}
interface ChalkZone { x0: number; x1: number; z0: number; z1: number; delay: number }

const tmp = { x: 0, z: 0 };

const W_PAD = 0.5;
/** the practice ground's turf: a little drier than the stadium's */
const GROUND_BANDS = ['#3f8f52', '#377f49'] as const;
const FIELD_QUAD = Float64Array.from([FX0, 0, FZ0, FX1, 0, FZ0, FX0, 0, FZ1, FX1, 0, FZ1]);
const quadTmp = new Float64Array(12);
/** Reorders a top-left, top-right, bottom-left, bottom-right quad into an outline. */
function QUAD_ORDER(q: ArrayLike<number>): Float64Array {
  for (let i = 0; i < 3; i += 1) {
    quadTmp[i] = q[i]!;
    quadTmp[3 + i] = q[3 + i]!;
    quadTmp[6 + i] = q[9 + i]!;
    quadTmp[9 + i] = q[6 + i]!;
  }
  return quadTmp;
}

/** Rounds the corners of a route and returns points every ~0.4 yards (x,y,z triples; y follows an arc when asked). */
function resample(way: [number, number][], arc: number): number[] {
  let pts = way.map((p) => [p[0], p[1]] as [number, number]);
  // corner cutting, keeping the two ends
  for (let it = 0; it < 2 && pts.length > 2; it += 1) {
    const out: [number, number][] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (i > 0) out.push([lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)]);
      if (i < pts.length - 2) out.push([lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)]);
    }
    out.push(pts[pts.length - 1]!);
    pts = out;
  }
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  const n = Math.max(2, Math.ceil(total / 0.4));
  const res: number[] = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k <= n; k += 1) {
    const want = (k / n) * total;
    while (seg < pts.length - 2) {
      const l = Math.hypot(pts[seg + 1]![0] - pts[seg]![0], pts[seg + 1]![1] - pts[seg]![1]);
      if (acc + l >= want) break;
      acc += l;
      seg += 1;
    }
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const f = sat((want - acc) / l);
    const u = k / n;
    res.push(lerp(a[0], b[0], f), arc > 0 ? 1.6 + arc * 4 * u * (1 - u) : 0, lerp(a[1], b[1], f));
  }
  return res;
}


export class Stadium {
  private ctx: CanvasRenderingContext2D;
  private cam = new Camera();
  private observer: ResizeObserver | null = null;
  private raf = 0;
  private dead = false;
  // canvas size in device pixels, and device pixels per CSS pixel
  private W = 0;
  private H = 0;
  private dpr = 1;
  // textures
  private field: FieldArt | null = null;
  private crowdCalm: Tex[] = [];
  private crowdHot: Tex[] = [];
  private ribbons: Record<'main' | 'td' | 'turnover' | 'win', Ribbon> | null = null;
  private ribbonMode: 'main' | 'td' | 'turnover' | 'win' = 'main';
  private ribbonUntil = 0;
  private sprites: Sprites;
  private bowl = buildBowl();
  private stars: number[] = [];
  private col: [RGB, RGB];
  private zoneCss: [string, string];
  // time
  private last = 0;
  /** real seconds since creation */
  private clock = 0;
  /** seconds of picture time: stops in a hit-stop, crawls in slow motion, runs with the play speed */
  private sim = 0;
  private hitStop = 0;
  private slowAmt = 1;
  private slowLeft = 0;
  // scene
  private actors: Actor[] = [];
  private offense: 0 | 1 = 0;
  private los = 15;
  private toGo = 10;
  private sceneN = 0;
  private hasScene = false;
  // play
  private script: Script | null = null;
  private playing = false;
  private playT = 0;
  private playSpeed = 1;
  private playFast = false;
  private cinematic = false;
  private cueIdx = 0;
  private hooks: PlayHooks | undefined;
  private endFired = false;
  private resolve: (() => void) | null = null;
  private watchdog = 0;
  // ball
  private bx = 0; private by = 1; private bz = 0;
  private ballHeld: Actor | null = null;
  private ballAir = false;
  private ballSpiral = true;
  private ballTrail: number[] = [];
  private ballGroundT = 0;
  // camera direction
  private camMode: CamMode = 'establish';
  private camT = 0;
  private camVar = 0;
  private camSide = 1;
  private camSnap = true;
  private camFrom = 0;
  /** the runner has broken free in this play */
  private broke = false;
  private sEx = new Spring(25); private sEy = new Spring(15); private sEz = new Spring(46);
  private sTx = new Spring(25); private sTy = new Spring(1); private sTz = new Spring(11);
  private sFov = new Spring(0.56);
  private focusX = 25; private focusZ = 12;
  private trauma = 0;
  private punch = 0;
  private fade = 0;
  // mood
  private motion = true;
  private exc = 0.2;
  private excTo = 0.2;
  private excBoost = 0;
  private flash = 0;
  private flashStorm = 0;
  private speedLines = 0;
  private fx = new Fx(900);
  private rings: { x: number; z: number; t: number; dur: number; r: number; color: string }[] = [];
  private bursts: { x: number; y: number; z: number; t: number; dur: number; size: number; seed: number }[] = [];
  private fireworks: { at: number; x: number; y: number; z: number; color: string; done: boolean }[] = [];
  private confettiUntil = 0;
  private confettiTeam: 0 | 1 = 0;
  // safe area (device px), eased
  private insTopTo = 0; private insBotTo = 0;
  private insTop = 0; private insBot = 0;
  private insInit = false;
  // chalk preview
  private chalk: { lines: ChalkLine[]; zones: ChalkZone[]; t0: number; tint: RGB; owner: Ref | null } | null = null;
  private chalkKey = '';
  /** the lines drawn over a running play (see stadium/guide.ts) */
  private guide: Guide | null = null;
  // practice ground (see stadium/ground.ts)
  private painter: Painter;
  private g: Ground | null = null;
  private groundOn = false;
  private gKey = '';
  private gField: FieldArt | null = null;
  private gClub: { short: string; color: string } = { short: '', color: '#ffffff' };
  private gCol: RGB = [255, 255, 255];
  private gPlan: DrillPlan | null = null;
  private drilling = false;
  /** where each hero warms up (same order as the heroes given to ground()), and their positions */
  private gStations: Station[] = [];
  private gPosts: Record<number, Post> = {};
  /** throws made in the warm-up: the quarterback's next target */
  private gTossN = 0;
  /** picture time at which the drill began, and seconds of drill gone by */
  private gSim0 = 0;
  private gT = 0;
  private gReal = 0;
  private gSpeed = 1;
  private gCue = 0;
  private gHooks: DrillHooks | undefined;
  private gEndFired = false;
  private gResolve: (() => void) | null = null;
  private gWatch = 0;
  private gLines = false;
  private gHint: { kind: DrillKind; lead: number | undefined; x: number; z: number } | null = null;
  private gBalls: { s0: number; s1: number; from: [number, number, number]; to: [number, number, number]; h: number; catcher: Actor | null; trail: number[]; x: number; y: number; z: number }[] = [];
  private gTossAt = 0;
  private gShot = 0;
  private gShotT = 0;
  private gShotLen = 14;
  private propOrder: Prop[] = [];
  // attract mode
  private attractOn = false;
  private attractShot = 0;
  private attractShotT = 0;
  private attractWait = 0;
  private attractN = 0;
  private rnd = seeded(20260);
  // resolution scale (see setQuality)
  private quality = 1;
  private qualityAuto = true;
  /** a frame has been drawn at least once (so a resize may redraw at once) */
  private drawn = false;
  private frameEma = 16;
  private frameDev = 0;
  private slowFor = 0;
  private trial = 0;
  private trialFrom = 1;
  private trialBase = 16;
  // stats
  private statDt: number[] = [];
  private statCpu: number[] = [];

  constructor(private canvas: HTMLCanvasElement, private teams: [TeamSheet, TeamSheet]) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.col = [rgbOf(teams[0].color), rgbOf(teams[1].color)];
    this.zoneCss = [css(zoneColor(teams[0].color)), css(zoneColor(teams[1].color))];
    for (const t of teams) for (const p of t.players) heroArt(p.id);
    this.sprites = bakeSprites(teams);
    // the big textures are baked when they are first drawn (the practice ground never needs the stands);
    // they use web fonts, so they are thrown away once the fonts can be drawn
    void loadFonts(this.fontTexts()).then(() => {
      if (this.dead) return;
      this.field = null;
      this.ribbons = null;
      this.gField = null;
      if (this.g) this.g.repaint();
    });
    this.painter = {
      ctx: this.ctx, cam: this.cam, px: 1, W: 1, H: 1,
      fill: (pts, style) => this.fillPoly(pts, style),
      tex: (img, sx, sy, sw, sh, quad, nu, nv, tol, depth, smooth) => {
        this.ctx.imageSmoothingEnabled = smooth;
        this.texQuad(img, sx, sy, sw, sh, quad, nu, nv, tol, depth);
      },
    };
    const sr = seeded(9);
    for (let i = 0; i < 70; i += 1) {
      const az = sr() * TAU;
      const el = 0.06 + sr() * 0.9;
      this.stars.push(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el), 0.4 + sr() * 0.6);
    }
    for (let i = 0; i < 34; i += 1) this.spawnMote(true);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ public API

  /** Both teams line up for the next play; camera eases to a pre-snap establishing shot. Idle life continues forever. */
  setScene(st: MatchState): void {
    this.endPlay(true);
    const first = !this.hasScene || this.attractOn || this.groundOn;
    this.leaveGround();
    this.attractOn = false;
    this.teams = st.teams;
    this.offense = st.poss;
    this.los = st.pos;
    this.toGo = st.toGo;
    this.sceneN = st.n;
    this.hasScene = true;
    this.script = null;
    this.chalk = null;
    this.guide = null;
    this.place(this.offense, this.los, first);
    this.ballHeld = this.find(this.offense, this.teams[this.offense].lineup.off.QB);
    this.ballAir = false;
    this.ballTrail.length = 0;
    this.speedLines = 0;
    this.setCam(this.motion ? 'establish' : 'calm', st.n % 3, first);
  }

  /**
   * While the player is choosing: draws the selected card on the turf in chalk (routes and arrows from the
   * real players for an offensive play; hatched zones or rush arrows for a defensive call). null clears it.
   * Once drawn, the play runs itself over and over: a marker travels every route, the ball flies its line.
   * `stars`: heroes of the player's team who matter most in this play (they glow).
   */
  preview(pick: Pick | null, side: 'off' | 'def', playerTeam: 0 | 1, stars: number[] = []): void {
    if (!pick || !this.hasScene || this.playing) {
      this.chalk = null;
      this.chalkKey = '';
      for (const ac of this.actors) if (!this.playing) ac.aura = false;
      return;
    }
    // asking for the card that is already drawn must not start the drawing over
    const key = `${side}:${pick.type}:${pick.special ? pick.special.key : ''}:${playerTeam}:${this.sceneN}:${this.offense}:${this.los}`;
    if (this.chalk && key === this.chalkKey) return;
    this.chalkKey = key;
    this.guide = null;
    this.buildChalk(pick, side, playerTeam, stars);
  }

  /** Plays the play back with camera work. speed 1 = normal, 2 = fast, 12 = debug bot. Resolves when the picture has settled. */
  play(res: PlayResult, speed: number, hooks?: PlayHooks): Promise<void> {
    this.endPlay(true);
    this.leaveGround();
    this.attractOn = false;
    this.hasScene = true;
    if (res.kick) {
      // the kicker comes on where the running back stands (for this play only: the next scene puts the line-up back)
      const t = this.teams[res.off];
      const off = { ...t.lineup.off };
      const at = OFF_POS.find((p) => off[p] === res.kick!.kicker);
      if (at) off[at] = off.RB;
      off.RB = res.kick.kicker;
      const sheet: TeamSheet = { ...t, lineup: { ...t.lineup, off } };
      this.teams = res.off === 0 ? [sheet, this.teams[1]] : [this.teams[0], sheet];
    }
    return this.run(specOf(res), speed, hooks, false);
  }

  /** 0..1: how worked-up the crowd is (camera flashes, waving, light flicker). Smoothly approached. */
  setExcitement(v: number): void {
    this.excTo = sat(Number.isFinite(v) ? v : 0);
  }

  /** Big moments on top of a finished play: 'td' confetti + fireworks + flash storm, 'win' longer version, 'turnover' brief flash. */
  celebrate(kind: 'td' | 'win' | 'turnover', team: 0 | 1): void {
    const now = this.clock;
    const colors = [css(mix(this.col[team], [255, 255, 255], 0.25)), '#fff4d6', css(mix(this.col[team], [255, 255, 255], 0.6))];
    if (kind === 'turnover') {
      if (this.motion) this.flash = Math.max(this.flash, 0.35);
      this.flashStorm = Math.max(this.flashStorm, 1.2);
      this.excBoost = Math.max(this.excBoost, 0.6);
      this.ribbonMode = 'turnover';
      this.ribbonUntil = now + 2.6;
      return;
    }
    const long = kind === 'win';
    const span = long ? 9 : 3.2;
    if (this.motion) this.flash = Math.max(this.flash, 0.4);
    this.flashStorm = Math.max(this.flashStorm, span);
    this.excBoost = 1;
    this.confettiTeam = team;
    this.confettiUntil = Math.max(this.confettiUntil, now + (long ? 7 : 1.6));
    this.ribbonMode = long ? 'win' : 'td';
    this.ribbonUntil = now + span + 1.5;
    // do not stack a second show on top of one that has only just begun
    const pending = this.fireworks.filter((f) => !f.done).length;
    if (pending > (long ? 4 : 2)) return;
    const n = long ? 16 : 6;
    for (let i = 0; i < n; i += 1) {
      this.fireworks.push({ at: now + 0.15 + i * (span / n) + Math.random() * 0.2, x: 0, y: 0, z: 0, color: colors[i % colors.length]!, done: false });
    }
  }

  /** Title-screen mode: slow cinematic camera moves over the lit stadium while the two teams run plays on their own, forever. */
  attract(): void {
    this.endPlay(true);
    this.leaveGround();
    this.attractOn = true;
    this.hasScene = false;
    this.chalk = null;
    this.guide = null;
    this.script = null;
    this.attractShot = Math.floor(this.rnd() * 5);
    this.attractShotT = 0;
    const spec = randomSpec(this.teams, this.attractN, this.rnd);
    this.attractN += 1;
    this.pendingSpec = spec;
    this.attractWait = 1.6;
    this.offense = spec.off;
    this.los = spec.los;
    this.toGo = spec.toGo;
    this.place(spec.off, spec.los, true);
    this.ballHeld = this.find(spec.off, this.teams[spec.off].lineup.off.QB);
    this.ballAir = false;
    this.setCam('attract', 0, true);
  }

  // ------------------------------------------------------------------ practice ground: public API

  /**
   * Practice ground: no match state. `heroes` are the club's members (up to seven), all team 0.
   * `day` 0..27 changes the light from day to day (Monday bright late afternoon … Saturday deep sunset, weeks differ a little).
   * The heroes warm up by themselves forever; the camera drifts and now and then cuts to another relaxed angle.
   */
  ground(opts: { heroes: number[]; day?: number; color?: string; posts?: Record<number, Post> }): void {
    this.endPlay(true);
    this.endDrill(true);
    const first = !this.groundOn;
    this.attractOn = false;
    this.hasScene = false;
    this.guide = null;
    this.script = null;
    this.chalk = null;
    const day = Number.isFinite(opts.day) ? (opts.day as number) : 0;
    const color = opts.color ?? this.teams[0].color;
    const short = this.teams[0].short;
    const key = `${day}|${color}|${short}`;
    if (!this.g || key !== this.gKey) {
      this.g = new Ground(short, color, day);
      this.gKey = key;
    }
    if (color !== this.gClub.color || short !== this.gClub.short) this.gField = null;
    this.gClub = { short, color };
    this.gCol = rgbOf(color);
    this.groundOn = true;
    this.gHint = null;
    this.g.highlight([]);
    const keep: Actor[] = [];
    const ids = opts.heroes.slice(0, STATIONS.length);
    this.gPosts = opts.posts ?? {};
    this.gStations = stationsFor(ids, opts.posts);
    ids.forEach((id, i) => {
      const st = this.gStations[i]!;
      let ac = this.find(0, id);
      if (!ac) ac = this.newActor(0, id, st.x, st.z);
      else if (first) {
        ac.x = st.x;
        ac.z = st.z;
      }
      this.plain(ac);
      ac.station = i;
      ac.faceLock = st.face;
      ac.onOffense = true;
      ac.pos = '';
      keep.push(ac);
    });
    this.actors = keep;
    this.ballHeld = null;
    this.ballAir = false;
    this.ballTrail.length = 0;
    this.gBalls.length = 0;
    this.speedLines = 0;
    const thrower = keep.find((a) => this.gStations[a.station]?.job === 'tossA');
    if (thrower) thrower.carry = true;
    this.gTossAt = this.sim + 1;
    if (first) {
      this.gShot = 0;
      this.gShotT = 0;
      this.gShotLen = 13;
      this.fx.clear(false);
      for (let i = 0; i < 44; i += 1) this.spawnMote(true);
      this.setCam('ground', 0, true);
    }
    void loadFonts([short, '紅白0-']).then(() => {
      if (this.dead || !this.groundOn) return;
      this.gField = null;
      this.g?.repaint();
    });
  }

  /**
   * Everyone (for 'solo' one hero, the others carrying on behind; for 'special' the lead shows and the rest copy)
   * performs the drill for about 1.5 s at speed 1 with a purposeful camera move, then the scene settles back into
   * the warm-up. Resolves when it has settled; never hangs. Calling it again mid-drill fast-forwards the old one.
   */
  drill(kind: DrillKind, opts: { lead?: number; speed?: number } = {}, hooks?: DrillHooks): Promise<void> {
    this.endDrill(true);
    const g = this.g;
    if (!this.groundOn || !g || !this.actors.length || this.dead) {
      this.safe(() => hooks?.onEnd?.());
      return Promise.resolve();
    }
    const sp = Math.max(0.05, Number.isFinite(opts.speed) ? (opts.speed as number) : 1);
    this.clearHint();
    const needsLead = kind === 'solo' || kind === 'special';
    const lead = opts.lead !== undefined && this.find(0, opts.lead) ? opts.lead : needsLead ? this.actors[0]!.id : undefined;
    const who = kind === 'solo' ? this.actors.filter((a) => a.id === lead) : this.actors;
    const plan = buildDrill(kind, who.map((a) => ({ id: a.id, x: a.x, z: a.z, off: this.gPosts[a.id]?.off ?? null, def: this.gPosts[a.id]?.def ?? null })), lead, this.bestOf(lead));
    // the warm-up's ball is put away
    this.gBalls.length = 0;
    for (const ac of this.actors) {
      const keys = plan.keys.get(ac.id) ?? null;
      ac.keys = keys;
      if (!keys) continue;
      ac.carry = false;
      ac.hasGoal = false;
      ac.jog = 0;
      ac.wave = false;
      ac.crouchTo = 0;
      ac.faceLock = plan.face.get(ac.id) ?? 0;
      ac.ring = plan.rings.get(ac.id) ?? null;
      if (ac.tumT0 >= 0) ac.downUntil = Math.min(ac.downUntil, this.sim);
    }
    g.highlight(propsOf(kind, plan.solo));
    for (const b of plan.balls) {
      this.gBalls.push({ s0: this.sim + b.t0, s1: this.sim + b.t1, from: b.from, to: b.to, h: b.h, catcher: null, trail: [], x: b.from[0], y: b.from[1], z: b.from[2] });
    }
    this.gPlan = plan;
    this.drilling = true;
    this.gSim0 = this.sim;
    this.gT = 0;
    this.gReal = 0;
    this.gSpeed = sp;
    this.gCue = 0;
    this.gHooks = hooks;
    this.gEndFired = false;
    this.gLines = false;
    clearTimeout(this.gWatch);
    return new Promise<void>((resolve) => {
      this.gResolve = resolve;
      // frames may stop coming (hidden tab): the drill still ends
      this.gWatch = window.setTimeout(() => this.endDrill(true), (plan.dur / sp) * 1000 * 1.2 + 1800);
    });
  }

  /**
   * A practice card is only being considered: the heroes turn toward the spot, the equipment lights up,
   * and for 'solo' / 'special' the lead steps forward and waves. null clears it.
   */
  hintDrill(kind: DrillKind | null, lead?: number): void {
    const g = this.g;
    if (!this.groundOn || !g) return;
    if (!kind) {
      this.clearHint();
      return;
    }
    if (this.drilling) return;
    if (this.gHint && this.gHint.kind === kind && this.gHint.lead === lead) return;
    this.clearHint();
    const needsLead = kind === 'solo' || kind === 'special';
    const leadAc = (lead !== undefined ? this.find(0, lead) : null) ?? (needsLead ? this.actors[0] ?? null : null);
    const best = this.bestOf(leadAc?.id);
    const [x, z] = spotOf(kind, best);
    this.gHint = { kind, lead, x, z };
    g.highlight(propsOf(kind, best));
    this.actors.forEach((ac, i) => {
      if (Math.abs(x - ac.x) > 1) ac.faceLock = x > ac.x ? 1 : -1;
      // a little hop of attention, one after the other
      ac.jumpT0 = this.sim + i * 0.05;
      ac.jumpDur = 0.24;
      ac.jumpH = 0.3;
    });
    if (needsLead && leadAc) {
      leadAc.wave = true;
      if (kind === 'special') leadAc.aura = true;
      else {
        const coach = g.find('coach');
        coach.x = clamp(leadAc.x + (leadAc.x > 30 ? -3.2 : 3.2), 2, 46);
        coach.z = clamp(leadAc.z + 4.6, 2, WIDTH - 0.5);
        coach.aTo = 1;
      }
    }
  }

  /** Where a hero currently is on screen in CSS px relative to the canvas (feet); null if not on field. `scale` is CSS px per sprite pixel, `h` the sprite's height. */
  screenPos(team: 0 | 1, heroId: number): { x: number; y: number; scale: number; h: number } | null {
    const ac = this.actors.find((a) => a.team === team && a.id === heroId);
    if (!ac || !ac.vis || this.dpr <= 0) return null;
    const h = (HERO_H * ac.ss) / this.dpr;
    return { x: ac.sx / this.dpr, y: ac.sy / this.dpr, scale: h / ART, h };
  }

  /** false: no shake, no flashes, no slow motion, calmer camera (accessibility setting). Default true. */
  setMotion(full: boolean): void {
    this.motion = full;
    if (!full) {
      this.trauma = 0;
      this.flash = 0;
      this.hitStop = 0;
      this.slowLeft = 0;
      this.speedLines = 0;
      if (!this.attractOn && !this.groundOn) this.setCam('calm', 0, false);
    } else if (!this.playing && !this.attractOn && !this.groundOn && this.hasScene) this.setCam('establish', this.sceneN % 3, false);
  }

  /**
   * CSS px at the top and bottom of the canvas covered by DOM UI. The action is framed in the band between
   * them (the principal point slides there over ~400 ms); sky, stands and turf still fill the whole canvas.
   */
  setSafeArea(top: number, bottom: number): void {
    this.insTopTo = Math.max(0, Number.isFinite(top) ? top : 0);
    this.insBotTo = Math.max(0, Number.isFinite(bottom) ? bottom : 0);
    if (!this.insInit) {
      this.insInit = true;
      this.insTop = this.insTopTo * this.dpr;
      this.insBot = this.insBotTo * this.dpr;
    }
  }

  /**
   * Resolution scale on top of the device pixel ratio. 'auto' (default) starts at 1 and steps down
   * when the device cannot hold its frame rate; a number (0.5..1) fixes it.
   */
  setQuality(q: 'auto' | number): void {
    this.qualityAuto = q === 'auto';
    const v = q === 'auto' ? 1 : clamp(q, 0.5, 1);
    this.slowFor = 0;
    this.trial = 0;
    if (v !== this.quality) {
      this.quality = v;
      this.W = -1;
      this.resize();
    }
  }

  /** Frame times over the last few seconds (for the lab page). */
  stats(): StadiumStats {
    const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const max = (a: number[]): number => (a.length ? Math.max(...a) : 0);
    return {
      frames: this.statDt.length, avg: avg(this.statDt), worst: max(this.statDt),
      cpuAvg: avg(this.statCpu), cpuWorst: max(this.statCpu), particles: this.fx.count, quality: this.quality,
    };
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.observer = null;
    clearTimeout(this.watchdog);
    clearTimeout(this.gWatch);
    const done = this.resolve;
    this.resolve = null;
    this.playing = false;
    done?.();
    const drilled = this.gResolve;
    this.gResolve = null;
    this.drilling = false;
    drilled?.();
  }

  // ------------------------------------------------------------------ set-up helpers

  private fontTexts(): string[] {
    return [this.teams[0].name, this.teams[1].name, this.teams[0].short, this.teams[1].short,
      'GO! マイクリ ナイスプレー！ ファイト！ タッチダウン！！ 攻守交代！ 勝利！ おめでとう！ MY CRYPTO FOOTBALL TOUCHDOWN TURNOVER VICTORY DEFENSE'];
  }

  private bakeRibbons(): Record<'main' | 'td' | 'turnover' | 'win', Ribbon> {
    const [a, b] = this.teams;
    const ca = ledColor(a.color);
    const cb = ledColor(b.color);
    const gold = '#ffd98a';
    // the message repeats a whole number of times around the bowl, so it has no seam
    const last = this.bowl[this.bowl.length - 1]!;
    const per = (last.s0 + last.len) * RIBBON_PPY;
    return {
      main: bakeRibbon(per, [
        { text: a.name, color: ca }, { text: 'GO! マイクリ', color: '#f2f5ff' }, { text: b.name, color: cb },
        { text: 'MY CRYPTO FOOTBALL', color: gold }, { text: 'ナイスプレー！', color: '#9fe8c8' }, { text: `${a.short} vs ${b.short}`, color: '#f2f5ff' },
        { text: 'ファイト！', color: '#ffb0a0' },
      ]),
      td: bakeRibbon(per, [{ text: 'TOUCHDOWN!!', color: gold }, { text: 'タッチダウン！！', color: '#ffffff' }], '#1a1206'),
      turnover: bakeRibbon(per, [{ text: 'TURNOVER!', color: '#ff9c8a' }, { text: '攻守交代！', color: '#ffffff' }], '#1a0a0a'),
      win: bakeRibbon(per, [{ text: 'VICTORY!!', color: gold }, { text: '勝利！ おめでとう！', color: '#ffffff' }], '#101a2c'),
    };
  }

  private ensureArt(): void {
    if (!this.field) this.field = bakeField(this.teams);
    if (!this.ribbons) this.ribbons = this.bakeRibbons();
    if (!this.crowdCalm.length) this.bakeCrowds();
  }

  private bakeCrowds(): void {
    this.crowdCalm = [0, 1, 2].map((f) => bakeCrowd(this.teams, f, false));
    this.crowdHot = [0, 1, 2].map((f) => bakeCrowd(this.teams, f, true));
  }

  private resize(): void {
    if (this.dead) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      this.W = 0;
      this.H = 0;
      return;
    }
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxPx = 2.5e6;
    if (r.width * r.height * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (r.width * r.height));
    dpr *= this.quality;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (w === this.W && h === this.H) return;
    this.dpr = dpr;
    this.W = w;
    this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;
    // the canvas is empty now; a resize seen between two frames would show as a black flash
    if (this.drawn) {
      try {
        this.draw();
      } catch {
        /* the next frame draws it */
      }
    }
  }

  private find(team: 0 | 1, id: number): Actor | null {
    for (const a of this.actors) if (a.team === team && a.id === id) return a;
    return null;
  }

  private newActor(team: 0 | 1, id: number, x: number, z: number): Actor {
    return {
      team, id, art: heroArt(id), pos: '', onOffense: false, phase: hash(id * 3.7 + team * 11.3),
      x, z, y: 0, vx: 0, vz: 0, speed: 0, run: 0, cyc: hash(id) * 6,
      face: team === 0 ? 1 : -1, look: team === 0 ? 1 : -1,
      keys: null, goalX: x, goalZ: z, hasGoal: false, crouchTo: 0, crouch: 0,
      jumpT0: -9, jumpDur: 0.4, jumpH: 0, tumT0: -1, tumDur: 0.5, tumDir: 1, downUntil: 0,
      celebrate: false, celT0: 0, flash: 0, aura: false, trail: [], trailT: 0,
      station: 0, carry: false, jog: 0, faceLock: 0, ring: null, wave: false, flipT0: -9, rt: 0,
      sx: 0, sy: 0, ss: 0, sd: 0, vis: false,
    };
  }

  /** Sends everybody to their spot for a snap at `los`; `jump` puts them there at once. */
  private place(offense: 0 | 1, los: number, jump: boolean): void {
    const spots = lineUp(this.teams, offense, los);
    const keep: Actor[] = [];
    for (const s of spots) {
      let ac = this.find(s.team, s.id);
      if (!ac) {
        ac = this.newActor(s.team, s.id, s.x, s.z);
      } else if (jump) {
        ac.x = s.x;
        ac.z = s.z;
      }
      this.plain(ac);
      ac.pos = s.pos;
      ac.onOffense = s.offense;
      ac.keys = null;
      ac.goalX = s.x;
      ac.goalZ = s.z;
      ac.hasGoal = !jump && Math.hypot(ac.x - s.x, ac.z - s.z) > 0.05;
      ac.crouchTo = 0;
      ac.celebrate = false;
      ac.aura = false;
      ac.trail.length = 0;
      ac.y = 0;
      if (ac.tumT0 >= 0) ac.downUntil = Math.min(ac.downUntil, this.sim);
      keep.push(ac);
    }
    this.actors = keep;
  }

  // ------------------------------------------------------------------ running a play

  private run(spec: PlaySpec, speed: number, hooks: PlayHooks | undefined, cinematic: boolean): Promise<void> {
    const sp = Math.max(0.05, Number.isFinite(speed) ? speed : 1);
    this.offense = spec.off;
    this.los = spec.los;
    this.toGo = spec.toGo;
    this.sceneN = spec.n;
    this.chalk = null;
    // make sure everyone who is in this play is on the field
    const spots = lineUp(this.teams, spec.off, spec.los);
    const keep: Actor[] = [];
    for (const s of spots) {
      const ac = this.find(s.team, s.id) ?? this.newActor(s.team, s.id, s.x, s.z);
      ac.pos = s.pos;
      ac.onOffense = s.offense;
      ac.carry = false;
      ac.jog = 0;
      ac.faceLock = 0;
      ac.ring = null;
      ac.wave = false;
      keep.push(ac);
    }
    this.actors = keep;
    this.playFast = sp >= 8;
    const script = buildScript(this.teams, spec, (team, id) => {
      const ac = this.find(team, id);
      return ac ? [ac.x, ac.z] : null;
    }, this.playFast);
    for (const ac of this.actors) {
      const plan = script.plans.find((p) => p.team === ac.team && p.id === ac.id);
      ac.keys = plan ? plan.keys : null;
      ac.hasGoal = false;
      ac.aura = !!plan && plan.star;
      ac.celebrate = false;
      ac.crouchTo = this.playFast ? 0 : 1;
      ac.trail.length = 0;
      if (ac.tumT0 >= 0) ac.downUntil = Math.min(ac.downUntil, this.sim);
    }
    this.script = script;
    // the title screen's plays and the fast-forward run without the drawn lines
    this.guide = cinematic || this.playFast ? null : new Guide(script, this.col[spec.off], this.clock);
    this.playing = true;
    this.playT = 0;
    this.playSpeed = sp;
    this.cinematic = cinematic;
    this.cueIdx = 0;
    this.hooks = hooks;
    this.endFired = false;
    this.speedLines = 0;
    this.broke = false;
    this.ballTrail.length = 0;
    if (!cinematic) this.pickShot(script);
    clearTimeout(this.watchdog);
    return new Promise<void>((resolve) => {
      this.resolve = resolve;
      // the picture is driven by animation frames; if they stop (hidden tab), the play still ends
      const ms = (script.dur / sp) * 1000;
      this.watchdog = window.setTimeout(() => this.endPlay(true), ms * 1.2 + 2000);
    });
  }

  /** Ends the play that is running, if any. `force`: jump to its last picture. */
  private endPlay(force: boolean): void {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this.watchdog);
    const script = this.script;
    if (script && force && this.playT < script.dur) {
      this.playT = script.dur;
      for (const ac of this.actors) {
        if (ac.keys) {
          evalKeys(ac.keys, this.playT, tmp);
          ac.x = tmp.x;
          ac.z = tmp.z;
        }
        ac.crouchTo = 0;
        ac.y = 0;
      }
      this.hitStop = 0;
      this.slowLeft = 0;
    }
    if (!this.endFired) {
      this.endFired = true;
      if (!this.dead) this.safe(() => this.hooks?.onEnd?.());
    }
    this.guide?.finish(this.clock);
    this.hooks = undefined;
    const done = this.resolve;
    this.resolve = null;
    done?.();
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      // a broken hook must not stop the picture
      console.error(err);
    }
  }

  private actor(r: Ref | null): Actor | null {
    return r ? this.find(r.team, r.id) : null;
  }

  private cue(c: Cue, script: Script): void {
    const hooks = this.hooks;
    const fancy = this.motion && !this.playFast && !this.cinematic;
    const dir = script.dir;
    switch (c.c) {
      case 'ignite': {
        const ac = this.actor(c.who);
        if (!ac) break;
        this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.6, r: 5, color: css(mix(this.col[ac.team], [255, 255, 255], 0.5)) });
        this.bursts.push({ x: ac.x, y: 1.5, z: ac.z, t: this.clock, dur: 0.4, size: 2.4, seed: ac.id });
        for (let i = 0; i < 14; i += 1) this.auraSpark(ac, 1.6);
        ac.flash = 0.09;
        if (fancy) {
          this.flash = Math.max(this.flash, 0.22);
          this.trauma = Math.max(this.trauma, 0.25);
          this.punch = Math.max(this.punch, 0.5);
        }
        this.excBoost = Math.max(this.excBoost, 0.5);
        break;
      }
      case 'snap': {
        for (const ac of this.actors) ac.crouchTo = 0;
        for (let i = 0; i < 10; i += 1) {
          const p = this.fx.spawn(PUFF, script.losX + (Math.random() - 0.5) * 0.6, 0.2, 6 + Math.random() * 12);
          p.tex = 1;
          p.vx = -dir * (0.5 + Math.random() * 2);
          p.vy = 0.8 + Math.random() * 1.6;
          p.vz = (Math.random() - 0.5) * 2;
          p.drag = 2.5;
          p.max = 0.5 + Math.random() * 0.4;
          p.size = 0.5;
          p.grow = 1.6;
          p.alpha = 0.5;
        }
        if (fancy) this.trauma = Math.max(this.trauma, 0.12);
        this.safe(() => hooks?.onSnap?.());
        break;
      }
      case 'clash': {
        for (const [x, z] of c.at) this.dust(x, z, 5, 2.2, false);
        if (fancy) this.trauma = Math.max(this.trauma, 0.2);
        this.safe(() => hooks?.onImpact?.(0.25));
        break;
      }
      case 'handoff':
        this.safe(() => hooks?.onHandoff?.());
        break;
      case 'throw': {
        if (!this.cinematic && this.camMode === 'qb') this.setCam('ball', this.camVar, false);
        this.safe(() => hooks?.onThrow?.(c.long));
        break;
      }
      case 'kick': {
        if (!this.cinematic && this.camMode === 'qb') this.setCam('ball', this.camVar, false);
        this.trauma = Math.max(this.trauma, this.motion ? 0.25 : 0);
        this.safe(() => hooks?.onKick?.());
        break;
      }
      case 'jump': {
        const ac = this.actor(c.who);
        if (ac) {
          ac.jumpT0 = this.sim;
          ac.jumpDur = c.dur;
          ac.jumpH = c.h;
        }
        break;
      }
      case 'dive': {
        const ac = this.actor(c.who);
        if (ac) this.tumble(ac, c.dir * dir, 0.4, 0.55);
        break;
      }
      case 'catch': {
        const ac = this.actor(c.who);
        if (ac) {
          this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.4, r: 3.2, color: 'rgba(255,255,255,0.9)' });
          this.glints(ac.x, 2.4, ac.z, 5, 1);
        }
        if (c.long) {
          this.excBoost = Math.max(this.excBoost, 0.7);
          if (fancy) {
            this.slow(0.3, 0.42);
            this.punch = Math.max(this.punch, 0.7);
          }
        }
        if (!this.cinematic && this.camMode === 'ball') this.setCam('chase', this.camVar, false);
        this.safe(() => hooks?.onCatch?.());
        break;
      }
      case 'swat': {
        this.bursts.push({ x: c.x, y: c.y, z: c.z, t: this.clock, dur: 0.22, size: 2, seed: 3 });
        if (fancy) {
          this.trauma = Math.max(this.trauma, 0.3);
          this.hitStop = Math.max(this.hitStop, 0.05);
        }
        this.safe(() => hooks?.onImpact?.(0.35));
        break;
      }
      case 'drop': {
        this.dust(c.x, c.z, 5, 1.6, false);
        this.ballGroundT = this.sim;
        this.safe(() => hooks?.onDrop?.());
        break;
      }
      case 'impact': {
        const pw = c.power;
        const victim = this.actor(c.victim);
        const hitter = this.actor(c.hitter);
        this.dust(c.x, c.z, 6 + Math.round(pw * 10), 2.5 + pw * 3, true);
        this.rings.push({ x: c.x, z: c.z, t: this.clock, dur: 0.35 + pw * 0.2, r: 3 + pw * 4, color: 'rgba(255,255,255,0.85)' });
        this.bursts.push({ x: c.x, y: 1.4, z: c.z, t: this.clock, dur: 0.18 + pw * 0.12, size: 1.3 + pw * 1.5, seed: Math.floor(this.clock * 31) });
        if (victim) {
          victim.flash = 0.07 + pw * 0.05;
          // knocked back or falling forward along the offense's direction
          const fall = (c.back ? -1 : 1) * dir * (victim.team === script.spec.off ? 1 : -1);
          this.tumble(victim, fall, 0.36 + pw * 0.2, 0.45 + pw * 0.35);
        }
        if (hitter) hitter.flash = 0.05;
        this.excBoost = Math.max(this.excBoost, 0.25 + pw * 0.45);
        if (fancy) {
          this.trauma = Math.max(this.trauma, 0.3 + pw * 0.6);
          this.hitStop = Math.max(this.hitStop, 0.045 + pw * 0.075);
          this.punch = Math.max(this.punch, 0.35 + pw * 0.65);
          if (pw > 0.7) this.flash = Math.max(this.flash, 0.16 + (pw - 0.7) * 0.5);
        }
        this.speedLines = 0;
        this.safe(() => hooks?.onImpact?.(pw));
        break;
      }
      case 'steal': {
        const ac = this.actor(c.who);
        if (ac) {
          ac.aura = true;
          this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.55, r: 6, color: css(mix(this.col[ac.team], [255, 255, 255], 0.5)) });
          this.glints(ac.x, 2.6, ac.z, 8, 1.4);
        }
        this.excBoost = 1;
        this.flashStorm = Math.max(this.flashStorm, 1.4);
        if (fancy) {
          this.slow(0.28, 0.5);
          this.flash = Math.max(this.flash, 0.3);
          this.trauma = Math.max(this.trauma, 0.4);
        }
        if (!this.cinematic && this.motion && !this.playFast) this.setCam('whip', this.camVar, false);
        this.safe(() => hooks?.onSteal?.());
        break;
      }
      case 'break': {
        this.excBoost = Math.max(this.excBoost, 0.8);
        if (fancy) {
          this.speedLines = 1;
          this.punch = -0.8;
          this.broke = true;
        }
        this.safe(() => hooks?.onBreak?.());
        break;
      }
      case 'td': {
        const ac = this.actor(c.who);
        this.excBoost = 1;
        this.flashStorm = Math.max(this.flashStorm, 2.2);
        this.speedLines = 0;
        if (ac) {
          this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.7, r: 9, color: css(mix(this.col[ac.team], [255, 255, 255], 0.55)) });
          ac.aura = true;
        }
        if (fancy) {
          this.slow(0.32, 0.6);
          this.flash = Math.max(this.flash, 0.38);
          this.trauma = Math.max(this.trauma, 0.35);
          this.setCam('orbit', this.camVar, false);
        }
        this.guide?.touchdown(this.clock);
        this.safe(() => hooks?.onTouchdown?.());
        break;
      }
      case 'celebrate': {
        for (const ac of this.actors) {
          if (ac.team !== c.team || ac.tumT0 >= 0) continue;
          ac.celebrate = true;
          ac.celT0 = this.sim;
        }
        break;
      }
      case 'end': {
        this.guide?.finish(this.clock);
        if (!this.endFired) {
          this.endFired = true;
          this.safe(() => hooks?.onEnd?.());
        }
        break;
      }
      default:
        break;
    }
  }

  /** Sends a hero head over heels toward world direction `wx` (+1: toward +x), then leaves it on the turf for `down` seconds. */
  private tumble(ac: Actor, wx: number, dur: number, down: number): void {
    // which way that is on screen
    const cam = this.cam;
    let s = wx > 0 ? 1 : -1;
    if (cam.project(ac.x, 0, ac.z)) {
      const x0 = cam.sx;
      if (cam.project(ac.x + wx, 0, ac.z) && Math.abs(cam.sx - x0) > 0.5) s = cam.sx > x0 ? 1 : -1;
    }
    ac.tumT0 = this.sim;
    ac.tumDur = dur;
    ac.tumDir = s;
    ac.downUntil = this.sim + dur + down;
    ac.celebrate = false;
  }

  private slow(scaleTo: number, seconds: number): void {
    this.slowAmt = scaleTo;
    this.slowLeft = seconds;
  }

  // ------------------------------------------------------------------ effects

  private dust(x: number, z: number, n: number, spread: number, turf: boolean): void {
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * TAU;
      const p = this.fx.spawn(PUFF, x + Math.cos(a) * 0.4, 0.25, z + Math.sin(a) * 0.4);
      const s = spread * (0.3 + Math.random() * 0.7);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = 0.6 + Math.random() * 1.6;
      p.drag = 3;
      p.max = 0.45 + Math.random() * 0.45;
      p.size = 0.45 + Math.random() * 0.3;
      p.grow = 1.8;
      p.alpha = 0.55;
    }
    if (!turf) return;
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * TAU;
      const p = this.fx.spawn(CHUNK, x, 0.3, z);
      const s = spread * (0.5 + Math.random());
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = 3 + Math.random() * 5;
      p.grav = 22;
      p.max = 0.7 + Math.random() * 0.5;
      p.size = 0.14 + Math.random() * 0.14;
      p.color = Math.random() < 0.5 ? '#2c8f58' : Math.random() < 0.5 ? '#15502f' : '#6b5a3a';
    }
  }

  private glints(x: number, y: number, z: number, n: number, spread: number): void {
    for (let i = 0; i < n; i += 1) {
      const p = this.fx.spawn(GLINT, x + (Math.random() - 0.5) * spread * 2, y + (Math.random() - 0.5) * spread * 2, z + (Math.random() - 0.5) * spread);
      p.max = 0.25 + Math.random() * 0.3;
      p.size = 16 + Math.random() * 18;
      p.alpha = 0.95;
    }
  }

  private auraSpark(ac: Actor, power: number): void {
    const a = Math.random() * TAU;
    const p = this.fx.spawn(SPARK, ac.x + Math.cos(a) * 0.9, 0.2 + Math.random() * 1.2, ac.z + Math.sin(a) * 0.6);
    p.vy = (2.5 + Math.random() * 3.5) * power;
    p.vx = Math.cos(a) * 0.6;
    p.vz = Math.sin(a) * 0.6;
    p.grav = -2;
    p.drag = 1.2;
    p.max = 0.45 + Math.random() * 0.35;
    p.size = 0.1;
    p.alpha = 0.9;
    p.color = css(mix(this.col[ac.team], [255, 255, 255], 0.45));
  }

  private spawnMote(anywhere: boolean): void {
    // on the practice ground the dust hangs low, where the sun catches it
    const low = this.groundOn;
    const p = this.fx.spawn(MOTE, lerp(low ? 0 : -12, low ? 44 : FIELD + 12, Math.random()), low ? 0.6 + Math.random() * 6 : 1.5 + Math.random() * 15, lerp(low ? 2 : -4, low ? WIDTH + 14 : WIDTH + 12, Math.random()));
    p.vx = (Math.random() - 0.5) * 0.8;
    p.vy = (Math.random() - 0.4) * 0.3;
    p.vz = (Math.random() - 0.5) * 0.5;
    p.max = 6 + Math.random() * 8;
    if (anywhere) p.life = Math.random() * p.max * 0.8;
    p.size = 0.14 + Math.random() * 0.14;
    p.alpha = 0.3 + Math.random() * 0.3;
    p.rot = Math.random() * 6;
    p.spin = 1 + Math.random() * 2.5;
  }

  /** A camera flash somewhere in the crowd. */
  private crowdFlash(): void {
    const panel = this.bowl[Math.random() < 0.8 ? Math.floor(Math.random() * 4) * 2 : Math.floor(Math.random() * 8)]!;
    const P = panel.steps[Math.floor(Math.random() * STEPS)]!;
    const u = Math.random();
    const v = 0.1 + Math.random() * 0.8;
    const a = (1 - u) * (1 - v); const b = u * (1 - v); const c = (1 - u) * v; const d = u * v;
    const p = this.fx.spawn(GLINT, P[0]! * a + P[3]! * b + P[6]! * c + P[9]! * d, P[1]! * a + P[4]! * b + P[7]! * c + P[10]! * d, P[2]! * a + P[5]! * b + P[8]! * c + P[11]! * d);
    p.max = 0.09 + Math.random() * 0.1;
    p.size = 9 + Math.random() * 12;
    p.alpha = 0.9;
  }

  private stepShow(dt: number): void {
    const now = this.clock;
    // fireworks: a rising trail, then the burst
    for (const f of this.fireworks) {
      if (f.done || now < f.at) continue;
      f.done = true;
      // over the stands, somewhere the camera is looking right now
      {
        const cam = this.cam;
        const a = Math.atan2(cam.fz, cam.fx) + (Math.random() - 0.5) * 1.1;
        let d = 20;
        while (d < 160 && Math.max(AX0 - (cam.ex + Math.cos(a) * d), cam.ex + Math.cos(a) * d - AX1, AZ0 - (cam.ez + Math.sin(a) * d), cam.ez + Math.sin(a) * d - AZ1) < STAND_D * 0.8) d += 4;
        f.x = cam.ex + Math.cos(a) * d;
        f.z = cam.ez + Math.sin(a) * d;
        f.y = STAND_H + 3 + Math.random() * 12;
      }
      burst(this.fx, f.x, f.y, f.z, 46, 15, f.color, 1.25);
      burst(this.fx, f.x, f.y, f.z, 14, 7, '#ffffff', 0.8);
      if (this.motion) {
        const g = this.fx.spawn(GLINT, f.x, f.y, f.z);
        g.max = 0.3;
        g.size = 90;
        g.alpha = 0.6;
      }
    }
    if (this.fireworks.length && this.fireworks.every((f) => f.done)) this.fireworks.length = 0;
    // confetti falls where the camera is looking
    if (now < this.confettiUntil) {
      const n = Math.min(8, Math.ceil(dt * 150));
      const c = this.col[this.confettiTeam];
      for (let i = 0; i < n; i += 1) {
        const p = this.fx.spawn(CONFETTI, this.focusX + (Math.random() - 0.5) * 44, 9 + Math.random() * 9, this.focusZ + (Math.random() - 0.35) * 30);
        p.vx = (Math.random() - 0.5) * 5;
        p.vy = -1 - Math.random() * 3;
        p.vz = (Math.random() - 0.5) * 3;
        p.grav = 5;
        p.drag = 1.1;
        p.max = 3.2 + Math.random() * 1.6;
        p.size = 0.3 + Math.random() * 0.22;
        p.rot = Math.random() * 6;
        p.spin = (Math.random() - 0.5) * 14;
        const r = Math.random();
        p.color = r < 0.45 ? css(mix(c, [255, 255, 255], 0.15)) : r < 0.7 ? css(mix(c, [255, 255, 255], 0.6)) : r < 0.88 ? '#f6f1dc' : '#ffd98a';
      }
    }
    // camera flashes in the stands
    const e = sat(this.exc + this.excBoost);
    let rate = 0.6 + e * e * 22;
    if (this.flashStorm > 0) rate += 70;
    if (!this.motion) rate = Math.min(rate, 6);
    let n = this.groundOn ? 0 : rate * dt;
    while (n > 0) {
      if (Math.random() < n) this.crowdFlash();
      n -= 1;
    }
    if (Math.random() < dt * (this.groundOn ? 7 : 4) && this.fx.count < 700) this.spawnMote(false);
  }

  // ------------------------------------------------------------------ frame

  private loop = (): void => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const t0 = performance.now();
    // the frame's own time stamp can be earlier than the moment a play was started: use the clock
    let dt = (t0 - this.last) / 1000;
    this.last = t0;
    if (!(dt > 0)) dt = 0;
    const raw = dt * 1000;
    if (dt > 0.1) dt = 0.1;
    // a change of resolution empties the canvas: it has to happen before this frame is drawn, never after
    if (this.qualityAuto && raw > 0 && raw < 250 && document.visibilityState !== 'hidden') this.adapt(raw);
    try {
      this.update(dt);
      if (this.W > 1 && this.H > 1) this.draw();
    } catch (err) {
      console.error(err);
      // never leave a caller waiting for a play that cannot be drawn
      this.endPlay(true);
    }
    if (raw > 0 && raw < 1000) {
      this.statDt.push(raw);
      this.statCpu.push(performance.now() - t0);
      if (this.statDt.length > 240) {
        this.statDt.shift();
        this.statCpu.shift();
      }
    }
  };

  /**
   * A device that cannot keep up gets a smaller picture, scaled up by the browser.
   * A steady 30 frames a second is taken for a cap (power saving), not for a struggle; and if a smaller
   * picture does not make frames come faster, resolution was not the problem: go back and leave it alone.
   */
  private adapt(raw: number): void {
    this.frameEma += (raw - this.frameEma) * 0.06;
    this.frameDev += (Math.abs(raw - this.frameEma) - this.frameDev) * 0.06;
    if (this.trial > 0) {
      this.trial -= raw;
      if (this.trial <= 0) {
        if (this.frameEma > this.trialBase * 0.88) {
          this.quality = this.trialFrom;
          this.qualityAuto = false;
          this.W = -1;
          this.resize();
        }
        this.slowFor = 0;
      }
      return;
    }
    const capped = this.frameEma > 31 && this.frameEma < 35.5 && this.frameDev < 3;
    this.slowFor = this.frameEma > 21.5 && !capped ? this.slowFor + raw : Math.max(0, this.slowFor - raw * 2);
    if (this.slowFor > 2500 && this.quality > 0.56) {
      this.trialFrom = this.quality;
      this.trialBase = this.frameEma;
      this.trial = 3000;
      this.quality = Math.max(0.55, this.quality - 0.15);
      this.slowFor = 0;
      this.W = -1;
      this.resize();
    }
  }

  private update(dt: number): void {
    this.clock += dt;
    // picture time
    let sdt = dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      sdt = 0;
    } else if (this.slowLeft > 0) {
      this.slowLeft -= dt;
      const k = this.slowLeft < 0.15 ? lerp(1, this.slowAmt, sat(this.slowLeft / 0.15)) : this.slowAmt;
      sdt = dt * k;
    }
    const pdt = sdt * (this.playing ? this.playSpeed : this.drilling ? this.gSpeed : 1);
    this.sim += pdt;

    // the play
    const script = this.script;
    if (this.playing && script) {
      this.playT += pdt;
      while (this.cueIdx < script.cues.length && script.cues[this.cueIdx]!.t <= this.playT) {
        const c = script.cues[this.cueIdx]!;
        this.cueIdx += 1;
        this.cue(c, script);
        if (!this.playing) break;
      }
      if (this.playing && this.playT >= script.dur) this.endPlay(false);
    }
    if (this.attractOn) this.stepAttract(dt);

    if (this.groundOn) this.stepGround(dt);
    this.stepActors(pdt, dt);
    if (!this.groundOn) this.stepBall(pdt);
    const guide = this.guide;
    if (guide) {
      if (this.playing && script) {
        guide.step({
          t: this.playT, clock: this.clock, bx: this.bx, by: this.by, bz: this.bz, air: this.ballAir,
          held: this.ballHeld ? { team: this.ballHeld.team, id: this.ballHeld.id } : null,
          where: (r) => this.find(r.team, r.id),
        });
        // the road to the goal is lit: look down it from behind the runner
        if (guide.takeRoad() && this.motion && this.camMode !== 'orbit') this.setCam('chase', this.camVar, false);
      } else guide.tick(this.clock);
      if (guide.dead) this.guide = null;
    }
    this.fx.step(sdt);
    this.stepShow(dt);

    // mood
    this.exc = damp(this.exc, this.excTo, 1.6, dt);
    this.excBoost = Math.max(0, this.excBoost - dt * 0.28);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.flashStorm = Math.max(0, this.flashStorm - dt);
    this.trauma = Math.max(0, this.trauma - dt * 2.1);
    this.punch = damp(this.punch, 0, 5.5, dt);
    this.fade = Math.max(0, this.fade - dt * 2.8);
    if (this.speedLines > 0 && !this.gLines && !(this.playing && script && this.playT < script.tEnd)) this.speedLines = Math.max(0, this.speedLines - dt * 3);
    if (this.ribbonMode !== 'main' && this.clock > this.ribbonUntil) this.ribbonMode = 'main';
    this.insTop = damp(this.insTop, this.insTopTo * this.dpr, 9, dt);
    this.insBot = damp(this.insBot, this.insBotTo * this.dpr, 9, dt);

    this.stepCamera(dt);
  }

  private stepActors(pdt: number, dt: number): void {
    const playing = (this.playing && this.script) || this.drilling;
    const kt = this.drilling ? this.gT : this.playT;
    for (const ac of this.actors) {
      const ox = ac.x;
      const oz = ac.z;
      if (playing && ac.keys) {
        evalKeys(ac.keys, kt, tmp);
        ac.x = tmp.x;
        ac.z = tmp.z;
      } else if (ac.hasGoal && pdt > 0) {
        const dx = ac.goalX - ac.x;
        const dz = ac.goalZ - ac.z;
        const dist = Math.hypot(dx, dz);
        const sp = clamp(dist * 3.2, 2.5, 13);
        const step = sp * pdt;
        if (dist <= step || dist < 0.03) {
          ac.x = ac.goalX;
          ac.z = ac.goalZ;
          ac.hasGoal = false;
        } else {
          ac.x += (dx / dist) * step;
          ac.z += (dz / dist) * step;
        }
      }
      if (pdt > 0) {
        const k = 1 - Math.exp(-16 * pdt);
        ac.vx += ((ac.x - ox) / pdt - ac.vx) * k;
        ac.vz += ((ac.z - oz) / pdt - ac.vz) * k;
        ac.speed = Math.hypot(ac.vx, ac.vz);
        ac.cyc += (ac.speed * 1.75 + ac.jog * 9) * pdt;
        ac.run = damp(ac.run, Math.max(sat(ac.speed / 4.5), ac.jog), 12, pdt);
        // which way the hero looks: where it runs, or toward the other team when standing
        const home: 1 | -1 = ac.team === 0 ? 1 : -1;
        if (ac.vx > 2.2) ac.face = 1;
        else if (ac.vx < -2.2) ac.face = -1;
        else if (ac.speed < 1) ac.face = ac.faceLock || home;
        ac.crouch = damp(ac.crouch, ac.crouchTo, 13, pdt);
        // jump
        const jp = (this.sim - ac.jumpT0) / ac.jumpDur;
        ac.y = jp >= 0 && jp < 1 ? ac.jumpH * Math.sin(Math.PI * jp) : 0;
        // standing around: now and then somebody shifts their weight with a little hop
        if (!playing && !this.groundOn && !ac.hasGoal && ac.speed < 0.3 && ac.tumT0 < 0 && !ac.celebrate && jp > 1.6 && Math.random() < pdt * 0.1) {
          ac.jumpT0 = this.sim;
          ac.jumpDur = 0.26;
          ac.jumpH = 0.22;
        }
        // dust from running feet
        if (ac.speed > 5 && Math.random() < pdt * 7) {
          const p = this.fx.spawn(PUFF, ac.x - ac.vx * 0.05, 0.15, ac.z);
          p.vx = -ac.vx * 0.12;
          p.vz = -ac.vz * 0.12;
          p.vy = 0.6;
          p.max = 0.4;
          p.size = 0.3;
          p.grow = 1.2;
          p.alpha = 0.35;
          p.drag = 2;
        }
        if (ac.aura) {
          if (Math.random() < pdt * 22) this.auraSpark(ac, 1);
          ac.trailT -= pdt;
          if (ac.trailT <= 0 && ac.speed > 3) {
            ac.trailT = 0.045;
            ac.trail.push(ac.x, ac.y, ac.z);
            if (ac.trail.length > 15) ac.trail.splice(0, 3);
          } else if (ac.speed <= 3 && ac.trail.length && ac.trailT <= 0) {
            ac.trailT = 0.045;
            ac.trail.splice(0, 3);
          }
        }
      }
      ac.flash = Math.max(0, ac.flash - dt);
    }
  }

  private stepBall(pdt: number): void {
    const script = this.script;
    if (script) {
      let seg = script.ball[0];
      for (const s of script.ball) if (s.t0 <= this.playT) seg = s;
      if (!seg) return;
      if (seg.kind === 'held') {
        this.ballHeld = this.find(seg.team, seg.id);
        this.ballAir = false;
      } else if (seg.kind === 'air') {
        const f = sat((this.playT - seg.t0) / Math.max(0.01, seg.t1 - seg.t0));
        this.ballHeld = null;
        this.ballAir = true;
        this.ballSpiral = seg.spiral;
        this.bx = lerp(seg.from[0], seg.to[0], f);
        this.bz = lerp(seg.from[2], seg.to[2], f);
        this.by = lerp(seg.from[1], seg.to[1], f) + seg.h * 4 * f * (1 - f);
        if (pdt > 0) {
          this.ballTrail.push(this.bx, this.by, this.bz);
          if (this.ballTrail.length > 36) this.ballTrail.splice(0, 3);
        }
      } else {
        this.ballHeld = null;
        this.ballAir = false;
        const t = this.sim - this.ballGroundT;
        this.bx = seg.at[0];
        this.bz = seg.at[2];
        this.by = seg.at[1] + (t < 0.7 ? Math.abs(Math.sin(t * 11)) * 0.7 * (1 - t / 0.7) ** 2 : 0);
      }
    }
    if (!this.ballAir && this.ballTrail.length && pdt > 0) this.ballTrail.splice(0, 3);
    if (this.ballHeld) {
      const h = this.ballHeld;
      this.bx = h.x + h.face * 0.5;
      this.by = h.y + 1.25;
      this.bz = h.z;
    }
  }

  // ------------------------------------------------------------------ camera

  private setCam(mode: CamMode, variant: number, snap: boolean): void {
    this.camMode = mode;
    this.camT = 0;
    this.camVar = variant;
    this.camFrom = this.sEx.x;
    if (snap) this.camSnap = true;
  }

  /** Chooses the shot for a play; a little different from play to play. */
  private pickShot(sc: Script): void {
    const n = sc.spec.n;
    this.camSide = n % 2 ? 1 : -1;
    if (!this.motion || this.playFast) {
      this.setCam('calm', 0, false);
      return;
    }
    const type: OffType = sc.spec.type;
    let mode: CamMode;
    if (type === 'inside') mode = (['track', 'sky', 'low'] as const)[n % 3]!;
    else if (type === 'outside') mode = 'track';
    else if (type === 'short') mode = (['qb', 'track', 'sky'] as const)[n % 3]!;
    else mode = n % 4 === 3 ? 'track' : 'qb';
    // a sack is best seen from the side: from behind, the quarterback would be thrown into the lens
    if (sc.spec.outcome === 'sack') mode = n % 2 ? 'low' : 'track';
    this.setCam(mode, mode === 'track' && sc.spec.outcome === 'sack' ? 1 : n % 2, false);
  }

  private stepCamera(dt: number): void {
    const cam = this.cam;
    this.camT += dt;
    const t = this.camT;
    const dir = this.offense === 0 ? 1 : -1;
    const L = worldX(this.offense, this.los);
    // what the camera watches: the ball
    const fk = 1 - Math.exp(-10 * dt);
    this.focusX += (this.bx - this.focusX) * fk;
    this.focusZ += (this.bz - this.focusZ) * fk;
    const fx = this.focusX;
    const fz = this.focusZ;
    const aspect = this.H > 0 ? this.W / this.H : 2;
    const wide = aspect < 1.9 ? 1 + (1.9 - aspect) * 0.25 : 1;
    let ex = 25; let ey = 15; let ez = 46; let tx = 25; let ty = 1; let tz = 11; let fov = 0.56; let om = 2.4;
    const sc = this.script;
    switch (this.camMode) {
      case 'ground': {
        this.groundPose(fx, fz);
        const o = this.pose;
        ex = o.ex; ey = o.ey; ez = o.ez; tx = o.tx; ty = o.ty; tz = o.tz; fov = o.fov; om = o.om;
        break;
      }
      case 'establish': {
        const c = L + dir * 3.5;
        const creep = Math.min(t, 14) * 0.1 * dir;
        if (this.camVar === 1) {
          ex = c - dir * 12 + creep; ey = 10; ez = 42; tx = c + dir * 2.5; ty = 1.2; tz = 11; fov = 0.56;
        } else if (this.camVar === 2) {
          ex = c + dir * 8 - creep; ey = 14.5; ez = 45; tx = c - dir * 0.5; ty = 0.8; tz = 11.4; fov = 0.5;
        } else {
          ex = c - dir + creep; ey = 12.5; ez = 45; tx = c; ty = 1; tz = 11.2; fov = 0.52;
        }
        ex += Math.sin(t * 0.23 + 1) * 1.5;
        ey += Math.sin(t * 0.31) * 0.4;
        fov *= 1 - 0.035 * smooth(t / 7);
        om = 2.6;
        break;
      }
      case 'calm': {
        const c = lerp(L + dir * 3.5, fx, 0.75);
        ex = c + Math.sin(t * 0.15) * 0.8; ey = 15.5; ez = 47; tx = c + dir; ty = 1; tz = 11.3; fov = 0.57;
        om = this.playFast ? 6 : 1.8;
        break;
      }
      case 'track': {
        const pre = sc && this.playing && this.playT < sc.snap;
        ex = fx - dir * 2.5; ey = this.camVar ? 8 : 10; ez = this.camVar ? 39 : 41.5;
        tx = fx + dir * (pre ? 4 : 3); ty = 1.3 + this.by * 0.25; tz = lerp(12, fz, 0.5);
        fov = (this.camVar ? 0.5 : 0.47) + (this.ballAir ? 0.06 : 0);
        om = 4.6;
        if (this.broke) {
          // out in the open: swing ahead of the runner and let him come
          ex = fx + dir * 7; tx = fx - dir * 0.5; fov += 0.03; om = 3.2;
        }
        break;
      }
      case 'low': {
        ex = fx - dir * 9.5; ey = 4; ez = Math.min(fz + 17, AZ1 - 1.3);
        tx = fx + dir * 2.5; ty = 1.8; tz = fz - 1.5; fov = 0.58; om = 5;
        break;
      }
      case 'sky': {
        ex = fx - dir * 20; ey = 13.5; ez = 12 + this.camSide * 1.6;
        tx = fx + dir * 6; ty = 0.5; tz = 12 + (fz - 12) * 0.5; fov = 0.6; om = 4;
        break;
      }
      case 'qb': {
        const qb = this.find(this.offense, this.teams[this.offense].lineup.off.QB);
        const qx = qb ? qb.x : L - dir * 5;
        const sz = sc ? sc.spotZ : 12;
        ex = qx - dir * 8.5; ey = 4.3; ez = 12 + this.camSide * 2.7;
        tx = L + dir * 13; ty = 1.9; tz = 12 + (sz - 12) * 0.4; fov = 0.8; om = 6;
        break;
      }
      case 'ball': {
        const sx = sc ? sc.spotX : fx;
        const sz = sc ? sc.spotZ : fz;
        const prog = sc && sc.tCatch > sc.tThrow ? sat((this.playT - sc.tThrow) / (sc.tCatch - sc.tThrow)) : 1;
        ex = lerp(this.camFrom, sx - dir * 24, smooth(prog) * 0.8); ey = 6 + this.by * 0.3; ez = 12 + this.camSide * 3.2 + (sz - 12) * 0.25;
        tx = lerp(this.bx, sx, 0.5); ty = 0.8 + this.by * 0.36; tz = lerp(this.bz, sz, 0.5);
        fov = lerp(0.8, 0.66, prog); om = 6.5;
        break;
      }
      case 'chase': {
        ex = fx - dir * 16; ey = 7; ez = lerp(12, fz, 0.6) + this.camSide * 3;
        tx = fx + dir * 4; ty = 1.2; tz = fz; fov = 0.52; om = 4.2;
        break;
      }
      case 'whip': {
        // the thief runs the other way: get low on the sideline in front of him
        ex = fx - dir * 7.5; ey = 3; ez = Math.min(fz + 13.5, AZ1 - 1.3);
        tx = fx - dir * 0.5; ty = 1.8; tz = fz - 0.5; fov = 0.56; om = 9;
        break;
      }
      case 'orbit': {
        const star = sc ? this.actor(sc.star) : null;
        const px = star ? star.x : fx;
        const pz = star ? star.z : fz;
        const s = smooth(t / 3.2);
        const th = (this.camSide > 0 ? -0.7 : 0.75) + (this.camSide > 0 ? 1 : -1) * (0.42 * Math.min(t, 3.5) + 0.05 * Math.max(0, t - 3.5));
        // a hero shot: low, looking up past the scorer at the stands, the lights and the fireworks
        const r = lerp(14, 21, s);
        ex = px - dir * Math.cos(th) * r; ey = lerp(4.2, 3.2, s); ez = pz + Math.sin(th) * r;
        tx = px; ty = lerp(2.2, 6.2, s); tz = pz; fov = lerp(0.56, 0.78, s); om = 3.6;
        break;
      }
      case 'attract': {
        const st = this.attractShotT;
        const k = this.attractShot % 5;
        if (k === 0) {
          const a = -0.55 + st * 0.085;
          ex = MID_X + Math.sin(a) * 46; ey = 24 + Math.sin(st * 0.2) * 2; ez = MID_Z + Math.cos(a) * 30;
          tx = MID_X + Math.sin(a) * 6; ty = 0; tz = MID_Z - 2; fov = 0.66;
        } else if (k === 1) {
          ex = 6 + st * 3.4; ey = 2.3; ez = AZ1 - 1.6; tx = ex + 13; ty = 4.2; tz = 4; fov = 0.74;
        } else if (k === 2) {
          ex = AX0 + 2.5; ey = 3 + st * 1.25; ez = MID_Z; tx = MID_X; ty = 3; tz = MID_Z; fov = 0.7;
        } else if (k === 3) {
          ex = fx - 6 + st * 0.6; ey = 9.5; ez = 40.5; tx = fx + 2; ty = 1.4; tz = lerp(12, fz, 0.5); fov = 0.5;
        } else {
          const a = 0.6 - st * 0.07;
          ex = MID_X + Math.sin(a) * 30; ey = 38 - st * 0.9; ez = MID_Z + 16 + Math.cos(a) * 6;
          tx = MID_X + Math.sin(a) * 3; ty = 0; tz = MID_Z; fov = 0.62;
        }
        om = k === 3 ? 3 : 2.2;
        break;
      }
      default:
        break;
    }
    // never static: a slow breath on top of every shot
    ex += Math.sin(this.clock * 0.37) * 0.25;
    ey += Math.sin(this.clock * 0.29 + 2) * 0.12;
    fov *= wide;
    // push in (or kick out) on big moments
    if (this.motion) {
      fov *= 1 - 0.1 * this.punch;
      const p = Math.max(0, this.punch) * 0.07;
      ex += (tx - ex) * p; ey += (ty - ey) * p; ez += (tz - ez) * p;
    }
    const open = this.groundOn;
    if (open) {
      // the practice ground has no stands: stay on this side of the fences
      ex = clamp(ex, -7, FIELD + 9);
      ez = clamp(ez, 1, 44);
      ey = Math.max(ey, 1.6);
    } else {
      // stay inside the bowl and above the seats
      ex = clamp(ex, AX0 - STAND_D + 2, AX1 + STAND_D - 2);
      ez = clamp(ez, AZ0 - STAND_D + 2, AZ1 + STAND_D - 2);
      ey = Math.max(ey, 1.6, standY(ex, ez) + (standY(ex, ez) > 0 ? 2.4 : 0));
    }

    if (this.camSnap) {
      this.camSnap = false;
      this.sEx.snap(ex); this.sEy.snap(ey); this.sEz.snap(ez);
      this.sTx.snap(tx); this.sTy.snap(ty); this.sTz.snap(tz);
      this.sFov.snap(fov);
    } else {
      // integrate in small steps so a stiff spring stays stable on a slow frame
      let left = dt;
      while (left > 1e-5) {
        const h = Math.min(left, 1 / 90);
        left -= h;
        this.sEx.step(ex, om, h); this.sEy.step(ey, om, h); this.sEz.step(ez, om, h);
        this.sTx.step(tx, om * 1.25, h); this.sTy.step(ty, om * 1.25, h); this.sTz.step(tz, om * 1.25, h);
        this.sFov.step(fov, om * 1.4, h);
      }
    }
    cam.ex = this.sEx.x;
    cam.ez = this.sEz.x;
    cam.ey = open ? Math.max(this.sEy.x, 1.4) : Math.max(this.sEy.x, 1.4, standY(cam.ex, cam.ez) + (standY(cam.ex, cam.ez) > 0 ? 1.6 : 0));
    cam.tx = this.sTx.x; cam.ty = this.sTy.x; cam.tz = this.sTz.x;
    cam.fov = clamp(this.sFov.x, 0.25, 1.3);

    // the band of the canvas that the interface leaves open
    const H = this.H;
    const top = clamp(this.insTop, 0, H * 0.6);
    const bot = clamp(this.insBot, 0, H * 0.7);
    const band = Math.max(H * 0.2, H - top - bot);
    const zoom = lerp(1, 0.93, sat((0.74 - band / Math.max(1, H)) / 0.3));
    let cx = this.W / 2;
    // with a tall hand of cards below, sit a little higher in the band: feet matter more than the stands
    let cy = top + band * lerp(0.5, 0.43, sat((0.7 - band / Math.max(1, H)) / 0.25));
    cam.roll = 0;
    if (this.motion && this.trauma > 0.001) {
      const s = this.trauma * this.trauma;
      const amp = s * 0.03 * H;
      cx += noise(this.clock * 38, 1) * amp;
      cy += noise(this.clock * 41, 2) * amp;
      cam.roll = noise(this.clock * 30, 3) * s * 0.035;
    }
    cam.setup(this.W, H, cx, cy, zoom);
  }

  // ------------------------------------------------------------------ practice ground: inner workings

  /** Takes the practice-only state off a hero. */
  private plain(ac: Actor): void {
    ac.keys = null;
    ac.hasGoal = false;
    ac.carry = false;
    ac.jog = 0;
    ac.faceLock = 0;
    ac.ring = null;
    ac.wave = false;
    ac.aura = false;
    ac.celebrate = false;
    ac.crouchTo = 0;
    ac.trail.length = 0;
    ac.y = 0;
    if (ac.tumT0 >= 0) ac.downUntil = Math.min(ac.downUntil, this.sim);
  }

  private leaveGround(): void {
    if (!this.groundOn) return;
    this.endDrill(true);
    this.groundOn = false;
    this.gHint = null;
    this.gBalls.length = 0;
    this.gLines = false;
    this.speedLines = 0;
    this.fx.clear(false);
    for (let i = 0; i < 34; i += 1) this.spawnMote(true);
  }

  private clearHint(): void {
    const g = this.g;
    if (!g) return;
    this.gHint = null;
    if (!this.drilling) g.highlight([]);
    g.find('coach').aTo = 0;
    for (const ac of this.actors) {
      ac.wave = false;
      if (!this.drilling) {
        ac.aura = false;
        ac.faceLock = this.gStations[ac.station]?.face ?? 1;
      }
    }
  }

  /** What a hero is best at, as far as the club's sheet says. */
  private bestOf(id: number | undefined): DrillPlan['solo'] {
    const p = id === undefined ? undefined : this.teams[0].players.find((q) => q.id === id);
    if (!p) return 'spd';
    let best: DrillPlan['solo'] = 'spd';
    for (const k of ['spd', 'pas', 'cat', 'blk', 'tkl', 'iq'] as const) if (p.stats[k] > p.stats[best]) best = k;
    return best;
  }

  /** Ends the drill that is running, if any. `force`: jump to its last picture. */
  private endDrill(force: boolean): void {
    if (!this.drilling) return;
    this.drilling = false;
    clearTimeout(this.gWatch);
    const plan = this.gPlan;
    const g = this.g;
    if (plan && force) {
      for (const ac of this.actors) {
        if (!ac.keys) continue;
        evalKeys(ac.keys, plan.dur, tmp);
        ac.x = tmp.x;
        ac.z = tmp.z;
      }
      this.hitStop = 0;
      this.slowLeft = 0;
    }
    // back to the warm-up: paths, props and looks are let go
    for (const ac of this.actors) {
      const drilled = !!ac.keys;
      ac.keys = null;
      if (!drilled) continue;
      ac.carry = false;
      ac.aura = false;
      ac.ring = null;
      ac.crouchTo = 0;
      ac.trail.length = 0;
      ac.faceLock = this.gStations[ac.station]?.face ?? 1;
      if (ac.tumT0 >= 0) ac.downUntil = Math.min(ac.downUntil, this.sim + 0.1);
    }
    if (g) {
      g.highlight([]);
      for (const p of g.props) {
        if (p.kind === 'sled' || p.kind === 'dummy') p.vTo = 0;
        if (p.kind === 'coach') p.aTo = 0;
      }
    }
    this.gBalls.length = 0;
    this.gLines = false;
    this.speedLines = 0;
    this.gTossAt = this.sim + 1.6;
    const first = this.actors.find((a) => this.gStations[a.station]?.job === 'tossA');
    if (first) first.carry = true;
    if (!this.gEndFired) {
      this.gEndFired = true;
      if (!this.dead) this.safe(() => this.gHooks?.onEnd?.());
    }
    this.gHooks = undefined;
    const done = this.gResolve;
    this.gResolve = null;
    done?.();
  }

  private hop(ac: Actor, h: number, dur: number): void {
    ac.jumpT0 = this.sim;
    ac.jumpDur = dur;
    ac.jumpH = h;
  }

  /** One hero's self-directed warm-up: where it wants to be right now and what it is doing there. */
  private routine(ac: Actor): void {
    const st = this.gStations[ac.station] ?? STATIONS[0]!;
    // the linemen on the sled drive it together, on the same count
    const t = st.job === 'sled' ? this.sim : this.sim + ac.phase * 7;
    const beat = (period: number): boolean => Math.floor(t / period) !== Math.floor(ac.rt / period);
    let x = st.x;
    let z = st.z;
    let crouch = 0;
    ac.jog = 0;
    switch (st.job) {
      case 'sled': {
        // step in, lean on the pads, step back
        const c = (t % 2.3) / 2.3;
        const push = c < 0.2 ? c / 0.2 : c < 0.42 ? 1 : c < 0.6 ? 1 - (c - 0.42) / 0.18 : 0;
        x = st.x + push * 0.95;
        if (c >= 0.2 && (ac.rt % 2.3) / 2.3 < 0.2 && this.g && !this.drilling) {
          const sled = this.g.find('sled');
          if (Math.abs(sled.vTo) < 0.01) {
            sled.v = 0.28;
            this.dust(SLED.x + 0.6, SLED.z, 2, 1.2, false);
          }
        }
        crouch = c > 0.66 && c < 0.9 ? 0.7 : 0;
        break;
      }
      case 'bag': {
        // a lineman and a stand-up bag: set, punch, reset
        const c = (t % 2.1) / 2.1;
        const hit = c < 0.16 ? c / 0.16 : c < 0.3 ? 1 : c < 0.5 ? 1 - (c - 0.3) / 0.2 : 0;
        x = st.x + hit * 0.8;
        if (c >= 0.16 && (ac.rt % 2.1) / 2.1 < 0.16 && this.g && !this.drilling) {
          const bag = this.g.find('dummy', st.i ?? 0);
          if (bag.vTo < 1) bag.v = 0.36;
          this.dust(st.x + 1.2, st.z, 2, 1, false);
        }
        crouch = c > 0.62 && c < 0.94 ? 0.8 : 0;
        break;
      }
      case 'jog':
        ac.jog = 0.85;
        x += Math.sin(t * 0.5) * 0.5;
        break;
      case 'hops':
        if (beat(1.25)) this.hop(ac, 0.5, 0.34);
        crouch = t % 1.25 > 0.98 ? 0.8 : 0;
        break;
      case 'shuttle': {
        // through the cones and back, the ball tucked away
        const c = (t % 5.4) / 5.4;
        x = st.x + (c < 0.5 ? smooth(c * 2) : 1 - smooth((c - 0.5) * 2)) * 9;
        z = st.z + Math.sin(c * TAU * 3) * 0.7;
        if (this.gPosts[ac.id] && !this.drilling) ac.carry = true;
        break;
      }
      case 'sway':
        x += Math.sin(t * 1.6) * 0.7;
        if (beat(2.7)) this.hop(ac, 0.3, 0.26);
        break;
      default:
        // the two with the ball shift their feet between throws
        x += Math.sin(t * 0.9) * 0.25;
        break;
    }
    if (ac.wave) {
      // called out: a couple of steps toward the camera, waving
      z = Math.min(WIDTH - 1, z + 4);
      ac.jog = 0;
      crouch = 0;
      if (beat(0.62)) {
        this.hop(ac, 0.6, 0.32);
        ac.flipT0 = this.sim;
      }
    }
    ac.crouchTo = crouch;
    ac.goalX = x;
    ac.goalZ = z;
    ac.hasGoal = Math.hypot(ac.x - x, ac.z - z) > 0.02;
    ac.rt = t;
  }

  private stepGround(dt: number): void {
    const g = this.g;
    if (!g) return;
    g.step(dt);
    // the drill
    const plan = this.gPlan;
    if (this.drilling && plan) {
      this.gT = this.sim - this.gSim0;
      this.gReal += dt;
      while (this.drilling && this.gCue < plan.cues.length && plan.cues[this.gCue]!.t <= this.gT) {
        const c = plan.cues[this.gCue]!;
        this.gCue += 1;
        this.gcue(c);
      }
      if (this.drilling && this.gT >= plan.dur) this.endDrill(false);
    }
    // everybody who is not in a drill warms up
    for (const ac of this.actors) if (!ac.keys) this.routine(ac);
    // the quarterback throws to the receivers in turn, and the ball comes back
    const a = this.actors.find((ac) => this.gStations[ac.station]?.job === 'tossA');
    const catchers = this.actors.filter((ac) => this.gStations[ac.station]?.job === 'tossB');
    const holder = catchers.find((ac) => ac.carry);
    const b = holder ?? catchers[this.gTossN % Math.max(1, catchers.length)];
    if (a && b && !a.keys && !b.keys && !a.wave && !b.wave && this.sim >= this.gTossAt && !this.gBalls.length) {
      const near = (ac: Actor): boolean => Math.hypot(ac.x - ac.goalX, ac.z - ac.goalZ) < 0.8;
      if (near(a) && near(b)) {
        if (!a.carry && !b.carry) a.carry = true;
        const from = a.carry ? a : b;
        const to = a.carry ? b : a;
        from.carry = false;
        if (from === b) this.gTossN += 1;
        this.hop(from, 0.26, 0.26);
        this.gBalls.push({
          s0: this.sim, s1: this.sim + 0.82, from: [from.x + from.face * 0.5, 1.8, from.z], to: [to.x, 1.7, to.z], h: 2.3,
          catcher: to, trail: [], x: from.x, y: 1.8, z: from.z,
        });
        this.gTossAt = this.sim + 1.75 + hash(Math.floor(this.sim * 3)) * 0.5;
      } else this.gTossAt = this.sim + 0.4;
    }
    // balls in the air
    for (let i = this.gBalls.length - 1; i >= 0; i -= 1) {
      const ball = this.gBalls[i]!;
      const f = (this.sim - ball.s0) / Math.max(0.01, ball.s1 - ball.s0);
      if (f < 0) continue;
      if (f >= 1) {
        if (ball.catcher && !ball.catcher.keys) {
          ball.catcher.carry = true;
          this.hop(ball.catcher, 0.2, 0.2);
        }
        this.gBalls.splice(i, 1);
        continue;
      }
      ball.x = lerp(ball.from[0], ball.to[0], f);
      ball.z = lerp(ball.from[2], ball.to[2], f);
      ball.y = lerp(ball.from[1], ball.to[1], f) + ball.h * 4 * f * (1 - f);
      ball.trail.push(ball.x, ball.y, ball.z);
      if (ball.trail.length > 24) ball.trail.splice(0, 3);
    }
    // what the camera watches: the drill's heroes, or the whole group
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (const ac of this.actors) {
      if (this.drilling && plan && !plan.focus.includes(ac.id)) continue;
      sx += ac.x;
      sz += ac.z;
      n += 1;
    }
    this.bx = n ? sx / n : CENTER.x;
    this.bz = n ? sz / n : CENTER.z;
    this.by = 1.2;
    // now and then, another relaxed angle
    this.gShotT += dt;
    if (this.motion && !this.drilling && !this.gHint) {
      if (this.gShotT > this.gShotLen) {
        this.gShot = (this.gShot + 1 + Math.floor(Math.random() * 3)) % 4;
        this.gShotT = 0;
        this.gShotLen = 12 + Math.random() * 6;
        this.fade = 1;
        this.camSnap = true;
      } else if (this.gShotT > this.gShotLen - 0.3) this.fade = Math.max(this.fade, (this.gShotT - (this.gShotLen - 0.3)) / 0.3);
    } else if (this.gShotT > this.gShotLen - 1) this.gShotT = this.gShotLen - 1;
  }

  /** One beat of a drill: effects on the ground and the caller's hook. */
  private gcue(c: GCue): void {
    const g = this.g;
    if (!g) return;
    const hooks = this.gHooks;
    const fancy = this.motion && this.gSpeed < 8;
    const who = (id: number | undefined): Actor | null => (id === undefined ? null : this.find(0, id));
    switch (c.c) {
      case 'step':
        this.safe(() => hooks?.onStep?.());
        break;
      case 'whistle': {
        const ac = who(c.who);
        if (ac) this.glints(ac.x, 3.2, ac.z, 3, 0.5);
        this.safe(() => hooks?.onWhistle?.());
        break;
      }
      case 'throw': {
        const ac = who(c.who);
        if (ac && this.sim - ac.jumpT0 > ac.jumpDur) this.hop(ac, 0.28, 0.24);
        this.safe(() => hooks?.onThrow?.());
        break;
      }
      case 'catch': {
        const ac = who(c.who);
        if (ac) {
          this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.35, r: 2.6, color: 'rgba(255,255,255,0.85)' });
          this.glints(ac.x, 2.6 + ac.y, ac.z, 3, 0.8);
        }
        this.safe(() => hooks?.onCatch?.());
        break;
      }
      case 'impact': {
        const pw = c.power;
        this.dust(c.x, c.z, 4 + Math.round(pw * 8), 2 + pw * 2.6, pw > 0.5);
        this.rings.push({ x: c.x, z: c.z, t: this.clock, dur: 0.3 + pw * 0.2, r: 2.4 + pw * 3, color: 'rgba(255,250,230,0.85)' });
        this.bursts.push({ x: c.x, y: 1.5, z: c.z, t: this.clock, dur: 0.17 + pw * 0.1, size: 1 + pw * 1.3, seed: Math.floor(this.clock * 31) });
        for (const id of [c.a, c.b]) {
          const ac = who(id);
          if (ac) ac.flash = 0.05 + pw * 0.04;
        }
        if (fancy) {
          this.trauma = Math.max(this.trauma, 0.2 + pw * 0.45);
          this.hitStop = Math.max(this.hitStop, 0.03 + pw * 0.05);
          this.punch = Math.max(this.punch, 0.3 + pw * 0.5);
        }
        this.safe(() => hooks?.onImpact?.(pw));
        break;
      }
      case 'chalk': {
        for (let i = 0; i < 3; i += 1) {
          const p = this.fx.spawn(PUFF, BOARD.x + (Math.random() - 0.5) * 3.6, 1.4 + Math.random() * 1.6, BOARD.z + 0.2);
          p.tex = 1;
          p.vy = -0.6;
          p.vz = 0.5;
          p.max = 0.5;
          p.size = 0.2;
          p.grow = 0.6;
          p.alpha = 0.6;
        }
        this.safe(() => hooks?.onChalk?.());
        break;
      }
      case 'payoff': {
        const ac = who(c.who);
        if (ac) {
          this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.5, r: 3.4, color: css(mix(this.gCol, [255, 255, 255], 0.5)) });
          this.glints(ac.x, 3.3 + ac.y, ac.z, 4, 0.7);
          for (let i = 0; i < 6; i += 1) this.auraSpark(ac, 1.2);
        }
        this.safe(() => hooks?.onPayoff?.(c.who));
        break;
      }
      case 'jump': {
        const ac = who(c.who);
        if (ac) this.hop(ac, c.h, c.dur);
        break;
      }
      case 'crouch': {
        const ac = who(c.who);
        if (ac) ac.crouchTo = c.on ? 1 : 0;
        break;
      }
      case 'tumble': {
        const ac = who(c.who);
        if (ac) this.tumble(ac, c.dir, 0.34, c.down);
        break;
      }
      case 'flip': {
        const ac = who(c.who);
        if (ac) ac.flipT0 = this.sim;
        break;
      }
      case 'topple': {
        const p = g.find('dummy', c.i);
        // which way "+x" is on screen decides which way it falls
        const cam = this.cam;
        let s = c.dir;
        if (cam.project(p.x, 0, p.z)) {
          const x0 = cam.sx;
          if (cam.project(p.x + c.dir, 0, p.z) && Math.abs(cam.sx - x0) > 0.5) s = cam.sx > x0 ? 1 : -1;
        }
        p.a = s;
        p.aTo = s;
        p.vTo = 1.45;
        this.dust(p.x + c.dir * 1.2, p.z, 6, 2.6, false);
        break;
      }
      case 'rock': {
        const p = g.find('dummy', c.i);
        if (p.vTo < 1) p.v = 0.42;
        break;
      }
      case 'sled': {
        const p = g.find('sled');
        p.vTo += c.dx;
        this.dust(SLED.x + p.v + 1, SLED.z, 5, 2, false);
        break;
      }
      case 'aura': {
        const ac = who(c.who);
        if (!ac) break;
        ac.aura = c.on;
        if (c.on) {
          this.rings.push({ x: ac.x, z: ac.z, t: this.clock, dur: 0.6, r: 5, color: css(mix(this.gCol, [255, 255, 255], 0.5)) });
          this.bursts.push({ x: ac.x, y: 1.5, z: ac.z, t: this.clock, dur: 0.36, size: 2.2, seed: ac.id });
          for (let i = 0; i < 12; i += 1) this.auraSpark(ac, 1.6);
          if (fancy) this.punch = Math.max(this.punch, 0.4);
        }
        break;
      }
      case 'carry': {
        const ac = who(c.who);
        if (ac) ac.carry = c.on;
        break;
      }
      case 'lines':
        this.gLines = c.on && fancy;
        if (this.gLines) this.speedLines = 1;
        break;
      case 'dust':
        this.dust(c.x, c.z, 6, 2.6, false);
        break;
      case 'coach': {
        const p = g.find('coach');
        p.x = c.x;
        p.z = c.z;
        p.aTo = 1;
        break;
      }
      case 'board':
        g.board = 0;
        g.boardTo = 1;
        g.boardRate = c.rate;
        break;
      case 'end':
        if (!this.gEndFired) {
          this.gEndFired = true;
          this.safe(() => hooks?.onEnd?.());
        }
        break;
      default:
        break;
    }
  }

  /** The shot on the practice ground: eye-level and relaxed while warming up, purposeful during a drill. Writes into `pose`. */
  private groundPose(fx: number, fz: number): void {
    const o = this.pose;
    const t = this.gShotT;
    const plan = this.gPlan;
    if (this.drilling && plan && this.motion && this.gSpeed < 8) {
      const td = this.gReal;
      o.om = 3.6;
      switch (plan.kind) {
        case 'dash':
          o.ex = fx + 5; o.ey = 2.6; o.ez = 35; o.tx = fx + 2.5; o.ty = 1.8; o.tz = fz; o.fov = 0.6; o.om = 4.2;
          break;
        case 'pass':
          o.ex = fx - 2 + td * 1.5; o.ey = 5.2 - td * 0.5; o.ez = 37 - td * 1.4; o.tx = fx; o.ty = 2; o.tz = fz - 1; o.fov = 0.6;
          break;
        case 'catch':
          o.ex = CART.x - 9.5; o.ey = 4.2; o.ez = CART.z + 8.5; o.tx = lerp(CART.x + 12, fx + 4, 0.5); o.ty = 2.4 + sat(td - 0.3) * 1.2; o.tz = lerp(CART.z, fz, 0.6); o.fov = 0.72;
          break;
        case 'hit':
          o.ex = SLED.x + 9 - td; o.ey = 2.5; o.ez = SLED.z + 13; o.tx = SLED.x + 0.5; o.ty = 1.6; o.tz = SLED.z - 1.5; o.fov = 0.56;
          break;
        case 'tackle':
          o.ex = DUMMIES[1]![0] + 8.5; o.ey = 2.6; o.ez = 23.5; o.tx = DUMMIES[1]![0] - 3; o.ty = 1.4; o.tz = DUMMIES[1]![1] - 0.5; o.fov = 0.66;
          break;
        case 'study':
          o.ex = BOARD.x + 1.5; o.ey = 3.6; o.ez = 17 - td * 1.6; o.tx = BOARD.x; o.ty = 2.3; o.tz = BOARD.z; o.fov = 0.6;
          break;
        case 'game':
          o.ex = plan.camX - 1.5; o.ey = 4.4; o.ez = 36; o.tx = plan.camX + 1.2 + sat(td - 0.6) * 2; o.ty = 1.5; o.tz = plan.camZ; o.fov = 0.52; o.om = 4;
          break;
        case 'solo':
          o.ex = fx + plan.camX * 2.5; o.ey = 2.5; o.ez = fz + 12.5; o.tx = fx + plan.camX * 0.8; o.ty = 1.9; o.tz = fz; o.fov = 0.54; o.om = 5;
          break;
        default: {
          const a = -0.5 + td * 0.34;
          o.ex = fx + Math.sin(a) * 9.5; o.ey = 2.5; o.ez = fz + Math.cos(a) * 11; o.tx = fx - 0.5; o.ty = 2.1; o.tz = fz - 2.5; o.fov = 0.62; o.om = 4;
          break;
        }
      }
      return;
    }
    // warm-up: four relaxed angles; with reduced motion only the first
    const k = this.motion ? this.gShot : 0;
    const drift = Math.sin(t * 0.11 + k) * 1.2;
    if (k === 1) {
      // three-quarters from the left corner, a little higher
      o.ex = 1 + drift; o.ey = 7.5; o.ez = 35.5; o.tx = 21; o.ty = 1.2; o.tz = 10.5; o.fov = 0.6;
    } else if (k === 2) {
      // low, from behind the bench
      o.ex = 14 + drift * 0.6; o.ey = 2.3; o.ez = 32.5; o.tx = 21.5; o.ty = 2.1; o.tz = 9; o.fov = 0.68;
    } else if (k === 3) {
      // down the field, into the evening sun
      o.ex = 40 - t * 0.12; o.ey = 3.4; o.ez = 21 + drift * 0.3; o.tx = 12; o.ty = 2.3; o.tz = 10.5; o.fov = 0.6;
    } else {
      // eye level from the sideline: heads against the sky
      o.ex = CENTER.x + 1.5 + drift; o.ey = 3.1; o.ez = 38.5; o.tx = CENTER.x + drift * 0.4; o.ty = 2.2; o.tz = 9; o.fov = 0.56;
    }
    o.om = this.drilling ? 2.2 : 1.8;
    if (this.drilling && plan) {
      // calm mode: only lean toward where the drill is
      o.tx = lerp(o.tx, fx, 0.45);
      o.ex = lerp(o.ex, fx, 0.3);
    } else if (this.gHint) {
      o.tx = lerp(o.tx, this.gHint.x, 0.3);
      o.tz = lerp(o.tz, this.gHint.z, 0.2);
      o.fov *= 0.97;
    }
  }

  private pose = { ex: 0, ey: 3, ez: 38, tx: 0, ty: 2, tz: 9, fov: 0.56, om: 2 };

  /** Sky, scenery and turf of the practice ground. */
  private drawGroundWorld(horizon: number): void {
    const g = this.g!;
    const ctx = this.ctx;
    const px = this.dpr;
    const P = this.painter;
    P.px = px;
    P.W = this.W;
    P.H = this.H;
    g.sky(P, this.clock, horizon, this.stars);
    g.far(P, this.clock);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // a school ground: bare earth around the turf, trodden paler along the sidelines
    const dirt = g.light.dirt;
    this.fillPoly([-9.2, 0, -5, 62.8, 0, -5, 62.8, 0, 29, -9.2, 0, 29], css(dirt));
    this.fillPoly([FX0, 0, FZ0, FX1, 0, FZ0, FX1, 0, FZ1, FX0, 0, FZ1], css(mix(dirt, [236, 214, 170], 0.3)));
    for (let i = 0; i < FIELD / 5; i += 1) {
      this.fillPoly([i * 5, 0, 0, i * 5 + 5.05, 0, 0, i * 5 + 5.05, 0, WIDTH, i * 5, 0, WIDTH], GROUND_BANDS[i % 2]!);
    }
    const zone = css(zoneColor(this.gClub.color));
    this.fillPoly([-END, 0, 0, 0, 0, 0, 0, 0, WIDTH, -END, 0, WIDTH], zone);
    this.fillPoly([FIELD, 0, 0, FIELD + END, 0, 0, FIELD + END, 0, WIDTH, FIELD, 0, WIDTH], zone);
    if (!this.gField) {
      const club = { ...this.teams[0], short: this.gClub.short, color: this.gClub.color };
      this.gField = bakeField([club, club]);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    const ov = this.gField.overlay;
    this.tqPad = 0.2;
    this.texQuad(ov, 0, 0, ov.width, ov.height, FIELD_QUAD, 6, 2, 6 * px, 6);
    this.tqPad = 0.75;
    for (const d of this.gField.decals) this.texQuad(d.tex, 0, 0, d.tex.width, d.tex.height, d.quad, 1, 1, 2.6 * px, 4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawMarkings();
    g.shadows(P);
    ctx.globalCompositeOperation = 'lighter';
    g.glows(P, this.clock, this.sprites.warm);
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Balls in the air over the practice ground. */
  private drawGroundBalls(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    for (const b of this.gBalls) {
      if (this.sim < b.s0) continue;
      if (this.groundMatrix(b.x, b.z)) {
        ctx.fillStyle = 'rgba(22,10,40,0.3)';
        ctx.beginPath();
        ctx.arc(0, 0, 0.4, 0, TAU);
        ctx.fill();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const n = b.trail.length / 3;
      let ang = this.sim * 12;
      if (n > 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        let ok = cam.project(b.trail[0]!, b.trail[1]!, b.trail[2]!);
        let lx = cam.sx; let ly = cam.sy;
        for (let i = 1; i < n; i += 1) {
          const vis = cam.project(b.trail[i * 3]!, b.trail[i * 3 + 1]!, b.trail[i * 3 + 2]!);
          if (vis && ok) {
            const f = i / n;
            ctx.strokeStyle = `rgba(255,236,200,${0.04 + 0.3 * f * f})`;
            ctx.lineWidth = Math.max(1, cam.ss * 0.3 * f);
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(cam.sx, cam.sy);
            ctx.stroke();
            if (i === n - 1) ang = Math.atan2(cam.sy - ly, cam.sx - lx) + Math.sin(this.sim * 30) * 0.08;
          }
          ok = vis;
          lx = cam.sx; ly = cam.sy;
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      if (!cam.project(b.x, b.y, b.z)) continue;
      this.ballShape(cam.sx, cam.sy, Math.max(3, 0.5 * cam.ss), ang, 0.9);
    }
  }

  // ------------------------------------------------------------------ attract mode

  private stepAttract(dt: number): void {
    this.attractShotT += dt;
    if (this.attractShotT > 9.5) {
      this.attractShot += 1 + Math.floor(this.rnd() * 3);
      this.attractShotT = 0;
      this.fade = 1;
      this.camSnap = true;
    } else if (this.attractShotT > 9.2) {
      this.fade = Math.max(this.fade, (this.attractShotT - 9.2) / 0.3);
    }
    if (this.playing) return;
    this.attractWait -= dt;
    if (this.attractWait > 0) return;
    if (!this.pendingSpec) {
      // walk to the next spot
      const spec = randomSpec(this.teams, this.attractN, this.rnd);
      this.attractN += 1;
      this.pendingSpec = spec;
      this.script = null;
      this.offense = spec.off;
      this.los = spec.los;
      this.toGo = spec.toGo;
      this.place(spec.off, spec.los, false);
      this.ballHeld = this.find(spec.off, this.teams[spec.off].lineup.off.QB);
      this.ballAir = false;
      this.attractWait = 2.6;
      return;
    }
    const spec = this.pendingSpec;
    this.pendingSpec = null;
    void this.run(spec, 0.85, undefined, true).then(() => {
      this.attractWait = 1.6;
    });
  }

  private pendingSpec: PlaySpec | null = null;

  // ------------------------------------------------------------------ drawing

  private draw(): void {
    this.drawn = true;
    const ctx = this.ctx;
    const cam = this.cam;
    const W = this.W;
    const H = this.H;
    const px = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const exc = sat(this.exc + this.excBoost);

    const horizon = cam.cy + (cam.f * cam.fy) / Math.max(0.05, Math.hypot(cam.fx, cam.fz));
    const ground = this.groundOn && this.g ? this.g : null;
    if (ground) this.drawGroundWorld(horizon);
    else this.drawStadiumWorld(horizon, exc);

    this.drawLines();
    if (this.chalk) this.drawChalk(1);
    if (this.guide && !ground) {
      this.painter.px = px;
      this.guide.drawGround(this.painter);
    }
    this.drawDecals();

    // ---- everybody, far to near
    const order = this.order;
    order.length = 0;
    for (const ac of this.actors) {
      ac.vis = cam.project(ac.x, 0, ac.z);
      ac.sx = cam.sx; ac.sy = cam.sy; ac.ss = cam.ss; ac.sd = cam.sd;
      // which way is "toward +x" on screen right now
      if (cam.project(ac.x + ac.face * 0.5, 0, ac.z)) {
        const d = cam.sx - ac.sx;
        if (Math.abs(d) > ac.ss * 0.14) ac.look = d > 0 ? 1 : -1;
        else if (ac.speed > 3 && cam.project(ac.x + ac.vx * 0.1, 0, ac.z + ac.vz * 0.1)) {
          const m = cam.sx - ac.sx;
          if (Math.abs(m) > ac.ss * 0.12) ac.look = m > 0 ? 1 : -1;
        }
      }
      if (ac.vis && ac.sd > 1.2) order.push(ac);
    }
    order.sort((a, b) => b.sd - a.sd);
    // equipment on the practice ground stands in the same depth order
    const props = this.propOrder;
    props.length = 0;
    if (ground) {
      for (const p of ground.props) {
        if (p.kind === 'coach' && p.a < 0.04) continue;
        if (!cam.project(p.x + (p.kind === 'sled' ? p.v : 0), 0, p.z) || cam.sd < 1) continue;
        p.sd = cam.sd;
        props.push(p);
      }
      props.sort((a, b) => b.sd - a.sd);
    }
    let pi = 0;
    const ballFree = !this.ballHeld && !ground;
    let ballDrawn = !ballFree;
    let ballDepth = 0;
    const ballSeen = cam.project(this.bx, this.by, this.bz);
    // only what stands between the lens and the ball may fade out
    this.subjectDepth = ballSeen ? cam.sd : 99;
    if (ballFree && ballSeen) ballDepth = cam.sd;
    else ballDrawn = true;
    if (ballFree) this.drawBallShadow();
    // the two goals stand in the same depth order as the heroes
    const g0 = cam.project(-END - 0.6, 0, MID_Z) ? cam.sd : -1;
    const g1 = cam.project(FIELD + END + 0.6, 0, MID_Z) ? cam.sd : -1;
    let goals = (g0 > 0 ? 1 : 0) | (g1 > 0 ? 2 : 0);
    this.drawPylons();
    for (const ac of order) {
      if ((goals & 1) && g0 > ac.sd) { this.drawGoal(-END - 0.6); goals &= ~1; }
      if ((goals & 2) && g1 > ac.sd) { this.drawGoal(FIELD + END + 0.6); goals &= ~2; }
      while (ground && pi < props.length && props[pi]!.sd > ac.sd) {
        ground.drawProp(this.painter, props[pi]!, this.clock);
        pi += 1;
      }
      if (!ballDrawn && ballDepth > ac.sd) {
        this.drawBall();
        ballDrawn = true;
      }
      this.drawActor(ac);
    }
    if (goals & 1) this.drawGoal(-END - 0.6);
    if (goals & 2) this.drawGoal(FIELD + END + 0.6);
    while (ground && pi < props.length) {
      ground.drawProp(this.painter, props[pi]!, this.clock);
      pi += 1;
    }
    if (!ballDrawn) this.drawBall();
    if (ground) this.drawGroundBalls();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // the routes once more, faintly, over the heroes: like a telestrator, never hidden
    if (this.chalk) this.drawChalk(0.4);
    if (this.guide && !ground) this.guide.drawAir(this.painter);
    this.drawMarkers(order);
    // equipment is pointed at only while a drill is being considered, not while it runs
    if (ground && this.gHint && !this.drilling) ground.pointers(this.painter, this.clock);

    // ---- particles and light
    ctx.imageSmoothingEnabled = true;
    this.fx.drawSolid(ctx, cam, this.sprites);
    ctx.globalCompositeOperation = 'lighter';
    this.fx.drawGlow(ctx, cam, this.sprites, px);
    this.drawBursts();
    if (!ground) this.drawLights(exc, horizon);
    if (this.speedLines > 0.01) this.drawSpeedLines();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // the evening light lies over everything on the practice ground
    if (ground) ground.wash(this.painter);

    // ---- lens: vignette, flash, fade
    {
      const g = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, ground ? 'rgba(30,10,30,0)' : 'rgba(3,6,20,0)');
      g.addColorStop(1, ground ? `rgba(30,10,30,${0.3 + 0.1 * this.punch})` : `rgba(3,6,20,${0.5 + 0.12 * this.punch})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.flash > 0.01 && this.motion) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(235,240,255,${Math.min(0.45, this.flash)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.fade > 0.01) {
      ctx.fillStyle = ground ? `rgba(30,16,30,${sat(this.fade)})` : `rgba(4,7,22,${sat(this.fade)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Night sky, towers, stands and the stadium's turf. */
  private drawStadiumWorld(horizon: number, exc: number): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const W = this.W;
    const H = this.H;
    const px = this.dpr;
    this.ensureArt();
    const field = this.field!;
    // ---- sky
    {
      const g = ctx.createLinearGradient(0, horizon - H * 1.1, 0, horizon + H * 0.05);
      g.addColorStop(0, '#04071a');
      g.addColorStop(0.55, '#0a1336');
      g.addColorStop(0.85, '#182a5c');
      g.addColorStop(1, '#27407c');
      ctx.fillStyle = g;
      // the ground covers everything below the horizon
      ctx.fillRect(0, 0, W, clamp(horizon + H * 0.06, 0, H));
    }
    ctx.fillStyle = '#e8eeff';
    for (let i = 0; i < this.stars.length; i += 4) {
      if (!cam.project(cam.ex + this.stars[i]! * 900, cam.ey + this.stars[i + 1]! * 900, cam.ez + this.stars[i + 2]! * 900)) continue;
      if (cam.sy > horizon || cam.sx < 0 || cam.sx > W || cam.sy < 0) continue;
      const tw = 0.55 + 0.45 * Math.sin(this.clock * (1 + this.stars[i + 3]! * 2) + i);
      ctx.globalAlpha = this.stars[i + 3]! * tw * 0.8;
      const s = Math.max(1, px * (0.8 + this.stars[i + 3]!));
      ctx.fillRect(cam.sx, cam.sy, s, s);
    }
    ctx.globalAlpha = 1;

    // ---- ground far beyond the stadium, then towers, then the bowl
    this.fillPoly([-400, 0, -400, 500, 0, -400, 500, 0, 500, -400, 0, 500], '#070b18');
    this.drawTowers();
    this.drawBowl(exc);

    // ---- apron and turf
    this.fillPoly([
      AX0 + CHAMFER, 0, AZ0, AX1 - CHAMFER, 0, AZ0, AX1, 0, AZ0 + CHAMFER, AX1, 0, AZ1 - CHAMFER,
      AX1 - CHAMFER, 0, AZ1, AX0 + CHAMFER, 0, AZ1, AX0, 0, AZ1 - CHAMFER, AX0, 0, AZ0 + CHAMFER,
    ], SURROUND);
    // team areas on the far side
    this.fillPoly([6, 0, -4.6, 21, 0, -4.6, 21, 0, -2.4, 6, 0, -2.4], css(mix(scale(this.col[0], 0.55), [12, 40, 36], 0.45)));
    this.fillPoly([29, 0, -4.6, 44, 0, -4.6, 44, 0, -2.4, 29, 0, -2.4], css(mix(scale(this.col[1], 0.55), [12, 40, 36], 0.45)));
    // the turf in layers: flat mowed bands, a soft overlay that may fit loosely, sharp paint, crisp lines
    for (let i = 0; i < FIELD / 5; i += 1) {
      this.fillPoly([i * 5, 0, 0, i * 5 + 5.05, 0, 0, i * 5 + 5.05, 0, WIDTH, i * 5, 0, WIDTH], BANDS[i % 2]!);
    }
    this.fillPoly([-END, 0, 0, 0, 0, 0, 0, 0, WIDTH, -END, 0, WIDTH], this.zoneCss[0]);
    this.fillPoly([FIELD, 0, 0, FIELD + END, 0, 0, FIELD + END, 0, WIDTH, FIELD, 0, WIDTH], this.zoneCss[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    const ov = field.overlay;
    this.tqPad = 0.2;
    this.texQuad(ov, 0, 0, ov.width, ov.height, FIELD_QUAD, 6, 2, 6 * px, 6);
    this.tqPad = 0.75;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawPooling();
    for (const d of field.decals) this.texQuad(d.tex, 0, 0, d.tex.width, d.tex.height, d.quad, 1, 1, 2.6 * px, 4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawMarkings();
  }

  private order: Actor[] = [];
  private subjectDepth = 99;
  private bowlOrder: Panel[] = [];
  private scratch = new Float64Array(64);

  private fillPoly(pts: ArrayLike<number>, style: string | CanvasGradient): boolean {
    const cam = this.cam;
    const n = cam.poly(pts);
    if (n < 3) return false;
    const ctx = this.ctx;
    const o = cam.out;
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.moveTo(o[0]!, o[1]!);
    for (let i = 1; i < n; i += 1) ctx.lineTo(o[i * 2]!, o[i * 2 + 1]!);
    ctx.closePath();
    ctx.fill();
    return true;
  }

  // ---- textured quads in perspective: adaptive affine pieces

  private tqImg: CanvasImageSource | null = null;
  private tqSx = 0; private tqSy = 0; private tqSw = 1; private tqSh = 1;
  private tqP: ArrayLike<number> = FIELD_QUAD;
  private tqTol = 1.5; private tqMax = 6;
  /** how far (pixels) a piece reaches over its neighbours; keep it small for translucent textures */
  private tqPad = 0.75;
  private qx = 0; private qy = 0; private qd = 0;

  private tqProj(u: number, v: number): void {
    const P = this.tqP;
    const a = (1 - u) * (1 - v); const b = u * (1 - v); const c = (1 - u) * v; const d = u * v;
    const cam = this.cam;
    if (cam.project(P[0]! * a + P[3]! * b + P[6]! * c + P[9]! * d, P[1]! * a + P[4]! * b + P[7]! * c + P[10]! * d, P[2]! * a + P[5]! * b + P[8]! * c + P[11]! * d)) {
      this.qx = cam.sx; this.qy = cam.sy; this.qd = cam.sd;
    } else this.qd = -1;
  }

  /**
   * Draws part of an image onto a world quad (top-left, top-right, bottom-left, bottom-right).
   * The quad is cut into pieces small enough that an affine transform is a good stand-in for perspective.
   */
  private texQuad(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, P: ArrayLike<number>, nu: number, nv: number, tol: number, maxDepth: number): void {
    this.tqImg = img; this.tqSx = sx; this.tqSy = sy; this.tqSw = sw; this.tqSh = sh; this.tqP = P; this.tqTol = tol; this.tqMax = maxDepth;
    // project the starting grid once
    const cols = nu + 1;
    const need = cols * (nv + 1) * 3;
    if (this.scratch.length < need) this.scratch = new Float64Array(need);
    const g = this.scratch;
    for (let j = 0; j <= nv; j += 1) {
      for (let i = 0; i <= nu; i += 1) {
        this.tqProj(i / nu, j / nv);
        const k = (j * cols + i) * 3;
        g[k] = this.qx; g[k + 1] = this.qy; g[k + 2] = this.qd;
      }
    }
    for (let j = 0; j < nv; j += 1) {
      for (let i = 0; i < nu; i += 1) {
        const a = (j * cols + i) * 3; const b = a + 3; const c = a + cols * 3; const d = c + 3;
        this.tqRec(i / nu, j / nv, (i + 1) / nu, (j + 1) / nv,
          g[a]!, g[a + 1]!, g[a + 2]!, g[b]!, g[b + 1]!, g[b + 2]!, g[c]!, g[c + 1]!, g[c + 2]!, g[d]!, g[d + 1]!, g[d + 2]!, 0);
      }
    }
  }

  private tqRec(
    u0: number, v0: number, u1: number, v1: number,
    ax: number, ay: number, ad: number, bx: number, by: number, bd: number,
    cx: number, cy: number, cd: number, dx: number, dy: number, dd: number, depth: number,
  ): void {
    const behind = (ad < 0 ? 1 : 0) + (bd < 0 ? 1 : 0) + (cd < 0 ? 1 : 0) + (dd < 0 ? 1 : 0);
    if (behind === 4) return;
    let splitU: boolean;
    if (behind === 0) {
      const W = this.W;
      const H = this.H;
      if ((ax < 0 && bx < 0 && cx < 0 && dx < 0) || (ax > W && bx > W && cx > W && dx > W)
        || (ay < 0 && by < 0 && cy < 0 && dy < 0) || (ay > H && by > H && cy > H && dy > H)) return;
      const lu = Math.hypot(bx - ax, by - ay) + Math.hypot(dx - cx, dy - cy);
      const lv = Math.hypot(cx - ax, cy - ay) + Math.hypot(dx - bx, dy - by);
      const err = Math.hypot(ax + dx - bx - cx, ay + dy - by - cy);
      if (err <= this.tqTol || depth >= this.tqMax || (lu < 16 && lv < 16)) {
        this.tqCell(u0, v0, u1, v1, ax, ay, bx, by, cx, cy, dx, dy);
        return;
      }
      splitU = lu >= lv;
    } else {
      if (depth >= Math.min(this.tqMax, 5)) return;
      splitU = depth % 2 === 0;
    }
    if (splitU) {
      const um = (u0 + u1) / 2;
      this.tqProj(um, v0);
      const ex = this.qx; const ey = this.qy; const ed = this.qd;
      this.tqProj(um, v1);
      const fx = this.qx; const fy = this.qy; const fd = this.qd;
      this.tqRec(u0, v0, um, v1, ax, ay, ad, ex, ey, ed, cx, cy, cd, fx, fy, fd, depth + 1);
      this.tqRec(um, v0, u1, v1, ex, ey, ed, bx, by, bd, fx, fy, fd, dx, dy, dd, depth + 1);
    } else {
      const vm = (v0 + v1) / 2;
      this.tqProj(u0, vm);
      const ex = this.qx; const ey = this.qy; const ed = this.qd;
      this.tqProj(u1, vm);
      const fx = this.qx; const fy = this.qy; const fd = this.qd;
      this.tqRec(u0, v0, u1, vm, ax, ay, ad, bx, by, bd, ex, ey, ed, fx, fy, fd, depth + 1);
      this.tqRec(u0, vm, u1, v1, ex, ey, ed, fx, fy, fd, cx, cy, cd, dx, dy, dd, depth + 1);
    }
  }

  private tqCell(u0: number, v0: number, u1: number, v1: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
    const rw = (u1 - u0) * this.tqSw;
    const rh = (v1 - v0) * this.tqSh;
    const rx = this.tqSx + u0 * this.tqSw;
    const ry = this.tqSy + v0 * this.tqSh;
    // the parallelogram that fits the four corners best
    const exx = (bx - ax + dx - cx) / 2; const exy = (by - ay + dy - cy) / 2;
    const eyx = (cx - ax + dx - bx) / 2; const eyy = (cy - ay + dy - by) / 2;
    const lx = Math.hypot(exx, exy);
    const ly = Math.hypot(eyx, eyy);
    if (lx < 0.02 || ly < 0.02) return;
    const ox = (ax + bx + cx + dx) / 4 - exx / 2 - eyx / 2;
    const oy = (ay + by + cy + dy) / 4 - exy / 2 - eyy / 2;
    // overlap the neighbours by a fraction of a pixel so no seams show
    const padx = Math.min(rw * 0.5, (this.tqPad * rw) / lx);
    const pady = Math.min(rh * 0.5, (this.tqPad * rh) / ly);
    const sx0 = Math.max(this.tqSx, rx - padx);
    const sy0 = Math.max(this.tqSy, ry - pady);
    const sx1 = Math.min(this.tqSx + this.tqSw, rx + rw + padx);
    const sy1 = Math.min(this.tqSy + this.tqSh, ry + rh + pady);
    const ctx = this.ctx;
    ctx.setTransform(exx / rw, exy / rw, eyx / rh, eyy / rh, ox, oy);
    ctx.drawImage(this.tqImg!, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - rx, sy0 - ry, sx1 - sx0, sy1 - sy0);
  }

  // ---- surroundings

  private drawTowers(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const px = this.dpr;
    for (const [x, z] of TOWERS) {
      if (!cam.project(x, 0, z)) continue;
      const bx = cam.sx; const by = cam.sy;
      if (!cam.project(x, TOWER_H, z)) continue;
      const tx = cam.sx; const ty = cam.sy; const ss = cam.ss;
      if (tx < -W_PAD * this.W || tx > this.W * (1 + W_PAD)) continue;
      ctx.strokeStyle = '#0c1226';
      ctx.lineWidth = Math.max(1.5 * px, ss * 1.1);
      ctx.beginPath();
      ctx.moveTo(bx - ss * 1.2, by);
      ctx.lineTo(tx, ty);
      ctx.moveTo(bx + ss * 1.2, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // the bank of lamps
      const w = ss * 7.5;
      const h = ss * 4.6;
      ctx.fillStyle = '#141b36';
      ctx.fillRect(tx - w / 2, ty - h * 0.7, w, h);
      ctx.fillStyle = '#f4f7ff';
      const lw = Math.max(px, w / 9);
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 5; c += 1) {
          ctx.fillRect(tx - w / 2 + (c + 0.5) * (w / 5) - lw / 2, ty - h * 0.7 + (r + 0.5) * (h / 3) - lw / 2, lw, lw);
        }
      }
    }
  }

  private drawBowl(exc: number): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const px = this.dpr;
    const hot = exc > 0.55;
    const rate = hot ? 7 + exc * 4 : 2.2 + exc * 3;
    const frame = Math.floor(this.clock * rate) % 3;
    const crowd = (hot ? this.crowdHot : this.crowdCalm)[frame]!;
    const rib = this.ribbons![this.ribbonMode];
    const scroll = (this.clock * (this.ribbonMode === 'main' ? 26 : 60)) % rib.period;
    const blink = this.ribbonMode !== 'main' && this.motion && Math.floor(this.clock * 7) % 2 === 0;
    // far stretches first, so a nearer one may cover a farther one where they meet in a corner
    const order = this.bowlOrder;
    order.length = 0;
    for (const p of this.bowl) {
      // skip a stretch that is entirely behind the camera
      const S = p.seat;
      let any = false;
      for (let i = 0; i < 12 && !any; i += 3) any = cam.project(S[i]!, S[i + 1]!, S[i + 2]!);
      if (!any && !cam.project(p.wall[6]!, 0, p.wall[8]!) && !cam.project(p.wall[9]!, 0, p.wall[11]!)) continue;
      p.dist = Math.hypot((S[6]! + S[9]!) / 2 - cam.ex, (S[8]! + S[11]!) / 2 - cam.ez);
      order.push(p);
    }
    order.sort((a, b) => b.dist - a.dist);
    for (const p of order) {
      this.fillPoly(QUAD_ORDER(p.rim), '#0a1028');
      this.fillPoly(QUAD_ORDER(p.seat), '#0b1124');
      // a thin light line along the top of the rim
      if (cam.project(p.rim[0]!, p.rim[1]!, p.rim[2]!)) {
        const x0 = cam.sx; const y0 = cam.sy;
        if (cam.project(p.rim[3]!, p.rim[4]!, p.rim[5]!)) {
          ctx.strokeStyle = 'rgba(150,180,255,0.5)';
          ctx.lineWidth = Math.max(px, cam.ss * 0.25);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(cam.sx, cam.sy);
          ctx.stroke();
        }
      }
    }
    for (const p of order) {
      ctx.imageSmoothingEnabled = false;
      const cw = crowd.width;
      const rh = (crowd.height / CROWD_ROWS) * ROWS_PER_STEP;
      for (let k = 0; k < STEPS; k += 1) {
        this.texQuad(crowd, p.u0 * cw, k * rh, (p.u1 - p.u0) * cw, rh, p.steps[k]!, p.main ? 3 : 1, 1, 2.4 * px, p.main ? 5 : 4);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // the wall under the seats carries the LED ribbon
      this.fillPoly(QUAD_ORDER(p.wall), '#05070f');
      const sx = (scroll + p.s0 * RIBBON_PPY) % rib.period;
      this.texQuad(rib.tex, sx, 0, p.len * RIBBON_PPY, RIBBON_H, p.wall, p.main ? 3 : 1, 1, 2 * px, 5);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (blink) {
        ctx.globalCompositeOperation = 'lighter';
        this.fillPoly(QUAD_ORDER(p.wall), 'rgba(255,230,170,0.28)');
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.imageSmoothingEnabled = true;
  }

  /** Floodlight pooling: the turf is brightest in the middle and falls off toward the ends and the sidelines. */
  private drawPooling(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const shade = (x0: number, z0: number, x1: number, z1: number, ax: number, az: number, bx: number, bz: number, a: number): void => {
      // gradient from (ax,az) at full strength to (bx,bz) at nothing
      if (!cam.project(ax, 0, az)) return;
      const sx = cam.sx; const sy = cam.sy;
      if (!cam.project(bx, 0, bz)) return;
      const g = ctx.createLinearGradient(sx, sy, cam.sx, cam.sy);
      g.addColorStop(0, `rgba(4,10,34,${a})`);
      g.addColorStop(1, 'rgba(4,10,34,0)');
      this.fillPoly([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], g);
    };
    const cx = clamp(this.focusX, 8, FIELD - 8);
    shade(FX0, FZ0, 16, FZ1, FX0, MID_Z, 16, MID_Z, 0.42);
    shade(FIELD - 16, FZ0, FX1, FZ1, FX1, MID_Z, FIELD - 16, MID_Z, 0.42);
    shade(FX0, FZ0, FX1, 6, cx, FZ0, cx, 6, 0.22);
    shade(FX0, WIDTH - 6, FX1, FZ1, cx, FZ1, cx, WIDTH - 6, 0.26);
  }

  /** The long chalk lines: border, goal lines and a line every five yards. */
  private drawMarkings(): void {
    const B = 0.5;
    const y = 0.01;
    const strip = (x0: number, z0: number, x1: number, z1: number, style: string): void => {
      this.fillPoly([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], style);
    };
    strip(-END - B, -B, FIELD + END + B, 0, CHALK);
    strip(-END - B, WIDTH, FIELD + END + B, WIDTH + B, CHALK);
    strip(-END - B, 0, -END, WIDTH, CHALK);
    strip(FIELD + END, 0, FIELD + END + B, WIDTH, CHALK);
    for (let yd = 0; yd <= FIELD; yd += 5) {
      const goal = yd === 0 || yd === FIELD;
      const w = goal ? 0.17 : 0.085;
      strip(yd - w, 0, yd + w, WIDTH, goal ? CHALK : 'rgba(246,249,242,0.74)');
    }
  }

  /** Where the play starts (cool blue) and the line to gain (yellow), glowing on the turf. */
  private drawLines(): void {
    if (!this.hasScene && !this.attractOn) return;
    const ctx = this.ctx;
    const x0 = worldX(this.offense, this.los);
    const gain = this.los + this.toGo;
    const pulse = 0.82 + 0.18 * Math.sin(this.clock * 3.2);
    ctx.globalCompositeOperation = 'lighter';
    const line = (x: number, c: string, glow: string): void => {
      this.fillPoly([x - 0.75, 0.02, 0, x + 0.75, 0.02, 0, x + 0.75, 0.02, WIDTH, x - 0.75, 0.02, WIDTH], glow);
      this.fillPoly([x - 0.16, 0.02, 0, x + 0.16, 0.02, 0, x + 0.16, 0.02, WIDTH, x - 0.16, 0.02, WIDTH], c);
      // a light that runs along the line
      const z = ((this.clock * 9) % (WIDTH + 8)) - 4;
      const z0 = clamp(z, 0, WIDTH);
      const z1 = clamp(z + 4, 0, WIDTH);
      if (z1 > z0) this.fillPoly([x - 0.3, 0.02, z0, x + 0.3, 0.02, z0, x + 0.3, 0.02, z1, x - 0.3, 0.02, z1], glow);
    };
    line(x0, `rgba(110,190,255,${0.75 * pulse})`, `rgba(60,130,255,${0.2 * pulse})`);
    if (gain < FIELD) line(worldX(this.offense, gain), `rgba(240,200,90,${0.7 * pulse})`, `rgba(230,170,40,${0.17 * pulse})`);
    ctx.globalCompositeOperation = 'source-over';
  }

  private ringPts: number[] = [];

  /** Shadows and rings on the turf under every hero. */
  private drawDecals(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const now = this.clock;
    // shock rings
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i]!;
      const f = (now - r.t) / r.dur;
      if (f >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      // a true ring on the turf (clipped against the lens: the camera may stand inside it)
      const rad = r.r * easeOut(f);
      const half = (0.32 * (1 - f) + 0.06) / 2;
      const N = 28;
      const ring = this.ringPts;
      ring.length = 0;
      for (let k = 0; k <= N; k += 1) {
        const a = (k / N) * TAU;
        ring.push(r.x + Math.cos(a) * (rad + half), 0.02, r.z + Math.sin(a) * (rad + half));
      }
      for (let k = N; k >= 0; k -= 1) {
        const a = (k / N) * TAU;
        ring.push(r.x + Math.cos(a) * Math.max(0, rad - half), 0.02, r.z + Math.sin(a) * Math.max(0, rad - half));
      }
      ctx.globalAlpha = (1 - f) * 0.9;
      this.fillPoly(ring, r.color);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    for (const ac of this.actors) {
      if (!cam.project(ac.x, 0, ac.z) || cam.sd < 1.5) continue;
      const fsx = cam.sx; const fsy = cam.sy;
      // local ground axes on screen (pixels per yard)
      if (!cam.groundDir(ac.x, ac.z, 1, 0)) continue;
      const gxx = cam.sx; const gxy = cam.sy;
      if (!cam.groundDir(ac.x, ac.z, 0, 1)) continue;
      const gzx = cam.sx; const gzy = cam.sy;
      // four shadows, one for each floodlight tower
      const art = ac.art;
      if (art.ready && art.dark && this.groundOn && this.g) {
        // one long shadow, away from the low sun
        const l = this.g.light;
        const k = HERO_H / ART;
        const len = l.shLen * 0.74;
        const ux = (gxx * l.shX + gzx * l.shZ) * k * len;
        const uy = (gxy * l.shX + gzy * l.shZ) * k * len;
        const rx = (gxx * -l.shZ + gzx * l.shX) * k * 0.9;
        const ry = (gxy * -l.shZ + gzy * l.shX) * k * 0.9;
        const off = ac.y * len;
        ctx.globalAlpha = Math.min(0.5, l.shA + 0.08);
        ctx.setTransform(rx, ry, -ux, -uy, fsx + (gxx * l.shX + gzx * l.shZ) * off, fsy + (gxy * l.shX + gzy * l.shZ) * off);
        ctx.drawImage(art.dark, -ART / 2, -art.foot);
        ctx.globalAlpha = 1;
      } else if (art.ready && art.dark) {
        const k = HERO_H / ART;
        ctx.globalAlpha = 0.15;
        for (const [lx, lz] of TOWERS) {
          let ax = ac.x - lx;
          let az = ac.z - lz;
          const dist = Math.hypot(ax, az) || 1;
          ax /= dist; az /= dist;
          const len = clamp(dist / TOWER_H, 0.35, 1.25) * 0.72;
          // sprite "up" lies along the ground away from the light, sprite "right" across it
          const ux = (gxx * ax + gzx * az) * k * len;
          const uy = (gxy * ax + gzy * az) * k * len;
          const rx = (gxx * -az + gzx * ax) * k * 0.9;
          const ry = (gxy * -az + gzy * ax) * k * 0.9;
          const off = ac.y * len;
          ctx.setTransform(rx, ry, -ux, -uy, fsx + (gxx * ax + gzx * az) * off, fsy + (gxy * ax + gzy * az) * off);
          ctx.drawImage(art.dark, -ART / 2, -art.foot);
        }
        ctx.globalAlpha = 1;
      }
      // contact shadow and the team ring
      ctx.setTransform(gxx, gxy, gzx, gzy, fsx, fsy);
      ctx.fillStyle = 'rgba(4,10,24,0.42)';
      ctx.beginPath();
      ctx.arc(0, 0, 0.85 - Math.min(0.4, ac.y * 0.2), 0, TAU);
      ctx.fill();
      const c = ac.ring ? rgbOf(ac.ring) : this.groundOn ? this.gCol : this.col[ac.team];
      const holder = this.ballHeld === ac;
      const beat = holder ? 0.12 * Math.sin(now * 9) : 0;
      ctx.strokeStyle = css(mix(c, [255, 255, 255], holder ? 0.35 : 0.1), 0.9);
      ctx.lineWidth = holder ? 0.24 : 0.17;
      ctx.beginPath();
      ctx.arc(0, 0, 1.05 + beat, 0, TAU);
      ctx.stroke();
      if (ac.aura) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = css(mix(c, [255, 255, 255], 0.5), 0.55);
        ctx.lineWidth = 0.14;
        const r = 1.3 + ((now * 1.6 + ac.phase) % 1) * 1.5;
        ctx.globalAlpha = 1 - ((now * 1.6 + ac.phase) % 1);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this.sprites.teamGlow[ac.team], -2.6, -2.6, 5.2, 5.2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Sets the canvas transform to the turf around a ground point (units: yards). False when behind the camera. */
  private groundMatrix(x: number, z: number): boolean {
    const cam = this.cam;
    if (!cam.project(x, 0, z) || cam.sd < 1.5) return false;
    const fsx = cam.sx; const fsy = cam.sy;
    if (!cam.groundDir(x, z, 1, 0)) return false;
    const gxx = cam.sx; const gxy = cam.sy;
    if (!cam.groundDir(x, z, 0, 1)) return false;
    this.ctx.setTransform(gxx, gxy, cam.sx, cam.sy, fsx, fsy);
    return true;
  }

  /** A goal at the back of an end zone: a post, a crossbar and two uprights. */
  private drawGoal(x: number): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const px = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = 'round';
    const seg = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number): void => {
      if (!cam.project(x0, y0, z0)) return;
      const ax = cam.sx; const ay = cam.sy; const as = cam.ss;
      if (!cam.project(x1, y1, z1)) return;
      const lw = Math.max(1.5 * px, ((as + cam.ss) / 2) * w);
      ctx.strokeStyle = 'rgba(20,16,6,0.55)';
      ctx.lineWidth = lw + 2 * px;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(cam.sx, cam.sy);
      ctx.stroke();
      ctx.strokeStyle = '#e3c462';
      ctx.lineWidth = lw;
      ctx.stroke();
    };
    const bar = 3.4;
    const half = 3.2;
    // the post leans in over the end line, like a gooseneck
    const bx = x < 0 ? x + 0.5 : x - 0.5;
    seg(x, 0, MID_Z, x, bar - 0.6, MID_Z, 0.26);
    seg(x, bar - 0.6, MID_Z, bx, bar, MID_Z, 0.26);
    seg(bx, bar, MID_Z - half, bx, bar, MID_Z + half, 0.2);
    seg(bx, bar, MID_Z - half, bx, bar + 6.5, MID_Z - half, 0.17);
    seg(bx, bar, MID_Z + half, bx, bar + 6.5, MID_Z + half, 0.17);
  }

  /** Small orange markers at the corners of the end zones. */
  private drawPylons(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const x of [-END, 0, FIELD, FIELD + END]) {
      for (const z of [-0.1, WIDTH + 0.1]) {
        if (!cam.project(x, 0, z) || cam.sd < 1.5) continue;
        const w = Math.max(2, cam.ss * 0.26);
        const h = cam.ss * 0.75;
        ctx.fillStyle = 'rgba(4,10,24,0.4)';
        ctx.fillRect(cam.sx - w * 0.8, cam.sy - w * 0.25, w * 1.6, w * 0.5);
        ctx.fillStyle = '#e8853a';
        ctx.fillRect(cam.sx - w / 2, cam.sy - h, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(cam.sx - w / 2, cam.sy - h, w * 0.35, h);
      }
    }
  }

  private drawActor(ac: Actor): void {
    const ctx = this.ctx;
    const art = ac.art;
    const ss = ac.ss;
    const sc = (HERO_H * ss) / ART;
    const now = this.clock;
    const run = ac.run;
    let lift = (ac.y + run * Math.abs(Math.sin(ac.cyc)) * 0.34) * ss;
    let rot = 0;
    let kx = 1;
    let ky = 1;
    let look = ac.look;
    // breathing
    const br = Math.sin(now * 2.3 + ac.phase * TAU);
    ky *= 1 + br * 0.02 * (1 - run);
    kx *= 1 - br * 0.012 * (1 - run);
    // run: lean, alternating tilt, squash on the ground and stretch in the air
    rot += look * run * 0.17 + Math.sin(ac.cyc) * 0.055 * run;
    const st = Math.cos(ac.cyc * 2) * 0.075 * run;
    ky *= 1 - st;
    kx *= 1 + st;
    // set before the snap
    ky *= 1 - 0.2 * ac.crouch;
    kx *= 1 + 0.1 * ac.crouch;
    rot += look * 0.1 * ac.crouch;
    // jump: stretch on the way, squash on landing
    const jp = (this.sim - ac.jumpT0) / ac.jumpDur;
    if (jp >= 0 && jp < 1) {
      ky *= 1 + 0.14 * Math.sin(Math.PI * jp);
      kx *= 1 - 0.08 * Math.sin(Math.PI * jp);
    } else if (jp >= 1 && jp < 1.4) {
      const q = (jp - 1) / 0.4;
      ky *= 1 - 0.16 * (1 - q);
      kx *= 1 + 0.12 * (1 - q);
    }
    // a quick spin on the spot: the sprite flips back and forth
    const fl = this.sim - ac.flipT0;
    if (fl >= 0 && fl < 0.32 && Math.floor(fl / 0.08) % 2 === 0) look = -look as 1 | -1;
    if (ac.celebrate) {
      const c = (this.sim - ac.celT0) * 8.5 + ac.phase * 5;
      const hy = Math.abs(Math.sin(c));
      lift += hy * 0.95 * ss;
      ky *= 1 + 0.12 * hy - 0.08 * (1 - hy);
      kx *= 1 - 0.06 * hy + 0.06 * (1 - hy);
      if (Math.floor(c / Math.PI) % 4 >= 2) look = -look as 1 | -1;
    }
    // tumble: spin about the middle of the body, lie flat, pop back up
    let pivot = 0;
    let pivotH = 0;
    if (ac.tumT0 >= 0) {
      const p = (this.sim - ac.tumT0) / ac.tumDur;
      let lying = 1;
      if (p < 1) {
        rot += ac.tumDir * easeOut(p) * (TAU + Math.PI / 2);
        lift += Math.sin(Math.PI * p) * 1.0 * ss;
        lying = p;
      } else if (this.sim < ac.downUntil) {
        rot += ac.tumDir * (Math.PI / 2);
      } else {
        const q = (this.sim - ac.downUntil) / 0.24;
        if (q < 1) {
          rot += ac.tumDir * (Math.PI / 2) * (1 - easeOut(q));
          ky *= 1 + 0.18 * Math.sin(Math.PI * q);
          lying = 1 - q;
        } else {
          ac.tumT0 = -1;
          lying = 0;
        }
      }
      if (ac.tumT0 >= 0) {
        pivot = 26;
        pivotH = lerp(26, 11, lying) * sc;
      }
    }
    const mx = -look * kx * sc;
    const my = ky * sc;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const tx = ac.sx;
    const ty = ac.sy - lift - pivotH;

    // after-images of a special play
    if (ac.trail.length && art.ready) {
      const tint = tinted(art, css(mix(this.col[ac.team], [255, 255, 255], 0.4)));
      if (tint) {
        const cam = this.cam;
        const n = ac.trail.length / 3;
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = false;
        for (let i = 0; i < n; i += 1) {
          if (!cam.project(ac.trail[i * 3]!, 0, ac.trail[i * 3 + 2]!)) continue;
          const s2 = (HERO_H * cam.ss) / ART;
          ctx.globalAlpha = 0.07 + 0.3 * ((i + 1) / n);
          ctx.setTransform(-look * s2, 0, 0, s2, cam.sx, cam.sy - ac.trail[i * 3 + 1]! * cam.ss);
          ctx.drawImage(tint, -ART / 2, -art.foot);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // somebody who wanders right in front of the lens goes translucent instead of hiding the play
    let alpha = 1;
    if (this.groundOn) {
      // on the practice ground everybody is worth seeing: only somebody right on the lens fades
      alpha = sat((ac.sd - 2.2) / 2.5);
    } else if (ac.sd < 13 && ac.sd < this.subjectDepth - 1.5 && this.ballHeld !== ac && !(this.camMode === 'qb' && ac.pos === 'QB')) {
      const sc = this.script;
      const star = sc && sc.star.team === ac.team && sc.star.id === ac.id;
      if (!star) alpha = sat((ac.sd - 6) / 7) ** 1.4;
    }
    if (alpha < 0.02) return;
    ctx.globalAlpha = alpha;
    ctx.setTransform(cs * mx, sn * mx, -sn * my, cs * my, tx, ty);
    if (!art.ready || !art.lit) {
      // the art has not arrived yet: a plain token in the team colour
      ctx.fillStyle = css(this.col[ac.team]);
      ctx.fillRect(-10, -40, 20, 40);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.imageSmoothingEnabled = false;
    if (ac.flash > 0 && this.motion && art.white) {
      ctx.drawImage(art.white, -ART / 2, -(art.foot - pivot));
    } else {
      ctx.drawImage(art.lit, -(ART / 2 + ART_PAD), -(art.foot - pivot + ART_PAD));
    }
    ctx.globalAlpha = 1;
    // the ball in the carrier's hands
    if (this.ballHeld === ac || ac.carry) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const bob = Math.sin(ac.cyc * 2) * 0.05 * run;
      const hx = ac.sx + look * 0.5 * ss + sn * 1.1 * ss;
      const hy = ac.sy - lift - (1.12 + bob) * ss * ky * (pivot ? 0.6 : 1);
      this.ballShape(hx, hy, 0.3 * ss, look * (-0.5 + rot * 0.5), 0.6);
    }
  }

  /** The bouncing marker over the ball carrier. */
  private drawMarkers(order: Actor[]): void {
    if (this.groundOn) {
      // on the practice ground the pointer marks the hero who has been called out
      for (const ac of order) if (ac.wave) this.marker(ac);
      return;
    }
    const ac = this.ballHeld;
    if (!ac || !ac.vis || !order.includes(ac)) return;
    if (ac.tumT0 >= 0) return;
    this.marker(ac);
  }

  private marker(ac: Actor): void {
    const ctx = this.ctx;
    const px = this.dpr;
    const ss = ac.ss;
    const h = HERO_H * ss * ((ac.art.ready ? ac.art.foot - ac.art.top : ART) / ART) * (1 - 0.2 * ac.crouch);
    const bounce = Math.abs(Math.sin(this.clock * 5.5)) * Math.min(0.28 * ss, 9 * px);
    const x = ac.sx;
    const y = ac.sy - h - ac.y * ss - Math.min(0.45 * ss, 14 * px) - bounce;
    const s = clamp(0.42 * ss, 5 * px, 16 * px);
    ctx.fillStyle = '#ffeab0';
    ctx.strokeStyle = 'rgba(10,16,40,0.9)';
    ctx.lineWidth = Math.max(1.5, 1.5 * px);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 1.1);
    ctx.lineTo(x + s, y - s * 1.1);
    ctx.lineTo(x, y + s * 0.3);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  private drawBallShadow(): void {
    const ctx = this.ctx;
    if (!this.groundMatrix(this.bx, this.bz)) return;
    ctx.fillStyle = `rgba(4,10,24,${clamp(0.5 - this.by * 0.03, 0.18, 0.5)})`;
    ctx.beginPath();
    const r = 0.42 + Math.min(0.5, this.by * 0.04);
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawBall(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // motion trail
    const tr = this.ballTrail;
    const n = tr.length / 3;
    if (n > 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      let ok = cam.project(tr[0]!, tr[1]!, tr[2]!);
      let lx = cam.sx; let ly = cam.sy;
      for (let i = 1; i < n; i += 1) {
        const vis = cam.project(tr[i * 3]!, tr[i * 3 + 1]!, tr[i * 3 + 2]!);
        if (vis && ok) {
          const f = i / n;
          ctx.strokeStyle = `rgba(255,240,210,${0.05 + 0.4 * f * f})`;
          ctx.lineWidth = Math.max(1, cam.ss * 0.34 * f);
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(cam.sx, cam.sy);
          ctx.stroke();
        }
        ok = vis;
        lx = cam.sx; ly = cam.sy;
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!cam.project(this.bx, this.by, this.bz)) return;
    const sx = cam.sx; const sy = cam.sy; const ss = cam.ss;
    let ang = this.sim * 14;
    let wob = 1;
    if (this.ballAir && this.ballSpiral && n > 1 && cam.project(tr[(n - 2) * 3]!, tr[(n - 2) * 3 + 1]!, tr[(n - 2) * 3 + 2]!)) {
      // a spiral points along its flight and wobbles a little
      ang = Math.atan2(sy - cam.sy, sx - cam.sx) + Math.sin(this.sim * 30) * 0.08;
      wob = 0.85 + 0.15 * Math.sin(this.sim * 40);
    } else if (!this.ballAir) ang = 0.3;
    this.ballShape(sx, sy, Math.max(3, 0.52 * ss), ang, wob);
  }

  private ballShape(x: number, y: number, r: number, ang: number, lace: number): void {
    const ctx = this.ctx;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    ctx.setTransform(c, s, -s, c, x, y);
    ctx.fillStyle = '#8a4a24';
    ctx.strokeStyle = '#2c1408';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.quadraticCurveTo(0, -r * 1.25, r, 0);
    ctx.quadraticCurveTo(0, r * 1.25, -r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // a lit top and the laces
    ctx.fillStyle = 'rgba(255,200,150,0.35)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.8, -r * 0.08);
    ctx.quadraticCurveTo(0, -r * 1.05, r * 0.8, -r * 0.08);
    ctx.quadraticCurveTo(0, -r * 0.5, -r * 0.8, -r * 0.08);
    ctx.fill();
    if (r > 3) {
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * lace})`;
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.05);
      ctx.lineTo(r * 0.4, -r * 0.05);
      for (let i = -1; i <= 1; i += 1) {
        ctx.moveTo(i * r * 0.22, -r * 0.2);
        ctx.lineTo(i * r * 0.22, r * 0.1);
      }
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Star-shaped flashes where bodies collide. Drawn additively. */
  private drawBursts(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i]!;
      const f = (this.clock - b.t) / b.dur;
      if (f >= 1) {
        this.bursts.splice(i, 1);
        continue;
      }
      if (!cam.project(b.x, b.y, b.z)) continue;
      const R = b.size * cam.ss * (0.45 + 0.75 * easeOut(f));
      const spikes = 9;
      ctx.globalAlpha = (1 - f) * 0.8;
      ctx.fillStyle = '#fff6da';
      ctx.beginPath();
      for (let k = 0; k < spikes * 2; k += 1) {
        const a = (k / (spikes * 2)) * TAU + b.seed;
        const rr = k % 2 ? R * (0.28 + 0.1 * f) : R * (0.75 + 0.5 * hash(b.seed + k));
        const x = cam.sx + Math.cos(a) * rr;
        const y = cam.sy + Math.sin(a) * rr * 0.86;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      const g = R * 2.6;
      ctx.globalAlpha = (1 - f) * 0.7;
      ctx.drawImage(this.sprites.glow, cam.sx - g / 2, cam.sy - g / 2, g, g);
    }
    ctx.globalAlpha = 1;
  }

  /** Floodlight bloom, beams in the haze, lens streaks. Drawn additively. */
  private drawLights(exc: number, horizon: number): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const W = this.W;
    const H = this.H;
    const sp = this.sprites;
    // haze where the stands meet the night
    {
      const y0 = horizon - H * 0.2;
      const y1 = horizon + H * 0.1;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(90,120,220,0)');
      g.addColorStop(0.65, 'rgba(110,140,235,0.11)');
      g.addColorStop(1, 'rgba(90,120,220,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, W, y1 - y0);
    }
    let i = 0;
    for (const [x, z] of TOWERS) {
      i += 1;
      const y = TOWER_H - 1.2;
      if (!cam.project(x, y, z)) continue;
      const lx = cam.sx; const ly = cam.sy; const ss = cam.ss;
      if (lx < -W * 0.4 || lx > W * 1.4 || ly < -H * 0.8 || ly > H) continue;
      const flick = 0.92 + 0.08 * Math.sin(this.clock * (13 + i * 3)) * (0.4 + exc);
      // the beam: a soft wedge from the lamps down toward the middle of the field
      if (cam.project(MID_X + (x < MID_X ? -6 : 6), 0, MID_Z)) {
        const gx = cam.sx; const gy = cam.sy;
        const dx = gx - lx; const dy = gy - ly;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * len * 0.34; const ny = (dx / len) * len * 0.34;
        const g = ctx.createLinearGradient(lx, ly, gx, gy);
        g.addColorStop(0, `rgba(190,210,255,${0.13 * flick})`);
        g.addColorStop(0.6, 'rgba(170,195,255,0.035)');
        g.addColorStop(1, 'rgba(170,195,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(gx + nx, gy + ny);
        ctx.lineTo(gx - nx, gy - ny);
        ctx.closePath();
        ctx.fill();
      }
      const size = clamp(ss * 30, H * 0.12, H * 0.5) * flick;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sp.glow, lx - size / 2, ly - size / 2, size, size);
      // anamorphic streak and a ghost across the lens
      const sw = size * 2.2;
      ctx.globalAlpha = 0.4 * flick;
      ctx.drawImage(sp.streak, lx - sw / 2, ly - size * 0.06, sw, size * 0.12);
      if (lx > 0 && lx < W && ly > 0 && ly < H) {
        const cx = W / 2; const cy = H / 2;
        ctx.globalAlpha = 0.055;
        for (const k of [0.45, 1.25, 1.7]) {
          const gs = size * (0.18 + k * 0.16);
          ctx.drawImage(sp.warm, lx + (cx - lx) * k * 1.2 - gs / 2, ly + (cy - ly) * k * 1.2 - gs / 2, gs, gs);
        }
      }
    }
    ctx.globalAlpha = 1;
    // lamps along the rim of the far stand
    for (let k = 0; k < 9; k += 1) {
      const x = lerp(AX0 + CHAMFER + 3, AX1 - CHAMFER - 3, k / 8);
      if (!cam.project(x, STAND_H + RIM_H, AZ0 - STAND_D)) continue;
      const s = clamp(cam.ss * 7, 6, H * 0.14);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(sp.glow, cam.sx - s / 2, cam.sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  /** Focus lines that race in from the edges toward whoever has the ball. Drawn additively. */
  private drawSpeedLines(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const W = this.W;
    const H = this.H;
    const a = this.speedLines;
    let cx = W / 2;
    let cy = H / 2;
    if (cam.project(this.bx, this.by + 0.5, this.bz)) {
      cx = clamp(cam.sx, W * 0.15, W * 0.85);
      cy = clamp(cam.sy, H * 0.2, H * 0.8);
    }
    const tick = Math.floor(this.clock * 16);
    const far = Math.hypot(W, H);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 26; i += 1) {
      const h1 = hash(i * 7.3 + tick * 3.1);
      const h2 = hash(i * 3.7 + tick * 5.9);
      const ang = (i / 26) * TAU + h1 * 0.2;
      // fewer lines above and below: the run is mostly sideways
      if (Math.abs(Math.sin(ang)) > 0.86 && h2 < 0.6) continue;
      const r0 = Math.min(W, H) * (0.34 + 0.22 * h2);
      const wdt = 0.006 + 0.012 * h1;
      const c0 = Math.cos(ang);
      const s0 = Math.sin(ang);
      ctx.globalAlpha = a * (0.1 + 0.16 * h2);
      ctx.beginPath();
      ctx.moveTo(cx + c0 * r0, cy + s0 * r0 * 0.8);
      ctx.lineTo(cx + Math.cos(ang - wdt) * far, cy + Math.sin(ang - wdt) * far);
      ctx.lineTo(cx + Math.cos(ang + wdt) * far, cy + Math.sin(ang + wdt) * far);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ chalk preview

  private buildChalk(pick: Pick, side: 'off' | 'def', playerTeam: 0 | 1, stars: number[]): void {
    const o = this.offense;
    const d = (1 - o) as 0 | 1;
    const X = (u: number): number => worldX(o, u);
    const los = this.los;
    const f = formation(los);
    const lines: ChalkLine[] = [];
    const zones: ChalkZone[] = [];
    const sp = pick.special;
    const base = sp ? KIND[sp.kind].base : pick.type;
    const n = this.sceneN + 1;
    const at = (team: 0 | 1, id: number, fallback: [number, number]): [number, number] => {
      const ac = this.find(team, id);
      return ac ? [ac.hasGoal ? ac.goalX : ac.x, ac.hasGoal ? ac.goalZ : ac.z] : [X(fallback[0]), fallback[1]];
    };
    const O = this.teams[o];
    const D = this.teams[d];
    const path = (way: [number, number][], opt: Partial<ChalkLine> & { arc?: number } = {}): void => {
      lines.push({
        pts: resample(way, opt.arc ?? 0),
        dashed: opt.dashed ?? false, arrow: opt.arrow ?? true, delay: opt.delay ?? 0, width: (opt.width ?? 0.3) * 1.3, alpha: opt.alpha ?? 0.95,
        mark: opt.mark === undefined ? (opt.dashed ? 'ball' : 'run') : opt.mark,
      });
    };
    if (side === 'off') {
      const type = base as OffType;
      const qb = at(o, O.lineup.off.QB, f.off.QB);
      const rb = at(o, O.lineup.off.RB, f.off.RB);
      if (isKick(pick.type)) {
        // a kick: the ball's flight, from the spot it is kicked from
        const spot: [number, number] = [X(los - (pick.type === 'punt' ? 8 : 5.8)), 12];
        const goal = FIELD + END;
        if (pick.type === 'punt') path([spot, [X(Math.min(los + 28, goal - 1)), 12]], { dashed: true, width: 0.26, arc: 5, mark: 'ball' });
        else {
          path([spot, [X(goal), 12]], { dashed: true, width: 0.26, arc: 3.4, mark: 'ball' });
          // the uprights it has to pass between
          path([[X(goal), 12 - 3.2], [X(goal), 12 + 3.2]], { arrow: false, width: 0.3, mark: null });
        }
        path([[spot[0] - (X(1) - X(0)) * 2.6, 11], spot], { width: 0.26, delay: 0.05 });
      } else if (type === 'inside') {
        const lane = 12 + ((n % 3) - 1) * 0.8;
        path([rb, [X(los - 4.6), 12.2], [X(los - 0.8), lane], [X(los + 7.5), lane]], { width: 0.36 });
        for (const p of ['OL1', 'OL2'] as const) {
          const a = at(o, O.lineup.off[p], f.off[p]);
          path([a, [a[0] + (X(1) - X(0)) * 2.4, a[1] + (a[1] < 12 ? -1.1 : 1.1)]], { delay: 0.12, width: 0.24, alpha: 0.7 });
        }
      } else if (type === 'outside') {
        const lane = n % 2 ? 4.4 : 19.6;
        path([rb, [X(los - 7.7), lerp(12.8, lane, 0.3)], [X(los - 5.6), lerp(12.8, lane, 0.8)], [X(los - 3), lane], [X(los + 9), lane + (lane < 12 ? 0.9 : -0.9)]], { width: 0.36 });
        const wr = lane < 12 ? 'WR1' : 'WR2';
        const a = at(o, O.lineup.off[wr], f.off[wr]);
        path([a, [a[0] + (X(1) - X(0)) * 3.5, a[1] + (lane < 12 ? 1.2 : -1.2)]], { delay: 0.15, width: 0.24, alpha: 0.7 });
      } else {
        const long = type === 'long';
        const drop: [number, number] = [X(long ? los - 8.6 : los - 7.2), 12];
        path([qb, drop], { width: 0.22, alpha: 0.65, arrow: false });
        (['WR1', 'WR2'] as const).forEach((p, i) => {
          const a = at(o, O.lineup.off[p], f.off[p]);
          const inward = f.off[p][1] < 12 ? 1 : -1;
          const depth = long ? 20 : 5.5;
          const rv = f.off[p][1] + inward * (long ? 1.7 : 3.8);
          const spot: [number, number] = [X(los + depth), rv];
          if (long) path([a, [X(los + depth * 0.55), f.off[p][1] + inward * 0.3], spot], { delay: 0.05 + i * 0.08, width: 0.32 });
          else path([a, [X(los + depth * 0.62), f.off[p][1]], spot], { delay: 0.05 + i * 0.08, width: 0.32 });
          path([drop, spot], { dashed: true, delay: 0.3 + i * 0.1, width: 0.15, alpha: 0.75, arc: long ? 2.8 : 1.1, arrow: false });
        });
      }
    } else {
      const call = base as DefType;
      // zones are measured from the line of scrimmage toward the defense's own goal
      const zone = (u0: number, u1: number, z0: number, z1: number, delay = 0): void => {
        const a = X(Math.min(los + u0, FIELD + END - 0.3));
        const b = X(Math.min(los + u1, FIELD + END - 0.3));
        if (Math.abs(a - b) < 1) return;
        zones.push({ x0: Math.min(a, b), x1: Math.max(a, b), z0, z1, delay });
      };
      // who goes where: a thin line from each defender who matters to the spot the call sends them to
      const send = (p: 'DL1' | 'DL2' | 'LB' | 'CB1' | 'CB2' | 'S', u: number, z: number, i: number): void => {
        const a = at(d, D.lineup.def[p], f.def[p]);
        path([a, [X(Math.min(los + u, FIELD + END - 1)), z]], { delay: 0.15 + i * 0.07, width: 0.24, alpha: 0.85 });
      };
      const near = (p: 'CB1' | 'CB2'): boolean => f.def[p][1] < 12;
      if (call === 'stuff') {
        zone(0.3, 7, 7, 17);
        send('DL1', 1.2, 10.6, 0);
        send('DL2', 1.2, 13.4, 1);
        send('LB', 2.6, 12, 2);
      } else if (call === 'contain') {
        zone(-1, 9, 0.3, 5.6);
        zone(-1, 9, 18.4, 23.7, 0.12);
        send('CB1', 2.4, near('CB1') ? 3 : 21, 0);
        send('CB2', 2.4, near('CB2') ? 3 : 21, 1);
        send('LB', 3.4, (n % 2 ? 6.5 : 17.5), 2);
      } else if (call === 'zone') {
        zone(2.4, 9.2, 1, 23);
        send('CB1', 5.6, near('CB1') ? 5 : 19, 0);
        send('CB2', 5.6, near('CB2') ? 5 : 19, 1);
        send('LB', 5.6, 12, 2);
      } else if (call === 'deep') {
        zone(12, 24, 1, 23);
        send('S', 19, 12, 0);
        send('CB1', 15, near('CB1') ? 4.6 : 19.4, 1);
        send('CB2', 15, near('CB2') ? 4.6 : 19.4, 2);
      } else {
        const qb = at(o, O.lineup.off.QB, f.off.QB);
        (['DL1', 'DL2', 'LB', 'CB1', 'CB2'] as const).forEach((p, i) => {
          const a = at(d, D.lineup.def[p], f.def[p]);
          const bend: [number, number] = [lerp(a[0], qb[0], 0.55), lerp(a[1], qb[1], p === 'LB' ? 0.3 : 0.75) + (p === 'LB' ? 1.6 : 0)];
          path([a, bend, [qb[0] + (X(1) - X(0)) * 1.2, qb[1] + (a[1] - 12) * 0.08]], { delay: i * 0.06, width: i < 3 ? 0.34 : 0.24, alpha: i < 3 ? 0.92 : 0.7 });
        });
      }
    }
    const owner = sp ? { team: KIND[sp.kind].side === 'off' ? o : d, id: sp.owner } : null;
    for (const ac of this.actors) ac.aura = (!!owner && ac.team === owner.team && ac.id === owner.id) || (ac.team === playerTeam && stars.includes(ac.id));
    this.chalk = { lines, zones, t0: this.clock, tint: mix([250, 252, 246], this.col[playerTeam], 0.14), owner };
  }

  /** `k` < 1: the faint pass over the heroes (routes only). */
  private drawChalk(k: number): void {
    const ch = this.chalk;
    if (!ch) return;
    const over = k < 1;
    const ctx = this.ctx;
    const cam = this.cam;
    const px = this.dpr;
    const t = this.clock - ch.t0;
    const pulse = 0.86 + 0.14 * Math.sin(this.clock * 3.4);
    const col = ch.tint;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // zones: a wash, hatching that draws itself, a dashed outline
    for (const z of ch.zones) {
      const r = easeOut((t - z.delay) / 0.55);
      if (r <= 0 || over) continue;
      const quad = [z.x0, 0.03, z.z0, z.x1, 0.03, z.z0, z.x1, 0.03, z.z1, z.x0, 0.03, z.z1];
      this.fillPoly(quad, css(col, 0.13 * r * pulse));
      const span = z.x1 - z.x0 + (z.z1 - z.z0);
      const step = 1.25;
      const total = Math.floor(span / step);
      const shown = Math.floor(total * r);
      ctx.strokeStyle = css(col, 0.5 * pulse);
      for (let k = 1; k <= shown; k += 1) {
        // a diagonal x + z = const, cut to the box
        const s = k * step;
        let xa = z.x0 + s; let za = z.z0;
        if (xa > z.x1) { za += xa - z.x1; xa = z.x1; }
        let xb = z.x0; let zb = z.z0 + s;
        if (zb > z.z1) { xb += zb - z.z1; zb = z.z1; }
        if (!cam.project(xa, 0.03, za)) continue;
        const ax = cam.sx; const ay = cam.sy;
        if (!cam.project(xb, 0.03, zb)) continue;
        ctx.lineWidth = Math.max(1.2 * px, cam.ss * 0.13);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(cam.sx, cam.sy);
        ctx.stroke();
      }
      const n = cam.poly(quad);
      if (n >= 3) {
        ctx.strokeStyle = css(col, 0.85 * r * pulse);
        ctx.lineWidth = Math.max(1.6 * px, 0.2 * cam.f / 45);
        ctx.setLineDash([9 * px, 6 * px]);
        ctx.lineDashOffset = -this.clock * 14 * px;
        ctx.beginPath();
        ctx.moveTo(cam.out[0]!, cam.out[1]!);
        for (let i = 1; i < n; i += 1) ctx.lineTo(cam.out[i * 2]!, cam.out[i * 2 + 1]!);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // routes
    for (const ln of ch.lines) {
      const r = easeOut((t - ln.delay) / 0.5);
      if (r <= 0) continue;
      const n = ln.pts.length / 3;
      const shown = Math.max(2, Math.floor(n * r));
      // one path per route, so the stroke has an even weight
      let started = false;
      let w = 0;
      ctx.beginPath();
      for (let i = 0; i < shown; i += 1) {
        if (!cam.project(ln.pts[i * 3]!, ln.pts[i * 3 + 1]! + 0.03, ln.pts[i * 3 + 2]!)) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(cam.sx, cam.sy);
        else ctx.moveTo(cam.sx, cam.sy);
        started = true;
        if (i === shown >> 1) w = Math.max(1.8 * px, cam.ss * ln.width);
      }
      if (w <= 0) w = 2 * px;
      if (ln.dashed) {
        ctx.setLineDash([w * 2.6, w * 2.2]);
        ctx.lineDashOffset = -this.clock * w * 9;
      }
      if (!over) {
        ctx.strokeStyle = `rgba(4,22,16,${0.3 * ln.alpha})`;
        ctx.lineWidth = w * 1.9;
        ctx.stroke();
      }
      ctx.strokeStyle = css(col, ln.alpha * pulse * (over && ln.dashed ? 0.2 : k));
      ctx.lineWidth = w;
      ctx.stroke();
      if (!ln.dashed && !over) {
        // a broken, thinner pass a little off-line gives the stroke a chalky edge
        ctx.setLineDash([w * 1.3, w * 2.1]);
        ctx.strokeStyle = css(col, 0.3);
        ctx.lineWidth = w * 0.4;
        ctx.translate(w * 0.55, -w * 0.45);
        ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.setLineDash([]);
      // chalk dust at the tip while the line is still being drawn
      if (!over && r < 0.98 && Math.random() < 0.35) {
        const i = shown - 1;
        const p = this.fx.spawn(PUFF, ln.pts[i * 3]!, ln.pts[i * 3 + 1]! + 0.2, ln.pts[i * 3 + 2]!);
        p.tex = 1;
        p.vy = 0.8;
        p.max = 0.35;
        p.size = 0.25;
        p.grow = 1;
        p.alpha = 0.5;
      }
      // the play runs itself, over and over: a ring travels each route, the ball flies its line
      if (!over && ln.mark && n >= 3) {
        const LOOP = 2.3;
        const tt = t - 0.75;
        const ph = tt < 0 ? -1 : ((tt % LOOP) - ln.delay * 2.4) / (ln.mark === 'ball' ? 0.55 : 1.15);
        if (ph >= 0 && ph <= 1.25) {
          const u = Math.min(1, ph);
          const fi = u * (n - 1);
          const i0 = Math.min(n - 2, Math.floor(fi));
          const fr = fi - i0;
          const mx = lerp(ln.pts[i0 * 3]!, ln.pts[(i0 + 1) * 3]!, fr);
          const my = lerp(ln.pts[i0 * 3 + 1]!, ln.pts[(i0 + 1) * 3 + 1]!, fr);
          const mz = lerp(ln.pts[i0 * 3 + 2]!, ln.pts[(i0 + 1) * 3 + 2]!, fr);
          const fade = ph > 1 ? 1 - (ph - 1) / 0.25 : Math.min(1, ph / 0.08);
          if (cam.project(mx, my + (ln.mark === 'ball' ? 0.25 : 0.05), mz)) {
            const rad = Math.max(3 * px, cam.ss * (ln.mark === 'ball' ? 0.3 : 0.55));
            ctx.globalAlpha = fade;
            if (ln.mark === 'ball') {
              ctx.fillStyle = '#8a4a1c';
              ctx.strokeStyle = '#fffbe8';
              ctx.lineWidth = Math.max(1.2 * px, rad * 0.25);
              ctx.beginPath();
              ctx.ellipse(cam.sx, cam.sy, rad * 1.5, rad, -0.4, 0, TAU);
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.strokeStyle = 'rgba(4,22,16,0.55)';
              ctx.lineWidth = Math.max(3 * px, rad * 0.5);
              ctx.beginPath();
              ctx.ellipse(cam.sx, cam.sy, rad * 1.5, rad * 0.62, 0, 0, TAU);
              ctx.stroke();
              ctx.strokeStyle = css(col, 1);
              ctx.fillStyle = css(col, 0.35);
              ctx.lineWidth = Math.max(1.6 * px, rad * 0.26);
              ctx.fill();
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
        }
      }
      if (ln.arrow && r > 0.9 && shown >= 3) {
        const i = n - 1;
        const x = ln.pts[i * 3]!; const z = ln.pts[i * 3 + 2]!;
        let dx = x - ln.pts[(i - 2) * 3]!; let dz = z - ln.pts[(i - 2) * 3 + 2]!;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        const s = ln.width * 3.8;
        this.fillPoly([
          x + dx * s * 1.25, 0.03, z + dz * s * 1.25,
          x - dz * s * 0.85, 0.03, z + dx * s * 0.85,
          x + dz * s * 0.85, 0.03, z - dx * s * 0.85,
        ], css(col, ln.alpha * pulse * k * sat((r - 0.9) / 0.1)));
      }
    }
  }
}

