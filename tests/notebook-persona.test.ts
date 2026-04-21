import { describe, expect, it } from "vitest";
import {
  deriveNotebookPersona,
  pickWhenBucket,
} from "../src/lib/notebook-persona";
import type { SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "note-1",
    title: "Test",
    body: "",
    urls: [],
    createdAt: "2026-04-21T10:00:00.000Z",
    updatedAt: "2026-04-21T10:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

const NOW = new Date("2026-04-21T12:00:00.000Z");

/**
 * All `createdAt`/`updatedAt` values in this file are ISO-Z, but the
 * time-of-day bucketing inside persona works against `Date#getHours()` —
 * which reads the local timezone. That makes the tests environment-dependent
 * in theory; in practice the CI runs in UTC (and the auto-tags tests rely
 * on the same assumption). Keeping the convention makes new test cases
 * look identical to the rest of the suite.
 */

describe("pickWhenBucket", () => {
  it("picks night for hours 22:00-04:59", () => {
    expect(pickWhenBucket("2026-04-21T22:30:00")).toBe("night");
    expect(pickWhenBucket("2026-04-21T02:30:00")).toBe("night");
    expect(pickWhenBucket("2026-04-21T04:59:00")).toBe("night");
  });

  it("picks morning for 05:00-11:59", () => {
    expect(pickWhenBucket("2026-04-21T05:00:00")).toBe("morning");
    expect(pickWhenBucket("2026-04-21T11:59:00")).toBe("morning");
  });

  it("picks evening for 17:00-21:59", () => {
    expect(pickWhenBucket("2026-04-21T17:00:00")).toBe("evening");
    expect(pickWhenBucket("2026-04-21T21:59:00")).toBe("evening");
  });

  it("falls back to weekend when the afternoon lands on Sat/Sun", () => {
    // 2026-04-25 is a Saturday (day=6); 14:00 is outside the night/morning/
    // evening windows, so weekend should win.
    expect(pickWhenBucket("2026-04-25T14:00:00")).toBe("weekend");
  });

  it("falls back to seasonal buckets on weekday afternoons", () => {
    // 2026-04-21 Tue 14:00 → spring (April)
    expect(pickWhenBucket("2026-04-21T14:00:00")).toBe("spring");
    // 2026-07-21 Tue 14:00 → summer
    expect(pickWhenBucket("2026-07-21T14:00:00")).toBe("summer");
    // 2026-10-20 Tue 14:00 → autumn
    expect(pickWhenBucket("2026-10-20T14:00:00")).toBe("autumn");
    // 2026-01-20 Tue 14:00 → winter
    expect(pickWhenBucket("2026-01-20T14:00:00")).toBe("winter");
  });

  it("returns default for unparseable input", () => {
    expect(pickWhenBucket("not-a-date")).toBe("default");
  });
});

describe("deriveNotebookPersona: paper + names", () => {
  it("uses the when bucket to pick the paper palette", () => {
    const nightNote = makeNote({ createdAt: "2026-04-21T23:30:00.000Z" });
    const morningNote = makeNote({ createdAt: "2026-04-21T07:30:00.000Z" });

    const night = deriveNotebookPersona(nightNote, { now: NOW });
    const morning = deriveNotebookPersona(morningNote, { now: NOW });

    expect(night.paperName).toBe("Midnight paper");
    expect(morning.paperName).toBe("Morning paper");
    expect(night.paper.bg).not.toBe(morning.paper.bg);
  });

  it("flips to the dark paper variant when dark=true", () => {
    const note = makeNote({ createdAt: "2026-04-21T07:30:00.000Z" });
    const light = deriveNotebookPersona(note, { now: NOW, dark: false });
    const dark = deriveNotebookPersona(note, { now: NOW, dark: true });

    expect(light.paper.bg).not.toBe(dark.paper.bg);
    // Dark bg should be significantly darker — a cheap luminance check is
    // enough to keep this assertion resilient to palette tuning.
    expect(dark.paper.bg).toMatch(/^#[0-3]/);
  });

  it("titles the notebook after the first user tag when present", () => {
    const note = makeNote({ tags: ["reading", "evening"] });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.notebookName).toBe("Reading notebook");
  });

  it("falls back to the paper label when no topic tag is set", () => {
    const note = makeNote({
      createdAt: "2026-04-21T23:30:00.000Z",
      tags: [],
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.notebookName).toBe("Midnight paper");
  });

  it("ignores namespaced auto-tags when picking a topic", () => {
    // `device:mobile` is an auto-tag shape, not a user topic. The persona
    // should skip it and fall back to the paper label.
    const note = makeNote({
      createdAt: "2026-04-21T23:30:00.000Z",
      tags: ["device:mobile", "date:today"],
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.notebookName).toBe("Midnight paper");
  });
});

describe("deriveNotebookPersona: font tier", () => {
  it("picks mono for url-capture notes", () => {
    const note = makeNote({
      captureContext: { source: "url-capture" },
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.fontTier).toBe("mono");
    expect(persona.fonts.title).toBe("var(--mono)");
  });

  it("picks handwritten for text-capture notes", () => {
    const note = makeNote({
      captureContext: { source: "text-capture" },
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.fontTier).toBe("handwritten");
  });

  it("defaults to serif for hand-typed notes", () => {
    const persona = deriveNotebookPersona(makeNote(), { now: NOW });
    expect(persona.fontTier).toBe("default");
    expect(persona.fonts.title).toBe("var(--serif)");
  });
});

describe("deriveNotebookPersona: stickers", () => {
  it("adds night-owl for notes created between 22:00 and 05:00", () => {
    const note = makeNote({ createdAt: "2026-04-21T03:30:00.000Z" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("night-owl");
  });

  it("adds one-shot when the created/updated window is under 10 minutes", () => {
    const note = makeNote({
      createdAt: "2026-04-21T10:00:00.000Z",
      updatedAt: "2026-04-21T10:05:00.000Z",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("one-shot");
  });

  it("does not add one-shot when the edit span is longer than 10 minutes", () => {
    const note = makeNote({
      createdAt: "2026-04-21T09:00:00.000Z",
      updatedAt: "2026-04-21T10:00:00.000Z",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("one-shot");
  });

  it("adds reading when the note has URLs and a 'reading' user tag", () => {
    const note = makeNote({
      urls: ["https://example.com/article"],
      tags: ["reading"],
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("reading");
  });

  it("adds to-go when the body has an unchecked task line", () => {
    const note = makeNote({ body: "Shopping\n- [ ] milk\n- [x] bread" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("to-go");
  });

  it("adds first-of-kind when no other note shares the topic", () => {
    const note = makeNote({ id: "a", tags: ["poetry"] });
    const sibling = makeNote({ id: "b", tags: ["reading"] });
    const persona = deriveNotebookPersona(note, {
      now: NOW,
      allNotes: [note, sibling],
    });
    expect(persona.stickers.map((s) => s.kind)).toContain("first-of-kind");
  });

  it("does NOT add first-of-kind when another note shares the topic", () => {
    const note = makeNote({ id: "a", tags: ["poetry"] });
    const sibling = makeNote({ id: "b", tags: ["poetry"] });
    const persona = deriveNotebookPersona(note, {
      now: NOW,
      allNotes: [note, sibling],
    });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("first-of-kind");
  });

  it("caps the sticker list at 3 entries", () => {
    // Stack multiple conditions: night-owl + one-shot + reading + to-go + voice.
    const note = makeNote({
      createdAt: "2026-04-21T23:59:00.000Z",
      updatedAt: "2026-04-21T23:59:30.000Z",
      urls: ["https://example.com/x"],
      tags: ["reading"],
      body: "- [ ] follow up",
      captureContext: { source: "text-capture" },
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.length).toBeLessThanOrEqual(3);
  });
});

describe("deriveNotebookPersona: rotation + determinism", () => {
  it("produces the same rotation and patina for the same note id", () => {
    const note = makeNote({ id: "deterministic-id" });
    const a = deriveNotebookPersona(note, { now: NOW });
    const b = deriveNotebookPersona(note, { now: NOW });
    expect(a.rotation).toBe(b.rotation);
    expect(a.patina).toEqual(b.patina);
  });

  it("keeps rotation inside the documented -0.8..0.8 deg envelope", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      const persona = deriveNotebookPersona(makeNote({ id }), { now: NOW });
      expect(persona.rotation).toBeGreaterThanOrEqual(-0.8);
      expect(persona.rotation).toBeLessThanOrEqual(0.8);
    }
  });

  it("caps patina list at 3 entries", () => {
    // Old, worn, handwritten, with topic highlight + open task + stale update
    // → stacks multiple patina conditions at once.
    const note = makeNote({
      id: "worn",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-03-01T00:00:00.000Z",
      tags: ["poetry"],
      body: "- [ ] finish",
      captureContext: { source: "text-capture" },
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.patina.length).toBeLessThanOrEqual(3);
  });
});

describe("deriveNotebookPersona: wear", () => {
  it("treats brand-new notes as near-zero wear", () => {
    const createdAt = new Date(NOW.getTime() - 60 * 1000).toISOString();
    const note = makeNote({ createdAt, updatedAt: createdAt });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.wear).toBeLessThan(0.25);
  });

  it("maxes out at 1 for very old + long-spanned notes", () => {
    const note = makeNote({
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.wear).toBeLessThanOrEqual(1);
    expect(persona.wear).toBeGreaterThan(0.9);
  });
});
