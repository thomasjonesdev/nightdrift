// Arrangement producer — last pass before a scene airs: validate the chart,
// trim clutter, and lock the band engineer's baseline mix.

import type { Band, CompingStyle } from "./bands";
import { buildBandMix } from "./band-engineer";
import { dualPianoLayout } from "./dual-piano";
import type { DrumKit } from "./bands";
import type { CompingPattern } from "./comping-patterns";
import type { SceneDNA } from "./drift-algorithm";
import { midiFromNote } from "./notes";
import type { Scene } from "./scenes";
import type { ChordTexture, TexturePlan } from "./texture-plan";

export interface ProducerNotes {
  textureTrimmed: number;
  compingTrimmed: number;
  drumGhostsRemoved: number;
}

function trimTexturePlan(
  plan: TexturePlan,
  band: Band,
): { plan: TexturePlan; trimmed: number } {
  const behavior = band.melodyBehavior;
  let trimmed = 0;

  const scaleVel = (notes: ChordTexture["pickup"], mul: number) =>
    notes.map((n) => {
      if (mul >= 1) return n;
      trimmed++;
      return { ...n, vel: n.vel * mul };
    });

  const dropEvery = behavior === "sparse" ? 3 : behavior === "held" ? 4 : 0;
  const velMul = behavior === "sparse" ? 0.82 : behavior === "held" ? 0.88 : 1;

  const byChord = plan.byChord.map((ch) => {
    const filterDrop = <T>(arr: T[]) => {
      if (!dropEvery) return arr;
      return arr.filter((_, i) => {
        if (i % dropEvery !== dropEvery - 1) return true;
        trimmed++;
        return false;
      });
    };

    return {
      pickup: scaleVel(ch.pickup, velMul),
      arp: filterDrop(scaleVel(ch.arp, velMul)),
      tail: scaleVel(ch.tail, velMul * 0.95),
      inner: behavior === "motif" ? ch.inner : filterDrop(ch.inner),
      shimmer: behavior === "sparse" ? [] : scaleVel(ch.shimmer, velMul * 0.9),
    };
  });

  if (band.bedVoice && band.harmonyVoice && behavior !== "arp") {
    for (const ch of byChord) {
      if (ch.inner.length > 1) {
        ch.inner = ch.inner.slice(0, 1);
        trimmed += 1;
      }
    }
  }

  return { plan: { byChord }, trimmed };
}

function refineComping(
  pattern: CompingPattern,
  comping: CompingStyle,
  dna: SceneDNA,
): { pattern: CompingPattern; trimmed: number } {
  let trimmed = 0;
  let hits = [...pattern.hits];

  if (comping === "sustained" || comping === "rolled") {
    const maxHits = comping === "sustained" ? 6 : 10;
    if (hits.length > maxHits) {
      trimmed = hits.length - maxHits;
      hits = hits.slice(0, maxHits);
    }
  }

  if (comping === "stabs" && dna.patterns.compingSpread < 0.92) {
    const before = hits.length;
    hits = hits.filter((h) => h.step % 8 === 0 || h.velScale >= 0.85);
    trimmed += before - hits.length;
  }

  return { pattern: { ...pattern, hits }, trimmed };
}

function refineDrumGrammar(grammar: DrumKit, band: Band): { grammar: DrumKit; ghostsRemoved: number } {
  let ghostsRemoved = 0;
  if (band.kit !== "muted" && band.kit !== "brushes" && band.kit !== "heartbeat") {
    return { grammar, ghostsRemoved };
  }

  const kickGhosts = grammar.kickGhosts
    ? { ...grammar.kickGhosts, p: grammar.kickGhosts.p * 0.65 }
    : undefined;
  const backbeat = grammar.backbeat?.ghosts
    ? {
        ...grammar.backbeat,
        ghosts: { ...grammar.backbeat.ghosts, p: grammar.backbeat.ghosts.p * 0.6 },
      }
    : grammar.backbeat;

  if (grammar.kickGhosts && kickGhosts && kickGhosts.p < grammar.kickGhosts.p) ghostsRemoved++;
  if (grammar.backbeat?.ghosts && backbeat?.ghosts && backbeat.ghosts.p < grammar.backbeat.ghosts.p) {
    ghostsRemoved++;
  }

  return {
    grammar: { ...grammar, kickGhosts, backbeat },
    ghostsRemoved,
  };
}

/** Melody and bass in the same register — thin bass velocity on overlapping chords. */
function refineBassRegister(scene: Scene): Scene {
  if (scene.band.bassVoice === "none") return scene;

  const byChord = scene.bassLinePlan.byChord.map((figure, chordIdx) => {
    const phrase = scene.melodyPlan.chordPhrases[chordIdx];
    if (!phrase || phrase.length === 0) return figure;

    let melodyLow = 127;
    for (const n of phrase) {
      melodyLow = Math.min(melodyLow, midiFromNote(scene.scale[n.scaleIdx]));
    }

    return figure.map((rn) => {
      const bassMidi = scene.progression[chordIdx].rootMidi + (rn.deg === "root" ? 0 : 7);
      if (bassMidi >= melodyLow - 3 && rn.vel > 0.5) {
        return { ...rn, vel: rn.vel * 0.78 };
      }
      return rn;
    });
  });

  return {
    ...scene,
    bassLinePlan: { ...scene.bassLinePlan, byChord },
    bassRiff: byChord.flat(),
  };
}

function balancePadsAndBeds(scene: Scene): Scene {
  let textureBusGain = scene.textureBusGain;
  let padBusGain = scene.padBusGain;
  let padOn = scene.padOn;

  const layers =
    (scene.band.bedVoice ? 1 : 0)
    + (scene.band.harmonyVoice ? 1 : 0)
    + (scene.padOn ? 1 : 0);

  if (layers >= 3) {
    textureBusGain *= 0.92;
    padBusGain *= 0.94;
  }

  if (scene.band.melodyBehavior === "sparse" && scene.padOn && scene.family === "jazzy") {
    padOn = false;
  }

  if (dualPianoLayout(scene.band) && scene.padOn) {
    padBusGain *= 0.88;
  }

  return { ...scene, textureBusGain, padBusGain, padOn };
}

function tightenMelodyPresence(scene: Scene): Scene {
  if (scene.band.melodyBehavior !== "sparse" && scene.band.melodyBehavior !== "held") {
    return scene;
  }

  const cap = scene.band.melodyBehavior === "sparse" ? 0.82 : 0.88;
  if (scene.dna.patterns.melodyPresence <= cap) return scene;

  return {
    ...scene,
    dna: {
      ...scene.dna,
      patterns: {
        ...scene.dna.patterns,
        melodyPresence: cap,
      },
    },
  };
}

/** Producer pass — deterministic refinements applied right before playback. */
export function produceArrangement(scene: Scene): Scene {
  const texture = trimTexturePlan(scene.texturePlan, scene.band);
  const comping = refineComping(scene.compingPattern, scene.band.comping, scene.dna);
  const drums = refineDrumGrammar(scene.drumGrammar, scene.band);

  let refined: Scene = {
    ...scene,
    texturePlan: texture.plan,
    compingPattern: comping.pattern,
    drumGrammar: drums.grammar,
    mix: buildBandMix(scene.band, scene.family),
  };

  refined = refineBassRegister(refined);
  refined = balancePadsAndBeds(refined);
  refined = tightenMelodyPresence(refined);

  return refined;
}

/** @internal test hook */
export function producerDiagnostics(scene: Scene): ProducerNotes {
  const texture = trimTexturePlan(scene.texturePlan, scene.band);
  const comping = refineComping(scene.compingPattern, scene.band.comping, scene.dna);
  const drums = refineDrumGrammar(scene.drumGrammar, scene.band);
  return {
    textureTrimmed: texture.trimmed,
    compingTrimmed: comping.trimmed,
    drumGhostsRemoved: drums.ghostsRemoved,
  };
}
