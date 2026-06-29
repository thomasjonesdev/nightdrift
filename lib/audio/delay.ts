// Tempo-synced feedback delay — wet/dry parallel on the melodic bus.

/** Delay time in seconds for a beat fraction at the given BPM. */
export function tempoDelaySeconds(bpm: number, beatFraction = 0.75): number {
  const beat = 60 / Math.max(40, bpm);
  return beat * beatFraction;
}

export interface TempoDelayMix {
  wet: number;
  feedback: number;
}

export interface TempoDelay {
  input: GainNode;
  output: GainNode;
  /** Sync delay time to BPM (default: dotted eighth = 0.75 beats). */
  setBpm(bpm: number, time: number, beatFraction?: number): void;
  setMix(mix: TempoDelayMix, time: number, rampSecs?: number): void;
}

export function createTempoDelay(ctx: AudioContext): TempoDelay {
  const input = ctx.createGain();
  input.gain.value = 1;

  const dry = ctx.createGain();
  dry.gain.value = 1;

  const delayLine = ctx.createDelay(3);
  delayLine.delayTime.value = tempoDelaySeconds(72);

  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;

  const wet = ctx.createGain();
  wet.gain.value = 0.36;

  const fbFilter = ctx.createBiquadFilter();
  fbFilter.type = "lowpass";
  fbFilter.frequency.value = 2400;
  fbFilter.Q.value = 0.6;

  const output = ctx.createGain();
  output.gain.value = 1;

  input.connect(dry);
  input.connect(delayLine);
  delayLine.connect(fbFilter).connect(feedback).connect(delayLine);
  delayLine.connect(wet);
  dry.connect(output);
  wet.connect(output);

  let beatFraction = 0.75;

  return {
    input,
    output,
    setBpm(bpm, time, fraction = beatFraction) {
      beatFraction = fraction;
      const target = tempoDelaySeconds(bpm, beatFraction);
      delayLine.delayTime.cancelScheduledValues(time);
      delayLine.delayTime.setValueAtTime(delayLine.delayTime.value, time);
      delayLine.delayTime.linearRampToValueAtTime(target, time + 0.06);
    },
    setMix(mix, time, rampSecs = 2.5) {
      wet.gain.cancelScheduledValues(time);
      wet.gain.setValueAtTime(wet.gain.value, time);
      wet.gain.setTargetAtTime(mix.wet, time, rampSecs);

      feedback.gain.cancelScheduledValues(time);
      feedback.gain.setValueAtTime(feedback.gain.value, time);
      feedback.gain.setTargetAtTime(mix.feedback, time, rampSecs);
    },
  };
}
