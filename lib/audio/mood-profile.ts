// Per-mood identity — tempo envelope, production, DNA ranges, and band bias.
// Keeps mellow / jazzy / rainy audibly distinct instead of overlapping lofi beds.

import type { Band, KitId } from "./bands";
import type { MoodKey } from "./moods";
import { chance, weightedPick } from "./random";

export interface MoodProduction {
  /** Multiplier on band tapeCutoff range (lower = darker). */
  tapeCutoffMul: number;
  reverbSendMul: number;
  reverbDecayMul: number;
  reverbDampMul: number;
  delayWet: [number, number];
  delayFeedback: [number, number];
  /** Scales band.padChance contribution to padOn. */
  padChanceMul: number;
  wobbleCents: [number, number];
  textureBusGain: number;
}

export interface MoodProfile {
  /** Triplet swing amount before DNA swingFeel. */
  swing: [number, number];
  production: MoodProduction;
  preferredKits: readonly KitId[];
  /** Minimum band weight to enter the selection pool (fallback if empty). */
  bandWeightFloor: number;
}

export const MOOD_PROFILES: Record<MoodKey, MoodProfile> = {
  mellow: {
    swing: [0.52, 0.6],
    production: {
      tapeCutoffMul: 1.05,
      reverbSendMul: 1.0,
      reverbDecayMul: 1.0,
      reverbDampMul: 1.0,
      delayWet: [0.3, 0.4],
      delayFeedback: [0.38, 0.48],
      padChanceMul: 0.85,
      wobbleCents: [5, 11],
      textureBusGain: 0.62,
    },
    preferredKits: ["pocket", "boomBap", "slowMotion"],
    bandWeightFloor: 0.55,
  },
  jazzy: {
    swing: [0.58, 0.72],
    production: {
      tapeCutoffMul: 1.18,
      reverbSendMul: 0.78,
      reverbDecayMul: 0.82,
      reverbDampMul: 1.12,
      delayWet: [0.18, 0.28],
      delayFeedback: [0.28, 0.38],
      padChanceMul: 0.55,
      wobbleCents: [3, 8],
      textureBusGain: 0.48,
    },
    preferredKits: ["punchy", "bossa", "pocket"],
    bandWeightFloor: 0.45,
  },
  rainy: {
    swing: [0.42, 0.52],
    production: {
      tapeCutoffMul: 0.82,
      reverbSendMul: 1.35,
      reverbDecayMul: 1.55,
      reverbDampMul: 0.72,
      delayWet: [0.42, 0.58],
      delayFeedback: [0.48, 0.62],
      padChanceMul: 1.35,
      wobbleCents: [6, 14],
      textureBusGain: 0.74,
    },
    preferredKits: ["muted", "heartbeat", "brushes", "slowMotion"],
    bandWeightFloor: 0.5,
  },
};

const JAZZ_VOICES = new Set(["ep", "fmep", "wurli", "clav", "vibe", "horn", "marimba"]);
const MELLOW_KITS = new Set<KitId>(["pocket", "boomBap", "slowMotion"]);
const JAZZ_KITS = new Set<KitId>(["punchy", "bossa", "pocket"]);
const RAINY_KITS = new Set<KitId>(["muted", "heartbeat", "brushes", "slowMotion"]);

/** Exaggerate band weights so each mood pulls from its own corner of the roster. */
export function bandWeightForMood(band: Band, family: MoodKey): number {
  let w = band.weights[family] ** 2.4;
  const kit = band.kit;

  if (family === "mellow") {
    if (band.chordVoice === "piano") w *= 1.35;
    if (band.melodyBehavior === "motif") w *= 1.15;
    if (MELLOW_KITS.has(kit)) w *= 1.45;
    if (kit === "punchy" || kit === "bossa") w *= 0.45;
    if (band.comping === "broken" || band.comping === "rolled") w *= 1.12;
  } else if (family === "jazzy") {
    if (JAZZ_VOICES.has(band.melodyVoice)) w *= 1.4;
    if (JAZZ_KITS.has(kit)) w *= 1.5;
    if (kit === "muted" || kit === "heartbeat" || kit === "brushes") w *= 0.5;
    if (band.comping === "stabs") w *= 1.2;
    if (band.bassStyle === "walking") w *= 1.15;
  } else {
    if (RAINY_KITS.has(kit)) w *= 1.55;
    if (kit === "punchy" || kit === "bossa") w *= 0.35;
    if (band.melodyBehavior === "held") w *= 1.3;
    if (band.padChance >= 0.82) w *= 1.25;
    if (band.chordVoice === "piano" && band.melodyBehavior !== "sparse") w *= 1.2;
  }

  if (band.chordVoice === "piano") w *= 1.25;
  if (band.melodyVoice === "piano") w *= 1.15;
  return w;
}

/** Prefer mood-appropriate drum grammar when the band's kit is a poor fit. */
export function moodBandWithKit(family: MoodKey, band: Band): Band {
  const profile = MOOD_PROFILES[family];
  if (profile.preferredKits.includes(band.kit) || !chance(0.5)) return band;
  const kit = weightedPick([...profile.preferredKits], () => 1);
  return { ...band, kit };
}
