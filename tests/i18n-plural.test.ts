import { describe, expect, it } from "vitest";
import {
  formatPlural,
  selectPluralCategory,
  toPluralCategory,
  type PluralForms,
} from "../src/lib/i18n";

const FORMS: PluralForms = {
  one: "one:{count}",
  few: "few:{count}",
  many: "many:{count}",
  other: "other:{count}",
};

describe("toPluralCategory", () => {
  it("passes through the categories our catalogs declare", () => {
    expect(toPluralCategory("one")).toBe("one");
    expect(toPluralCategory("few")).toBe("few");
    expect(toPluralCategory("many")).toBe("many");
    expect(toPluralCategory("other")).toBe("other");
  });

  it("folds the categories no shipped locale produces into `other`", () => {
    // Arabic's `zero` and Welsh's `two`. Unreachable through
    // `selectPluralCategory` while `Locale` is en | cs — which is exactly why
    // this is a function of its own: without the fold, a third locale would
    // index the forms record with a missing key and render "undefined".
    expect(toPluralCategory("zero")).toBe("other");
    expect(toPluralCategory("two")).toBe("other");
  });
});

describe("selectPluralCategory", () => {
  it("uses English's two categories", () => {
    expect(selectPluralCategory("en", 1)).toBe("one");
    expect(selectPluralCategory("en", 0)).toBe("other");
    expect(selectPluralCategory("en", 2)).toBe("other");
    expect(selectPluralCategory("en", 5)).toBe("other");
  });

  it("uses Czech's one / few / other split for whole numbers", () => {
    expect(selectPluralCategory("cs", 1)).toBe("one");
    expect(selectPluralCategory("cs", 2)).toBe("few");
    expect(selectPluralCategory("cs", 4)).toBe("few");
    expect(selectPluralCategory("cs", 5)).toBe("other");
    expect(selectPluralCategory("cs", 0)).toBe("other");
  });

  it("reserves Czech's `many` for decimals, not for large counts", () => {
    // The intuitive reading of "Czech has a 5+ form" is wrong, and getting it
    // backwards would put "poznámky" where "poznámek" belongs on every count
    // over four. 5 is `other`; only a fractional value is `many`.
    expect(selectPluralCategory("cs", 1.5)).toBe("many");
    expect(selectPluralCategory("cs", 100)).toBe("other");
  });
});

describe("formatPlural", () => {
  it("picks the form for the count in that locale", () => {
    expect(formatPlural("en", 1, FORMS)).toBe("one:1");
    expect(formatPlural("en", 3, FORMS)).toBe("other:3");
    expect(formatPlural("cs", 3, FORMS)).toBe("few:3");
    expect(formatPlural("cs", 8, FORMS)).toBe("other:8");
  });

  it("substitutes every occurrence of the count token", () => {
    expect(
      formatPlural("en", 7, { ...FORMS, other: "{count} of {count}" }),
    ).toBe("7 of 7");
  });

  it("leaves a form without the token alone", () => {
    expect(formatPlural("en", 2, { ...FORMS, other: "no number here" })).toBe(
      "no number here",
    );
  });

  it("writes the count without group separators", () => {
    // `Intl.NumberFormat` would render this as "6,470" in English and
    // "6 470" in Czech. The Backup card has always shown the bare number and
    // changing that is a separate decision, so this pins the current one.
    expect(formatPlural("en", 6470, FORMS)).toBe("other:6470");
    expect(formatPlural("cs", 6470, FORMS)).toBe("other:6470");
  });
});
