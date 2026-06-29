// Per-scene algorithmic blueprint — timing, patterns, effects, environment,
// and structure are composed once in makeScene() and read by the engine
// every step so each song feels distinct without hand-authored variations.

import type { AmbienceSpec } from "./ambience";
import type { Band, DrumKit, KitId } from "./bands";
import { KITS } from "./bands";
import type { MoodKey } from "./moods";
import { chance, pick, rand, randInt, weightedPick } from "./random";

export type EnergyShape = "arc" | "plateau" | "wave" | "breathe";

export interface TimingDNA {
  /** Half-width of random timing nudge in seconds. */
  humanize: number;
  /** Extra 16th-note layback on melody phrases. */
  melodyLayback: number;
  /** Multiplier on scene.swing for odd 16ths. */
  swingFeel: number;
  /** Drums sit slightly behind the grid (in 16ths). */
  drumLayback: number;
}

export interface PatternDNA {
  /** Mid-scene beatless chord probability. */
  dropoutChance: number;
  /** Rolled/broken comping spread multiplier. */
  compingSpread: number;
  /** Ghost note density multiplier for drums. */
  drumGhostMul: number;
  /** End-of-round fill probability multiplier. */
  fillIntensity: number;
  /** Kick pattern mutation strength 0–1. */
  kickVariation: number;
  /** Mid-bar chord re-stab chance (rolled comping). */
  restabChance: number;
  /** Free melody fill density multiplier. */
  fillDensity: number;
  /** Harmony doubling likelihood multiplier. */
  harmonyMul: number;
  /** Motif phrase presence multiplier. */
  melodyPresence: number;
}

export interface EffectsDNA {
  /** Tape filter dip per chord probability. */
  filterDipChance: number;
  /** Sidechain duck depth multiplier. */
  duckMul: number;
  /** Vinyl pop rate multiplier. */
  popRate: number;
  /** Occasional reverb swell on mid-progression chords. */
  reverbSwell: number;
}

export interface EnvironmentDNA {
  /** One-shot ambient event rate multiplier. */
  eventRate: number;
  /** Bed level slow movement 0–1+. */
  bedMovement: number;
  /** Fire crackle sparkle rate multiplier. */
  sparkleRate: number;
}

export interface StructureDNA {
  energyShape: EnergyShape;
}

export interface MelodyDNA {
  /** Overall phrase mutation intensity 0–1. */
  mutationStrength: number;
  /** Grace-note / pickup bias multiplier. */
  ornamentBias: number;
  /** Max 16th-note step nudge per note. */
  stepJitter: number;
  /** Center for beat-length stretch (1 = unchanged). */
  stretchBias: number;
  /** Chance of octave-ish scale displacement per note. */
  octaveChance: number;
  /** Fraction of phrase kept in "fragment" variation. */
  fragmentRatio: number;
  /** Extra 16ths for "displaced" variation. */
  displacement: number;
  /** 0 = library phrases only; 1 = fully generated contour. */
  contourBlend: number;
}

export interface HarmonyDNA {
  /** Master reharmonization intensity 0–1. */
  reharmStrength: number;
  /** Tritone substitution probability (scaled by strength). */
  tritoneChance: number;
  /** Modal interchange / borrowed chord probability. */
  modalChance: number;
  /** Passing-tone approach chord probability. */
  passingChance: number;
}

export interface SceneDNA {
  timing: TimingDNA;
  patterns: PatternDNA;
  effects: EffectsDNA;
  environment: EnvironmentDNA;
  structure: StructureDNA;
  melody: MelodyDNA;
  harmony: HarmonyDNA;
}

/** Compose a unique feel profile from mood family and band character. */
export function generateSceneDNA(family: MoodKey, band: Band, kitId: KitId): SceneDNA {
  const kit = KITS[kitId];
  const isSparse = kit.kicks.length <= 2;
  const isBusy = kit.pulse?.every === 2;

  const timing: TimingDNA =
    family === "jazzy"
      ? {
          humanize: rand(0.012, 0.026),
          melodyLayback: rand(0.08, 0.18),
          swingFeel: rand(1.06, 1.22),
          drumLayback: rand(0.02, isSparse ? 0.08 : 0.06),
        }
      : family === "rainy"
        ? {
            humanize: rand(0.005, 0.012),
            melodyLayback: rand(0.04, 0.1),
            swingFeel: rand(0.88, 0.98),
            drumLayback: rand(0.02, 0.05),
          }
        : {
            humanize: rand(0.006, 0.014),
            melodyLayback: rand(0.02, 0.08),
            swingFeel: rand(0.96, 1.06),
            drumLayback: rand(0, isSparse ? 0.05 : 0.035),
          };

  const patterns: PatternDNA =
    family === "jazzy"
      ? {
          dropoutChance: rand(0.14, 0.28),
          compingSpread: rand(
            band.comping === "rolled" ? 0.9 : 1,
            band.comping === "broken" ? 1.4 : 1.2,
          ),
          drumGhostMul: rand(isBusy ? 0.85 : 1, isBusy ? 1.55 : 1.35),
          fillIntensity: kit.fills ? rand(0.85, 1.55) : 0,
          kickVariation: rand(0.35, 0.95),
          restabChance: band.comping === "rolled" ? rand(0.45, 0.85) : rand(0.25, 0.45),
          fillDensity: rand(
            band.melodyBehavior === "sparse" ? 1.15 : 0.9,
            band.melodyBehavior === "sparse" ? 1.6 : 1.35,
          ),
          harmonyMul: rand(0.55, 0.95),
          melodyPresence: rand(0.82, 1.02),
        }
      : family === "rainy"
        ? {
            dropoutChance: rand(0.02, 0.08),
            compingSpread: rand(
              band.comping === "rolled" ? 0.75 : 0.88,
              band.comping === "broken" ? 1.15 : 1.02,
            ),
            drumGhostMul: rand(0.55, 0.95),
            fillIntensity: kit.fills ? rand(0.35, 0.75) : 0,
            kickVariation: rand(0.1, 0.45),
            restabChance: band.comping === "rolled" ? rand(0.2, 0.45) : 0.12,
            fillDensity: rand(0.55, 0.95),
            harmonyMul: rand(0.95, 1.45),
            melodyPresence: rand(0.62, 0.86),
          }
        : {
            dropoutChance: rand(0.04, 0.12),
            compingSpread: rand(
              band.comping === "rolled" ? 0.85 : 1,
              band.comping === "broken" ? 1.3 : 1.12,
            ),
            drumGhostMul: rand(isBusy ? 0.75 : 0.95, isBusy ? 1.25 : 1.15),
            fillIntensity: kit.fills ? rand(0.55, 1.1) : 0,
            kickVariation: rand(0.2, 0.65),
            restabChance: band.comping === "rolled" ? rand(0.35, 0.7) : 0.18,
            fillDensity: rand(0.75, 1.15),
            harmonyMul: rand(0.85, 1.35),
            melodyPresence: rand(0.92, 1.15),
          };

  const effects: EffectsDNA =
    family === "jazzy"
      ? {
          filterDipChance: rand(0.06, 0.12),
          duckMul: rand(0.95, 1.18),
          popRate: rand(0.8, 1.6),
          reverbSwell: rand(0, 0.15),
        }
      : family === "rainy"
        ? {
            filterDipChance: rand(0.08, 0.18),
            duckMul: rand(0.82, 0.98),
            popRate: rand(0.35, 0.85),
            reverbSwell: rand(0.18, 0.55),
          }
        : {
            filterDipChance: rand(0.06, 0.16),
            duckMul: rand(0.9, 1.05),
            popRate: rand(0.55, 1.2),
            reverbSwell: rand(0.05, 0.25),
          };

  const environment: EnvironmentDNA =
    family === "jazzy"
      ? {
          eventRate: rand(1.1, 1.75),
          bedMovement: rand(0.65, 1.35),
          sparkleRate: rand(0.9, 1.55),
        }
      : family === "rainy"
        ? {
            eventRate: rand(0.35, 0.75),
            bedMovement: rand(0.85, 1.45),
            sparkleRate: rand(0.45, 0.9),
          }
        : {
            eventRate: rand(0.65, 1.05),
            bedMovement: rand(0.55, 1.05),
            sparkleRate: rand(0.65, 1.15),
          };

  const structure: StructureDNA = {
    energyShape: weightedPick<EnergyShape>(
      ["arc", "plateau", "wave", "breathe"],
      (s) => {
        if (family === "jazzy") {
          if (s === "wave") return 3.2;
          if (s === "arc") return +2.2;
          if (s === "plateau") return 0.8;
          return 0.6;
        }
        if (family === "rainy") {
          if (s === "breathe") return 3.5;
          if (s === "plateau") return 1.8;
          if (s === "arc") return 0.7;
          return 0.5;
        }
        if (s === "plateau") return 3;
        if (s === "arc") return 2;
        if (s === "wave") return 0.6;
        return 0.8;
      },
    ),
  };

  const melody: MelodyDNA =
    family === "jazzy"
      ? {
          mutationStrength: rand(0.45, 0.82),
          ornamentBias: rand(1.05, 1.45),
          stepJitter: randInt(1, 2),
          stretchBias: rand(0.96, 1.1),
          octaveChance: rand(0.12, 0.28),
          fragmentRatio: rand(0.4, 0.58),
          displacement: randInt(2, 5),
          contourBlend: rand(0.4, 0.72),
        }
      : family === "rainy"
        ? {
            mutationStrength: rand(0.12, 0.35),
            ornamentBias: rand(0.55, 0.9),
            stepJitter: 0,
            stretchBias: rand(0.98, 1.12),
            octaveChance: rand(0.02, 0.08),
            fragmentRatio: rand(0.55, 0.78),
            displacement: randInt(1, 2),
            contourBlend: rand(0.15, 0.35),
          }
        : {
            mutationStrength: rand(0.18, 0.42),
            ornamentBias: rand(0.82, 1.15),
            stepJitter: randInt(0, 1),
            stretchBias: rand(0.96, 1.06),
            octaveChance: rand(0.06, 0.14),
            fragmentRatio: rand(0.48, 0.65),
            displacement: randInt(1, 3),
            contourBlend: rand(0.28, 0.52),
          };

  const harmony: HarmonyDNA =
    family === "jazzy"
      ? {
          reharmStrength: rand(0.48, 0.88),
          tritoneChance: rand(0.45, 0.75),
          modalChance: rand(0.35, 0.65),
          passingChance: rand(0.45, 0.75),
        }
      : family === "rainy"
        ? {
            reharmStrength: rand(0.05, 0.22),
            tritoneChance: rand(0.08, 0.25),
            modalChance: rand(0.08, 0.22),
            passingChance: rand(0.12, 0.32),
          }
        : {
            reharmStrength: rand(0.12, 0.38),
            tritoneChance: rand(0.15, 0.35),
            modalChance: rand(0.12, 0.32),
            passingChance: rand(0.18, 0.42),
          };

  return { timing, patterns, effects, environment, structure, melody, harmony };
}

const OFFBEAT_CANDIDATES = [3, 5, 7, 11, 13, 19, 23, 27, 29];

/** Derive a scene-specific drum grammar from the band's kit template. */
export function mutateDrumKit(base: DrumKit, patterns: PatternDNA): DrumKit {
  const kicks = [...base.kicks];
  let kickGhosts = base.kickGhosts
    ? { steps: [...base.kickGhosts.steps], p: base.kickGhosts.p * patterns.drumGhostMul }
    : undefined;

  if (patterns.kickVariation > 0.3 && chance(0.35 * patterns.kickVariation)) {
    const candidates = OFFBEAT_CANDIDATES.filter((s) => !kicks.includes(s));
    if (candidates.length > 0 && kicks.length < 7) {
      kicks.push(pick(candidates));
      kicks.sort((a, b) => a - b);
    }
  }
  if (chance(0.2 * patterns.kickVariation) && kicks.length > 2) {
    kicks.splice(randInt(1, kicks.length - 1), 1);
  }

  if (chance(0.4 * patterns.kickVariation)) {
    if (!kickGhosts) kickGhosts = { steps: [], p: 0.2 * patterns.drumGhostMul };
    const ghostCandidates = OFFBEAT_CANDIDATES.filter(
      (s) => !kicks.includes(s) && !kickGhosts!.steps.includes(s),
    );
    if (ghostCandidates.length > 0) {
      kickGhosts.steps.push(pick(ghostCandidates));
      kickGhosts.p = Math.min(0.45, kickGhosts.p * 1.1);
    }
  }

  let backbeat = base.backbeat
    ? {
        ...base.backbeat,
        steps: [...base.backbeat.steps],
        ghosts: base.backbeat.ghosts
          ? {
              steps: [...base.backbeat.ghosts.steps],
              p: base.backbeat.ghosts.p * patterns.drumGhostMul,
            }
          : undefined,
      }
    : null;

  if (backbeat?.ghosts && chance(0.25 * patterns.kickVariation)) {
    const snareGhosts = OFFBEAT_CANDIDATES.filter(
      (s) => !backbeat!.steps.includes(s) && !backbeat!.ghosts!.steps.includes(s),
    );
    if (snareGhosts.length > 0) backbeat.ghosts.steps.push(pick(snareGhosts));
  }

  const pulse = base.pulse
    ? {
        ...base.pulse,
        p: Math.min(0.98, base.pulse.p * rand(0.92, 1.05 + patterns.fillIntensity * 0.03)),
      }
    : null;

  const offbeat = base.offbeat
    ? { ...base.offbeat, p: base.offbeat.p * rand(0.85, 1.15) * patterns.drumGhostMul }
    : undefined;

  return {
    kicks,
    kickVel: base.kickVel,
    kickGhosts,
    backbeat,
    pulse,
    offbeat,
    fills: base.fills,
  };
}

const INTRO_ENERGY = [0.15, 0.3, 0.5, 0.6];
const OUTRO_ENERGY = [0.6, 0.6, 0.45, 0.25];

/** Energy arc with per-scene structural shape. */
export function sceneEnergy(
  dna: StructureDNA,
  round: number,
  chordIdx: number,
  totalRounds: number,
): number {
  let e: number;
  if (round === 0) e = INTRO_ENERGY[chordIdx];
  else if (round === totalRounds - 1) e = OUTRO_ENERGY[chordIdx];
  else e = round % 2 === 1 ? 1 : 0.85;

  switch (dna.energyShape) {
    case "plateau":
      if (round > 0 && round < totalRounds - 1) e = Math.min(1, e * 1.08);
      break;
    case "wave":
      e *= 0.82 + 0.18 * Math.sin((round + chordIdx * 0.35) * Math.PI * 0.5);
      break;
    case "breathe":
      e *= 0.88 + 0.12 * Math.sin((round * 4 + chordIdx) * Math.PI / 6);
      break;
  }
  return Math.max(0.1, Math.min(1, e));
}

/** Layer algorithmic movement on the picked ambience stack. */
export function shapeAmbience(spec: AmbienceSpec, env: EnvironmentDNA): AmbienceSpec {
  const shaped: AmbienceSpec = {
    ...spec,
    level: spec.level * rand(0.88, 1.12),
    movement: env.bedMovement * rand(0.85, 1.15),
    sparkleRate: spec.bed === "fire" ? env.sparkleRate : 0,
  };
  if (spec.secondary) {
    shaped.secondary = {
      ...spec.secondary,
      weight: spec.secondary.weight * rand(0.82, 1.18),
    };
  }
  return shaped;
}
