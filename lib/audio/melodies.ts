// Melody plans — stored phrase contours and song structures that get
// transposed onto each scene's scale. The engine iterates through the
// plan chord-by-chord and round-by-round so phrases feel like someone
// playing a tune, not random scale walks.

import { MINED_PHRASES } from "./mined-phrases";
import type { MoodKey } from "./moods";
import { chance, pick, rand, randInt } from "./random";

export interface MotifNote {
  /** Index into the scene's scale. */
  scaleIdx: number;
  /** 16th-note position within the chord's two bars (0–31). */
  step: number;
  /** Duration in beats. */
  beats: number;
  vel: number;
  /** Downbeat / phrase-peak accent — louder and slightly late. */
  accent?: boolean;
  /** Pickup note — lands a hair early. */
  pickup?: boolean;
}

export type MotifVariation =
  | "plain"
  | "answer"
  | "lift"
  | "displaced"
  | "ornament"
  | "fragment";

export type PhraseId = "A" | "B" | "answer" | "tag";

export type StructureId =
  | "call-response"
  | "aaba"
  | "hook-develop"
  | "through-song";

/** One melodic cell in a stored phrase template (relative to anchor degree). */
export interface PhraseCell {
  rel: number;
  step: number;
  beats: number;
  vel: number;
  accent?: boolean;
  pickup?: boolean;
}

export interface PhraseTemplate {
  cells: readonly PhraseCell[];
}

export interface MelodySlot {
  phraseId: PhraseId;
  variation: MotifVariation;
  /** Likelihood the player actually states this phrase (room to breathe). */
  presence: number;
}

export interface MelodyPlan {
  structureId: StructureId;
  /** Which library row was chosen — rotated so scenes don't repeat. */
  variantIdx: number;
  /** Transposed phrases, ready for the engine. */
  phrases: Record<PhraseId, MotifNote[]>;
  /** What to play on each chord during grooving rounds (index = chord 0–3). */
  slots: MelodySlot[];
  /** Middle-round variation cycle layered on top of the structure. */
  roundCycle: MotifVariation[];
  answerShift: number;
}

// ---- phrase library ----------------------------------------------------------
// Contours model real lofi shapes: pickups, held tones, rests between ideas,
// stepwise motion with a small skip, resolution on the last note.

const PHRASE_LIBRARY: Record<MoodKey, Record<PhraseId, PhraseTemplate[]>> = {
  mellow: {
    A: [
      {
        cells: [
          { rel: 0, step: 1, beats: 0.25, vel: 0.055, pickup: true },
          { rel: 1, step: 2, beats: 0.75, vel: 0.075 },
          { rel: 0, step: 6, beats: 1, vel: 0.08 },
          { rel: -1, step: 10, beats: 1.5, vel: 0.095, accent: true },
          { rel: 0, step: 16, beats: 2, vel: 0.07 },
        ],
      },
      {
        cells: [
          { rel: 1, step: 2, beats: 0.5, vel: 0.07, pickup: true },
          { rel: 0, step: 4, beats: 1, vel: 0.085 },
          { rel: 1, step: 8, beats: 1, vel: 0.08 },
          { rel: 0, step: 12, beats: 1.5, vel: 0.09, accent: true },
          { rel: -1, step: 18, beats: 1.5, vel: 0.075 },
        ],
      },
    ],
    B: [
      {
        cells: [
          { rel: 2, step: 2, beats: 0.5, vel: 0.07 },
          { rel: 1, step: 5, beats: 0.75, vel: 0.065 },
          { rel: 2, step: 8, beats: 1, vel: 0.08, accent: true },
          { rel: 1, step: 12, beats: 1, vel: 0.075 },
          { rel: 0, step: 16, beats: 2, vel: 0.085 },
        ],
      },
    ],
    answer: [
      {
        cells: [
          { rel: -1, step: 2, beats: 0.5, vel: 0.065 },
          { rel: 0, step: 6, beats: 1, vel: 0.08 },
          { rel: 1, step: 10, beats: 1, vel: 0.075 },
          { rel: 0, step: 14, beats: 2, vel: 0.09, accent: true },
        ],
      },
      {
        cells: [
          { rel: 0, step: 1, beats: 0.25, vel: 0.055, pickup: true },
          { rel: -1, step: 4, beats: 1, vel: 0.07 },
          { rel: 0, step: 8, beats: 1.5, vel: 0.085, accent: true },
          { rel: -1, step: 14, beats: 2, vel: 0.08 },
        ],
      },
    ],
    tag: [
      {
        cells: [
          { rel: 0, step: 4, beats: 0.75, vel: 0.065 },
          { rel: -1, step: 8, beats: 1.5, vel: 0.08, accent: true },
        ],
      },
    ],
  },
  jazzy: {
    A: [
      {
        cells: [
          { rel: 2, step: 1, beats: 0.25, vel: 0.06, pickup: true },
          { rel: 1, step: 3, beats: 0.5, vel: 0.07 },
          { rel: 2, step: 6, beats: 0.75, vel: 0.075 },
          { rel: 3, step: 9, beats: 1, vel: 0.085, accent: true },
          { rel: 2, step: 14, beats: 1.5, vel: 0.08 },
          { rel: 1, step: 20, beats: 1.5, vel: 0.075 },
        ],
      },
      {
        cells: [
          { rel: 1, step: 2, beats: 0.5, vel: 0.07 },
          { rel: 3, step: 5, beats: 0.5, vel: 0.065 },
          { rel: 2, step: 8, beats: 1, vel: 0.08 },
          { rel: 1, step: 12, beats: 1, vel: 0.075, accent: true },
          { rel: 0, step: 18, beats: 2, vel: 0.085 },
        ],
      },
    ],
    B: [
      {
        cells: [
          { rel: 3, step: 2, beats: 0.5, vel: 0.07 },
          { rel: 2, step: 6, beats: 0.75, vel: 0.068 },
          { rel: 1, step: 10, beats: 1, vel: 0.08 },
          { rel: 2, step: 14, beats: 1.5, vel: 0.085, accent: true },
          { rel: 0, step: 20, beats: 2, vel: 0.08 },
        ],
      },
    ],
    answer: [
      {
        cells: [
          { rel: 1, step: 2, beats: 0.5, vel: 0.065 },
          { rel: 0, step: 6, beats: 1, vel: 0.075 },
          { rel: -1, step: 10, beats: 1, vel: 0.07 },
          { rel: 0, step: 14, beats: 2, vel: 0.09, accent: true },
        ],
      },
    ],
    tag: [
      {
        cells: [
          { rel: 1, step: 6, beats: 0.75, vel: 0.065 },
          { rel: 0, step: 12, beats: 1.5, vel: 0.08, accent: true },
        ],
      },
    ],
  },
  rainy: {
    A: [
      {
        cells: [
          { rel: 0, step: 2, beats: 0.5, vel: 0.065 },
          { rel: -1, step: 6, beats: 1, vel: 0.075 },
          { rel: 0, step: 10, beats: 1.5, vel: 0.08, accent: true },
          { rel: -2, step: 16, beats: 2.5, vel: 0.085 },
        ],
      },
      {
        cells: [
          { rel: -1, step: 1, beats: 0.25, vel: 0.055, pickup: true },
          { rel: 0, step: 4, beats: 1, vel: 0.07 },
          { rel: -1, step: 9, beats: 1, vel: 0.075 },
          { rel: 0, step: 14, beats: 2, vel: 0.08, accent: true },
        ],
      },
    ],
    B: [
      {
        cells: [
          { rel: 1, step: 3, beats: 0.75, vel: 0.065 },
          { rel: 0, step: 8, beats: 1, vel: 0.075 },
          { rel: -1, step: 12, beats: 1.5, vel: 0.08, accent: true },
          { rel: -2, step: 18, beats: 2, vel: 0.085 },
        ],
      },
    ],
    answer: [
      {
        cells: [
          { rel: -1, step: 2, beats: 0.75, vel: 0.065 },
          { rel: 0, step: 8, beats: 1.5, vel: 0.08, accent: true },
          { rel: -1, step: 14, beats: 2, vel: 0.085 },
        ],
      },
    ],
    tag: [
      {
        cells: [
          { rel: 0, step: 8, beats: 1, vel: 0.065 },
          { rel: -1, step: 14, beats: 2, vel: 0.075, accent: true },
        ],
      },
    ],
  },
};

// Fold in contours mined from real tunes (see scripts/mine-melodies.ts). They
// share the exact PhraseCell shape, so they just widen each mood's phrase pool.
for (const mood of Object.keys(MINED_PHRASES) as MoodKey[]) {
  for (const id of Object.keys(MINED_PHRASES[mood]) as PhraseId[]) {
    PHRASE_LIBRARY[mood][id].push(...MINED_PHRASES[mood][id]);
  }
}

// ---- song structures ---------------------------------------------------------
// Each maps the four chords of a round to stored phrases — real song shapes.

const STRUCTURES: Record<
  StructureId,
  readonly MelodySlot[]
> = {
  "call-response": [
    { phraseId: "A", variation: "plain", presence: 0.92 },
    { phraseId: "A", variation: "displaced", presence: 0.78 },
    { phraseId: "answer", variation: "plain", presence: 0.88 },
    { phraseId: "tag", variation: "fragment", presence: 0.72 },
  ],
  aaba: [
    { phraseId: "A", variation: "plain", presence: 0.9 },
    { phraseId: "A", variation: "lift", presence: 0.82 },
    { phraseId: "B", variation: "plain", presence: 0.85 },
    { phraseId: "A", variation: "ornament", presence: 0.88 },
  ],
  "hook-develop": [
    { phraseId: "A", variation: "plain", presence: 0.95 },
    { phraseId: "tag", variation: "fragment", presence: 0.55 },
    { phraseId: "B", variation: "plain", presence: 0.8 },
    { phraseId: "tag", variation: "plain", presence: 0.65 },
  ],
  "through-song": [
    { phraseId: "A", variation: "plain", presence: 0.88 },
    { phraseId: "B", variation: "displaced", presence: 0.82 },
    { phraseId: "answer", variation: "plain", presence: 0.85 },
    { phraseId: "tag", variation: "ornament", presence: 0.75 },
  ],
};

const STRUCTURE_IDS = Object.keys(STRUCTURES) as StructureId[];

function makeRoundCycle(): MotifVariation[] {
  const pool: MotifVariation[] = ["lift", "displaced", "ornament"];
  const a = pick(pool);
  let b = pick(pool);
  while (b === a) b = pick(pool);
  return ["plain", a, b];
}

function fitPhrase(template: PhraseTemplate, anchorIdx: number, scaleLen: number): MotifNote[] {
  return template.cells.map((c) => ({
    scaleIdx: Math.max(0, Math.min(scaleLen - 1, anchorIdx + c.rel)),
    step: c.step,
    beats: c.beats,
    vel: c.vel * rand(0.94, 1.06),
    accent: c.accent,
    pickup: c.pickup,
  }));
}

function pickStructure(prevId?: StructureId): StructureId {
  const pool = STRUCTURE_IDS.filter((id) => id !== prevId);
  return pick(pool);
}

function pickVariant(prevIdx: number | undefined, family: MoodKey): number {
  const count = PHRASE_LIBRARY[family].A.length;
  if (count <= 1) return 0;
  if (prevIdx === undefined) return randInt(0, count - 1);
  return (prevIdx + 1 + randInt(0, count - 2)) % count;
}

/** Build a transposed melody plan for a scene — stored phrases + structure. */
export function assembleMelodyPlan(
  family: MoodKey,
  scaleLen: number,
  prev?: MelodyPlan,
): MelodyPlan {
  const structureId = pickStructure(prev?.structureId);
  const variantIdx = pickVariant(prev?.variantIdx, family);
  const lib = PHRASE_LIBRARY[family];
  const anchorIdx = randInt(2, Math.max(2, scaleLen - 3));

  const pickTpl = (id: PhraseId, offset = 0) => {
    const variants = lib[id];
    return variants[(variantIdx + offset) % variants.length];
  };

  const phrases: Record<PhraseId, MotifNote[]> = {
    A: fitPhrase(pickTpl("A", 0), anchorIdx, scaleLen),
    B: fitPhrase(pickTpl("B", 0), anchorIdx + pick([-1, 0, 1]), scaleLen),
    answer: fitPhrase(pickTpl("answer", 1), anchorIdx, scaleLen),
    tag: fitPhrase(pickTpl("tag", 0), anchorIdx, scaleLen),
  };

  return {
    structureId,
    variantIdx,
    phrases,
    slots: STRUCTURES[structureId].map((s) => ({ ...s })),
    roundCycle: makeRoundCycle(),
    answerShift: pick([-2, -1, 1, 1, 2]),
  };
}

/** Apply a named variation to a stored phrase. */
export function varyPhrase(
  notes: MotifNote[],
  variation: MotifVariation,
  answerShift: number,
): MotifNote[] {
  switch (variation) {
    case "plain":
      return notes;
    case "answer":
      return notes.map((n) => ({ ...n, scaleIdx: n.scaleIdx + answerShift }));
    case "lift":
      return notes.map((n) => ({ ...n, scaleIdx: n.scaleIdx + 2, vel: n.vel * 0.9 }));
    case "displaced":
      return notes.map((n) => ({ ...n, step: Math.min(30, n.step + 2) }));
    case "ornament": {
      const out: MotifNote[] = [];
      for (const n of notes) {
        if (n.beats >= 1 && n.step >= 2 && chance(0.65)) {
          out.push({
            scaleIdx: Math.max(0, n.scaleIdx - 1),
            step: Math.max(0, n.step - 1),
            beats: 0.25,
            vel: n.vel * 0.45,
            pickup: true,
          });
        }
        out.push(n);
      }
      return out;
    }
    case "fragment":
      return notes
        .slice(0, Math.max(2, Math.ceil(notes.length * 0.55)))
        .map((n) => ({ ...n, vel: n.vel * 0.82 }));
  }
}
