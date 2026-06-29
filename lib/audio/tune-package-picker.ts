// Runtime tune-package selection for assembleMelodyPlan().

import type { MoodKey } from "./moods";
import { pick, randInt } from "./random";
import type { PhraseId, PhraseTemplate, StructureId } from "./melodies";
import type { TunePackage } from "./tune-packages";

/** Build hand-authored packages — same index across phrase slots. */
export function handAuthoredPackages(
  family: MoodKey,
  library: Record<PhraseId, PhraseTemplate[]>,
): TunePackage[] {
  const count = Math.max(...(["A", "B", "answer", "tag"] as PhraseId[]).map((id) => library[id].length));
  if (count === 0) return [];

  const packages: TunePackage[] = [];
  for (let i = 0; i < count; i++) {
    packages.push({
      id: `hand-${family}-${i}`,
      mood: family,
      source: "library",
      phrases: {
        A: library.A[i % library.A.length],
        B: library.B[i % library.B.length],
        answer: library.answer[i % library.answer.length],
        tag: library.tag[i % library.tag.length],
      },
      structureHint: i % 2 === 0 ? "aaba" : "call-response",
    });
  }
  return packages;
}

export function packagesForMood(
  family: MoodKey,
  mined: readonly TunePackage[],
  handLibrary: Record<PhraseId, PhraseTemplate[]>,
): TunePackage[] {
  const fromMined = mined.filter((p) => p.mood === family);
  if (fromMined.length > 0) return fromMined;
  return handAuthoredPackages(family, handLibrary);
}

export function pickTunePackage(
  pool: readonly TunePackage[],
  prevPackageId?: string,
): TunePackage {
  if (pool.length === 0) {
    throw new Error("pickTunePackage: empty pool");
  }
  if (!prevPackageId) return pick(pool);
  const idx = pool.findIndex((p) => p.id === prevPackageId);
  if (idx < 0) return pick(pool);
  return pool[(idx + 1 + randInt(0, Math.max(0, pool.length - 2))) % pool.length];
}

export function structureForPackage(
  pkg: TunePackage,
  prevStructureId: StructureId | undefined,
  allStructures: readonly StructureId[],
): StructureId {
  if (pkg.structureHint) return pkg.structureHint;
  if (!prevStructureId) return allStructures[0];
  const pool = allStructures.filter((id) => id !== prevStructureId);
  return pick(pool.length > 0 ? pool : allStructures);
}
