// Everything the stadium pre-renders once: the painted turf, the pixel crowd, the LED ribbon,
// soft light sprites and the lit / silhouette versions of each hero sprite.

import { hero } from '../../game/heroes';
import { FIELD, type TeamSheet } from '../../game/match';
import { TAU, css, hash, lerp, luma, mix, rgbOf, scale, seeded, type RGB } from './math';

export const WIDTH = 24;
export const END = 5;

export const DISPLAY_FONT = '"Dela Gothic One", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
export const PIXEL_FONT = '"DotGothic16", "MS Gothic", monospace';

export type Tex = HTMLCanvasElement;

export function makeCanvas(w: number, h: number): Tex {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// ------------------------------------------------------------------ turf

/** texels per yard of the soft turf overlay (grass flecks, wear, light) */
export const PPY = 20;
/** texels per yard of the sharp paint (numbers, names, emblem) */
const DPY = 30;
export const FIELD_PAD = 1.5;
export const FX0 = -END - FIELD_PAD;
export const FX1 = FIELD + END + FIELD_PAD;
export const FZ0 = -FIELD_PAD;
export const FZ1 = WIDTH + FIELD_PAD;

const NAVY: RGB = [10, 18, 40];
export const CHALK = 'rgba(246,249,242,0.92)';
/** the two greens of the mowed bands */
export const BANDS = ['#22895a', '#1b7048'] as const;
/** the apron around the field */
export const SURROUND = '#10402f';

/** The colour a team's end zone is painted in: its colour, calmed down for the night picture. */
export function zoneColor(color: string): RGB {
  const c = rgbOf(color);
  return mix(scale(c, 0.78), NAVY, 0.28);
}

/** A piece of paint on the turf: a texture and the world quad it lies on (top-left, top-right, bottom-left, bottom-right). */
export interface Decal { tex: Tex; quad: Float64Array }

export interface FieldArt {
  /** translucent and faint (flecks, sheen, wear, hash marks): drawn over flat bands with a loose fit */
  overlay: Tex;
  decals: Decal[];
}

function decal(x0: number, z0: number, x1: number, z1: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): Decal {
  const c = makeCanvas((x1 - x0) * DPY, (z1 - z0) * DPY);
  const g = c.getContext('2d')!;
  paint(g, c.width, c.height);
  return { tex: c, quad: Float64Array.from([x0, 0.005, z0, x1, 0.005, z0, x0, 0.005, z1, x1, 0.005, z1]) };
}

/**
 * The turf is drawn in layers so that sharp things stay sharp at any camera angle:
 * flat bands and long lines as polygons (by the renderer), this soft overlay, and small sharp decals.
 */
export function bakeField(teams: [TeamSheet, TeamSheet]): FieldArt {
  const c = makeCanvas((FX1 - FX0) * PPY, (FZ1 - FZ0) * PPY);
  const g = c.getContext('2d')!;
  const X = (x: number): number => (x - FX0) * PPY;
  const Z = (z: number): number => (z - FZ0) * PPY;
  const rnd = seeded(77);

  // each band has a soft sheen, as if mowed in alternating directions
  for (let i = 0; i < FIELD / 5; i += 1) {
    const sheen = g.createLinearGradient(X(i * 5), 0, X(i * 5 + 5), 0);
    sheen.addColorStop(i % 2 ? 0 : 1, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(i % 2 ? 1 : 0, 'rgba(0,0,0,0.06)');
    g.fillStyle = sheen;
    g.fillRect(X(i * 5), Z(0), 5 * PPY, WIDTH * PPY);
  }
  // tone-on-tone diagonal stripes in the end zones
  const stripes = (x0: number, team: TeamSheet): void => {
    const col = zoneColor(team.color);
    g.save();
    g.beginPath();
    g.rect(X(x0), Z(0), END * PPY, WIDTH * PPY);
    g.clip();
    g.strokeStyle = luma(col) > 0.55 ? 'rgba(10,20,50,0.10)' : 'rgba(255,255,255,0.09)';
    g.lineWidth = PPY * 0.9;
    for (let k = -WIDTH; k < WIDTH + END * 2; k += 3.2) {
      g.beginPath();
      g.moveTo(X(x0) - PPY, Z(k));
      g.lineTo(X(x0 + END) + PPY, Z(k - END - 2));
      g.stroke();
    }
    g.restore();
  };
  stripes(-END, teams[0]);
  stripes(FIELD, teams[1]);
  // blades of grass: thousands of faint flecks
  for (let i = 0; i < 14000; i += 1) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const l = 1.5 + rnd() * 4;
    g.fillStyle = rnd() < 0.5 ? `rgba(255,255,210,${0.025 + rnd() * 0.05})` : `rgba(0,20,10,${0.04 + rnd() * 0.07})`;
    g.fillRect(x, y, 1, l);
  }
  // a little wear between the hash marks
  for (let i = 0; i < 26; i += 1) {
    const x = X(4 + rnd() * (FIELD - 8));
    const y = Z(8 + rnd() * 8);
    const r = PPY * (1 + rnd() * 2.2);
    const w = g.createRadialGradient(x, y, 0, x, y, r);
    w.addColorStop(0, 'rgba(60,70,30,0.12)');
    w.addColorStop(1, 'rgba(60,70,30,0)');
    g.fillStyle = w;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // hash marks every yard
  g.fillStyle = 'rgba(246,249,242,0.7)';
  for (let yd = 1; yd < FIELD; yd += 1) {
    if (yd % 5 === 0) continue;
    for (const z of [0.15, 8.2, 15.1, 23.15]) g.fillRect(X(yd - 0.06), Z(z), 0.12 * PPY, 0.7 * PPY);
  }
  const decals: Decal[] = [];

  // the team's short name in its end zone, read from the field
  const name = (x0: number, team: TeamSheet, flip: boolean): Decal => decal(x0 + 0.4, 1.5, x0 + END - 0.4, WIDTH - 1.5, (d, w, h) => {
    const col = zoneColor(team.color);
    d.translate(w / 2, h / 2);
    d.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    d.font = `${Math.round(DPY * 3.1)}px ${DISPLAY_FONT}`;
    d.textAlign = 'center';
    d.textBaseline = 'middle';
    const light = luma(col) > 0.55;
    const chars = [...team.short];
    const step = Math.min(DPY * 5.2, (h * 0.86) / Math.max(1, chars.length));
    chars.forEach((ch, i) => {
      const x = (i - (chars.length - 1) / 2) * step;
      d.lineJoin = 'round';
      d.lineWidth = DPY * 0.34;
      d.strokeStyle = light ? 'rgba(255,255,255,0.75)' : 'rgba(8,14,34,0.55)';
      d.strokeText(ch, x, DPY * 0.1);
      d.fillStyle = light ? 'rgba(20,32,70,0.92)' : 'rgba(246,248,255,0.94)';
      d.fillText(ch, x, DPY * 0.1);
    });
  });
  decals.push(name(-END, teams[0], false), name(FIELD, teams[1], true));

  // centre-field emblem: an original mark (ring, hexagon, two chevrons and a coin)
  const ER = 4.3;
  decals.push(decal(FIELD / 2 - ER - 0.3, WIDTH / 2 - ER - 0.3, FIELD / 2 + ER + 0.3, WIDTH / 2 + ER + 0.3, (d, w, h) => {
    const R = DPY * ER;
    const tint = mix(rgbOf(teams[0].color), [255, 255, 255], 0.35);
    d.translate(w / 2, h / 2);
    d.fillStyle = 'rgba(8,30,24,0.28)';
    d.beginPath();
    d.arc(0, 0, R, 0, TAU);
    d.fill();
    d.strokeStyle = 'rgba(244,248,240,0.82)';
    d.lineWidth = DPY * 0.3;
    d.beginPath();
    d.arc(0, 0, R, 0, TAU);
    d.stroke();
    d.lineWidth = DPY * 0.16;
    d.beginPath();
    d.arc(0, 0, R * 0.88, 0, TAU);
    d.stroke();
    d.fillStyle = css(tint, 0.26);
    d.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      d.lineTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74);
    }
    d.closePath();
    d.fill();
    d.lineWidth = DPY * 0.2;
    d.stroke();
    // chevrons pointing at the two goals
    d.fillStyle = 'rgba(244,248,240,0.88)';
    for (const sgn of [-1, 1]) {
      d.beginPath();
      d.moveTo(sgn * R * 0.58, 0);
      d.lineTo(sgn * R * 0.2, -R * 0.4);
      d.lineTo(sgn * R * 0.2, -R * 0.2);
      d.lineTo(sgn * R * 0.38, 0);
      d.lineTo(sgn * R * 0.2, R * 0.2);
      d.lineTo(sgn * R * 0.2, R * 0.4);
      d.closePath();
      d.fill();
    }
    d.beginPath();
    d.arc(0, 0, R * 0.15, 0, TAU);
    d.fill();
    d.fillStyle = css(scale(tint, 0.6), 0.9);
    d.beginPath();
    d.arc(0, 0, R * 0.075, 0, TAU);
    d.fill();
  }));

  // yard numbers, split around their line, with a small arrow toward the nearer goal
  for (let yd = 10; yd < FIELD; yd += 10) {
    const label = String(Math.min(yd, FIELD - yd));
    for (const z of [4.9, 19.1]) {
      decals.push(decal(yd - 3.6, z - 1.7, yd + 3.6, z + 1.7, (d, w, h) => {
        d.textBaseline = 'middle';
        d.fillStyle = 'rgba(246,249,242,0.88)';
        d.font = `${Math.round(DPY * 2.7)}px ${DISPLAY_FONT}`;
        d.textAlign = 'right';
        d.fillText(label[0]!, w / 2 - 0.32 * DPY, h / 2);
        d.textAlign = 'left';
        d.fillText(label[1] ?? '', w / 2 + 0.32 * DPY, h / 2);
        if (yd !== FIELD / 2) {
          const sgn = yd < FIELD / 2 ? -1 : 1;
          const ax = w / 2 + sgn * 2.8 * DPY;
          d.beginPath();
          d.moveTo(ax + sgn * DPY * 0.55, h / 2 - 0.75 * DPY);
          d.lineTo(ax, h / 2 - 1.05 * DPY);
          d.lineTo(ax, h / 2 - 0.45 * DPY);
          d.closePath();
          d.fill();
        }
      }));
    }
  }
  return { overlay: c, decals };
}

// ------------------------------------------------------------------ crowd

export const CROWD_COLS = 96;
export const CROWD_ROWS = 30;
const CELL_W = 6;
const CELL_H = 7;

const NEUTRAL: RGB[] = [
  [58, 70, 110], [92, 98, 120], [120, 60, 72], [50, 104, 110], [150, 140, 120], [70, 60, 100], [110, 110, 130], [40, 52, 86],
];
const SKIN: RGB[] = [[236, 196, 160], [214, 168, 130], [180, 132, 100], [246, 214, 184]];

/**
 * One frame of the crowd. People keep their seat and shirt across frames; which third of them
 * is bobbing changes with `frame`. `hot` adds raised arms and glow sticks.
 */
export function bakeCrowd(teams: [TeamSheet, TeamSheet], frame: number, hot: boolean): Tex {
  const c = makeCanvas(CROWD_COLS * CELL_W, CROWD_ROWS * CELL_H);
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1124';
  g.fillRect(0, 0, c.width, c.height);
  const cols: [RGB, RGB] = [rgbOf(teams[0].color), rgbOf(teams[1].color)];
  for (let row = 0; row < CROWD_ROWS; row += 1) {
    // lower rows catch more of the light from the field
    const lf = lerp(0.42, 0.95, (row / (CROWD_ROWS - 1)) ** 0.8);
    const y0 = row * CELL_H;
    g.fillStyle = `rgba(30,40,74,${0.5 * lf})`;
    g.fillRect(0, y0 + CELL_H - 1, c.width, 1);
    if (row === 13) {
      // a walkway with a rail
      g.fillStyle = '#141c36';
      g.fillRect(0, y0, c.width, CELL_H);
      g.fillStyle = 'rgba(150,170,220,0.25)';
      g.fillRect(0, y0 + 1, c.width, 1);
      continue;
    }
    for (let col = 0; col < CROWD_COLS; col += 1) {
      const x0 = col * CELL_W;
      const id = row * 131 + col * 17;
      if (col % 16 === 15) {
        // stairs
        g.fillStyle = css(scale([44, 54, 88], lf));
        g.fillRect(x0 + 1, y0, CELL_W - 2, CELL_H);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x0 + 1, y0 + 3, CELL_W - 2, 1);
        continue;
      }
      const r1 = hash(id + 1.3);
      const r2 = hash(id + 7.7);
      const r3 = hash(id + 19.1);
      if (r1 < 0.05) {
        g.fillStyle = css(scale([26, 34, 62], lf));
        g.fillRect(x0 + 1, y0 + 3, 4, 3);
        continue;
      }
      const u = col / (CROWD_COLS - 1);
      const side = u < 0.5 ? 0 : 1;
      const fan = 0.3 + 0.5 * Math.abs(u - 0.5) * 2;
      let shirt: RGB;
      if (r2 < fan) shirt = scale(cols[side], 0.5 + 0.38 * r3);
      else shirt = NEUTRAL[Math.floor(r3 * NEUTRAL.length)]!;
      // calmer than the players in front of it
      shirt = mix(scale(shirt, lf * 0.82), [16, 24, 52], 0.16);
      const skin = scale(SKIN[Math.floor(hash(id + 3.1) * SKIN.length)]!, lf * 0.92);
      const turn = Math.floor(hash(id + 5.5) * 3);
      const up = turn === frame % 3;
      const dy = up ? -1 : 0;
      g.fillStyle = css(shirt);
      g.fillRect(x0 + 1, y0 + 3 + dy, 4, 4 - dy);
      g.fillStyle = css(skin);
      g.fillRect(x0 + 2, y0 + 1 + dy, 2, 2);
      if (hash(id + 9.9) < 0.45) {
        g.fillStyle = css(scale([40, 30, 34], lf));
        g.fillRect(x0 + 2, y0 + dy, 2, 1);
      }
      if (hot && (turn + frame) % 3 !== 1) {
        // arms in the air
        g.fillStyle = css(skin);
        g.fillRect(x0 + 1, y0 + dy, 1, 3);
        g.fillRect(x0 + 4, y0 + dy, 1, 3);
        if (hash(id + 11.3) < 0.22) {
          g.fillStyle = r2 < fan ? css(mix(cols[side], [255, 255, 255], 0.45)) : '#f4f6ff';
          g.fillRect(x0 + (hash(id + 2.2) < 0.5 ? 1 : 4), y0 + dy - 1 < 0 ? 0 : y0 + dy - 1, 1, 2);
        }
      }
    }
  }
  return c;
}

// ------------------------------------------------------------------ LED ribbon

export interface Ribbon {
  tex: Tex;
  /** width of one repeat of the message, in texels */
  period: number;
}

export const RIBBON_H = 20;
/** texels of ribbon per yard of wall */
export const RIBBON_PPY = 7;
/** the longest stretch of wall drawn in one piece, in yards */
export const RIBBON_MAX_YD = 70;

/** `around`: texels all the way around the bowl; the message is spaced to repeat a whole number of times in it. */
export function bakeRibbon(around: number, parts: { text: string; color: string }[], bg = '#05070f'): Ribbon {
  const probe = makeCanvas(4, 4).getContext('2d')!;
  probe.font = `16px ${PIXEL_FONT}`;
  const widths = parts.map((p) => Math.ceil(probe.measureText(p.text).width));
  const natural = Math.max(120, widths.reduce((a, b) => a + b + 34, 0));
  const period = around / Math.max(1, Math.floor(around / natural));
  const gap = 34 + (period - natural) / parts.length;
  const total = Math.ceil(period + RIBBON_MAX_YD * RIBBON_PPY + 4);
  const c = makeCanvas(total, RIBBON_H);
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, total, RIBBON_H);
  g.font = `16px ${PIXEL_FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  for (let x0 = 0; x0 < total; x0 += period) {
    let x = x0 + gap / 2;
    parts.forEach((p, i) => {
      g.fillStyle = p.color;
      g.fillText(p.text, Math.round(x), RIBBON_H / 2 + 1);
      // a separator diamond
      const dx = Math.round(x + widths[i]! + gap / 2);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(dx - 2, RIBBON_H / 2 - 1, 3, 3);
      x += widths[i]! + gap;
    });
  }
  // LED rows and a frame
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 3; y < RIBBON_H - 2; y += 2) g.fillRect(0, y, total, 1);
  g.fillStyle = 'rgba(120,150,255,0.35)';
  g.fillRect(0, 0, total, 1);
  g.fillRect(0, RIBBON_H - 1, total, 1);
  return { tex: c, period };
}

/** A team colour made bright enough to read as an LED. */
export function ledColor(color: string): string {
  const c = rgbOf(color);
  const l = luma(c);
  return css(l < 0.45 ? mix(c, [255, 255, 255], 0.45) : mix(c, [255, 255, 255], 0.12));
}

// ------------------------------------------------------------------ light sprites

function radial(size: number, stops: [number, string][]): Tex {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

export interface Sprites {
  glow: Tex;
  warm: Tex;
  streak: Tex;
  dust: Tex;
  chalk: Tex;
  star: Tex;
  teamGlow: [Tex, Tex];
}

export function bakeSprites(teams: [TeamSheet, TeamSheet]): Sprites {
  const glow = radial(128, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,252,240,0.85)'], [0.3, 'rgba(230,236,255,0.28)'], [0.6, 'rgba(170,190,255,0.08)'], [1, 'rgba(150,170,255,0)']]);
  const warm = radial(96, [[0, 'rgba(255,246,214,0.9)'], [0.35, 'rgba(255,214,140,0.3)'], [1, 'rgba(255,190,90,0)']]);
  const dust = radial(48, [[0, 'rgba(214,206,170,0.85)'], [0.5, 'rgba(190,186,150,0.4)'], [1, 'rgba(170,170,140,0)']]);
  const chalk = radial(48, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(244,248,255,0.4)'], [1, 'rgba(240,244,255,0)']]);
  // anamorphic streak
  const streak = makeCanvas(256, 32);
  {
    const g = streak.getContext('2d')!;
    g.translate(128, 16);
    g.scale(1, 0.1);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(210,225,255,0.95)');
    gr.addColorStop(0.25, 'rgba(150,180,255,0.35)');
    gr.addColorStop(1, 'rgba(120,150,255,0)');
    g.fillStyle = gr;
    g.fillRect(-128, -160, 256, 320);
  }
  // four-point sparkle
  const star = makeCanvas(32, 32);
  {
    const g = star.getContext('2d')!;
    g.translate(16, 16);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    for (let i = 0; i < 2; i += 1) {
      g.beginPath();
      g.moveTo(-16, 0);
      g.quadraticCurveTo(0, -1.6, 16, 0);
      g.quadraticCurveTo(0, 1.6, -16, 0);
      g.fill();
      g.rotate(Math.PI / 2);
    }
    g.beginPath();
    g.arc(0, 0, 3.2, 0, TAU);
    g.fill();
  }
  const teamGlow = teams.map((t) => {
    const c = mix(rgbOf(t.color), [255, 255, 255], 0.2);
    return radial(96, [[0, css(mix(c, [255, 255, 255], 0.6), 0.95)], [0.3, css(c, 0.5)], [0.65, css(c, 0.14)], [1, css(c, 0)]]);
  }) as [Tex, Tex];
  return { glow, warm, streak, dust, chalk, star, teamGlow };
}

// ------------------------------------------------------------------ hero art

export const ART = 64;
export const ART_PAD = 2;

export interface HeroArt {
  img: HTMLImageElement;
  ready: boolean;
  /** outlined and rim-lit sprite, ART + 2 * ART_PAD square */
  lit: Tex | null;
  white: Tex | null;
  dark: Tex | null;
  /** row just below the lowest opaque pixel */
  foot: number;
  /** first row with an opaque pixel */
  top: number;
  /** tinted silhouettes by colour */
  tints: Map<string, Tex>;
}

const arts = new Map<number, HeroArt>();

function silhouette(img: CanvasImageSource, color: string): Tex {
  const c = makeCanvas(ART, ART);
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, ART, ART);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, ART, ART);
  return c;
}

function finish(a: HeroArt): void {
  const img = a.img;
  if (!img.naturalWidth) return;
  try {
    const dark = silhouette(img, '#070b1c');
    const white = silhouette(img, '#ffffff');
    const size = ART + ART_PAD * 2;
    const lit = makeCanvas(size, size);
    const g = lit.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // a dark outline keeps the sprite readable on the bright turf
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      g.drawImage(dark, ART_PAD + dx, ART_PAD + dy);
    }
    // floodlight rim from above
    g.globalAlpha = 0.7;
    g.drawImage(white, ART_PAD, ART_PAD - 1);
    g.globalAlpha = 1;
    g.drawImage(img, ART_PAD, ART_PAD, ART, ART);
    // find the feet
    let foot = ART;
    let top = 0;
    try {
      const data = white.getContext('2d')!.getImageData(0, 0, ART, ART).data;
      const solid = (y: number): boolean => {
        for (let x = 0; x < ART; x += 1) if (data[(y * ART + x) * 4 + 3]! > 40) return true;
        return false;
      };
      for (let y = ART - 1; y >= 0; y -= 1) {
        if (solid(y)) {
          foot = y + 1;
          break;
        }
      }
      for (let y = 0; y < foot; y += 1) {
        if (solid(y)) {
          top = y;
          break;
        }
      }
    } catch {
      foot = ART - 1;
    }
    a.dark = dark;
    a.white = white;
    a.lit = lit;
    a.foot = foot;
    a.top = top;
    a.ready = true;
  } catch {
    // leave the hero undrawn rather than break the frame
  }
}

export function heroArt(id: number): HeroArt {
  let a = arts.get(id);
  if (!a) {
    const img = new Image();
    a = { img, ready: false, lit: null, white: null, dark: null, foot: ART, top: 0, tints: new Map() };
    const art = a;
    img.onload = () => finish(art);
    let src = '';
    try {
      src = hero(id).img;
    } catch {
      src = '';
    }
    if (src) img.src = src;
    arts.set(id, a);
  } else if (!a.ready && a.img.complete && a.img.naturalWidth) {
    finish(a);
  }
  return a;
}

export function tinted(a: HeroArt, color: string): Tex | null {
  if (!a.ready) return null;
  let t = a.tints.get(color);
  if (!t) {
    t = silhouette(a.img, color);
    a.tints.set(color, t);
  }
  return t;
}

/** Asks the browser for the fonts the baked textures use; resolves when they can be drawn. */
export function loadFonts(texts: string[]): Promise<unknown> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || !fonts.load) return Promise.resolve();
  const all = texts.join('');
  return Promise.all([
    fonts.load(`40px "Dela Gothic One"`, `${all}0123456789`),
    fonts.load(`16px "DotGothic16"`, all),
  ]).catch(() => undefined);
}

