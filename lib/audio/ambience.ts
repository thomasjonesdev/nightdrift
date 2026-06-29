// Ambient layer — environmental beds that sit under the music: rain on
// the window, wind around the eaves, city rumble, a fireplace. Each bed
// is looped filtered noise with slow LFO movement; the manager crossfades
// between them at scene segues. One-shot ambient events (thunder, owls,
// chimes, a distant train) live in voices.ts and are triggered by the
// engine's event scheduler.

import type { MoodKey } from "./moods";
import { chance, pick, rand, weightedPick } from "./random";

export type AmbienceBed = "none" | "rain" | "wind" | "city" | "fire";

export interface SecondaryAmbience {
  bed: AmbienceBed;
  /** 0..1 — mix weight relative to the primary bed level. */
  weight: number;
}

export interface AmbienceSpec {
  bed: AmbienceBed;
  /** 0..1 — how present the bed is in the mix. */
  level: number;
  /** Slow gain breathing depth (1 = default bed LFO). */
  movement?: number;
  /** Fire crackle rate multiplier (0 = off). */
  sparkleRate?: number;
  /** Optional low-level secondary bed layered under the primary. */
  secondary?: SecondaryAmbience;
}

const BED_WEIGHTS: Record<MoodKey, [AmbienceBed, number][]> = {
  mellow: [["none", 0.28], ["fire", 0.38], ["wind", 0.22], ["rain", 0.12]],
  jazzy: [["city", 0.55], ["none", 0.28], ["rain", 0.17]],
  rainy: [["rain", 0.82], ["wind", 0.12], ["city", 0.06]],
};

export function pickAmbience(family: MoodKey): AmbienceSpec {
  const bed = weightedPick(BED_WEIGHTS[family], (e) => e[1])[0];
  const level = bed === "none"
    ? 0
    : family === "rainy"
      ? rand(0.72, 1)
      : family === "jazzy"
        ? rand(0.38, 0.68)
        : rand(0.42, 0.72);
  return { bed, level };
}

/** Primary bed plus an optional complementary secondary layer. */
export function pickAmbienceStack(family: MoodKey): AmbienceSpec {
  const primary = pickAmbience(family);
  if (primary.bed === "none" || !chance(family === "rainy" ? 0.55 : 0.35)) {
    return primary;
  }
  const altBeds = BED_WEIGHTS[family]
    .map(([bed]) => bed)
    .filter((bed): bed is AmbienceBed => bed !== "none" && bed !== primary.bed);
  const secondaryBed = pick(altBeds.length > 0 ? altBeds : (["wind"] as const));
  return {
    ...primary,
    secondary: {
      bed: secondaryBed,
      weight: family === "rainy" ? rand(0.25, 0.45) : rand(0.15, 0.35),
    },
  };
}

export interface Ambience {
  /** Crossfade toward a bed; `fast` for the initial start. */
  set(spec: AmbienceSpec, t: number, fast?: boolean): void;
  /** Adjust bed breathing depth without a full crossfade. */
  morphMovement(movement: number, t: number, rampSecs?: number): void;
  /** Adjust primary level and secondary mix weight without changing beds. */
  morphLevels(primaryLevel: number, secondaryWeight: number, t: number, rampSecs?: number): void;
  /** Called every step: per-bed grain (fire crackles). */
  sparkle(t: number): void;
}

export function createAmbience(
  ctx: AudioContext,
  out: AudioNode,
  noiseBuf: AudioBuffer,
): Ambience {
  interface Bed {
    gain: GainNode;
    /** Bed gain at level 1. */
    base: number;
    /** Slow level LFO depth node, scaled alongside the bed gain. */
    lfoAmt?: GainNode;
    /** LFO depth relative to the bed gain. */
    lfoScale?: number;
  }

  function noiseSrc(rate: number): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start();
    return s;
  }

  function lfo(freqHz: number): OscillatorNode {
    const o = ctx.createOscillator();
    o.frequency.value = freqHz;
    o.start();
    return o;
  }

  const beds: Partial<Record<AmbienceBed, Bed>> = {};

  // rain: bandpassed noise body with slow gusts, plus a quieter
  // high droplet-patter layer so it reads as rain over the music
  {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 750;
    bp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0;
    noiseSrc(0.85).connect(bp).connect(g).connect(out);
    const patter = ctx.createBiquadFilter();
    patter.type = "bandpass";
    patter.frequency.value = 2700;
    patter.Q.value = 0.7;
    const patterG = ctx.createGain();
    patterG.gain.value = 0.55;
    noiseSrc(1.1).connect(patter).connect(patterG).connect(g);
    const amt = ctx.createGain();
    amt.gain.value = 0;
    lfo(0.06).connect(amt).connect(g.gain);
    beds.rain = { gain: g, base: 0.055, lfoAmt: amt, lfoScale: 0.4 };
  }

  // wind: dark noise whose cutoff and level both breathe slowly
  {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0;
    noiseSrc(0.6).connect(lp).connect(g).connect(out);
    const sweep = ctx.createGain();
    sweep.gain.value = 160;
    lfo(0.07).connect(sweep).connect(lp.frequency);
    const amt = ctx.createGain();
    amt.gain.value = 0;
    lfo(0.045).connect(amt).connect(g.gain);
    beds.wind = { gain: g, base: 0.05, lfoAmt: amt, lfoScale: 0.35 };
  }

  // city: low traffic rumble with a barely-there swell
  {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 150;
    const g = ctx.createGain();
    g.gain.value = 0;
    noiseSrc(0.5).connect(lp).connect(g).connect(out);
    const amt = ctx.createGain();
    amt.gain.value = 0;
    lfo(0.03).connect(amt).connect(g.gain);
    beds.city = { gain: g, base: 0.065, lfoAmt: amt, lfoScale: 0.25 };
  }

  // fire: warm hush; the crackle comes from sparkle()
  {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0;
    noiseSrc(0.55).connect(lp).connect(g).connect(out);
    beds.fire = { gain: g, base: 0.035 };
  }

  let current: AmbienceBed = "none";
  let secondaryBed: AmbienceBed = "none";
  let level = 0;
  let secondaryWeight = 0;
  let sparkleRate = 1;
  let movement = 1;

  function applyBedTargets(spec: AmbienceSpec, t: number, tc: number) {
    for (const [name, bed] of Object.entries(beds) as [AmbienceBed, Bed][]) {
      let target = 0;
      if (name === spec.bed) target = bed.base * spec.level;
      else if (spec.secondary && name === spec.secondary.bed) {
        target = bed.base * spec.level * spec.secondary.weight;
      }
      bed.gain.gain.setTargetAtTime(target, t, tc);
      bed.lfoAmt?.gain.setTargetAtTime(
        target * (bed.lfoScale ?? 0) * movement,
        t,
        tc,
      );
    }
  }

  return {
    set(spec, t, fast = false) {
      current = spec.bed;
      secondaryBed = spec.secondary?.bed ?? "none";
      level = spec.level;
      secondaryWeight = spec.secondary?.weight ?? 0;
      sparkleRate = spec.sparkleRate ?? 1;
      movement = spec.movement ?? 1;
      applyBedTargets(spec, t, fast ? 1 : 4);
    },

    morphMovement(nextMovement, t, rampSecs = 2.5) {
      movement = nextMovement;
      const bed = beds[current];
      if (!bed?.lfoAmt) return;
      const target = bed.base * level * movement * (bed.lfoScale ?? 0);
      bed.lfoAmt.gain.setTargetAtTime(target, t, rampSecs);
    },

    morphLevels(primaryLevel, nextSecondaryWeight, t, rampSecs = 2.5) {
      level = primaryLevel;
      secondaryWeight = nextSecondaryWeight;
      applyBedTargets(
        {
          bed: current,
          level: primaryLevel,
          secondary:
            secondaryBed !== "none"
              ? { bed: secondaryBed, weight: nextSecondaryWeight }
              : undefined,
        },
        t,
        rampSecs,
      );
    },

    sparkle(t) {
      if (current !== "fire" || !chance(0.35 * sparkleRate)) return;
      const ticks = chance(0.3) ? 2 : 1;
      for (let i = 0; i < ticks; i++) {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        n.playbackRate.value = 0.3 + Math.random() * 0.6;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1600;
        const g = ctx.createGain();
        const at = t + i * rand(0.03, 0.12);
        g.gain.setValueAtTime((0.02 + Math.random() * 0.045) * level, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.05);
        n.connect(lp).connect(g).connect(out);
        n.start(at);
        n.stop(at + 0.1);
      }
    },
  };
}
