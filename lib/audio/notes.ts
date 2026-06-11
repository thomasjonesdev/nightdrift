// Equal-temperament pitch math, A4 = 440 Hz.

const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Absolute semitone index (MIDI-style, C-1 = 0) for a note like "F#3". */
function semis(note: string): number {
  const m = note.match(/^([A-G][#b]?)(-?\d)$/);
  if (!m) throw new Error(`Invalid note: ${note}`);
  return NOTE_INDEX[m[1]] + (parseInt(m[2], 10) + 1) * 12;
}

/** Frequency in Hz for a note name like "A4". */
export function freq(note: string): number {
  return 440 * Math.pow(2, (semis(note) - 69) / 12);
}

/** Transpose a note name by a number of semitones, e.g. up("C2", 7) → "G2". */
export function up(note: string, semitones: number): string {
  const abs = semis(note) + semitones;
  return NOTE_NAMES[abs % 12] + (Math.floor(abs / 12) - 1);
}

/** Note name for a MIDI number, e.g. 60 → "C4". */
export function noteFromMidi(midi: number): string {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

const DISPLAY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Display name for a pitch class, with flat spellings, e.g. 3 → "Eb". */
export function pitchClassName(pc: number): string {
  return DISPLAY_NAMES[((pc % 12) + 12) % 12];
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
