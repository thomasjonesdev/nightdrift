// Intra-scene evolution — round-indexed DNA modifiers, automation, fills,
// and melody arcs so a scene breathes across its 3–5 passes.

import type { PatternDNA, SceneDNA } from "./drift-algorithm";
import type { MotifVariation } from "./melodies";
import { bassThinMultiplier } from "./round-form";
import type { Rng } from "./rng";

export interface RoundModifiers {
  dropoutChance: number;
  fillIntensity: number;
  melodyPresence: number;
  restabChance: number;
  drumGhostMul: number;
  /** 0–1 — scales bass velocity on the final round. */
  bassThinMul: number;
  /** 0–1 — probability each non-downbeat comping hit plays. */
  compingKeep: number;
}

export interface DrumFillHit {
  step: number;
  voice: "snare" | "hat";
  velScale: number;
  /** Extra 16ths after the step. */
  offset16ths?: number;
}

export interface DrumFillGrammar {
  probability: number;
  hits: DrumFillHit[];
}

export interface AutomationPalette {
  tapeCutoff: number;
  reverbSend: number;
  ambienceMovement: number;
  ambienceLevel: number;
  ambienceSecondaryWeight: number;
}

export interface SceneEvolution {
  round: number;
  modifiers: RoundModifiers;
  roundCycle: MotifVariation[];
  fillGrammar: DrumFillGrammar;
}

const VARIATION_POOL: MotifVariation[] = ["lift", "displaced", "ornament", "answer"];

/** Round-indexed pattern modifiers derived from base DNA. */
export function computeRoundModifiers(
  patterns: PatternDNA,
  round: number,
  totalRounds: number,
): RoundModifiers {
  const last = totalRounds - 1;
  const t = last <= 0 ? 0 : round / last;
  const midPeak = 1 - Math.abs(t - 0.5) * 2;

  return {
    dropoutChance: patterns.dropoutChance * (0.55 + 0.85 * t),
    fillIntensity: patterns.fillIntensity * (0.45 + 0.95 * midPeak),
    melodyPresence:
      patterns.melodyPresence
      * (round === 0
        ? 0.88
        : round === last
          ? 0.8
          : round <= 2
            ? 1.08
            : 0.96 + 0.06 * midPeak),
    restabChance: patterns.restabChance * (0.65 + 0.45 * midPeak),
    drumGhostMul: patterns.drumGhostMul * (0.8 + 0.35 * midPeak),
    bassThinMul: bassThinMultiplier(round, totalRounds),
    compingKeep: round === 0 ? 0.9 : round === last ? 0.68 : 0.84 + 0.16 * midPeak,
  };
}

/** End-of-round drum fill template for this round in the arc. */
export function drumFillGrammar(
  round: number,
  totalRounds: number,
  fillIntensity: number,
): DrumFillGrammar {
  const last = totalRounds - 1;
  if (round <= 0 || fillIntensity <= 0) {
    return { probability: 0, hits: [] };
  }
  if (round === last) {
    return {
      probability: Math.min(0.35, 0.1 * fillIntensity),
      hits: [{ step: 30, voice: "snare", velScale: 0.75 }],
    };
  }
  if (round === 1) {
    return {
      probability: Math.min(0.45, 0.22 * fillIntensity),
      hits: [
        { step: 28, voice: "snare", velScale: 0.85 },
        { step: 30, voice: "hat", velScale: 0.9, offset16ths: 0.5 },
      ],
    };
  }
  return {
    probability: Math.min(0.55, 0.32 * fillIntensity),
    hits: [
      { step: 26, voice: "snare", velScale: 0.8 },
      { step: 28, voice: "hat", velScale: 0.85 },
      { step: 30, voice: "snare", velScale: 0.88 },
      { step: 31, voice: "hat", velScale: 0.92, offset16ths: 0.5 },
    ],
  };
}

/** Shift round-cycle variations from round 3 onward (round 2 uses plan defaults). */
export function evolveRoundCycle(
  base: MotifVariation[],
  melody: SceneDNA["melody"],
  rng: Rng,
): MotifVariation[] {
  return base.map((v, i) => {
    if (i === 0 || v === "fragment" || v === "plain") return v;
    if (rng.chance(melody.mutationStrength * 0.35)) return rng.pick(VARIATION_POOL);
    return v;
  });
}

export interface EvolutionSceneInput {
  rounds: number;
  dna: SceneDNA;
  melodyPlan: { roundCycle: MotifVariation[] };
  tapeCutoff: number;
  reverbSend: number;
  ambience: { movement?: number; level: number; secondary?: { weight: number } };
}

/** Build evolution state for a given round (0 = scene start). */
export function evolveForRound(
  scene: EvolutionSceneInput,
  round: number,
  rng: Rng | null,
  prev?: SceneEvolution,
): SceneEvolution {
  const modifiers = computeRoundModifiers(scene.dna.patterns, round, scene.rounds);
  let roundCycle = prev?.roundCycle ?? [...scene.melodyPlan.roundCycle];
  if (round === 0) {
    roundCycle = [...scene.melodyPlan.roundCycle];
  } else if (round >= 3 && rng) {
    roundCycle = evolveRoundCycle(roundCycle, scene.dna.melody, rng);
  }
  return {
    round,
    modifiers,
    roundCycle,
    fillGrammar: drumFillGrammar(round, scene.rounds, modifiers.fillIntensity),
  };
}

/** Energy-linked mix automation for the current chord. */
export function energyAutomation(
  scene: EvolutionSceneInput,
  round: number,
  chordIdx: number,
  energy: number,
): AutomationPalette {
  const breath = 0.9 + 0.1 * Math.sin((round * 4 + chordIdx) * Math.PI / 4);
  const energyW = 0.72 + 0.28 * energy;
  let secondaryW = (scene.ambience.secondary?.weight ?? 0) * (0.55 + 0.45 * energy);
  if (scene.dna.structure.energyShape === "breathe") {
    secondaryW *= 0.85 + 0.15 * Math.sin((round * 4 + chordIdx) * Math.PI / 6);
  }
  return {
    tapeCutoff: scene.tapeCutoff * (0.86 + 0.14 * energy) * breath,
    reverbSend: scene.reverbSend * (0.88 + 0.38 * energy),
    ambienceMovement: (scene.ambience.movement ?? 1) * (0.7 + 0.45 * energy),
    ambienceLevel: scene.ambience.level * energyW,
    ambienceSecondaryWeight: secondaryW,
  };
}

export function initSceneEvolution(scene: EvolutionSceneInput): SceneEvolution {
  return evolveForRound(scene, 0, null);
}
