// A small seeded random number generator (mulberry32). The whole state is one number,
// so a match or a season can be saved and replayed exactly.

export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** 0 <= x < 1 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [a, b] */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  /** roughly normal, mean 0, sd 1 */
  normal(): number {
    let t = 0;
    for (let i = 0; i < 6; i += 1) t += this.next();
    return (t - 3) / Math.SQRT1_2; // the sum of 6 uniforms has sd sqrt(0.5)
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    const ws = items.map((it) => {
      const w = Math.max(0, weight(it));
      total += w;
      return w;
    });
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      r -= ws[i]!;
      if (r < 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
