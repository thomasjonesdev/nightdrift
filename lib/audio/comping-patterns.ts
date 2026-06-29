// Comping pattern algorithms — per-band-style chord voicing grids
// generated once per scene from DNA, then replayed each chord.

import type { CompingStyle } from "./bands";
import type { PatternDNA } from "./drift-algorithm";
import { chance, pick, rand, randInt } from "./random";

export interface CompingHit {
  /** Index into chord.notes (wraps if voicing is smaller). */
  voiceIdx: number;
  /** 16th-note position within the two-bar chord (0–31). */
  step: number;
  /** Duration in beats. */
  beats: number;
  /** Multiplier on the scene's base chord velocity. */
  velScale: number;
  /** Extra seconds after step offset (rolls, human stagger). */
  micro?: number;
}

export interface CompingPattern {
  style: CompingStyle;
  /** Primary voicing statement for each chord. */
  hits: CompingHit[];
  /** Mid-bar re-stabs (rolled style). */
  restabs: CompingHit[];
}

function clampStep(step: number): number {
  return Math.max(0, Math.min(30, step));
}

function rollHits(noteCount: number, spread: number): CompingHit[] {
  const hits: CompingHit[] = [];
  for (let i = 0; i < noteCount; i++) {
    hits.push({
      voiceIdx: i,
      step: 0,
      beats: 7,
      velScale: 1,
      micro: i * spread + rand(0, 0.025),
    });
  }
  return hits;
}

function sustainedHits(noteCount: number, patterns: PatternDNA): CompingHit[] {
  const hits: CompingHit[] = [];
  for (let i = 0; i < noteCount; i++) {
    hits.push({
      voiceIdx: i,
      step: 0,
      beats: 15.2,
      velScale: i === 0 ? 1 : 0.95,
      micro: i * 0.01,
    });
  }
  const breathSteps = pick([
    [8, 16],
    [6, 14],
    [10, 18],
    [8, 20],
  ]);
  for (const s of breathSteps) {
    if (!chance(0.55 + patterns.compingSpread * 0.15)) continue;
    const voices = randInt(1, Math.min(3, noteCount));
    for (let i = 0; i < voices; i++) {
      hits.push({
        voiceIdx: (i + 1) % noteCount,
        step: clampStep(s + randInt(-1, 1)),
        beats: rand(2.8, 3.8),
        velScale: rand(0.22, 0.32),
        micro: i * 0.015,
      });
    }
  }
  return hits;
}

function stabHits(noteCount: number, patterns: PatternDNA): CompingHit[] {
  const grids = [
    [0, 16],
    [0, 6, 16, 22],
    [0, 10, 16],
    [0, 8, 16, 24],
    [0, 12, 20],
  ];
  const grid = [...pick(grids)];
  if (patterns.compingSpread > 1.1 && chance(0.45)) {
    const extra = pick([4, 14, 18, 26].filter((s) => !grid.includes(s)));
    if (extra !== undefined) grid.push(extra);
  }
  const hits: CompingHit[] = [];
  for (const s of grid.sort((a, b) => a - b)) {
    for (let i = 0; i < noteCount; i++) {
      hits.push({
        voiceIdx: i,
        step: clampStep(s),
        beats: s === 0 ? 0.95 : rand(0.75, 0.95),
        velScale: s === 0 ? 1 : rand(0.62, 0.78),
        micro: i * 0.012,
      });
    }
  }
  return hits;
}

function arpHits(noteCount: number, patterns: PatternDNA): CompingHit[] {
  const ascending = chance(0.55);
  const hits: CompingHit[] = [];
  const stride = patterns.compingSpread > 1.15 ? 1.5 : 2;
  let step = 0;
  for (let i = 0; i < noteCount; i++) {
    const idx = ascending ? i : noteCount - 1 - i;
    hits.push({
      voiceIdx: idx,
      step: clampStep(Math.round(step)),
      beats: rand(2.6, 3.2),
      velScale: 0.78 + i * 0.04,
    });
    step += stride;
  }
  if (chance(0.5 + patterns.compingSpread * 0.1)) {
    const echoStart = pick([14, 16, 18]);
    for (let i = 1; i < noteCount; i++) {
      hits.push({
        voiceIdx: ascending ? i : noteCount - 1 - i,
        step: clampStep(echoStart + i * 2),
        beats: rand(2.2, 2.8),
        velScale: rand(0.38, 0.48),
      });
    }
  }
  return hits;
}

function brokenHits(noteCount: number, patterns: PatternDNA): CompingHit[] {
  const order = [0, 2, 1, 3, 2, 1, 2, 3].map((i) => i % noteCount);
  const baseSteps = [0, 4, 6, 10, 16, 20, 22, 26];
  const density = Math.min(0.95, 0.78 * patterns.compingSpread);
  const hits: CompingHit[] = [];
  baseSteps.forEach((s, i) => {
    if (s > 0 && !chance(density)) return;
    const jitter = s > 0 && chance(0.35) ? randInt(-1, 1) : 0;
    hits.push({
      voiceIdx: order[i],
      step: clampStep(s + jitter),
      beats: s === 0 ? rand(1.4, 1.8) : rand(1.4, 1.7),
      velScale: s === 0 ? rand(0.85, 0.95) : rand(0.52, 0.68),
    });
  });
  if (patterns.compingSpread > 1.2 && chance(0.4)) {
    hits.push({
      voiceIdx: pick([0, 1, 2].map((i) => i % noteCount)),
      step: clampStep(pick([28, 29, 30])),
      beats: 0.8,
      velScale: rand(0.45, 0.58),
    });
  }
  return hits;
}

function restabHits(noteCount: number, spread: number): CompingHit[] {
  const hits: CompingHit[] = [];
  for (let i = 1; i < noteCount; i++) {
    hits.push({
      voiceIdx: i,
      step: 12,
      beats: 1.5,
      velScale: rand(0.82, 0.95),
      micro: (i - 1) * spread * 0.7,
    });
  }
  return hits;
}

/** Build a scene-specific comping grid for the band's chord style. */
export function generateCompingPattern(
  style: CompingStyle,
  noteCount: number,
  patterns: PatternDNA,
): CompingPattern {
  const spread = 0.035 * patterns.compingSpread;
  const voices = Math.max(1, Math.min(4, noteCount));

  let hits: CompingHit[];
  switch (style) {
    case "rolled":
      hits = rollHits(voices, spread);
      break;
    case "sustained":
      hits = sustainedHits(voices, patterns);
      break;
    case "stabs":
      hits = stabHits(voices, patterns);
      break;
    case "arp":
      hits = arpHits(voices, patterns);
      break;
    case "broken":
      hits = brokenHits(voices, patterns);
      break;
  }

  const restabs = style === "rolled" ? restabHits(voices, spread) : [];

  return { style, hits, restabs };
}
