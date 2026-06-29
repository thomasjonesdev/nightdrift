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
import { createDrumDynamics, createMixDynamics, makeSaturationCurve, triggerSaturationBurst } from "./dynamics";
import { createSceneReverb } from "./reverb";
import { createTempoDelay } from "./delay";
import {
  type BassVoice,
  type ChordVoice,
  type MelodyVoice,
  type PulseVoice,
} from "./bands";
import {
  bassMelodyLock,
  resolveBassMidi,
} from "./bass-line-plan";
import { sceneEnergy } from "./drift-algorithm";
import {
  createPhraseLedger,
  planCohesiveFill,
  shouldAttemptFill,
  updatePhraseLedger,
  type PhraseLedger,
} from "./melody-fills";
import {
  bassSkipGhost,
  presenceForSlot,
  shouldPlayMelodySlot,
  variationForSlot,
} from "./round-form";
import {
  energyAutomation,
  evolveForRound,
  initSceneEvolution,
} from "./drift-evolution";
import type { MoodKey } from "./moods";
import { MOOD_PROFILES } from "./mood-profile";
import {
  compPianoNote,
  compPianoVelMul,
  DEFAULT_CHORD_PAN,
  DEFAULT_MELODY_PAN,
  dualPianoLayout,
  dualPianoPan,
  melodyPianoNote,
  melodyPianoVelMul,
} from "./dual-piano";
import { melodyNoteForChord } from "./harmonic-binding";
import { varyPhrase } from "./melodies";
import type { PhraseId } from "./melodies";
import { dbToGain, midiFromNote, noteFromMidi } from "./notes";
import { createRng, type Rng } from "./random";
import { textureNotesForChord } from "./texture-plan";
import {
  ambientEventDue,
  bridgeBpm,
  createEventScheduleState,
  createRadioState,
  markAmbientEvent,
  pickAmbientEventKind,
  recordScene,
  resolveSegueFamily,
  SEGUE_BRIDGE_STEPS,
  type EventScheduleState,
  type RadioState,
} from "./radio-director";
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
import { soothingPadNotes } from "./pad-voicing";
import { createStereoSpread } from "./stereo";
import { createSampleLibrary } from "./sample-library";
import { createVoices } from "./voices";

export const STEPS = 32;             // two bars of 16ths = one chord
export const CHORDS_PER_ROUND = 4;   // one round = a full pass through the progression

export function sceneDurationSecs(rounds: number, bpm: number): number {
  return rounds * CHORDS_PER_ROUND * STEPS * (60 / bpm / 4);
}
const LOOKAHEAD_VISIBLE_SECS = 0.15;
const LOOKAHEAD_HIDDEN_SECS = 45;
const TICK_MS = 30;
/** XOR salt so playback RNG is independent of scene-generation forks. */
const PLAYBACK_SALT = 0xca7cafe;

export interface EngineConfig {
  mood: MoodKey;
  crackle: boolean;
  /** Master seed — same value reproduces the same scene sequence. */
  seed?: number;
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
  const tempoDelay = createTempoDelay(ctx);

  // everything melodic goes through tape → soft saturation → tempo delay → compression
  const tape = ctx.createBiquadFilter();
  tape.type = "lowpass";
  tape.frequency.value = 3200;
  const tapeDrive = ctx.createGain();
  tapeDrive.gain.value = 1;
  const tapeShaper = ctx.createWaveShaper();
  tapeShaper.curve = makeSaturationCurve(0.1) as Float32Array<ArrayBuffer>;
  tape.connect(tapeDrive).connect(tapeShaper).connect(tempoDelay.input);
  tempoDelay.output.connect(mixDynamics.input);
  tapeShaper.connect(sceneReverb.input);

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
  const textureBus = ctx.createGain();
  textureBus.gain.value = MOOD_PROFILES[config.mood].production.textureBusGain;
  const textureDuck = ctx.createGain();
  textureDuck.gain.value = 1;
  const melodyBus = ctx.createGain();
  const bassBus = ctx.createGain();
  const chordPan = ctx.createStereoPanner();
  chordPan.pan.value = -0.13;
  const melodyPan = ctx.createStereoPanner();
  melodyPan.pan.value = 0.17;
  const bassPan = ctx.createStereoPanner();
  bassPan.pan.value = -0.04;
  chordBus.connect(chordPan).connect(tape);
  textureBus.connect(textureDuck).connect(chordPan);
  melodyBus.connect(melodyPan).connect(tape);
  bassBus.connect(bassPan).connect(tape);

  const samples = createSampleLibrary(ctx);
  const sharedBuses = {
    ctx, drums, undertone, master, reverb: sceneReverb.input, pops, noiseBuf, wobbleAmt,
    samples,
  };
  const voices = createVoices({ ...sharedBuses, tape, role: "ambient" });
  const chordVoices = createVoices({ ...sharedBuses, tape: chordBus, role: "chord" });
  const textureVoices = createVoices({ ...sharedBuses, tape: textureBus, role: "chord" });
  const melodyVoices = createVoices({ ...sharedBuses, tape: melodyBus, role: "melody" });
  const bassVoices = createVoices({ ...sharedBuses, tape: bassBus, role: "bass" });

  /** Pads/bed/harmony duck harder than the main mix when kick/snare hit. */
  function triggerTextureDuck(time: number, depth: number, releaseSec: number) {
    textureDuck.gain.cancelScheduledValues(time);
    const now = textureDuck.gain.value;
    textureDuck.gain.setValueAtTime(now, time);
    textureDuck.gain.linearRampToValueAtTime(depth, time + 0.004);
    textureDuck.gain.setTargetAtTime(1, time + 0.004, releaseSec * 0.28);
  }

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
    piano: 1.18,
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
    piano: 1.22,
    synth: 0.48,
    fmep: 0.7,
    strings: 0.65,
    organ: 0.72,
    choir: 0.68,
    wurli: 0.78,
    clav: 0.72,
    celeste: 0.62,
  };
  /** Texture bed sits further back than comping on the chord bus. */
  const TEXTURE_CHORD_GAIN: Partial<Record<ChordVoice, number>> = {
    piano: 0.72,
    synth: 0.42,
    fmep: 0.58,
    strings: 0.52,
    organ: 0.58,
    choir: 0.54,
    wurli: 0.62,
    clav: 0.58,
    celeste: 0.48,
    horn: 0.45,
  };

  function chordVelScale(voice: ChordVoice = scene.band.chordVoice): number {
    let s = SYNTHY_CHORD_GAIN[voice] ?? 1;
    if (voice === "horn") s *= 0.55;
    return s;
  }

  function textureVelScale(voice: ChordVoice): number {
    let s = TEXTURE_CHORD_GAIN[voice] ?? 0.55;
    if (voice === "horn") s *= 0.85;
    return s;
  }

  function makeChordPlayers(v: typeof chordVoices, hornMul: number): Record<ChordVoice, NotePlayer> {
    return {
      ep: v.playKey,
      fmep: v.playFmKey,
      organ: v.playOrgan,
      guitar: v.playGuitar,
      vibe: v.playVibe,
      strings: v.playStrings,
      pluck: v.playPluck,
      marimba: v.playMarimba,
      choir: v.playChoir,
      horn: (note, t, dur, vel) => v.playHorn(note, t, dur, vel * hornMul),
      wurli: v.playWurli,
      clav: v.playClav,
      harp: v.playHarp,
      piano: v.playPiano,
      accordion: v.playAccordion,
      cello: v.playCello,
      flute: v.playFlute,
      celeste: v.playCeleste,
      synth: v.playSynth,
      oboe: v.playOboe,
    };
  }

  const chordPlayers = makeChordPlayers(chordVoices, 0.7);
  const texturePlayers = makeChordPlayers(textureVoices, 0.5);

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
  /** Master RNG — each scene forks a child stream for reproducible generation. */
  const masterRng = createRng(config.seed);
  let sceneSeq = 0;
  const forkSceneRng = (): Rng => masterRng.fork(sceneSeq++);

  /** Where the theme lives in the scale — melody fills wander from here. */
  function motifAnchor(s: Scene): number {
    return Math.round(
      s.motif.reduce((sum, n) => sum + n.scaleIdx, 0) / Math.max(1, s.motif.length),
    );
  }

  let radio: RadioState = createRadioState();
  let scene = makeScene(config.mood, undefined, forkSceneRng(), radio);
  radio = recordScene(radio, scene);
  let phraseLedger: PhraseLedger = createPhraseLedger(motifAnchor(scene));
  let counterMelodyFiredThisChord = false;
  let evolution = initSceneEvolution(scene);
  let playbackRng = createRng((scene.seed ^ PLAYBACK_SALT) >>> 0);
  let eventSchedule: EventScheduleState = createEventScheduleState();
  interface SegueBridge {
    remaining: number;
    nextScene: Scene;
    fromBpm: number;
    toBpm: number;
  }
  let bridge: SegueBridge | null = null;
  let prefetchedScene: Scene | null = null;
  const pb = () => playbackRng;
  const h = () => (pb().next() - 0.5) * scene.dna.timing.humanize * 2;
  const pChance = (p: number) => pb().chance(p);
  const pRand = (min: number, max: number) => pb().rand(min, max);
  const pRandInt = (min: number, max: number) => pb().randInt(min, max);
  const pPick = <T,>(arr: readonly T[]): T => pb().pick(arr);
  const drumAt = (t: number, sixteenth: number) =>
    t + h() + sixteenth * scene.dna.timing.drumLayback;
  let pendingMood: MoodKey | null = null;
  let step = 0;
  let chordIdx = -1;
  let round = 0;
  let drumsOnForChord = false;
  let outroStarted = false;
  let nextTime = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;
  let lookaheadSecs = document.hidden ? LOOKAHEAD_HIDDEN_SECS : LOOKAHEAD_VISIBLE_SECS;
  let directOutput = false;
  let sceneStartedAt = 0;
  const kickHits: { time: number; strength: number }[] = [];

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

  function currentBpm(): number {
    if (bridge) return bridgeBpm(bridge.fromBpm, bridge.toBpm, bridge.remaining);
    return scene.bpm;
  }

  /** Morph atmosphere partway toward the incoming scene during the bridge. */
  function applyBridgeAtmosphere(next: Scene, t: number, progress: number) {
    const tc = 0.8;
    const mix = Math.max(0, Math.min(1, progress));
    tape.frequency.setTargetAtTime(
      scene.tapeCutoff + (next.tapeCutoff - scene.tapeCutoff) * mix,
      t,
      tc,
    );
    sceneReverb.set(
      {
        send: scene.reverbSend + (next.reverbSend - scene.reverbSend) * mix,
        decay: scene.reverbDecay + (next.reverbDecay - scene.reverbDecay) * mix,
        damp: scene.reverbDamp + (next.reverbDamp - scene.reverbDamp) * mix,
      },
      t,
    );
    if (progress >= 0.45) ambience.set(next.ambience, t);
  }

  /** Beatless comping sustain while the station breathes between tracks. */
  function scheduleBridgeComping(t: number, sixteenth: number, chord: Chord, progress: number) {
    const play = chordPlayers[scene.band.chordVoice];
    const beatLen = sixteenth * 4;
    const pianoLayout = dualPianoLayout(scene.band);
    const dualMul =
      pianoLayout && scene.band.chordVoice === "piano"
        ? compPianoVelMul(pianoLayout)
        : 1;
    const vel = 0.1 * (1 - progress * 0.35) * chordVelScale() * dualMul;
    for (const hit of scene.compingPattern.hits) {
      if (hit.step > 8) continue;
      const n = voiceCompNote(chord.notes[hit.voiceIdx % chord.notes.length]);
      play(n, t + hit.step * sixteenth + (hit.micro ?? 0), beatLen * 7, vel * hit.velScale);
    }
  }

  /** Pre-generate and warm the next scene during the outro pass. */
  function maybePrefetchNextScene() {
    if (prefetchedScene || bridge) return;
    if (round !== scene.rounds - 1) return;
    if (chordIdx < CHORDS_PER_ROUND - 2) return;
    const nextFamily = resolveSegueFamily(radio, scene, pendingMood);
    prefetchedScene = makeScene(nextFamily, scene, forkSceneRng(), radio);
    samples.warmForScene(prefetchedScene, "idle");
  }

  let lastSyncedDelayBpm = 0;

  function syncDelayToTempo(t: number) {
    const bpm = currentBpm();
    if (Math.abs(bpm - lastSyncedDelayBpm) < 0.08) return;
    lastSyncedDelayBpm = bpm;
    tempoDelay.setBpm(bpm, t);
  }

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
    tempoDelay.setMix({ wet: s.delayWet, feedback: s.delayFeedback }, t, fast ? 0.5 : 2.5);
    tempoDelay.setBpm(s.bpm, t);
    lastSyncedDelayBpm = s.bpm;
    textureBus.gain.setTargetAtTime(s.textureBusGain, t, fast ? 0.5 : 2.5);
    const pianoLayout = dualPianoLayout(s.band);
    if (pianoLayout) {
      const pan = dualPianoPan(pianoLayout);
      chordPan.pan.setTargetAtTime(pan.chord, t, fast ? 0.5 : 2.5);
      melodyPan.pan.setTargetAtTime(pan.melody, t, fast ? 0.5 : 2.5);
    } else {
      chordPan.pan.setTargetAtTime(DEFAULT_CHORD_PAN, t, fast ? 0.5 : 2.5);
      melodyPan.pan.setTargetAtTime(DEFAULT_MELODY_PAN, t, fast ? 0.5 : 2.5);
    }
    ambience.set(s.ambience, t, fast);
  }

  /** The seamless segue: swap scenes at a chord boundary. */
  function beginScene(next: Scene, t: number) {
    scene = next;
    prefetchedScene = null;
    playbackRng = createRng((next.seed ^ PLAYBACK_SALT) >>> 0);
    evolution = initSceneEvolution(next);
    phraseLedger = createPhraseLedger(motifAnchor(next));
    counterMelodyFiredThisChord = false;
    sceneStartedAt = t;
    kickHits.length = 0;
    round = 0;
    outroStarted = false;
    applyAtmosphere(next, t);
    drums.gain.cancelScheduledValues(t);
    drums.gain.setValueAtTime(Math.max(drums.gain.value, 0.05), t);
    drums.gain.linearRampToValueAtTime(1, t + 3);
    if (pChance(0.5)) voices.playNeedleDrop(t + 0.2);
    config.onSceneChange?.(summarize(next));
    samples.warmForScene(next);
  }

  /**
   * Energy arc across the scene: beatless intro round, grooving middle
   * rounds (alternating A/B intensity), thinning outro round.
   */
  function energyFor(r: number, c: number): number {
    return sceneEnergy(scene.dna.structure, r, c, scene.rounds);
  }

  function ghostMulRatio(): number {
    return evolution.modifiers.drumGhostMul / scene.dna.patterns.drumGhostMul;
  }

  /** Energy-linked tape / reverb / ambience drift for this chord. */
  function applyEnergyAutomation(t: number, energy: number, rampSecs: number) {
    const palette = energyAutomation(scene, round, chordIdx, energy);
    tape.frequency.setTargetAtTime(palette.tapeCutoff, t, rampSecs);
    sceneReverb.setSend(palette.reverbSend, t, rampSecs);
    ambience.morphMovement(palette.ambienceMovement, t, rampSecs);
    ambience.morphLevels(palette.ambienceLevel, palette.ambienceSecondaryWeight, t, rampSecs);
  }

  /** Advance round-indexed DNA at the start of each new pass. */
  function onRoundBoundary(t: number, newRound: number) {
    if (newRound <= 0 || newRound >= scene.rounds) return;
    evolution = evolveForRound(scene, newRound, playbackRng, evolution);
    const energy = energyFor(newRound, 0);
    applyEnergyAutomation(t, energy, 3);
  }

  function playMelodyNote(note: string, t: number, dur: number, vel: number) {
    const layout = dualPianoLayout(scene.band);
    let out = note;
    if (layout && scene.band.melodyVoice === "piano") {
      out = melodyPianoNote(note, layout);
    }
    let gain = SYNTHY_MELODY_GAIN[scene.band.melodyVoice] ?? 1;
    if (layout && scene.band.melodyVoice === "piano") {
      gain *= melodyPianoVelMul(layout);
    }
    melodyPlayers[scene.band.melodyVoice](out, t, dur, vel * gain);
  }

  function voiceCompNote(note: string): string {
    const layout = dualPianoLayout(scene.band);
    if (layout && scene.band.chordVoice === "piano") {
      return compPianoNote(note, layout);
    }
    return note;
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
    phraseId: PhraseId,
  ) {
    const beatLen = sixteenth * 4;
    const varied = varyPhrase(notes, variation, scene.melodyPlan.answerShift, scene.dna.melody);
    if (varied.length === 0) return;
    const firstStep = Math.min(...varied.map((n) => n.step));
    const preBound = scene.melodyPlan.harmonicBound;
    for (const n of varied) {
      let idx = Math.max(0, Math.min(scene.scale.length - 1, n.scaleIdx));
      if (!preBound && (n.step === firstStep || n.beats >= 1.25)) {
        idx = snapToChordTone(idx, chord);
      }
      const swing = n.step % 2 === 1 ? sixteenth * scene.swing * 0.5 : 0;
      const pickup = n.pickup ? -sixteenth * 0.12 : 0;
      const layback =
        (n.accent ? sixteenth * 0.08 : 0) + sixteenth * scene.dna.timing.melodyLayback * 0.5;
      const at = t + n.step * sixteenth + swing + pickup + layback + h();
      const vel = n.vel * velScale * (n.accent ? 1.12 : 0.94);
      playMelodyNote(melodyNoteForChord(idx, scene.scale, chord), at, n.beats * beatLen, vel);
      phraseLedger = updatePhraseLedger(
        phraseLedger,
        { scaleIdx: idx, step: n.step, vel },
        phraseId,
      );
    }
  }

  /** Delayed echo of the primary phrase on the harmony voice. */
  function scheduleCounterMelody(
    t: number,
    sixteenth: number,
    energy: number,
    notes: MotifNote[],
    variation: MotifVariation,
    velScale: number,
    chord: Chord,
  ): boolean {
    const voice = scene.band.harmonyVoice;
    if (!voice || energy < 0.48) return false;

    const inner = scene.texturePlan.byChord[chordIdx]?.inner ?? [];
    if (inner.length >= 2 && pChance(0.45)) return false;

    const p =
      0.38
      * (scene.band.harmonyChance ?? 0.55)
      * scene.dna.patterns.harmonyMul
      * evolution.modifiers.melodyPresence
      * energy;
    if (!pChance(p)) return false;

    const beatLen = sixteenth * 4;
    const varied = varyPhrase(notes, variation, scene.melodyPlan.answerShift, scene.dna.melody);
    if (varied.length === 0) return false;

    const play = chordPlayers[voice];
    const delay16 = pPick([2, 3, 4, 5]);
    const useOctave = pChance(0.62);
    const velBase = velScale * 0.42 * chordVelScale(voice);
    const firstStep = Math.min(...varied.map((n) => n.step));
    const preBound = scene.melodyPlan.harmonicBound;
    let played = false;

    for (const n of varied) {
      let idx = Math.max(0, Math.min(scene.scale.length - 1, n.scaleIdx));
      if (!preBound && (n.step === firstStep || n.beats >= 1.25)) {
        idx = snapToChordTone(idx, chord);
      }

      const note = useOctave
        ? noteFromMidi(midiFromNote(scene.scale[idx]) + 12)
        : scene.scale[Math.min(scene.scale.length - 1, idx + pPick([1, 2]))];

      const at = t + (n.step + delay16) * sixteenth + h();
      play(note, at, n.beats * beatLen * 0.85, n.vel * velBase);
      played = true;
    }
    return played;
  }

  /** How the band's chord player states this chord (algorithmic comping grid). */
  function scheduleComping(t: number, sixteenth: number, energy: number, chord: Chord) {
    const beatLen = sixteenth * 4;
    const pattern = scene.compingPattern;
    const play = chordPlayers[scene.band.chordVoice];
    const pianoLayout = dualPianoLayout(scene.band);
    const softSustain =
      pattern.style === "sustained"
      && (
        scene.band.chordVoice === "organ"
        || scene.band.chordVoice === "choir"
        || scene.band.chordVoice === "accordion"
        || scene.band.chordVoice === "cello"
        || scene.band.chordVoice === "strings"
      );
    const sustainMul = softSustain ? 0.38 : pattern.style === "sustained" ? 0.45 : 1;
    const dualPianoMul =
      pianoLayout && scene.band.chordVoice === "piano"
        ? compPianoVelMul(pianoLayout)
        : 1;
    const baseVel =
      (0.18 + pRand(0, 0.05)) * (0.7 + 0.3 * energy) * chordVelScale() * sustainMul * dualPianoMul;

    for (const hit of pattern.hits) {
      if (pattern.style === "stabs" && hit.step > 0 && energy < 0.55) continue;
      if (pattern.style === "sustained" && hit.velScale < 0.4 && energy < 0.35) continue;
      if (pattern.style === "sustained" && hit.velScale < 0.25 && energy < 0.55) continue;
      if (hit.step > 0 && !pChance(evolution.modifiers.compingKeep)) continue;
      const n = voiceCompNote(chord.notes[hit.voiceIdx % chord.notes.length]);
      const at = t + hit.step * sixteenth + (hit.micro ?? 0) + h();
      play(n, at, hit.beats * beatLen, baseVel * hit.velScale);
    }
  }

  function scheduleRestabs(t: number, sixteenth: number, energy: number, chord: Chord) {
    if (energy < 0.5 || !pChance(evolution.modifiers.restabChance)) return;
    const beatLen = sixteenth * 4;
    const play = chordPlayers[scene.band.chordVoice];
    const pianoLayout = dualPianoLayout(scene.band);
    const dualMul =
      pianoLayout && scene.band.chordVoice === "piano"
        ? compPianoVelMul(pianoLayout) * 0.85
        : 1;
    for (const hit of scene.compingPattern.restabs) {
      const n = voiceCompNote(chord.notes[hit.voiceIdx % chord.notes.length]);
      play(
        n,
        t + hit.step * sixteenth + (hit.micro ?? 0) + h(),
        hit.beats * beatLen,
        0.09 * chordVelScale() * hit.velScale * dualMul,
      );
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

      // intro round: whisper of the hook on chord 3 (deterministic)
      if (round === 0) {
        if (chordIdx === 2) {
          playPhrase(t, sixteenth, plan.phrases.A, "fragment", 0.65, chord, "A");
        }
        return;
      }

      const slot = plan.slots[chordIdx];
      if (!slot) return;

      const variation = variationForSlot(
        slot,
        round,
        scene.rounds,
        evolution.roundCycle,
      );

      const presence = presenceForSlot(
        slot,
        round,
        scene.rounds,
        energy,
        evolution.modifiers.melodyPresence,
      );
      if (!shouldPlayMelodySlot(presence, slot.phraseId, round, scene.rounds, pChance)) {
        return;
      }

      const phrase =
        plan.chordPhrases[chordIdx]?.length > 0
          ? plan.chordPhrases[chordIdx]
          : plan.phrases[slot.phraseId];
      const velScale = outro ? 0.72 : 0.92 + 0.08 * energy;
      playPhrase(t, sixteenth, phrase, variation, velScale, chord, slot.phraseId);
      if (scheduleCounterMelody(t, sixteenth, energy, phrase, variation, velScale, chord)) {
        counterMelodyFiredThisChord = true;
      }
    } else if (behavior === "arp") {
      // Chord-tone arps come from texturePlan — scheduled per 16th in scheduleTextureNotes.
    } else if (behavior === "held" && chordIdx % 2 === 0 && pChance(0.75)) {
      // one long note floating over the whole chord
      const idx = pRandInt(Math.floor(scene.scale.length / 2), scene.scale.length - 1);
      playMelodyNote(scene.scale[idx], t + 0.05, beatLen * 7, 0.06);
    }
    // "sparse": no structured statement — texture + fills carry the line
  }

  /** Step-accurate chord-tone texture — arps, pickups, tails, inner lines. */
  function scheduleTextureNotes(
    t: number,
    sixteenth: number,
    energy: number,
  ) {
    if (round === 0 || energy < 0.32) return;

    const chordTex = scene.texturePlan.byChord[chordIdx];
    if (!chordTex) return;

    const beatLen = sixteenth * 4;
    const velMul = 0.75 + 0.35 * energy * evolution.modifiers.melodyPresence;
    const notes = textureNotesForChord(chordTex);

    for (const n of notes) {
      if (n.step !== step) continue;

      const swing = step % 2 === 1 ? sixteenth * scene.swing * 0.5 : 0;
      const at = t + swing + h();
      const idx = Math.max(0, Math.min(scene.scale.length - 1, n.scaleIdx));
      const dur = n.beats * beatLen;
      const vel = n.vel * velMul;

      if (n.harmonyVoice && scene.band.harmonyVoice) {
        const play = chordPlayers[scene.band.harmonyVoice];
        play(
          scene.scale[idx],
          at,
          dur,
          vel * chordVelScale(scene.band.harmonyVoice),
        );
      } else {
        playMelodyNote(scene.scale[idx], at, dur, vel);
      }
    }
  }

  /** Once in a long while, something small and surprising drifts past. */
  function maybePlayEvent(t: number) {
    if (!ambientEventDue(t, eventSchedule, scene.dna.environment, () => pb().next())) return;

    const kind = pickAmbientEventKind(
      scene.ambience.bed,
      scene.family,
      eventSchedule,
      t,
      (items) => pPick(items),
    );
    eventSchedule = markAmbientEvent(eventSchedule, t, kind);

    switch (kind) {
      case "thunder":
        voices.playThunder(t + pRand(0, 4));
        break;
      case "train":
        voices.playTrainHorn(t + pRand(0, 3));
        break;
      case "owl":
        voices.playOwl(t + pRand(0, 2));
        break;
      case "chimes":
        voices.playChimes(scene.scale, t + pRand(0, 2));
        break;
      case "crickets":
        voices.playCrickets(t + pRand(0, 2));
        break;
      case "motif-bells": {
        let bellT = t + 0.5;
        for (const n of scene.motif) {
          const idx = Math.max(0, Math.min(scene.scale.length - 1, n.scaleIdx));
          voices.playBell(scene.scale[idx], bellT, 0.045);
          bellT += 0.7 + pRand(0, 0.4);
        }
        break;
      }
    }
  }

  /** Soft upper-voice doubling — complementary timbre on the full voicing. */
  function scheduleHarmony(
    t: number,
    energy: number,
    chord: Chord,
    chordDur: number,
  ) {
    const harmony = scene.band.harmonyVoice;
    if (!harmony || harmony === scene.band.chordVoice || energy < 0.38) return;
    const p =
      (scene.band.harmonyChance ?? 0.72)
      * scene.dna.patterns.harmonyMul
      * (0.62 + 0.38 * energy);
    if (!pChance(p)) return;
    const play = texturePlayers[harmony];
    const vel = (0.055 + pRand(0, 0.028)) * (0.52 + 0.48 * energy) * textureVelScale(harmony);
    const notes = [...new Set([chord.root, ...chord.notes])];
    notes.forEach((n, i) => {
      play(n, t + i * 0.022 + h(), chordDur * 0.96, vel);
    });
  }

  /** Sustained synth bed — strings, choir, organ, harp recreated in Web Audio. */
  function scheduleBedLayer(
    t: number,
    energy: number,
    chord: Chord,
    chordDur: number,
  ) {
    const bed = scene.band.bedVoice;
    if (!bed || bed === scene.band.chordVoice || bed === scene.band.harmonyVoice) return;
    if (energy < 0.32) return;
    const p =
      (scene.band.bedChance ?? 0.8)
      * scene.dna.patterns.harmonyMul
      * (0.55 + 0.45 * energy);
    if (!pChance(p)) return;
    const play = texturePlayers[bed];
    const vel = (0.042 + pRand(0, 0.018)) * (0.48 + 0.52 * energy) * textureVelScale(bed);
    const notes = [...new Set([chord.root, ...chord.notes])];
    notes.forEach((n, i) => {
      play(n, t + i * 0.04 + h(), chordDur * 1.02, vel);
    });
  }

  function scheduleChordStart(t: number, sixteenth: number, energy: number) {
    const beatLen = sixteenth * 4;
    const chordDur = beatLen * 8; // two bars
    const chord = scene.progression[chordIdx];

    scheduleComping(t, sixteenth, energy, chord);
    scheduleBedLayer(t, energy, chord, chordDur);
    scheduleHarmony(t, energy, chord, chordDur);

    // quiet triad pad — root/third/fifth only, sits under piano not over it
    if (scene.padOn && energy >= 0.38) {
      textureVoices.playPad(
        soothingPadNotes(chord),
        t,
        chordDur * 1.05,
        0.005 + 0.004 * energy,
        scene.band.padStyle ?? "warm",
      );
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

    if (pChance(scene.dna.effects.filterDipChance * energy)) {
      const dip = scene.tapeCutoff * pRand(0.55, 0.78);
      tape.frequency.cancelScheduledValues(t);
      tape.frequency.setValueAtTime(tape.frequency.value, t);
      tape.frequency.setTargetAtTime(dip, t, 0.08);
      tape.frequency.setTargetAtTime(scene.tapeCutoff, t + beatLen * pRand(3, 6), 1.2);
      triggerSaturationBurst(tapeDrive, t, energy * scene.dna.effects.duckMul);
    }

    if (
      chordIdx >= 1
      && chordIdx <= 2
      && pChance(scene.dna.effects.reverbSwell * energy)
    ) {
      const baseline = {
        send: scene.reverbSend,
        decay: scene.reverbDecay,
        damp: scene.reverbDamp,
      };
      sceneReverb.set(
        {
          send: scene.reverbSend * 1.55,
          decay: scene.reverbDecay * 1.25,
          damp: scene.reverbDamp * 0.88,
        },
        t,
      );
      sceneReverb.set(baseline, t + beatLen * 6);
    }
  }

  /** MIDI note a riff degree resolves to against the current (and next) chord. */
  function riffMidi(deg: RiffDeg, chord: Chord, next: Chord | undefined, octaveDown = false): number {
    if (deg === "approach") {
      if (!next) return resolveBassMidi("fifth", chord, undefined, { octaveDown });
      const midi = next.rootMidi + (pChance(0.6) ? -1 : 2);
      return octaveDown ? midi - 12 : midi;
    }
    return resolveBassMidi(deg, chord, next, { octaveDown });
  }

  function scheduleStep(t: number) {
    const bpm = currentBpm();
    const sixteenth = 60 / bpm / 4;
    const beatLen = sixteenth * 4;

    if (bridge) {
      if (step === 0) {
        const progress = 1 - bridge.remaining / SEGUE_BRIDGE_STEPS;
        const oldChord = scene.progression[scene.progression.length - 1];
        const newChord = bridge.nextScene.progression[0];
        const chord = progress < 0.55 ? oldChord : newChord;
        scheduleBridgeComping(t, sixteenth, chord, progress);
        applyBridgeAtmosphere(bridge.nextScene, t, progress);
      }
      bridge.remaining--;
      if (bridge.remaining <= 0) {
        beginScene(bridge.nextScene, t);
        bridge = null;
      }
      return;
    }

    if (step === 0) {
      counterMelodyFiredThisChord = false;
      chordIdx++;
      if (chordIdx >= CHORDS_PER_ROUND) {
        chordIdx = 0;
        round++;
        if (round < scene.rounds) onRoundBoundary(t, round);
      }

      // segue time? (scene ran its course, or the listener steered the mood)
      if (round >= scene.rounds || (pendingMood && pendingMood !== scene.family)) {
        const nextFamily = resolveSegueFamily(radio, scene, pendingMood);
        const next =
          prefetchedScene?.family === nextFamily && prefetchedScene
            ? prefetchedScene
            : makeScene(nextFamily, scene, forkSceneRng(), radio);
        prefetchedScene = null;
        radio = recordScene(radio, next);
        pendingMood = null;
        bridge = {
          remaining: SEGUE_BRIDGE_STEPS,
          nextScene: next,
          fromBpm: scene.bpm,
          toBpm: next.bpm,
        };
        drums.gain.cancelScheduledValues(t);
        drums.gain.setTargetAtTime(0.04, t, 0.6);
        return;
      }

      const energy = energyFor(round, chordIdx);

      applyEnergyAutomation(t, energy, beatLen * 6);

      // outro: let the drums dissolve under the final chord
      if (round === scene.rounds - 1 && chordIdx === CHORDS_PER_ROUND - 1 && !outroStarted) {
        outroStarted = true;
        drums.gain.cancelScheduledValues(t);
        drums.gain.setValueAtTime(drums.gain.value, t);
        drums.gain.linearRampToValueAtTime(0.08, t + beatLen * 7);
      }

      // classic lofi dropout: occasionally a mid-scene chord goes beatless
      drumsOnForChord =
        energy >= 0.5 && !(pChance(evolution.modifiers.dropoutChance) && round > 0);

      scheduleChordStart(t, sixteenth, energy);
      maybePrefetchNextScene();
      if (chordIdx === 0 && round > 0 && round < scene.rounds - 1) maybePlayEvent(t);
    }

    const energy = energyFor(round, chordIdx);
    const chord = scene.progression[Math.max(0, chordIdx)];
    const nextChord =
      chordIdx + 1 < scene.progression.length
        ? scene.progression[chordIdx + 1]
        : undefined;

    if (step === 12) scheduleRestabs(t, sixteenth, energy, chord);

    scheduleTextureNotes(t, sixteenth, energy);

    // ---- bass ----
    const playBass = bassPlayers[scene.band.bassVoice];
    if (playBass) {
      const bassThin = evolution.modifiers.bassThinMul;
      const bVel = Math.min(1, (0.4 + 0.6 * energy) * bassThin);
      const duckBass = (note: string, at: number, dur: number, vel: number, depth = 0.87) => {
        playBass(note, at, dur, vel);
        mixDynamics.triggerDuck(at, depth, 0.12, "bass", scene.dna.effects.duckMul);
      };
      const chordFigure = scene.bassLinePlan.byChord[chordIdx] ?? scene.bassLinePlan.byChord[0];
      const melodyPhrase = scene.melodyPlan.chordPhrases[chordIdx];
      const skipGhosts = bassSkipGhost(round, scene.rounds);
      for (const rn of chordFigure) {
        if (rn.step !== step) continue;
        if (skipGhosts && rn.vel < 0.7) continue;
        if (rn.vel < 0.85 && energy < 0.5) continue;
        if (rn.vel < 0.45 && energy < 0.85) continue;
        const lock = bassMelodyLock(rn, chord, melodyPhrase, scene.scale);
        if (lock.skip) continue;
        const midi = riffMidi(rn.deg, chord, nextChord, lock.octaveDown);
        duckBass(noteFromMidi(midi), t + h(), beatLen * rn.beats, 0.3 * rn.vel * bVel, 0.92);
      }
    }

    // ---- drums (driven by the band's kit grammar) ----
    if (drumsOnForChord) {
      const kit = scene.drumGrammar;
      const dVel = 0.6 + 0.4 * energy;
      const duck = scene.dna.effects.duckMul;

      if (kit.kicks.includes(step)) {
        const kickT = drumAt(t, sixteenth);
        const vel = 0.5 * dVel * kit.kickVel;
        voices.playKick(kickT, vel);
        triggerKickPulse(kickT, vel);
        mixDynamics.triggerDuck(kickT, 0.74, 0.22, "kick", duck);
        triggerTextureDuck(kickT, 0.32, 0.3);
      } else if (kit.kickGhosts?.steps.includes(step) && pChance(kit.kickGhosts.p * energy * ghostMulRatio())) {
        const kickT = drumAt(t, sixteenth);
        const vel = 0.25 * kit.kickVel;
        voices.playKick(kickT, vel);
        triggerKickPulse(kickT, vel * 0.65);
        mixDynamics.triggerDuck(kickT, 0.82, 0.14, "kick", duck);
        triggerTextureDuck(kickT, 0.42, 0.22);
      }

      if (kit.backbeat) {
        const bb = kit.backbeat;
        const snareMul = bb.snareVel ?? 1;
        const hit = (vel: number) => {
          const at = drumAt(t, sixteenth);
          const v = vel * snareMul;
          if (bb.voice === "snare") {
            voices.playSnare(at, v);
            mixDynamics.triggerDuck(at, 0.91, 0.09, "snare", duck);
            triggerTextureDuck(at, 0.26, 0.24);
          } else if (bb.voice === "woodblock") {
            voices.playWoodblock(at, v);
            mixDynamics.triggerDuck(at, 0.88, 0.07, "snare", duck);
            triggerTextureDuck(at, 0.34, 0.2);
          } else if (bb.voice === "rim") voices.playRim(at, v);
          else voices.playBrush(at, v, true);
        };
        if (bb.steps.includes(step)) hit(0.45 * dVel);
        else if (bb.ghosts?.steps.includes(step) && pChance(bb.ghosts.p * energy * ghostMulRatio())) hit(0.14);
      }

      if (kit.pulse && step % kit.pulse.every === 0 && pChance(kit.pulse.p)) {
        const voice = scene.band.pulseVoice ?? kit.pulse.voice;
        const accent = step % kit.pulse.accentEvery === kit.pulse.accentEvery / 2;
        const [hi, lo] = PULSE_VELS[voice];
        pulsePlayers[voice](drumAt(t, sixteenth), (accent ? hi : lo) * dVel);
      }
      if (kit.offbeat && step % 4 === 3 && pChance(kit.offbeat.p * energy)) {
        pulsePlayers[kit.offbeat.voice](drumAt(t, sixteenth), 0.2);
      }

      const fill = evolution.fillGrammar;
      if (kit.fills && chordIdx === CHORDS_PER_ROUND - 1 && energy >= 0.55 && fill.hits.length > 0) {
        for (const fh of fill.hits) {
          if (step !== fh.step || !pChance(fill.probability)) continue;
          const at = drumAt(t, sixteenth) + (fh.offset16ths ?? 0) * sixteenth;
          if (fh.voice === "snare") voices.playSnare(at, 0.12 * fh.velScale * dVel);
          else voices.playHat(at, 0.2 * fh.velScale * dVel);
        }
      }
    }

    // Cohesive melody fills — pickup tail or antiphonal echo, only in phrase rests.
    const behavior = scene.band.melodyBehavior;
    if (
      shouldAttemptFill(
        behavior,
        chordIdx,
        step,
        energy,
        scene.dna.patterns.fillDensity,
        pChance,
      )
    ) {
      const chordPhrase = scene.melodyPlan.chordPhrases[chordIdx] ?? [];
      const fills = planCohesiveFill({
        ledger: phraseLedger,
        plan: scene.melodyPlan,
        chordPhrase,
        step,
        scaleLen: scene.scale.length,
        counterMelodyFired: counterMelodyFiredThisChord,
        pick: pPick,
        chance: pChance,
      });
      for (let i = 0; i < fills.length; i++) {
        const fill = fills[i];
        let idx = Math.max(0, Math.min(scene.scale.length - 1, fill.scaleIdx));
        if (step % 4 === 0) idx = snapToChordTone(idx, chord);
        const at = t + i * sixteenth * 2 + 0.03 + h();
        playMelodyNote(
          scene.scale[idx],
          at,
          beatLen * fill.beats,
          fill.vel + pRand(0, 0.02),
        );
        phraseLedger = updatePhraseLedger(
          phraseLedger,
          { scaleIdx: idx, step: step + i * 2, vel: fill.vel },
          fill.kind === "pickup" ? "tag" : "A",
        );
      }
    }

    // per-bed ambience grain (fire crackles)
    ambience.sparkle(t);

    // vinyl pops (inaudible when the pops bus is muted)
    if (pChance(0.12 * scene.dna.effects.popRate)) {
      voices.playPop(t + pRand(0, 0.1), 0.5 + pRand(0, 0.5));
    }
  }

  function tick() {
    syncDelayToTempo(ctx.currentTime);
    const sixteenth = 60 / currentBpm() / 4;
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
      samples.warmForScene(scene);
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
