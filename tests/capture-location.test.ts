import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CAPTURE_LOCATION_PREFERENCE,
  isCaptureLocationPreference,
  isLocationCaptureEnabled,
  loadStoredCaptureLocationPreference,
  persistCaptureLocationPreference,
  requiresLocationConsent,
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

const STORAGE_KEY = "sutrapad-capture-location-consent";

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
  it("accepts the three known values", () => {
    expect(isCaptureLocationPreference("on")).toBe(true);
    expect(isCaptureLocationPreference("off")).toBe(true);
    expect(isCaptureLocationPreference("unanswered")).toBe(true);
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

  it("returns the stored value for all three tri-state members", () => {
    expect(
      loadStoredCaptureLocationPreference(createStorageMock("off")),
    ).toBe("off");
    expect(
      loadStoredCaptureLocationPreference(createStorageMock("unanswered")),
    ).toBe("unanswered");
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

  it("reads from the consent-keyed slot, not the legacy enabled-keyed one", () => {
    // The pre-tristate shape used `sutrapad-capture-location-enabled`.
    // Values at that key must NOT leak into the new tristate world —
    // a stored `"off"` there came from a default-persisted atom, not
    // an explicit user decision, and surfacing it would defeat the
    // whole point of `"unanswered"`. Multi-key mock so the legacy key
    // and the new key can hold distinct values like real localStorage.
    const store = new Map<string, string>();
    store.set("sutrapad-capture-location-enabled", "off");
    const multiKeyStorage: Pick<Storage, "getItem"> = {
      getItem: (key: string) => store.get(key) ?? null,
    };
    expect(loadStoredCaptureLocationPreference(multiKeyStorage)).toBeNull();
  });
});

describe("persistCaptureLocationPreference", () => {
  it("writes the preference to the consent-keyed slot in storage", () => {
    const storage = createStorageMock();
    persistCaptureLocationPreference("on", storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem(STORAGE_KEY)).toBe("on");
  });

  it("uses the exact 'sutrapad-capture-location-consent' storage key when writing", () => {
    // Pin the literal key string so a future refactor (or a Stryker
    // mutation that empties it) doesn't silently re-key Filip's
    // existing preference into a different localStorage slot and lose
    // the decision. Strict-key mock asserts the call argument.
    const setItem = vi.fn();
    persistCaptureLocationPreference("on", { setItem });
    expect(setItem).toHaveBeenCalledWith(
      "sutrapad-capture-location-consent",
      "on",
    );
  });

  it("round-trips every tri-state value through persist + load", () => {
    const storage = createStorageMock();
    for (const value of ["on", "off", "unanswered"] as const) {
      persistCaptureLocationPreference(value, storage);
      expect(loadStoredCaptureLocationPreference(storage)).toBe(value);
    }
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

  it("ships unanswered by default — first-run users get the consent card, not a silent native prompt and not a silent off", () => {
    // Pinned guard for the consent-by-default invariant. Reverting the
    // default to `"on"` would silently fire `getCurrentPosition`; reverting
    // to `"off"` would re-introduce the "default state is indistinguishable
    // from an explicit user decision" bug. Both regressions should fail
    // loudly here.
    expect(DEFAULT_CAPTURE_LOCATION_PREFERENCE).toBe("unanswered");
  });
});

describe("isLocationCaptureEnabled", () => {
  it("returns true only for the 'on' preference", () => {
    expect(isLocationCaptureEnabled("on")).toBe(true);
    expect(isLocationCaptureEnabled("off")).toBe(false);
    expect(isLocationCaptureEnabled("unanswered")).toBe(false);
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

describe("requiresLocationConsent", () => {
  it("returns true only for 'unanswered'", () => {
    expect(requiresLocationConsent("unanswered")).toBe(true);
    expect(requiresLocationConsent("on")).toBe(false);
    expect(requiresLocationConsent("off")).toBe(false);
  });

  it("is the strict logical complement of an explicit decision", () => {
    // requiresConsent <=> !isExplicitDecision. Pin the relationship so a
    // future change that loosens one but not the other can't drift the
    // two flags out of sync — the consent card relies on this to know
    // when it should disappear.
    const cases: CaptureLocationPreference[] = ["on", "off", "unanswered"];
    for (const value of cases) {
      const explicit = value === "on" || value === "off";
      expect(requiresLocationConsent(value)).toBe(!explicit);
    }
  });
});
