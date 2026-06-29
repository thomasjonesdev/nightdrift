// Cohesive melody fills — extend the hook instead of random scale walks.

import type { MelodyBehavior } from "./bands";
import type { MelodyPlan, MotifNote, PhraseId } from "./melodies";

export interface PhraseLedger {
  lastScaleIdx: number;
  lastPhraseId: PhraseId | null;
  /** Latest 16th step where the primary line sounded on this chord. */
  phraseEndStep: number;
  lastVel: number;
}

export type FillKind = "pickup" | "antiphonal";

export interface CohesiveFillHit {
  scaleIdx: number;
  beats: number;
  vel: number;
  kind: FillKind;
}

export function createPhraseLedger(anchorScaleIdx: number): PhraseLedger {
  return {
    lastScaleIdx: anchorScaleIdx,
    lastPhraseId: null,
    phraseEndStep: -1,
    lastVel: 0.07,
  };
}

export function updatePhraseLedger(
  ledger: PhraseLedger,
  note: { scaleIdx: number; step: number; vel: number },
  phraseId: PhraseId,
): PhraseLedger {
  return {
    lastScaleIdx: note.scaleIdx,
    lastPhraseId: phraseId,
    phraseEndStep: Math.max(ledger.phraseEndStep, note.step),
    lastVel: note.vel,
  };
}

/** 16th steps occupied by phrase notes (rest-aware gap detection). */
export function occupiedSteps(notes: readonly MotifNote[], maxStep = 31): Set<number> {
  const occupied = new Set<number>();
  for (const n of notes) {
    const span = Math.max(1, Math.ceil(n.beats * 4));
    for (let s = n.step; s < n.step + span && s <= maxStep; s++) {
      occupied.add(s);
    }
  }
  return occupied;
}

export function isRestStep(notes: readonly MotifNote[], step: number): boolean {
  return !occupiedSteps(notes).has(step);
}

export function shouldAttemptFill(
  behavior: MelodyBehavior,
  chordIdx: number,
  step: number,
  energy: number,
  fillDensity: number,
  chance: (p: number) => boolean,
): boolean {
  if (behavior === "held") return false;

  const baseChance =
    behavior === "sparse" ? 0.32
    : behavior === "motif" ? 0.22
    : behavior === "arp" ? 0.18
    : 0.12;
  const gapBias =
    behavior === "sparse" || chordIdx % 2 === 1 ? 1.0 : 0.85;

  return (
    step % 2 === 0
    && step !== 0
    && step <= 28
    && chance(baseChance * energy * fillDensity * gapBias)
  );
}

function clampScaleIdx(idx: number, scaleLen: number): number {
  return Math.max(0, Math.min(scaleLen - 1, idx));
}

function pickupFills(
  plan: MelodyPlan,
  ledger: PhraseLedger,
  scaleLen: number,
): CohesiveFillHit[] {
  const tag = plan.phrases.tag;
  if (tag.length === 0) return [];

  const tail = tag.slice(-2);
  const ref = tail[0];
  const cell = tail[tail.length - 1];
  const scaleIdx = clampScaleIdx(ledger.lastScaleIdx + (cell.scaleIdx - ref.scaleIdx), scaleLen);

  return [{
    scaleIdx,
    beats: Math.min(1.3, cell.beats * 0.75),
    vel: cell.vel * 0.72,
    kind: "pickup",
  }];
}

function antiphonalFill(
  plan: MelodyPlan,
  ledger: PhraseLedger,
  scaleLen: number,
  pick: <T>(arr: readonly T[]) => T,
): CohesiveFillHit | null {
  const hook = plan.phrases.A;
  if (hook.length < 2) return null;

  const fragLen = Math.max(2, Math.ceil(hook.length * 0.45));
  const fragment = hook.slice(0, fragLen);
  const echo = pick(fragment);
  const scaleIdx = clampScaleIdx(
    Math.round(ledger.lastScaleIdx * 0.35 + echo.scaleIdx * 0.65),
    scaleLen,
  );

  return {
    scaleIdx,
    beats: echo.beats * 0.7,
    vel: echo.vel * 0.52,
    kind: "antiphonal",
  };
}

export interface PlanCohesiveFillOpts {
  ledger: PhraseLedger;
  plan: MelodyPlan;
  chordPhrase: readonly MotifNote[];
  step: number;
  scaleLen: number;
  counterMelodyFired: boolean;
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
}

/**
 * Plan hook-derived fill material for a rest gap — pickup tail or antiphonal echo.
 * Returns empty when the counter-voice already commented on this chord.
 */
export function planCohesiveFill(opts: PlanCohesiveFillOpts): CohesiveFillHit[] {
  const { ledger, plan, chordPhrase, step, scaleLen, counterMelodyFired, pick, chance } = opts;

  if (counterMelodyFired) return [];
  if (!isRestStep(chordPhrase, step)) return [];

  const usePickup = chance(0.55);
  if (usePickup) {
    const hits = pickupFills(plan, ledger, scaleLen);
    if (hits.length > 0 && chance(0.35) && plan.phrases.tag.length >= 2) {
      const tail = plan.phrases.tag.slice(-2);
      if (tail.length > 1) {
        const second = tail[1];
        const first = tail[0];
        hits.push({
          scaleIdx: clampScaleIdx(
            hits[0].scaleIdx + (second.scaleIdx - first.scaleIdx),
            scaleLen,
          ),
          beats: Math.min(1.3, second.beats * 0.85),
          vel: second.vel * 0.58,
          kind: "pickup",
        });
      }
    }
    return hits;
  }

  const antiphonal = antiphonalFill(plan, ledger, scaleLen, pick);
  return antiphonal ? [antiphonal] : pickupFills(plan, ledger, scaleLen);
}
