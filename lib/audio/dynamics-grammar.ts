// Dynamics grammar — duck profiles and tape saturation bursts driven by DNA.

export type DuckProfile = "kick" | "snare" | "bass" | "undertone";

const DUCK_PROFILES: Record<DuckProfile, { depth: number; attackSec: number; releaseSec: number }> = {
  kick: { depth: 0.74, attackSec: 0.006, releaseSec: 0.22 },
  snare: { depth: 0.9, attackSec: 0.004, releaseSec: 0.09 },
  bass: { depth: 0.87, attackSec: 0.005, releaseSec: 0.14 },
  undertone: { depth: 0.92, attackSec: 0.008, releaseSec: 0.18 },
};

/** Resolve duck depth/release for a hit type, scaled by scene duckMul. */
export function duckForProfile(
  profile: DuckProfile,
  duckMul: number,
): { depth: number; releaseSec: number } {
  const p = DUCK_PROFILES[profile];
  const depth = 1 - (1 - p.depth) * duckMul;
  return { depth, releaseSec: p.releaseSec * (0.85 + 0.15 * duckMul) };
}

/** Soft-clipping curve for gentle tape saturation. */
export function makeSaturationCurve(amount: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  const k = Math.max(0.01, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** Brief tape-drive swell paired with filter dips. */
export function triggerSaturationBurst(
  drive: GainNode,
  time: number,
  intensity: number,
  baseDrive = 1,
): void {
  const peak = baseDrive + intensity * 0.35;
  drive.gain.cancelScheduledValues(time);
  drive.gain.setValueAtTime(drive.gain.value, time);
  drive.gain.linearRampToValueAtTime(peak, time + 0.012);
  drive.gain.setTargetAtTime(baseDrive, time + 0.02, 0.45 + intensity * 0.35);
}
