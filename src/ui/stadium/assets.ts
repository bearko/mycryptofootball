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

/** texels per yard of the baked turf */
export const PPY = 26;
export const FIELD_PAD = 1.5;
export const FX0 = -END - FIELD_PAD;
export const FX1 = FIELD + END + FIELD_PAD;
export const FZ0 = -FIELD_PAD;
export const FZ1 = WIDTH + FIELD_PAD;

const NAVY: RGB = [10, 18, 40];

/** The colour a team's end zone is painted in: its colour, calmed down for the night picture. */
export function zoneColor(color: string): RGB {
  const c = rgbOf(color);
  return mix(scale(c, 0.78), NAVY, 0.28);
}

export function bakeField(teams: [TeamSheet, TeamSheet]): Tex {
  const c = makeCanvas((FX1 - FX0) * PPY, (FZ1 - FZ0) * PPY);
  const g = c.getContext('2d')!;
  const X = (x: number): number => (x - FX0) * PPY;
  const Z = (z: number): number => (z - FZ0) * PPY;
  const rnd = seeded(77);

  // surround
  g.fillStyle = '#134a36';
  g.fillRect(0, 0, c.width, c.height);

  // mowed bands
  for (let i = 0; i < FIELD / 5; i += 1) {
    g.fillStyle = i % 2 ? '#1c7448' : '#218352';
    g.fillRect(X(i * 5), Z(0), 5 * PPY + 1, WIDTH * PPY);
    // each band has a soft sheen, as if mowed in alternating directions
    const sheen = g.createLinearGradient(X(i * 5), 0, X(i * 5 + 5), 0);
    sheen.addColorStop(i % 2 ? 0 : 1, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(i % 2 ? 1 : 0, 'rgba(0,0,0,0.06)');
    g.fillStyle = sheen;
    g.fillRect(X(i * 5), Z(0), 5 * PPY + 1, WIDTH * PPY);
  }

  // end zones in the colour of the team that defends them
  const zone = (x0: number, team: TeamSheet, flip: boolean): void => {
    const col = zoneColor(team.color);
    g.fillStyle = css(col);
    g.fillRect(X(x0), Z(0), END * PPY, WIDTH * PPY);
    // diagonal tone-on-tone stripes
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
    // the team's short name, read from the field
    g.save();
    g.translate(X(x0 + END / 2), Z(WIDTH / 2));
    g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    const size = PPY * 3.1;
    g.font = `${Math.round(size)}px ${DISPLAY_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const light = luma(col) > 0.55;
    const chars = [...team.short];
    const step = Math.min(PPY * 5.2, (WIDTH * PPY * 0.8) / Math.max(1, chars.length));
    chars.forEach((ch, i) => {
      const x = (i - (chars.length - 1) / 2) * step;
      g.lineJoin = 'round';
      g.lineWidth = PPY * 0.34;
      g.strokeStyle = light ? 'rgba(255,255,255,0.75)' : 'rgba(8,14,34,0.55)';
      g.strokeText(ch, x, PPY * 0.1);
      g.fillStyle = light ? 'rgba(20,32,70,0.92)' : 'rgba(246,248,255,0.94)';
      g.fillText(ch, x, PPY * 0.1);
    });
    g.restore();
  };
  zone(-END, teams[0], false);
  zone(FIELD, teams[1], true);

  // blades of grass: thousands of faint flecks
  for (let i = 0; i < 16000; i += 1) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    const l = 2 + rnd() * 5;
    g.fillStyle = rnd() < 0.5 ? `rgba(255,255,210,${0.02 + rnd() * 0.045})` : `rgba(0,20,10,${0.03 + rnd() * 0.06})`;
    g.fillRect(x, y, 1.2, l);
  }
  // a little wear between the hash marks
  for (let i = 0; i < 26; i += 1) {
    const x = X(4 + rnd() * (FIELD - 8));
    const y = Z(8 + rnd() * 8);
    const r = PPY * (1 + rnd() * 2.2);
    const w = g.createRadialGradient(x, y, 0, x, y, r);
    w.addColorStop(0, 'rgba(60,70,30,0.10)');
    w.addColorStop(1, 'rgba(60,70,30,0)');
    g.fillStyle = w;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // centre-field emblem: an original mark (ring, hexagon, two chevrons and a coin)
  {
    const cx = X(FIELD / 2);
    const cy = Z(WIDTH / 2);
    const R = PPY * 4.3;
    const tint = mix(rgbOf(teams[0].color), [255, 255, 255], 0.35);
    g.save();
    g.translate(cx, cy);
    g.fillStyle = 'rgba(8,30,24,0.28)';
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    g.lineJoin = 'miter';
    g.strokeStyle = 'rgba(244,248,240,0.82)';
    g.lineWidth = PPY * 0.3;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.stroke();
    g.lineWidth = PPY * 0.16;
    g.beginPath();
    g.arc(0, 0, R * 0.88, 0, TAU);
    g.stroke();
    // hexagon
    g.fillStyle = css(tint, 0.26);
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      g.lineTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74);
    }
    g.closePath();
    g.fill();
    g.lineWidth = PPY * 0.2;
    g.stroke();
    // chevrons pointing at the two goals
    g.fillStyle = 'rgba(244,248,240,0.88)';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(s * R * 0.58, 0);
      g.lineTo(s * R * 0.2, -R * 0.4);
      g.lineTo(s * R * 0.2, -R * 0.2);
      g.lineTo(s * R * 0.38, 0);
      g.lineTo(s * R * 0.2, R * 0.2);
      g.lineTo(s * R * 0.2, R * 0.4);
      g.closePath();
      g.fill();
    }
    // coin
    g.beginPath();
    g.arc(0, 0, R * 0.15, 0, TAU);
    g.fill();
    g.fillStyle = css(scale(tint, 0.6), 0.9);
    g.beginPath();
    g.arc(0, 0, R * 0.075, 0, TAU);
    g.fill();
    g.restore();
  }

  // chalk
  const chalk = 'rgba(246,249,242,0.92)';
  g.fillStyle = chalk;
  // the wide border
  const B = 0.5;
  g.fillRect(X(-END - B), Z(-B), (FIELD + END * 2 + B * 2) * PPY, B * PPY);
  g.fillRect(X(-END - B), Z(WIDTH), (FIELD + END * 2 + B * 2) * PPY, B * PPY);
  g.fillRect(X(-END - B), Z(-B), B * PPY, (WIDTH + B * 2) * PPY);
  g.fillRect(X(FIELD + END), Z(-B), B * PPY, (WIDTH + B * 2) * PPY);
  for (let yd = 0; yd <= FIELD; yd += 5) {
    const goal = yd === 0 || yd === FIELD;
    const w = goal ? 0.34 : 0.15;
    g.globalAlpha = goal ? 1 : 0.8;
    g.fillRect(X(yd - w / 2), Z(0), w * PPY, WIDTH * PPY);
  }
  g.globalAlpha = 0.72;
  for (let yd = 1; yd < FIELD; yd += 1) {
    if (yd % 5 === 0) continue;
    for (const z of [0.15, 8.2, 15.1, 23.15]) g.fillRect(X(yd - 0.05), Z(z), 0.1 * PPY, 0.7 * PPY);
  }
  g.globalAlpha = 1;

  // yard numbers, split around their line
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(246,249,242,0.86)';
  const numSize = PPY * 2.7;
  g.font = `${Math.round(numSize)}px ${DISPLAY_FONT}`;
  for (let yd = 10; yd < FIELD; yd += 10) {
    const label = String(Math.min(yd, FIELD - yd));
    for (const z of [4.9, 19.1]) {
      g.textAlign = 'right';
      g.fillText(label[0]!, X(yd - 0.32), Z(z));
      g.textAlign = 'left';
      g.fillText(label[1] ?? '', X(yd + 0.32), Z(z));
      // a small arrow toward the nearer goal
      if (yd !== FIELD / 2) {
        const s = yd < FIELD / 2 ? -1 : 1;
        const ax = X(yd + s * 2.75);
        g.beginPath();
        g.moveTo(ax + s * PPY * 0.55, Z(z - 0.75));
        g.lineTo(ax, Z(z - 1.05));
        g.lineTo(ax, Z(z - 0.45));
        g.closePath();
        g.fill();
      }
    }
  }

  // floodlight pooling: bright in the middle, falling off toward the corners
  const pool = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.2, c.width / 2, c.height / 2, c.width * 0.62);
  pool.addColorStop(0, 'rgba(255,255,230,0.07)');
  pool.addColorStop(0.45, 'rgba(0,0,0,0)');
  pool.addColorStop(1, 'rgba(4,10,34,0.42)');
  g.fillStyle = pool;
  g.fillRect(0, 0, c.width, c.height);
  return c;
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

export function bakeRibbon(parts: { text: string; color: string }[], bg = '#05070f'): Ribbon {
  const probe = makeCanvas(4, 4).getContext('2d')!;
  probe.font = `16px ${PIXEL_FONT}`;
  const gap = 34;
  const widths = parts.map((p) => Math.ceil(probe.measureText(p.text).width));
  let period = widths.reduce((a, b) => a + b + gap, 0);
  period = Math.max(period, 120);
  const total = period + RIBBON_MAX_YD * RIBBON_PPY + 4;
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
      g.fillText(p.text, x, RIBBON_H / 2 + 1);
      // a separator diamond
      const dx = x + widths[i]! + gap / 2;
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
    try {
      const data = white.getContext('2d')!.getImageData(0, 0, ART, ART).data;
      outer: for (let y = ART - 1; y >= 0; y -= 1) {
        for (let x = 0; x < ART; x += 1) {
          if (data[(y * ART + x) * 4 + 3]! > 40) {
            foot = y + 1;
            break outer;
          }
        }
      }
    } catch {
      foot = ART - 1;
    }
    a.dark = dark;
    a.white = white;
    a.lit = lit;
    a.foot = foot;
    a.ready = true;
  } catch {
    // leave the hero undrawn rather than break the frame
  }
}

export function heroArt(id: number): HeroArt {
  let a = arts.get(id);
  if (!a) {
    const img = new Image();
    a = { img, ready: false, lit: null, white: null, dark: null, foot: ART, tints: new Map() };
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

