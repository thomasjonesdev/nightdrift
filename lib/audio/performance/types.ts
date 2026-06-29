// Performance shaping — makes scheduled notes behave like a human player.

export type PerformanceRole = "chord" | "melody" | "bass" | "harmony" | "ambient";

export interface NoteEvent {
  note: string;
  time: number;
  dur: number;
  vel: number;
}

/** Envelope + articulation hints applied at playback time. */
export interface PerformanceHints {
  attackSec?: number;
  releaseSec?: number;
  /** Softer rearticulation while a prior note still rings. */
  legato?: boolean;
  /** Let samples/synth ring to natural decay instead of hard-cutting at dur. */
  naturalDecay?: boolean;
  detuneCents?: number;
  /** Drop this event entirely (e.g. duplicate organ reattack). */
  skip?: boolean;
}

export interface ShapedNote extends NoteEvent {
  hints: PerformanceHints;
}

export interface PerformanceContext {
  role: PerformanceRole;
}

export interface VoicePerformanceState {
  /** Per-voice last-note tracking (keyed by voice id). */
  voices: Map<string, VoiceLineState>;
}

export interface VoiceLineState {
  lastNote?: string;
  lastStart?: number;
  lastEnd?: number;
  /** Finger/hand alternation for bass and plucked strings. */
  hand?: 0 | 1;
  /** Simulated sustain pedal for piano. */
  pedalNotes?: Set<string>;
}
