// Scene generation — each scene is one "track" on the imaginary playlist:
// a key, a progression, a tempo, a melodic motif, a band (who's playing
// and how — see bands.ts), an ambience (see ambience.ts), and a name.
// The engine plays a scene for a few rounds (8-bar passes) and then
// segues into the next one.

import { pickAmbience, type AmbienceBed, type AmbienceSpec } from "./ambience";
import {
  assembleBand,
  KITS,
  type Band,
  type BassVoice,
  type ChordVoice,
  type KitId,
  type MelodyVoice,
} from "./bands";
import type { MoodKey } from "./moods";
import {
  assembleMelodyPlan,
  type MelodyPlan,
  type MotifNote,
  type MotifVariation,
} from "./melodies";
import { noteFromMidi, pitchClassName } from "./notes";
import { chance, pick, rand, randInt, weightedPick } from "./random";

// ---- harmony ---------------------------------------------------------------

/**
 * Each scene voices its chords with one character:
 * - cozy:  close-position 9th clusters (the original hand voicings)
 * - open:  spread voicings with the 7th low — airier, more pianistic
 * - shell: just the essentials (3rd/7th + one color tone) — smoky, leaves room
 */
export type VoicingStyle = "cozy" | "open" | "shell";

// Voicings as semitone offsets above the bass root (derived from
// hand-voiced lofi chords: 9ths clustered in the 3rd/4th octave).
const QUALITIES = {
  maj9: { cozy: [16, 19, 23, 26], open: [11, 16, 19, 26], shell: [11, 16, 26] },
  maj7: { cozy: [12, 16, 19, 23], open: [11, 16, 19, 24], shell: [11, 16, 24] },
  maj69: { cozy: [16, 19, 21, 26], open: [9, 14, 16, 21], shell: [9, 16, 26] },
  min9: { cozy: [15, 19, 22, 26], open: [10, 15, 19, 26], shell: [10, 15, 26] },
  min9lo: { cozy: [10, 14, 15, 19], open: [10, 15, 19, 26], shell: [10, 15, 19] },
  min9hi: { cozy: [14, 15, 19, 22], open: [15, 19, 22, 26], shell: [15, 22, 26] },
  min11: { cozy: [15, 17, 19, 22], open: [10, 15, 17, 22], shell: [10, 17, 22] },
  dom9: { cozy: [16, 19, 22, 26], open: [10, 16, 19, 26], shell: [10, 16, 26] },
  dom13: { cozy: [10, 14, 16, 21], open: [10, 16, 21, 26], shell: [10, 16, 21] },
  dom7sus: { cozy: [14, 17, 22, 24], open: [10, 17, 22, 26], shell: [10, 17, 24] },
} as const satisfies Record<string, Record<VoicingStyle, readonly number[]>>;

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
  /** Semitones from root to the chord's defining third (3 minor, 4 major, 5 sus). */
  thirdIv: number;
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
      // I VI ii V — the other circle of fifths
      [
        { degree: 0, quality: "maj9" },
        { degree: 8, quality: "dom13" },
        { degree: 2, quality: "dom9" },
        { degree: 7, quality: "min9" },
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
      // I Vsus IV iii — suspended daydream
      [
        { degree: 0, quality: "maj9" },
        { degree: 7, quality: "dom7sus" },
        { degree: 5, quality: "maj69" },
        { degree: 4, quality: "min11" },
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
      // ii11 Vsus I69 IVmaj7 — the resolution arrives sideways
      [
        { degree: 2, quality: "min11" },
        { degree: 7, quality: "dom7sus" },
        { degree: 0, quality: "maj69" },
        { degree: 5, quality: "maj7" },
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
      // i11 bVImaj7 bIII bVIIsus — rain through an open window
      [
        { degree: 0, quality: "min11" },
        { degree: 8, quality: "maj7" },
        { degree: 3, quality: "maj9" },
        { degree: 10, quality: "dom7sus" },
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

// Re-export melody types used by the engine and UI.
export type { MelodyPlan, MotifNote, MotifVariation } from "./melodies";

// ---- bass riff ---------------------------------------------------------------

export type RiffDeg = "root" | "third" | "fifth" | "octave" | "approach";

export interface RiffNote {
  /** 16th-note position within the chord's two bars (0–31). */
  step: number;
  /** Chord-relative degree; "approach" leans chromatically into the next chord. */
  deg: RiffDeg;
  /** Duration in beats. */
  beats: number;
  /** 0–1 within the riff; the engine drops quieter notes at low energy. */
  vel: number;
}

/**
 * A two-bar bass-guitar figure, generated once per scene and repeated under
 * every chord — the rhythmic theme of the scene. Syncopations land on (or
 * just after) the kit's kicks so bass and drums feel like one player.
 */
function makeBassRiff(kickSteps: number[]): RiffNote[] {
  const riff: RiffNote[] = [
    { step: 0, deg: "root", beats: rand(1.2, 1.8), vel: 1 },
    { step: 16, deg: chance(0.6) ? "root" : "fifth", beats: rand(1, 1.5), vel: 0.9 },
  ];
  const taken = new Set([0, 16]);

  // syncopated answers: on the kick, or the "and" right after it
  const candidates = kickSteps
    .filter((s) => s !== 0 && s !== 16)
    .flatMap((s) => [s, s + 2])
    .concat([10, 22, 26])
    .filter((s) => s > 0 && s < 30 && !taken.has(s));
  const count = randInt(2, 4);
  for (let i = 0; i < count && candidates.length > 0; i++) {
    const s = candidates.splice(randInt(0, candidates.length - 1), 1)[0];
    if (taken.has(s)) continue;
    taken.add(s);
    const deg: RiffDeg =
      s >= 26 && chance(0.6)
        ? "approach" // walk into the next chord
        : pick(["root", "root", "octave", "fifth", "fifth", "third"]);
    riff.push({ step: s, deg, beats: rand(0.5, 1), vel: rand(0.5, 0.75) });
  }

  // an occasional ghosted offbeat 16th, felt more than heard
  if (chance(0.45)) {
    const s = pick([7, 15, 23]);
    if (!taken.has(s)) riff.push({ step: s, deg: "root", beats: 0.3, vel: 0.3 });
  }

  return riff.sort((a, b) => a.step - b.step);
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
  /** Stored phrases + song structure for human-feeling melody playback. */
  melodyPlan: MelodyPlan;
  /** Primary hook — anchor for fills and ambient echoes. */
  motif: MotifNote[];
  /** Full 8-bar passes through the progression before the next segue. */
  rounds: number;
  // performance
  band: Band;
  /** How this scene's chords are voiced (cozy clusters, open spreads, shells). */
  voicingStyle: VoicingStyle;
  /** Band's bass style with "either" resolved per scene. */
  bassStyle: "anchor" | "walking" | "groove";
  /** Two-bar bass figure for the "groove" style, locked to the kit's kicks. */
  bassRiff: RiffNote[];
  padOn: boolean;
  ambience: AmbienceSpec;
  tapeCutoff: number;
  wobbleCents: number;
  wobbleRate: number;
  reverbSend: number;
  reverbDecay: number;
  reverbDamp: number;
}

export interface ProgressionStepSummary {
  /** Chord symbol for the now-playing readout, e.g. "Fmaj9" or "Em7". */
  name: string;
}

/** Who is on stage this scene — drives the animated band on the home screen. */
export interface SceneLineup {
  chords: ChordVoice;
  melody: MelodyVoice;
  bass: BassVoice;
  kit: KitId;
  ambience: AmbienceBed;
}

export interface SceneSummary {
  name: string;
  family: MoodKey;
  keyName: string;
  bpm: number;
  /** Full 8-bar passes before the next segue. */
  rounds: number;
  /** Display name of the band playing this scene. */
  band: string;
  lineup: SceneLineup;
  progression: ProgressionStepSummary[];
}

function chordDisplayName(root: string, quality: Quality): string {
  const pc = root.replace(/-?\d$/, "");
  if (quality.includes("sus")) return `${pc}sus`;
  if (quality.startsWith("min")) return `${pc}m`;
  if (quality.startsWith("dom")) return `${pc}7`;
  return pc;
}

export function summarize(scene: Scene): SceneSummary {
  const { name, family, keyName, bpm, rounds, progressionIdx, progression } = scene;
  const specs = FAMILIES[family].progressions[progressionIdx];
  return {
    name,
    family,
    keyName,
    bpm,
    rounds,
    band: scene.band.name,
    lineup: {
      chords: scene.band.chordVoice,
      melody: scene.band.melodyVoice,
      bass: scene.band.bassVoice,
      kit: scene.band.kit,
      ambience: scene.ambience.bed,
    },
    progression: progression.map((chord, i) => ({
      name: chordDisplayName(chord.root, specs[i].quality),
    })),
  };
}

// Keys stay in this absolute window when voice-leading (about A2–G5).
const VOICE_LO = 45;
const VOICE_HI = 79;

/**
 * Voice a chord so each note moves as little as possible from the previous
 * chord — octave-displacing individual tones instead of jumping the whole
 * shape in parallel, the way a player's hand stays put on the keys.
 */
function leadVoicing(rootMidi: number, shape: readonly number[], prev?: number[]): number[] {
  const base = shape.map((iv) => rootMidi + iv);
  if (!prev || prev.length === 0) return base;
  const used = new Set<number>();
  const led = base.map((p) => {
    let best = p;
    let bestCost = Infinity;
    for (const cand of [p - 12, p, p + 12]) {
      if (cand < VOICE_LO || cand > VOICE_HI || used.has(cand)) continue;
      const cost = Math.min(...prev.map((q) => Math.abs(cand - q)));
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    used.add(best);
    return best;
  });
  return led.sort((a, b) => a - b);
}

function thirdInterval(quality: Quality): number {
  if (quality.includes("sus")) return 5;
  return quality.startsWith("min") ? 3 : 4;
}

function buildProgression(keyPc: number, specs: ChordSpec[], style: VoicingStyle): Chord[] {
  let prevVoicing: number[] | undefined;
  return specs.map((spec) => {
    // bass roots live in octave 2 (MIDI 36–47), like a thumb on the low keys
    const rootMidi = 36 + ((keyPc + spec.degree) % 12);
    const voicing = leadVoicing(rootMidi, QUALITIES[spec.quality][style], prevVoicing);
    prevVoicing = voicing;
    return {
      root: noteFromMidi(rootMidi),
      rootMidi,
      thirdIv: thirdInterval(spec.quality),
      notes: voicing.map(noteFromMidi),
    };
  });
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
  const melodyPlan = assembleMelodyPlan(family, scale.length, prev?.melodyPlan);

  // voicing character leans toward the band's comping: sustained voices love
  // open spreads, stabs sit best on shells, everything else favors the clusters
  const voicingStyle = weightedPick<VoicingStyle>(["cozy", "open", "shell"], (s) => {
    if (band.comping === "sustained") return s === "open" ? 2 : 1;
    if (band.comping === "stabs") return s === "shell" ? 2 : 1;
    return s === "cozy" ? 2 : 1;
  });

  return {
    family,
    name,
    keyPc,
    keyName: `${pitchClassName(keyPc)} ${cfg.minor ? "minor" : "major"}`,
    bpm: Math.round(rand(cfg.bpm[0], cfg.bpm[1])),
    swing: rand(0.5, 0.62),
    progressionIdx,
    progression: buildProgression(keyPc, cfg.progressions[progressionIdx], voicingStyle),
    scale,
    melodyPlan,
    motif: melodyPlan.phrases.A,
    rounds: randInt(3, 5),
    band,
    voicingStyle,
    bassStyle:
      band.bassStyle === "either"
        ? band.bassVoice === "bassGuitar"
          ? (chance(0.7) ? "groove" : "anchor")
          : (chance(0.5) ? "walking" : "anchor")
        : band.bassStyle,
    bassRiff: makeBassRiff([...KITS[band.kit].kicks]),
    padOn: chance(band.padChance * (family === "rainy" ? 1.4 : 1)),
    ambience: pickAmbience(family),
    tapeCutoff: rand(band.tapeCutoff[0], band.tapeCutoff[1]),
    wobbleCents: rand(4, 10),
    wobbleRate: rand(0.3, 0.8),
    reverbSend: rand(band.reverb.send[0], band.reverb.send[1]),
    reverbDecay: rand(band.reverb.decay[0], band.reverb.decay[1]),
    reverbDamp: rand(band.reverb.damp[0], band.reverb.damp[1]),
  };
}
