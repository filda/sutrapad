import { describe, expect, it } from "vitest";
import {
  allLocales,
  DEFAULT_LOCALE,
  isLocale,
  matchLocale,
} from "../src/lib/i18n";

describe("allLocales", () => {
  it("ships English and Czech, English first", () => {
    // Order is the order the Settings picker renders, so it is part of the
    // contract rather than an implementation detail.
    expect(allLocales()).toEqual(["en", "cs"]);
  });

  it("defaults to the source language of the catalog", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(allLocales()).toContain(DEFAULT_LOCALE);
  });
});

describe("isLocale", () => {
  it("accepts every shipped locale", () => {
    for (const locale of allLocales()) {
      expect(isLocale(locale)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale("cs-CZ")).toBe(false);
    expect(isLocale("CS")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(0)).toBe(false);
  });
});

describe("matchLocale", () => {
  it("matches an exact primary subtag", () => {
    expect(matchLocale(["cs"])).toBe("cs");
    expect(matchLocale(["en"])).toBe("en");
  });

  it("matches a region-qualified tag on its primary subtag", () => {
    expect(matchLocale(["cs-CZ"])).toBe("cs");
    expect(matchLocale(["en-GB"])).toBe("en");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(matchLocale([" CS-cz "])).toBe("cs");
  });

  it("skips languages we don't ship instead of giving up on the list", () => {
    // The regression this guards: bailing on the first entry would send a
    // Slovak-preferring browser to English even though Czech is right there.
    expect(matchLocale(["sk", "cs-CZ", "en"])).toBe("cs");
  });

  it("honours the browser's order when several entries match", () => {
    expect(matchLocale(["cs", "en"])).toBe("cs");
    expect(matchLocale(["en", "cs"])).toBe("en");
  });

  it("returns null rather than a default when nothing matches", () => {
    // Null keeps the "fall back to English" decision at the call site — a
    // stored choice must survive a browser that asks for something else.
    expect(matchLocale([])).toBeNull();
    expect(matchLocale(["de", "fr-CA"])).toBeNull();
  });
});
