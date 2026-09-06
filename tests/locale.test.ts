import { afterEach, describe, expect, it } from "vitest";
import {
  applyLocale,
  browserLanguages,
  loadStoredLocale,
  persistLocale,
  resolveInitialLocale,
} from "../src/app/logic/locale";
import { DEFAULT_LOCALE, getActiveLocale, setActiveLocale } from "../src/lib/i18n";

afterEach(() => setActiveLocale(DEFAULT_LOCALE));

function storageWith(value: string | null) {
  const store = new Map<string, string>();
  if (value !== null) store.set("sutrapad-locale", value);
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, next: string) => void store.set(key, next),
    snapshot: () => Object.fromEntries(store),
  };
}

describe("loadStoredLocale", () => {
  it("reads a stored locale", () => {
    expect(loadStoredLocale(storageWith("cs"))).toBe("cs");
  });

  it("returns null when nothing is stored", () => {
    expect(loadStoredLocale(storageWith(null))).toBeNull();
  });

  it("returns null for a locale we no longer ship", () => {
    // Same guard as the theme's: a value from an older build must not reach
    // `catalogFor` and resolve to an undefined catalog.
    expect(loadStoredLocale(storageWith("de"))).toBeNull();
    expect(loadStoredLocale(storageWith("cs-CZ"))).toBeNull();
  });
});

describe("persistLocale", () => {
  it("writes the locale under its own key", () => {
    const storage = storageWith(null);
    persistLocale("cs", storage);
    expect(storage.snapshot()).toEqual({ "sutrapad-locale": "cs" });
  });
});

describe("browserLanguages", () => {
  it("prefers the ordered list", () => {
    expect(browserLanguages({ languages: ["cs-CZ", "en"], language: "en" })).toEqual([
      "cs-CZ",
      "en",
    ]);
  });

  it("falls back to the single language when the list is absent or empty", () => {
    // Older browsers expose only `navigator.language`. An empty `languages`
    // array has to fall through too, or those browsers get no preference at
    // all and every first run lands on English.
    expect(browserLanguages({ language: "cs" })).toEqual(["cs"]);
    expect(browserLanguages({ languages: [], language: "cs" })).toEqual(["cs"]);
  });

  it("returns an empty list when there is nothing to read", () => {
    expect(browserLanguages({})).toEqual([]);
  });

  it("defaults to the runtime's own navigator", () => {
    // Not a restatement of the implementation: this asserts the default
    // argument is wired to a real `navigator` at all. A default that stopped
    // reading it would hand back an empty list and quietly send every first
    // run to English regardless of what the browser asked for.
    expect(browserLanguages().length).toBeGreaterThan(0);
    expect(browserLanguages()[0]).toBe(navigator.language);
  });
});

describe("resolveInitialLocale", () => {
  it("prefers an explicit stored choice over the browser", () => {
    // The whole point of the Settings row: a Czech-speaking user on an
    // English browser must not be dragged back to English on every load.
    expect(resolveInitialLocale(storageWith("cs"), ["en-US"])).toBe("cs");
  });

  it("keeps a stored choice that agrees with the browser", () => {
    expect(resolveInitialLocale(storageWith("en"), ["cs-CZ"])).toBe("en");
  });

  it("falls back to the browser on first run", () => {
    expect(resolveInitialLocale(storageWith(null), ["cs-CZ", "en"])).toBe("cs");
  });

  it("falls back to English when neither has an answer", () => {
    expect(resolveInitialLocale(storageWith(null), ["de"])).toBe("en");
    expect(resolveInitialLocale(storageWith(null), [])).toBe("en");
  });

  it("ignores the browser when the stored value is unusable", () => {
    expect(resolveInitialLocale(storageWith("de"), ["cs"])).toBe("cs");
  });
});

describe("applyLocale", () => {
  it("points the catalog at the locale and syncs the lang attribute", () => {
    // Two side effects, one entry point. Splitting them is how you get text
    // in one language and a `lang` attribute claiming another, which is
    // invisible on screen and wrong for every screen reader.
    const root = { lang: "en" };

    applyLocale("cs", root);

    expect(getActiveLocale()).toBe("cs");
    expect(root.lang).toBe("cs");
  });

  it("switches back", () => {
    const root = { lang: "cs" };

    applyLocale("en", root);

    expect(getActiveLocale()).toBe("en");
    expect(root.lang).toBe("en");
  });
});
