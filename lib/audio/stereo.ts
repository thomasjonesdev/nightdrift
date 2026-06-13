// Stereo spread — gentle width from mono-ish Web Audio paths.
// Keeps bass/kick centered; decorrelates upper content with a balanced Haas pair.

export interface StereoSpread {
  input: GainNode;
  output: GainNode;
}

/** Widen a mono bus into stereo without hard panning. `amount` ≈ 0.15–0.35. */
export function createStereoSpread(ctx: AudioContext, amount: number): StereoSpread {
  const input = ctx.createGain();
  const output = ctx.createGain();
  output.channelCount = 2;
  output.channelCountMode = "explicit";

  const merger = ctx.createChannelMerger(2);

  const delayMs = 0.007 + amount * 0.016;
  const wet = 0.78 + amount * 0.14;
  const cross = amount * 0.28;

  const leftHp = ctx.createBiquadFilter();
  leftHp.type = "highpass";
  leftHp.frequency.value = 100;
  const leftGain = ctx.createGain();
  leftGain.gain.value = 1;

  const delay = ctx.createDelay(0.03);
  delay.delayTime.value = delayMs;
  const rightHp = ctx.createBiquadFilter();
  rightHp.type = "highpass";
  rightHp.frequency.value = 100;
  const rightGain = ctx.createGain();
  rightGain.gain.value = wet;

  const leftCross = ctx.createGain();
  leftCross.gain.value = cross;
  const rightCross = ctx.createGain();
  rightCross.gain.value = cross;

  input.connect(leftHp).connect(leftGain).connect(merger, 0, 0);
  input.connect(delay).connect(rightHp).connect(rightGain).connect(merger, 0, 1);
  input.connect(leftCross).connect(merger, 0, 1);
  input.connect(rightCross).connect(merger, 0, 0);

  merger.connect(output);
  return { input, output };
}
