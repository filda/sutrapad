import { describe, expect, it } from "vitest";
import {
  accelerationMagnitude,
  classifyMotion,
  computeNoiseLevelDb,
  MOTION_MIN_SAMPLES,
  NOISE_FLOOR_DB,
} from "../src/lib/sensors";

describe("accelerationMagnitude", () => {
  it("computes the Euclidean norm of three finite axes", () => {
    expect(accelerationMagnitude(3, 4, 0)).toBe(5);
    expect(accelerationMagnitude(0, 0, 0)).toBe(0);
    expect(accelerationMagnitude(1, 2, 2)).toBe(3);
  });

  it.each([
    ["x null", null, 1, 1],
    ["y undefined", 1, undefined, 1],
    ["z null", 1, 1, null],
    ["x NaN", Number.NaN, 1, 1],
    ["y Infinity", 1, Number.POSITIVE_INFINITY, 1],
    ["z -Infinity", 1, 1, Number.NEGATIVE_INFINITY],
  ] as const)("returns undefined when %s", (_label, x, y, z) => {
    expect(accelerationMagnitude(x, y, z)).toBeUndefined();
  });
});

describe("classifyMotion", () => {
  it("returns undefined below the minimum sample count", () => {
    // MOTION_MIN_SAMPLES - 1 readings is never enough to judge.
    const tooFew = Array.from({ length: MOTION_MIN_SAMPLES - 1 }, () => 9.81);
    expect(classifyMotion(tooFew)).toBeUndefined();
  });

  it("returns undefined when non-finite values drop the count below the minimum", () => {
    // Three finite + filler non-finite: filtered length is 3 < 4.
    expect(
      classifyMotion([9.81, 9.82, 9.8, Number.NaN, Number.POSITIVE_INFINITY]),
    ).toBeUndefined();
  });

  it("classifies a near-constant magnitude window as still", () => {
    expect(classifyMotion([9.81, 9.82, 9.8, 9.81, 9.79])).toBe("still");
  });

  it("classifies a high-variance window as moving", () => {
    expect(classifyMotion([8, 12, 7, 13, 9])).toBe("moving");
  });

  it("treats the threshold stddev (0.5) as moving (>= boundary)", () => {
    // mean 10, deviations ±0.5 -> variance 0.25 -> stddev exactly 0.5.
    expect(classifyMotion([9.5, 10.5, 9.5, 10.5])).toBe("moving");
  });

  it("treats stddev just under the threshold as still", () => {
    // mean 10, deviations ±0.4 -> stddev 0.4 < 0.5.
    expect(classifyMotion([9.6, 10.4, 9.6, 10.4])).toBe("still");
  });

  it("ignores non-finite samples but keeps the verdict when enough remain", () => {
    expect(
      classifyMotion([9.5, 10.5, 9.5, 10.5, Number.NaN]),
    ).toBe("moving");
  });
});

describe("computeNoiseLevelDb", () => {
  it("returns undefined for an empty window", () => {
    expect(computeNoiseLevelDb([])).toBeUndefined();
    expect(computeNoiseLevelDb(new Float32Array(0))).toBeUndefined();
  });

  it("returns undefined when every sample is non-finite", () => {
    expect(
      computeNoiseLevelDb([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]),
    ).toBeUndefined();
  });

  it("reports 0 dBFS for a full-scale signal", () => {
    expect(computeNoiseLevelDb([1, -1, 1, -1])).toBe(0);
  });

  it("converts RMS to dBFS for a known amplitude", () => {
    // rms 0.1 -> 20*log10(0.1) = -20.
    expect(computeNoiseLevelDb([0.1, -0.1, 0.1, -0.1])).toBe(-20);
  });

  it("clamps silence to the floor instead of -Infinity", () => {
    expect(computeNoiseLevelDb([0, 0, 0, 0])).toBe(NOISE_FLOOR_DB);
  });

  it("clamps an out-of-range loud sample to 0", () => {
    // rms 2 -> +6 dB, clamped down to 0.
    expect(computeNoiseLevelDb([2, -2])).toBe(0);
  });

  it("clamps an extremely quiet signal to the floor", () => {
    // rms 1e-10 -> -200 dB, clamped up to the floor.
    expect(computeNoiseLevelDb([1e-10, -1e-10])).toBe(NOISE_FLOOR_DB);
  });

  it("skips non-finite samples and measures the finite remainder", () => {
    expect(
      computeNoiseLevelDb([Number.NaN, 1, -1, Number.POSITIVE_INFINITY]),
    ).toBe(0);
  });

  it("reads a Float32Array window", () => {
    expect(computeNoiseLevelDb(Float32Array.from([0.1, -0.1, 0.1, -0.1]))).toBe(-20);
  });
});
