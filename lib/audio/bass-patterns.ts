// Bass pattern grammars — scene-level figures for groove, anchor, and walking.

import type { BassStyle, DrumKit } from "./bands";

type ResolvedBassStyle = Exclude<BassStyle, "either">;
import type { PatternDNA } from "./drift-algorithm";
import { chance, pick, rand, randInt } from "./random";

export type RiffDeg = "root" | "third" | "fifth" | "octave" | "approach";

export interface RiffNote {
  /** 16th-note position within the chord's two bars (0–31). */
  step: number;
  /** Chord-relative degree; "approach" leans chromatically into the next chord. */
  deg: RiffDeg;
  /** Duration in beats. */
  beats: number;
  /** 0–1 within the riff; the engine drops quieter notes at low energy. */
  vel: number;
}

function groovePattern(kickSteps: number[], patterns: PatternDNA): RiffNote[] {
  const riff: RiffNote[] = [
    { step: 0, deg: "root", beats: rand(1.2, 1.8), vel: 1 },
    { step: 16, deg: chance(0.6) ? "root" : "fifth", beats: rand(1, 1.5), vel: 0.9 },
  ];
  const taken = new Set([0, 16]);

  const candidates = kickSteps
    .filter((s) => s !== 0 && s !== 16)
    .flatMap((s) => [s, s + 2])
    .concat([10, 22, 26])
    .filter((s) => s > 0 && s < 30 && !taken.has(s));

  const count = randInt(2, 3 + Math.round(patterns.compingSpread));
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const s = candidates.splice(randInt(0, candidates.length - 1), 1)[0];
    if (taken.has(s)) continue;
    taken.add(s);
    const deg: RiffDeg =
      s >= 26 && chance(0.6)
        ? "approach"
        : pick(["root", "root", "octave", "fifth", "fifth", "third"]);
    riff.push({ step: s, deg, beats: rand(0.5, 1), vel: rand(0.5, 0.75) });
  }

  if (chance(0.35 + patterns.drumGhostMul * 0.1)) {
    const s = pick([7, 15, 23]);
    if (!taken.has(s)) riff.push({ step: s, deg: "root", beats: 0.3, vel: 0.3 });
  }

  return riff.sort((a, b) => a.step - b.step);
}

function anchorPattern(patterns: PatternDNA): RiffNote[] {
  const riff: RiffNote[] = [
    { step: 0, deg: "root", beats: rand(1.6, 1.9), vel: 1 },
    { step: 16, deg: "root", beats: rand(1.2, 1.5), vel: 0.9 },
  ];
  const optional: RiffNote[] = [
    { step: 10, deg: "root", beats: 0.7, vel: 0.65 },
    { step: 26, deg: "fifth", beats: 0.7, vel: 0.55 },
    { step: 8, deg: "root", beats: 0.5, vel: 0.45 },
  ];
  for (const hit of optional) {
    if (chance(0.45 + patterns.compingSpread * 0.15)) {
      riff.push({ ...hit, beats: hit.beats * rand(0.9, 1.1) });
    }
  }
  return riff.sort((a, b) => a.step - b.step);
}

/** Stepwise contour with chord-tone degrees and a late approach into the next harmony. */
function walkingPattern(patterns: PatternDNA): RiffNote[] {
  const grid: RiffNote[] = [
    { step: 0, deg: "root", beats: 1.6, vel: 1 },
    { step: 8, deg: pick(["root", "third", "fifth"] as const), beats: 0.6, vel: 0.55 },
    { step: 16, deg: "fifth", beats: 1, vel: 0.85 },
    { step: 22, deg: pick(["root", "third"] as const), beats: 0.6, vel: 0.5 },
    { step: 28, deg: "approach", beats: 0.5, vel: 0.45 },
  ];
  const density = Math.min(0.95, 0.55 + patterns.compingSpread * 0.2);
  return grid
    .filter((hit, i) => i === 0 || i === 2 || i === 4 || chance(density))
    .map((hit) => ({
      ...hit,
      beats: hit.beats * rand(0.92, 1.08),
      vel: hit.vel * rand(0.92, 1.05),
    }));
}

/** Build the scene's two-bar bass figure from style, drums, and DNA. */
export function generateBassPattern(
  style: ResolvedBassStyle,
  drumGrammar: DrumKit,
  patterns: PatternDNA,
): RiffNote[] {
  switch (style) {
    case "groove":
      return groovePattern(drumGrammar.kicks, patterns);
    case "walking":
      return walkingPattern(patterns);
    case "anchor":
      return anchorPattern(patterns);
  }
}
