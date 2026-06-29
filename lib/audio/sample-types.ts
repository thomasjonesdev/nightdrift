// Shared types for the sample catalog and lazy instruments.

export type SampleLayout =
  | "velocity-layers"
  | "velocity-steps"
  | "dynamic-layers"
  | "round-robin"
  | "single";

export interface SampleZoneEntry {
  rootNote: string;
  rootMidi: number;
  /** Layer id → file paths (supports round-robin pools). */
  layers: Record<string, string[]>;
}

export interface SamplePackCatalog {
  id: string;
  basePath: string;
  layout: SampleLayout;
  /** Per-layer velocity center (0–1) for crossfading. */
  layerWeights?: Record<string, number>;
  zones: SampleZoneEntry[];
  fileCount: number;
}

export interface SampleCatalog {
  generatedAt: string;
  packs: SamplePackCatalog[];
}
