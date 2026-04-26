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

  // ---- Boundary suite — kills off-by-one and comparator-flip mutants ----

  it("treats hour 22 as night (lower edge of night window)", () => {
    // Mutant guard: `hour >= 22` flipped to `hour > 22` would push 22:00 to evening.
    expect(pickWhenBucket("2026-04-21T22:00:00")).toBe("night");
  });

  it("treats hour 5 as morning, not night (upper edge of night window)", () => {
    // Mutant guard: `hour < 5` flipped to `hour <= 5` would keep 05:00 in night.
    expect(pickWhenBucket("2026-04-21T05:00:00")).toBe("morning");
  });

  it("does not classify 12:00 as morning (upper edge of morning window)", () => {
    // Mutant guard: `hour < 12` flipped to `hour <= 12` would keep noon in morning.
    expect(pickWhenBucket("2026-04-21T12:00:00")).not.toBe("morning");
  });

  it("does not classify 16:59 as evening (lower edge of evening window)", () => {
    // Mutant guard: `hour >= 17` flipped to `hour > 17` would push 17:00 out
    // of evening and 16:59 in. The 17:00 case is already covered above; this
    // pins the upper edge of the seasonal/weekday window.
    expect(pickWhenBucket("2026-04-21T16:59:00")).not.toBe("evening");
  });

  it("classifies Sunday afternoons as weekend (day === 0)", () => {
    // Mutant guard: `day === 0 || day === 6` losing the `=== 0` half would
    // miss Sunday entirely. 2026-04-26 is a Sunday in UTC; Saturday is
    // already covered above.
    expect(pickWhenBucket("2026-04-26T14:00:00")).toBe("weekend");
  });

  it("treats March (month index 2) as spring's lower edge", () => {
    expect(pickWhenBucket("2026-03-03T14:00:00")).toBe("spring");
  });

  it("treats May (month index 4) as spring's upper edge", () => {
    // 2026-05-26 Tue 14:00 → spring
    expect(pickWhenBucket("2026-05-26T14:00:00")).toBe("spring");
  });

  it("treats June (month index 5) as summer's lower edge", () => {
    // 2026-06-02 Tue 14:00 → summer
    expect(pickWhenBucket("2026-06-02T14:00:00")).toBe("summer");
  });

  it("treats September (month index 8) as autumn's lower edge", () => {
    // 2026-09-01 Tue 14:00 → autumn
    expect(pickWhenBucket("2026-09-01T14:00:00")).toBe("autumn");
  });

  it("treats November (month index 10) as autumn's upper edge", () => {
    // 2026-11-03 Tue 14:00 → autumn
    expect(pickWhenBucket("2026-11-03T14:00:00")).toBe("autumn");
  });

  it("treats December and February as winter (outside spring/summer/autumn)", () => {
    // 2026-12-01 Tue 14:00 → winter
    expect(pickWhenBucket("2026-12-01T14:00:00")).toBe("winter");
    // 2026-02-03 Tue 14:00 → winter
    expect(pickWhenBucket("2026-02-03T14:00:00")).toBe("winter");
  });
});

describe("nightOwlSticker hour boundaries", () => {
  // The rule's early-return is `if (hour < 22 && hour > 5) return null;`
  // — so night-owl applies on hours in [22,23] ∪ [0,5]. A common mutant
  // flips one comparator (e.g. `> 5` → `>= 5`), which would silently
  // drop the 05:00 note out of the night-owl set or push 06:00 into it.
  // Each test below targets one boundary.
  //
  // Boundary tests use no-Z (local-time) timestamps so the asserted
  // hour is exactly what `Date#getHours()` returns regardless of the
  // runner's timezone. The same convention is used in the
  // `pickWhenBucket` boundary suite — see the comment at the top of
  // this file for the reasoning.

  it("applies at exactly 22:00 (lower edge)", () => {
    const note = makeNote({ createdAt: "2026-04-21T22:00:00" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("night-owl");
  });

  it("does not apply at 21:59 (just below lower edge)", () => {
    const note = makeNote({ createdAt: "2026-04-21T21:59:00" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("night-owl");
  });

  it("applies at exactly 05:00 (upper edge inclusive)", () => {
    // The asymmetry against pickWhenBucket (which routes 05:00 to morning)
    // is intentional — a 5am note is night-owl behaviour even on morning
    // paper. Pinning this prevents a mutant flipping `> 5` → `>= 5`.
    const note = makeNote({ createdAt: "2026-04-21T05:00:00" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("night-owl");
  });

  it("does not apply at 06:00 (just above upper edge)", () => {
    const note = makeNote({ createdAt: "2026-04-21T06:00:00" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("night-owl");
  });

  it("applies at midnight 00:00", () => {
    const note = makeNote({ createdAt: "2026-04-21T00:00:00" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("night-owl");
  });

  it("returns nothing when createdAt is missing or unparseable", () => {
    // Hits both branches of the "no usable timestamp" guards: empty
    // string short-circuits before we touch Date(), garbage parses to
    // NaN getHours which the explicit Number.isNaN check rejects.
    const empty = makeNote({ createdAt: "" });
    const garbage = makeNote({ createdAt: "definitely-not-a-date" });
    const fromEmpty = deriveNotebookPersona(empty, { now: NOW });
    const fromGarbage = deriveNotebookPersona(garbage, { now: NOW });
    expect(fromEmpty.stickers.map((s) => s.kind)).not.toContain("night-owl");
    expect(fromGarbage.stickers.map((s) => s.kind)).not.toContain("night-owl");
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

  it("ageWear caps at the 180-day threshold (and stays there beyond)", () => {
    // computeWear: ageWear = min(1, ageDays / 180). Two notes both edited
    // immediately (spanHours = 0), one created exactly 180 days ago and
    // one 360 days ago — they should produce identical age-weights, so
    // their wear differs only by the deterministic jitter (same id →
    // same jitter), meaning equal. Mutant flipping `Math.min` to `Math.max`
    // or changing the divisor would break this equality.
    const oneEighty = new Date(NOW.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const threeSixty = new Date(NOW.getTime() - 360 * 24 * 60 * 60 * 1000).toISOString();

    const a = deriveNotebookPersona(
      makeNote({ id: "wear-cap", createdAt: oneEighty, updatedAt: oneEighty }),
      { now: NOW },
    );
    const b = deriveNotebookPersona(
      makeNote({ id: "wear-cap", createdAt: threeSixty, updatedAt: threeSixty }),
      { now: NOW },
    );
    expect(a.wear).toBe(b.wear);
  });

  it("wears more for older notes (monotone in ageDays below the cap)", () => {
    // 30 days < 90 days < 150 days, all under the 180-day cap. Wear
    // should grow with age (jitter is deterministic by id, identical
    // for both, so the comparison is jitter-invariant).
    const ageWear = (days: number): number => {
      const createdAt = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
      return deriveNotebookPersona(
        makeNote({ id: "wear-grow", createdAt, updatedAt: createdAt }),
        { now: NOW },
      ).wear;
    };
    expect(ageWear(30)).toBeLessThan(ageWear(90));
    expect(ageWear(90)).toBeLessThan(ageWear(150));
  });

  it("editWear contributes additionally at the 80-hour span", () => {
    // Both notes are 30 days old (so identical ageWear), but one has
    // `updatedAt` 80h after `createdAt` (editWear maxed at 1) and the
    // other has zero span (editWear 0). Same id → same jitter, so the
    // span-bearing note must be strictly more worn. Mutant changing
    // the 80h divisor or zeroing the editWear weight would collapse
    // the difference.
    const createdAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const updatedSame = createdAt;
    const updated80h = new Date(
      new Date(createdAt).getTime() + 80 * 60 * 60 * 1000,
    ).toISOString();

    const flat = deriveNotebookPersona(
      makeNote({ id: "edit-span", createdAt, updatedAt: updatedSame }),
      { now: NOW },
    );
    const lived = deriveNotebookPersona(
      makeNote({ id: "edit-span", createdAt, updatedAt: updated80h }),
      { now: NOW },
    );
    expect(lived.wear).toBeGreaterThan(flat.wear);
  });

  it("clamps editWear when updatedAt is before createdAt (clock skew)", () => {
    // Negative span would produce negative editWear without the
    // `Math.max(0, ...)` guard, which would in turn drag total wear
    // below 0 (caught only by the outer Math.min(1, …) — but that's
    // a separate clamp). Pinning the >= 0 guard here.
    const createdAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const updatedBefore = new Date(
      new Date(createdAt).getTime() - 10 * 60 * 60 * 1000,
    ).toISOString();

    const persona = deriveNotebookPersona(
      makeNote({ id: "skew", createdAt, updatedAt: updatedBefore }),
      { now: NOW },
    );
    expect(persona.wear).toBeGreaterThanOrEqual(0);
    expect(persona.wear).toBeLessThanOrEqual(1);
  });
});

describe("oneShotSticker delta-minutes boundaries", () => {
  // Rule: applies when `0 <= deltaMinutes <= 10`. Two mutations to guard:
  //   - `> 10` flipped to `>= 10` would drop the exact-10 case.
  //   - `< 0` flipped to `<= 0` would drop the zero-delta case.
  // Both flips silently shrink the rule's coverage by one boundary.

  it("applies at exactly 10 minutes (upper edge inclusive)", () => {
    const note = makeNote({
      createdAt: "2026-04-21T10:00:00.000Z",
      updatedAt: "2026-04-21T10:10:00.000Z",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("one-shot");
  });

  it("does not apply at 10 minutes + 1 second (just over edge)", () => {
    const note = makeNote({
      createdAt: "2026-04-21T10:00:00.000Z",
      updatedAt: "2026-04-21T10:10:01.000Z",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("one-shot");
  });

  it("applies at exactly 0 minutes (created and updated at the same instant)", () => {
    const stamp = "2026-04-21T10:00:00.000Z";
    const note = makeNote({ createdAt: stamp, updatedAt: stamp });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("one-shot");
  });

  it("does not apply when updatedAt precedes createdAt (negative delta)", () => {
    // Clock skew between devices can produce updated < created. The rule
    // should reject that rather than treat it as a 0-minute one-shot —
    // we don't know what actually happened.
    const note = makeNote({
      createdAt: "2026-04-21T10:00:00.000Z",
      updatedAt: "2026-04-21T09:30:00.000Z",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("one-shot");
  });

  it("returns nothing when either timestamp is missing or unparseable", () => {
    const blankCreated = makeNote({ createdAt: "", updatedAt: "2026-04-21T10:00:00.000Z" });
    const blankUpdated = makeNote({ createdAt: "2026-04-21T10:00:00.000Z", updatedAt: "" });
    const garbage = makeNote({ createdAt: "nope", updatedAt: "also-nope" });
    for (const note of [blankCreated, blankUpdated, garbage]) {
      const persona = deriveNotebookPersona(note, { now: NOW });
      expect(persona.stickers.map((s) => s.kind)).not.toContain("one-shot");
    }
  });
});

describe("regularSticker placeHits threshold", () => {
  // Helper: build N siblings whose `location` slugifies to the same value
  // as the subject note. The persona module re-derives auto-tags via
  // `deriveAutoTags`, so what matters is that `note.location` slugs the
  // same way across siblings (i.e. same string).
  function makeBrnoNote(id: string): SutraPadDocument {
    return makeNote({ id, location: "Brno" });
  }

  it("does NOT apply at exactly 4 sibling notes (just below the threshold)", () => {
    // Mutant guard: `placeHits >= 5` flipped to `>= 4` would attach the
    // sticker too eagerly; flipped to `> 5` would require a 6th sibling.
    const subject = makeBrnoNote("subject");
    const siblings = ["a", "b", "c"].map(makeBrnoNote);
    const persona = deriveNotebookPersona(subject, {
      now: NOW,
      // subject + 3 siblings = 4 location hits total
      allNotes: [subject, ...siblings],
    });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("regular");
  });

  it("applies at exactly 5 sibling notes (lower edge)", () => {
    const subject = makeBrnoNote("subject");
    const siblings = ["a", "b", "c", "d"].map(makeBrnoNote);
    const persona = deriveNotebookPersona(subject, {
      now: NOW,
      // subject + 4 siblings = 5 location hits — exactly the threshold
      allNotes: [subject, ...siblings],
    });
    expect(persona.stickers.map((s) => s.kind)).toContain("regular");
  });

  it("does not apply when the note has no location at all", () => {
    const subject = makeNote({ id: "no-place" });
    const persona = deriveNotebookPersona(subject, { now: NOW, allNotes: [subject] });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("regular");
  });

  it("does not apply when allNotes is empty", () => {
    const subject = makeBrnoNote("only-me");
    const persona = deriveNotebookPersona(subject, { now: NOW, allNotes: [] });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("regular");
  });
});

describe("awaySticker home-base detection", () => {
  // Rule: `away` applies when the note has a `location:` auto-tag whose
  // slugged value does NOT contain any of the Prague substrings. Mutants
  // flipping `.some(...)` to `.every(...)` (would always-match) or
  // dropping the `!`-negation (would invert which side is "away") are
  // the main targets.

  it("applies for non-Prague locations", () => {
    const note = makeNote({ location: "Berlin" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("away");
  });

  it("does NOT apply for a Prague-substring location", () => {
    // "Praha — Vinohrady" slugifies into something containing both
    // "praha" and "vinohrady" — either substring should trigger the
    // home-base early-out and suppress the sticker.
    const note = makeNote({ location: "Praha — Vinohrady" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("away");
  });

  it("does NOT apply when the note has no location", () => {
    const persona = deriveNotebookPersona(makeNote(), { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("away");
  });
});

describe("voiceSticker source check", () => {
  // Rule: `voice` applies iff `facets.source === "text-capture"`. The
  // mutant `=== "text-capture"` → `!== "text-capture"` would invert the
  // condition; the literal mutant on the string would silently break
  // matching. The test stack covers both.

  it("applies for text-capture notes", () => {
    const note = makeNote({ captureContext: { source: "text-capture" } });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("voice");
  });

  it("does NOT apply for url-capture notes", () => {
    const note = makeNote({ captureContext: { source: "url-capture" } });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("voice");
  });

  it("does NOT apply for hand-typed notes (no captureContext.source)", () => {
    const persona = deriveNotebookPersona(makeNote(), { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("voice");
  });
});

describe("toGoSticker open-task detection", () => {
  // Rule: regex `/^\s*-\s*\[\s\]/m` — matches `- [ ]` at line start
  // (with optional leading whitespace). Three mutation surfaces:
  //   - removing the multiline flag (would only match if the open task
  //     is on the very first line)
  //   - flipping the closed `[x]` boundary (regex would match closed
  //     tasks too)
  //   - the `note.body || OPEN_TASK_PATTERN.test(...)` truthy guard

  it("applies when an open task line appears anywhere in the body", () => {
    const note = makeNote({ body: "Header\n\n- [ ] write tests\n- [x] done" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).toContain("to-go");
  });

  it("does not apply when only closed tasks are present", () => {
    const note = makeNote({ body: "- [x] one\n- [x] two\n- [X] three" });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("to-go");
  });

  it("does not apply for a totally empty body", () => {
    const persona = deriveNotebookPersona(makeNote({ body: "" }), { now: NOW });
    expect(persona.stickers.map((s) => s.kind)).not.toContain("to-go");
  });
});

describe("coffee-ring patina threshold", () => {
  // Rule: applied when daysSinceUpdate > 7 AND body has an open task.
  // The `> 7` boundary kills the flip to `>= 7`; the open-task
  // requirement kills the flip to "always when stale".

  it("applies for stale (>7d) notes with an open task", () => {
    const updatedAt = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const note = makeNote({
      id: "stale-task",
      createdAt: updatedAt,
      updatedAt,
      body: "- [ ] respond to email",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.patina).toContain("coffee-ring");
  });

  it("does NOT apply at exactly 7 days (boundary)", () => {
    // Mutant guard: `daysSinceUpdate > 7` flipped to `>= 7` would tag
    // a note edited exactly 7 days ago. Setting updatedAt to NOW - 7d
    // pins the strict-greater-than semantics.
    const updatedAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const note = makeNote({
      id: "exactly-seven",
      createdAt: updatedAt,
      updatedAt,
      body: "- [ ] respond",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.patina).not.toContain("coffee-ring");
  });

  it("does NOT apply for a stale note without an open task", () => {
    const updatedAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const note = makeNote({
      id: "stale-no-task",
      createdAt: updatedAt,
      updatedAt,
      body: "Just a thought I had",
    });
    const persona = deriveNotebookPersona(note, { now: NOW });
    expect(persona.patina).not.toContain("coffee-ring");
  });
});
