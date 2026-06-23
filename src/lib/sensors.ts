/**
 * Pure, DOM-free maths behind the `sensors` capture snapshot
 * (`SutraPadCaptureSensorsSnapshot`). The browser-API plumbing that feeds
 * these functions — `DeviceMotion` listeners, `getUserMedia` + an
 * `AnalyserNode` — lives in `capture-context.ts`; everything that decides
 * *what the numbers mean* lives here so it can be unit- and mutation-tested
 * without faking sensors.
 */

/**
 * Minimum accelerometer samples required before `classifyMotion` will commit
 * to a verdict. A single reading can't distinguish a stationary device from
 * one caught mid-jolt, so below this count we return `undefined` and the
 * `sensors` snapshot simply omits `motionStatus`.
 */
export const MOTION_MIN_SAMPLES = 4;

/**
 * Standard-deviation threshold (in m/s²) on the accelerometer-magnitude
 * window that separates "still" from "moving". A device at rest reports a
 * near-constant magnitude (~9.81 from gravity) with only sensor noise, so its
 * stddev sits well below 0.5; carrying or walking introduces multi-m/s²
 * swings that clear it comfortably.
 */
export const MOTION_MOVING_STDDEV_THRESHOLD = 0.5;

/**
 * Floor for the reported dBFS noise level. A truly silent (all-zero) sample
 * would compute to −Infinity, so we clamp to a sane, finite minimum.
 */
export const NOISE_FLOOR_DB = -100;

/** Type guard for a usable sensor reading: a finite (non-NaN, non-Infinity) number. */
function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value);
}

/**
 * Euclidean magnitude of an accelerometer reading. Returns `undefined` unless
 * all three axes are finite numbers, so a partial/garbage `DeviceMotionEvent`
 * contributes no sample instead of a `NaN` that would poison the variance.
 */
export function accelerationMagnitude(
  x: number | null | undefined,
  y: number | null | undefined,
  z: number | null | undefined,
): number | undefined {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return undefined;
  }
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Classifies a window of accelerometer-magnitude samples as `"still"` or
 * `"moving"` from their standard deviation. Non-finite samples are dropped
 * first; if fewer than `MOTION_MIN_SAMPLES` usable readings remain the result
 * is `undefined` (not enough signal to judge).
 */
export function classifyMotion(
  magnitudes: readonly number[],
): "still" | "moving" | undefined {
  const finite = magnitudes.filter((value) => isFiniteNumber(value));
  if (finite.length < MOTION_MIN_SAMPLES) return undefined;

  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance =
    finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  const stddev = Math.sqrt(variance);

  return stddev >= MOTION_MOVING_STDDEV_THRESHOLD ? "moving" : "still";
}

/**
 * Converts a window of time-domain audio samples (each in the [-1, 1] range
 * produced by `AnalyserNode.getFloatTimeDomainData`) into an uncalibrated
 * dBFS loudness figure: `20 * log10(rms)`, rounded, clamped to
 * `[NOISE_FLOOR_DB, 0]`. Non-finite samples are skipped; an empty or
 * all-non-finite window returns `undefined`. A fully silent window computes
 * `log10(0) = -Infinity`, which the lower clamp maps to `NOISE_FLOOR_DB`.
 */
export function computeNoiseLevelDb(
  samples: readonly number[] | Float32Array,
): number | undefined {
  let sumSquares = 0;
  let count = 0;
  for (const sample of samples) {
    if (!isFiniteNumber(sample)) continue;
    sumSquares += sample * sample;
    count += 1;
  }
  if (count === 0) return undefined;

  const rms = Math.sqrt(sumSquares / count);
  const db = 20 * Math.log10(rms);
  return Math.round(Math.min(Math.max(db, NOISE_FLOOR_DB), 0));
}
