// Soothing pad voicings — root, third, fifth only; no stacked extensions.

import { midiFromNote, noteFromMidi } from "./notes";
import type { Chord } from "./scenes";

/** Close triad tones for a warm pad — avoids 7ths/9ths that clash and feel cinematic. */
export function soothingPadNotes(chord: Chord): string[] {
  const root = chord.root;
  const fifth = noteFromMidi(chord.rootMidi + 7);
  const thirdIv = chord.thirdIv;

  let third = chord.notes.find((n) => {
    const iv = (midiFromNote(n) - chord.rootMidi + 12) % 12;
    return iv === thirdIv;
  });
  if (!third) {
    third = noteFromMidi(chord.rootMidi + thirdIv);
  }

  return [root, third, fifth];
}
