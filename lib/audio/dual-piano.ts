// Complementary dual-piano voicing — comp stays low/soft, guest melody sits above.

import type { Band } from "./bands";
import { midiFromNote, noteFromMidi } from "./notes";

export type DualPianoLayout = "guest" | "duet";

export function dualPianoLayout(band: Band): DualPianoLayout | null {
  if (band.chordVoice !== "piano" || band.melodyVoice !== "piano") return null;
  return band.pianoDuet === "guest" ? "guest" : "duet";
}

/** Comping piano — thumb voice, one octave lower when needed. */
export function compPianoNote(note: string, layout: DualPianoLayout): string {
  const midi = midiFromNote(note);
  const dropAbove = layout === "guest" ? 46 : 50;
  if (midi > dropAbove) return noteFromMidi(midi - 12);
  return note;
}

/** Melody piano — singing voice, lifted into the upper register. */
export function melodyPianoNote(note: string, layout: DualPianoLayout): string {
  const midi = midiFromNote(note);
  const liftBelow = layout === "guest" ? 68 : 65;
  if (midi < liftBelow) return noteFromMidi(Math.min(midi + 12, 86));
  return note;
}

export function compPianoVelMul(layout: DualPianoLayout): number {
  return layout === "guest" ? 0.38 : 0.5;
}

export function melodyPianoVelMul(layout: DualPianoLayout): number {
  return layout === "guest" ? 1.12 : 1.05;
}

export function dualPianoPan(layout: DualPianoLayout): { chord: number; melody: number } {
  return layout === "guest"
    ? { chord: -0.24, melody: 0.3 }
    : { chord: -0.17, melody: 0.21 };
}

export const DEFAULT_CHORD_PAN = -0.13;
export const DEFAULT_MELODY_PAN = 0.17;
