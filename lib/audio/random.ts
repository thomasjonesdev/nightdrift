// Shared random helpers for the generative layers.

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

export const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

export const chance = (p: number) => Math.random() < p;

/** Weighted pick; zero weights are allowed (never chosen unless all are zero). */
export function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let r = Math.random() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
