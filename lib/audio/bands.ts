// Bands — who is playing tonight, and how. A band bundles an instrument
// for each role (chords, bass, melody, drums) with a playing style for
// that role, so variety comes from independent axes: harmony family ×
// band × grammar. Scenes pick a band weighted by mood family, and once
// in a while a guest musician sits in on melody.

import type { MoodKey } from "./moods";
import { chance, pick, weightedPick } from "./random";

export type ChordVoice =
  | "ep" | "fmep" | "organ" | "guitar" | "vibe" | "strings" | "pluck"
  | "marimba" | "choir" | "horn";
export type MelodyVoice =
  | "ep" | "fmep" | "pluck" | "guitar" | "vibe" | "bell"
  | "clarinet" | "horn" | "marimba" | "choir";
export type BassVoice = "sine" | "pluck" | "none";
export type CompingStyle = "rolled" | "sustained" | "stabs" | "arp" | "broken";
export type MelodyBehavior = "motif" | "arp" | "held" | "sparse";
export type BassStyle = "anchor" | "walking" | "either";
export type PulseVoice = "hat" | "shaker" | "brush";
export type KitId = "boomBap" | "slowMotion" | "bossa" | "brushes" | "heartbeat";

// ---- drum grammars -----------------------------------------------------------
// Step numbers index 16ths across a two-bar chord (0–31).

export interface DrumKit {
  kicks: number[];
  kickVel: number;
  kickGhosts?: { steps: number[]; p: number };
  backbeat: {
    steps: number[];
    voice: "snare" | "rim" | "brush";
    ghosts?: { steps: number[]; p: number };
  } | null;
  pulse: { voice: PulseVoice; every: number; accentEvery: number; p: number } | null;
  /** Occasional extra tick on the last 16th of a beat. */
  offbeat?: { voice: "hat" | "shaker"; p: number };
  fills: boolean;
}

export const KITS: Record<KitId, DrumKit> = {
  // the classic head-nod pattern (the engine's original grammar)
  boomBap: {
    kicks: [0, 10, 16, 21, 26],
    kickVel: 1,
    kickGhosts: { steps: [7, 30], p: 0.25 },
    backbeat: { steps: [8, 24], voice: "snare", ghosts: { steps: [29], p: 0.2 } },
    pulse: { voice: "hat", every: 2, accentEvery: 4, p: 0.93 },
    offbeat: { voice: "hat", p: 0.18 },
    fills: true,
  },
  // one heavy snare per two bars; everything floats
  slowMotion: {
    kicks: [0, 22],
    kickVel: 1.1,
    backbeat: { steps: [16], voice: "snare" },
    pulse: { voice: "hat", every: 8, accentEvery: 16, p: 0.9 },
    fills: false,
  },
  // dotted surdo-ish kick under a rim-click clave and steady shaker
  bossa: {
    kicks: [0, 6, 16, 22],
    kickVel: 0.7,
    backbeat: { steps: [0, 6, 12, 20, 26], voice: "rim" },
    pulse: { voice: "shaker", every: 2, accentEvery: 8, p: 0.95 },
    fills: false,
  },
  // soft kick, brushed backbeat, brushed eighth pulse
  brushes: {
    kicks: [0, 16],
    kickVel: 0.6,
    backbeat: { steps: [8, 24], voice: "brush" },
    pulse: { voice: "brush", every: 2, accentEvery: 4, p: 0.8 },
    fills: false,
  },
  // barely a beat: paired kicks like a pulse under the floorboards
  heartbeat: {
    kicks: [0, 16],
    kickVel: 0.9,
    kickGhosts: { steps: [10, 26], p: 0.4 },
    backbeat: null,
    pulse: { voice: "hat", every: 8, accentEvery: 16, p: 0.85 },
    fills: false,
  },
};

// ---- bands -------------------------------------------------------------------

export interface Band {
  id: string;
  name: string;
  chordVoice: ChordVoice;
  comping: CompingStyle;
  bassVoice: BassVoice;
  bassStyle: BassStyle;
  melodyVoice: MelodyVoice;
  melodyBehavior: MelodyBehavior;
  kit: KitId;
  /** Overrides the kit's pulse instrument (e.g. boom-bap with shaker). */
  pulseVoice?: PulseVoice;
  /** Chance the warm pad swells under the chords. */
  padChance: number;
  /** Tape lowpass range for this band's character. */
  tapeCutoff: [number, number];
  /** Relative likelihood per mood family. */
  weights: Record<MoodKey, number>;
}

const BANDS: Band[] = [
  {
    id: "tape-quartet",
    name: "tape quartet",
    chordVoice: "ep", comping: "rolled",
    bassVoice: "sine", bassStyle: "either",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "boomBap",
    padChance: 0.5,
    tapeCutoff: [2600, 3600],
    weights: { mellow: 1, jazzy: 0.7, rainy: 0.7 },
  },
  {
    id: "wurlitzer-trio",
    name: "wurlitzer trio",
    chordVoice: "fmep", comping: "stabs",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "fmep", melodyBehavior: "motif",
    kit: "boomBap", pulseVoice: "shaker",
    padChance: 0.25,
    tapeCutoff: [2800, 3800],
    weights: { mellow: 0.4, jazzy: 1, rainy: 0.25 },
  },
  {
    id: "nylon-loft",
    name: "nylon loft duo",
    chordVoice: "guitar", comping: "broken",
    bassVoice: "pluck", bassStyle: "anchor",
    melodyVoice: "guitar", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.2,
    tapeCutoff: [2400, 3200],
    weights: { mellow: 0.9, jazzy: 0.5, rainy: 0.6 },
  },
  {
    id: "midnight-organ",
    name: "midnight organ",
    chordVoice: "organ", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "bell", melodyBehavior: "held",
    kit: "slowMotion",
    padChance: 0,
    tapeCutoff: [2200, 3000],
    weights: { mellow: 0.2, jazzy: 0.35, rainy: 0.9 },
  },
  {
    id: "vibraphone-quartet",
    name: "vibraphone quartet",
    chordVoice: "vibe", comping: "rolled",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "vibe", melodyBehavior: "arp",
    kit: "brushes",
    padChance: 0.3,
    tapeCutoff: [3000, 4000],
    weights: { mellow: 0.45, jazzy: 0.9, rainy: 0.35 },
  },
  {
    id: "string-box",
    name: "string box",
    chordVoice: "strings", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "bell", melodyBehavior: "motif",
    kit: "slowMotion",
    padChance: 0,
    tapeCutoff: [2400, 3200],
    weights: { mellow: 0.5, jazzy: 0.1, rainy: 0.95 },
  },
  {
    id: "bossa-balcony",
    name: "bossa balcony",
    chordVoice: "guitar", comping: "stabs",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "bossa",
    padChance: 0.2,
    tapeCutoff: [2800, 3600],
    weights: { mellow: 0.7, jazzy: 0.9, rainy: 0.15 },
  },
  {
    id: "music-box-attic",
    name: "music box attic",
    chordVoice: "pluck", comping: "arp",
    bassVoice: "none", bassStyle: "anchor",
    melodyVoice: "bell", melodyBehavior: "motif",
    kit: "heartbeat",
    padChance: 0.4,
    tapeCutoff: [2600, 3400],
    weights: { mellow: 0.3, jazzy: 0.1, rainy: 0.85 },
  },
  {
    id: "marimba-garden",
    name: "marimba garden",
    chordVoice: "marimba", comping: "rolled",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "clarinet", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.35,
    tapeCutoff: [2800, 3800],
    weights: { mellow: 0.7, jazzy: 0.6, rainy: 0.5 },
  },
  {
    id: "chapel-choir",
    name: "chapel choir",
    chordVoice: "choir", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "horn", melodyBehavior: "held",
    kit: "slowMotion",
    padChance: 0.15,
    tapeCutoff: [2200, 3000],
    weights: { mellow: 0.6, jazzy: 0.2, rainy: 0.85 },
  },
  {
    id: "brass-midnight",
    name: "brass midnight",
    chordVoice: "horn", comping: "stabs",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "clarinet", melodyBehavior: "sparse",
    kit: "slowMotion",
    padChance: 0.25,
    tapeCutoff: [2400, 3200],
    weights: { mellow: 0.5, jazzy: 0.75, rainy: 0.4 },
  },
  {
    id: "marimba-attic",
    name: "marimba attic",
    chordVoice: "marimba", comping: "arp",
    bassVoice: "pluck", bassStyle: "anchor",
    melodyVoice: "marimba", melodyBehavior: "arp",
    kit: "heartbeat",
    padChance: 0.3,
    tapeCutoff: [2600, 3600],
    weights: { mellow: 0.55, jazzy: 0.4, rainy: 0.7 },
  },
];

// ---- guest musicians ----------------------------------------------------------

const GUEST_NAMES: Record<MelodyVoice, string> = {
  ep: "tape keys",
  fmep: "wurlitzer",
  pluck: "kalimba",
  guitar: "nylon guitar",
  vibe: "vibraphone",
  bell: "music box",
  clarinet: "clarinet",
  horn: "muted horn",
  marimba: "marimba",
  choir: "choir",
};

const GUEST_ALTS: Record<MelodyVoice, MelodyVoice[]> = {
  ep: ["vibe", "guitar", "bell", "fmep", "clarinet"],
  fmep: ["vibe", "bell", "pluck", "clarinet"],
  pluck: ["bell", "guitar", "ep", "marimba"],
  guitar: ["pluck", "vibe", "ep", "clarinet"],
  vibe: ["ep", "guitar", "bell", "marimba"],
  bell: ["pluck", "vibe", "clarinet", "horn"],
  clarinet: ["horn", "bell", "marimba", "ep"],
  horn: ["clarinet", "bell", "choir"],
  marimba: ["vibe", "pluck", "clarinet"],
  choir: ["horn", "bell", "clarinet"],
};

/**
 * Picks a band for a scene (weighted by mood family, never the same base
 * band twice in a row), occasionally swapping in a guest on melody.
 */
export function assembleBand(family: MoodKey, prevId?: string): Band {
  const pool = BANDS.filter((b) => b.id !== prevId);
  const base = weightedPick(pool, (b) => b.weights[family]);
  const band = { ...base };
  if (chance(0.3)) {
    const alts = GUEST_ALTS[band.melodyVoice].filter(
      (v) => (v as string) !== (band.chordVoice as string),
    );
    if (alts.length > 0) {
      const guest = pick(alts);
      band.melodyVoice = guest;
      band.name = `${base.name} ft. ${GUEST_NAMES[guest]}`;
    }
  }
  return band;
}
