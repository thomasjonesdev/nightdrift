// Instrument voices — Web Audio synthesis for every role except piano
// (multisamples via sample-library). One-shot oscillators/noise/buffers;
// notes schedule ahead of time and the engine never holds long-lived voices.

import type { SampleLibrary } from "./sample-library";
import type { DrumHitKind } from "./drum-types";
import {
  createPerformanceState,
  schedulePerformanceEnvelope,
  shapePerformance,
  type PerformanceHints,
  type PerformanceRole,
} from "./performance";
import { freq } from "./notes";

export type PadStyle = "warm" | "huge" | "choir";

export interface Buses {
  ctx: AudioContext;
  /** Melodic bus: "old tape" lowpass into master + reverb (or a role bus feeding it). */
  tape: AudioNode;
  /** Which band role this voice bus serves — drives performance shaping. */
  role?: PerformanceRole;
  /** Lazy-loaded multisample library (optional — synth fallback when samples aren't ready). */
  samples?: SampleLibrary | null;
  /** Drum bus: fadeable for segues and dropouts. */
  drums: GainNode;
  /** Sub-bass undertone bus — sits under the mix for main voices to breathe around. */
  undertone: GainNode;
  master: GainNode;
  /** Reverb send bus — per-band wet/damp/decay morph at scene segues. */
  reverb: GainNode;
  /** Vinyl pop bus, muted when crackle is off. */
  pops: GainNode;
  noiseBuf: AudioBuffer;
  /** Tape-wobble LFO output (cents), connect to detune. */
  wobbleAmt: GainNode;
  /** Optional pad-only bus — formless wash, levelled near ambience. */
  pad?: AudioNode;
}

export function createVoices(buses: Buses) {
  const { ctx, tape, pad, drums, undertone, master, reverb, pops, noiseBuf, wobbleAmt, samples, role } = buses;
  const perfState = createPerformanceState();
  const perfRole = role ?? "chord";

  type NoteSynth = (note: string, time: number, dur: number, vel: number, hints: PerformanceHints) => void;

  function trySample(
    voice: string,
    note: string,
    time: number,
    dur: number,
    vel: number,
    hints?: PerformanceHints,
  ): boolean {
    return samples?.play(voice, note, time, dur, vel, tape, hints) ?? false;
  }

  function playNote(
    voiceId: string,
    note: string,
    time: number,
    dur: number,
    vel: number,
    synth: NoteSynth,
  ) {
    const events = shapePerformance(voiceId, { note, time, dur, vel }, perfState, { role: perfRole });
    for (const e of events) {
      if (trySample(voiceId, e.note, e.time, e.dur, e.vel, e.hints)) continue;
      synth(e.note, e.time, e.dur, e.vel, e.hints);
    }
  }

  function tryDrum(
    kind: DrumHitKind,
    time: number,
    vel: number,
    opts?: { reverb?: AudioNode },
  ): boolean {
    return samples?.playDrum(kind, time, vel, drums, opts) ?? false;
  }

  /** Synthetic analog keys — Rhodes-ish sine + octave overtone. */
  function playKey(note: string, time: number, dur: number, vel: number) {
    playNote("ep", note, time, dur, vel, (note, time, dur, vel) => {
    const f = freq(note);
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = f;
    const o2 = ctx.createOscillator(); // bell-ish overtone = EP character
    o2.type = "sine";
    o2.frequency.value = f * 2;
    wobbleAmt.connect(o1.detune);
    wobbleAmt.connect(o2.detune);

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vel * 0.35, time);
    g2.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.5); // overtone dies first

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(tape);
    o1.start(time); o2.start(time);
    o1.stop(time + dur + 0.1); o2.stop(time + dur + 0.1);
    });
  }

  /** Softer kalimba-ish pluck: triangle with a fast die-away. */
  function playPluck(note: string, time: number, dur: number, vel: number) {
    playNote("pluck", note, time, dur, vel, (note, time, dur, vel) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq(note);
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, time);
    lp.frequency.exponentialRampToValueAtTime(900, time + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 1.2, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(dur, 0.9));
    o.connect(lp).connect(g).connect(tape);
    o.start(time); o.stop(time + dur + 0.1);
    });
  }

  /** Music box / mallet shimmer — dual sine with inharmonic overtone. */
  function playBell(note: string, time: number, vel: number) {
    playNote("bell", note, time, 2.2, vel, (note, time, dur, vel) => {
    const f = freq(note) * 2;
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 2.76; // inharmonic shimmer
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vel * 0.15, time);
    g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 2.2);
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(tape);
    g.connect(reverb); // extra wash so it sounds far away
    o1.start(time); o2.start(time);
    o1.stop(time + 2.4); o2.stop(time + 0.7);
    });
  }

  /** Formless wash — flat, dark, mostly reverb; sits just above ambience. */
  function playPad(
    notes: string[],
    time: number,
    dur: number,
    vel: number,
    _style: PadStyle = "warm",
  ) {
    const out = pad ?? tape;
    const fadeIn = dur * 0.65;
    const fadeOut = dur * 0.25;

    const tone = ctx.createGain();
    tone.gain.setValueAtTime(0.0001, time);
    tone.gain.linearRampToValueAtTime(vel, time + fadeIn);
    tone.gain.setValueAtTime(vel * 0.96, time + fadeIn + Math.max(0, dur - fadeIn - fadeOut));
    tone.gain.linearRampToValueAtTime(0.0001, time + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 340;
    lp.Q.value = 0.22;

    const dry = ctx.createGain();
    dry.gain.value = 0.18;
    const wet = ctx.createGain();
    wet.gain.value = 0.78;

    lp.connect(tone);
    tone.connect(dry).connect(out);
    tone.connect(wet).connect(reverb);

    for (const note of notes.slice(0, 2)) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq(note);
      o.connect(lp);
      o.start(time);
      o.stop(time + dur + 0.35);
    }
  }

  // ---- Karplus-Strong strings (rendered offline into a one-shot buffer) ----

  const ksCache = new Map<string, AudioBuffer>();

  /**
   * Plucked-string buffer: a noise burst circulating through a damped
   * delay line. `blend` is the lowpass mix (higher = duller, faster
   * high-end decay); `decay` is per-cycle sustain.
   */
  function ksBuffer(f: number, secs: number, blend: number, decay: number): AudioBuffer {
    const key = `${Math.round(f)}:${secs}:${blend}:${decay}`;
    const hit = ksCache.get(key);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * secs);
    const buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / f));
    const line = new Float32Array(period);
    for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const j = (idx + 1) % period;
      out[i] = line[idx];
      const avg = (line[idx] + line[j]) * 0.5;
      line[idx] = decay * (line[idx] * (1 - blend) + avg * blend);
      idx = j;
    }
    ksCache.set(key, buf);
    return buf;
  }

  /** Nylon-string guitar — Karplus-Strong pluck. */
  function playGuitar(note: string, time: number, dur: number, vel: number) {
    playNote("guitar", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(f, 2.2, 0.7, 0.998);
    wobbleAmt.connect(src.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2800;
    const end = time + Math.min(dur, 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.9, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(lp).connect(g).connect(tape);
    src.start(time); src.stop(end + 0.1);
    });
  }

  /** Upright-ish plucked bass: dark Karplus-Strong over a sine sub. */
  function playPluckBass(note: string, time: number, dur: number, vel: number) {
    playNote("pluckBass", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(f, 1.8, 0.9, 0.996);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1100;
    const end = time + Math.min(dur, 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.8, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(lp).connect(g).connect(tape);
    src.start(time); src.stop(end + 0.1);

    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, time);
    og.gain.exponentialRampToValueAtTime(vel * 0.5, time + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.7);
    o.connect(og).connect(tape);
    o.start(time); o.stop(time + dur * 0.7 + 0.1);
    });
  }

  /** DX-style FM electric piano. */
  function playFmKey(note: string, time: number, dur: number, vel: number) {
    playNote("fmep", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const car = ctx.createOscillator();
    car.type = "sine";
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = f;
    const modAmt = ctx.createGain();
    modAmt.gain.setValueAtTime(f * (1.2 + vel * 2), time);
    modAmt.gain.exponentialRampToValueAtTime(f * 0.08, time + Math.min(dur * 0.5, 1.2));
    mod.connect(modAmt).connect(car.frequency);
    wobbleAmt.connect(car.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.72, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    car.connect(g).connect(tape);
    car.start(time); mod.start(time);
    car.stop(time + dur + 0.1); mod.stop(time + dur + 0.1);
    });
  }

  // warm drawbar spectrum — mostly 8' + gentle 4', upper partials kept soft
  const organWave = (() => {
    const real = new Float32Array(9);
    const imag = new Float32Array(9);
    imag[1] = 1; imag[2] = 0.32; imag[3] = 0.1; imag[4] = 0.05; imag[6] = 0.025;
    return ctx.createPeriodicWave(real, imag);
  })();

  /** Dusty chapel organ — drawbar periodic wave synth. */
  function playOrgan(note: string, time: number, dur: number, vel: number) {
    playNote("organ", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const o = ctx.createOscillator();
    o.setPeriodicWave(organWave);
    o.frequency.value = freq(note);
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(820, time);
    lp.frequency.linearRampToValueAtTime(1050, time + dur * 0.35);
    lp.frequency.linearRampToValueAtTime(680, time + dur);
    const g = ctx.createGain();
    const peak = vel * 0.72;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.2);
    g.gain.setValueAtTime(peak, time + Math.max(0.2, dur - 0.55));
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    const revSend = ctx.createGain();
    revSend.gain.value = 0.4;
    o.connect(lp).connect(g);
    g.connect(tape);
    g.connect(revSend).connect(reverb);
    o.start(time); o.stop(time + dur + 0.1);
    });
  }

  /** Worn string machine: detuned saw pair, lowpassed, swelling like a pad. */
  function playStrings(note: string, time: number, dur: number, vel: number) {
    playNote("strings", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, time);
    lp.frequency.linearRampToValueAtTime(1500, time + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(800, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.72, time + dur * 0.3);
    g.gain.setValueAtTime(vel * 0.72, time + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    lp.connect(g).connect(tape);
    for (const detune of [-8, -4, 4, 8]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq(note);
      o.detune.value = detune;
      wobbleAmt.connect(o.detune);
      o.connect(lp);
      o.start(time); o.stop(time + dur + 0.1);
    }
    });
  }

  /** Wooden marimba: bright Karplus-Strong mallet with a warm body. */
  function playMarimba(note: string, time: number, dur: number, vel: number) {
    playNote("marimba", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(f, 1.5, 0.5, 0.993);
    wobbleAmt.connect(src.detune);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(f * 3.2, 4200);
    bp.Q.value = 0.7;
    const end = time + Math.min(dur, 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.95, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(bp).connect(g).connect(tape);
    src.start(time); src.stop(end + 0.1);
    });
  }

  /** Breath clarinet: soft saw through a narrow lowpass with air and vibrato. */
  function playClarinet(note: string, time: number, dur: number, vel: number) {
    playNote("clarinet", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1100, time);
    lp.frequency.linearRampToValueAtTime(1500, time + dur * 0.25);
    lp.frequency.linearRampToValueAtTime(950, time + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.8;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = 6;
    vib.connect(vibAmt).connect(o.detune);
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuf;
    const breathBp = ctx.createBiquadFilter();
    breathBp.type = "bandpass";
    breathBp.frequency.value = 1800;
    breathBp.Q.value = 0.5;
    const breathG = ctx.createGain();
    breathG.gain.setValueAtTime(vel * 0.08, time);
    breathG.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.82, time + 0.06);
    g.gain.setValueAtTime(vel * 0.82, time + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    o.connect(lp).connect(g);
    breath.connect(breathBp).connect(breathG).connect(g);
    g.connect(tape);
    o.start(time); vib.start(time); breath.start(time);
    o.stop(time + dur + 0.1); vib.stop(time + dur + 0.1); breath.stop(time + dur + 0.1);
    });
  }

  /** Chapel choir pad: detuned sines with a slow vowel swell. */
  function playChoir(note: string, time: number, dur: number, vel: number) {
    playNote("choir", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1400, time);
    lp.frequency.linearRampToValueAtTime(2000, time + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(1200, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel, time + dur * 0.35);
    g.gain.setValueAtTime(vel, time + dur * 0.72);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    const revSend = ctx.createGain();
    revSend.gain.value = 0.45;
    lp.connect(g);
    g.connect(tape);
    g.connect(revSend).connect(reverb);
    for (const [ratio, detune] of [
      [1, -8], [1.002, -4], [1.004, 0], [0.998, 4],
      [2.01, -6], [2.005, -2], [2.008, 2], [0.996, 8],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq(note) * ratio;
      o.detune.value = detune;
      wobbleAmt.connect(o.detune);
      o.connect(lp);
      o.start(time); o.stop(time + dur + 0.1);
    }
    });
  }

  /** Muted horn: soft triangle swell through heavy lowpass — distant, not brassy. */
  function playHorn(note: string, time: number, dur: number, vel: number) {
    playNote("horn", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = f;
    const warmth = ctx.createOscillator();
    warmth.type = "sine";
    warmth.frequency.value = f * 0.5;
    wobbleAmt.connect(body.detune);
    wobbleAmt.connect(warmth.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(380, time);
    lp.frequency.linearRampToValueAtTime(580, time + dur * 0.25);
    lp.frequency.linearRampToValueAtTime(440, time + dur);
    const warmthG = ctx.createGain();
    warmthG.gain.value = 0.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.48, time + 0.22);
    g.gain.setValueAtTime(vel * 0.48, time + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    const revSend = ctx.createGain();
    revSend.gain.value = 0.6;
    const drySend = ctx.createGain();
    drySend.gain.value = 0.4;
    body.connect(lp);
    warmth.connect(warmthG).connect(lp);
    lp.connect(g);
    g.connect(drySend).connect(tape);
    g.connect(revSend).connect(reverb);
    body.start(time); warmth.start(time);
    body.stop(time + dur + 0.1); warmth.stop(time + dur + 0.1);
    });
  }

  /** Vibraphone: sine plus a fast-dying 4th partial, shimmering tremolo. */
  function playVibe(note: string, time: number, dur: number, vel: number) {
    playNote("vibe", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const end = time + Math.min(dur * 1.5, 2.4);
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 4;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vel * 0.12, time);
    g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const trem = ctx.createOscillator();
    trem.frequency.value = 4.2;
    const tremAmt = ctx.createGain();
    tremAmt.gain.value = vel * 0.35;
    trem.connect(tremAmt).connect(g.gain);
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(tape);
    o1.start(time); o2.start(time); trem.start(time);
    o1.stop(end + 0.1); o2.stop(time + 0.5); trem.stop(end + 0.1);
    });
  }

  /**
   * Sub-bass undertone: a quiet sustained root that slowly drifts toward
   * the fifth, leaving headroom for the main voices to compress around it.
   */
  function playUndertone(
    root: string,
    driftTo: string,
    time: number,
    dur: number,
    vel: number,
  ) {
    const driftAt = time + dur * 0.55;
    const end = time + dur;
    for (const [note, start, stop] of [
      [root, time, driftAt] as const,
      [driftTo, driftAt, end] as const,
    ]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq(note);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(vel, start + Math.min(dur * 0.25, 1.2));
      g.gain.setValueAtTime(vel, stop - Math.min(dur * 0.2, 0.9));
      g.gain.linearRampToValueAtTime(0.0001, stop);
      const breath = ctx.createOscillator();
      breath.frequency.value = 0.07;
      const breathAmt = ctx.createGain();
      breathAmt.gain.value = vel * 0.18;
      breath.connect(breathAmt).connect(g.gain);
      o.connect(g).connect(undertone);
      o.start(start); breath.start(start);
      o.stop(stop + 0.1); breath.stop(stop + 0.1);
    }
  }

  /**
   * Finger-style bass guitar: triangle body with a touch of saw growl, a
   * plucked filter sweep, and a tiny pick transient — round enough to sit
   * under the chords, present enough to carry a rhythm line.
   */
  function playBassGuitar(note: string, time: number, dur: number, vel: number) {
    playNote("bassGuitar", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(f * 7, 1300), time);
    lp.frequency.exponentialRampToValueAtTime(
      Math.max(f * 2.2, 130),
      time + Math.min(dur * 0.6, 0.5),
    );
    lp.Q.value = 1.1;
    const g = ctx.createGain();
    const playLen = schedulePerformanceEnvelope(g, time, vel, dur, hints);
    lp.connect(g).connect(tape);

    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = f;
    if (hints.detuneCents) body.detune.value = hints.detuneCents;
    body.connect(lp);
    const growl = ctx.createOscillator();
    growl.type = "sawtooth";
    growl.frequency.value = f;
    growl.detune.value = 3 + (hints.detuneCents ?? 0);
    const growlG = ctx.createGain();
    growlG.gain.value = hints.legato ? 0.1 : 0.16;
    growl.connect(growlG).connect(lp);
    body.start(time); growl.start(time);
    body.stop(time + playLen + 0.1); growl.stop(time + playLen + 0.1);

    if (!hints.legato) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1100;
    bp.Q.value = 1.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.12, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    n.connect(bp).connect(ng).connect(tape);
    n.start(time); n.stop(time + 0.05);
    }
    });
  }

  /** Round sine bass. */
  function playBass(note: string, time: number, dur: number, vel: number) {
    playNote("bass", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.02);
    g.gain.setValueAtTime(vel, time + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(tape);
    o.start(time); o.stop(time + dur + 0.1);
    });
  }

  function playKick(time: number, vel: number) {
    if (tryDrum("kick", time, vel)) return;
    const punchy = vel >= 0.55;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(punchy ? 165 : 140, time);
    o.frequency.exponentialRampToValueAtTime(punchy ? 38 : 42, time + (punchy ? 0.06 : 0.09));
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * (punchy ? 1.08 : 1), time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + (punchy ? 0.32 : 0.4));
    o.connect(g).connect(drums);
    o.start(time); o.stop(time + 0.45);
    if (punchy) {
      const click = ctx.createOscillator();
      click.type = "triangle";
      click.frequency.value = 62;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(vel * 0.22, time);
      cg.gain.exponentialRampToValueAtTime(0.0001, time + 0.025);
      click.connect(cg).connect(drums);
      click.start(time); click.stop(time + 0.04);
    }
  }

  function playSnare(time: number, vel: number) {
    const kind: DrumHitKind = vel < 0.22 ? "snareGhost" : "snare";
    if (tryDrum(kind, time, vel, { reverb })) return;
    const punchy = vel >= 0.52;
    // noise crack
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = punchy ? 2200 : 1800;
    bp.Q.value = punchy ? 1.1 : 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * (punchy ? 0.62 : 0.5), time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + (punchy ? 0.12 : 0.16));
    n.connect(bp).connect(ng);
    ng.connect(drums);
    if (!punchy) ng.connect(reverb);
    n.start(time); n.stop(time + 0.2);
    // tonal body
    const o = ctx.createOscillator();
    o.type = punchy ? "sine" : "triangle";
    o.frequency.value = punchy ? 165 : 185;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * (punchy ? 0.42 : 0.3), time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + (punchy ? 0.07 : 0.09));
    o.connect(og).connect(drums);
    o.start(time); o.stop(time + 0.12);
  }

  /** Dry woodblock tick — muted-kit backbeat. */
  function playWoodblock(time: number, vel: number) {
    if (tryDrum("rim", time, vel * 0.85)) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1180, time);
    o.frequency.exponentialRampToValueAtTime(920, time + 0.018);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.38, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    o.connect(og).connect(drums);
    o.start(time); o.stop(time + 0.05);
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.08, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.022);
    n.connect(hp).connect(ng).connect(drums);
    n.start(time); n.stop(time + 0.03);
  }

  function playHat(time: number, vel: number) {
    if (tryDrum(vel > 0.42 ? "hatOpen" : "hat", time, vel)) return;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.playbackRate.value = 1 + Math.random() * 0.1;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 8200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.18, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    n.connect(hp).connect(g).connect(drums);
    n.start(time); n.stop(time + 0.06);
  }

  /** Softer, woodier alternative to the hat. */
  function playShaker(time: number, vel: number) {
    if (tryDrum("shaker", time, vel)) return;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.playbackRate.value = 0.9 + Math.random() * 0.15;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 5200;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.14, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    n.connect(bp).connect(g).connect(drums);
    n.start(time); n.stop(time + 0.12);
  }

  /** Rim click: a short tonal ping with a tick of noise on top. */
  function playRim(time: number, vel: number) {
    if (tryDrum("rim", time, vel)) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 820;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.3, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    o.connect(og).connect(drums);
    o.start(time); o.stop(time + 0.07);
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.08, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    n.connect(hp).connect(ng).connect(drums);
    n.start(time); n.stop(time + 0.04);
  }

  /** Brushed snare swish: `long` for the backbeat sweep, short for the pulse. */
  function playBrush(time: number, vel: number, long = false) {
    if (tryDrum(long ? "brushLong" : "brush", time, vel)) return;
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.playbackRate.value = 0.95 + Math.random() * 0.1;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    bp.Q.value = 0.6;
    const decay = long ? 0.28 : 0.09;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.16, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    n.connect(bp).connect(g).connect(drums);
    n.start(time); n.stop(time + decay + 0.05);
  }

  function playPop(time: number, vel: number) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.playbackRate.value = 0.7 + Math.random() * 1.5;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.06, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.014);
    n.connect(hp).connect(g).connect(pops);
    n.start(time); n.stop(time + 0.03);
  }

  /** Distant thunder: a slow lowpassed noise swell that rolls away. */
  function playThunder(time: number) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    n.loop = true;
    n.playbackRate.value = 0.4;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(180, time);
    lp.frequency.exponentialRampToValueAtTime(55, time + 5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.05, time + 1.6);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 6.5);
    n.connect(lp).connect(g).connect(master);
    n.start(time); n.stop(time + 7);
  }

  /** A few cricket chirps drifting in from the garden. */
  function playCrickets(time: number) {
    let t = time;
    const groups = 3 + Math.floor(Math.random() * 3);
    for (let gIdx = 0; gIdx < groups; gIdx++) {
      const chirps = 3 + Math.floor(Math.random() * 2);
      for (let c = 0; c < chirps; c++) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 4200 + Math.random() * 300;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.006, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + 0.06);
        t += 0.07;
      }
      t += 0.5 + Math.random() * 1.2;
    }
  }

  /** An owl somewhere out in the dark: two soft falling hoots. */
  function playOwl(time: number) {
    const hoot = (t: number, f: number) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.93, t + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.02, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(g);
      g.connect(master);
      g.connect(reverb);
      o.start(t); o.stop(t + 0.45);
    };
    hoot(time, 340);
    hoot(time + 0.5, 312);
  }

  /** Wind chimes on someone's porch, stirred once. */
  function playChimes(notes: string[], time: number) {
    const pool = notes.slice(Math.floor(notes.length / 2));
    let t = time;
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      playBell(pool[Math.floor(Math.random() * pool.length)], t, 0.03);
      t += 0.15 + Math.random() * 0.4;
    }
  }

  /** A freight train sounding its horn a few blocks away. */
  function playTrainHorn(time: number) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.004, time + 2);
    g.gain.setValueAtTime(0.004, time + 2.5);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 5);
    lp.connect(g);
    g.connect(master);
    g.connect(reverb);
    for (const f of [220, 262]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.detune.setValueAtTime(0, time);
      o.detune.linearRampToValueAtTime(-20, time + 5);
      o.connect(lp);
      o.start(time); o.stop(time + 5.2);
    }
  }

  /** Wurlitzer: warm triangle body with a bright sine bite. */
  function playWurli(note: string, time: number, dur: number, vel: number) {
    playNote("wurli", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.value = f;
    const bite = ctx.createOscillator();
    bite.type = "sine";
    bite.frequency.value = f * 2;
    wobbleAmt.connect(body.detune);
    wobbleAmt.connect(bite.detune);
    const biteG = ctx.createGain();
    biteG.gain.setValueAtTime(vel * 0.28, time);
    biteG.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    body.connect(g);
    bite.connect(biteG).connect(g);
    g.connect(tape);
    body.start(time); bite.start(time);
    body.stop(time + dur + 0.1); bite.stop(time + dur + 0.1);
    });
  }

  /** Clavinet: bright, percussive square-ish pluck. */
  function playClav(note: string, time: number, dur: number, vel: number) {
    playNote("clav", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, time);
    lp.frequency.exponentialRampToValueAtTime(900, time + Math.min(dur, 0.5));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.85, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(dur, 0.55));
    o.connect(lp).connect(g).connect(tape);
    o.start(time); o.stop(time + dur + 0.1);
    });
  }

  /** Breath flute — soft sine with air and vibrato. */
  function playFlute(note: string, time: number, dur: number, vel: number) {
    playNote("flute", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    wobbleAmt.connect(o.detune);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = 4;
    vib.connect(vibAmt).connect(o.detune);
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuf;
    const breathBp = ctx.createBiquadFilter();
    breathBp.type = "bandpass";
    breathBp.frequency.value = 2400;
    breathBp.Q.value = 0.4;
    const breathG = ctx.createGain();
    breathG.gain.setValueAtTime(vel * 0.1, time);
    breathG.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.7, time + 0.08);
    g.gain.setValueAtTime(vel * 0.7, time + dur * 0.65);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    o.connect(g);
    breath.connect(breathBp).connect(breathG).connect(g);
    g.connect(tape);
    o.start(time); vib.start(time); breath.start(time);
    o.stop(time + dur + 0.1); vib.stop(time + dur + 0.1); breath.stop(time + dur + 0.1);
    });
  }

  /** Harp — Karplus-Strong pluck. */
  function playHarp(note: string, time: number, dur: number, vel: number) {
    playNote("harp", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(f, 2.8, 0.45, 0.995);
    wobbleAmt.connect(src.detune);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(f * 4, 5000);
    bp.Q.value = 0.5;
    const end = time + Math.min(dur, 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.88, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(bp).connect(g).connect(tape);
    src.start(time); src.stop(end + 0.1);
    });
  }

  /** Grand piano — FreePats multisamples (the only sampled instrument). */
  function playPiano(note: string, time: number, dur: number, vel: number) {
    playNote("piano", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const src = ctx.createBufferSource();
    src.buffer = ksBuffer(f, 2.5, 0.82, 0.997);
    wobbleAmt.connect(src.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    const end = time + Math.min(dur, 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vel * 0.75, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(lp).connect(g).connect(tape);
    src.start(time); src.stop(end + 0.1);
    });
  }

  /** Accordion: reedy saw with a slow bellows swell and tremolo. */
  function playAccordion(note: string, time: number, dur: number, vel: number) {
    playNote("accordion", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq(note);
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(680, time);
    lp.frequency.linearRampToValueAtTime(1100, time + dur * 0.3);
    lp.frequency.linearRampToValueAtTime(750, time + dur);
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.5;
    const tremAmt = ctx.createGain();
    tremAmt.gain.value = vel * 0.22;
    trem.connect(tremAmt).connect(o.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.65, time + 0.18);
    g.gain.setValueAtTime(vel * 0.65, time + dur * 0.72);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    o.connect(lp).connect(g).connect(tape);
    o.start(time); trem.start(time);
    o.stop(time + dur + 0.1); trem.stop(time + dur + 0.1);
    });
  }

  /** Cello: bowed saw with a slow attack and warm lowpass. */
  function playCello(note: string, time: number, dur: number, vel: number) {
    playNote("cello", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq(note);
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(480, time);
    lp.frequency.linearRampToValueAtTime(820, time + dur * 0.25);
    lp.frequency.linearRampToValueAtTime(520, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.72, time + 0.14);
    g.gain.setValueAtTime(vel * 0.72, time + dur * 0.68);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    const revSend = ctx.createGain();
    revSend.gain.value = 0.25;
    o.connect(lp).connect(g);
    g.connect(tape);
    g.connect(revSend).connect(reverb);
    o.start(time); o.stop(time + dur + 0.1);
    });
  }

  /** Celeste: glassy high partials with a long shimmer. */
  function playCeleste(note: string, time: number, dur: number, vel: number) {
    playNote("celeste", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note) * 2;
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 3.01;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vel * 0.18, time);
    g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.85, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + Math.min(dur, 2.8));
    o1.connect(g);
    o2.connect(g2).connect(g);
    g.connect(tape);
    g.connect(reverb);
    o1.start(time); o2.start(time);
    o1.stop(time + dur + 0.1); o2.stop(time + 0.9);
    });
  }

  /** Soft synth lead: detuned saw pair, gently filtered. */
  function playSynth(note: string, time: number, dur: number, vel: number) {
    playNote("synth", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1600, time);
    lp.frequency.linearRampToValueAtTime(2200, time + dur * 0.2);
    lp.frequency.linearRampToValueAtTime(1200, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.4, time + 0.06);
    g.gain.setValueAtTime(vel * 0.4, time + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    lp.connect(g).connect(tape);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq(note);
      o.detune.value = detune;
      wobbleAmt.connect(o.detune);
      o.connect(lp);
      o.start(time); o.stop(time + dur + 0.1);
    }
    });
  }

  /** Oboe: soft reed tone with breath — rounded, not piercing. */
  function playOboe(note: string, time: number, dur: number, vel: number) {
    playNote("oboe", note, time, dur, vel, (note, time, dur, vel, hints) => {
    const f = freq(note);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    wobbleAmt.connect(o.detune);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, time);
    lp.frequency.linearRampToValueAtTime(1200, time + dur * 0.2);
    lp.frequency.linearRampToValueAtTime(800, time + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibAmt = ctx.createGain();
    vibAmt.gain.value = 3.5;
    vib.connect(vibAmt).connect(o.detune);
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuf;
    const breathBp = ctx.createBiquadFilter();
    breathBp.type = "bandpass";
    breathBp.frequency.value = 1400;
    breathBp.Q.value = 0.4;
    const breathG = ctx.createGain();
    breathG.gain.setValueAtTime(vel * 0.05, time);
    breathG.gain.exponentialRampToValueAtTime(0.0001, time + dur * 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel * 0.48, time + 0.14);
    g.gain.setValueAtTime(vel * 0.48, time + dur * 0.65);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    const revSend = ctx.createGain();
    revSend.gain.value = 0.35;
    o.connect(lp).connect(g);
    breath.connect(breathBp).connect(breathG).connect(g);
    g.connect(tape);
    g.connect(revSend).connect(reverb);
    o.start(time); vib.start(time); breath.start(time);
    o.stop(time + dur + 0.1); vib.stop(time + dur + 0.1); breath.stop(time + dur + 0.1);
    });
  }

  /** Needle-drop thump + crackle burst for the "vinyl flip" between scenes. */
  function playNeedleDrop(time: number) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(80, time);
    o.frequency.exponentialRampToValueAtTime(45, time + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    o.connect(g).connect(master);
    o.start(time); o.stop(time + 0.3);
    for (let i = 0; i < 5; i++) {
      playPop(time + 0.1 + Math.random() * 0.8, 0.7 + Math.random() * 0.5);
    }
  }

  return {
    playKey, playPluck, playBell, playPad, playBass, playBassGuitar, playUndertone,
    playGuitar, playPluckBass, playFmKey, playOrgan, playStrings, playVibe,
    playMarimba, playClarinet, playChoir, playHorn,
    playWurli, playClav, playFlute, playHarp, playPiano, playAccordion,
    playCello, playCeleste, playSynth, playOboe,
    playKick, playSnare, playHat, playShaker, playRim, playBrush, playWoodblock,
    playPop, playThunder, playCrickets, playNeedleDrop,
    playOwl, playChimes, playTrainHorn,
  };
}

export type Voices = ReturnType<typeof createVoices>;
