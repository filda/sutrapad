import { describe, expect, it } from "vitest";
import {
  buildSilentCaptureBody,
  extractSelectionFromUrl,
  isSilentCapture,
} from "../src/app/logic/silent-capture";

describe("isSilentCapture", () => {
  it("returns false when the silent param is absent", () => {
    expect(isSilentCapture("https://app.example/?url=https://x")).toBe(false);
  });

  it("returns true for the canonical `silent=1`", () => {
    // Pin: the bookmarklet writes `1` from `bookmarklet.ts`. If the
    // canonical writer ever changes, the reader must match.
    expect(isSilentCapture("https://app.example/?silent=1")).toBe(true);
  });

  it("accepts `true` and `yes` for hand-built test URLs", () => {
    expect(isSilentCapture("https://app.example/?silent=true")).toBe(true);
    expect(isSilentCapture("https://app.example/?silent=yes")).toBe(true);
  });

  it("is case-insensitive (TRUE / YES)", () => {
    expect(isSilentCapture("https://app.example/?silent=TRUE")).toBe(true);
    expect(isSilentCapture("https://app.example/?silent=Yes")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isSilentCapture("https://app.example/?silent=%201%20")).toBe(true);
  });

  it("returns false for unknown values", () => {
    expect(isSilentCapture("https://app.example/?silent=0")).toBe(false);
    expect(isSilentCapture("https://app.example/?silent=please")).toBe(false);
    expect(isSilentCapture("https://app.example/?silent=")).toBe(false);
  });

  it("returns false on a malformed URL (never throws)", () => {
    expect(isSilentCapture("not a url")).toBe(false);
  });
});

describe("extractSelectionFromUrl", () => {
  it("returns null when the selection param is absent", () => {
    expect(extractSelectionFromUrl("https://app.example/?url=https://x")).toBeNull();
  });

  it("returns null when the param is empty", () => {
    expect(extractSelectionFromUrl("https://app.example/?selection=")).toBeNull();
  });

  it("returns null when the param is whitespace-only", () => {
    // Decoded space + newline. A blank selection isn't worth wrapping
    // a body around — same predicate as `buildSilentCaptureBody`.
    expect(
      extractSelectionFromUrl("https://app.example/?selection=%20%0A%20"),
    ).toBeNull();
  });

  it("returns the decoded selection text when present", () => {
    expect(
      extractSelectionFromUrl(
        "https://app.example/?selection=Hello%20world",
      ),
    ).toBe("Hello world");
  });

  it("preserves multi-line selections", () => {
    const url = `https://app.example/?selection=${encodeURIComponent("line one\nline two")}`;
    expect(extractSelectionFromUrl(url)).toBe("line one\nline two");
  });

  it("returns null on a malformed URL (never throws)", () => {
    expect(extractSelectionFromUrl("not a url")).toBeNull();
  });
});

describe("buildSilentCaptureBody", () => {
  const url = "https://nytimes.com/article";

  it("returns just the URL when there's no selection", () => {
    // Mirrors the pre-silent `createCapturedNoteWorkspace` body shape
    // (`note.body = capture.url`). Keeps the Links page indexer happy
    // because `extractUrlsFromText` finds the URL and the link
    // appears in the index.
    expect(buildSilentCaptureBody(null, url)).toBe(url);
  });

  it("returns just the URL when the selection is empty string", () => {
    expect(buildSilentCaptureBody("", url)).toBe(url);
  });

  it("returns just the URL when the selection is whitespace-only", () => {
    expect(buildSilentCaptureBody("   \n\n  ", url)).toBe(url);
  });

  it("appends URL on a blank line below the selection", () => {
    // Pin: selection first, blank line, URL last. Reads as "<thought>
    // — saw it here". Notes-page text rendering relies on the blank
    // line as a paragraph break.
    expect(buildSilentCaptureBody("A neat quote.", url)).toBe(
      `A neat quote.\n\n${url}`,
    );
  });

  it("trims the selection before formatting", () => {
    // A site that includes leading/trailing whitespace in the
    // selection (e.g. clicking inside a span with padding) shouldn't
    // smuggle that whitespace into the body.
    expect(buildSilentCaptureBody("  A quote.  \n", url)).toBe(
      `A quote.\n\n${url}`,
    );
  });

  it("preserves internal whitespace + newlines inside the selection", () => {
    const selection = "Paragraph one.\n\nParagraph two.";
    expect(buildSilentCaptureBody(selection, url)).toBe(
      `Paragraph one.\n\nParagraph two.\n\n${url}`,
    );
  });
});
