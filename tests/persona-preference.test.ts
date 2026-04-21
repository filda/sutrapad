import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PERSONA_PREFERENCE,
  isPersonaEnabled,
  isPersonaPreference,
  loadStoredPersonaPreference,
  persistPersonaPreference,
  resolveInitialPersonaPreference,
} from "../src/app/logic/persona";

function createStorageStub(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    snapshot: () => Object.fromEntries(store),
  };
}

describe("persona preference default", () => {
  it("defaults to off so existing users never see a sudden visual shift", () => {
    expect(DEFAULT_PERSONA_PREFERENCE).toBe("off");
  });
});

describe("isPersonaPreference", () => {
  it("accepts the two known preference strings", () => {
    expect(isPersonaPreference("on")).toBe(true);
    expect(isPersonaPreference("off")).toBe(true);
  });

  it("rejects unknown strings and non-string values", () => {
    expect(isPersonaPreference("true")).toBe(false);
    expect(isPersonaPreference("enabled")).toBe(false);
    expect(isPersonaPreference("")).toBe(false);
    expect(isPersonaPreference(null)).toBe(false);
    expect(isPersonaPreference(undefined)).toBe(false);
    expect(isPersonaPreference(1)).toBe(false);
    expect(isPersonaPreference(true)).toBe(false);
    expect(isPersonaPreference({ enabled: true })).toBe(false);
  });
});

describe("loadStoredPersonaPreference", () => {
  it("returns the stored value when it is a known preference", () => {
    const storage = createStorageStub({ "sutrapad-persona-enabled": "on" });
    expect(loadStoredPersonaPreference(storage)).toBe("on");
    expect(storage.getItem).toHaveBeenCalledWith("sutrapad-persona-enabled");
  });

  it("returns null when nothing is stored", () => {
    const storage = createStorageStub();
    expect(loadStoredPersonaPreference(storage)).toBeNull();
  });

  it("returns null when the stored value is not a known preference", () => {
    // Defensive: protects against a legacy boolean literal or hand-edited
    // localStorage value; we'd rather fall back to the default than crash.
    const storage = createStorageStub({ "sutrapad-persona-enabled": "true" });
    expect(loadStoredPersonaPreference(storage)).toBeNull();
  });
});

describe("persistPersonaPreference", () => {
  it("writes the preference under the documented storage key", () => {
    const storage = createStorageStub();
    persistPersonaPreference("on", storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      "sutrapad-persona-enabled",
      "on",
    );
    expect(storage.snapshot()).toEqual({ "sutrapad-persona-enabled": "on" });
  });

  it("overwrites any previously stored preference", () => {
    const storage = createStorageStub({ "sutrapad-persona-enabled": "on" });
    persistPersonaPreference("off", storage);
    expect(storage.snapshot()).toEqual({ "sutrapad-persona-enabled": "off" });
  });
});

describe("resolveInitialPersonaPreference", () => {
  it("returns the stored preference when one exists", () => {
    const storage = createStorageStub({ "sutrapad-persona-enabled": "on" });
    expect(resolveInitialPersonaPreference(storage)).toBe("on");
  });

  it("falls back to the default when nothing is stored", () => {
    const storage = createStorageStub();
    expect(resolveInitialPersonaPreference(storage)).toBe(
      DEFAULT_PERSONA_PREFERENCE,
    );
  });

  it("falls back to the default when the stored value is invalid", () => {
    const storage = createStorageStub({ "sutrapad-persona-enabled": "maybe" });
    expect(resolveInitialPersonaPreference(storage)).toBe(
      DEFAULT_PERSONA_PREFERENCE,
    );
  });
});

describe("isPersonaEnabled", () => {
  it("returns true only for the 'on' preference", () => {
    expect(isPersonaEnabled("on")).toBe(true);
    expect(isPersonaEnabled("off")).toBe(false);
  });
});
