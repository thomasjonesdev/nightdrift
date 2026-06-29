// Melody plans — stored phrase contours and song structures that get
// transposed onto each scene's scale. The engine iterates through the
// plan chord-by-chord and round-by-round so phrases feel like someone
// playing a tune, not random scale walks.

import type { MelodyDNA } from "./drift-algorithm";
import {
  fitMotifToChord,
  fitPhraseToChord,
  harmonicRolesForProgression,
  PHRASE_ANCHOR_OFFSET,
  slotsForHarmonicRoles,
  type HarmonicRole,
  type ProgressionStepInput,
} from "./harmonic-binding";
import { grammarTemplate } from "./melody-grammar";
import { MINED_TUNE_PACKAGES } from "./mined-tunes";
import {
  packagesForMood,
  pickTunePackage,
  structureForPackage,
} from "./tune-package-picker";
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
  /** Explicit rest — no note sounding; used for rest-aware fill placement when mined. */
  rest?: boolean;
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
  /** Selected tune package id — all phrases share this source. */
  packageId: string;
  /** True when phrases come from a mined tune package (less mutation / grammar). */
  fromMinedPackage: boolean;
  /** @deprecated Use packageId — kept for snapshot compatibility. */
  variantIdx: number;
  /** Transposed phrases, ready for the engine. */
  phrases: Record<PhraseId, MotifNote[]>;
  /** What to play on each chord during grooving rounds (index = chord 0–3). */
  slots: MelodySlot[];
  /** Per-chord harmonically bound phrases (index = chord 0–3). */
  chordPhrases: MotifNote[][];
  /** Harmonic role per chord step — drives slot assignment. */
  harmonicRoles: HarmonicRole[];
  /** Phrases were bound to each chord's harmony at assembly time. */
  harmonicBound: boolean;
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

function fitPhrase(
  template: PhraseTemplate,
  anchorIdx: number,
  scaleLen: number,
  preserveVel = false,
): MotifNote[] {
  return template.cells.map((c) => ({
    scaleIdx: Math.max(0, Math.min(scaleLen - 1, anchorIdx + c.rel)),
    step: c.step,
    beats: c.beats,
    vel: preserveVel ? c.vel : c.vel * rand(0.94, 1.06),
    accent: c.accent,
    pickup: c.pickup,
  }));
}

export type { HarmonicRole } from "./harmonic-binding";

/** Build a transposed melody plan for a scene — one complete tune package. */
export function assembleMelodyPlan(
  family: MoodKey,
  scale: readonly string[],
  progressionSteps: readonly ProgressionStepInput[],
  progression: readonly { rootMidi: number; thirdIv: number; notes: readonly string[] }[],
  prev?: MelodyPlan,
  melody?: MelodyDNA,
): MelodyPlan {
  const scaleLen = scale.length;
  const pool = packagesForMood(family, MINED_TUNE_PACKAGES, PHRASE_LIBRARY[family]);
  const pkg = pickTunePackage(pool, prev?.packageId);
  const fromMinedPackage = pkg.source === "mined";
  const structureId = structureForPackage(pkg, prev?.structureId, STRUCTURE_IDS);
  const harmonicRoles = harmonicRolesForProgression(progressionSteps);
  const slots = slotsForHarmonicRoles(harmonicRoles, structureId) as MelodySlot[];
  const preserveVel = fromMinedPackage;

  const pickTpl = (id: PhraseId): PhraseTemplate => {
    const tpl = pkg.phrases[id];
    if (!fromMinedPackage && melody) {
      return grammarTemplate(tpl, id, family, melody);
    }
    return tpl;
  };

  const templates: Record<PhraseId, PhraseTemplate> = {
    A: pickTpl("A"),
    B: pickTpl("B"),
    answer: pickTpl("answer"),
    tag: pickTpl("tag"),
  };

  const phrases = {} as Record<PhraseId, MotifNote[]>;
  for (const id of ["A", "B", "answer", "tag"] as PhraseId[]) {
    const chord = progression[0];
    if (chord) {
      phrases[id] = fitPhraseToChord(templates[id], chord, scale, {
        anchorOffset: PHRASE_ANCHOR_OFFSET[id] ?? 0,
        preserveVel,
      }) as MotifNote[];
    } else {
      phrases[id] = fitPhrase(templates[id], randInt(2, Math.max(2, scaleLen - 3)), scaleLen, preserveVel);
    }
  }

  const variantIdx = Math.max(0, pool.findIndex((p) => p.id === pkg.id));

  const plan: MelodyPlan = {
    structureId,
    packageId: pkg.id,
    fromMinedPackage,
    variantIdx,
    phrases,
    slots,
    chordPhrases: [],
    harmonicRoles,
    harmonicBound: false,
    roundCycle: makeRoundCycle(),
    answerShift: pick([-2, -1, 1, 1, 2]),
  };

  return bindMelodyToProgression(plan, progression, scale);
}

/** Re-bind per-chord phrases after mutation or when progression is finalized. */
export function bindMelodyToProgression(
  plan: MelodyPlan,
  progression: readonly { rootMidi: number; thirdIv: number; notes: readonly string[] }[],
  scale: readonly string[],
): MelodyPlan {
  const chordPhrases = plan.slots.map((slot, chordIdx) => {
    const chord = progression[chordIdx];
    if (!chord) return plan.phrases[slot.phraseId];
    const offset = PHRASE_ANCHOR_OFFSET[slot.phraseId] ?? 0;
    return fitMotifToChord(plan.phrases[slot.phraseId], chord, scale, offset) as MotifNote[];
  });

  return {
    ...plan,
    chordPhrases,
    harmonicBound: true,
  };
}

/** Scene-level phrase mutations driven by MelodyDNA. */
export function applyMelodyMutations(
  plan: MelodyPlan,
  dna: MelodyDNA,
  scaleLen: number,
): MelodyPlan {
  if (dna.mutationStrength < 0.05) return plan;

  const strength = plan.fromMinedPackage ? dna.mutationStrength * 0.2 : dna.mutationStrength;
  if (strength < 0.05) return plan;

  const mutateNote = (n: MotifNote): MotifNote => {
    let { scaleIdx, step, beats, vel } = n;
    if (dna.stepJitter > 0 && chance(strength * 0.4)) {
      step = Math.max(0, Math.min(30, step + randInt(-dna.stepJitter, dna.stepJitter)));
    }
    if (chance(strength * 0.35)) {
      beats *= dna.stretchBias * rand(0.92, 1.08);
    }
    if (!plan.fromMinedPackage && chance(strength * 0.25)) {
      vel *= rand(0.9, 1.1);
    }
    if (chance(dna.octaveChance * strength)) {
      scaleIdx = Math.max(0, Math.min(scaleLen - 1, scaleIdx + pick([-2, 2])));
    }
    return { ...n, scaleIdx, step, beats, vel };
  };

  const enrichPhrase = (notes: MotifNote[]): MotifNote[] => {
    const out: MotifNote[] = [];
    for (const n of notes.map(mutateNote)) {
      if (n.accent && chance(dna.ornamentBias * strength * 0.5)) {
        out.push({
          scaleIdx: Math.max(0, n.scaleIdx - 1),
          step: Math.max(0, n.step - 1),
          beats: 0.2,
          vel: n.vel * 0.4,
          pickup: true,
        });
      }
      out.push(n);
    }
    return out;
  };

  const variationPool: MotifVariation[] = ["lift", "displaced", "ornament", "answer"];
  const swapVariation = (v: MotifVariation): MotifVariation => {
    if (!chance(strength * 0.3) || v === "plain" || v === "fragment") return v;
    return pick(variationPool);
  };

  return {
    ...plan,
    phrases: plan.fromMinedPackage
      ? plan.phrases
      : {
          A: enrichPhrase(plan.phrases.A),
          B: enrichPhrase(plan.phrases.B),
          answer: enrichPhrase(plan.phrases.answer),
          tag: enrichPhrase(plan.phrases.tag),
        },
    slots: plan.slots.map((s) => ({
      ...s,
      presence: plan.fromMinedPackage
        ? Math.max(s.presence, s.phraseId === "A" ? 0.95 : s.presence)
        : s.presence * rand(0.94, 1.04),
      variation: plan.fromMinedPackage ? s.variation : swapVariation(s.variation),
    })),
    roundCycle: plan.fromMinedPackage
      ? plan.roundCycle
      : plan.roundCycle.map((v, i) =>
          i === 0 ? v : chance(strength * 0.35) ? pick(variationPool) : v,
        ),
    harmonicBound: plan.harmonicBound,
    chordPhrases: plan.chordPhrases,
    harmonicRoles: plan.harmonicRoles,
  };
}

/** Apply a named variation to a stored phrase. */
export function varyPhrase(
  notes: MotifNote[],
  variation: MotifVariation,
  answerShift: number,
  melody?: MelodyDNA,
): MotifNote[] {
  const ornamentP = 0.65 * (melody?.ornamentBias ?? 1);
  const fragmentRatio = melody?.fragmentRatio ?? 0.55;
  const displacement = melody?.displacement ?? 2;
  const octaveChance = melody?.octaveChance ?? 0;

  switch (variation) {
    case "plain":
      return notes;
    case "answer":
      return notes.map((n) => ({ ...n, scaleIdx: n.scaleIdx + answerShift }));
    case "lift":
      return notes.map((n) => {
        let idx = n.scaleIdx + 2;
        if (melody && chance(octaveChance * melody.mutationStrength)) idx += pick([-2, 2]);
        return { ...n, scaleIdx: idx, vel: n.vel * 0.9 };
      });
    case "displaced":
      return notes.map((n) => ({
        ...n,
        step: Math.min(30, n.step + displacement + (melody ? randInt(0, 1) : 0)),
      }));
    case "ornament": {
      const out: MotifNote[] = [];
      for (const n of notes) {
        if (n.beats >= 1 && n.step >= 2 && chance(ornamentP)) {
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
        .slice(0, Math.max(2, Math.ceil(notes.length * fragmentRatio)))
        .map((n) => ({ ...n, vel: n.vel * 0.82 }));
  }
}
