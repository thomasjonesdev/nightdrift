// Lazy drum sampler — pool round-robin, kit-aware routing, minimal warm footprint.

import type { KitId } from "./bands";
import {
  poolsForHit,
  poolsNeededForKit,
} from "./drum-mapping";
import { DRUM_PACKS } from "./instruments/drum-catalog";
import { sampleFileUrl, type SampleLoader } from "./sample-loader";
import type { DrumHitKind, DrumPackCatalog, DrumPool } from "./drum-types";

const WARM_HEAD = 4;

export interface DrumPlayOptions {
  reverb?: AudioNode;
  /** Hat / pulse accent — picks the open pool when true. */
  accent?: boolean;
}

export interface DrumSampler {
  setKit(kitId: KitId): void;
  warm(priority?: "high" | "idle"): void;
  play(
    kind: DrumHitKind,
    time: number,
    vel: number,
    out: AudioNode,
    options?: DrumPlayOptions,
  ): boolean;
}

export function createDrumSampler(
  ctx: AudioContext,
  loader: SampleLoader,
): DrumSampler {
  let kitId: KitId = "boomBap";
  const rrCounters = new Map<string, number>();

  function findPool(pack: DrumPackCatalog, poolId: string): DrumPool | undefined {
    return pack.pools.find((p) => p.id === poolId);
  }

  function pickFile(pack: DrumPackCatalog, pool: DrumPool): string | null {
    if (pool.files.length === 0) return null;
    const key = `${pack.id}:${pool.id}`;
    const idx = rrCounters.get(key) ?? 0;
    rrCounters.set(key, (idx + 1) % pool.files.length);
    return pool.files[idx];
  }

  function pickPool(pack: DrumPackCatalog, poolIds: string[]): DrumPool | null {
    if (poolIds.length === 0) return null;
    if (poolIds.length === 1) {
      return findPool(pack, poolIds[0]) ?? null;
    }
    const key = `${pack.id}:alt:${poolIds.join("|")}`;
    const idx = rrCounters.get(key) ?? 0;
    rrCounters.set(key, (idx + 1) % poolIds.length);
    const pool = findPool(pack, poolIds[idx]);
    return pool ?? null;
  }

  function playBuffer(
    buffer: AudioBuffer,
    time: number,
    vel: number,
    out: AudioNode,
    options?: DrumPlayOptions,
    kind?: DrumHitKind,
  ) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Layback varies by role — ghost notes early, backbeat slightly late.
    const layback =
      kind === "snareGhost" || kind === "brush" ? -0.008 + Math.random() * 0.004
      : kind === "kick" ? 0.002 + Math.random() * 0.006
      : (Math.random() - 0.5) * 0.012;
    const startAt = time + layback;
    src.detune.value = (Math.random() - 0.5) * 14;

    const g = ctx.createGain();
    const peak = vel * (0.94 + Math.random() * 0.1);
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.linearRampToValueAtTime(peak, startAt + 0.0015);

    src.connect(g).connect(out);
    if (options?.reverb) {
      const send = ctx.createGain();
      send.gain.value = 0.32;
      g.connect(send).connect(options.reverb);
    }

    src.start(startAt);
    src.stop(startAt + buffer.duration + 0.01);
  }

  function tryPlay(
    kind: DrumHitKind,
    time: number,
    vel: number,
    out: AudioNode,
    options?: DrumPlayOptions,
  ): boolean {
    const { pack: packId, poolIds, gain } = poolsForHit(kitId, kind);
    const pack = DRUM_PACKS[packId];
    if (!pack) return false;

    const pool = pickPool(pack, poolIds);
    if (!pool) return false;

    const file = pickFile(pack, pool);
    if (!file) return false;

    const url = sampleFileUrl(pack.basePath, file);
    const buffer = loader.get(url);
    if (!buffer) {
      loader.prefetch([url], "high");
      return false;
    }

    playBuffer(buffer, time, vel * gain, out, options, kind);
    return true;
  }

  function warmPool(pack: DrumPackCatalog, pool: DrumPool, priority: "high" | "idle") {
    const head = pool.files.slice(0, WARM_HEAD).map((f) => sampleFileUrl(pack.basePath, f));
    const tail = pool.files.slice(WARM_HEAD).map((f) => sampleFileUrl(pack.basePath, f));
    loader.prefetch(head, priority === "high" ? "high" : "high");
    if (tail.length > 0) loader.prefetch(tail, "idle");
  }

  return {
    setKit(id: KitId) {
      kitId = id;
    },

    warm(priority = "high") {
      for (const { pack: packId, poolId } of poolsNeededForKit(kitId)) {
        const pack = DRUM_PACKS[packId];
        if (!pack) continue;
        const pool = findPool(pack, poolId);
        if (pool) warmPool(pack, pool, priority);
      }
    },

    play(kind, time, vel, out, options) {
      return tryPlay(kind, time, vel, out, options);
    },
  };
}

/** Resolve engine backbeat step to drum hit kind. */
export { hitKindForBackbeat, hitKindForPulse } from "./drum-mapping";
