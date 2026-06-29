// Shared random helpers for the generative layers.
// When runWithRng() is active, all helpers draw from that stream.

import { Rng } from "./rng";

let activeRng: Rng | null = null;

/** Run a block with a dedicated RNG (scene generation, comping build, etc.). */
export function runWithRng<T>(sceneRng: Rng, fn: () => T): T {
  const prev = activeRng;
  activeRng = sceneRng;
  try {
    return fn();
  } finally {
    activeRng = prev;
  }
}

export const pick = <T>(arr: readonly T[]): T =>
  activeRng ? activeRng.pick(arr) : arr[Math.floor(Math.random() * arr.length)];

export const rand = (min: number, max: number) =>
  activeRng ? activeRng.rand(min, max) : min + Math.random() * (max - min);

export const randInt = (min: number, max: number) =>
  activeRng ? activeRng.randInt(min, max) : Math.floor(rand(min, max + 1));

export const chance = (p: number) =>
  activeRng ? activeRng.chance(p) : Math.random() < p;

/** Weighted pick; zero weights are allowed (never chosen unless all are zero). */
export function weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
  if (activeRng) return activeRng.weightedPick(items, weight);
  let total = 0;
  for (const it of items) total += weight(it);
  let r = Math.random() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export { Rng, createRng, parseSeed } from "./rng";
