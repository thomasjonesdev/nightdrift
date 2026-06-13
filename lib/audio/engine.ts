// Nightdrift audio engine — generative lofi on the raw Web Audio API
// (no external libraries, nothing loads from a CDN).
//
// The engine drifts through generated *scenes* like a late-night radio
// station: each scene is a key, progression, tempo, motif, band, and
// ambience (see scenes.ts), played for a few 8-bar rounds with an energy
// arc (beatless intro → groove → outro), then segued seamlessly into the
// next scene — drums fade on a dedicated bus, ambience crossfades, and
// the tempo change hides inside the beatless bridge.
//
// The *band* (bands.ts) decides who plays each role and how: which
// instrument comps the chords and in what style, which instrument takes
// the melody and how it behaves, which bass plays, and which drum
// grammar drives the kit. The *ambience* (ambience.ts) is the weather
// outside the song.
//
// Browser-only: constructs an AudioContext, so it must be created from a
// client component after user interaction.

import { createAmbience } from "./ambience";
import { createDrumDynamics, createMixDynamics } from "./dynamics";
import { createSceneReverb } from "./reverb";
import {
  KITS,
  type BassVoice,
  type ChordVoice,
  type MelodyVoice,
  type PulseVoice,
} from "./bands";
import type { MoodKey } from "./moods";
import { varyPhrase } from "./melodies";
import { dbToGain, midiFromNote, noteFromMidi } from "./notes";
import { chance, pick, randInt } from "./random";
import {
  makeScene,
  summarize,
  type Chord,
  type MotifNote,
  type MotifVariation,
  type RiffDeg,
  type Scene,
  type SceneSummary,
} from "./scenes";
import { createStereoSpread } from "./stereo";
import { createVoices } from "./voices";

export const STEPS = 32;             // two bars of 16ths = one chord
export const CHORDS_PER_ROUND = 4;   // one round = a full pass through the progression

export function sceneDurationSecs(rounds: number, bpm: number): number {
  return rounds * CHORDS_PER_ROUND * STEPS * (60 / bpm / 4);
}
const LOOKAHEAD_VISIBLE_SECS = 0.15;
const LOOKAHEAD_HIDDEN_SECS = 45;
const TICK_MS = 30;
const EVENT_COOLDOWN_SECS = 90;

export interface EngineConfig {
  mood: MoodKey;
  crackle: boolean;
  onSceneChange?: (scene: SceneSummary) => void;
}

/** The meterable channels — one per member of the band, plus the weather. */
export type ChannelId = "chords" | "melody" | "bass" | "drums" | "ambience";
/** Live output level per channel, 0–1 (UI scales to taste). */
export type ChannelLevels = Record<ChannelId, number>;

export interface NightdriftEngine {
  ctx: AudioContext;
  /** Attach to a hidden <audio> element for mobile background playback. */
  playbackStream: MediaStream;
  start(volDb: number): void;
  setVolume(db: number, secs?: number): void;
  fadeOut(secs: number): void;
  setCrackle(on: boolean): void;
  /** Steers the drift: the engine segues to a scene in this family at the next chord boundary. */
  setMood(mood: MoodKey): void;
  /** Fallback when MediaStream → <audio> playback is unavailable. */
  connectDirectOutput(): void;
  /** Elapsed fraction of the current scene (0–1), for UI progress rings. */
  getSceneProgress(): number;
  /** Kick-hit envelope (0–1) for the halo center pulse. */
  getKickPulse(): number;
  /** Live per-channel levels, for the animated band on the home screen. */
  getChannelLevels(): ChannelLevels;
  dispose(): void;
}

export function createEngine(config: EngineConfig): NightdriftEngine {
  const ctx = new AudioContext();

  // shared noise buffer
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  {
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // ---- graph ----
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  const playbackStream = ctx.createMediaStreamDestination();
  master.connect(playbackStream);

  const mixDynamics = createMixDynamics(ctx);
  const melodicSpread = createStereoSpread(ctx, 0.24);
  mixDynamics.mix.connect(melodicSpread.input);
  melodicSpread.output.connect(master);

  const sceneReverb = createSceneReverb(ctx, mixDynamics.mix);

  // everything melodic goes through tape → compression → sidechain duck
  const tape = ctx.createBiquadFilter();
  tape.type = "lowpass";
  tape.frequency.value = 3200;
  tape.connect(mixDynamics.input);
  tape.connect(sceneReverb.input);

  // drums get their own bus so segues and dropouts can fade them smoothly
  const drums = ctx.createGain();
  drums.gain.value = 1;
  const drumSpread = createStereoSpread(ctx, 0.14);
  const drumOut = createDrumDynamics(ctx, master);
  drums.connect(drumSpread.input);
  drumSpread.output.connect(drumOut);

  // sub-bass undertone — quiet enough for the main mix to breathe around
  const undertone = ctx.createGain();
  undertone.gain.value = 1;
  const undertoneLp = ctx.createBiquadFilter();
  undertoneLp.type = "lowpass";
  undertoneLp.frequency.value = 200;
  undertone.connect(undertoneLp).connect(master);

  // slow tape-wobble LFO feeding oscillator detune (in cents)
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 0.55;
  const wobbleAmt = ctx.createGain();
  wobbleAmt.gain.value = 7; // cents
  wobble.connect(wobbleAmt);
  wobble.start();

  // vinyl hiss (looped noise, highpassed, very quiet)
  const hissSrc = ctx.createBufferSource();
  hissSrc.buffer = noiseBuf;
  hissSrc.loop = true;
  const hissHp = ctx.createBiquadFilter();
  hissHp.type = "highpass";
  hissHp.frequency.value = 1800;
  const hissGain = ctx.createGain();
  hissGain.gain.value = config.crackle ? 0.012 : 0;
  hissSrc.connect(hissHp).connect(hissGain).connect(master);
  hissSrc.start();

  const pops = ctx.createGain();
  pops.gain.value = config.crackle ? 1 : 0;
  pops.connect(master);

  // the weather outside the song (rain, wind, city, fire — see ambience.ts)
  const ambienceBus = ctx.createGain();
  const ambienceSpread = createStereoSpread(ctx, 0.3);
  ambienceBus.connect(ambienceSpread.input);
  ambienceSpread.output.connect(master);
  const ambience = createAmbience(ctx, ambienceBus, noiseBuf);

  // each band role gets its own bus into the tape so the UI can meter who
  // is playing right now (chords vs melody vs bass)
  const chordBus = ctx.createGain();
  const melodyBus = ctx.createGain();
  const bassBus = ctx.createGain();
  const chordPan = ctx.createStereoPanner();
  chordPan.pan.value = -0.13;
  const melodyPan = ctx.createStereoPanner();
  melodyPan.pan.value = 0.17;
  const bassPan = ctx.createStereoPanner();
  bassPan.pan.value = -0.04;
  chordBus.connect(chordPan).connect(tape);
  melodyBus.connect(melodyPan).connect(tape);
  bassBus.connect(bassPan).connect(tape);

  const sharedBuses = {
    ctx, drums, undertone, master, reverb: sceneReverb.input, pops, noiseBuf, wobbleAmt,
  };
  const voices = createVoices({ ...sharedBuses, tape });
  const chordVoices = createVoices({ ...sharedBuses, tape: chordBus });
  const melodyVoices = createVoices({ ...sharedBuses, tape: melodyBus });
  const bassVoices = createVoices({ ...sharedBuses, tape: bassBus });

  // ---- channel meters ----
  function makeMeter(node: AudioNode): AnalyserNode {
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.55;
    node.connect(an);
    return an;
  }
  const meters: Record<ChannelId, AnalyserNode> = {
    chords: makeMeter(chordBus),
    melody: makeMeter(melodyBus),
    bass: makeMeter(bassBus),
    drums: makeMeter(drums),
    ambience: makeMeter(ambienceBus),
  };
  // per-channel sensitivity so quiet roles still register on the meter
  const METER_GAIN: Record<ChannelId, number> = {
    chords: 6, melody: 13, bass: 8, drums: 6, ambience: 16,
  };
  const meterBuf = new Float32Array(512);

  // ---- voice dispatch ----
  type NotePlayer = (note: string, t: number, dur: number, vel: number) => void;

  /** Synthetic / pad timbres sit lower so drums and bass keep the pocket. */
  const SYNTHY_CHORD_GAIN: Partial<Record<ChordVoice, number>> = {
    synth: 0.5,
    fmep: 0.68,
    strings: 0.62,
    organ: 0.7,
    choir: 0.65,
    wurli: 0.75,
    clav: 0.7,
    celeste: 0.6,
  };
  const SYNTHY_MELODY_GAIN: Partial<Record<MelodyVoice, number>> = {
    synth: 0.48,
    fmep: 0.7,
    strings: 0.65,
    organ: 0.72,
    choir: 0.68,
    wurli: 0.78,
    clav: 0.72,
    celeste: 0.62,
  };

  function chordVelScale(voice: ChordVoice = scene.band.chordVoice): number {
    let s = SYNTHY_CHORD_GAIN[voice] ?? 1;
    if (voice === "horn") s *= 0.55;
    return s;
  }

  const chordPlayers: Record<ChordVoice, NotePlayer> = {
    ep: chordVoices.playKey,
    fmep: chordVoices.playFmKey,
    organ: chordVoices.playOrgan,
    guitar: chordVoices.playGuitar,
    vibe: chordVoices.playVibe,
    strings: chordVoices.playStrings,
    pluck: chordVoices.playPluck,
    marimba: chordVoices.playMarimba,
    choir: chordVoices.playChoir,
    horn: (note, t, dur, vel) => chordVoices.playHorn(note, t, dur, vel * 0.7),
    wurli: chordVoices.playWurli,
    clav: chordVoices.playClav,
    harp: chordVoices.playHarp,
    piano: chordVoices.playPiano,
    accordion: chordVoices.playAccordion,
    cello: chordVoices.playCello,
    flute: chordVoices.playFlute,
    celeste: chordVoices.playCeleste,
    synth: chordVoices.playSynth,
    oboe: chordVoices.playOboe,
  };

  const melodyPlayers: Record<MelodyVoice, NotePlayer> = {
    ep: melodyVoices.playKey,
    fmep: melodyVoices.playFmKey,
    pluck: melodyVoices.playPluck,
    guitar: melodyVoices.playGuitar,
    vibe: melodyVoices.playVibe,
    bell: (note, t, _dur, vel) => melodyVoices.playBell(note, t, vel * 0.7),
    clarinet: melodyVoices.playClarinet,
    horn: (note, t, dur, vel) => melodyVoices.playHorn(note, t, dur, vel * 0.7),
    marimba: melodyVoices.playMarimba,
    choir: melodyVoices.playChoir,
    organ: melodyVoices.playOrgan,
    strings: melodyVoices.playStrings,
    wurli: melodyVoices.playWurli,
    clav: melodyVoices.playClav,
    harp: melodyVoices.playHarp,
    piano: melodyVoices.playPiano,
    cello: melodyVoices.playCello,
    flute: melodyVoices.playFlute,
    celeste: melodyVoices.playCeleste,
    synth: melodyVoices.playSynth,
    oboe: (note, t, dur, vel) => melodyVoices.playOboe(note, t, dur, vel * 0.75),
  };

  const bassPlayers: Record<BassVoice, NotePlayer | null> = {
    sine: bassVoices.playBass,
    pluck: bassVoices.playPluckBass,
    bassGuitar: bassVoices.playBassGuitar,
    none: null,
  };

  const pulsePlayers: Record<PulseVoice, (t: number, vel: number) => void> = {
    hat: voices.playHat,
    shaker: voices.playShaker,
    brush: (t, vel) => voices.playBrush(t, vel),
  };

  // accented/unaccented pulse velocities per instrument
  const PULSE_VELS: Record<PulseVoice, [number, number]> = {
    hat: [0.5, 0.32],
    shaker: [0.6, 0.4],
    brush: [0.45, 0.3],
  };

  // ---- scene state ----
  /** Where the theme lives in the scale — melody fills wander from here. */
  function motifAnchor(s: Scene): number {
    return Math.round(
      s.motif.reduce((sum, n) => sum + n.scaleIdx, 0) / Math.max(1, s.motif.length),
    );
  }

  let scene = makeScene(config.mood);
  let fillIdx = motifAnchor(scene);
  let pendingMood: MoodKey | null = null;
  let step = 0;
  let chordIdx = -1;
  let round = 0;
  let drumsOnForChord = false;
  let outroStarted = false;
  let lastEventAt = -Infinity;
  let nextTime = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let lookaheadSecs = document.hidden ? LOOKAHEAD_HIDDEN_SECS : LOOKAHEAD_VISIBLE_SECS;
  let directOutput = false;
  let sceneStartedAt = 0;
  const kickHits: { time: number; strength: number }[] = [];
  const h = () => (Math.random() - 0.5) * 0.012; // humanize

  function triggerKickPulse(time: number, strength: number) {
    kickHits.push({ time, strength: Math.min(1, strength * 1.6) });
  }

  function getKickPulse(): number {
    const now = ctx.currentTime;
    let pulse = 0;
    let write = 0;
    for (let i = 0; i < kickHits.length; i++) {
      const hit = kickHits[i];
      const age = now - hit.time;
      if (age > 0.45) continue;
      if (age >= 0) {
        pulse = Math.max(pulse, hit.strength * Math.exp(-age / 0.08));
      }
      kickHits[write++] = hit;
    }
    kickHits.length = write;
    return Math.min(1, pulse);
  }

  function onVisibilityChange() {
    if (ctx.state === "suspended") void ctx.resume();
    lookaheadSecs = document.hidden ? LOOKAHEAD_HIDDEN_SECS : LOOKAHEAD_VISIBLE_SECS;
    if (document.hidden) tick();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  /** Morph the tape character and ambience bed toward a scene's palette. */
  function applyAtmosphere(s: Scene, t: number, fast = false) {
    const tc = fast ? 0.5 : 2.5;
    tape.frequency.setTargetAtTime(s.tapeCutoff, t, tc);
    wobbleAmt.gain.setTargetAtTime(s.wobbleCents, t, tc);
    wobble.frequency.setTargetAtTime(s.wobbleRate, t, tc);
    sceneReverb.set(
      { send: s.reverbSend, decay: s.reverbDecay, damp: s.reverbDamp },
      t,
      fast,
    );
    ambience.set(s.ambience, t, fast);
  }

  /** The seamless segue: swap scenes at a chord boundary. */
  function beginScene(next: Scene, t: number) {
    scene = next;
    fillIdx = motifAnchor(next);
    sceneStartedAt = t;
    kickHits.length = 0;
    round = 0;
    outroStarted = false;
    applyAtmosphere(next, t);
    drums.gain.cancelScheduledValues(t);
    drums.gain.setValueAtTime(Math.max(drums.gain.value, 0.05), t);
    drums.gain.linearRampToValueAtTime(1, t + 3);
    if (chance(0.5)) voices.playNeedleDrop(t + 0.2);
    config.onSceneChange?.(summarize(next));
  }

  /**
   * Energy arc across the scene: beatless intro round, grooving middle
   * rounds (alternating A/B intensity), thinning outro round.
   */
  function energyFor(r: number, c: number): number {
    if (r === 0) return [0.15, 0.3, 0.5, 0.6][c];
    if (r === scene.rounds - 1) return [0.6, 0.6, 0.45, 0.25][c];
    return r % 2 === 1 ? 1 : 0.85;
  }

  function playMelodyNote(note: string, t: number, dur: number, vel: number) {
    const scale = SYNTHY_MELODY_GAIN[scene.band.melodyVoice] ?? 1;
    melodyPlayers[scene.band.melodyVoice](note, t, dur, vel * scale);
  }

  /** Nudge a scale degree onto a chord tone, for the notes that anchor a phrase. */
  function snapToChordTone(idx: number, chord: Chord): number {
    const pcs = new Set(chord.notes.map((n) => midiFromNote(n) % 12));
    pcs.add(chord.rootMidi % 12);
    for (const cand of [idx, idx - 1, idx + 1]) {
      if (cand < 0 || cand >= scene.scale.length) continue;
      if (pcs.has(midiFromNote(scene.scale[cand]) % 12)) return cand;
    }
    return idx;
  }

  /** Transform and humanize a stored phrase for this chord. */
  function playPhrase(
    t: number,
    sixteenth: number,
    notes: MotifNote[],
    variation: MotifVariation,
    velScale: number,
    chord: Chord,
  ) {
    const beatLen = sixteenth * 4;
    const varied = varyPhrase(notes, variation, scene.melodyPlan.answerShift);
    if (varied.length === 0) return;
    const firstStep = Math.min(...varied.map((n) => n.step));
    for (const n of varied) {
      let idx = Math.max(0, Math.min(scene.scale.length - 1, n.scaleIdx));
      if (n.step === firstStep || n.beats >= 1.25) idx = snapToChordTone(idx, chord);
      const swing = n.step % 2 === 1 ? sixteenth * scene.swing * 0.5 : 0;
      const pickup = n.pickup ? -sixteenth * 0.12 : 0;
      const layback = n.accent ? sixteenth * 0.08 : 0;
      const at = t + n.step * sixteenth + swing + pickup + layback + h();
      const vel = n.vel * velScale * (n.accent ? 1.12 : 0.94);
      playMelodyNote(scene.scale[idx], at, n.beats * beatLen, vel);
    }
  }

  /** How the band's chord player states this chord (its comping style). */
  function scheduleComping(t: number, sixteenth: number, energy: number, chord: Chord) {
    const beatLen = sixteenth * 4;
    const chordDur = beatLen * 8;
    const play = chordPlayers[scene.band.chordVoice];
    const baseVel =
      (0.18 + Math.random() * 0.05) * (0.7 + 0.3 * energy) * chordVelScale();

    switch (scene.band.comping) {
      case "rolled":
        // the chord rolled like a hand voicing, left to ring
        chord.notes.forEach((n, i) => {
          play(n, t + i * 0.035 + Math.random() * 0.02, beatLen * 7, baseVel);
        });
        break;

      case "sustained": {
        // organ/strings/choir/accordion/cello: hold the whole chord across both bars
        const softSustain =
          scene.band.chordVoice === "organ"
          || scene.band.chordVoice === "choir"
          || scene.band.chordVoice === "accordion"
          || scene.band.chordVoice === "cello"
          || scene.band.chordVoice === "strings";
        const susVel = baseVel * (softSustain ? 0.38 : 0.45);
        chord.notes.forEach((n, i) => {
          play(n, t + i * 0.01, chordDur * 0.96, susVel);
        });
        // gentle mid-chord breath so sustained pads don't sit perfectly still
        if (energy >= 0.35 && chance(0.55)) {
          const breathVel = susVel * 0.28;
          chord.notes.forEach((n, i) => {
            play(n, t + beatLen * 4 + i * 0.015 + h(), beatLen * 3.6, breathVel);
          });
        }
        // second breath in bar two for thicker movement
        if (energy >= 0.55 && chance(0.4)) {
          const echoVel = susVel * 0.2;
          chord.notes.slice(1).forEach((n, i) => {
            play(n, t + beatLen * 6 + i * 0.02 + h(), beatLen * 2.4, echoVel);
          });
        }
        break;
      }

      case "stabs": {
        // short syncopated hits; busier when the groove is up
        const hits = energy >= 0.7 ? [0, 6, 16, 22] : [0, 16];
        for (const s of hits) {
          const vel = baseVel * (s === 0 ? 1 : 0.7);
          chord.notes.forEach((n, i) => {
            play(n, t + s * sixteenth + i * 0.012 + h(), beatLen * 0.9, vel);
          });
        }
        break;
      }

      case "arp": {
        // harp-like upward sweep, sometimes echoed quieter in bar two
        chord.notes.forEach((n, i) => {
          play(n, t + i * sixteenth * 2 + h(), beatLen * 3, baseVel * 0.8);
        });
        if (energy >= 0.6 && chance(0.5)) {
          chord.notes.slice(1).forEach((n, i) => {
            play(n, t + (16 + i * 2) * sixteenth + h(), beatLen * 2.5, baseVel * 0.45);
          });
        }
        break;
      }

      case "broken": {
        // fingerpicked: low note first, then a gentle cycle across both bars
        const order = [0, 2, 1, 3, 2, 1, 2, 3];
        const at = [0, 4, 6, 10, 16, 20, 22, 26];
        at.forEach((s, i) => {
          if (s > 0 && !chance(0.85)) return;
          const n = chord.notes[order[i] % chord.notes.length];
          const vel = baseVel * (s === 0 ? 0.9 : 0.55 + Math.random() * 0.15);
          play(n, t + s * sixteenth + h(), beatLen * 1.6, vel);
        });
        break;
      }
    }
  }

  /** The melody instrument's statement for this chord, per band behavior. */
  function scheduleMelody(t: number, sixteenth: number, energy: number, chord: Chord) {
    if (energy < 0.4) return;
    const beatLen = sixteenth * 4;
    const behavior = scene.band.melodyBehavior;
    const plan = scene.melodyPlan;

    if (behavior === "motif") {
      const outro = round === scene.rounds - 1;

      // intro round: just a whisper of the hook before the band settles in
      if (round === 0) {
        if (chordIdx === 2 && chance(0.55)) {
          playPhrase(t, sixteenth, plan.phrases.A, "fragment", 0.65, chord);
        }
        return;
      }

      const slot = plan.slots[chordIdx];
      if (!slot) return;

      // middle rounds layer a variation cycle on top of the song structure
      let variation = slot.variation;
      if (!outro && chordIdx === 0 && round > 0) {
        variation = plan.roundCycle[(round - 1) % plan.roundCycle.length];
      }
      if (outro) variation = "fragment";

      const presence = slot.presence * (outro ? 0.75 : 0.88 + 0.12 * energy);
      if (!chance(presence)) return;

      const phrase = plan.phrases[slot.phraseId];
      const velScale = outro ? 0.72 : 0.92 + 0.08 * energy;
      playPhrase(t, sixteenth, phrase, variation, velScale, chord);
    } else if (behavior === "arp" && chance(0.55)) {
      // a gentle run through the scale in bar two
      let dir = chance(0.5) ? 1 : -1;
      let idx = dir === 1 ? randInt(0, 2) : scene.scale.length - 1 - randInt(0, 2);
      const count = randInt(4, 5);
      for (let i = 0; i < count; i++) {
        const note = scene.scale[Math.max(0, Math.min(scene.scale.length - 1, idx))];
        playMelodyNote(
          note,
          t + (16 + i * 2) * sixteenth + 0.02 + h(),
          beatLen * 1.1,
          0.05 + Math.random() * 0.03,
        );
        idx += dir;
        if (idx <= 0 || idx >= scene.scale.length - 1) dir = -dir;
      }
    } else if (behavior === "held" && chordIdx % 2 === 0 && chance(0.75)) {
      // one long note floating over the whole chord
      const idx = randInt(Math.floor(scene.scale.length / 2), scene.scale.length - 1);
      playMelodyNote(scene.scale[idx], t + 0.05, beatLen * 7, 0.06);
    }
    // "sparse": no structured statement — the free notes below do the talking
  }

  /** Once in a long while, something small and surprising drifts past. */
  function maybePlayEvent(t: number) {
    if (t - lastEventAt < EVENT_COOLDOWN_SECS || !chance(0.3)) return;
    lastEventAt = t;
    const bed = scene.ambience.bed;
    if (bed === "rain" && chance(0.6)) {
      voices.playThunder(t + Math.random() * 4);
    } else if (bed === "city" && chance(0.3)) {
      voices.playTrainHorn(t + Math.random() * 3);
    } else if ((bed === "wind" || bed === "fire") && chance(0.55)) {
      if (chance(0.5)) voices.playOwl(t + Math.random() * 2);
      else voices.playChimes(scene.scale, t + Math.random() * 2);
    } else if (scene.family === "mellow" && chance(0.5)) {
      voices.playCrickets(t + Math.random() * 2);
    } else {
      // a music box remembers the motif, slowly, from another room
      let bellT = t + 0.5;
      for (const n of scene.motif) {
        const idx = Math.max(0, Math.min(scene.scale.length - 1, n.scaleIdx));
        voices.playBell(scene.scale[idx], bellT, 0.045);
        bellT += 0.7 + Math.random() * 0.4;
      }
    }
  }

  /** Soft upper-voice doubling — complementary timbre, octave up for cohesion. */
  function scheduleHarmony(
    t: number,
    energy: number,
    chord: Chord,
    chordDur: number,
  ) {
    const harmony = scene.band.harmonyVoice;
    if (!harmony || harmony === scene.band.chordVoice || energy < 0.45) return;
    const p = (scene.band.harmonyChance ?? 0.55) * (0.65 + 0.35 * energy);
    if (!chance(p)) return;
    const play = chordPlayers[harmony];
    const vel = (0.07 + Math.random() * 0.04) * (0.55 + 0.45 * energy) * chordVelScale(harmony);
    chord.notes.slice(1).forEach((n, i) => {
      play(
        noteFromMidi(midiFromNote(n) + 12),
        t + i * 0.025 + h(),
        chordDur * 0.9,
        vel,
      );
    });
  }

  function scheduleChordStart(t: number, sixteenth: number, energy: number) {
    const beatLen = sixteenth * 4;
    const chordDur = beatLen * 8; // two bars
    const chord = scene.progression[chordIdx];

    scheduleComping(t, sixteenth, energy, chord);
    scheduleHarmony(t, energy, chord, chordDur);

    // warm pad swell underneath (meters with the chords)
    if (scene.padOn && energy >= 0.45) {
      const padNotes = [12, 19, 26].map((iv) => noteFromMidi(chord.rootMidi + iv));
      chordVoices.playPad(padNotes, t, chordDur, 0.02 + 0.016 * energy);
    }

    // quiet sub undertone — drifts root → fifth, stays under the main voices
    if (energy >= 0.2) {
      voices.playUndertone(
        chord.root,
        noteFromMidi(chord.rootMidi + 7),
        t,
        chordDur,
        0.028 + 0.014 * energy,
      );
    }

    scheduleMelody(t, sixteenth, energy, chord);
  }

  /** MIDI note a riff degree resolves to against the current (and next) chord. */
  function riffMidi(deg: RiffDeg, chord: Chord, next: Chord): number {
    switch (deg) {
      case "root": return chord.rootMidi;
      case "third": return chord.rootMidi + chord.thirdIv;
      case "fifth": return chord.rootMidi + 7;
      case "octave": return chord.rootMidi + 12;
      case "approach": return next.rootMidi + (chance(0.6) ? -1 : 2);
    }
  }

  function scheduleStep(t: number) {
    const sixteenth = 60 / scene.bpm / 4;
    const beatLen = sixteenth * 4;

    if (step === 0) {
      chordIdx++;
      if (chordIdx >= CHORDS_PER_ROUND) {
        chordIdx = 0;
        round++;
      }

      // segue time? (scene ran its course, or the listener steered the mood)
      if (round >= scene.rounds || (pendingMood && pendingMood !== scene.family)) {
        const next = makeScene(pendingMood ?? scene.family, scene);
        pendingMood = null;
        chordIdx = 0;
        beginScene(next, t);
      }

      const energy = energyFor(round, chordIdx);

      // outro: let the drums dissolve under the final chord
      if (round === scene.rounds - 1 && chordIdx === CHORDS_PER_ROUND - 1 && !outroStarted) {
        outroStarted = true;
        drums.gain.cancelScheduledValues(t);
        drums.gain.setValueAtTime(drums.gain.value, t);
        drums.gain.linearRampToValueAtTime(0.08, t + beatLen * 7);
      }

      // classic lofi dropout: occasionally a mid-scene chord goes beatless
      drumsOnForChord = energy >= 0.5 && !(chance(0.12) && round > 0);

      scheduleChordStart(t, sixteenth, energy);
      if (chordIdx === 0 && round > 0 && round < scene.rounds - 1) maybePlayEvent(t);
    }

    const energy = energyFor(round, chordIdx);
    const chord = scene.progression[Math.max(0, chordIdx)];
    const nextChord = scene.progression[(chordIdx + 1) % CHORDS_PER_ROUND];

    // soft mid-cycle re-stab (only suits the rolled style)
    if (scene.band.comping === "rolled" && step === 12 && energy >= 0.5 && chance(0.55)) {
      const play = chordPlayers[scene.band.chordVoice];
      chord.notes.slice(1).forEach((n, i) => {
        play(n, t + i * 0.025 + h(), beatLen * 1.5, 0.09 * chordVelScale());
      });
    }

    // ---- bass ----
    const playBass = bassPlayers[scene.band.bassVoice];
    if (playBass) {
      const bVel = Math.min(1, 0.4 + 0.6 * energy);
      const duckBass = (note: string, at: number, dur: number, vel: number, depth = 0.87) => {
        playBass(note, at, dur, vel);
        mixDynamics.triggerDuck(at, depth, 0.12);
      };
      if (scene.bassStyle === "groove") {
        // the scene's two-bar riff, repeated under every chord — quieter
        // notes drop out when the groove is down, anchors always play
        for (const rn of scene.bassRiff) {
          if (rn.step !== step) continue;
          if (rn.vel < 0.85 && energy < 0.5) continue;
          if (rn.vel < 0.45 && energy < 0.85) continue;
          const midi = riffMidi(rn.deg, chord, nextChord);
          duckBass(noteFromMidi(midi), t + h(), beatLen * rn.beats, 0.3 * rn.vel * bVel, 0.92);
        }
      } else if (scene.bassStyle === "anchor") {
        if (step === 0) duckBass(chord.root, t + h(), beatLen * 1.8, 0.32 * bVel);
        if (step === 10 && chance(0.7)) duckBass(chord.root, t + h(), beatLen * 0.7, 0.22 * bVel);
        if (step === 16) duckBass(chord.root, t + h(), beatLen * 1.4, 0.3 * bVel);
        if (step === 26 && chance(0.5)) {
          duckBass(noteFromMidi(chord.rootMidi + 7), t + h(), beatLen * 0.7, 0.18 * bVel);
        }
      } else {
        // walking-ish: fifths and a passing tone that leans into the next chord
        if (step === 0) duckBass(chord.root, t + h(), beatLen * 1.6, 0.32 * bVel);
        if (step === 8 && chance(0.5)) duckBass(chord.root, t + h(), beatLen * 0.6, 0.2 * bVel);
        if (step === 16) duckBass(noteFromMidi(chord.rootMidi + 7), t + h(), beatLen, 0.26 * bVel);
        if (step === 22 && chance(0.6)) duckBass(chord.root, t + h(), beatLen * 0.6, 0.2 * bVel);
        if (step === 28 && chance(0.5) && energy >= 0.5) {
          const approach = noteFromMidi(nextChord.rootMidi - (chance(0.5) ? 1 : 2));
          duckBass(approach, t + h(), beatLen * 0.5, 0.18 * bVel);
        }
      }
    }

    // ---- drums (driven by the band's kit grammar) ----
    if (drumsOnForChord) {
      const kit = KITS[scene.band.kit];
      const dVel = 0.6 + 0.4 * energy;

      if (kit.kicks.includes(step)) {
        const kickT = t + h();
        const vel = 0.5 * dVel * kit.kickVel;
        voices.playKick(kickT, vel);
        triggerKickPulse(kickT, vel);
        mixDynamics.triggerDuck(kickT, 0.74, 0.22);
      } else if (kit.kickGhosts?.steps.includes(step) && chance(kit.kickGhosts.p * energy)) {
        const kickT = t + h();
        const vel = 0.25 * kit.kickVel;
        voices.playKick(kickT, vel);
        triggerKickPulse(kickT, vel * 0.65);
        mixDynamics.triggerDuck(kickT, 0.82, 0.14);
      }

      if (kit.backbeat) {
        const bb = kit.backbeat;
        const hit = (vel: number) => {
          if (bb.voice === "snare") voices.playSnare(t + h(), vel);
          else if (bb.voice === "rim") voices.playRim(t + h(), vel);
          else voices.playBrush(t + h(), vel, true);
        };
        if (bb.steps.includes(step)) hit(0.45 * dVel);
        else if (bb.ghosts?.steps.includes(step) && chance(bb.ghosts.p * energy)) hit(0.14);
      }

      if (kit.pulse && step % kit.pulse.every === 0 && chance(kit.pulse.p)) {
        const voice = scene.band.pulseVoice ?? kit.pulse.voice;
        const accent = step % kit.pulse.accentEvery === kit.pulse.accentEvery / 2;
        const [hi, lo] = PULSE_VELS[voice];
        pulsePlayers[voice](t + h(), (accent ? hi : lo) * dVel);
      }
      if (kit.offbeat && step % 4 === 3 && chance(kit.offbeat.p * energy)) {
        pulsePlayers[kit.offbeat.voice](t + h(), 0.2);
      }

      // little fill at the end of a round
      if (kit.fills && chordIdx === CHORDS_PER_ROUND - 1 && energy >= 0.7) {
        if (step === 30 && chance(0.25)) {
          voices.playSnare(t + h(), 0.12);
          voices.playHat(t + sixteenth * 0.5, 0.2);
        }
      }
    }

    // melody fills, behind the beat: short stepwise gestures that wander
    // from where the theme lives and lean on chord tones — a player
    // noodling along with the song, not random notes from the scale.
    // Motif/arp bands keep fills out of the theme's chords (1 and 3).
    const behavior = scene.band.melodyBehavior;
    const freeChance = behavior === "sparse" ? 0.2 : behavior === "held" ? 0.04 : 0.1;
    const inGap = behavior === "sparse" || behavior === "held" || chordIdx % 2 === 1;
    if (inGap && step % 2 === 0 && step !== 0 && step <= 26 && chance(freeChance * energy)) {
      const wander = Math.max(
        1,
        Math.min(scene.scale.length - 2, fillIdx + pick([-2, -1, -1, 1, 1, 2])),
      );
      let idx = snapToChordTone(wander, chord);
      const count = chance(0.35) ? 2 : 1;
      for (let i = 0; i < count; i++) {
        playMelodyNote(
          scene.scale[idx],
          t + i * sixteenth * 2 + 0.03 + h(),
          beatLen * (i === count - 1 ? 1.3 : 0.7),
          0.055 + Math.random() * 0.03,
        );
        if (i < count - 1) {
          idx = Math.max(0, Math.min(scene.scale.length - 1, idx + pick([-1, 1])));
        }
      }
      fillIdx = idx;
    }

    // per-bed ambience grain (fire crackles)
    ambience.sparkle(t);

    // vinyl pops (inaudible when the pops bus is muted)
    if (chance(0.12)) voices.playPop(t + Math.random() * 0.1, 0.5 + Math.random() * 0.5);
  }

  function tick() {
    const sixteenth = 60 / scene.bpm / 4;
    while (nextTime < ctx.currentTime + lookaheadSecs) {
      // swing: push every odd 16th late
      const swung = nextTime + (step % 2 === 1 ? sixteenth * scene.swing * 0.5 : 0);
      scheduleStep(swung);
      nextTime += sixteenth;
      step = (step + 1) % STEPS;
    }
  }

  return {
    ctx,
    playbackStream: playbackStream.stream,
    start(volDb) {
      step = 0; chordIdx = -1; round = 0; outroStarted = false;
      kickHits.length = 0;
      nextTime = ctx.currentTime + 0.1;
      sceneStartedAt = nextTime;
      applyAtmosphere(scene, ctx.currentTime, true);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(dbToGain(volDb), ctx.currentTime + 4);
      timerId = setInterval(tick, TICK_MS);
      config.onSceneChange?.(summarize(scene));
    },
    setVolume(db, secs = 0.4) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(dbToGain(db), ctx.currentTime + secs);
    },
    fadeOut(secs) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + secs);
    },
    setCrackle(on) {
      const t = ctx.currentTime;
      hissGain.gain.cancelScheduledValues(t);
      hissGain.gain.setTargetAtTime(on ? 0.012 : 0, t, 0.4);
      pops.gain.setTargetAtTime(on ? 1 : 0, t, 0.4);
    },
    setMood(mood) {
      if (mood === scene.family) {
        pendingMood = null;
        return;
      }
      pendingMood = mood;
      // start easing the drums down now; the segue lands at the next chord boundary
      const t = ctx.currentTime;
      drums.gain.cancelScheduledValues(t);
      drums.gain.setTargetAtTime(0.15, t, 1.5);
    },
    connectDirectOutput() {
      if (directOutput) return;
      master.connect(ctx.destination);
      directOutput = true;
    },
    getSceneProgress() {
      const dur = sceneDurationSecs(scene.rounds, scene.bpm);
      if (dur <= 0) return 0;
      return Math.min(1, Math.max(0, (ctx.currentTime - sceneStartedAt) / dur));
    },
    getKickPulse,
    getChannelLevels() {
      const out = {} as ChannelLevels;
      for (const id of Object.keys(meters) as ChannelId[]) {
        meters[id].getFloatTimeDomainData(meterBuf);
        let sum = 0;
        for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i] * meterBuf[i];
        const rms = Math.sqrt(sum / meterBuf.length);
        out[id] = Math.max(0, Math.min(1, rms * METER_GAIN[id]));
      }
      return out;
    },
    dispose() {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerId) clearInterval(timerId);
      timerId = null;
      try { ctx.close(); } catch { /* already closed */ }
    },
  };
}
