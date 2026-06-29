// Progression reharmonization — DNA-gated passing tones, tritone subs,
// and modal interchange on family templates.
//
// Calm-first: mellow/rainy stay diatonic and major; jazzy gets light color only.

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

const PEACEFUL_FAMILIES: ReadonlySet<MoodKey> = new Set(["mellow", "rainy"]);

/** Max minor chords allowed per four-bar loop after variants. */
const MAX_MINOR_CHORDS: Record<MoodKey, number> = {
  mellow: 0,
  rainy: 1,
  jazzy: 0,
};

function isMinorish(q: string): boolean {
  return q.startsWith("min");
}

function minorCount(specs: readonly ProgressionChordSpec[]): number {
  return specs.filter((s) => isMinorish(s.quality)).length;
}

function isDiatonic(spec: ProgressionChordSpec): boolean {
  return DIATONIC_DEGREES.has(spec.degree % 12);
}

function allDiatonic(specs: readonly ProgressionChordSpec[]): boolean {
  return specs.every(isDiatonic);
}

function peacefulQuality(q: string): QualityKey {
  if (q.startsWith("dom")) return pick(["dom7sus", "dom9"] as const);
  return pick(["maj9", "maj69", "maj7"] as const);
}

function modalBorrow(q: QualityKey, familyMinor: boolean, family: MoodKey): QualityKey {
  if (familyMinor && q.startsWith("min")) return pick(["maj9", "maj69"] as const);
  if (!familyMinor && q.startsWith("maj")) {
    if (PEACEFUL_FAMILIES.has(family)) return peacefulQuality(q);
    return pick(["maj69", "maj7", "dom7sus"] as const);
  }
  if (q.startsWith("dom")) {
    return family === "jazzy" ? pick(["dom7sus", "dom13"] as const) : "dom7sus";
  }
  if (q.startsWith("min") && PEACEFUL_FAMILIES.has(family)) {
    return peacefulQuality("maj9");
  }
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
  family: MoodKey,
): ProgressionChordSpec {
  if (!next) return spec;
  const step = next.degree > spec.degree ? 1 : next.degree < spec.degree ? -1 : 0;
  if (step === 0) return spec;
  return {
    degree: (spec.degree + step + 12) % 12,
    quality: PEACEFUL_FAMILIES.has(family) ? "maj7" : isMinorish(spec.quality) ? "min9lo" : "maj7",
  };
}

/** Mellow/rainy: same roots, softer major extensions only — no chromatic root motion. */
function applyConservativeVariants(
  specs: readonly ProgressionChordSpec[],
  harmony: HarmonyDNA,
): ProgressionChordSpec[] {
  return specs.map((spec) => {
    if (!chance(harmony.reharmStrength * 0.35)) {
      return { ...spec, quality: spec.quality as QualityKey };
    }
    return { ...spec, quality: peacefulQuality(spec.quality) };
  });
}

function enforceMinorCap(
  template: readonly ProgressionChordSpec[],
  candidate: ProgressionChordSpec[],
  family: MoodKey,
): ProgressionChordSpec[] {
  if (minorCount(candidate) <= MAX_MINOR_CHORDS[family]) return candidate;
  return template.map((s) => ({ ...s, quality: s.quality as QualityKey }));
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

  if (PEACEFUL_FAMILIES.has(family)) {
    return enforceMinorCap(specs, applyConservativeVariants(specs, harmony), family);
  }

  let mutations = 0;
  const maxMutations = family === "jazzy" ? 1 : 1;

  const out = specs.map((spec, i) => {
    const strength = harmony.reharmStrength;
    if (i === 0 || mutations >= maxMutations || !chance(strength * 0.45)) {
      return { ...spec, quality: spec.quality as QualityKey };
    }

    let next: ProgressionChordSpec = { ...spec, quality: spec.quality as QualityKey };

    if (
      family === "jazzy"
      && chance(harmony.tritoneChance * strength * 0.55)
      && spec.quality.startsWith("dom")
      && i < specs.length - 1
    ) {
      next = tritoneSub(spec);
    } else if (chance(harmony.modalChance * strength * 0.55)) {
      next = {
        ...spec,
        quality: modalBorrow(spec.quality as QualityKey, familyMinor, family),
      };
    } else if (chance(harmony.passingChance * strength * 0.5) && i < specs.length - 1) {
      next = passingApproach(spec, specs[i + 1], family);
    }

    if (next.degree !== spec.degree || next.quality !== spec.quality) {
      mutations += 1;
    }
    return next;
  });

  if (!allDiatonic(out)) {
    return specs.map((s) => ({ ...s, quality: s.quality as QualityKey }));
  }

  return enforceMinorCap(specs, out, family);
}
