// Instrument voices — each function schedules one sound on the shared
// audio graph. Everything is one-shot oscillators/noise, so notes can be
// scheduled ahead of time and the engine never holds long-lived voices.

import { freq } from "./notes";

export interface Buses {
  ctx: AudioContext;
  /** Melodic bus: "old tape" lowpass into master + reverb. */
  tape: BiquadFilterNode;
  /** Drum bus: fadeable for segues and dropouts. */
  drums: GainNode;
  master: GainNode;
  reverb: ConvolverNode;
  /** Vinyl pop bus, muted when crackle is off. */
  pops: GainNode;
  noiseBuf: AudioBuffer;
  /** Tape-wobble LFO output (cents), connect to detune. */
  wobbleAmt: GainNode;
}

export function createVoices(buses: Buses) {
  const { ctx, tape, drums, master, reverb, pops, noiseBuf, wobbleAmt } = buses;

  /** Rhodes-ish electric piano: sine + dying octave overtone, tape wobble. */
  function playKey(note: string, time: number, dur: number, vel: number) {
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
  }

  /** Softer kalimba-ish pluck: triangle with a fast die-away. */
  function playPluck(note: string, time: number, dur: number, vel: number) {
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
  }

  /** Music box: pure high sine with a faint inharmonic partial, long ring. */
  function playBell(note: string, time: number, vel: number) {
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
  }

  /** Warm pad: two detuned triangles per tone, slow swell under the chord. */
  function playPad(notes: string[], time: number, dur: number, vel: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel, time + dur * 0.35);
    g.gain.setValueAtTime(vel, time + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    g.connect(tape);
    for (const note of notes) {
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = freq(note);
        o.detune.value = detune;
        wobbleAmt.connect(o.detune);
        o.connect(g);
        o.start(time);
        o.stop(time + dur + 0.1);
      }
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

  /** Nylon-string guitar: Karplus-Strong pluck, softened for the tape. */
  function playGuitar(note: string, time: number, dur: number, vel: number) {
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
  }

  /** Upright-ish plucked bass: dark Karplus-Strong over a sine sub. */
  function playPluckBass(note: string, time: number, dur: number, vel: number) {
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
  }

  /** DX-style FM electric piano: sine carrier, 1:1 modulator that barks then mellows. */
  function playFmKey(note: string, time: number, dur: number, vel: number) {
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
    g.gain.exponentialRampToValueAtTime(vel, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    car.connect(g).connect(tape);
    car.start(time); mod.start(time);
    car.stop(time + dur + 0.1); mod.stop(time + dur + 0.1);
  }

  // drawbar-ish spectrum shared by every organ note
  const organWave = (() => {
    const real = new Float32Array(9);
    const imag = new Float32Array(9);
    imag[1] = 1; imag[2] = 0.65; imag[3] = 0.35; imag[4] = 0.3; imag[6] = 0.15; imag[8] = 0.08;
    return ctx.createPeriodicWave(real, imag);
  })();

  /** Dusty chapel organ: sustained drawbar tone with a soft swell on and off. */
  function playOrgan(note: string, time: number, dur: number, vel: number) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(organWave);
    o.frequency.value = freq(note);
    wobbleAmt.connect(o.detune);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel, time + 0.05);
    g.gain.setValueAtTime(vel, time + Math.max(0.05, dur - 0.25));
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(tape);
    o.start(time); o.stop(time + dur + 0.1);
  }

  /** Worn string machine: detuned saw pair, lowpassed, swelling like a pad. */
  function playStrings(note: string, time: number, dur: number, vel: number) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, time);
    lp.frequency.linearRampToValueAtTime(1500, time + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(800, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel, time + dur * 0.3);
    g.gain.setValueAtTime(vel, time + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, time + dur);
    lp.connect(g).connect(tape);
    for (const detune of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq(note);
      o.detune.value = detune;
      wobbleAmt.connect(o.detune);
      o.connect(lp);
      o.start(time); o.stop(time + dur + 0.1);
    }
  }

  /** Vibraphone: sine plus a fast-dying 4th partial, shimmering tremolo. */
  function playVibe(note: string, time: number, dur: number, vel: number) {
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
  }

  /** Round sine bass. */
  function playBass(note: string, time: number, dur: number, vel: number) {
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
  }

  function playKick(time: number, vel: number) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, time);
    o.frequency.exponentialRampToValueAtTime(42, time + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.4);
    o.connect(g).connect(drums);
    o.start(time); o.stop(time + 0.45);
  }

  function playSnare(time: number, vel: number) {
    // noise crack
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, time);
    ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    n.connect(bp).connect(ng);
    ng.connect(drums);
    ng.connect(reverb);
    n.start(time); n.stop(time + 0.2);
    // tonal body
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 185;
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.3, time);
    og.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    o.connect(og).connect(drums);
    o.start(time); o.stop(time + 0.12);
  }

  function playHat(time: number, vel: number) {
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
    lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.012, time + 1.2);
    g.gain.setValueAtTime(0.012, time + 2);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 4);
    lp.connect(g);
    g.connect(master);
    g.connect(reverb);
    for (const f of [233, 277]) { // a moody minor third
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.setValueAtTime(0, time);
      o.detune.linearRampToValueAtTime(-30, time + 4); // drifting away
      o.connect(lp);
      o.start(time); o.stop(time + 4.2);
    }
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
    playKey, playPluck, playBell, playPad, playBass,
    playGuitar, playPluckBass, playFmKey, playOrgan, playStrings, playVibe,
    playKick, playSnare, playHat, playShaker, playRim, playBrush,
    playPop, playThunder, playCrickets, playNeedleDrop,
    playOwl, playChimes, playTrainHorn,
  };
}

export type Voices = ReturnType<typeof createVoices>;
