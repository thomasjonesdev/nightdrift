// Per-band audio engineer — each ensemble carries its own mix signature and
// round-by-round balance as a scene plays.

import type { Band, KitId, MelodyBehavior } from "./bands";
import { dualPianoLayout } from "./dual-piano";
import type { MoodKey } from "./moods";
import { KITS } from "./bands";

export interface BandMix {
  chordBus: number;
  melodyBus: number;
  bassBus: number;
  drumBus: number;
  textureBus: number;
  padBus: number;
  ambienceMul: number;
  duckMul: number;
  chordVelMul: number;
  melodyVelMul: number;
  bassVelMul: number;
}

const DEFAULT_MIX: BandMix = {
  chordBus: 1,
  melodyBus: 1,
  bassBus: 1,
  drumBus: 1,
  textureBus: 1,
  padBus: 1,
  ambienceMul: 1,
  duckMul: 1,
  chordVelMul: 1,
  melodyVelMul: 1,
  bassVelMul: 1,
};

const KIT_DRUM_TRIM: Partial<Record<KitId, number>> = {
  punchy: 1.08,
  pocket: 1.02,
  boomBap: 0.98,
  muted: 0.82,
  brushes: 0.78,
  heartbeat: 0.72,
  slowMotion: 0.76,
  bossa: 0.8,
};

const MELODY_BEHAVIOR_MELODY_TRIM: Partial<Record<MelodyBehavior, number>> = {
  motif: 1,
  arp: 0.92,
  held: 0.88,
  sparse: 0.94,
};

/** Hand-tuned signatures for bands that need a stronger identity on the board. */
const ENGINEER_OVERRIDES: Partial<Record<string, Partial<BandMix>>> = {
  "felt-piano-trio": {
    melodyBus: 1.1,
    chordBus: 0.94,
    textureBus: 0.88,
    padBus: 0.92,
    chordVelMul: 0.96,
    melodyVelMul: 1.06,
  },
  "piano-rain": {
    melodyBus: 1.05,
    textureBus: 0.82,
    padBus: 1.08,
    ambienceMul: 1.06,
    drumBus: 0.78,
  },
  "piano-duet": {
    chordBus: 0.9,
    melodyBus: 1.12,
    chordVelMul: 0.88,
    melodyVelMul: 1.08,
  },
  "tape-quartet": {
    textureBus: 1.05,
    melodyBus: 0.96,
    chordBus: 1.04,
  },
  "bossa-balcony": {
    drumBus: 0.86,
    bassBus: 1.06,
    melodyBus: 1.04,
    duckMul: 0.92,
  },
  "pad-cathedral": {
    textureBus: 1.12,
    padBus: 1.1,
    melodyBus: 0.9,
    chordBus: 0.96,
  },
  "basement-session": {
    drumBus: 1.06,
    bassBus: 1.08,
    textureBus: 0.9,
    duckMul: 1.06,
  },
  "organ-cathedral": {
    textureBus: 1.08,
    chordBus: 1.06,
    melodyBus: 0.88,
  },
};

function mergeMix(base: BandMix, patch: Partial<BandMix>): BandMix {
  return { ...base, ...patch };
}

function pianoForwardTrim(band: Band): Partial<BandMix> {
  if (band.chordVoice !== "piano" && band.melodyVoice !== "piano") return {};
  const patch: Partial<BandMix> = {};
  if (band.chordVoice === "piano") {
    patch.chordBus = (patch.chordBus ?? 1) * 1.02;
    patch.chordVelMul = (patch.chordVelMul ?? 1) * 1.04;
  }
  if (band.melodyVoice === "piano") {
    patch.melodyBus = (patch.melodyBus ?? 1) * 1.06;
    patch.melodyVelMul = (patch.melodyVelMul ?? 1) * 1.05;
  }
  return patch;
}

function bedLayerTrim(band: Band): Partial<BandMix> {
  let textureBus = 1;
  let padBus = 1;
  if (band.bedVoice) textureBus *= 1 + (band.bedChance ?? 0.8) * 0.08;
  if (band.harmonyVoice) textureBus *= 1 + (band.harmonyChance ?? 0.55) * 0.06;
  if (band.padChance >= 0.8) padBus *= 1.06;
  return { textureBus, padBus };
}

/** Baseline board mix for a band in this mood — set once when the tune is booked. */
export function buildBandMix(band: Band, family: MoodKey): BandMix {
  const kit = KITS[band.kit];
  let mix = mergeMix(DEFAULT_MIX, {
    drumBus: KIT_DRUM_TRIM[band.kit] ?? 1,
    melodyBus: MELODY_BEHAVIOR_MELODY_TRIM[band.melodyBehavior] ?? 1,
    duckMul: kit.kickVel > 1.1 ? 1.04 : kit.kickVel < 0.7 ? 0.94 : 1,
  });

  mix = mergeMix(mix, pianoForwardTrim(band));
  mix = mergeMix(mix, bedLayerTrim(band));

  if (family === "rainy") {
    mix = mergeMix(mix, { ambienceMul: 1.05, padBus: mix.padBus * 1.04, drumBus: mix.drumBus * 0.92 });
  } else if (family === "jazzy") {
    mix = mergeMix(mix, { melodyBus: mix.melodyBus * 1.04, textureBus: mix.textureBus * 0.94 });
  }

  const layout = dualPianoLayout(band);
  if (layout === "guest") {
    mix = mergeMix(mix, {
      chordBus: mix.chordBus * 0.88,
      melodyBus: mix.melodyBus * 1.08,
      chordVelMul: mix.chordVelMul * 0.82,
      melodyVelMul: mix.melodyVelMul * 1.1,
    });
  } else if (layout === "duet") {
    mix = mergeMix(mix, {
      chordBus: mix.chordBus * 0.94,
      melodyBus: mix.melodyBus * 1.04,
    });
  }

  const override = ENGINEER_OVERRIDES[band.id];
  if (override) {
    const { ...safe } = override as Partial<BandMix>;
    mix = mergeMix(mix, safe);
  }

  return mix;
}

/** Live trim as the tune moves through its form — called each chord from the engine. */
export function bandMixForRound(
  base: BandMix,
  round: number,
  totalRounds: number,
  energy: number,
): BandMix {
  const last = Math.max(0, totalRounds - 1);
  const t = last <= 0 ? 0 : round / last;
  const mid = 1 - Math.abs(t - 0.5) * 2;

  const intro = round === 0;
  const outro = round === last && totalRounds > 1;

  return {
    ...base,
    chordBus: base.chordBus * (intro ? 0.94 : outro ? 0.9 : 0.98 + 0.04 * mid),
    melodyBus: base.melodyBus * (intro ? 0.9 : outro ? 0.84 : 0.96 + 0.06 * mid),
    bassBus: base.bassBus * (intro ? 0.82 : outro ? 0.76 : 0.92 + 0.08 * energy),
    drumBus: base.drumBus * (intro ? 0.42 : outro ? 0.72 : 0.88 + 0.12 * energy),
    textureBus: base.textureBus * (intro ? 1.06 : outro ? 1.08 : 0.94 + 0.06 * mid),
    padBus: base.padBus * (intro ? 1.08 : outro ? 1.12 : 0.96 + 0.04 * mid),
    ambienceMul: base.ambienceMul * (0.92 + 0.08 * energy),
  };
}
