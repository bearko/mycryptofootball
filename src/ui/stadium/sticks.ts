// The sideline markers of a broadcast: a sign on a pole where the ball is, saying which down it is and how far
// there is to go ("2nd & 7"), pointing the way the offense attacks; and a yellow stick on the line to reach.
// They stand on the far sideline and always face the lens, so they read from any camera.

import { DISPLAY_FONT } from './assets';
import type { Painter } from './ground';
import { clamp, css, easeOut, luma, mix, scale, type RGB } from './math';

/** where on the far sideline the poles stand (z) */
const SIDE_Z = -0.9;
const INK = 'rgba(10,16,40,0.92)';
const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

export interface Sticks {
  /** world x of the line of scrimmage, and of the line to reach (null: the goal line is the line to reach) */
  losX: number;
  gainX: number | null;
  /** +1: the offense attacks toward +x */
  dir: 1 | -1;
  down: number;
  toGo: number;
  /** the try after a touchdown */
  tfp: boolean;
  team: RGB;
  /** seconds since the sign last changed (it pops) */
  since: number;
  clock: number;
  /** nothing is drawn above this (device pixels): the score display lies there */
  top: number;
}

export function sticksText(s: Pick<Sticks, 'down' | 'toGo' | 'tfp' | 'gainX'>): string {
  if (s.tfp) return 'TFP';
  return `${ORDINAL[clamp(s.down, 1, 4)]} & ${s.gainX === null ? 'GOAL' : s.toGo}`;
}

/** A pointed plate (the point looks toward `way`: +1 right, -1 left) around the box x0..x1, y0..y1. */
function plate(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, tip: number, way: number): void {
  const my = (y0 + y1) / 2;
  ctx.beginPath();
  if (way > 0) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1 + tip, my);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
  } else {
    ctx.moveTo(x1, y0);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 - tip, my);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
  }
  ctx.closePath();
}

/**
 * `layer`: the poles stand behind the heroes; the plates are drawn over them, like any graphic a broadcast lays over
 * its picture (on a small screen the far sideline is near the top, and a hero would stand in front of the words).
 */
export function drawSticks(p: Painter, s: Sticks, layer: 'poles' | 'plates'): void {
  const poles = layer === 'poles';
  const ctx = p.ctx;
  const cam = p.cam;
  const px = p.px;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // which way the attack goes on screen
  if (!cam.project(s.losX, 0, SIDE_Z)) return;
  const ax = cam.sx;
  const ay = cam.sy;
  const ss = cam.ss;
  const way = cam.project(s.losX + s.dir * 2, 0, SIDE_Z) && cam.sx < ax ? -1 : 1;

  // the sign where the ball is: its size and place (it is drawn last, over the flag)
  const hot = s.down >= 4 && !s.tfp;
  const pop = 1 + 0.28 * (1 - easeOut(s.since / 0.3));
  const u = clamp(ss * 1.25, 13 * px, 25 * px) * pop;
  const text = sticksText(s);
  ctx.font = `${Math.round(u)}px ${DISPLAY_FONT}`;
  const tw = ctx.measureText(text).width;
  const h = u * 1.5;
  const tip = u * 0.62;
  const w = tw + u * 0.9;
  const top = Math.max(s.top + 6 * px, ay - 5.4 * ss - h / 2);
  const sx0 = way > 0 ? ax - u * 0.35 : ax + u * 0.35 - w;
  const sx1 = sx0 + w;

  // ---- the stick on the line to reach: yellow, with a small pennant
  if (s.gainX !== null && !s.tfp && cam.project(s.gainX, 0, SIDE_Z)) {
    const gx = cam.sx;
    const gy = cam.sy;
    const gs = cam.ss;
    // lower than the sign; lower still when the two would touch
    const fu = clamp(gs * 0.85, 9 * px, 17 * px);
    const near = gx + fu * 3 > sx0 - tip - u * 1.4 && gx - fu * 3 < sx1 + tip + u * 1.4;
    const flagTop = Math.min(gy - fu * 1.6, Math.max(near ? top + h + 4 * px : s.top + 6 * px, gy - 3.7 * gs));
    // no room under the sign (a flat camera, the sideline at the top of the picture): the pole alone marks the line
    const crowded = near && flagTop < top + h + 2 * px;
    const w = Math.max(2 * px, 0.13 * gs);
    if (poles) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = w + 2 * px;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, flagTop);
      ctx.stroke();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.font = `${Math.round(fu)}px ${DISPLAY_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const fw = ctx.measureText('1st').width + fu * 0.7;
    const fh = fu * 1.45;
    const x0 = way > 0 ? gx : gx - fw;
    const x1 = x0 + fw;
    if (!poles && !crowded) {
      plate(ctx, x0, flagTop, x1, flagTop + fh, fu * 0.45, way);
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, 1.6 * px);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillText('1st', (x0 + x1) / 2, flagTop + fh / 2 + fu * 0.04);
    }
  }

  // ---- the sign where the ball is
  ctx.font = `${Math.round(u)}px ${DISPLAY_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // the pole
  const pw = Math.max(2.4 * px, 0.16 * ss);
  if (poles) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = pw + 2 * px;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, top + h / 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff7a1a';
    ctx.lineWidth = pw;
    ctx.stroke();
    return;
  }
  // the plate hangs on the pole and reaches out toward the goal the offense attacks
  const x0 = sx0;
  const x1 = sx1;
  const body: RGB = hot ? [255, 210, 63] : luma(s.team) > 0.62 ? scale(s.team, 0.62) : mix(s.team, [10, 16, 40], 0.12);
  // a soft shadow under it, so it stands off the stands
  plate(ctx, x0 + 2 * px, top + 3 * px, x1 + 2 * px, top + h + 3 * px, tip, way);
  ctx.fillStyle = 'rgba(4,8,24,0.45)';
  ctx.fill();
  plate(ctx, x0, top, x1, top + h, tip, way);
  ctx.fillStyle = css(body);
  ctx.fill();
  ctx.strokeStyle = hot ? INK : 'rgba(250,252,255,0.95)';
  ctx.lineWidth = Math.max(1.6, 2 * px);
  ctx.stroke();
  // the letters
  const cx = (x0 + x1) / 2;
  const cy = top + h / 2 + u * 0.04;
  if (!hot) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2, u * 0.16);
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = hot ? INK : '#ffffff';
  ctx.fillText(text, cx, cy);
  // arrowheads run off the point: this way
  const flow = (s.clock * 1.6) % 1;
  for (let k = 0; k < 2; k += 1) {
    const f = (flow + k * 0.5) % 1;
    const x = (way > 0 ? x1 + tip : x0 - tip) + way * (u * 0.25 + f * u * 0.9);
    const a = Math.sin(f * Math.PI);
    const c = u * 0.3;
    ctx.strokeStyle = `rgba(10,16,40,${0.7 * a})`;
    ctx.lineWidth = Math.max(3 * px, u * 0.22);
    ctx.beginPath();
    ctx.moveTo(x - way * c, top + h / 2 - c);
    ctx.lineTo(x, top + h / 2);
    ctx.lineTo(x - way * c, top + h / 2 + c);
    ctx.stroke();
    ctx.strokeStyle = hot ? `rgba(255,210,63,${a})` : `rgba(255,255,255,${a})`;
    ctx.lineWidth = Math.max(1.6 * px, u * 0.12);
    ctx.stroke();
  }
}
