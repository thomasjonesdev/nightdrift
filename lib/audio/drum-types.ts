// Drum sample types — pool-based one-shots, separate from pitched multisamples.

export interface DrumPool {
  /** Folder name (acoustic) or articulation id (orchestral), e.g. KdrumL or 2A. */
  id: string;
  files: string[];
}

export interface DrumPackCatalog {
  id: string;
  basePath: string;
  pools: DrumPool[];
  fileCount: number;
}

export interface DrumCatalog {
  generatedAt: string;
  packs: DrumPackCatalog[];
}

/** Engine drum voice roles mapped to sample pools. */
export type DrumHitKind =
  | "kick"
  | "snare"
  | "snareGhost"
  | "rim"
  | "brush"
  | "brushLong"
  | "hat"
  | "hatOpen"
  | "shaker";

export type DrumPackId = "acoustic-drums";
