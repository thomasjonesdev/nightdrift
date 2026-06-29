// Scene generation — each scene is one "track" on the imaginary playlist:
// a key, a progression, a tempo, a melodic motif, a band (who's playing
// and how — see bands.ts), an ambience (see ambience.ts), and a name.
// The engine plays a scene for a few rounds (8-bar passes) and then
// segues into the next one.

import { pickAmbienceStack, type AmbienceBed, type AmbienceSpec } from "./ambience";
import {
  assembleBand,
  KITS,
  type Band,
  type BassVoice,
  type ChordVoice,
  type DrumKit,
  type KitId,
  type MelodyVoice,
} from "./bands";
import { generateCompingPattern, type CompingPattern } from "./comping-patterns";
import { generateBassLinePlan, type BassLinePlan } from "./bass-line-plan";
import type { RiffNote } from "./bass-patterns";
import { generateTexturePlan, type TexturePlan } from "./texture-plan";
import {
  generateSceneDNA,
  mutateDrumKit,
  shapeAmbience,
  type EnergyShape,
  type SceneDNA,
} from "./drift-algorithm";
import { applyProgressionVariants } from "./progression-grammar";
import {
  applyTapeContinuity,
  crossoverDna,
  planSegue,
  type RadioState,
} from "./radio-director";
import { MINED_TUNE_PACKAGES } from "./mined-tunes";
import {
  assembleMelodyPlan,
  applyMelodyMutations,
  bindMelodyToProgression,
  type MelodyPlan,
  type MotifNote,
} from "./melodies";
import type { MoodKey } from "./moods";
import { MOOD_PROFILES } from "./mood-profile";
import { noteFromMidi, pitchClassName } from "./notes";
import { chance, createRng, pick, rand, randInt, runWithRng, weightedPick, type Rng } from "./random";

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
  quality: Quality;
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
    bpm: [74, 84],
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
    bpm: [78, 92],
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
    keys: [0, 5, 7, 2, 9], // C F G D Am — major centers, rain without minor-key drama
    minor: false,
    bpm: [56, 66],
    progressions: [
      // I vi IV V — rain on a warm window
      [
        { degree: 0, quality: "maj9" },
        { degree: 9, quality: "min9" },
        { degree: 5, quality: "maj9" },
        { degree: 7, quality: "dom9" },
      ],
      // I IV vi V
      [
        { degree: 0, quality: "maj69" },
        { degree: 5, quality: "maj9" },
        { degree: 9, quality: "min9" },
        { degree: 7, quality: "dom13" },
      ],
      // vi IV I V — gentle lift home
      [
        { degree: 9, quality: "min9" },
        { degree: 5, quality: "maj9" },
        { degree: 0, quality: "maj9" },
        { degree: 7, quality: "dom9" },
      ],
      // I iii vi IV
      [
        { degree: 0, quality: "maj9" },
        { degree: 4, quality: "min9" },
        { degree: 9, quality: "min9" },
        { degree: 5, quality: "maj69" },
      ],
      // I Vsus IV iii — suspended grey sky, still major tonic
      [
        { degree: 0, quality: "maj9" },
        { degree: 7, quality: "dom7sus" },
        { degree: 5, quality: "maj69" },
        { degree: 4, quality: "min11" },
      ],
    ],
    scaleOffsets: [2, 4, 5, 7, 9, 11, 12, 14],
    names: [
      "rain on glass", "umbrella graveyard", "streetlight halo",
      "thunder two towns over", "wet asphalt mirror", "november windowsill",
      "drips from the awning", "grey morning premonition", "puddle constellations",
      "the storm stays outside", "fogged-up bus stop", "petrichor",
    ],
  },
};

// Re-export melody types used by the engine and UI.
export type { EnergyShape } from "./drift-algorithm";
export type { MelodyPlan, MotifNote, MotifVariation } from "./melodies";
export type { RiffDeg, RiffNote } from "./bass-patterns";
export type { BassLinePlan } from "./bass-line-plan";

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
  /** Per-chord bass figures — one line across the progression. */
  bassLinePlan: BassLinePlan;
  /** Chord-tone arps, pickups, tails, and inner lines for continuous texture. */
  texturePlan: TexturePlan;
  /** @deprecated Use bassLinePlan.byChord[chordIdx] — flat merge for legacy callers. */
  bassRiff: RiffNote[];
  padOn: boolean;
  ambience: AmbienceSpec;
  tapeCutoff: number;
  wobbleCents: number;
  wobbleRate: number;
  reverbSend: number;
  reverbDecay: number;
  reverbDamp: number;
  /** Tempo-synced echo wet level. */
  delayWet: number;
  /** Tempo-synced echo feedback. */
  delayFeedback: number;
  /** Pad/bed/harmony bus trim — rainy sits wetter, jazzy stays dry. */
  textureBusGain: number;
  /** Algorithmic feel profile — timing, patterns, effects, environment. */
  dna: SceneDNA;
  /** Kit grammar mutated for this scene's groove character. */
  drumGrammar: DrumKit;
  /** Algorithmic chord voicing grid for this scene's comping style. */
  compingPattern: CompingPattern;
  /** Seed for reproducible generation — share via ?seed= in the URL. */
  seed: number;
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
  /** Scene seed — same seed + mood reproduces this track. */
  seed: number;
  /** Structural energy arc for this scene. */
  energyShape: EnergyShape;
}

function chordDisplayName(root: string, quality: Quality): string {
  const pc = root.replace(/-?\d$/, "");
  if (quality.includes("sus")) return `${pc}sus`;
  if (quality.startsWith("min")) return `${pc}m`;
  if (quality.startsWith("dom")) return `${pc}7`;
  return pc;
}

export function summarize(scene: Scene): SceneSummary {
  const { name, family, keyName, bpm, rounds, progression } = scene;
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
    progression: progression.map((chord) => ({
      name: chordDisplayName(chord.root, chord.quality),
    })),
    seed: scene.seed,
    energyShape: scene.dna.structure.energyShape,
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
      quality: spec.quality,
    };
  });
}

function buildScale(keyPc: number, offsets: number[]): string[] {
  // anchor the melody pool around octaves 4–5 regardless of key
  let tonic = 60 + keyPc;
  if (keyPc > 6) tonic -= 12;
  return offsets.map((o) => noteFromMidi(tonic + o));
}

export function makeScene(
  family: MoodKey,
  prev?: Scene,
  sceneRng?: Rng,
  radio?: RadioState,
): Scene {
  const rng = sceneRng ?? createRng();
  return runWithRng(rng, () => buildScene(family, prev, rng.seed, radio));
}

function buildScene(
  family: MoodKey,
  prev: Scene | undefined,
  seed: number,
  radio?: RadioState,
): Scene {
  const cfg = FAMILIES[family];
  const segue = prev ? planSegue(radio ?? { history: [] }, prev, family, cfg.keys) : null;

  // wander to a different key center — director may steer complementary/contrast
  let keyPc = segue?.hints.keyPc ?? pick(cfg.keys);
  if (!cfg.keys.includes(keyPc)) keyPc = pick(cfg.keys);
  if (prev && prev.family === family && cfg.keys.length > 1 && keyPc === prev.keyPc) {
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
  const band = assembleBand(family, prev?.band.id, segue?.hints.avoidBandIds);
  let dna = generateSceneDNA(family, band, band.kit);
  if (prev && segue?.hints.inheritTrait) {
    dna = crossoverDna(prev, dna, segue.hints.inheritTrait);
  }

  const voicingStyle = weightedPick<VoicingStyle>(["cozy", "open", "shell"], (s) => {
    if (family === "jazzy") {
      if (s === "shell") return 2.8;
      if (s === "open") return 1.6;
      return 0.7;
    }
    if (family === "rainy") {
      if (s === "cozy") return 3.2;
      if (s === "open") return 1.4;
      return 0.5;
    }
    if (band.comping === "sustained") return s === "open" ? 2.5 : 1;
    if (band.comping === "stabs") return s === "shell" ? 2.2 : 1;
    return s === "cozy" ? 2.5 : 1;
  });

  const moodProd = MOOD_PROFILES[family].production;

  const progressionSpecs = applyProgressionVariants(
    cfg.progressions[progressionIdx],
    dna.harmony,
    cfg.minor,
    family,
  ) as ChordSpec[];
  const progression = buildProgression(keyPc, progressionSpecs, voicingStyle);

  const rawMelodyPlan = assembleMelodyPlan(
    family,
    scale,
    progressionSpecs,
    progression,
    prev?.melodyPlan,
    dna.melody,
  );
  const mutatedMelodyPlan = applyMelodyMutations(rawMelodyPlan, dna.melody, scale.length);
  const melodyPlan = bindMelodyToProgression(mutatedMelodyPlan, progression, scale);

  const compingPattern = generateCompingPattern(band.comping, 4, dna.patterns);
  const drumGrammar = mutateDrumKit(KITS[band.kit], dna.patterns);
  const ambience = shapeAmbience(pickAmbienceStack(family), dna.environment);

  const bassStyle: "anchor" | "walking" | "groove" =
    band.bassStyle === "either"
      ? band.bassVoice === "bassGuitar"
        ? (chance(0.7) ? "groove" : "anchor")
        : (chance(0.5) ? "walking" : "anchor")
      : band.bassStyle;

  const minedPkg = MINED_TUNE_PACKAGES.find((p) => p.id === melodyPlan.packageId);
  const bassLinePlan = generateBassLinePlan(
    bassStyle,
    progression,
    drumGrammar,
    dna.patterns,
    {
      melodyMotif: melodyPlan.phrases.A,
      minedBass: minedPkg?.bassPhrase,
    },
  );
  const texturePlan = generateTexturePlan(melodyPlan, progression, scale, band.melodyBehavior);

  let bpm = Math.round(rand(cfg.bpm[0], cfg.bpm[1]));
  if (segue?.hints.bpmAnchor !== undefined) {
    bpm = Math.round(
      Math.max(cfg.bpm[0], Math.min(cfg.bpm[1], segue.hints.bpmAnchor + rand(-3, 3))),
    );
  }

  const built: Scene = {
    family,
    name,
    keyPc,
    keyName: `${pitchClassName(keyPc)} ${cfg.minor ? "minor" : "major"}`,
    bpm,
    swing: rand(...MOOD_PROFILES[family].swing) * dna.timing.swingFeel,
    progressionIdx,
    progression,
    scale,
    melodyPlan,
    motif: melodyPlan.phrases.A,
    rounds: randInt(3, 5),
    band,
    voicingStyle,
    bassStyle,
    bassLinePlan,
    texturePlan,
    bassRiff: bassLinePlan.byChord.flat(),
    padOn: chance(Math.min(1, 0.12 + band.padChance * 0.72 * moodProd.padChanceMul)),
    ambience,
    tapeCutoff: rand(band.tapeCutoff[0], band.tapeCutoff[1]) * moodProd.tapeCutoffMul,
    wobbleCents: rand(...moodProd.wobbleCents),
    wobbleRate: rand(0.3, 0.8),
    reverbSend: Math.min(
      0.88,
      rand(band.reverb.send[0], band.reverb.send[1]) * 1.55 * moodProd.reverbSendMul,
    ),
    reverbDecay: rand(band.reverb.decay[0], band.reverb.decay[1]) * 1.45 * moodProd.reverbDecayMul,
    reverbDamp: rand(band.reverb.damp[0], band.reverb.damp[1]) * 0.82 * moodProd.reverbDampMul,
    delayWet: rand(...moodProd.delayWet),
    delayFeedback: rand(...moodProd.delayFeedback),
    textureBusGain: moodProd.textureBusGain,
    dna,
    drumGrammar,
    compingPattern,
    seed,
  };

  return prev && segue ? applyTapeContinuity(prev, built, segue.hints.strategy) : built;
}
