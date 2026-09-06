import { afterEach, describe, expect, it } from "vitest";
import {
  allLocales,
  catalogFor,
  CS,
  DEFAULT_LOCALE,
  EN,
  getActiveLocale,
  messages,
  setActiveLocale,
} from "../src/lib/i18n";

afterEach(() => setActiveLocale(DEFAULT_LOCALE));

/** Every string leaf in a catalog, as dotted paths, with its value. */
function stringLeaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    stringLeaves(child, path ? `${path}.${key}` : key),
  );
}

describe("catalogFor", () => {
  it("returns the catalog for each shipped locale", () => {
    expect(catalogFor("en")).toBe(EN);
    expect(catalogFor("cs")).toBe(CS);
  });
});

describe("the active catalog", () => {
  it("starts on the default locale", () => {
    expect(getActiveLocale()).toBe(DEFAULT_LOCALE);
    expect(messages()).toBe(EN);
  });

  it("follows setActiveLocale", () => {
    setActiveLocale("cs");
    expect(getActiveLocale()).toBe("cs");
    expect(messages()).toBe(CS);

    setActiveLocale("en");
    expect(messages()).toBe(EN);
  });
});

describe("catalog completeness", () => {
  // Shape is a compile-time guarantee (`CS: Messages`), so what is worth
  // asserting at runtime is what the type system cannot see: that the Czech
  // values are actually Czech, and that neither catalog ships an empty
  // string where copy belongs.

  it("has no empty strings in either catalog", () => {
    for (const locale of allLocales()) {
      for (const [path, value] of stringLeaves(catalogFor(locale))) {
        expect(value.trim(), `${locale}: ${path}`).not.toBe("");
      }
    }
  });

  it("translates every message except the handful that are the same word", () => {
    // A value left identical is the one failure mode `CS: Messages` cannot
    // catch — a copy-pasted English sentence type-checks perfectly. A few are
    // legitimately identical (names), so the guard is an exact set rather
    // than a count: one more means someone forgot to translate.
    const czech = new Map(stringLeaves(CS));
    const identical = stringLeaves(EN)
      .filter(([path, value]) => czech.get(path) === value)
      .map(([path]) => path);

    // In English-catalog key order.
    expect(identical).toEqual([
      // Language names are written in their own language, in both catalogs.
      "localeName.en",
      "localeName.cs",
      // Product and project names. The footer wordmark lives in the catalog
      // so the spelling has exactly one home, not because it translates.
      "footer.columns.product",
      "footer.links.openStreetMap",
      "footer.links.nominatim",
      // Loanword, and a product name.
      "settings.persona.title",
      "settings.backup.title",
    ]);
  });

  it("keeps the count token in every form of every counted message", () => {
    for (const locale of allLocales()) {
      const catalog = catalogFor(locale);
      for (const forms of [
        catalog.rebuild.done,
        catalog.settings.tagHygiene.candidateCount,
      ]) {
        for (const [category, form] of Object.entries(forms)) {
          expect(form, `${locale}: ${category}`).toContain("{count}");
        }
      }
    }
  });

  it("interpolates the argument in every parameterised message", () => {
    for (const locale of allLocales()) {
      const catalog = catalogFor(locale);
      expect(catalog.rebuild.error("boom")).toContain("boom");
      expect(catalog.settings.tagHygiene.mergeLabel("praha", "prague")).toContain("praha");
      expect(catalog.settings.tagHygiene.mergeLabel("praha", "prague")).toContain("prague");
      expect(catalog.settings.tagHygiene.dismissLabel("prague", "praha")).toContain("praha");
      expect(catalog.settings.tagHygiene.dismissLabel("prague", "praha")).toContain("prague");
    }
  });
});
