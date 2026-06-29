// Bass line plan — one contiguous four-chord bass part, not a repeated 2-bar loop.

import type { DrumKit, BassStyle } from "./bands";
import type { PatternDNA } from "./drift-algorithm";
import type { MotifNote } from "./melodies";
import type { PhraseTemplate } from "./melodies";
import { midiFromNote } from "./notes";
import { chance, pick, rand, randInt } from "./random";

import type { RiffDeg, RiffNote } from "./bass-patterns";

type ResolvedBassStyle = Exclude<BassStyle, "either">;

export interface ChordRootInput {
  rootMidi: number;
  thirdIv: number;
}

export interface BassLinePlan {
  /** Two-bar figure per chord — index matches progression step 0–3. */
  byChord: RiffNote[][];
  /** Shared diatonic anchor rel from the tune package (melody–bass lock). */
  sharedAnchorRel: number;
}

const CHORD_DEG_VARIANTS: RiffDeg[][] = [
  ["root", "fifth", "third", "octave"],
  ["root", "third", "fifth", "root"],
  ["root", "octave", "fifth", "third"],
  ["root", "fifth", "root", "fifth"],
];

function grooveFigureForChord(
  chordIdx: number,
  kickSteps: number[],
  patterns: PatternDNA,
): RiffNote[] {
  const barTwo = CHORD_DEG_VARIANTS[chordIdx % CHORD_DEG_VARIANTS.length][1];
  const riff: RiffNote[] = [
    { step: 0, deg: "root", beats: rand(1.2, 1.8), vel: 1 },
    { step: 16, deg: barTwo, beats: rand(1, 1.5), vel: 0.9 },
  ];
  const taken = new Set([0, 16]);

  const fillSteps = [
    [10, 26],
    [8, 24],
    [12, 28],
    [6, 22],
  ][chordIdx % 4];
  const fillDegs = [
    ["fifth", "octave"],
    ["third", "fifth"],
    ["octave", "approach"],
    ["third", "root"],
  ][chordIdx % 4] as RiffDeg[];

  for (let i = 0; i < fillSteps.length; i++) {
    const s = fillSteps[i];
    if (taken.has(s)) continue;
    taken.add(s);
    riff.push({
      step: s,
      deg: fillDegs[i],
      beats: rand(0.5, 1),
      vel: rand(0.5, 0.75),
    });
  }

  const kickCandidates = kickSteps
    .filter((s) => s !== 0 && s !== 16 && !taken.has(s))
    .slice(0, 1);
  for (const s of kickCandidates) {
    taken.add(s);
    riff.push({
      step: s,
      deg: pick(["root", "fifth", "octave"]),
      beats: rand(0.4, 0.8),
      vel: rand(0.45, 0.65),
    });
  }

  if (chance(0.3 + patterns.drumGhostMul * 0.1)) {
    const ghostStep = pick([7, 15, 23].filter((s) => !taken.has(s)));
    if (ghostStep !== undefined) {
      riff.push({ step: ghostStep, deg: "root", beats: 0.3, vel: 0.3 });
    }
  }

  return riff.sort((a, b) => a.step - b.step);
}

function anchorFigureForChord(chordIdx: number, patterns: PatternDNA): RiffNote[] {
  const secondHit: RiffDeg[] = ["root", "fifth", "root", "third"];
  const riff: RiffNote[] = [
    { step: 0, deg: "root", beats: rand(1.6, 1.9), vel: 1 },
    { step: 16, deg: secondHit[chordIdx % 4], beats: rand(1.2, 1.5), vel: 0.9 },
  ];
  const optionalByChord: RiffNote[][] = [
    [{ step: 10, deg: "fifth", beats: 0.7, vel: 0.65 }],
    [{ step: 26, deg: "approach", beats: 0.6, vel: 0.5 }],
    [{ step: 8, deg: "third", beats: 0.5, vel: 0.45 }],
    [{ step: 10, deg: "root", beats: 0.7, vel: 0.55 }, { step: 26, deg: "fifth", beats: 0.6, vel: 0.45 }],
  ];
  for (const hit of optionalByChord[chordIdx % 4]) {
    if (chance(0.45 + patterns.compingSpread * 0.15)) {
      riff.push({ ...hit, beats: hit.beats * rand(0.9, 1.1) });
    }
  }
  return riff.sort((a, b) => a.step - b.step);
}

function walkingFigureForChord(
  chordIdx: number,
  progLen: number,
  patterns: PatternDNA,
): RiffNote[] {
  const walkShapes: RiffDeg[][] = [
    ["root", "third", "fifth", "third"],
    ["root", "fifth", "third", "fifth"],
    ["root", "third", "root", "fifth"],
    ["root", "fifth", "fifth", "third"],
  ];
  const shape = walkShapes[chordIdx % 4];
  const fig: RiffNote[] = [
    { step: 0, deg: shape[0], beats: 1.6, vel: 1 },
    { step: 8, deg: shape[1], beats: 0.6, vel: 0.55 },
    { step: 16, deg: shape[2], beats: 1, vel: 0.85 },
    { step: 22, deg: shape[3], beats: 0.6, vel: 0.5 },
  ];
  if (chordIdx < progLen - 1) {
    fig.push({ step: 28, deg: "approach", beats: 0.5, vel: 0.45 });
  } else {
    fig.push({ step: 28, deg: "fifth", beats: 0.5, vel: 0.4 });
  }

  const density = Math.min(0.95, 0.55 + patterns.compingSpread * 0.2);
  return fig
    .filter((hit, i) => i === 0 || i === 2 || i === fig.length - 1 || chance(density))
    .map((hit) => ({
      ...hit,
      beats: hit.beats * rand(0.92, 1.08),
      vel: hit.vel * rand(0.92, 1.05),
    }));
}

function figureForChord(
  style: ResolvedBassStyle,
  chordIdx: number,
  progLen: number,
  kickSteps: number[],
  patterns: PatternDNA,
): RiffNote[] {
  switch (style) {
    case "groove":
      return grooveFigureForChord(chordIdx, kickSteps, patterns);
    case "walking":
      return walkingFigureForChord(chordIdx, progLen, patterns);
    case "anchor":
      return anchorFigureForChord(chordIdx, patterns);
  }
}

function relToBassDeg(rel: number): RiffDeg {
  if (rel <= -2) return "approach";
  if (rel === 0) return "root";
  if (rel <= 2) return "third";
  if (rel <= 4) return "fifth";
  return "octave";
}

/** Map a mined bass contour template onto a chord figure. */
function figureFromMinedBass(tpl: PhraseTemplate, chordIdx: number): RiffNote[] {
  const degShift = chordIdx % 3;
  return tpl.cells.map((cell) => {
    const rel = cell.rel + (degShift === 1 ? 1 : degShift === 2 ? -1 : 0);
    return {
      step: cell.step,
      deg: relToBassDeg(rel),
      beats: cell.beats,
      vel: Math.min(1, cell.vel * 1.4),
    };
  });
}

function sharedAnchorFromMelody(motif: readonly MotifNote[] | undefined): number {
  if (!motif?.length) return 0;
  const first = motif[0];
  const last = motif[motif.length - 1];
  return last.scaleIdx - first.scaleIdx;
}

/** Build a four-chord bass line — distinct figure per progression step. */
export function generateBassLinePlan(
  style: ResolvedBassStyle,
  progression: readonly ChordRootInput[],
  drumGrammar: DrumKit,
  patterns: PatternDNA,
  opts?: {
    melodyMotif?: readonly MotifNote[];
    minedBass?: PhraseTemplate;
  },
): BassLinePlan {
  const progLen = progression.length;
  const byChord = progression.map((_, chordIdx) => {
    if (opts?.minedBass && chordIdx === 0) {
      return figureFromMinedBass(opts.minedBass, chordIdx);
    }
    if (opts?.minedBass && chordIdx > 0) {
      return figureFromMinedBass(opts.minedBass, chordIdx).map((n) => ({
        ...n,
        deg: n.deg === "root" && chordIdx === progLen - 1 ? "fifth" : n.deg,
      }));
    }
    return figureForChord(style, chordIdx, progLen, drumGrammar.kicks, patterns);
  });

  return {
    byChord,
    sharedAnchorRel: sharedAnchorFromMelody(opts?.melodyMotif),
  };
}

/** Resolve a riff degree to a MIDI note — approach targets the next chord explicitly. */
export function resolveBassMidi(
  deg: RiffDeg,
  chord: ChordRootInput,
  nextChord: ChordRootInput | undefined,
  opts?: { octaveDown?: boolean },
): number {
  let midi: number;
  switch (deg) {
    case "root":
      midi = chord.rootMidi;
      break;
    case "third":
      midi = chord.rootMidi + chord.thirdIv;
      break;
    case "fifth":
      midi = chord.rootMidi + 7;
      break;
    case "octave":
      midi = chord.rootMidi + 12;
      break;
    case "approach":
      if (!nextChord) {
        midi = chord.rootMidi + 7;
        break;
      }
      midi = nextChord.rootMidi - 1;
      break;
  }
  if (opts?.octaveDown) midi -= 12;
  return midi;
}

/** Melody–bass lock: avoid doubling the melody root on a strong beat. */
export function bassMelodyLock(
  rn: RiffNote,
  chord: ChordRootInput,
  melodyPhrase: readonly MotifNote[] | undefined,
  scale: readonly string[],
): { skip: boolean; octaveDown: boolean } {
  if (rn.deg !== "root" || !melodyPhrase?.length) {
    return { skip: false, octaveDown: false };
  }

  const melodyAtStep = melodyPhrase.find((n) => n.step === rn.step);
  if (!melodyAtStep) return { skip: false, octaveDown: false };

  const melodyPc = midiFromNote(scale[melodyAtStep.scaleIdx]) % 12;
  const rootPc = chord.rootMidi % 12;
  if (melodyPc !== rootPc) return { skip: false, octaveDown: false };

  const strong = rn.step === 0 || Boolean(melodyAtStep.accent) || rn.step % 4 === 0;
  if (!strong) return { skip: true, octaveDown: false };
  return { skip: false, octaveDown: true };
}

/** Flatten plan for snapshots / legacy consumers. */
export function flattenBassPlan(plan: BassLinePlan): RiffNote[] {
  return plan.byChord.flat();
}
