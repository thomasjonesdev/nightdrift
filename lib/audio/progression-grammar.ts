// Progression reharmonization — DNA-gated passing tones, tritone subs,
// and modal interchange on family templates.

import type { HarmonyDNA } from "./drift-algorithm";
import type { MoodKey } from "./moods";
import { chance, pick } from "./random";

export interface ProgressionChordSpec {
  degree: number;
  quality: string;
}

type QualityKey =
  | "maj9"
  | "maj7"
  | "maj69"
  | "min9"
  | "min9lo"
  | "min9hi"
  | "min11"
  | "dom9"
  | "dom13"
  | "dom7sus";

/** Semitone offsets from tonic that stay in a major key. */
const DIATONIC_DEGREES = new Set([0, 2, 4, 5, 7, 9, 11]);

function isMinorish(q: string): boolean {
  return q.startsWith("min");
}

function isDiatonic(spec: ProgressionChordSpec): boolean {
  return DIATONIC_DEGREES.has(spec.degree % 12);
}

function allDiatonic(specs: readonly ProgressionChordSpec[]): boolean {
  return specs.every(isDiatonic);
}

function modalBorrow(q: QualityKey, familyMinor: boolean): QualityKey {
  if (familyMinor && q.startsWith("min")) return pick(["maj9", "maj69"] as const);
  if (!familyMinor && q.startsWith("maj")) return pick(["min9", "min11"] as const);
  if (q.startsWith("dom")) return "min9";
  return q;
}

function tritoneSub(spec: ProgressionChordSpec): ProgressionChordSpec {
  return {
    degree: (spec.degree + 6) % 12,
    quality: spec.quality.startsWith("dom") ? spec.quality : "dom9",
  };
}

function passingApproach(
  spec: ProgressionChordSpec,
  next: ProgressionChordSpec | undefined,
): ProgressionChordSpec {
  if (!next) return spec;
  const step = next.degree > spec.degree ? 1 : next.degree < spec.degree ? -1 : 0;
  if (step === 0) return spec;
  return {
    degree: (spec.degree + step + 12) % 12,
    quality: isMinorish(spec.quality) ? "min9lo" : "maj7",
  };
}

function softenQuality(q: string): QualityKey {
  if (q.startsWith("maj")) return pick(["maj9", "maj69", "maj7"] as const);
  if (q.startsWith("min")) return pick(["min9", "min11"] as const);
  if (q.startsWith("dom")) return pick(["dom9", "dom13", "dom7sus"] as const);
  return q as QualityKey;
}

/** Mellow/rainy: same roots, softer extensions only — no chromatic root motion. */
function applyConservativeVariants(
  specs: readonly ProgressionChordSpec[],
  harmony: HarmonyDNA,
): ProgressionChordSpec[] {
  return specs.map((spec) => {
    if (!chance(harmony.reharmStrength * 0.35)) {
      return { ...spec, quality: spec.quality as QualityKey };
    }
    return { ...spec, quality: softenQuality(spec.quality) };
  });
}

/** Apply reharmonization variants to a four-chord template. */
export function applyProgressionVariants(
  specs: readonly ProgressionChordSpec[],
  harmony: HarmonyDNA,
  familyMinor: boolean,
  family: MoodKey,
): ProgressionChordSpec[] {
  if (harmony.reharmStrength < 0.08) {
    return specs.map((s) => ({ ...s }));
  }

  const conservative = family === "mellow" || family === "rainy";
  if (conservative) {
    return applyConservativeVariants(specs, harmony);
  }

  let mutations = 0;
  const maxMutations = family === "jazzy" ? 2 : 1;

  const out = specs.map((spec, i) => {
    const strength = harmony.reharmStrength;
    if (i === 0 || mutations >= maxMutations || !chance(strength * 0.55)) {
      return { ...spec, quality: spec.quality as QualityKey };
    }

    let next: ProgressionChordSpec = { ...spec, quality: spec.quality as QualityKey };

    if (
      chance(harmony.tritoneChance * strength)
      && spec.quality.startsWith("dom")
      && i < specs.length - 1
    ) {
      next = tritoneSub(spec);
    } else if (chance(harmony.modalChance * strength * 0.85)) {
      next = {
        ...spec,
        quality: modalBorrow(spec.quality as QualityKey, familyMinor),
      };
    } else if (chance(harmony.passingChance * strength * 0.7) && i < specs.length - 1) {
      next = passingApproach(spec, specs[i + 1]);
    }

    if (next.degree !== spec.degree || next.quality !== spec.quality) {
      mutations += 1;
    }
    return next;
  });

  if (!allDiatonic(out) && family !== "jazzy") {
    return specs.map((s) => ({ ...s, quality: s.quality as QualityKey }));
  }

  return out;
}
