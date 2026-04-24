import { describe, expect, it } from "vitest";
import {
  DEFAULT_LINKS_VIEW,
  isLinksViewMode,
  loadStoredLinksView,
  persistLinksView,
  readLinksViewFromLocation,
  resolveInitialLinksView,
  writeLinksViewToLocation,
} from "../src/app/logic/links-view";

function createStorage(initial: Record<string, string> = {}): Pick<
  Storage,
  "getItem" | "setItem"
> {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

describe("DEFAULT_LINKS_VIEW", () => {
  it("is cards per handoff v2", () => {
    // Pinned: the handoff screen_rest.jsx renders `.links-grid` as the
    // primary layout; list is the opt-in. If the default flips, the
    // canonical URL strategy (strip default) would also need to flip.
    expect(DEFAULT_LINKS_VIEW).toBe("cards");
  });
});

describe("isLinksViewMode", () => {
  it("accepts 'cards' and 'list'", () => {
    expect(isLinksViewMode("cards")).toBe(true);
    expect(isLinksViewMode("list")).toBe(true);
  });

  it("rejects any other string", () => {
    expect(isLinksViewMode("grid")).toBe(false);
    expect(isLinksViewMode("")).toBe(false);
    expect(isLinksViewMode("CARDS")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isLinksViewMode(null)).toBe(false);
    expect(isLinksViewMode(undefined)).toBe(false);
    expect(isLinksViewMode(42)).toBe(false);
    expect(isLinksViewMode({})).toBe(false);
  });
});

describe("readLinksViewFromLocation", () => {
  it("returns null when the URL has no view param", () => {
    expect(readLinksViewFromLocation("https://app/links")).toBeNull();
  });

  it("returns the parsed mode for a valid param", () => {
    expect(readLinksViewFromLocation("https://app/links?view=list")).toBe("list");
    expect(readLinksViewFromLocation("https://app/links?view=cards")).toBe("cards");
  });

  it("trims + lowercases before validating", () => {
    expect(readLinksViewFromLocation("https://app/links?view=%20LIST%20")).toBe("list");
  });

  it("returns null for an unknown view value", () => {
    expect(readLinksViewFromLocation("https://app/links?view=grid")).toBeNull();
  });
});

describe("writeLinksViewToLocation", () => {
  it("strips the param when writing the default mode", () => {
    // Canonical URL cleanliness — a shared /links link should not carry
    // a redundant `?view=cards`.
    expect(writeLinksViewToLocation("https://app/links?view=list", "cards")).toBe(
      "https://app/links",
    );
  });

  it("writes the param when the mode is non-default", () => {
    expect(writeLinksViewToLocation("https://app/links", "list")).toBe(
      "https://app/links?view=list",
    );
  });

  it("preserves unrelated query params + hash", () => {
    const url = "https://app/links?tag=work#top";
    expect(writeLinksViewToLocation(url, "list")).toBe(
      "https://app/links?tag=work&view=list#top",
    );
  });
});

describe("loadStoredLinksView", () => {
  it("returns null when nothing is stored", () => {
    expect(loadStoredLinksView(createStorage())).toBeNull();
  });

  it("reads back a previously persisted mode", () => {
    const storage = createStorage({ "sutrapad-links-view": "list" });
    expect(loadStoredLinksView(storage)).toBe("list");
  });

  it("returns null for a corrupted slot value", () => {
    const storage = createStorage({ "sutrapad-links-view": "grid" });
    expect(loadStoredLinksView(storage)).toBeNull();
  });
});

describe("persistLinksView", () => {
  it("round-trips with loadStoredLinksView", () => {
    const storage = createStorage();
    persistLinksView("list", storage);
    expect(loadStoredLinksView(storage)).toBe("list");
  });

  it("uses a distinct slot from notes-view so the two prefs don't collide", () => {
    // Pins the storage key: a user may prefer dense list on Links but
    // cards on Notes (or vice versa). If the two modules ever shared
    // a key, one page's toggle would clobber the other's preference.
    const writes: Record<string, string> = {};
    persistLinksView("list", {
      setItem(key, value) {
        writes[key] = value;
      },
    });
    expect(writes).toEqual({ "sutrapad-links-view": "list" });
    expect(writes).not.toHaveProperty("sutrapad-notes-view");
  });
});

describe("resolveInitialLinksView", () => {
  it("prefers the URL over storage", () => {
    const storage = createStorage({ "sutrapad-links-view": "cards" });
    expect(
      resolveInitialLinksView("https://app/links?view=list", storage),
    ).toBe("list");
  });

  it("falls back to storage when URL has no param", () => {
    const storage = createStorage({ "sutrapad-links-view": "list" });
    expect(resolveInitialLinksView("https://app/links", storage)).toBe("list");
  });

  it("falls back to DEFAULT_LINKS_VIEW when neither URL nor storage has a value", () => {
    expect(resolveInitialLinksView("https://app/links", createStorage())).toBe(
      "cards",
    );
  });
});
