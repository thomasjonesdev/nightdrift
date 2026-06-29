// Seeded PRNG for reproducible scene generation and playback.
// Mulberry32 — fast, good enough for musical variation.

export class Rng {
  readonly seed: number;
  private state: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Derive an independent child stream from this one. */
  fork(salt = 0): Rng {
    const mixed = (this.seed ^ Math.imul(salt >>> 0, 2654435761) ^ (this.next() * 0xffffffff)) >>> 0;
    return new Rng(mixed);
  }

  rand(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  randInt(min: number, max: number): number {
    return Math.floor(this.rand(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += weight(it);
    let r = this.next() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}

/** Parse a numeric or string seed into a 32-bit unsigned integer. */
export function parseSeed(input: string | number | undefined | null): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input === "number" && Number.isFinite(input)) return input >>> 0;
  const n = Number(input);
  if (Number.isFinite(n) && String(input).trim() !== "") return n >>> 0;
  let h = 2166136261;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed?: number): Rng {
  const s = seed ?? (Math.random() * 0xffffffff) >>> 0;
  return new Rng(s);
}
