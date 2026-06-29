// Scene-aware sample library — piano multisamples only; everything else is synth.

import type { Band, BassVoice, ChordVoice, MelodyVoice } from "./bands";
import type { DrumHitKind } from "./drum-types";
import { createLazySampleInstrument, type LazySampleInstrument } from "./sample-instrument";
import { createSampleLoader, type SampleLoader } from "./sample-loader";
import { SAMPLE_PACKS } from "./instruments/catalog";
import type { SamplePackCatalog } from "./sample-types";
import type { Scene } from "./scenes";
import type { PerformanceHints } from "./performance";

/** Only the felt piano stays sampled — all other voices use Web Audio synth. */
export const SAMPLED_VOICES = new Set<string>(["piano"]);

/** Voice id → sample pack folder under public/samples. */
export const VOICE_SAMPLE_PACK: Partial<Record<string, string>> = {
  piano: "piano",
};

/** Per-voice level trim for the sampled piano. */
export const VOICE_SAMPLE_GAIN: Partial<Record<string, number>> = {
  piano: 0.94,
};

export interface DrumPlayOpts {
  reverb?: AudioNode;
}

export interface SampleLibrary {
  play(
    voiceId: string,
    note: string,
    time: number,
    dur: number,
    vel: number,
    out: AudioNode,
    hints?: PerformanceHints,
  ): boolean;
  playDrum(
    kind: DrumHitKind,
    time: number,
    vel: number,
    out: AudioNode,
    opts?: DrumPlayOpts,
  ): boolean;
  warmForScene(scene: Scene, priority?: "high" | "idle"): void;
}

function collectSceneNotes(scene: Scene): string[] {
  const notes = new Set<string>(scene.scale);
  for (const chord of scene.progression) {
    for (const n of chord.notes) notes.add(n);
    notes.add(chord.root);
  }
  return [...notes];
}

function bandVoices(band: Band): string[] {
  const v: string[] = [band.chordVoice, band.melodyVoice];
  if (band.bassVoice !== "none") v.push(band.bassVoice);
  if (band.harmonyVoice) v.push(band.harmonyVoice);
  return v;
}

export function createSampleLibrary(ctx: AudioContext): SampleLibrary {
  const loader: SampleLoader = createSampleLoader(ctx);
  const instruments = new Map<string, LazySampleInstrument>();

  function getInstrument(packId: string): LazySampleInstrument | null {
    const existing = instruments.get(packId);
    if (existing) return existing;
    const pack: SamplePackCatalog | undefined = SAMPLE_PACKS[packId];
    if (!pack) return null;
    const inst = createLazySampleInstrument(ctx, pack, loader);
    instruments.set(packId, inst);
    return inst;
  }

  function warmVoice(voiceId: string, notes: string[], priority: "high" | "idle") {
    if (!SAMPLED_VOICES.has(voiceId)) return;
    const packId = VOICE_SAMPLE_PACK[voiceId];
    if (!packId) return;
    getInstrument(packId)?.warmNotes(notes, priority);
  }

  return {
    play(voiceId, note, time, dur, vel, out, hints) {
      if (!SAMPLED_VOICES.has(voiceId)) return false;
      const packId = VOICE_SAMPLE_PACK[voiceId];
      if (!packId) return false;
      const inst = getInstrument(packId);
      if (!inst) return false;
      return inst.play(note, time, dur, vel, {
        out,
        gain: VOICE_SAMPLE_GAIN[voiceId] ?? 0.8,
        humanize: true,
        hints,
      });
    },

    playDrum() {
      // Synth drums only — acoustic one-shots break the generated vibe.
      return false;
    },

    warmForScene(scene, priority = "high") {
      const notes = collectSceneNotes(scene);
      for (const voiceId of bandVoices(scene.band)) {
        warmVoice(voiceId, notes, priority);
      }
    },
  };
}

export type SampleVoice = ChordVoice | MelodyVoice | BassVoice;
