// Tune packages — complete song genotypes mined from one source tune.
// A scene picks one package so A/B/answer/tag stay from the same melody.

import type { MoodKey } from "./moods";
import type { PhraseId, PhraseTemplate, StructureId } from "./melodies";

export type TunePackageSource = "mined" | "library";

export interface TunePackage {
  id: string;
  mood: MoodKey;
  source: TunePackageSource;
  phrases: Record<PhraseId, PhraseTemplate>;
  structureHint?: StructureId;
  /** Optional bass contour mined from the lowest MIDI track. */
  bassPhrase?: PhraseTemplate;
  /** Mining quality 0–1 — higher = stepwise, complete, lofi-sized. */
  score?: number;
}

export function relSignature(tpl: PhraseTemplate): string {
  return tpl.cells.map((c) => c.rel).join(",");
}

/** Normalized contour similarity on diatonic `rel` steps. */
export function phraseSimilarity(a: PhraseTemplate, b: PhraseTemplate): number {
  const ra = a.cells.map((c) => c.rel);
  const rb = b.cells.map((c) => c.rel);
  const minLen = Math.min(ra.length, rb.length);
  if (minLen === 0) return 0;
  let match = 0;
  for (let i = 0; i < minLen; i++) {
    if (ra[i] === rb[i]) match++;
  }
  return match / minLen;
}

/** Lofi-friendly phrase score — stepwise motion, sparse cell count. */
export function scorePhrase(tpl: PhraseTemplate): number {
  const cells = tpl.cells;
  if (cells.length < 2) return 0.2;
  let stepwise = 0;
  for (let i = 1; i < cells.length; i++) {
    if (Math.abs(cells[i].rel - cells[i - 1].rel) <= 2) stepwise++;
  }
  const stepRatio = stepwise / Math.max(1, cells.length - 1);
  const sizeScore = cells.length >= 3 && cells.length <= 8 ? 1 : 0.6;
  return stepRatio * 0.55 + sizeScore * 0.45;
}

export function scorePackage(phrases: Record<PhraseId, PhraseTemplate>): number {
  const ids: PhraseId[] = ["A", "B", "answer", "tag"];
  const avg = ids.reduce((s, id) => s + scorePhrase(phrases[id]), 0) / ids.length;
  const distinct =
    phraseSimilarity(phrases.A, phrases.B) < 0.75
    && phraseSimilarity(phrases.A, phrases.answer) < 0.9
      ? 1
      : 0.7;
  return Math.round(avg * distinct * 1000) / 1000;
}

function inferStructure(
  phrases: Record<PhraseId, PhraseTemplate>,
  repeatA: boolean,
): StructureId {
  if (repeatA) return "aaba";
  if (phraseSimilarity(phrases.A, phrases.answer) >= 0.5) return "call-response";
  if (phrases.tag.cells.length <= 3) return "hook-develop";
  return "through-song";
}

/**
 * Label segmented phrases into A/B/answer/tag from one tune.
 * Returns null when the tune is too fragmented for a complete package.
 */
export function labelTuneSections(segments: PhraseTemplate[]): {
  phrases: Record<PhraseId, PhraseTemplate>;
  structureHint: StructureId;
  score: number;
} | null {
  if (segments.length < 3) return null;

  const ordered = [...segments];
  let tagIdx = ordered.reduce(
    (best, tpl, i) => (tpl.cells.length < ordered[best].cells.length ? i : best),
    0,
  );
  if (ordered[tagIdx].cells.length > 4) tagIdx = ordered.length - 1;

  const tag = ordered[tagIdx];
  const body = ordered.filter((_, i) => i !== tagIdx);
  if (body.length < 2) return null;

  const a = body[0];
  let repeatA = false;
  for (let i = 1; i < body.length; i++) {
    if (phraseSimilarity(a, body[i]) >= 0.85) {
      repeatA = true;
      break;
    }
  }

  let b = body[1] ?? a;
  for (let i = 1; i < body.length; i++) {
    if (phraseSimilarity(a, body[i]) < 0.55) {
      b = body[i];
      break;
    }
  }

  const answer = body.length >= 2 ? body[body.length - 1] : a;
  const phrases: Record<PhraseId, PhraseTemplate> = { A: a, B: b, answer, tag };
  const structureHint = inferStructure(phrases, repeatA);
  const score = scorePackage(phrases);
  if (score < 0.35) return null;

  return { phrases, structureHint, score };
}

/** Fold wide diatonic leaps into one octave for scale clamping. */
export function foldPhraseTemplate(tpl: PhraseTemplate): PhraseTemplate {
  const foldRel = (rel: number): number => {
    while (rel > 7) rel -= 7;
    while (rel < -7) rel += 7;
    return rel;
  };
  return { cells: tpl.cells.map((c) => ({ ...c, rel: foldRel(c.rel) })) };
}

export function cleanTunePackage(pkg: TunePackage): TunePackage {
  const phrases = {} as Record<PhraseId, PhraseTemplate>;
  for (const id of ["A", "B", "answer", "tag"] as PhraseId[]) {
    phrases[id] = foldPhraseTemplate(pkg.phrases[id]);
  }
  const bassPhrase = pkg.bassPhrase ? foldPhraseTemplate(pkg.bassPhrase) : undefined;
  return { ...pkg, phrases, bassPhrase, score: scorePackage(phrases) };
}
