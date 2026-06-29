// Melody contour generator — procedural phrase shapes blended with
// the stored library and mined phrases.

import type { MoodKey } from "./moods";
import { chance, pick, rand, randInt } from "./random";
import type { MelodyDNA } from "./drift-algorithm";
import type { PhraseCell, PhraseId, PhraseTemplate } from "./melodies";

export type ContourClass = "arch" | "question" | "answer" | "tag" | "sigh";

const PHRASE_CONTOURS: Record<PhraseId, ContourClass[]> = {
  A: ["arch", "question", "arch"],
  B: ["arch", "sigh", "question"],
  answer: ["answer", "sigh"],
  tag: ["tag", "sigh"],
};

function vel(base: number, family: MoodKey): number {
  if (family === "rainy") return base * 0.78;
  if (family === "jazzy") return base * 1.06;
  return base;
}

function generateArch(family: MoodKey): PhraseTemplate {
  return {
    cells: [
      { rel: 0, step: 1, beats: 0.35, vel: vel(0.055, family), pickup: true },
      { rel: 1, step: 4, beats: 0.75, vel: vel(0.07, family) },
      { rel: 2, step: 8, beats: 1, vel: vel(0.085, family), accent: true },
      { rel: 1, step: 13, beats: 1, vel: vel(0.072, family) },
      { rel: 0, step: 20, beats: 1.75, vel: vel(0.065, family) },
    ],
  };
}

function generateQuestion(family: MoodKey): PhraseTemplate {
  return {
    cells: [
      { rel: 0, step: 2, beats: 0.5, vel: vel(0.06, family) },
      { rel: 1, step: 6, beats: 0.85, vel: vel(0.075, family) },
      { rel: 2, step: 10, beats: 1.1, vel: vel(0.08, family), accent: true },
      { rel: 3, step: 14, beats: 0.6, vel: vel(0.065, family) },
    ],
  };
}

function generateAnswer(family: MoodKey): PhraseTemplate {
  return {
    cells: [
      { rel: -1, step: 2, beats: 0.55, vel: vel(0.062, family) },
      { rel: 0, step: 7, beats: 1.1, vel: vel(0.078, family) },
      { rel: -1, step: 12, beats: 1.4, vel: vel(0.085, family), accent: true },
      { rel: 0, step: 18, beats: 1.5, vel: vel(0.07, family) },
    ],
  };
}

function generateTag(family: MoodKey): PhraseTemplate {
  return {
    cells: [
      { rel: 1, step: 6, beats: 0.7, vel: vel(0.06, family) },
      { rel: 0, step: 12, beats: 1.25, vel: vel(0.075, family), accent: true },
      { rel: -1, step: 18, beats: 1.5, vel: vel(0.068, family) },
    ],
  };
}

function generateSigh(family: MoodKey): PhraseTemplate {
  return {
    cells: [
      { rel: 1, step: 3, beats: 0.45, vel: vel(0.058, family) },
      { rel: 0, step: 8, beats: 1.25, vel: vel(0.072, family) },
      { rel: -2, step: 16, beats: 2, vel: vel(0.08, family), accent: true },
    ],
  };
}

/** Build a phrase template from a contour class. */
export function generateContour(contour: ContourClass, family: MoodKey): PhraseTemplate {
  switch (contour) {
    case "arch":
      return generateArch(family);
    case "question":
      return generateQuestion(family);
    case "answer":
      return generateAnswer(family);
    case "tag":
      return generateTag(family);
    case "sigh":
      return generateSigh(family);
  }
}

/** Pick a contour for a phrase role in this mood family. */
export function pickContour(phraseId: PhraseId, family: MoodKey): ContourClass {
  const pool = PHRASE_CONTOURS[phraseId];
  return pick(family === "jazzy" ? pool : pool);
}

/** Merge library and generated cells — bias toward generated above 0.5. */
export function blendTemplates(
  library: PhraseTemplate,
  generated: PhraseTemplate,
  blend: number,
): PhraseTemplate {
  if (blend <= 0.05) return library;
  if (blend >= 0.95) return generated;
  const len = Math.max(library.cells.length, generated.cells.length);
  const cells: PhraseCell[] = [];
  for (let i = 0; i < len; i++) {
    const fromGen = generated.cells[i];
    const fromLib = library.cells[i];
    if (!fromGen) {
      if (fromLib) cells.push(fromLib);
      continue;
    }
    if (!fromLib) {
      cells.push(fromGen);
      continue;
    }
    if (chance(blend)) {
      cells.push({
        ...fromGen,
        step: fromGen.step + randInt(-1, 1),
        vel: fromGen.vel * rand(0.94, 1.06),
      });
    } else {
      cells.push(fromLib);
    }
  }
  return { cells };
}

/** Apply grammar blend to a library template for one phrase slot. */
export function grammarTemplate(
  library: PhraseTemplate,
  phraseId: PhraseId,
  family: MoodKey,
  melody: MelodyDNA,
): PhraseTemplate {
  const contour = pickContour(phraseId, family);
  const generated = generateContour(contour, family);
  return blendTemplates(library, generated, melody.contourBlend);
}
