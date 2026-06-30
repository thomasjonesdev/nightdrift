// Band composer — per-ensemble creative director above the producer.
// Sanitizes DNA weirdness, shapes hooks for each band's voice, and locks
// a consistent round arc before the chart goes to the board.

import type { Band, CompingStyle, MelodyBehavior } from "./bands";
import type { EnergyShape, SceneDNA } from "./drift-algorithm";
import { bindMelodyToProgression, type MelodyPlan, type MelodySlot, type MotifNote, type MotifVariation } from "./melodies";
import type { HarmonicRole } from "./harmonic-binding";
import type { MoodKey } from "./moods";
import type { Scene } from "./scenes";
import { createRng } from "./random";

const COMPOSER_SALT = 0x8b_a3_4f_21;

export type ComposerArchetype =
  | "piano-hook"
  | "piano-wash"
  | "texture-lead"
  | "arp-weave"
  | "sparse-bloom"
  | "ensemble-bed";

export interface ComposerBrief {
  archetype: ComposerArchetype;
  hookPresenceMin: number;
  cadencePresenceMin: number;
  resolutionPresenceMin: number;
  roundCycleOptions: readonly (readonly MotifVariation[])[];
  maxStepJitter: number;
  maxMutationStrength: number;
  maxContourBlend: number;
  maxOctaveChance: number;
  maxHumanize: number;
  swingRange: [number, number];
  dropoutCap: number;
  fillDensityCap: number;
  melodyPresenceRange: [number, number];
  reharmCap: number;
  energyShapes: readonly EnergyShape[];
  answerShiftRange: [number, number];
}

export interface ComposerNotes {
  archetype: ComposerArchetype;
  dnaClamped: number;
  hookShaped: boolean;
  slotsTuned: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function deriveArchetype(band: Band): ComposerArchetype {
  if (band.melodyBehavior === "sparse" || band.melodyBehavior === "held") return "sparse-bloom";
  if (band.melodyBehavior === "arp" || band.comping === "arp") return "arp-weave";
  if (band.chordVoice === "piano" && band.melodyVoice === "piano") {
    return band.comping === "rolled" ? "piano-wash" : "piano-hook";
  }
  if (band.bedVoice && (band.harmonyVoice || band.padChance >= 0.82)) return "ensemble-bed";
  if (band.melodyVoice !== band.chordVoice) return "texture-lead";
  return "piano-hook";
}

const ARCHETYPE_BRIEFS: Record<ComposerArchetype, Omit<ComposerBrief, "archetype">> = {
  "piano-hook": {
    hookPresenceMin: 0.96,
    cadencePresenceMin: 0.86,
    resolutionPresenceMin: 0.9,
    roundCycleOptions: [
      ["plain", "lift", "plain"],
      ["plain", "lift", "answer"],
      ["plain", "ornament", "lift"],
    ],
    maxStepJitter: 1,
    maxMutationStrength: 0.38,
    maxContourBlend: 0.35,
    maxOctaveChance: 0.08,
    maxHumanize: 0.014,
    swingRange: [0.94, 1.08],
    dropoutCap: 0.1,
    fillDensityCap: 1.05,
    melodyPresenceRange: [0.9, 1.08],
    reharmCap: 0.16,
    energyShapes: ["arc", "plateau", "breathe"],
    answerShiftRange: [-1, 1],
  },
  "piano-wash": {
    hookPresenceMin: 0.94,
    cadencePresenceMin: 0.88,
    resolutionPresenceMin: 0.88,
    roundCycleOptions: [
      ["plain", "plain", "lift"],
      ["plain", "fragment", "plain"],
      ["plain", "lift", "fragment"],
    ],
    maxStepJitter: 1,
    maxMutationStrength: 0.28,
    maxContourBlend: 0.22,
    maxOctaveChance: 0.05,
    maxHumanize: 0.011,
    swingRange: [0.88, 1.02],
    dropoutCap: 0.06,
    fillDensityCap: 0.88,
    melodyPresenceRange: [0.78, 0.94],
    reharmCap: 0.12,
    energyShapes: ["breathe", "arc", "plateau"],
    answerShiftRange: [-1, 1],
  },
  "texture-lead": {
    hookPresenceMin: 0.92,
    cadencePresenceMin: 0.84,
    resolutionPresenceMin: 0.86,
    roundCycleOptions: [
      ["plain", "lift", "ornament"],
      ["plain", "plain", "lift"],
    ],
    maxStepJitter: 1,
    maxMutationStrength: 0.42,
    maxContourBlend: 0.4,
    maxOctaveChance: 0.1,
    maxHumanize: 0.016,
    swingRange: [0.96, 1.1],
    dropoutCap: 0.12,
    fillDensityCap: 1.12,
    melodyPresenceRange: [0.88, 1.05],
    reharmCap: 0.18,
    energyShapes: ["arc", "wave", "plateau"],
    answerShiftRange: [-1, 1],
  },
  "arp-weave": {
    hookPresenceMin: 0.9,
    cadencePresenceMin: 0.82,
    resolutionPresenceMin: 0.84,
    roundCycleOptions: [
      ["plain", "displaced", "lift"],
      ["plain", "lift", "displaced"],
    ],
    maxStepJitter: 2,
    maxMutationStrength: 0.45,
    maxContourBlend: 0.45,
    maxOctaveChance: 0.12,
    maxHumanize: 0.018,
    swingRange: [0.98, 1.12],
    dropoutCap: 0.14,
    fillDensityCap: 1.18,
    melodyPresenceRange: [0.86, 1.02],
    reharmCap: 0.2,
    energyShapes: ["wave", "arc", "plateau"],
    answerShiftRange: [-2, 2],
  },
  "sparse-bloom": {
    hookPresenceMin: 0.88,
    cadencePresenceMin: 0.8,
    resolutionPresenceMin: 0.82,
    roundCycleOptions: [
      ["plain", "plain", "fragment"],
      ["plain", "fragment", "plain"],
    ],
    maxStepJitter: 0,
    maxMutationStrength: 0.18,
    maxContourBlend: 0.15,
    maxOctaveChance: 0.04,
    maxHumanize: 0.01,
    swingRange: [0.9, 1.02],
    dropoutCap: 0.08,
    fillDensityCap: 0.75,
    melodyPresenceRange: [0.68, 0.84],
    reharmCap: 0.1,
    energyShapes: ["breathe", "plateau"],
    answerShiftRange: [-1, 1],
  },
  "ensemble-bed": {
    hookPresenceMin: 0.93,
    cadencePresenceMin: 0.85,
    resolutionPresenceMin: 0.87,
    roundCycleOptions: [
      ["plain", "lift", "plain"],
      ["plain", "ornament", "plain"],
    ],
    maxStepJitter: 1,
    maxMutationStrength: 0.32,
    maxContourBlend: 0.28,
    maxOctaveChance: 0.07,
    maxHumanize: 0.012,
    swingRange: [0.92, 1.06],
    dropoutCap: 0.09,
    fillDensityCap: 0.95,
    melodyPresenceRange: [0.84, 1.0],
    reharmCap: 0.14,
    energyShapes: ["breathe", "arc", "plateau"],
    answerShiftRange: [-1, 1],
  },
};

/** Per-band nudges — hand-tuned where an ensemble needs a stronger identity. */
const BAND_BRIEF_PATCHES: Partial<
  Record<string, Partial<Omit<ComposerBrief, "archetype">>>
> = {
  "felt-piano-trio": { hookPresenceMin: 0.98, maxMutationStrength: 0.3 },
  "piano-rain": { melodyPresenceRange: [0.72, 0.88], dropoutCap: 0.05 },
  "piano-duet": { hookPresenceMin: 0.97, maxOctaveChance: 0.05 },
  "bossa-balcony": { swingRange: [1.0, 1.12], roundCycleOptions: [["plain", "lift", "ornament"]] },
  "pad-cathedral": { melodyPresenceRange: [0.7, 0.86], fillDensityCap: 0.82 },
  "music-box-attic": { maxStepJitter: 0, maxMutationStrength: 0.15 },
};

export function composerBriefFor(band: Band, family: MoodKey): ComposerBrief {
  const archetype = deriveArchetype(band);
  const base = { archetype, ...ARCHETYPE_BRIEFS[archetype] };
  const patch = BAND_BRIEF_PATCHES[band.id];
  if (!patch) return base;

  return {
    ...base,
    ...patch,
    roundCycleOptions: patch.roundCycleOptions ?? base.roundCycleOptions,
    swingRange: patch.swingRange ?? base.swingRange,
    melodyPresenceRange: patch.melodyPresenceRange ?? base.melodyPresenceRange,
    answerShiftRange: patch.answerShiftRange ?? base.answerShiftRange,
    energyShapes: patch.energyShapes ?? base.energyShapes,
  };
}

function pickRoundCycle(brief: ComposerBrief, seed: number): MotifVariation[] {
  const rng = createRng((seed ^ COMPOSER_SALT) >>> 0);
  const options = brief.roundCycleOptions;
  const picked = options[rng.randInt(0, options.length - 1)] ?? options[0];
  return [...picked];
}

function countDnaClamps(before: SceneDNA, after: SceneDNA): number {
  let n = 0;
  if (before.melody.mutationStrength !== after.melody.mutationStrength) n++;
  if (before.melody.stepJitter !== after.melody.stepJitter) n++;
  if (before.melody.contourBlend !== after.melody.contourBlend) n++;
  if (before.patterns.dropoutChance !== after.patterns.dropoutChance) n++;
  if (before.patterns.fillDensity !== after.patterns.fillDensity) n++;
  if (before.harmony.reharmStrength !== after.harmony.reharmStrength) n++;
  if (before.structure.energyShape !== after.structure.energyShape) n++;
  return n;
}

function compingSpreadCap(comping: CompingStyle): [number, number] {
  switch (comping) {
    case "sustained":
      return [0.85, 1.05];
    case "rolled":
      return [0.78, 1.15];
    case "stabs":
      return [0.92, 1.18];
    case "arp":
      return [1.0, 1.35];
    default:
      return [0.9, 1.28];
  }
}

/** Pull DNA toward the band's sweet spot — weirdness processed before playback. */
export function sanitizeComposerDna(
  dna: SceneDNA,
  brief: ComposerBrief,
  band: Band,
  family: MoodKey,
  fromMinedPackage: boolean,
): SceneDNA {
  const minedMul = fromMinedPackage ? 0.55 : 1;
  const [spreadLo, spreadHi] = compingSpreadCap(band.comping);
  const softKit = band.kit === "muted" || band.kit === "brushes" || band.kit === "heartbeat";

  const energyShape = brief.energyShapes.includes(dna.structure.energyShape)
    ? dna.structure.energyShape
    : brief.energyShapes[0];

  return {
    ...dna,
    timing: {
      ...dna.timing,
      humanize: Math.min(dna.timing.humanize, brief.maxHumanize),
      swingFeel: clamp(dna.timing.swingFeel, brief.swingRange[0], brief.swingRange[1]),
    },
    patterns: {
      ...dna.patterns,
      dropoutChance: Math.min(dna.patterns.dropoutChance, brief.dropoutCap),
      compingSpread: clamp(dna.patterns.compingSpread, spreadLo, spreadHi),
      fillDensity: Math.min(dna.patterns.fillDensity, brief.fillDensityCap),
      melodyPresence: clamp(
        dna.patterns.melodyPresence,
        brief.melodyPresenceRange[0],
        brief.melodyPresenceRange[1],
      ),
      kickVariation: softKit ? Math.min(dna.patterns.kickVariation, 0.32) : dna.patterns.kickVariation,
      restabChance: band.comping === "rolled" ? dna.patterns.restabChance : Math.min(dna.patterns.restabChance, 0.42),
      drumGhostMul: softKit ? Math.min(dna.patterns.drumGhostMul, 0.95) : dna.patterns.drumGhostMul,
    },
    melody: {
      ...dna.melody,
      mutationStrength: Math.min(
        dna.melody.mutationStrength * minedMul,
        brief.maxMutationStrength * (fromMinedPackage ? 0.85 : 1),
      ),
      stepJitter: Math.min(dna.melody.stepJitter, brief.maxStepJitter),
      contourBlend: Math.min(dna.melody.contourBlend, brief.maxContourBlend),
      octaveChance: Math.min(dna.melody.octaveChance, brief.maxOctaveChance),
      displacement: Math.min(dna.melody.displacement, 2),
      fragmentRatio: clamp(dna.melody.fragmentRatio, 0.42, 0.68),
      ornamentBias: clamp(dna.melody.ornamentBias, 0.75, 1.12),
      stretchBias: clamp(dna.melody.stretchBias, 0.96, 1.05),
    },
    harmony: {
      ...dna.harmony,
      reharmStrength: Math.min(dna.harmony.reharmStrength, brief.reharmCap),
      tritoneChance: family === "jazzy" ? Math.min(dna.harmony.tritoneChance, 0.22) : Math.min(dna.harmony.tritoneChance, 0.08),
      modalChance: Math.min(dna.harmony.modalChance, family === "jazzy" ? 0.18 : 0.08),
      passingChance: Math.min(dna.harmony.passingChance, family === "jazzy" ? 0.38 : 0.22),
    },
    structure: { energyShape },
    effects: {
      ...dna.effects,
      filterDipChance: Math.min(dna.effects.filterDipChance, family === "rainy" ? 0.16 : 0.12),
      popRate: family === "rainy" ? Math.min(dna.effects.popRate, 0.9) : dna.effects.popRate,
    },
  };
}

function sanitizeVariation(role: HarmonicRole, variation: MotifVariation): MotifVariation {
  if (role === "cadence" && (variation === "displaced" || variation === "ornament")) {
    return "fragment";
  }
  if (role === "setup") return "plain";
  return variation;
}

/** Tune slot presence and variations so the hook lands where the form expects it. */
function composeMelodySlots(
  slots: MelodySlot[],
  roles: HarmonicRole[],
  brief: ComposerBrief,
  behavior: MelodyBehavior,
): { slots: MelodySlot[]; tuned: number } {
  let tuned = 0;

  const out = slots.map((slot, i) => {
    const role = roles[i] ?? "color";
    let { phraseId, variation, presence } = slot;

    if (role === "setup" && phraseId === "A") {
      presence = Math.max(presence, brief.hookPresenceMin);
      variation = "plain";
      tuned++;
    } else if (role === "resolution") {
      presence = Math.max(presence, brief.resolutionPresenceMin);
      tuned++;
    } else if (role === "cadence") {
      presence = Math.max(presence, brief.cadencePresenceMin);
      variation = sanitizeVariation(role, variation);
      tuned++;
    } else if (role === "tension" && phraseId === "A" && behavior !== "sparse") {
      phraseId = "B";
      tuned++;
    } else {
      variation = sanitizeVariation(role, variation);
    }

    if (behavior === "sparse" && phraseId === "B") {
      presence *= 0.88;
    }

    return { phraseId, variation, presence: Math.min(1, presence) };
  });

  return { slots: out, tuned };
}

/** Give the A hook a clear peak and an early pickup window for the band. */
function sharpenHookPhrase(notes: MotifNote[]): MotifNote[] {
  if (notes.length === 0) return notes;

  let peakIdx = 0;
  let peakScore = -1;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const score = (n.accent ? 2 : 0) + n.vel + n.beats * 0.05;
    if (score > peakScore) {
      peakScore = score;
      peakIdx = i;
    }
  }

  return notes.map((n, i) => {
    let vel = n.vel;
    if (i === peakIdx) vel = Math.min(1, vel * 1.12);
    if (i === 0 && n.step > 6) {
      return { ...n, step: Math.min(n.step, 4), vel: vel * 1.05, pickup: true };
    }
    if (i === peakIdx) return { ...n, vel, accent: true };
    return { ...n, vel };
  });
}

function composeMelodyPlan(
  plan: MelodyPlan,
  progression: Scene["progression"],
  scale: Scene["scale"],
  brief: ComposerBrief,
  band: Band,
  seed: number,
): MelodyPlan {
  const slotWork = composeMelodySlots(
    plan.slots,
    plan.harmonicRoles,
    brief,
    band.melodyBehavior,
  );

  const phrases = {
    ...plan.phrases,
    A: sharpenHookPhrase(plan.phrases.A),
  };

  const answerShift = clamp(
    plan.answerShift,
    brief.answerShiftRange[0],
    brief.answerShiftRange[1],
  );

  const draft: MelodyPlan = {
    ...plan,
    phrases,
    slots: slotWork.slots,
    roundCycle: pickRoundCycle(brief, seed),
    answerShift,
  };

  return bindMelodyToProgression(draft, progression, scale);
}

/** Composer pass — runs after scene assembly, before the producer. */
export function composeArrangement(scene: Scene): Scene {
  const brief = composerBriefFor(scene.band, scene.family);
  const dna = sanitizeComposerDna(
    scene.dna,
    brief,
    scene.band,
    scene.family,
    scene.melodyPlan.fromMinedPackage,
  );

  const melodyPlan = composeMelodyPlan(
    scene.melodyPlan,
    scene.progression,
    scene.scale,
    brief,
    scene.band,
    scene.seed,
  );

  return {
    ...scene,
    dna,
    melodyPlan,
    motif: melodyPlan.phrases.A,
  };
}

/** @internal test hook */
export function composerDiagnostics(scene: Scene): ComposerNotes {
  const brief = composerBriefFor(scene.band, scene.family);
  const dna = sanitizeComposerDna(
    scene.dna,
    brief,
    scene.band,
    scene.family,
    scene.melodyPlan.fromMinedPackage,
  );
  const slots = composeMelodySlots(
    scene.melodyPlan.slots,
    scene.melodyPlan.harmonicRoles,
    brief,
    scene.band.melodyBehavior,
  );
  const beforeA = scene.melodyPlan.phrases.A;
  const shaped = sharpenHookPhrase(beforeA);
  const hookShaped =
    shaped.length !== beforeA.length
    || shaped.some((n, i) => n.vel !== beforeA[i]?.vel || n.step !== beforeA[i]?.step);

  return {
    archetype: brief.archetype,
    dnaClamped: countDnaClamps(scene.dna, dna),
    hookShaped,
    slotsTuned: slots.tuned,
  };
}
