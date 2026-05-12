import { describe, expect, it } from "vitest";
import type { SutraPadDocument } from "../src/types";
import { pickNoteThumbSeed } from "../src/app/logic/link-thumb-seed";

function makeNote(
  overrides: Partial<SutraPadDocument> & { id: string },
): SutraPadDocument {
  return {
    title: "Test",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("pickNoteThumbSeed", () => {
  it("uses the first user-typed tag when one exists", () => {
    // The expected end-user effect: two #trek notes share a band hue
    // regardless of where they came from. Pin the lower-cased value
    // explicitly so a future tweak that drops case-folding (and lets
    // `#AI` vs `#ai` diverge) gets caught.
    const note = makeNote({ id: "n1", tags: ["trek", "gear"] });
    expect(pickNoteThumbSeed(note)).toBe("trek");
  });

  it("lower-cases the tag so `#AI` and `#ai` share a hue", () => {
    const note = makeNote({ id: "n1", tags: ["AI"] });
    expect(pickNoteThumbSeed(note)).toBe("ai");
  });

  it("skips namespaced auto-tags and picks the next user tag", () => {
    // `location:` / `source:` / `device:` tags are derived facets that
    // already drive other parts of the persona (paper colour, font
    // tier). Reusing them as the band hue would just echo information
    // the rest of the card already carries.
    const note = makeNote({
      id: "n1",
      tags: ["location:vinohrady", "source:url-capture", "trek"],
    });
    expect(pickNoteThumbSeed(note)).toBe("trek");
  });

  it("skips empty-string tags before falling through", () => {
    // Defensive guard — `extractHashtagsFromText` filters them, but a
    // sufficiently old workspace migration could leave one behind. A
    // zero-length seed would hash to a single hue for every such note
    // and reintroduce exactly the "olive everywhere" problem this
    // helper exists to kill.
    const note = makeNote({
      id: "n1",
      tags: ["", "trek"],
    });
    expect(pickNoteThumbSeed(note)).toBe("trek");
  });

  it("falls through to the primary URL hostname when there is no user tag", () => {
    // Two captures from the same site wear the same hue even when
    // they don't share a tag — the property the Links page already
    // relies on.
    const note = makeNote({
      id: "n1",
      urls: ["https://www.nytimes.com/article"],
      tags: ["location:vinohrady"],
    });
    expect(pickNoteThumbSeed(note)).toBe("nytimes.com");
  });

  it("prefers the canonical URL over note.urls[0] for hostname seeding", () => {
    // `deriveNotePrimaryUrl` puts `captureContext.page.canonicalUrl`
    // first so tracking-tail variants don't fragment the hue across
    // captures. The seed picker has to mirror that or the prewarmed
    // canonical thumb image and the band hue would end up out of sync.
    const note = makeNote({
      id: "n1",
      urls: ["https://nytimes.com/article?utm=tracking"],
      captureContext: {
        source: "url-capture",
        page: { canonicalUrl: "https://www.example.com/canon" },
      },
    });
    expect(pickNoteThumbSeed(note)).toBe("example.com");
  });

  it("returns the raw URL string when the URL is malformed (hostname parse fails)", () => {
    // `deriveLinkHostname` returns null on `new URL` throw. The fall-
    // through to the raw URL keeps the seed URL-derived (rather than
    // skipping straight to `note.id`) so two captures of the same
    // malformed string still match.
    const note = makeNote({
      id: "n1",
      urls: ["not a url"],
    });
    expect(pickNoteThumbSeed(note)).toBe("not a url");
  });

  it("falls all the way back to note.id when there's no tag and no URL", () => {
    // The whole point of dropping the literal `"sutrapad"` fallback:
    // every hand-typed tagless note used to share one hue. Using
    // note.id guarantees a distinct deterministic hue per note.
    const note = makeNote({ id: "abc-123" });
    expect(pickNoteThumbSeed(note)).toBe("abc-123");
  });

  it("returns identical seeds for two distinct notes that share a primary tag", () => {
    // Pins the semantic clustering property: same #tag → same hue.
    // The grid leans on this so a column of #ai notes reads as a
    // cohesive group.
    const a = makeNote({ id: "a", tags: ["ai", "test"] });
    const b = makeNote({ id: "b", tags: ["ai", "prod"] });
    expect(pickNoteThumbSeed(a)).toBe(pickNoteThumbSeed(b));
  });

  it("returns distinct seeds for two tag-less notes with different ids", () => {
    // Pins the fallback property: no shared seed across notes that
    // don't carry tags or URLs.
    const a = makeNote({ id: "alpha" });
    const b = makeNote({ id: "beta" });
    expect(pickNoteThumbSeed(a)).not.toBe(pickNoteThumbSeed(b));
  });
});
