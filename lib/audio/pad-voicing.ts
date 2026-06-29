// Soothing pad voicings — hollow root+fifth wash only.

import { noteFromMidi } from "./notes";
import type { Chord } from "./scenes";

/** Root + fifth only — hollow wash with minimal harmonic motion. */
export function soothingPadNotes(chord: Chord): string[] {
  const root = chord.root;
  const fifth = noteFromMidi(chord.rootMidi + 7);
  return [root, fifth];
}
