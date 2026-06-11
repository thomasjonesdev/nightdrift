// Ambient layer — environmental beds that sit under the music: rain on
// the window, wind around the eaves, city rumble, a fireplace. Each bed
// is looped filtered noise with slow LFO movement; the manager crossfades
// between them at scene segues. One-shot ambient events (thunder, owls,
// chimes, a distant train) live in voices.ts and are triggered by the
// engine's event scheduler.

import type { MoodKey } from "./moods";
import { chance, rand, weightedPick } from "./random";

export type AmbienceBed = "none" | "rain" | "wind" | "city" | "fire";

export interface AmbienceSpec {
  bed: AmbienceBed;
  /** 0..1 — how present the bed is in the mix. */
  level: number;
}

const BED_WEIGHTS: Record<MoodKey, [AmbienceBed, number][]> = {
  mellow: [["none", 0.35], ["fire", 0.25], ["rain", 0.2], ["wind", 0.2]],
  jazzy: [["none", 0.4], ["city", 0.35], ["rain", 0.25]],
  rainy: [["rain", 0.65], ["wind", 0.2], ["city", 0.15]],
};

export function pickAmbience(family: MoodKey): AmbienceSpec {
  const bed = weightedPick(BED_WEIGHTS[family], (e) => e[1])[0];
  const level = bed === "none" ? 0 : family === "rainy" ? rand(0.55, 1) : rand(0.25, 0.6);
  return { bed, level };
}

export interface Ambience {
  /** Crossfade toward a bed; `fast` for the initial start. */
  set(spec: AmbienceSpec, t: number, fast?: boolean): void;
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

  // rain: bandpassed noise with slow gusts
  {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 750;
    bp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0;
    noiseSrc(0.85).connect(bp).connect(g).connect(out);
    const amt = ctx.createGain();
    amt.gain.value = 0;
    lfo(0.06).connect(amt).connect(g.gain);
    beds.rain = { gain: g, base: 0.02, lfoAmt: amt, lfoScale: 0.4 };
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
    beds.wind = { gain: g, base: 0.018, lfoAmt: amt, lfoScale: 0.35 };
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
    beds.city = { gain: g, base: 0.024, lfoAmt: amt, lfoScale: 0.25 };
  }

  // fire: warm hush; the crackle comes from sparkle()
  {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0;
    noiseSrc(0.55).connect(lp).connect(g).connect(out);
    beds.fire = { gain: g, base: 0.012 };
  }

  let current: AmbienceBed = "none";
  let level = 0;

  return {
    set(spec, t, fast = false) {
      current = spec.bed;
      level = spec.level;
      const tc = fast ? 1 : 4;
      for (const [name, bed] of Object.entries(beds) as [AmbienceBed, Bed][]) {
        const target = name === spec.bed ? bed.base * spec.level : 0;
        bed.gain.gain.setTargetAtTime(target, t, tc);
        bed.lfoAmt?.gain.setTargetAtTime(target * (bed.lfoScale ?? 0), t, tc);
      }
    },

    sparkle(t) {
      if (current !== "fire" || !chance(0.35)) return;
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
        g.gain.setValueAtTime((0.01 + Math.random() * 0.025) * level, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02 + Math.random() * 0.05);
        n.connect(lp).connect(g).connect(out);
        n.start(at);
        n.stop(at + 0.1);
      }
    },
  };
}
