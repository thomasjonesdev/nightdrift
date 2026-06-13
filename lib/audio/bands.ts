// Bands — who is playing tonight, and how. A band bundles an instrument
// for each role (chords, bass, melody, drums) with a playing style for
// that role, so variety comes from independent axes: harmony family ×
// band × grammar. Scenes pick a band weighted by mood family, and once
// in a while a guest musician sits in on melody.

import type { MoodKey } from "./moods";
import { chance, pick, weightedPick } from "./random";
import type { ReverbSpec } from "./reverb";

export type ChordVoice =
  | "ep" | "fmep" | "organ" | "guitar" | "vibe" | "strings" | "pluck"
  | "marimba" | "choir" | "horn"
  | "wurli" | "clav" | "harp" | "piano" | "accordion" | "cello"
  | "flute" | "celeste" | "synth" | "oboe";
export type MelodyVoice =
  | "ep" | "fmep" | "pluck" | "guitar" | "vibe" | "bell"
  | "clarinet" | "horn" | "marimba" | "choir"
  | "organ" | "strings"
  | "wurli" | "clav" | "harp" | "piano" | "cello"
  | "flute" | "celeste" | "synth" | "oboe";
export type BassVoice = "sine" | "pluck" | "bassGuitar" | "none";
export type CompingStyle = "rolled" | "sustained" | "stabs" | "arp" | "broken";
export type MelodyBehavior = "motif" | "arp" | "held" | "sparse";
/** "groove" repeats the scene's two-bar bass riff — see makeBassRiff in scenes.ts. */
export type BassStyle = "anchor" | "walking" | "groove" | "either";
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
  /** Optional soft upper-voice doubling — a complementary timbre for cohesion. */
  harmonyVoice?: ChordVoice;
  /** Likelihood the harmony layer plays each chord (defaults to 0.55 when set). */
  harmonyChance?: number;
  /** Tape lowpass range for this band's character. */
  tapeCutoff: [number, number];
  /** Room size and wetness — resolved per scene like tapeCutoff. */
  reverb: ReverbSpec;
  /** Relative likelihood per mood family. */
  weights: Record<MoodKey, number>;
}

const BANDS: Band[] = [
  {
    id: "tape-quartet",
    name: "tape quartet",
    chordVoice: "ep", comping: "rolled",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "boomBap",
    padChance: 0.5,
    harmonyVoice: "strings",
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.22, 0.32], decay: [1.8, 2.4], damp: [2800, 3800] },
    weights: { mellow: 1, jazzy: 0.7, rainy: 0.7 },
  },
  {
    id: "wurlitzer-trio",
    name: "wurlitzer trio",
    chordVoice: "fmep", comping: "stabs",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "fmep", melodyBehavior: "motif",
    kit: "boomBap", pulseVoice: "shaker",
    padChance: 0.25,
    harmonyVoice: "vibe",
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.12, 0.22], decay: [1.2, 1.8], damp: [3200, 4500] },
    weights: { mellow: 0.4, jazzy: 1, rainy: 0.25 },
  },
  {
    id: "nylon-loft",
    name: "nylon loft duo",
    chordVoice: "guitar", comping: "broken",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "guitar", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.2,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.18, 0.28], decay: [1.4, 2.0], damp: [2600, 3600] },
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
    reverb: { send: [0.32, 0.44], decay: [3.5, 4.8], damp: [1800, 2600] },
    weights: { mellow: 0.2, jazzy: 0.35, rainy: 0.9 },
  },
  {
    id: "vibraphone-quartet",
    name: "vibraphone quartet",
    chordVoice: "vibe", comping: "rolled",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "vibe", melodyBehavior: "arp",
    kit: "brushes",
    padChance: 0.3,
    harmonyVoice: "harp",
    tapeCutoff: [3000, 4000],
    reverb: { send: [0.26, 0.36], decay: [2.2, 3.0], damp: [3000, 4200] },
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
    reverb: { send: [0.30, 0.40], decay: [3.0, 4.2], damp: [2000, 3000] },
    weights: { mellow: 0.5, jazzy: 0.1, rainy: 0.95 },
  },
  {
    id: "bossa-balcony",
    name: "bossa balcony",
    chordVoice: "guitar", comping: "stabs",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "bossa",
    padChance: 0.2,
    tapeCutoff: [2800, 3600],
    reverb: { send: [0.20, 0.30], decay: [1.6, 2.2], damp: [3500, 4800] },
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
    reverb: { send: [0.14, 0.24], decay: [1.0, 1.6], damp: [2400, 3400] },
    weights: { mellow: 0.3, jazzy: 0.1, rainy: 0.85 },
  },
  {
    id: "marimba-garden",
    name: "marimba garden",
    chordVoice: "marimba", comping: "rolled",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "clarinet", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.35,
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.24, 0.34], decay: [2.0, 2.8], damp: [3200, 4400] },
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
    harmonyVoice: "cello",
    tapeCutoff: [2200, 3000],
    reverb: { send: [0.36, 0.48], decay: [4.0, 5.5], damp: [1600, 2400] },
    weights: { mellow: 0.6, jazzy: 0.2, rainy: 0.85 },
  },
  {
    id: "brass-midnight",
    name: "brass midnight",
    chordVoice: "horn", comping: "stabs",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "clarinet", melodyBehavior: "sparse",
    kit: "slowMotion",
    padChance: 0.25,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.28, 0.38], decay: [2.4, 3.4], damp: [2200, 3200] },
    weights: { mellow: 0.5, jazzy: 0.75, rainy: 0.4 },
  },
  {
    id: "basement-session",
    name: "basement session",
    chordVoice: "ep", comping: "stabs",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "guitar", melodyBehavior: "motif",
    kit: "boomBap",
    padChance: 0.3,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.16, 0.26], decay: [1.4, 2.0], damp: [2800, 3800] },
    weights: { mellow: 0.8, jazzy: 0.9, rainy: 0.4 },
  },
  {
    id: "low-light-combo",
    name: "low light combo",
    chordVoice: "vibe", comping: "rolled",
    bassVoice: "bassGuitar", bassStyle: "either",
    melodyVoice: "fmep", melodyBehavior: "sparse",
    kit: "slowMotion",
    padChance: 0.35,
    tapeCutoff: [2400, 3400],
    reverb: { send: [0.24, 0.34], decay: [2.2, 3.0], damp: [2400, 3400] },
    weights: { mellow: 0.5, jazzy: 0.6, rainy: 0.8 },
  },
  {
    id: "marimba-attic",
    name: "marimba attic",
    chordVoice: "marimba", comping: "arp",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "marimba", melodyBehavior: "arp",
    kit: "heartbeat",
    padChance: 0.3,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.16, 0.26], decay: [1.2, 1.9], damp: [2600, 3600] },
    weights: { mellow: 0.55, jazzy: 0.4, rainy: 0.7 },
  },
  {
    id: "felt-piano-trio",
    name: "felt piano trio",
    chordVoice: "piano", comping: "broken",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "piano", melodyBehavior: "motif",
    kit: "slowMotion",
    padChance: 0.35,
    harmonyVoice: "strings",
    harmonyChance: 0.65,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.26, 0.36], decay: [2.4, 3.2], damp: [2200, 3200] },
    weights: { mellow: 0.85, jazzy: 0.3, rainy: 0.75 },
  },
  {
    id: "wurli-lounge",
    name: "wurli lounge",
    chordVoice: "wurli", comping: "stabs",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "wurli", melodyBehavior: "motif",
    kit: "boomBap", pulseVoice: "shaker",
    padChance: 0.3,
    harmonyVoice: "vibe",
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.18, 0.28], decay: [1.6, 2.2], damp: [3000, 4200] },
    weights: { mellow: 0.55, jazzy: 0.95, rainy: 0.3 },
  },
  {
    id: "clav-cellar",
    name: "clav cellar",
    chordVoice: "clav", comping: "stabs",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "clav", melodyBehavior: "sparse",
    kit: "boomBap",
    padChance: 0.15,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.14, 0.22], decay: [1.2, 1.8], damp: [2800, 4000] },
    weights: { mellow: 0.45, jazzy: 0.85, rainy: 0.2 },
  },
  {
    id: "harp-porch",
    name: "harp porch",
    chordVoice: "harp", comping: "arp",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "harp", melodyBehavior: "arp",
    kit: "brushes",
    padChance: 0.4,
    harmonyVoice: "guitar",
    harmonyChance: 0.7,
    tapeCutoff: [2600, 3400],
    reverb: { send: [0.22, 0.32], decay: [2.0, 2.8], damp: [2600, 3600] },
    weights: { mellow: 0.8, jazzy: 0.45, rainy: 0.55 },
  },
  {
    id: "accordion-street",
    name: "accordion street",
    chordVoice: "accordion", comping: "sustained",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "clarinet", melodyBehavior: "motif",
    kit: "bossa",
    padChance: 0.1,
    harmonyVoice: "cello",
    harmonyChance: 0.6,
    tapeCutoff: [2200, 3000],
    reverb: { send: [0.28, 0.38], decay: [2.6, 3.6], damp: [2000, 3000] },
    weights: { mellow: 0.5, jazzy: 0.7, rainy: 0.45 },
  },
  {
    id: "cello-parlor",
    name: "cello parlor",
    chordVoice: "cello", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "cello", melodyBehavior: "held",
    kit: "slowMotion",
    padChance: 0.2,
    harmonyVoice: "strings",
    harmonyChance: 0.75,
    tapeCutoff: [2100, 2900],
    reverb: { send: [0.34, 0.44], decay: [3.2, 4.4], damp: [1800, 2600] },
    weights: { mellow: 0.65, jazzy: 0.25, rainy: 0.9 },
  },
  {
    id: "flute-meadow",
    name: "flute meadow",
    chordVoice: "guitar", comping: "broken",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "flute", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.45,
    harmonyVoice: "harp",
    tapeCutoff: [2500, 3300],
    reverb: { send: [0.24, 0.34], decay: [2.2, 3.0], damp: [2800, 3800] },
    weights: { mellow: 0.75, jazzy: 0.35, rainy: 0.5 },
  },
  {
    id: "celeste-belfry",
    name: "celeste belfry",
    chordVoice: "pluck", comping: "arp",
    bassVoice: "none", bassStyle: "anchor",
    melodyVoice: "celeste", melodyBehavior: "motif",
    kit: "heartbeat",
    padChance: 0.5,
    harmonyVoice: "vibe",
    harmonyChance: 0.55,
    tapeCutoff: [2700, 3600],
    reverb: { send: [0.20, 0.30], decay: [1.8, 2.6], damp: [2400, 3400] },
    weights: { mellow: 0.4, jazzy: 0.15, rainy: 0.88 },
  },
  {
    id: "synth-afterglow",
    name: "synth afterglow",
    chordVoice: "strings", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "synth", melodyBehavior: "held",
    kit: "slowMotion",
    padChance: 0.55,
    harmonyVoice: "choir",
    harmonyChance: 0.7,
    tapeCutoff: [2300, 3100],
    reverb: { send: [0.30, 0.40], decay: [3.0, 4.0], damp: [2000, 3000] },
    weights: { mellow: 0.55, jazzy: 0.4, rainy: 0.8 },
  },
  {
    id: "oboe-twilight",
    name: "oboe twilight",
    chordVoice: "horn", comping: "stabs",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "oboe", melodyBehavior: "sparse",
    kit: "slowMotion",
    padChance: 0.3,
    harmonyVoice: "cello",
    tapeCutoff: [2300, 3100],
    reverb: { send: [0.32, 0.42], decay: [2.8, 3.8], damp: [2000, 3000] },
    weights: { mellow: 0.6, jazzy: 0.5, rainy: 0.7 },
  },
  {
    id: "organ-cathedral",
    name: "organ cathedral",
    chordVoice: "organ", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "organ", melodyBehavior: "held",
    kit: "slowMotion",
    padChance: 0.05,
    harmonyVoice: "choir",
    harmonyChance: 0.8,
    tapeCutoff: [2100, 2900],
    reverb: { send: [0.38, 0.48], decay: [4.2, 5.8], damp: [1600, 2400] },
    weights: { mellow: 0.35, jazzy: 0.2, rainy: 0.92 },
  },
  {
    id: "string-quartet",
    name: "string quartet",
    chordVoice: "strings", comping: "sustained",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "strings", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.15,
    harmonyVoice: "cello",
    harmonyChance: 0.75,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.32, 0.42], decay: [3.2, 4.4], damp: [2000, 3000] },
    weights: { mellow: 0.7, jazzy: 0.25, rainy: 0.85 },
  },
  {
    id: "piano-rain",
    name: "piano rain",
    chordVoice: "piano", comping: "rolled",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "flute", melodyBehavior: "motif",
    kit: "heartbeat",
    padChance: 0.5,
    harmonyVoice: "strings",
    harmonyChance: 0.65,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.28, 0.38], decay: [2.6, 3.6], damp: [2200, 3200] },
    weights: { mellow: 0.6, jazzy: 0.2, rainy: 0.95 },
  },
  {
    id: "marimba-flute",
    name: "marimba & flute",
    chordVoice: "marimba", comping: "rolled",
    bassVoice: "bassGuitar", bassStyle: "groove",
    melodyVoice: "flute", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.4,
    harmonyVoice: "vibe",
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.26, 0.36], decay: [2.2, 3.0], damp: [3000, 4200] },
    weights: { mellow: 0.75, jazzy: 0.55, rainy: 0.45 },
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
  organ: "organ",
  strings: "strings",
  wurli: "wurli",
  clav: "clavinet",
  harp: "harp",
  piano: "felt piano",
  cello: "cello",
  flute: "flute",
  celeste: "celeste",
  synth: "synth",
  oboe: "oboe",
};

const GUEST_ALTS: Record<MelodyVoice, MelodyVoice[]> = {
  ep: ["vibe", "guitar", "bell", "fmep", "clarinet", "wurli", "piano", "flute", "harp", "celeste"],
  fmep: ["vibe", "bell", "pluck", "clarinet", "wurli", "ep", "synth", "guitar", "marimba", "oboe"],
  pluck: ["bell", "guitar", "ep", "marimba", "harp", "vibe", "celeste", "flute", "piano", "clav"],
  guitar: ["pluck", "vibe", "ep", "clarinet", "harp", "flute", "marimba", "wurli", "bell", "cello"],
  vibe: ["ep", "guitar", "bell", "marimba", "flute", "harp", "celeste", "wurli", "clarinet", "synth"],
  bell: ["pluck", "vibe", "clarinet", "horn", "celeste", "harp", "flute", "marimba", "piano", "oboe"],
  clarinet: ["horn", "bell", "marimba", "ep", "oboe", "flute", "cello", "guitar", "vibe", "synth"],
  horn: ["clarinet", "bell", "choir", "oboe", "cello", "strings", "flute", "synth", "marimba", "ep"],
  marimba: ["vibe", "pluck", "clarinet", "flute", "harp", "bell", "guitar", "celeste", "ep", "wurli"],
  choir: ["horn", "bell", "clarinet", "strings", "organ", "cello", "synth", "oboe", "celeste", "flute"],
  organ: ["choir", "strings", "bell", "horn", "cello", "clarinet", "flute", "synth", "celeste", "ep"],
  strings: ["cello", "choir", "horn", "flute", "oboe", "clarinet", "bell", "piano", "synth", "vibe"],
  wurli: ["ep", "fmep", "vibe", "guitar", "clav", "bell", "flute", "marimba", "piano", "synth"],
  clav: ["ep", "wurli", "fmep", "guitar", "pluck", "vibe", "marimba", "bell", "synth", "clarinet"],
  harp: ["guitar", "pluck", "vibe", "marimba", "bell", "flute", "celeste", "piano", "ep", "cello"],
  piano: ["ep", "bell", "flute", "strings", "harp", "vibe", "guitar", "celeste", "clarinet", "cello"],
  cello: ["strings", "horn", "clarinet", "oboe", "flute", "choir", "piano", "guitar", "bell", "synth"],
  flute: ["clarinet", "oboe", "bell", "vibe", "marimba", "harp", "guitar", "celeste", "ep", "cello"],
  celeste: ["bell", "vibe", "harp", "pluck", "flute", "marimba", "piano", "oboe", "synth", "guitar"],
  synth: ["ep", "fmep", "vibe", "choir", "strings", "flute", "bell", "horn", "wurli", "oboe"],
  oboe: ["clarinet", "horn", "flute", "cello", "strings", "bell", "choir", "synth", "marimba", "guitar"],
};

/**
 * Picks a band for a scene (weighted by mood family, never the same base
 * band twice in a row), occasionally swapping in a guest on melody.
 */
export function assembleBand(family: MoodKey, prevId?: string): Band {
  const pool = BANDS.filter((b) => b.id !== prevId);
  const base = weightedPick(pool, (b) => b.weights[family]);
  const band = { ...base };
  if (chance(0.45)) {
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
