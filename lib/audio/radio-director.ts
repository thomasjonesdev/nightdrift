// Station-level memory and segue planning — scenes feel like a curated
// broadcast rather than independent random draws.

import type { AmbienceBed } from "./ambience";
import type { EnergyShape, EnvironmentDNA, SceneDNA } from "./drift-algorithm";
import type { MoodKey } from "./moods";
import { pick, weightedPick } from "./random";
import type { Scene } from "./scenes";

const MOOD_KEYS: MoodKey[] = ["mellow", "jazzy", "rainy"];
const HISTORY_CAP = 6;

export interface SceneMemory {
  family: MoodKey;
  bandId: string;
  keyPc: number;
  energyShape: EnergyShape;
  bpm: number;
  tapeCutoff: number;
}

export interface RadioState {
  /** Recent scenes, oldest first. */
  history: SceneMemory[];
}

export type SegueStrategy = "continue" | "complement" | "contrast";

export type InheritTrait = "timing" | "effects" | "environment" | "tape";

export interface SegueHints {
  strategy: SegueStrategy;
  /** Preferred tonic when available in the family key pool. */
  keyPc?: number;
  /** Anchor BPM near the previous scene. */
  bpmAnchor?: number;
  /** Band ids to deprioritize (recent airplay). */
  avoidBandIds?: string[];
  /** One DNA slice inherited from the previous scene. */
  inheritTrait?: InheritTrait;
}

export interface SeguePlan {
  family: MoodKey;
  hints: SegueHints;
}

/** Beatless bars between scenes — tempo morph hides inside this window. */
export const SEGUE_BRIDGE_STEPS = 16;

const FAMILY_TRANSITIONS: Record<MoodKey, [MoodKey, number][]> = {
  mellow: [
    ["mellow", 0.72],
    ["rainy", 0.18],
    ["jazzy", 0.1],
  ],
  jazzy: [
    ["jazzy", 0.68],
    ["mellow", 0.2],
    ["rainy", 0.12],
  ],
  rainy: [
    ["rainy", 0.7],
    ["mellow", 0.22],
    ["jazzy", 0.08],
  ],
};

export function createRadioState(): RadioState {
  return { history: [] };
}

export function recordScene(state: RadioState, scene: Scene): RadioState {
  const entry: SceneMemory = {
    family: scene.family,
    bandId: scene.band.id,
    keyPc: scene.keyPc,
    energyShape: scene.dna.structure.energyShape,
    bpm: scene.bpm,
    tapeCutoff: scene.tapeCutoff,
  };
  return { history: [...state.history, entry].slice(-HISTORY_CAP) };
}

function recentBandIds(state: RadioState, depth = 3): string[] {
  return state.history.slice(-depth).map((m) => m.bandId);
}

function familyWeight(
  family: MoodKey,
  state: RadioState,
  prevFamily: MoodKey,
  steered: MoodKey | null,
): number {
  if (steered && family === steered) return 4;
  const base = FAMILY_TRANSITIONS[prevFamily].find(([f]) => f === family)?.[1] ?? 0.15;
  const recent = state.history.filter((m) => m.family === family).length;
  return base * Math.pow(0.55, recent);
}

/** Resolve the next mood family — listener steer wins; otherwise weighted drift. */
export function resolveSegueFamily(
  state: RadioState,
  prev: Scene,
  steered: MoodKey | null,
): MoodKey {
  if (steered && steered !== prev.family) return steered;
  if (steered) return steered;
  return weightedPick(MOOD_KEYS, (f) => familyWeight(f, state, prev.family, steered));
}

function pickStrategy(prev: Scene, state: RadioState): SegueStrategy {
  const sameFamilyStreak = [...state.history].reverse().findIndex((m) => m.family !== prev.family);
  const streak = sameFamilyStreak === -1 ? state.history.length : sameFamilyStreak;
  if (streak >= 3) return pick(["contrast", "complement"] as const);
  if (prev.dna.structure.energyShape === "plateau") return pick(["complement", "continue"] as const);
  return weightedPick(
    ["continue", "complement", "contrast"] as const,
    (s) => (s === "continue" ? 2.5 : s === "complement" ? 1.5 : 0.8),
  );
}

function pickInheritTrait(prev: Scene): InheritTrait {
  return weightedPick(
    ["tape", "timing", "effects", "environment"] as const,
    (t) => {
      if (t === "tape") return prev.family === "mellow" ? 2.2 : 1.4;
      if (t === "environment") return prev.ambience.bed !== "none" ? 1.8 : 0.9;
      return 1;
    },
  );
}

function complementaryKey(prevPc: number, keys: readonly number[]): number {
  const fifth = (prevPc + 7) % 12;
  const fourth = (prevPc + 5) % 12;
  const relative = (prevPc + 9) % 12;
  for (const candidate of [fifth, fourth, relative]) {
    if (keys.includes(candidate) && candidate !== prevPc) return candidate;
  }
  const pool = keys.filter((k) => k !== prevPc);
  return pool.length > 0 ? pick(pool) : prevPc;
}

function contrastingKey(prevPc: number, keys: readonly number[]): number {
  const scored = keys
    .filter((k) => k !== prevPc)
    .map((k) => ({
      k,
      dist: Math.min((k - prevPc + 12) % 12, (prevPc - k + 12) % 12),
    }))
    .sort((a, b) => b.dist - a.dist);
  return scored[0]?.k ?? pick(keys);
}

/** Plan segue character from station memory and the previous scene. */
export function planSegue(
  state: RadioState,
  prev: Scene,
  steeredFamily: MoodKey | null,
  familyKeys: readonly number[],
): SeguePlan {
  const family = resolveSegueFamily(state, prev, steeredFamily);
  const strategy = pickStrategy(prev, state);
  const inheritTrait = pickInheritTrait(prev);

  let keyPc: number | undefined;
  if (strategy === "complement") keyPc = complementaryKey(prev.keyPc, familyKeys);
  else if (strategy === "contrast") keyPc = contrastingKey(prev.keyPc, familyKeys);

  return {
    family,
    hints: {
      strategy,
      keyPc,
      bpmAnchor: prev.bpm,
      avoidBandIds: recentBandIds(state),
      inheritTrait,
    },
  };
}

function blend(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cross one DNA trait from the previous scene into the new genotype. */
export function crossoverDna(prev: Scene, dna: SceneDNA, trait: InheritTrait): SceneDNA {
  const p = prev.dna;
  switch (trait) {
    case "timing":
      return {
        ...dna,
        timing: {
          ...dna.timing,
          humanize: blend(p.timing.humanize, dna.timing.humanize, 0.55),
          melodyLayback: blend(p.timing.melodyLayback, dna.timing.melodyLayback, 0.5),
          swingFeel: blend(p.timing.swingFeel, dna.timing.swingFeel, 0.45),
        },
      };
    case "effects":
      return {
        ...dna,
        effects: {
          ...dna.effects,
          filterDipChance: blend(p.effects.filterDipChance, dna.effects.filterDipChance, 0.5),
          duckMul: blend(p.effects.duckMul, dna.effects.duckMul, 0.45),
          popRate: blend(p.effects.popRate, dna.effects.popRate, 0.4),
        },
      };
    case "environment":
      return {
        ...dna,
        environment: {
          ...dna.environment,
          eventRate: blend(p.environment.eventRate, dna.environment.eventRate, 0.5),
          bedMovement: blend(p.environment.bedMovement, dna.environment.bedMovement, 0.55),
        },
      };
    case "tape":
      return {
        ...dna,
        effects: {
          ...dna.effects,
          filterDipChance: blend(p.effects.filterDipChance, dna.effects.filterDipChance, 0.35),
          reverbSwell: blend(p.effects.reverbSwell, dna.effects.reverbSwell, 0.4),
        },
        timing: {
          ...dna.timing,
          humanize: blend(p.timing.humanize, dna.timing.humanize, 0.35),
        },
      };
  }
}

/** Nudge tape/reverb toward the previous scene's broadcast character. */
export function applyTapeContinuity(prev: Scene, scene: Scene, strategy: SegueStrategy): Scene {
  const mix = strategy === "continue" ? 0.62 : strategy === "complement" ? 0.38 : 0.18;
  return {
    ...scene,
    tapeCutoff: blend(prev.tapeCutoff, scene.tapeCutoff, 1 - mix),
    wobbleCents: blend(prev.wobbleCents, scene.wobbleCents, 1 - mix * 0.7),
    wobbleRate: blend(prev.wobbleRate, scene.wobbleRate, 1 - mix * 0.5),
    reverbSend: blend(prev.reverbSend, scene.reverbSend, 1 - mix * 0.55),
    reverbDecay: blend(prev.reverbDecay, scene.reverbDecay, 1 - mix * 0.45),
    reverbDamp: blend(prev.reverbDamp, scene.reverbDamp, 1 - mix * 0.4),
  };
}

// ---- ambient event scheduling -----------------------------------------------

export type AmbientEventKind =
  | "thunder"
  | "train"
  | "owl"
  | "chimes"
  | "crickets"
  | "motif-bells";

export interface EventScheduleState {
  lastEventAt: number;
  lastByKind: Partial<Record<AmbientEventKind, number>>;
}

export function createEventScheduleState(): EventScheduleState {
  return { lastEventAt: -Infinity, lastByKind: {} };
}

const EVENT_KIND_COOLDOWN: Record<AmbientEventKind, number> = {
  thunder: 120,
  train: 180,
  owl: 90,
  chimes: 75,
  crickets: 100,
  "motif-bells": 110,
};

/** Poisson-style gate — hazard rises with elapsed time and eventRate. */
export function ambientEventDue(
  t: number,
  state: EventScheduleState,
  env: EnvironmentDNA,
  roll: () => number,
): boolean {
  const elapsed = t - state.lastEventAt;
  if (elapsed < 35 / env.eventRate) return false;
  const lambda = 0.011 * env.eventRate;
  const p = 1 - Math.exp(-lambda * elapsed);
  return roll() < Math.min(0.82, p);
}

export function pickAmbientEventKind(
  bed: AmbienceBed,
  family: MoodKey,
  state: EventScheduleState,
  t: number,
  pickFrom: <T>(items: readonly T[]) => T,
): AmbientEventKind {
  const candidates: AmbientEventKind[] = [];
  const push = (kind: AmbientEventKind, weight: number) => {
    const last = state.lastByKind[kind] ?? -Infinity;
    if (t - last < EVENT_KIND_COOLDOWN[kind]) return;
    for (let i = 0; i < weight; i++) candidates.push(kind);
  };

  if (bed === "rain") push("thunder", 3);
  if (bed === "city") push("train", 2);
  if (bed === "wind" || bed === "fire") {
    push("owl", 2);
    push("chimes", 2);
  }
  if (family === "mellow") push("crickets", 2);
  push("motif-bells", 1);

  return candidates.length > 0 ? pickFrom(candidates) : "motif-bells";
}

export function markAmbientEvent(state: EventScheduleState, t: number, kind: AmbientEventKind): EventScheduleState {
  return {
    lastEventAt: t,
    lastByKind: { ...state.lastByKind, [kind]: t },
  };
}

/** Interpolate BPM across the beatless bridge window. */
export function bridgeBpm(fromBpm: number, toBpm: number, stepsRemaining: number): number {
  const progress = 1 - stepsRemaining / SEGUE_BRIDGE_STEPS;
  return fromBpm + (toBpm - fromBpm) * progress;
}
