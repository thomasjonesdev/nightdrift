// Bands — who is playing tonight, and how. Piano is the only sampled instrument;
// everything else is Web Audio synth (analog keys, pads, mallets). Scenes pick
// a band weighted by mood family, and piano often sits in on melody to humanize.

import type { MoodKey } from "./moods";
import { MOOD_PROFILES, bandWeightForMood, moodBandWithKit } from "./mood-profile";
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
export type KitId =
  | "boomBap" | "slowMotion" | "bossa" | "brushes" | "heartbeat"
  | "punchy" | "muted" | "pocket";
export type PadStyle = "warm" | "huge" | "choir";

// ---- drum grammars -----------------------------------------------------------
// Step numbers index 16ths across a two-bar chord (0–31).

export interface DrumKit {
  kicks: number[];
  kickVel: number;
  kickGhosts?: { steps: number[]; p: number };
  backbeat: {
    steps: number[];
    voice: "snare" | "rim" | "brush" | "woodblock";
    snareVel?: number;
    ghosts?: { steps: number[]; p: number };
  } | null;
  pulse: { voice: PulseVoice; every: number; accentEvery: number; p: number } | null;
  /** Occasional extra tick on the last 16th of a beat. */
  offbeat?: { voice: "hat" | "shaker"; p: number };
  fills: boolean;
}

export const KITS: Record<KitId, DrumKit> = {
  // kick + snare pocket; hats very sparse
  boomBap: {
    kicks: [0, 10, 16, 21, 26],
    kickVel: 1,
    kickGhosts: { steps: [7, 30], p: 0.2 },
    backbeat: { steps: [8, 24], voice: "snare", ghosts: { steps: [29], p: 0.15 } },
    pulse: { voice: "hat", every: 4, accentEvery: 8, p: 0.22 },
    fills: true,
  },
  // one heavy snare per two bars
  slowMotion: {
    kicks: [0, 22],
    kickVel: 1.05,
    backbeat: { steps: [16], voice: "snare", snareVel: 0.95 },
    pulse: null,
    fills: false,
  },
  bossa: {
    kicks: [0, 16],
    kickVel: 0.75,
    backbeat: { steps: [8, 24], voice: "rim" },
    pulse: null,
    fills: false,
  },
  brushes: {
    kicks: [0, 16],
    kickVel: 0.65,
    backbeat: { steps: [8, 24], voice: "brush" },
    pulse: null,
    fills: false,
  },
  heartbeat: {
    kicks: [0, 16],
    kickVel: 0.85,
    kickGhosts: { steps: [10, 26], p: 0.3 },
    backbeat: null,
    pulse: null,
    fills: false,
  },
  /** Tight, forward kick/snare — no hats. */
  punchy: {
    kicks: [0, 8, 16, 24],
    kickVel: 1.28,
    backbeat: { steps: [8, 24], voice: "snare", snareVel: 1.32 },
    pulse: null,
    fills: false,
  },
  /** Soft kick, woodblock backbeat — barely there. */
  muted: {
    kicks: [0, 16],
    kickVel: 0.52,
    kickGhosts: { steps: [24], p: 0.12 },
    backbeat: { steps: [8, 24], voice: "woodblock", snareVel: 0.85 },
    pulse: null,
    fills: false,
  },
  /** Classic lofi kick/snare with ghost notes; hats whisper only. */
  pocket: {
    kicks: [0, 10, 16, 26],
    kickVel: 1.05,
    kickGhosts: { steps: [7, 22], p: 0.18 },
    backbeat: { steps: [8, 24], voice: "snare", ghosts: { steps: [28], p: 0.1 }, snareVel: 1.08 },
    pulse: { voice: "hat", every: 8, accentEvery: 16, p: 0.18 },
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
  /** Pad swell character — huge detuned saws, choir sines, or warm triangles. */
  padStyle?: PadStyle;
  /** Sustained synth wash under comping — strings, choir, organ, harp, etc. */
  bedVoice?: ChordVoice;
  /** Likelihood the bed layer plays each chord (defaults to 0.8). */
  bedChance?: number;
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
  /** When both pianos play — native duet vs guest melody over piano comping. */
  pianoDuet?: "guest" | "duet";
}

const BANDS: Band[] = [
  {
    id: "felt-piano-trio",
    name: "felt piano trio",
    chordVoice: "piano", comping: "broken",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "piano", melodyBehavior: "motif",
    kit: "pocket",
    padChance: 0.78,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.82,
    harmonyVoice: "cello",
    harmonyChance: 0.72,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.26, 0.36], decay: [2.4, 3.2], damp: [2200, 3200] },
    weights: { mellow: 1, jazzy: 0.35, rainy: 0.85 },
  },
  {
    id: "piano-rain",
    name: "piano rain",
    chordVoice: "piano", comping: "rolled",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "piano", melodyBehavior: "motif",
    kit: "muted",
    padChance: 0.88,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.85,
    harmonyVoice: "harp",
    harmonyChance: 0.68,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.28, 0.38], decay: [2.6, 3.6], damp: [2200, 3200] },
    weights: { mellow: 0.75, jazzy: 0.2, rainy: 1 },
  },
  {
    id: "piano-duet",
    name: "piano duet",
    chordVoice: "piano", comping: "broken",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "piano", melodyBehavior: "motif",
    kit: "pocket",
    padChance: 0.72,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.78,
    tapeCutoff: [2500, 3300],
    reverb: { send: [0.24, 0.34], decay: [2.2, 3.0], damp: [2400, 3400] },
    weights: { mellow: 0.95, jazzy: 0.25, rainy: 0.7 },
  },
  {
    id: "tape-quartet",
    name: "tape quartet",
    chordVoice: "piano", comping: "rolled",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "pocket",
    padChance: 0.82,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.8,
    harmonyVoice: "synth",
    harmonyChance: 0.7,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.22, 0.32], decay: [1.8, 2.4], damp: [2800, 3800] },
    weights: { mellow: 0.85, jazzy: 0.7, rainy: 0.65 },
  },
  {
    id: "wurlitzer-trio",
    name: "wurlitzer trio",
    chordVoice: "piano", comping: "stabs",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "fmep", melodyBehavior: "motif",
    kit: "punchy", pulseVoice: "shaker",
    padChance: 0.74,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.76,
    harmonyVoice: "vibe",
    harmonyChance: 0.68,
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.12, 0.22], decay: [1.2, 1.8], damp: [3200, 4500] },
    weights: { mellow: 0.5, jazzy: 1, rainy: 0.25 },
  },
  {
    id: "piano-loft",
    name: "piano loft",
    chordVoice: "piano", comping: "broken",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "muted",
    padChance: 0.76,
    padStyle: "warm",
    bedVoice: "guitar",
    bedChance: 0.72,
    harmonyVoice: "harp",
    harmonyChance: 0.65,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.18, 0.28], decay: [1.4, 2.0], damp: [2600, 3600] },
    weights: { mellow: 0.9, jazzy: 0.5, rainy: 0.55 },
  },
  {
    id: "midnight-glow",
    name: "midnight glow",
    chordVoice: "synth", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "bell", melodyBehavior: "held",
    kit: "pocket",
    padChance: 0.92,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.88,
    harmonyVoice: "organ",
    harmonyChance: 0.78,
    tapeCutoff: [2200, 3000],
    reverb: { send: [0.32, 0.44], decay: [3.5, 4.8], damp: [1800, 2600] },
    weights: { mellow: 0.25, jazzy: 0.35, rainy: 0.9 },
  },
  {
    id: "analog-vibes",
    name: "analog vibes",
    chordVoice: "ep", comping: "rolled",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "vibe", melodyBehavior: "arp",
    kit: "brushes",
    padChance: 0.76,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.8,
    harmonyVoice: "fmep",
    harmonyChance: 0.7,
    tapeCutoff: [3000, 4000],
    reverb: { send: [0.26, 0.36], decay: [2.2, 3.0], damp: [3000, 4200] },
    weights: { mellow: 0.45, jazzy: 0.9, rainy: 0.35 },
  },
  {
    id: "synth-box",
    name: "synth box",
    chordVoice: "synth", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "bell", melodyBehavior: "motif",
    kit: "pocket",
    padChance: 0.92,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.86,
    harmonyVoice: "strings",
    harmonyChance: 0.74,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.30, 0.40], decay: [3.0, 4.2], damp: [2000, 3000] },
    weights: { mellow: 0.5, jazzy: 0.1, rainy: 0.95 },
  },
  {
    id: "bossa-balcony",
    name: "bossa balcony",
    chordVoice: "piano", comping: "stabs",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "bossa",
    padChance: 0.7,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.76,
    harmonyVoice: "guitar",
    harmonyChance: 0.66,
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
    padChance: 0.82,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.8,
    harmonyVoice: "celeste",
    harmonyChance: 0.62,
    tapeCutoff: [2600, 3400],
    reverb: { send: [0.14, 0.24], decay: [1.0, 1.6], damp: [2400, 3400] },
    weights: { mellow: 0.3, jazzy: 0.1, rainy: 0.85 },
  },
  {
    id: "analog-garden",
    name: "analog garden",
    chordVoice: "vibe", comping: "rolled",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "marimba", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.74,
    padStyle: "warm",
    bedVoice: "harp",
    bedChance: 0.78,
    harmonyVoice: "flute",
    harmonyChance: 0.65,
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.24, 0.34], decay: [2.0, 2.8], damp: [3200, 4400] },
    weights: { mellow: 0.7, jazzy: 0.6, rainy: 0.5 },
  },
  {
    id: "pad-cathedral",
    name: "pad cathedral",
    chordVoice: "organ", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "bell", melodyBehavior: "held",
    kit: "pocket",
    padChance: 0.95,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.92,
    harmonyVoice: "strings",
    harmonyChance: 0.82,
    tapeCutoff: [2200, 3000],
    reverb: { send: [0.36, 0.48], decay: [4.0, 5.5], damp: [1600, 2400] },
    weights: { mellow: 0.6, jazzy: 0.2, rainy: 0.85 },
  },
  {
    id: "keys-midnight",
    name: "keys midnight",
    chordVoice: "fmep", comping: "stabs",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "synth", melodyBehavior: "sparse",
    kit: "pocket",
    padChance: 0.78,
    padStyle: "warm",
    bedVoice: "cello",
    bedChance: 0.8,
    harmonyVoice: "strings",
    harmonyChance: 0.72,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.28, 0.38], decay: [2.4, 3.4], damp: [2200, 3200] },
    weights: { mellow: 0.5, jazzy: 0.75, rainy: 0.4 },
  },
  {
    id: "basement-session",
    name: "basement session",
    chordVoice: "piano", comping: "stabs",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "punchy",
    padChance: 0.74,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.78,
    harmonyVoice: "guitar",
    harmonyChance: 0.68,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.16, 0.26], decay: [1.4, 2.0], damp: [2800, 3800] },
    weights: { mellow: 0.85, jazzy: 0.9, rainy: 0.4 },
  },
  {
    id: "low-light-combo",
    name: "low light combo",
    chordVoice: "piano", comping: "rolled",
    bassVoice: "pluck", bassStyle: "either",
    melodyVoice: "fmep", melodyBehavior: "sparse",
    kit: "pocket",
    padChance: 0.82,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.84,
    harmonyVoice: "cello",
    harmonyChance: 0.7,
    tapeCutoff: [2400, 3400],
    reverb: { send: [0.24, 0.34], decay: [2.2, 3.0], damp: [2400, 3400] },
    weights: { mellow: 0.55, jazzy: 0.6, rainy: 0.8 },
  },
  {
    id: "keys-attic",
    name: "keys attic",
    chordVoice: "ep", comping: "arp",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "vibe", melodyBehavior: "arp",
    kit: "heartbeat",
    padChance: 0.78,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.76,
    harmonyVoice: "harp",
    harmonyChance: 0.66,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.16, 0.26], decay: [1.2, 1.9], damp: [2600, 3600] },
    weights: { mellow: 0.55, jazzy: 0.4, rainy: 0.7 },
  },
  {
    id: "wurli-lounge",
    name: "wurli lounge",
    chordVoice: "piano", comping: "stabs",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "wurli", melodyBehavior: "motif",
    kit: "punchy", pulseVoice: "shaker",
    padChance: 0.72,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.78,
    harmonyVoice: "vibe",
    harmonyChance: 0.72,
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.18, 0.28], decay: [1.6, 2.2], damp: [3000, 4200] },
    weights: { mellow: 0.6, jazzy: 0.95, rainy: 0.3 },
  },
  {
    id: "clav-cellar",
    name: "clav cellar",
    chordVoice: "piano", comping: "stabs",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "clav", melodyBehavior: "sparse",
    kit: "punchy",
    padChance: 0.68,
    padStyle: "warm",
    bedVoice: "organ",
    bedChance: 0.74,
    harmonyVoice: "strings",
    harmonyChance: 0.65,
    tapeCutoff: [2600, 3600],
    reverb: { send: [0.14, 0.22], decay: [1.2, 1.8], damp: [2800, 4000] },
    weights: { mellow: 0.5, jazzy: 0.85, rainy: 0.2 },
  },
  {
    id: "piano-porch",
    name: "piano porch",
    chordVoice: "piano", comping: "arp",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "pluck", melodyBehavior: "arp",
    kit: "brushes",
    padChance: 0.8,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.82,
    harmonyVoice: "guitar",
    harmonyChance: 0.74,
    tapeCutoff: [2600, 3400],
    reverb: { send: [0.22, 0.32], decay: [2.0, 2.8], damp: [2600, 3600] },
    weights: { mellow: 0.85, jazzy: 0.45, rainy: 0.55 },
  },
  {
    id: "synth-street",
    name: "synth street",
    chordVoice: "synth", comping: "sustained",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "ep", melodyBehavior: "motif",
    kit: "bossa",
    padChance: 0.78,
    padStyle: "warm",
    bedVoice: "accordion",
    bedChance: 0.76,
    harmonyVoice: "fmep",
    harmonyChance: 0.72,
    tapeCutoff: [2200, 3000],
    reverb: { send: [0.28, 0.38], decay: [2.6, 3.6], damp: [2000, 3000] },
    weights: { mellow: 0.5, jazzy: 0.7, rainy: 0.45 },
  },
  {
    id: "piano-parlor",
    name: "piano parlor",
    chordVoice: "piano", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "piano", melodyBehavior: "held",
    kit: "muted",
    padChance: 0.88,
    padStyle: "warm",
    bedVoice: "cello",
    bedChance: 0.86,
    harmonyVoice: "strings",
    harmonyChance: 0.8,
    tapeCutoff: [2100, 2900],
    reverb: { send: [0.34, 0.44], decay: [3.2, 4.4], damp: [1800, 2600] },
    weights: { mellow: 0.7, jazzy: 0.25, rainy: 0.92 },
  },
  {
    id: "piano-meadow",
    name: "piano meadow",
    chordVoice: "piano", comping: "broken",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "flute", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.8,
    padStyle: "warm",
    bedVoice: "harp",
    bedChance: 0.82,
    harmonyVoice: "strings",
    harmonyChance: 0.72,
    tapeCutoff: [2500, 3300],
    reverb: { send: [0.24, 0.34], decay: [2.2, 3.0], damp: [2800, 3800] },
    weights: { mellow: 0.8, jazzy: 0.35, rainy: 0.5 },
  },
  {
    id: "celeste-belfry",
    name: "celeste belfry",
    chordVoice: "piano", comping: "arp",
    bassVoice: "none", bassStyle: "anchor",
    melodyVoice: "celeste", melodyBehavior: "motif",
    kit: "muted",
    padChance: 0.86,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.84,
    harmonyVoice: "vibe",
    harmonyChance: 0.68,
    tapeCutoff: [2700, 3600],
    reverb: { send: [0.20, 0.30], decay: [1.8, 2.6], damp: [2400, 3400] },
    weights: { mellow: 0.45, jazzy: 0.15, rainy: 0.88 },
  },
  {
    id: "synth-afterglow",
    name: "synth afterglow",
    chordVoice: "synth", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "synth", melodyBehavior: "held",
    kit: "pocket",
    padChance: 0.94,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.88,
    harmonyVoice: "strings",
    harmonyChance: 0.78,
    tapeCutoff: [2300, 3100],
    reverb: { send: [0.30, 0.40], decay: [3.0, 4.0], damp: [2000, 3000] },
    weights: { mellow: 0.55, jazzy: 0.4, rainy: 0.8 },
  },
  {
    id: "piano-twilight",
    name: "piano twilight",
    chordVoice: "piano", comping: "stabs",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "oboe", melodyBehavior: "sparse",
    kit: "pocket",
    padChance: 0.84,
    padStyle: "warm",
    bedVoice: "cello",
    bedChance: 0.82,
    harmonyVoice: "organ",
    harmonyChance: 0.74,
    tapeCutoff: [2300, 3100],
    reverb: { send: [0.32, 0.42], decay: [2.8, 3.8], damp: [2000, 3000] },
    weights: { mellow: 0.65, jazzy: 0.5, rainy: 0.7 },
  },
  {
    id: "piano-quartet",
    name: "piano quartet",
    chordVoice: "piano", comping: "sustained",
    bassVoice: "sine", bassStyle: "walking",
    melodyVoice: "piano", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.86,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.88,
    harmonyVoice: "cello",
    harmonyChance: 0.8,
    tapeCutoff: [2400, 3200],
    reverb: { send: [0.32, 0.42], decay: [3.2, 4.4], damp: [2000, 3000] },
    weights: { mellow: 0.75, jazzy: 0.25, rainy: 0.85 },
  },
  {
    id: "marimba-keys",
    name: "marimba & keys",
    chordVoice: "piano", comping: "rolled",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "marimba", melodyBehavior: "motif",
    kit: "brushes",
    padChance: 0.78,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.8,
    harmonyVoice: "harp",
    harmonyChance: 0.7,
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.26, 0.36], decay: [2.2, 3.0], damp: [3000, 4200] },
    weights: { mellow: 0.8, jazzy: 0.55, rainy: 0.45 },
  },
  {
    id: "chapel-choir",
    name: "chapel choir",
    chordVoice: "piano", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "horn", melodyBehavior: "held",
    kit: "pocket",
    padChance: 0.92,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.9,
    harmonyVoice: "cello",
    harmonyChance: 0.82,
    tapeCutoff: [2200, 3000],
    reverb: { send: [0.36, 0.48], decay: [4.0, 5.5], damp: [1600, 2400] },
    weights: { mellow: 0.65, jazzy: 0.2, rainy: 0.92 },
  },
  {
    id: "organ-cathedral",
    name: "organ cathedral",
    chordVoice: "organ", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "organ", melodyBehavior: "held",
    kit: "pocket",
    padChance: 0.96,
    padStyle: "warm",
    bedVoice: "choir",
    bedChance: 0.94,
    harmonyVoice: "strings",
    harmonyChance: 0.85,
    tapeCutoff: [2100, 2900],
    reverb: { send: [0.38, 0.48], decay: [4.2, 5.8], damp: [1600, 2400] },
    weights: { mellow: 0.4, jazzy: 0.2, rainy: 0.95 },
  },
  {
    id: "cello-parlor",
    name: "cello parlor",
    chordVoice: "piano", comping: "sustained",
    bassVoice: "sine", bassStyle: "anchor",
    melodyVoice: "cello", melodyBehavior: "held",
    kit: "pocket",
    padChance: 0.9,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.88,
    harmonyVoice: "cello",
    harmonyChance: 0.78,
    tapeCutoff: [2100, 2900],
    reverb: { send: [0.34, 0.44], decay: [3.2, 4.4], damp: [1800, 2600] },
    weights: { mellow: 0.7, jazzy: 0.25, rainy: 0.95 },
  },
  {
    id: "harp-porch",
    name: "harp porch",
    chordVoice: "piano", comping: "arp",
    bassVoice: "pluck", bassStyle: "groove",
    melodyVoice: "harp", melodyBehavior: "arp",
    kit: "brushes",
    padChance: 0.84,
    padStyle: "warm",
    bedVoice: "strings",
    bedChance: 0.86,
    harmonyVoice: "guitar",
    harmonyChance: 0.76,
    tapeCutoff: [2800, 3800],
    reverb: { send: [0.26, 0.36], decay: [2.2, 3.0], damp: [3000, 4200] },
    weights: { mellow: 0.8, jazzy: 0.55, rainy: 0.45 },
  },
];

// ---- guest musicians ----------------------------------------------------------
// Synth + piano only — piano guests humanize the generated bed.

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
  piano: "grand piano",
  cello: "cello",
  flute: "flute",
  celeste: "celeste",
  synth: "synth",
  oboe: "oboe",
};

/** Allowed guest melody voices — analog synth + piano + restored texture leads. */
const SYNTH_GUEST_MELODY: readonly MelodyVoice[] = [
  "piano", "ep", "fmep", "synth", "bell", "pluck", "vibe", "clav", "wurli", "celeste", "marimba",
  "harp", "flute", "cello", "horn", "oboe", "clarinet", "guitar", "organ", "strings", "choir",
];

const GUEST_ALTS: Record<MelodyVoice, MelodyVoice[]> = {
  ep: ["piano", "vibe", "fmep", "bell", "wurli", "synth", "marimba", "celeste", "pluck", "clav"],
  fmep: ["piano", "vibe", "ep", "bell", "wurli", "synth", "marimba", "celeste", "pluck", "clav"],
  pluck: ["piano", "bell", "ep", "marimba", "vibe", "celeste", "clav", "fmep", "wurli", "synth"],
  guitar: ["piano", "pluck", "ep", "vibe", "bell", "marimba", "celeste", "fmep", "clav", "synth"],
  vibe: ["piano", "ep", "fmep", "bell", "marimba", "celeste", "wurli", "pluck", "synth", "clav"],
  bell: ["piano", "pluck", "vibe", "celeste", "ep", "marimba", "fmep", "wurli", "synth", "clav"],
  clarinet: ["piano", "ep", "fmep", "synth", "bell", "vibe", "marimba", "celeste", "pluck", "wurli"],
  horn: ["piano", "ep", "synth", "bell", "fmep", "vibe", "celeste", "marimba", "pluck", "clav"],
  marimba: ["piano", "vibe", "pluck", "bell", "ep", "celeste", "fmep", "wurli", "synth", "clav"],
  choir: ["piano", "synth", "ep", "bell", "fmep", "vibe", "celeste", "marimba", "pluck", "clav"],
  organ: ["piano", "synth", "ep", "bell", "fmep", "vibe", "celeste", "marimba", "pluck", "clav"],
  strings: ["piano", "ep", "synth", "bell", "fmep", "vibe", "celeste", "marimba", "pluck", "clav"],
  wurli: ["piano", "ep", "fmep", "vibe", "clav", "bell", "marimba", "celeste", "synth", "pluck"],
  clav: ["piano", "ep", "wurli", "fmep", "pluck", "vibe", "marimba", "bell", "synth", "celeste"],
  harp: ["piano", "pluck", "vibe", "ep", "bell", "marimba", "celeste", "fmep", "clav", "synth"],
  piano: ["ep", "fmep", "vibe", "bell", "pluck", "marimba", "celeste", "wurli", "clav", "synth"],
  cello: ["piano", "ep", "synth", "bell", "fmep", "vibe", "celeste", "marimba", "pluck", "clav"],
  flute: ["piano", "bell", "vibe", "ep", "marimba", "celeste", "fmep", "pluck", "synth", "clav"],
  celeste: ["piano", "bell", "vibe", "pluck", "marimba", "ep", "fmep", "wurli", "synth", "clav"],
  synth: ["piano", "ep", "fmep", "vibe", "bell", "marimba", "celeste", "pluck", "wurli", "clav"],
  oboe: ["piano", "ep", "fmep", "synth", "bell", "vibe", "marimba", "celeste", "pluck", "clav"],
};

/**
 * Picks a band for a scene (weighted by mood family, never the same base
 * band twice in a row). Piano often sits in on melody to humanize synth beds.
 */
export function assembleBand(
  family: MoodKey,
  prevId?: string,
  avoidIds?: readonly string[],
): Band {
  const blocked = new Set([prevId, ...(avoidIds ?? [])].filter(Boolean));
  const floor = MOOD_PROFILES[family].bandWeightFloor;
  let pool = BANDS.filter((b) => !blocked.has(b.id) && b.weights[family] >= floor);
  if (pool.length === 0) {
    pool = BANDS.filter((b) => !blocked.has(b.id));
  }
  const base = weightedPick(pool.length > 0 ? pool : BANDS, (b) => bandWeightForMood(b, family));
  let band = moodBandWithKit(family, { ...base });

  // Piano guest on synth beds.
  if (band.melodyVoice !== "piano" && band.chordVoice !== "piano" && chance(0.48)) {
    band.melodyVoice = "piano";
    band.name = `${base.name} ft. ${GUEST_NAMES.piano}`;
    return band;
  }

  // Guest melody piano over piano comping — complementary duet (low comp, high melody).
  if (band.melodyVoice !== "piano" && band.chordVoice === "piano" && chance(0.52)) {
    band.melodyVoice = "piano";
    band.pianoDuet = "guest";
    band.name = `${base.name} ft. ${GUEST_NAMES.piano}`;
    return band;
  }

  if (chance(band.chordVoice === "piano" ? 0.22 : 0.4)) {
    const alts = GUEST_ALTS[band.melodyVoice].filter(
      (v) => SYNTH_GUEST_MELODY.includes(v) && v !== band.chordVoice,
    );
    if (alts.length > 0) {
      const guest = pick(alts);
      band.melodyVoice = guest;
      band.name = `${base.name} ft. ${GUEST_NAMES[guest]}`;
    }
  }
  return band;
}
