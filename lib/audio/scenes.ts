// Scene generation — each scene is one "track" on the imaginary playlist:
// a key, a progression, a tempo, a melodic motif, a band (who's playing
// and how — see bands.ts), an ambience (see ambience.ts), and a name.
// The engine plays a scene for a few rounds (8-bar passes) and then
// segues into the next one.

import { pickAmbience, type AmbienceSpec } from "./ambience";
import { assembleBand, type Band } from "./bands";
import type { MoodKey } from "./moods";
import { noteFromMidi, pitchClassName } from "./notes";
import { chance, pick, rand, randInt } from "./random";

// ---- harmony ---------------------------------------------------------------

// EP voicings as semitone offsets above the bass root (derived from
// hand-voiced lofi chords: 9ths clustered in the 3rd/4th octave).
const QUALITIES = {
  maj9: [16, 19, 23, 26],
  maj69: [16, 19, 21, 26],
  min9: [15, 19, 22, 26],
  min9lo: [10, 14, 15, 19],
  min9hi: [14, 15, 19, 22],
  dom9: [16, 19, 22, 26],
  dom13: [10, 14, 16, 21],
} as const;

type Quality = keyof typeof QUALITIES;

interface ChordSpec {
  /** Semitones above the key's tonic. */
  degree: number;
  quality: Quality;
}

export interface Chord {
  /** Bass root, e.g. "F2". */
  root: string;
  rootMidi: number;
  /** Chord voicing for the keys, low to high. */
  notes: string[];
}

interface FamilyConfig {
  /** Tonic pitch classes this family wanders between (C = 0). */
  keys: number[];
  minor: boolean;
  bpm: [number, number];
  /** Progressions as scale-degree chords, ready to transpose anywhere. */
  progressions: ChordSpec[][];
  /** Melody pool as semitone offsets above the tonic (octave 4-ish). */
  scaleOffsets: number[];
  names: string[];
}

const FAMILIES: Record<MoodKey, FamilyConfig> = {
  mellow: {
    keys: [0, 5, 7, 2, 10], // C F G D Bb
    minor: false,
    bpm: [68, 76],
    progressions: [
      // IV iii ii I — the classic study-beats descent
      [
        { degree: 5, quality: "maj9" },
        { degree: 4, quality: "min9" },
        { degree: 2, quality: "min9" },
        { degree: 0, quality: "maj9" },
      ],
      // I vi IV V
      [
        { degree: 0, quality: "maj9" },
        { degree: 9, quality: "min9" },
        { degree: 5, quality: "maj9" },
        { degree: 7, quality: "dom13" },
      ],
      // I iii vi IV
      [
        { degree: 0, quality: "maj69" },
        { degree: 4, quality: "min9" },
        { degree: 9, quality: "min9" },
        { degree: 5, quality: "maj9" },
      ],
      // IV V iii vi
      [
        { degree: 5, quality: "maj9" },
        { degree: 7, quality: "dom13" },
        { degree: 4, quality: "min9" },
        { degree: 9, quality: "min9" },
      ],
    ],
    scaleOffsets: [4, 7, 9, 11, 12, 14, 16, 19],
    names: [
      "honey lamplight", "porch swing dusk", "sunday polaroids",
      "window seat", "golden hour leftovers", "paper stars",
      "the long way home", "warm static", "clementine evening",
      "bookshop dust", "slow ceiling fan", "summer in the walls",
    ],
  },
  jazzy: {
    keys: [0, 5, 10, 3, 7], // C F Bb Eb G
    minor: false,
    bpm: [70, 78],
    progressions: [
      // ii V I vi — smoky turnaround
      [
        { degree: 2, quality: "min9" },
        { degree: 7, quality: "dom13" },
        { degree: 0, quality: "maj9" },
        { degree: 9, quality: "min9lo" },
      ],
      // iii VI ii V — circle of fifths
      [
        { degree: 4, quality: "min9" },
        { degree: 9, quality: "dom9" },
        { degree: 2, quality: "min9" },
        { degree: 7, quality: "dom13" },
      ],
      // I vi ii V
      [
        { degree: 0, quality: "maj69" },
        { degree: 9, quality: "min9lo" },
        { degree: 2, quality: "min9" },
        { degree: 7, quality: "dom13" },
      ],
      // ii V I IV
      [
        { degree: 2, quality: "min9" },
        { degree: 7, quality: "dom13" },
        { degree: 0, quality: "maj9" },
        { degree: 5, quality: "maj9" },
      ],
    ],
    scaleOffsets: [9, 12, 14, 16, 19, 21, 24],
    names: [
      "blue corner table", "last train home", "neon in puddles",
      "after-hours wurlitzer", "cigarette moon", "the quiet set",
      "velvet stairwell", "2am laundromat", "downtown half asleep",
      "smoke ring waltz", "closing time chords", "muted trumpet dreams",
    ],
  },
  rainy: {
    keys: [9, 2, 4, 0], // Am Dm Em Cm
    minor: true,
    bpm: [62, 70],
    progressions: [
      // i bVI iv V — the late-night original
      [
        { degree: 0, quality: "min9hi" },
        { degree: 8, quality: "maj9" },
        { degree: 5, quality: "min9" },
        { degree: 7, quality: "dom9" },
      ],
      // i iv bVI bVII
      [
        { degree: 0, quality: "min9hi" },
        { degree: 5, quality: "min9" },
        { degree: 8, quality: "maj9" },
        { degree: 10, quality: "dom13" },
      ],
      // i bIII bVI V
      [
        { degree: 0, quality: "min9" },
        { degree: 3, quality: "maj9" },
        { degree: 8, quality: "maj9" },
        { degree: 7, quality: "dom9" },
      ],
      // i bVII bVI V
      [
        { degree: 0, quality: "min9hi" },
        { degree: 10, quality: "dom13" },
        { degree: 8, quality: "maj9" },
        { degree: 7, quality: "dom9" },
      ],
    ],
    scaleOffsets: [12, 15, 17, 19, 22, 24, 27],
    names: [
      "rain on glass", "umbrella graveyard", "streetlight halo",
      "thunder two towns over", "wet asphalt mirror", "november windowsill",
      "drips from the awning", "grey morning premonition", "puddle constellations",
      "the storm stays outside", "fogged-up bus stop", "petrichor",
    ],
  },
};

// ---- melody motifs ----------------------------------------------------------

export interface MotifNote {
  /** Index into the scene's scale. */
  scaleIdx: number;
  /** 16th-note position within the chord's two bars (0–31). */
  step: number;
  /** Duration in beats. */
  beats: number;
  vel: number;
}

function makeMotif(scaleLen: number): MotifNote[] {
  const count = randInt(3, 5);
  const notes: MotifNote[] = [];
  let step = randInt(1, 3) * 2;
  let idx = randInt(2, scaleLen - 2);
  for (let i = 0; i < count; i++) {
    notes.push({
      scaleIdx: Math.max(0, Math.min(scaleLen - 1, idx)),
      step,
      beats: pick([0.75, 1, 1.5, 2]),
      vel: rand(0.06, 0.1),
    });
    step += pick([2, 2, 3, 4, 6]);
    if (step > 28) break;
    idx += pick([-2, -1, -1, 1, 1, 2]); // mostly stepwise, like a hummed tune
  }
  return notes;
}

// ---- scenes ------------------------------------------------------------------

export interface Scene {
  family: MoodKey;
  name: string;
  keyPc: number;
  keyName: string;
  bpm: number;
  swing: number;
  progressionIdx: number;
  progression: Chord[];
  /** Melody pool, low to high, e.g. ["E4", "G4", ...]. */
  scale: string[];
  motif: MotifNote[];
  /** Scale-step shift applied when the motif is "answered" later in a round. */
  answerShift: number;
  /** Full 8-bar passes through the progression before the next segue. */
  rounds: number;
  // performance
  band: Band;
  /** Band's bass style with "either" resolved per scene. */
  bassStyle: "anchor" | "walking";
  padOn: boolean;
  ambience: AmbienceSpec;
  tapeCutoff: number;
  wobbleCents: number;
  wobbleRate: number;
}

export interface SceneSummary {
  name: string;
  family: MoodKey;
  keyName: string;
  bpm: number;
  /** Display name of the band playing this scene. */
  band: string;
}

export function summarize(scene: Scene): SceneSummary {
  const { name, family, keyName, bpm } = scene;
  return { name, family, keyName, bpm, band: scene.band.name };
}

function buildChord(keyPc: number, spec: ChordSpec): Chord {
  // bass roots live in octave 2 (MIDI 36–47), like a thumb on the low keys
  const rootMidi = 36 + ((keyPc + spec.degree) % 12);
  return {
    root: noteFromMidi(rootMidi),
    rootMidi,
    notes: QUALITIES[spec.quality].map((iv) => noteFromMidi(rootMidi + iv)),
  };
}

function buildScale(keyPc: number, offsets: number[]): string[] {
  // anchor the melody pool around octaves 4–5 regardless of key
  let tonic = 60 + keyPc;
  if (keyPc > 6) tonic -= 12;
  return offsets.map((o) => noteFromMidi(tonic + o));
}

export function makeScene(family: MoodKey, prev?: Scene): Scene {
  const cfg = FAMILIES[family];

  // wander to a different key center when staying in the same family
  let keyPc = pick(cfg.keys);
  if (prev && prev.family === family && cfg.keys.length > 1) {
    while (keyPc === prev.keyPc) keyPc = pick(cfg.keys);
  }

  let progressionIdx = randInt(0, cfg.progressions.length - 1);
  if (prev && prev.family === family && cfg.progressions.length > 1) {
    while (progressionIdx === prev.progressionIdx) {
      progressionIdx = randInt(0, cfg.progressions.length - 1);
    }
  }

  let name = pick(cfg.names);
  if (prev) while (name === prev.name) name = pick(cfg.names);

  const scale = buildScale(keyPc, cfg.scaleOffsets);
  const band = assembleBand(family, prev?.band.id);

  return {
    family,
    name,
    keyPc,
    keyName: `${pitchClassName(keyPc)} ${cfg.minor ? "minor" : "major"}`,
    bpm: Math.round(rand(cfg.bpm[0], cfg.bpm[1])),
    swing: rand(0.5, 0.62),
    progressionIdx,
    progression: cfg.progressions[progressionIdx].map((spec) => buildChord(keyPc, spec)),
    scale,
    motif: makeMotif(scale.length),
    answerShift: pick([-2, -1, 1, 1, 2]),
    rounds: randInt(3, 5),
    band,
    bassStyle:
      band.bassStyle === "either" ? (chance(0.5) ? "walking" : "anchor") : band.bassStyle,
    padOn: chance(band.padChance * (family === "rainy" ? 1.4 : 1)),
    ambience: pickAmbience(family),
    tapeCutoff: rand(band.tapeCutoff[0], band.tapeCutoff[1]),
    wobbleCents: rand(4, 10),
    wobbleRate: rand(0.3, 0.8),
  };
}
