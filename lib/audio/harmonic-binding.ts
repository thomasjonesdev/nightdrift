// Harmonic binding — melody phrases anchored to each chord in the progression.

import { midiFromNote, noteFromMidi } from "./notes";

export type HarmonicRole = "setup" | "tension" | "resolution" | "cadence" | "color";

export interface ProgressionStepInput {
  degree: number;
  quality: string;
}

export interface ChordToneInput {
  rootMidi: number;
  thirdIv: number;
  notes: readonly string[];
}

export interface PhraseCellInput {
  rel: number;
  step: number;
  beats: number;
  vel: number;
  accent?: boolean;
  pickup?: boolean;
}

export interface PhraseTemplateInput {
  cells: readonly PhraseCellInput[];
}

export interface MotifNoteInput {
  scaleIdx: number;
  step: number;
  beats: number;
  vel: number;
  accent?: boolean;
  pickup?: boolean;
}

export interface MelodySlotInput {
  phraseId: "A" | "B" | "answer" | "tag";
  variation: string;
  presence: number;
}

export type StructureHint = "call-response" | "aaba" | "hook-develop" | "through-song";

const ROLE_SLOTS: Record<HarmonicRole, MelodySlotInput> = {
  setup: { phraseId: "A", variation: "plain", presence: 0.92 },
  tension: { phraseId: "B", variation: "displaced", presence: 0.85 },
  resolution: { phraseId: "answer", variation: "plain", presence: 0.88 },
  cadence: { phraseId: "tag", variation: "fragment", presence: 0.75 },
  color: { phraseId: "A", variation: "lift", presence: 0.82 },
};

/** Degree-sequence → harmonic role per bar (mod-12 degrees). */
const PROGRESSION_ROLE_MAP: Record<string, HarmonicRole[]> = {
  "2,7,0,9": ["setup", "tension", "resolution", "cadence"],
  "2,7,0,5": ["setup", "tension", "resolution", "color"],
  "0,9,2,7": ["setup", "color", "setup", "tension"],
  "4,9,2,7": ["setup", "tension", "setup", "tension"],
  "5,4,2,0": ["color", "color", "setup", "resolution"],
  "0,9,5,7": ["setup", "color", "color", "tension"],
  "0,4,9,5": ["setup", "color", "color", "color"],
  "5,7,4,9": ["color", "tension", "setup", "cadence"],
  "0,7,5,4": ["setup", "tension", "color", "color"],
  "0,8,2,7": ["setup", "tension", "setup", "tension"],
  "0,8,5,7": ["setup", "color", "setup", "tension"],
  "0,5,8,10": ["setup", "color", "color", "cadence"],
  "0,3,8,7": ["setup", "color", "color", "tension"],
  "0,10,8,7": ["setup", "cadence", "color", "tension"],
  "0,8,3,10": ["setup", "color", "color", "cadence"],
};

function isDominant(quality: string): boolean {
  return quality.startsWith("dom");
}

function isMinorQuality(quality: string): boolean {
  return quality.startsWith("min");
}

function degreeSignature(steps: readonly ProgressionStepInput[]): string {
  return steps.map((s) => s.degree % 12).join(",");
}

function classifyStepHeuristic(
  step: ProgressionStepInput,
  idx: number,
  steps: readonly ProgressionStepInput[],
): HarmonicRole {
  const next = steps[(idx + 1) % steps.length];
  const prev = steps[(idx + steps.length - 1) % steps.length];

  if (isDominant(step.quality)) {
    return next.degree % 12 === 0 ? "tension" : "tension";
  }
  if (step.degree % 12 === 0) {
    if (isDominant(prev.quality)) return "resolution";
    if (idx === 0) return "setup";
    if (idx === steps.length - 1) return "cadence";
    return "resolution";
  }
  if (isMinorQuality(step.quality) && steps.some((s, j) => j > idx && isDominant(s.quality))) {
    return "setup";
  }
  if (idx === steps.length - 1) return "cadence";
  return "color";
}

/** Assign a harmonic role to each chord in a four-bar progression. */
export function harmonicRolesForProgression(
  steps: readonly ProgressionStepInput[],
): HarmonicRole[] {
  if (steps.length !== 4) {
    return steps.map((s, i) => classifyStepHeuristic(s, i, steps));
  }
  const sig = degreeSignature(steps);
  return PROGRESSION_ROLE_MAP[sig] ?? steps.map((s, i) => classifyStepHeuristic(s, i, steps));
}

/** Map harmonic roles to melody slots — progression-aware song form. */
export function slotsForHarmonicRoles(
  roles: readonly HarmonicRole[],
  structureHint?: StructureHint,
): MelodySlotInput[] {
  const slots = roles.map((role) => ({ ...ROLE_SLOTS[role] }));

  if (structureHint === "aaba" && slots.length >= 4) {
    slots[2] = { phraseId: "B", variation: "plain", presence: 0.85 };
    slots[3] = { phraseId: "A", variation: "ornament", presence: 0.88 };
  } else if (structureHint === "call-response" && slots.length >= 4) {
    slots[1] = { phraseId: "A", variation: "displaced", presence: 0.78 };
    slots[2] = { phraseId: "answer", variation: "plain", presence: 0.88 };
  } else if (structureHint === "hook-develop" && slots.length >= 4) {
    slots[1] = { phraseId: "tag", variation: "fragment", presence: 0.55 };
    slots[3] = { phraseId: "tag", variation: "plain", presence: 0.65 };
  }

  return slots;
}

function anchorForChord(chord: ChordToneInput, scale: readonly string[]): number {
  const rootPc = chord.rootMidi % 12;
  const candidates: number[] = [];
  for (let i = 0; i < scale.length; i++) {
    if (midiFromNote(scale[i]) % 12 === rootPc) candidates.push(i);
  }
  if (candidates.length === 0) {
    return nearestScaleIdxForPc(rootPc, scale);
  }
  const mid = Math.floor(scale.length / 2);
  return candidates.reduce(
    (best, idx) => (Math.abs(idx - mid) < Math.abs(best - mid) ? idx : best),
    candidates[0],
  );
}

function nearestScaleIdxForPc(pc: number, scale: readonly string[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < scale.length; i++) {
    const notePc = midiFromNote(scale[i]) % 12;
    const d = Math.min(Math.abs(notePc - pc), 12 - Math.abs(notePc - pc));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function chordToneIndices(chord: ChordToneInput, scale: readonly string[]): number[] {
  const pcs = new Set<number>([
    chord.rootMidi % 12,
    (chord.rootMidi + chord.thirdIv) % 12,
    (chord.rootMidi + 7) % 12,
  ]);
  for (const n of chord.notes) pcs.add(midiFromNote(n) % 12);

  const out: number[] = [];
  for (let i = 0; i < scale.length; i++) {
    if (pcs.has(midiFromNote(scale[i]) % 12)) out.push(i);
  }
  return out;
}

/** Snap a scale index to the nearest chord tone in the scene scale. */
export function nearestChordToneIndex(
  idx: number,
  chord: ChordToneInput,
  scale: readonly string[],
): number {
  const tones = chordToneIndices(chord, scale);
  if (tones.length === 0) return idx;
  return tones.reduce(
    (best, cand) => (Math.abs(cand - idx) < Math.abs(best - idx) ? cand : best),
    tones[0],
  );
}

function resolutionIndex(idx: number, chord: ChordToneInput, scale: readonly string[]): number {
  const prefer = [
    chord.rootMidi % 12,
    (chord.rootMidi + chord.thirdIv) % 12,
    (chord.rootMidi + 7) % 12,
  ];
  for (const pc of prefer) {
    const candidates = scale
      .map((n, i) => ({ i, pc: midiFromNote(n) % 12 }))
      .filter((x) => x.pc === pc)
      .map((x) => x.i);
    if (candidates.length > 0) {
      return candidates.reduce(
        (best, cand) => (Math.abs(cand - idx) < Math.abs(best - idx) ? cand : best),
        candidates[0],
      );
    }
  }
  return nearestChordToneIndex(idx, chord, scale);
}

function isStrongBeat(cell: PhraseCellInput, step: number): boolean {
  return Boolean(cell.accent) || step % 4 === 0 || cell.beats >= 1;
}

/**
 * Transpose a phrase template onto a chord — anchor to root, snap strong beats
 * to chord tones, resolve the last cell to root/3rd/5th.
 */
export function fitPhraseToChord(
  template: PhraseTemplateInput,
  chord: ChordToneInput,
  scale: readonly string[],
  opts?: { anchorOffset?: number; preserveVel?: boolean },
): MotifNoteInput[] {
  const anchor = anchorForChord(chord, scale) + (opts?.anchorOffset ?? 0);
  const notes: MotifNoteInput[] = template.cells.map((c) => ({
    scaleIdx: Math.max(0, Math.min(scale.length - 1, anchor + c.rel)),
    step: c.step,
    beats: c.beats,
    vel: c.vel,
    accent: c.accent,
    pickup: c.pickup,
  }));

  for (let i = 0; i < notes.length; i++) {
    const cell = template.cells[i];
    const n = notes[i];
    const last = i === notes.length - 1;
    if (last) {
      n.scaleIdx = resolutionIndex(n.scaleIdx, chord, scale);
    } else if (isStrongBeat(cell, n.step)) {
      n.scaleIdx = nearestChordToneIndex(n.scaleIdx, chord, scale);
    }
  }

  return notes;
}

/** Re-anchor an existing motif onto a new chord with harmonic snapping. */
export function fitMotifToChord(
  notes: readonly MotifNoteInput[],
  chord: ChordToneInput,
  scale: readonly string[],
  anchorOffset = 0,
): MotifNoteInput[] {
  const anchor = anchorForChord(chord, scale) + anchorOffset;
  const baseIdx = notes.length > 0 ? notes[0].scaleIdx : anchor;
  const shift = anchor - baseIdx;

  const bound = notes.map((n) => ({
    ...n,
    scaleIdx: Math.max(0, Math.min(scale.length - 1, n.scaleIdx + shift)),
  }));

  for (let i = 0; i < bound.length; i++) {
    const n = bound[i];
    const last = i === bound.length - 1;
    const strong = Boolean(n.accent) || n.step % 4 === 0 || n.beats >= 1;
    if (last) {
      n.scaleIdx = resolutionIndex(n.scaleIdx, chord, scale);
    } else if (strong) {
      n.scaleIdx = nearestChordToneIndex(n.scaleIdx, chord, scale);
    }
  }

  return bound;
}

export const PHRASE_ANCHOR_OFFSET: Partial<Record<MelodySlotInput["phraseId"], number>> = {
  B: 1,
  answer: 0,
  tag: -1,
};

/** Pick a melody pitch — uses chord tones when the scale has no matching pitch class. */
export function melodyNoteForChord(
  scaleIdx: number,
  scale: readonly string[],
  chord: ChordToneInput,
): string {
  const scaleNote = scale[Math.max(0, Math.min(scale.length - 1, scaleIdx))];
  const chordPcs = new Set<number>([
    chord.rootMidi % 12,
    (chord.rootMidi + chord.thirdIv) % 12,
    (chord.rootMidi + 7) % 12,
  ]);
  for (const n of chord.notes) chordPcs.add(midiFromNote(n) % 12);

  if (chordPcs.has(midiFromNote(scaleNote) % 12)) return scaleNote;

  const targetMidi = midiFromNote(scaleNote);
  let bestMidi = targetMidi;
  let bestDist = Infinity;
  for (const n of chord.notes) {
    const m = midiFromNote(n);
    for (const cand of [m - 12, m, m + 12]) {
      const d = Math.abs(cand - targetMidi);
      if (d < bestDist) {
        bestDist = d;
        bestMidi = cand;
      }
    }
  }
  return noteFromMidi(bestMidi);
}
