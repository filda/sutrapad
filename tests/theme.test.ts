import { describe, expect, it, vi } from "vitest";
import {
  applyThemeChoice,
  DEFAULT_THEME_CHOICE,
  isDarkThemeId,
  isThemeChoice,
  loadStoredThemeChoice,
  persistThemeChoice,
  resolveInitialThemeChoice,
  resolveThemeId,
  THEMES,
} from "../src/app/logic/theme";

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

describe("theme catalogue", () => {
  it("lists all expected themes in the expected order with the auto stance first", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual([
      "auto",
      "sand",
      "paper",
      "forest",
      "midnight",
      "dark",
      "parchment",
      "parchment-dark",
    ]);
  });

  it("gives every theme a non-empty label, description, and full swatch set", () => {
    for (const theme of THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.description.length).toBeGreaterThan(0);
      expect(theme.swatches.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.swatches.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(theme.swatches.background).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has unique ids", () => {
    const ids = THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults to auto so new devices follow the OS preference", () => {
    expect(DEFAULT_THEME_CHOICE).toBe("auto");
  });
});

describe("isThemeChoice", () => {
  it("accepts every known theme id including the auto stance", () => {
    for (const theme of THEMES) {
      expect(isThemeChoice(theme.id)).toBe(true);
    }
  });

  it("rejects unknown strings and non-string values", () => {
    expect(isThemeChoice("neon")).toBe(false);
    expect(isThemeChoice("")).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
    expect(isThemeChoice(undefined)).toBe(false);
    expect(isThemeChoice(42)).toBe(false);
    expect(isThemeChoice({ id: "sand" })).toBe(false);
  });
});

describe("loadStoredThemeChoice", () => {
  it("returns the stored value when it is a known theme", () => {
    const storage = createStorageStub({ "sutrapad-theme": "dark" });
    expect(loadStoredThemeChoice(storage)).toBe("dark");
    expect(storage.getItem).toHaveBeenCalledWith("sutrapad-theme");
  });

  it("returns null when nothing is stored", () => {
    const storage = createStorageStub();
    expect(loadStoredThemeChoice(storage)).toBeNull();
  });

  it("returns null when the stored value is not a known theme (e.g. after a theme was removed)", () => {
    const storage = createStorageStub({ "sutrapad-theme": "neon" });
    expect(loadStoredThemeChoice(storage)).toBeNull();
  });
});

describe("persistThemeChoice", () => {
  it("writes the choice under the documented storage key", () => {
    const storage = createStorageStub();
    persistThemeChoice("forest", storage);
    expect(storage.setItem).toHaveBeenCalledWith("sutrapad-theme", "forest");
    expect(storage.snapshot()).toEqual({ "sutrapad-theme": "forest" });
  });

  it("overwrites any previously stored choice", () => {
    const storage = createStorageStub({ "sutrapad-theme": "dark" });
    persistThemeChoice("paper", storage);
    expect(storage.snapshot()).toEqual({ "sutrapad-theme": "paper" });
  });
});

describe("resolveThemeId", () => {
  it("returns a concrete theme unchanged", () => {
    expect(resolveThemeId("sand", { matches: false })).toBe("sand");
    expect(resolveThemeId("paper", { matches: false })).toBe("paper");
    expect(resolveThemeId("forest", { matches: true })).toBe("forest");
    expect(resolveThemeId("midnight", { matches: false })).toBe("midnight");
    expect(resolveThemeId("dark", { matches: false })).toBe("dark");
  });

  it("maps auto to dark when the OS reports a dark preference", () => {
    expect(resolveThemeId("auto", { matches: true })).toBe("dark");
  });

  it("maps auto to sand when the OS reports a light preference", () => {
    expect(resolveThemeId("auto", { matches: false })).toBe("sand");
  });

  it("maps auto to sand when no matchMedia is available", () => {
    expect(resolveThemeId("auto", null)).toBe("sand");
  });
});

describe("applyThemeChoice", () => {
  it("sets data-theme on the provided root and returns the resolved id", () => {
    const setAttribute = vi.fn();
    const root = { setAttribute };
    const result = applyThemeChoice("midnight", root, { matches: false });
    expect(result).toBe("midnight");
    expect(setAttribute).toHaveBeenCalledWith("data-theme", "midnight");
  });

  it("resolves auto before setting the attribute (writes a concrete palette id, never 'auto')", () => {
    const setAttribute = vi.fn();
    applyThemeChoice("auto", { setAttribute }, { matches: true });
    expect(setAttribute).toHaveBeenCalledWith("data-theme", "dark");
  });

  it("resolves auto to sand when the OS preference is light", () => {
    const setAttribute = vi.fn();
    applyThemeChoice("auto", { setAttribute }, { matches: false });
    expect(setAttribute).toHaveBeenCalledWith("data-theme", "sand");
  });
});

describe("isDarkThemeId", () => {
  it("flags dark, midnight, and parchment-dark as dark themes", () => {
    expect(isDarkThemeId("dark")).toBe(true);
    expect(isDarkThemeId("midnight")).toBe(true);
    expect(isDarkThemeId("parchment-dark")).toBe(true);
  });

  it("treats every other concrete theme id as light", () => {
    expect(isDarkThemeId("sand")).toBe(false);
    expect(isDarkThemeId("paper")).toBe(false);
    expect(isDarkThemeId("forest")).toBe(false);
    expect(isDarkThemeId("parchment")).toBe(false);
  });
});

describe("resolveInitialThemeChoice", () => {
  it("returns the stored choice when one exists", () => {
    const storage = createStorageStub({ "sutrapad-theme": "forest" });
    expect(resolveInitialThemeChoice(storage)).toBe("forest");
  });

  it("falls back to the default choice when nothing is stored", () => {
    const storage = createStorageStub();
    expect(resolveInitialThemeChoice(storage)).toBe(DEFAULT_THEME_CHOICE);
  });

  it("falls back to the default when the stored value is no longer a known theme", () => {
    const storage = createStorageStub({ "sutrapad-theme": "neon" });
    expect(resolveInitialThemeChoice(storage)).toBe(DEFAULT_THEME_CHOICE);
  });
});
