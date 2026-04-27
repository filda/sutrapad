import { describe, expect, it } from "vitest";
import { tokenizeImport } from "../src/app/logic/lexicon/tokenize";

describe("tokenizeImport", () => {
  it("returns an empty list for empty input", () => {
    expect(tokenizeImport("")).toEqual([]);
  });

  it("normalises forms to NFC + lowercase but preserves diacritics", () => {
    const result = tokenizeImport("Praha PRAZE praze");
    expect(result.map((t) => t.form)).toEqual(["praha", "praze", "praze"]);
  });

  it("uses Czech-locale lowercase rules", () => {
    // Sanity check that turkish-i quirks don't bleed in: cs-CZ keeps
    // 'I' → 'i', not the dotted variant.
    const result = tokenizeImport("Idea");
    expect(result[0]?.form).toBe("idea");
  });

  it("drops digits and punctuation as boundaries", () => {
    const result = tokenizeImport("Praha 2025, Brno!");
    expect(result.map((t) => t.form)).toEqual(["praha", "brno"]);
  });

  it("drops forms shorter than three characters", () => {
    // "by", "to", "ve" would otherwise dominate a Czech text. The
    // length filter runs before the stoplist, so a two-char non-
    // stoplist form like "ti" is also dropped.
    const result = tokenizeImport("Praha by ve ti dnech");
    expect(result.map((t) => t.form)).toEqual(["praha", "dnech"]);
  });

  it("drops words from the Czech stoplist", () => {
    // "jsem" is in the stoplist; "psa" is not.
    const result = tokenizeImport("Jsem doma a viděl jsem psa.");
    expect(result.map((t) => t.form)).toEqual(["doma", "viděl", "psa"]);
  });

  it("respects the knownForms exclude set", () => {
    const result = tokenizeImport("Praha praze psovi", {
      knownForms: new Set(["praha", "praze"]),
    });
    expect(result.map((t) => t.form)).toEqual(["psovi"]);
  });

  it("respects the rejectedForms exclude set", () => {
    const result = tokenizeImport("Bagr výkop bagr", {
      rejectedForms: new Set(["bagr"]),
    });
    expect(result.map((t) => t.form)).toEqual(["výkop"]);
  });

  it("attaches a context snippet around each token", () => {
    const result = tokenizeImport(
      "Včera večer jsem potkal kouzelníka v Praze a šli jsme na pivo.",
    );
    const praze = result.find((t) => t.form === "praze");
    expect(praze).toBeDefined();
    expect(praze?.context).toContain("Praze");
  });

  it("trims runs of whitespace inside the context window", () => {
    const result = tokenizeImport("Praha\n\n\tdnes");
    const praha = result.find((t) => t.form === "praha");
    // The cleanup collapses the newline + tab cluster into a single space.
    expect(praha?.context).not.toMatch(/\s{2,}/);
  });

  it("collapses whitespace runs to a single space, not to nothing", () => {
    // Pin the substitution character: the cleanup keeps a separator
    // between words rather than mashing them together.
    const result = tokenizeImport("Praha\n\n\tdnes");
    const praha = result.find((t) => t.form === "praha");
    expect(praha?.context).toContain("Praha dnes");
  });

  it("trims whitespace at the slice edges before adding ellipsis decoration", () => {
    // When the slice lands on a whitespace boundary, the cleanup should
    // collapse + trim the spaces so the ellipsis sits flush against
    // actual content (no `… <space>` or `<space> …` artifacts).
    const padding = "x ".repeat(80);
    const result = tokenizeImport(`${padding}target ${padding}`);
    const ctx = result.find((t) => t.form === "target")?.context ?? "";
    expect(ctx).not.toMatch(/…\s/);
    expect(ctx).not.toMatch(/\s…/);
  });

  it("limits the context window to roughly CONTEXT_RADIUS characters on each side", () => {
    // Padding well beyond CONTEXT_RADIUS (40) so a "use the whole text"
    // mutation would emit a context far longer than the budget.
    const padding = "x ".repeat(80);
    const result = tokenizeImport(`${padding}target ${padding}`);
    const target = result.find((t) => t.form === "target");
    // Whole input is ~325 chars; window should be ~80 (radius * 2) plus
    // the token plus the ellipses. Bounding loosely under ~120 keeps the
    // assertion robust to small changes in CONTEXT_RADIUS while still
    // catching "no slice happened" regressions.
    expect(target?.context.length).toBeLessThan(120);
  });

  it("decorates context windows that don't reach the input boundaries", () => {
    const padding = "x ".repeat(60); // > CONTEXT_RADIUS on both sides
    const result = tokenizeImport(`${padding}target ${padding}`);
    const target = result.find((t) => t.form === "target");
    expect(target?.context.startsWith("…")).toBe(true);
    expect(target?.context.endsWith("…")).toBe(true);
  });

  it("does not add ellipsis when the token is at the start or end of input", () => {
    const result = tokenizeImport("praha brno");
    expect(result[0]?.context.startsWith("…")).toBe(false);
    expect(result[1]?.context.endsWith("…")).toBe(false);
  });
});
