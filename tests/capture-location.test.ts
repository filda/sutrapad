import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CAPTURE_LOCATION_PREFERENCE,
  isCaptureLocationPreference,
  isLocationCaptureEnabled,
  loadStoredCaptureLocationPreference,
  persistCaptureLocationPreference,
  resolveInitialCaptureLocationPreference,
  type CaptureLocationPreference,
} from "../src/app/logic/capture-location";

/**
 * Mirrors the persona-preference test shape — the modules are
 * structural twins (same load/persist/resolveInitial trio + a boolean
 * convenience). Re-using the shape keeps the contract grep-able and
 * makes the eventual "extract a tiny preference helper" refactor
 * obvious if a third one ever shows up.
 */

function createStorageMock(initial?: string): Pick<Storage, "getItem" | "setItem"> {
  let value: string | null = initial ?? null;
  return {
    getItem: vi.fn((_key: string) => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

describe("isCaptureLocationPreference", () => {
  it("accepts the two known values", () => {
    expect(isCaptureLocationPreference("on")).toBe(true);
    expect(isCaptureLocationPreference("off")).toBe(true);
  });

  it("rejects every other shape", () => {
    expect(isCaptureLocationPreference("yes")).toBe(false);
    expect(isCaptureLocationPreference("ON")).toBe(false);
    expect(isCaptureLocationPreference("")).toBe(false);
    expect(isCaptureLocationPreference(null)).toBe(false);
    expect(isCaptureLocationPreference(undefined)).toBe(false);
    expect(isCaptureLocationPreference(true)).toBe(false);
    expect(isCaptureLocationPreference(1)).toBe(false);
    expect(isCaptureLocationPreference({})).toBe(false);
  });
});

describe("loadStoredCaptureLocationPreference", () => {
  it("returns the stored value when valid", () => {
    const storage = createStorageMock("on");
    expect(loadStoredCaptureLocationPreference(storage)).toBe("on");
  });

  it("returns null for an unset key", () => {
    const storage = createStorageMock();
    expect(loadStoredCaptureLocationPreference(storage)).toBeNull();
  });

  it("returns null for an unrecognised stored value", () => {
    // A previous shape (e.g. legacy `true`/`false` literals) must not
    // be accepted as a valid preference — fall back to null so
    // resolveInitial can apply the default.
    const storage = createStorageMock("true");
    expect(loadStoredCaptureLocationPreference(storage)).toBeNull();
  });
});

describe("persistCaptureLocationPreference", () => {
  it("writes the preference to the configured storage", () => {
    const storage = createStorageMock();
    persistCaptureLocationPreference("on", storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem("sutrapad-capture-location-enabled")).toBe("on");
  });

  it("round-trips through persist + load", () => {
    const storage = createStorageMock();
    persistCaptureLocationPreference("on", storage);
    expect(loadStoredCaptureLocationPreference(storage)).toBe("on");
    persistCaptureLocationPreference("off", storage);
    expect(loadStoredCaptureLocationPreference(storage)).toBe("off");
  });
});

describe("resolveInitialCaptureLocationPreference", () => {
  it("returns the stored value when present and valid", () => {
    const storage = createStorageMock("on");
    expect(resolveInitialCaptureLocationPreference(storage)).toBe("on");
  });

  it("falls back to the default when nothing is stored", () => {
    const storage = createStorageMock();
    expect(resolveInitialCaptureLocationPreference(storage)).toBe(
      DEFAULT_CAPTURE_LOCATION_PREFERENCE,
    );
  });

  it("falls back to the default for garbage stored values", () => {
    const storage = createStorageMock("¯\\_(ツ)_/¯");
    expect(resolveInitialCaptureLocationPreference(storage)).toBe(
      DEFAULT_CAPTURE_LOCATION_PREFERENCE,
    );
  });

  it("ships off by default — no surprise location prompt for cold-start users", () => {
    // Pinned guard for the privacy-by-default invariant. If a future
    // change flips the default to "on", this test should fail loudly
    // rather than letting the regression slip through.
    expect(DEFAULT_CAPTURE_LOCATION_PREFERENCE).toBe("off");
  });
});

describe("isLocationCaptureEnabled", () => {
  it("returns true only for the 'on' preference", () => {
    expect(isLocationCaptureEnabled("on")).toBe(true);
    expect(isLocationCaptureEnabled("off")).toBe(false);
  });

  it("treats every non-'on' value as off (TS-narrow exhaustive but defensive)", () => {
    // The TypeScript-narrow signature only accepts the union, but at
    // runtime a future caller could feed in something else (e.g. a
    // stored garbage value that bypassed the load helper). Pin the
    // strict-equality semantics so any flip to truthy-coercion would
    // be caught here.
    const cast = (value: string): CaptureLocationPreference =>
      value as CaptureLocationPreference;
    expect(isLocationCaptureEnabled(cast(""))).toBe(false);
    expect(isLocationCaptureEnabled(cast("On"))).toBe(false);
    expect(isLocationCaptureEnabled(cast("yes"))).toBe(false);
  });
});
