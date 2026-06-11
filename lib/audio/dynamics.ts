// Mix dynamics — gentle glue compression and scheduled sidechain ducking.
// Web Audio has no external sidechain input on DynamicsCompressorNode, so
// ducking is driven from the scheduler alongside kicks and bass hits.

export interface MixDynamics {
  /** Melodic bus lands here (after the tape lowpass). */
  input: GainNode;
  /** Duckable mix bus — also accepts the reverb return. */
  mix: GainNode;
  /** Duck the main mix to make room for kick/bass/undertone. */
  triggerDuck(time: number, depth?: number, releaseSec?: number): void;
}

export function createMixDynamics(ctx: AudioContext): MixDynamics {
  const input = ctx.createGain();
  input.gain.value = 1.04; // light makeup for the compressor

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 9;
  comp.ratio.value = 2.6;
  comp.attack.value = 0.007;
  comp.release.value = 0.17;

  const duck = ctx.createGain();
  duck.gain.value = 1;

  const mix = ctx.createGain();
  mix.gain.value = 1;

  input.connect(comp);
  comp.connect(duck);
  duck.connect(mix);

  function triggerDuck(time: number, depth = 0.76, releaseSec = 0.2) {
    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(duck.gain.value, time);
    duck.gain.linearRampToValueAtTime(depth, time + 0.006);
    duck.gain.setTargetAtTime(1, time + 0.006, releaseSec * 0.38);
  }

  return { input, mix, triggerDuck };
}

/** Light drum-bus glue — keeps kicks/snares present without squashing. */
export function createDrumDynamics(ctx: AudioContext, out: AudioNode): GainNode {
  const input = ctx.createGain();
  input.gain.value = 1;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 6;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.11;

  input.connect(comp);
  comp.connect(out);
  return input;
}
