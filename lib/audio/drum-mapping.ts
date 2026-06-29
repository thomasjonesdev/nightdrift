// Kit → drum pack routing. Keeps band kit grammars on synth/sample voices that fit the vibe.

import type { DrumHitKind, DrumPackId } from "./drum-types";
import { KITS, type DrumKit, type KitId } from "./bands";

/** Default pool ids per hit kind, per pack. */
export const DEFAULT_DRUM_POOLS: Record<DrumPackId, Partial<Record<DrumHitKind, string[]>>> = {
  "acoustic-drums": {
    kick: ["KdrumL", "KdrumR"],
    snare: ["Snare1"],
    snareGhost: ["SnareRest1"],
    rim: ["SnareRest1"],
    brush: ["SnareRest1"],
    brushLong: ["SnareRest2", "SnareRest1"],
    hat: ["HihatClosed"],
    hatOpen: ["HihatOpen"],
    shaker: ["HihatClosed"],
  },
};

export interface KitDrumConfig {
  pack: DrumPackId;
  /** Per-hit pool overrides — merges over DEFAULT_DRUM_POOLS. */
  pools?: Partial<Record<DrumHitKind, string[]>>;
  /** Per-hit gain trim (multiplies velocity). */
  gain?: Partial<Record<DrumHitKind, number>>;
}

/** Kit personality → which sample pack and pools to use. */
export const KIT_DRUM_CONFIG: Record<KitId, KitDrumConfig> = {
  boomBap: {
    pack: "acoustic-drums",
    gain: { kick: 1, snare: 1, hat: 0.85 },
  },
  slowMotion: {
    pack: "acoustic-drums",
    pools: { snare: ["Snare2"], kick: ["KdrumR", "KdrumL"] },
    gain: { kick: 1.08, snare: 0.95, hat: 0.7 },
  },
  bossa: {
    pack: "acoustic-drums",
    pools: {
      kick: ["KdrumL"],
      rim: ["SnareRest1"],
      shaker: ["RideR"],
    },
    gain: { kick: 0.75, rim: 0.8, shaker: 0.55 },
  },
  brushes: {
    pack: "acoustic-drums",
    pools: {
      kick: ["KdrumL"],
      brush: ["SnareRest1"],
      brushLong: ["SnareRest2", "SnareRest1"],
      hat: ["HihatClosed"],
    },
    gain: { kick: 0.65, brush: 0.7, brushLong: 0.75, hat: 0.5 },
  },
  heartbeat: {
    pack: "acoustic-drums",
    pools: { kick: ["KdrumL"], hat: ["HihatClosed"] },
    gain: { kick: 0.95, hat: 0.55 },
  },
  punchy: {
    pack: "acoustic-drums",
    pools: { kick: ["KdrumR"], snare: ["Snare1"] },
    gain: { kick: 1.28, snare: 1.22 },
  },
  muted: {
    pack: "acoustic-drums",
    pools: { kick: ["KdrumL"], rim: ["SnareRest1"] },
    gain: { kick: 0.52, rim: 0.72 },
  },
  pocket: {
    pack: "acoustic-drums",
    gain: { kick: 1.05, snare: 1.05, hat: 0.42, snareGhost: 0.75 },
  },
};

export function poolsForHit(
  kitId: KitId,
  kind: DrumHitKind,
): { pack: DrumPackId; poolIds: string[]; gain: number } {
  const cfg = KIT_DRUM_CONFIG[kitId] ?? KIT_DRUM_CONFIG.boomBap;
  const defaults = DEFAULT_DRUM_POOLS[cfg.pack];
  const poolIds = cfg.pools?.[kind] ?? defaults[kind] ?? defaults.snare ?? ["Snare1"];
  const gain = cfg.gain?.[kind] ?? 1;
  return { pack: cfg.pack, poolIds, gain };
}

/** Pools a kit grammar can touch — used for lazy warm (not the whole pack). */
export function poolsNeededForKit(kitId: KitId): Array<{ pack: DrumPackId; poolId: string }> {
  const kit = KITS[kitId];
  const cfg = KIT_DRUM_CONFIG[kitId] ?? KIT_DRUM_CONFIG.boomBap;
  const needed = new Set<string>();
  const add = (kind: DrumHitKind) => {
    const ids = cfg.pools?.[kind] ?? DEFAULT_DRUM_POOLS[cfg.pack][kind];
    if (ids) ids.forEach((id) => needed.add(id));
  };

  add("kick");
  if (kit.backbeat) {
    if (kit.backbeat.voice === "snare") {
      add("snare");
      if (kit.backbeat.ghosts) add("snareGhost");
    } else if (kit.backbeat.voice === "rim" || kit.backbeat.voice === "woodblock") {
      add("rim");
    } else {
      add("brushLong");
    }
  }
  if (kit.pulse) {
    const pv = kit.pulse.voice;
    if (pv === "hat") {
      add("hat");
      add("hatOpen");
    } else if (pv === "shaker") {
      add("shaker");
    } else {
      add("brush");
    }
  }
  if (kit.offbeat?.voice === "hat") add("hat");
  if (kit.fills) {
    add("snare");
    add("hat");
  }

  return [...needed].map((poolId) => ({ pack: cfg.pack, poolId }));
}

export function hitKindForPulse(voice: "hat" | "shaker" | "brush", accent: boolean): DrumHitKind {
  if (voice === "hat") return accent ? "hatOpen" : "hat";
  if (voice === "shaker") return "shaker";
  return "brush";
}

export function hitKindForBackbeat(
  voice: "snare" | "rim" | "brush" | "woodblock",
  ghost: boolean,
): DrumHitKind {
  if (voice === "snare") return ghost ? "snareGhost" : "snare";
  if (voice === "rim" || voice === "woodblock") return "rim";
  return ghost ? "brush" : "brushLong";
}
