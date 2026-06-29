// Lazy multisample player — loads zones on demand, never the whole pack at once.

import { sampleFileUrl, type SampleLoader } from "./sample-loader";
import { midiFromNote } from "./notes";
import { schedulePerformanceEnvelope, type PerformanceHints } from "./performance";
import type { SampleLayout, SamplePackCatalog, SampleZoneEntry } from "./sample-types";

export interface SamplePlayOptions {
  out: AudioNode;
  gain?: number;
  humanize?: boolean;
  hints?: PerformanceHints;
}

interface LoadedZone {
  rootMidi: number;
  files: Map<string, AudioBuffer>;
}

const VEL_LAYER = { L: 0.38, H: 0.72 };

function findZoneMeta(zones: SampleZoneEntry[], midi: number): SampleZoneEntry {
  let best = zones[0];
  let bestDist = Math.abs(midi - best.rootMidi);
  for (let i = 1; i < zones.length; i++) {
    const dist = Math.abs(midi - zones[i].rootMidi);
    if (dist < bestDist) {
      best = zones[i];
      bestDist = dist;
    }
  }
  return best;
}

function pickFiles(
  meta: SampleZoneEntry,
  layout: SampleLayout,
  vel: number,
  layerWeights?: Record<string, number>,
): Array<{ file: string; gain: number }> {
  switch (layout) {
    case "velocity-layers": {
      const w = layerWeights ?? VEL_LAYER;
      const lowFiles = meta.layers.L ?? [];
      const highFiles = meta.layers.H ?? [];
      if (lowFiles.length === 0 && highFiles.length === 0) return [];
      if (lowFiles.length === 0) {
        return pickRandom(highFiles).map((f) => ({ file: f, gain: 1 }));
      }
      if (highFiles.length === 0) {
        return pickRandom(lowFiles).map((f) => ({ file: f, gain: 1 }));
      }
      const low = w.L ?? 0.38;
      const high = w.H ?? 0.72;
      if (vel <= low) return pickRandom(lowFiles).map((f) => ({ file: f, gain: 1 }));
      if (vel >= high) return pickRandom(highFiles).map((f) => ({ file: f, gain: 1 }));
      const t = (vel - low) / (high - low);
      return [
        ...pickRandom(lowFiles).map((f) => ({ file: f, gain: 1 - t })),
        ...pickRandom(highFiles).map((f) => ({ file: f, gain: t })),
      ];
    }
    case "velocity-steps": {
      const steps = Object.keys(meta.layers)
        .map((k) => ({ k, w: layerWeights?.[k] ?? parseInt(k, 10) / 127 }))
        .sort((a, b) => a.w - b.w);
      if (steps.length === 0) return [];
      let lo = steps[0];
      let hi = steps[steps.length - 1];
      for (let i = 0; i < steps.length - 1; i++) {
        if (vel >= steps[i].w && vel <= steps[i + 1].w) {
          lo = steps[i];
          hi = steps[i + 1];
          break;
        }
      }
      if (vel <= lo.w) return pickRandom(meta.layers[lo.k]).map((f) => ({ file: f, gain: 1 }));
      if (vel >= hi.w) return pickRandom(meta.layers[hi.k]).map((f) => ({ file: f, gain: 1 }));
      const t = (vel - lo.w) / Math.max(0.001, hi.w - lo.w);
      return [
        ...pickRandom(meta.layers[lo.k]).map((f) => ({ file: f, gain: 1 - t })),
        ...pickRandom(meta.layers[hi.k]).map((f) => ({ file: f, gain: t })),
      ];
    }
    case "dynamic-layers": {
      const w = layerWeights ?? { f: 0.35, mf: 0.62 };
      const soft = meta.layers.f ?? meta.layers.mp ?? [];
      const loud = meta.layers.mf ?? meta.layers.ff ?? meta.layers.default ?? [];
      if (vel <= (w.f ?? 0.35)) return pickRandom(soft).map((f) => ({ file: f, gain: 1 }));
      if (vel >= (w.mf ?? 0.62)) return pickRandom(loud).map((f) => ({ file: f, gain: 1 }));
      const t = (vel - (w.f ?? 0.35)) / ((w.mf ?? 0.62) - (w.f ?? 0.35));
      return [
        ...pickRandom(soft).map((f) => ({ file: f, gain: 1 - t })),
        ...pickRandom(loud).map((f) => ({ file: f, gain: t })),
      ];
    }
    default: {
      const pool = meta.layers.default ?? Object.values(meta.layers).flat();
      return pickRandom(pool).map((f) => ({ file: f, gain: 1 }));
    }
  }
}

function pickRandom(files: string[] | undefined): string[] {
  if (!files || files.length === 0) return [];
  return [files[Math.floor(Math.random() * files.length)]];
}

export interface LazySampleInstrument {
  readonly packId: string;
  isZoneReady(rootMidi: number): boolean;
  warmNotes(notes: string[], priority: "high" | "idle"): void;
  play(note: string, time: number, dur: number, vel: number, options: SamplePlayOptions): boolean;
}

export function createLazySampleInstrument(
  ctx: AudioContext,
  pack: SamplePackCatalog,
  loader: SampleLoader,
): LazySampleInstrument {
  const loaded = new Map<number, LoadedZone>();
  const loadingZones = new Set<number>();

  function zoneUrls(meta: SampleZoneEntry): string[] {
    return Object.values(meta.layers)
      .flat()
      .map((f) => sampleFileUrl(pack.basePath, f));
  }

  function isZoneReady(rootMidi: number): boolean {
    return loaded.has(rootMidi);
  }

  function tryHydrateZone(meta: SampleZoneEntry): LoadedZone | null {
    const hit = loaded.get(meta.rootMidi);
    if (hit) return hit;

    const files = new Map<string, AudioBuffer>();
    for (const fileList of Object.values(meta.layers)) {
      for (const file of fileList) {
        const buf = loader.get(sampleFileUrl(pack.basePath, file));
        if (!buf) return null;
        files.set(file, buf);
      }
    }
    const z: LoadedZone = { rootMidi: meta.rootMidi, files };
    loaded.set(meta.rootMidi, z);
    return z;
  }

  function warmZone(meta: SampleZoneEntry, priority: "high" | "idle") {
    if (loaded.has(meta.rootMidi) || loadingZones.has(meta.rootMidi)) return;
    loadingZones.add(meta.rootMidi);
    loader.prefetch(zoneUrls(meta), priority);
    void Promise.all(zoneUrls(meta).map((u) => loader.load(u)))
      .then(() => {
        tryHydrateZone(meta);
      })
      .finally(() => {
        loadingZones.delete(meta.rootMidi);
      });
  }

  function playLayer(
    buffer: AudioBuffer,
    zoneMidi: number,
    targetMidi: number,
    time: number,
    dur: number,
    peakGain: number,
    humanize: boolean,
    out: AudioNode,
    hints: PerformanceHints = {},
  ) {
    if (peakGain < 0.0001) return;

    const rate = Math.pow(2, (targetMidi - zoneMidi) / 12);
    const naturalLen = buffer.duration / rate;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const detune = hints.detuneCents ?? (humanize ? (Math.random() - 0.5) * 8 : 0);
    src.detune.value = detune;

    const g = ctx.createGain();
    const peak = peakGain * (humanize && !hints.legato ? 0.94 + Math.random() * 0.12 : 1);
    const playLen = schedulePerformanceEnvelope(g, time, peak, dur, hints, naturalLen);

    src.connect(g).connect(out);
    src.start(time);
    src.stop(time + playLen + 0.05);
  }

  return {
    packId: pack.id,

    isZoneReady,

    warmNotes(notes, priority) {
      const seen = new Set<number>();
      for (const note of notes) {
        try {
          const meta = findZoneMeta(pack.zones, midiFromNote(note));
          if (seen.has(meta.rootMidi)) continue;
          seen.add(meta.rootMidi);
          warmZone(meta, priority);
        } catch {
          /* invalid note */
        }
      }
    },

    play(note, time, dur, vel, options) {
      let targetMidi: number;
      try {
        targetMidi = midiFromNote(note);
      } catch {
        return false;
      }

      const meta = findZoneMeta(pack.zones, targetMidi);
      const zone = tryHydrateZone(meta);
      if (!zone) {
        warmZone(meta, "high");
        return false;
      }

      const picks = pickFiles(meta, pack.layout, vel, pack.layerWeights);
      const trim = options.gain ?? 1;
      const humanize = options.humanize ?? true;
      const hints = options.hints ?? {};

      for (const pick of picks) {
        const buf = zone.files.get(pick.file);
        if (!buf) continue;
        playLayer(
          buf,
          meta.rootMidi,
          targetMidi,
          time,
          dur,
          vel * trim * pick.gain,
          humanize,
          options.out,
          hints,
        );
      }

      return picks.length > 0;
    },
  };
}
