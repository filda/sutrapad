import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NOTES_VIEW,
  isNotesViewMode,
  loadStoredNotesView,
  persistNotesView,
  readNotesViewFromLocation,
  resolveInitialNotesView,
  writeNotesViewToLocation,
} from "../src/app/logic/notes-view";

/**
 * The notebook view mode is persisted in two places (URL + localStorage) and
 * both are user-editable, so every read path has to reject junk rather than
 * hand a bogus string to the renderer. Until now the module had no dedicated
 * test — it was only exercised transitively, which left the storage key and
 * the type guard unpinned.
 */

const BASE = "https://sutrapad.example/notes";

describe("isNotesViewMode", () => {
  it("accepts exactly the two known modes", () => {
    expect(isNotesViewMode("list")).toBe(true);
    expect(isNotesViewMode("cards")).toBe(true);
  });

  it("rejects an unknown string, and any non-string value", () => {
    // A stored value from an older build (or a hand-edited URL) must not
    // survive the guard — the renderer switches on the mode directly.
    expect(isNotesViewMode("grid")).toBe(false);
    expect(isNotesViewMode("")).toBe(false);
    expect(isNotesViewMode(42)).toBe(false);
    expect(isNotesViewMode(null)).toBe(false);
    expect(isNotesViewMode(undefined)).toBe(false);
  });
});

describe("readNotesViewFromLocation", () => {
  it("returns null when the query parameter is absent", () => {
    expect(readNotesViewFromLocation(BASE)).toBeNull();
  });

  it("reads a valid mode and normalizes casing plus surrounding whitespace", () => {
    expect(readNotesViewFromLocation(`${BASE}?view=list`)).toBe("list");
    expect(readNotesViewFromLocation(`${BASE}?view=%20LIST%20`)).toBe("list");
  });

  it("returns null for an unknown mode instead of passing it through", () => {
    expect(readNotesViewFromLocation(`${BASE}?view=grid`)).toBeNull();
    expect(readNotesViewFromLocation(`${BASE}?view=`)).toBeNull();
  });
});

describe("writeNotesViewToLocation", () => {
  it("strips the parameter for the default mode so the canonical URL stays clean", () => {
    const url = writeNotesViewToLocation(`${BASE}?view=list`, DEFAULT_NOTES_VIEW);
    expect(new URL(url).searchParams.has("view")).toBe(false);
  });

  it("writes the non-default mode and preserves other params plus the hash", () => {
    const url = writeNotesViewToLocation(`${BASE}?tag=work#note-3`, "list");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("view")).toBe("list");
    expect(parsed.searchParams.get("tag")).toBe("work");
    expect(parsed.hash).toBe("#note-3");
  });
});

describe("loadStoredNotesView / persistNotesView", () => {
  it("persists the mode under the `sutrapad-notes-view` key", () => {
    // The literal key is the contract with every previously-shipped build;
    // changing it silently resets everyone's view preference.
    const setItem = vi.fn();
    persistNotesView("list", { setItem });
    expect(setItem).toHaveBeenCalledWith("sutrapad-notes-view", "list");
  });

  it("round-trips through a storage stub", () => {
    const store = new Map<string, string>();
    persistNotesView("list", { setItem: (key, value) => void store.set(key, value) });
    expect(loadStoredNotesView({ getItem: (key) => store.get(key) ?? null })).toBe("list");
  });

  it("returns null for an empty store and for a junk stored value", () => {
    expect(loadStoredNotesView({ getItem: () => null })).toBeNull();
    expect(loadStoredNotesView({ getItem: () => "grid" })).toBeNull();
  });
});

describe("resolveInitialNotesView", () => {
  it("prefers the URL over storage", () => {
    expect(
      resolveInitialNotesView(`${BASE}?view=list`, { getItem: () => "cards" }),
    ).toBe("list");
  });

  it("falls back to storage when the URL says nothing", () => {
    expect(resolveInitialNotesView(BASE, { getItem: () => "list" })).toBe("list");
  });

  it("falls back to the default when neither source has a usable value", () => {
    expect(resolveInitialNotesView(BASE, { getItem: () => null })).toBe(
      DEFAULT_NOTES_VIEW,
    );
    expect(resolveInitialNotesView(`${BASE}?view=grid`, { getItem: () => "grid" })).toBe(
      DEFAULT_NOTES_VIEW,
    );
  });
});
