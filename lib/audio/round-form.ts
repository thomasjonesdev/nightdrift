// Round form — deterministic verse → variation → return → outro arc.

import type { MotifVariation, PhraseId } from "./melodies";
import type { MelodySlot } from "./melodies";

export type RoundPhase = "intro" | "statement" | "development" | "outro";

export function roundPhase(round: number, totalRounds: number): RoundPhase {
  if (round === 0) return "intro";
  if (round >= totalRounds - 1) return "outro";
  if (round === 1) return "statement";
  return "development";
}

/** Deterministic variation per slot — replaces per-chord-0 roundCycle dice. */
export function variationForSlot(
  slot: MelodySlot,
  round: number,
  totalRounds: number,
  roundCycle: readonly MotifVariation[],
): MotifVariation {
  const phase = roundPhase(round, totalRounds);

  switch (phase) {
    case "intro":
      return "fragment";
    case "statement":
      return "plain";
    case "outro":
      return slot.phraseId === "tag" ? slot.variation : "fragment";
    case "development": {
      const devIdx = round - 2;
      const cycleVar = roundCycle[devIdx % Math.max(1, roundCycle.length)] ?? "plain";
      if (round === 2) {
        if (slot.phraseId === "B" || slot.phraseId === "answer") return cycleVar;
        if (slot.phraseId === "A") return "plain";
        return "fragment";
      }
      if (slot.phraseId === "tag") {
        return devIdx % 2 === 0 ? "fragment" : slot.variation;
      }
      return cycleVar;
    }
  }
}

/** Presence with hook floors — A slots stay stated in rounds 1–2. */
export function presenceForSlot(
  slot: MelodySlot,
  round: number,
  totalRounds: number,
  energy: number,
  melodyPresenceMod: number,
): number {
  const last = totalRounds - 1;
  let base = slot.presence;

  if (slot.phraseId === "A" && round >= 1 && round <= Math.min(2, last - 1)) {
    base = Math.max(base, 0.95);
  }

  if (round === last) {
    base = slot.phraseId === "tag" ? Math.max(base, 0.88) : base * 0.82;
  }

  const energyMul = round === last ? 0.88 : 0.94 + 0.06 * energy;
  return Math.min(1, base * melodyPresenceMod * energyMul);
}

/** Hook slots always play during statement/development — no dice-roll dropouts. */
export function shouldPlayMelodySlot(
  presence: number,
  phraseId: PhraseId,
  round: number,
  totalRounds: number,
  chance: (p: number) => boolean,
): boolean {
  const last = totalRounds - 1;
  if (round >= 1 && round < last && phraseId === "A") return true;
  if (presence >= 0.97) return true;
  return chance(presence);
}

export function bassThinMultiplier(round: number, totalRounds: number): number {
  if (round >= totalRounds - 1) return 0.5;
  if (round === 0) return 0.85;
  return 1;
}

export function bassSkipGhost(round: number, totalRounds: number): boolean {
  return round >= totalRounds - 1;
}
