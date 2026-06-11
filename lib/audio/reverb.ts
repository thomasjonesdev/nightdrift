// Scene reverb — per-band space via wet level, tail length, and damping.
// Two convolvers crossfade at segues so decay changes don't click.

export interface ReverbSpec {
  /** Wet return level — 0.12 (intimate) to 0.48 (cathedral). */
  send: [number, number];
  /** Impulse tail length in seconds. */
  decay: [number, number];
  /** Wet return lowpass — lower feels more distant and absorbed. */
  damp: [number, number];
}

export interface ReverbPalette {
  send: number;
  decay: number;
  damp: number;
}

export function makeReverbIR(ctx: AudioContext, decaySecs: number): AudioBuffer {
  const irLen = Math.floor(ctx.sampleRate * decaySecs);
  const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
  const exp = 2.2 + Math.max(0, decaySecs - 1) * 0.12;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, exp);
    }
  }
  return ir;
}

export interface SceneReverb {
  /** Send destination for the tape bus and per-voice reverb feeds. */
  input: GainNode;
  set(palette: ReverbPalette, time: number, fast?: boolean): void;
}

export function createSceneReverb(ctx: AudioContext, out: AudioNode): SceneReverb {
  const input = ctx.createGain();
  input.gain.value = 1;

  const convA = ctx.createConvolver();
  const convB = ctx.createConvolver();
  const wetA = ctx.createGain();
  const wetB = ctx.createGain();
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 3200;
  const returnGain = ctx.createGain();
  returnGain.gain.value = 0.3;

  convA.buffer = makeReverbIR(ctx, 2.8);
  wetA.gain.value = 1;
  wetB.gain.value = 0;

  input.connect(convA);
  input.connect(convB);
  convA.connect(wetA);
  convB.connect(wetB);
  wetA.connect(damp);
  wetB.connect(damp);
  damp.connect(returnGain);
  returnGain.connect(out);

  let activeA = true;

  return {
    input,
    set(palette, time, fast = false) {
      const cross = fast ? 0.6 : 2.8;
      returnGain.gain.cancelScheduledValues(time);
      returnGain.gain.setValueAtTime(returnGain.gain.value, time);
      returnGain.gain.setTargetAtTime(palette.send, time, fast ? 0.5 : 2.5);
      damp.frequency.setTargetAtTime(palette.damp, time, fast ? 0.5 : 2.5);

      const nextConv = activeA ? convB : convA;
      const nextWet = activeA ? wetB : wetA;
      const curWet = activeA ? wetA : wetB;

      nextConv.buffer = makeReverbIR(ctx, palette.decay);
      nextWet.gain.cancelScheduledValues(time);
      nextWet.gain.setValueAtTime(0, time);
      nextWet.gain.linearRampToValueAtTime(1, time + cross);
      curWet.gain.cancelScheduledValues(time);
      curWet.gain.setValueAtTime(curWet.gain.value, time);
      curWet.gain.linearRampToValueAtTime(0, time + cross);
      activeA = !activeA;
    },
  };
}
