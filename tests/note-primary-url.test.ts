import { describe, expect, it } from "vitest";
import { deriveNotePrimaryUrl } from "../src/app/logic/note-primary-url";
import type { SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  const timestamp = "2026-04-20T12:00:00.000Z";
  return {
    id: "n1",
    title: "Test",
    body: "",
    tags: [],
    urls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("deriveNotePrimaryUrl", () => {
  it("prefers captureContext.page.canonicalUrl over body urls", () => {
    // Bookmarklet captures often have both a canonical (from <link rel=canonical>)
    // *and* the live URL (the page the user was on). Canonical wins because it
    // collapses tracking-tail variants of the same article into one og:image
    // resolution.
    const note = makeNote({
      urls: ["https://nytimes.com/article?utm_source=newsletter"],
      captureContext: {
        source: "url-capture",
        page: { canonicalUrl: "https://nytimes.com/article" },
      },
    });
    expect(deriveNotePrimaryUrl(note)).toBe("https://nytimes.com/article");
  });

  it("falls back to the first url on `urls` when no canonical is set", () => {
    const note = makeNote({
      urls: ["https://example.com/a", "https://example.com/b"],
    });
    expect(deriveNotePrimaryUrl(note)).toBe("https://example.com/a");
  });

  it("returns null when the note has neither canonical nor any urls", () => {
    expect(deriveNotePrimaryUrl(makeNote())).toBeNull();
  });

  it("treats a blank/whitespace canonical as missing and falls through", () => {
    // canonicalUrl can land as a stray whitespace string when the source page's
    // <link rel="canonical"> is malformed. Trimming + falling through to body
    // urls keeps the card thumb populated rather than rendering domain-less.
    const note = makeNote({
      urls: ["https://example.com/a"],
      captureContext: {
        source: "url-capture",
        page: { canonicalUrl: "   " },
      },
    });
    expect(deriveNotePrimaryUrl(note)).toBe("https://example.com/a");
  });

  it("skips blank entries on `urls` and returns the first non-empty one", () => {
    // Defensive: extractUrls in lib/notebook.ts trims, but a hand-edited
    // index file or a future regression might persist a blank slot.
    const note = makeNote({ urls: ["", "  ", "https://example.com/a"] });
    expect(deriveNotePrimaryUrl(note)).toBe("https://example.com/a");
  });

  it("returns null when canonical is missing and every url is blank", () => {
    const note = makeNote({ urls: ["", "   "] });
    expect(deriveNotePrimaryUrl(note)).toBeNull();
  });
});
