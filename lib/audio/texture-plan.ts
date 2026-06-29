// Texture plan — chord-tone arps, pickups, tails, and inner lines for continuous richness.

import type { MelodyBehavior } from "./bands";
import { occupiedSteps } from "./melody-fills";
import type { MelodyPlan, MotifNote } from "./melodies";
import { midiFromNote } from "./notes";

export type TextureKind = "pickup" | "arp" | "tail" | "inner" | "shimmer";

export interface TextureNote {
  scaleIdx: number;
  step: number;
  beats: number;
  vel: number;
  kind: TextureKind;
  /** Play on the harmony voice instead of melody when true. */
  harmonyVoice?: boolean;
}

export interface ChordTexture {
  pickup: TextureNote[];
  arp: TextureNote[];
  tail: TextureNote[];
  inner: TextureNote[];
  shimmer: TextureNote[];
}

export interface TexturePlan {
  byChord: ChordTexture[];
}

/** Minimal chord input — avoids importing Scene/Chord (circular with scenes.ts). */
export interface TextureChordInput {
  rootMidi: number;
  notes: readonly string[];
}

const ARP_PATTERNS: readonly (readonly number[])[] = [
  [18, 20, 22, 24],
  [20, 22, 24, 26],
  [16, 18, 20, 22],
  [22, 24, 26, 28],
];

const INNER_STEPS = [6, 14, 22] as const;

function clampScaleIdx(idx: number, scaleLen: number): number {
  return Math.max(0, Math.min(scaleLen - 1, idx));
}

function chordToneScaleIndices(chord: TextureChordInput, scale: string[]): number[] {
  const pcs = new Set<number>();
  pcs.add(chord.rootMidi % 12);
  for (const n of chord.notes) pcs.add(midiFromNote(n) % 12);

  const indices: number[] = [];
  for (let i = 0; i < scale.length; i++) {
    if (pcs.has(midiFromNote(scale[i]) % 12)) indices.push(i);
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

function phraseEndStep(hook: readonly MotifNote[]): number {
  let end = 0;
  for (const n of hook) {
    end = Math.max(end, n.step + Math.max(1, Math.ceil(n.beats * 4)) - 1);
  }
  return end;
}

function hookForChord(melodyPlan: MelodyPlan, chordIdx: number): MotifNote[] {
  const bound = melodyPlan.chordPhrases[chordIdx];
  if (bound && bound.length > 0) return [...bound];
  const slot = melodyPlan.slots[chordIdx];
  if (!slot) return [...melodyPlan.phrases.A];
  return [...melodyPlan.phrases[slot.phraseId]];
}

function buildPickup(
  tag: readonly MotifNote[],
  hook: readonly MotifNote[],
  scaleLen: number,
): TextureNote[] {
  if (tag.length === 0 || hook.length === 0) return [];

  const hookStart = Math.min(...hook.map((n) => n.step));
  if (hookStart < 2) return [];

  const pickupCells =
    tag.some((n) => n.pickup)
      ? tag.filter((n) => n.pickup).slice(0, 2)
      : tag.slice(0, Math.min(2, tag.length));

  const notes: TextureNote[] = [];
  let step = Math.max(0, hookStart - pickupCells.length * 2);
  for (const cell of pickupCells) {
    notes.push({
      scaleIdx: clampScaleIdx(cell.scaleIdx, scaleLen),
      step,
      beats: cell.beats * 0.6,
      vel: cell.vel * 0.52,
      kind: "pickup",
    });
    step += 2;
  }
  return notes;
}

function buildTail(
  tag: readonly MotifNote[],
  hook: readonly MotifNote[],
  scaleLen: number,
): TextureNote[] {
  const end = phraseEndStep(hook);
  if (end >= 28 || tag.length < 2) return [];

  const tail = tag.slice(-2);
  const notes: TextureNote[] = [];
  let step = end + 2;
  for (const cell of tail) {
    if (step > 30) break;
    notes.push({
      scaleIdx: clampScaleIdx(cell.scaleIdx, scaleLen),
      step,
      beats: cell.beats * 0.55,
      vel: cell.vel * 0.48,
      kind: "tail",
    });
    step += 2;
  }
  return notes;
}

function buildArp(
  chord: TextureChordInput,
  scale: string[],
  chordIdx: number,
  hook: readonly MotifNote[],
  scaleLen: number,
): TextureNote[] {
  const tones = chordToneScaleIndices(chord, scale);
  if (tones.length < 2) return [];

  const occ = occupiedSteps(hook);
  const pattern = ARP_PATTERNS[chordIdx % ARP_PATTERNS.length];
  const notes: TextureNote[] = [];

  for (let i = 0; i < pattern.length; i++) {
    const arpStep = pattern[i];
    if (occ.has(arpStep) || occ.has(arpStep - 1)) continue;
    notes.push({
      scaleIdx: tones[i % tones.length],
      step: arpStep,
      beats: i === pattern.length - 1 ? 0.65 : 0.45,
      vel: 0.044 + (i === pattern.length - 1 ? 0.014 : 0),
      kind: "arp",
    });
  }

  const hookStart = hook.length ? Math.min(...hook.map((n) => n.step)) : 16;
  if (hookStart >= 4) {
    for (let i = 0; i < 3; i++) {
      const earlyStep = 2 + i * 2;
      if (!occ.has(earlyStep)) {
        notes.push({
          scaleIdx: tones[i % tones.length],
          step: earlyStep,
          beats: 0.35,
          vel: 0.04,
          kind: "arp",
        });
      }
    }
  }

  return notes;
}

function buildInner(
  chord: TextureChordInput,
  scale: string[],
  hook: readonly MotifNote[],
  scaleLen: number,
): TextureNote[] {
  const tones = chordToneScaleIndices(chord, scale);
  if (tones.length < 2) return [];

  const occ = occupiedSteps(hook);
  const notes: TextureNote[] = [];
  let toneIdx = 0;

  for (const innerStep of INNER_STEPS) {
    if (occ.has(innerStep)) continue;
    notes.push({
      scaleIdx: clampScaleIdx(tones[toneIdx % tones.length], scaleLen),
      step: innerStep,
      beats: 0.65,
      vel: 0.038,
      kind: "inner",
      harmonyVoice: true,
    });
    toneIdx++;
  }
  return notes;
}

function buildShimmer(
  chord: TextureChordInput,
  scale: string[],
  chordIdx: number,
  hook: readonly MotifNote[],
  scaleLen: number,
): TextureNote[] {
  if (chordIdx % 2 === 1) return [];

  const tones = chordToneScaleIndices(chord, scale);
  if (tones.length === 0 || occupiedSteps(hook).has(0)) return [];

  const mid = tones[Math.floor(tones.length / 2)];
  return [{
    scaleIdx: clampScaleIdx(mid, scaleLen),
    step: 0,
    beats: 1.8,
    vel: 0.03,
    kind: "shimmer",
  }];
}

function buildChordTexture(
  melodyPlan: MelodyPlan,
  chord: TextureChordInput,
  scale: string[],
  chordIdx: number,
  melodyBehavior: MelodyBehavior,
): ChordTexture {
  const hook = hookForChord(melodyPlan, chordIdx);
  const tag = melodyPlan.phrases.tag;
  const scaleLen = scale.length;

  const includeArp = melodyBehavior !== "held";
  const includeInner = melodyBehavior === "motif" || melodyBehavior === "sparse";
  const arpBoost = melodyBehavior === "arp";

  const arp = includeArp ? buildArp(chord, scale, chordIdx, hook, scaleLen) : [];
  if (arpBoost && arp.length > 0) {
    for (const n of arp) n.vel *= 1.15;
  }

  return {
    pickup: buildPickup(tag, hook, scaleLen),
    arp,
    tail: buildTail(tag, hook, scaleLen),
    inner: includeInner ? buildInner(chord, scale, hook, scaleLen) : [],
    shimmer: buildShimmer(chord, scale, chordIdx, hook, scaleLen),
  };
}

/** Per-chord texture figures bound to the melody plan and progression. */
export function generateTexturePlan(
  melodyPlan: MelodyPlan,
  progression: readonly TextureChordInput[],
  scale: string[],
  melodyBehavior: MelodyBehavior,
): TexturePlan {
  return {
    byChord: progression.map((chord, chordIdx) =>
      buildChordTexture(melodyPlan, chord, scale, chordIdx, melodyBehavior),
    ),
  };
}

/** All texture notes for a chord, flattened for step scheduling. */
export function textureNotesForChord(tex: ChordTexture): TextureNote[] {
  return [...tex.pickup, ...tex.arp, ...tex.tail, ...tex.inner, ...tex.shimmer];
}
