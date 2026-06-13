import { describe, expect, it } from "vitest";
import { buildCardExcerpt } from "../src/app/logic/card-excerpt";

// Unit tests for the shared card-excerpt helper. Notes / Links call this
// via their per-page renderers; the integration tests in
// `entity-card-classes.test.ts` exercise the end-to-end render path.
// This file pins the pure-text contract: trim, strip, collapse, truncate.
// Tests moved from the old `buildLinkCardDescription` suite (Step 6 of
// cards-unification) with the signature switched from positional args
// to an options object.

describe("buildCardExcerpt", () => {
  it("returns null when the body is just the stripped URL", () => {
    // The "captured-via-bookmarklet, body = URL" case for Links — the
    // thumb already shows the hostname, so a description line reading
    // "https://…" would be pure duplication.
    expect(
      buildCardExcerpt("https://nytimes.com/article", {
        stripUrl: "https://nytimes.com/article",
      }),
    ).toBeNull();
  });

  it("returns null when the body is empty", () => {
    expect(buildCardExcerpt("", { stripUrl: "https://nytimes.com/" })).toBeNull();
  });

  it("returns null when no options are given and body is empty", () => {
    // Notes' typical call shape: no stripUrl, no maxChars. Whitespace-
    // only body still folds to null so the caller can render an
    // "Empty note" placeholder.
    expect(buildCardExcerpt("")).toBeNull();
    expect(buildCardExcerpt("   \n\n   ")).toBeNull();
  });

  it("treats an empty/omitted stripUrl as 'nothing to strip' instead of degenerating into a per-character split", () => {
    // Regression guard: `body.split("").join("")` re-stitches the body
    // codepoint-by-codepoint and would corrupt grapheme clusters
    // (combining diacritics, ZWJ emoji sequences). The empty-url branch
    // must short-circuit and return the trimmed body verbatim.
    const body = "café 👨‍👩‍👧 fin";
    expect(buildCardExcerpt(body, { stripUrl: "" })).toBe("café 👨‍👩‍👧 fin");
    expect(buildCardExcerpt(body)).toBe("café 👨‍👩‍👧 fin");
  });

  it("strips the URL out of the body while keeping surrounding prose", () => {
    // The doubled-space left behind where the URL was is collapsed by
    // the whitespace-normalisation step, so "Read: <url> — nice" ends
    // up as "Read: — nice" with a single space, not ":  —".
    const body = "Read this tomorrow: https://nytimes.com/article — looks juicy.";
    expect(
      buildCardExcerpt(body, { stripUrl: "https://nytimes.com/article" }),
    ).toBe("Read this tomorrow: — looks juicy.");
  });

  it("trims the whitespace left when the stripped URL led the body", () => {
    // URL at the very start leaves a leading space after removal; the
    // `.trim()` on the strip branch must clean it so the excerpt doesn't
    // render with a phantom indent. Pins that trailing `.trim()` — a body
    // that ends up only padded on one side wouldn't be caught by the
    // mid-sentence strip test above.
    const body = "https://x.example trailing words";
    expect(buildCardExcerpt(body, { stripUrl: "https://x.example" })).toBe(
      "trailing words",
    );
  });

  it("trims a trailing space before the ellipsis when truncation lands on a gap", () => {
    // slice(0, maxChars - 1) can end on a space; without the `.trimEnd()`
    // the result would read "aaaa …" instead of "aaaa…". maxChars 6 →
    // slice(0,5) = "aaaa " here, so this pins the trim before the ellipsis.
    expect(buildCardExcerpt("aaaa aaaa aaaa", { maxChars: 6 })).toBe("aaaa…");
  });

  it("collapses newlines/runs of whitespace to a single space", () => {
    // The card body is visually one line, so preserving paragraph
    // breaks buys nothing and just truncates more aggressively.
    const body = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    expect(buildCardExcerpt(body, { stripUrl: "https://other.com" })).toBe(
      "Paragraph one. Paragraph two. Paragraph three.",
    );
  });

  it("truncates long bodies with an ellipsis at the caller-specified max", () => {
    const body = "a".repeat(200);
    const result = buildCardExcerpt(body, { maxChars: 50 });
    if (result === null) throw new Error("expected non-null result");
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves short bodies untruncated (no trailing ellipsis)", () => {
    const body = "A short paragraph.";
    const result = buildCardExcerpt(body);
    if (result === null) throw new Error("expected non-null result");
    expect(result).toBe("A short paragraph.");
    expect(result.endsWith("…")).toBe(false);
  });

  it("does not truncate when the body is exactly at the max-char budget", () => {
    // Boundary pin: exactly `maxChars` long → return unchanged. If the
    // comparison flips from `<=` to `<`, a body landing on the exact
    // limit would grow a phantom ellipsis.
    const body = "a".repeat(50);
    const result = buildCardExcerpt(body, { maxChars: 50 });
    if (result === null) throw new Error("expected non-null result");
    expect(result).toBe(body);
    expect(result.length).toBe(50);
    expect(result.endsWith("…")).toBe(false);
  });

  it("trims leading and trailing whitespace from the result", () => {
    // A body like "  hello world  " should read as "hello world" in
    // the card — leading spaces would look like a layout bug, not
    // preserved intent. Pins the outer .trim() step.
    expect(buildCardExcerpt("   hello world   ")).toBe("hello world");
  });

  it("defaults to 160 chars when no maxChars is given", () => {
    // Pin the default — Links cards are designed around this budget;
    // changing it silently would reflow the whole grid.
    const body = "a".repeat(200);
    const result = buildCardExcerpt(body);
    if (result === null) throw new Error("expected non-null result");
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.length).toBe(160);
  });

  it("Notes-style call (72-char budget) caps the result accordingly", () => {
    // Notes uses a tight 72-char limit to keep the excerpt on one
    // visual line in the cards grid. Pins the call shape that
    // `notes-list.ts buildCardItem` uses.
    const body = "a".repeat(200);
    const result = buildCardExcerpt(body, { maxChars: 72 });
    if (result === null) throw new Error("expected non-null result");
    expect(result.length).toBe(72);
    expect(result.endsWith("…")).toBe(true);
  });
});
