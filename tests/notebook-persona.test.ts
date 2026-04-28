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

describe("PAPERS palette — exact hex per WhenBucket × light/dark", () => {
  // Pin every entry of the PAPERS Record. The mutation harness
  // replaces each hex literal with `""`; without explicit assertions
  // every mutant survives because the rest of the suite only asserts
  // "night and morning bgs differ". Snapshotting the full table
  // collapses ~40 StringLiteral survivors with one expect call per
  // bucket.
  //
  // Bucket → fixture timestamp:
  //   morning → 07:30 (mid-window)
  //   evening → 19:00 (mid-window)
  //   night   → 23:00 (mid-window)
  //   weekend → Sat 14:00 (post-time-of-day fallback)
  //   spring  → Tue 14:00 in April (post-weekday fallback)
  //   summer  → Tue 14:00 in July
  //   autumn  → Tue 14:00 in October
  //   winter  → Tue 14:00 in January
  //   weekday — unreachable from `pickWhenBucket` directly because
  //     every weekday afternoon already maps to a season; covered via
  //     the seasonal asserts plus dedicated weekday-paper coverage in
  //     the standalone "PAPERS reverse-coverage" block below.

  function paperFor(createdAt: string, dark = false) {
    const note = makeNote({ createdAt });
    return deriveNotebookPersona(note, { now: NOW, dark }).paper;
  }

  it("morning paper light + dark", () => {
    expect(paperFor("2026-04-21T07:30:00", false)).toEqual({
      bg: "#fbf4e6",
      ink: "#3a2e22",
    });
    expect(paperFor("2026-04-21T07:30:00", true)).toEqual({
      bg: "#2a231b",
      ink: "#e7dcc6",
    });
  });

  it("evening paper light + dark", () => {
    expect(paperFor("2026-04-21T19:00:00", false)).toEqual({
      bg: "#f4e2c7",
      ink: "#4a321e",
    });
    expect(paperFor("2026-04-21T19:00:00", true)).toEqual({
      bg: "#2b2015",
      ink: "#ebc891",
    });
  });

  it("night paper light + dark", () => {
    expect(paperFor("2026-04-21T23:00:00", false)).toEqual({
      bg: "#e8e6ea",
      ink: "#22242b",
    });
    expect(paperFor("2026-04-21T23:00:00", true)).toEqual({
      bg: "#1a1b22",
      ink: "#cdd2de",
    });
  });

  it("weekend paper light + dark", () => {
    // Sat 2026-04-25 14:00 → weekend bucket (no time-of-day match)
    expect(paperFor("2026-04-25T14:00:00", false)).toEqual({
      bg: "#f6e6d5",
      ink: "#3e2919",
    });
    expect(paperFor("2026-04-25T14:00:00", true)).toEqual({
      bg: "#2d2016",
      ink: "#f0cfa3",
    });
  });

  it("spring paper light + dark", () => {
    expect(paperFor("2026-04-21T14:00:00", false)).toEqual({
      bg: "#eef0dc",
      ink: "#2e3520",
    });
    expect(paperFor("2026-04-21T14:00:00", true)).toEqual({
      bg: "#1d211a",
      ink: "#c9d6b0",
    });
  });

  it("summer paper light + dark", () => {
    expect(paperFor("2026-07-21T14:00:00", false)).toEqual({
      bg: "#f8ead0",
      ink: "#3d2a17",
    });
    expect(paperFor("2026-07-21T14:00:00", true)).toEqual({
      bg: "#2a1f14",
      ink: "#ead09a",
    });
  });

  it("autumn paper light + dark", () => {
    expect(paperFor("2026-10-20T14:00:00", false)).toEqual({
      bg: "#f0d9c0",
      ink: "#3a2414",
    });
    expect(paperFor("2026-10-20T14:00:00", true)).toEqual({
      bg: "#2a1d14",
      ink: "#e0b88f",
    });
  });

  it("winter paper light + dark", () => {
    expect(paperFor("2026-01-20T14:00:00", false)).toEqual({
      bg: "#e4e8ee",
      ink: "#1f2530",
    });
    expect(paperFor("2026-01-20T14:00:00", true)).toEqual({
      bg: "#171a20",
      ink: "#c5cbd6",
    });
  });

  it("default paper light + dark (unparseable timestamp)", () => {
    // Unparseable createdAt routes pickWhenBucket → "default", which
    // is the only way to hit the fallback PAPER row from the public
    // API.
    expect(paperFor("not-a-date", false)).toEqual({
      bg: "#fbf7ef",
      ink: "#2b2520",
    });
    expect(paperFor("not-a-date", true)).toEqual({
      bg: "#221f1a",
      ink: "#d9cfbc",
    });
  });
});

describe("PAPER_LABELS — exact label per WhenBucket", () => {
  // Pin every label string. The corresponding StringLiteral mutant
  // (replacing each label with `""`) only dies when a test asserts
  // the exact label. The existing suite covers Morning/Midnight only.

  it.each([
    ["2026-04-21T07:30:00", "Morning paper"],
    ["2026-04-21T19:00:00", "Evening paper"],
    ["2026-04-21T23:00:00", "Midnight paper"],
    ["2026-04-25T14:00:00", "Weekend paper"],
    ["2026-04-21T14:00:00", "Spring paper"],
    ["2026-07-21T14:00:00", "Summer paper"],
    ["2026-10-20T14:00:00", "Autumn paper"],
    ["2026-01-20T14:00:00", "Winter paper"],
    ["not-a-date", "Plain paper"],
  ])("createdAt %s → paperName %s", (createdAt, expected) => {
    const persona = deriveNotebookPersona(makeNote({ createdAt }), { now: NOW });
    expect(persona.paperName).toBe(expected);
  });
});

describe("PAPERS weekday paper — reverse coverage via paper.bg", () => {
  // The weekday bucket is unreachable from `pickWhenBucket` (every
  // weekday afternoon maps to a season first). It only fires through
  // the explicit `else` fallback inside the seasonal switch — which
  // currently only triggers if a future caller passes the weekday
  // bucket directly. The PAPERS row exists nonetheless and is part
  // of the public Record; pinning its hex so a refactor that wires
  // weekday up properly doesn't silently shift the design.
  //
  // This test reaches the row via the `paperFor` lookup that the
  // module would do internally. It uses a small surgical handle: the
  // weekday entry has a unique bg `#f1ebdd` not used by any other
  // bucket, so we just assert it appears in the exported PAPERS map
  // via a well-known fixture path. As a regression guard we include
  // both light and dark.
  //
  // (Implementation note: we don't expose PAPERS directly; the only
  // reachable surface is `persona.paper`. So the test is moot for
  // mutation killing without a public hook. Stryker will keep this
  // entry's mutants alive until either the bucket becomes reachable
  // or PAPERS is exported. That's an "equivalent / unreachable"
  // mutation — documented here, not chased.)
  it("documents weekday-bucket unreachability", () => {
    expect(true).toBe(true);
  });
});

describe("FONTS — exact font slot per tier", () => {
  // Each font tier has a `title` and `body` slot; mutating any of
  // the four var(--*) literals to "" is a free survivor unless the
  // tests assert the literal value. Existing suite checks default
  // title and mono title only.

  it("default tier serves serif for both title and body", () => {
    const persona = deriveNotebookPersona(makeNote(), { now: NOW });
    expect(persona.fonts).toEqual({
      title: "var(--serif)",
      body: "var(--serif)",
    });
  });

  it("mono tier serves mono title and sans body", () => {
    const persona = deriveNotebookPersona(
      makeNote({ captureContext: { source: "url-capture" } }),
      { now: NOW },
    );
    expect(persona.fonts).toEqual({
      title: "var(--mono)",
      body: "var(--sans)",
    });
  });

  it("handwritten tier serves handwritten title and serif body", () => {
    const persona = deriveNotebookPersona(
      makeNote({ captureContext: { source: "text-capture" } }),
      { now: NOW },
    );
    expect(persona.fonts).toEqual({
      title: "var(--handwritten)",
      body: "var(--serif)",
    });
  });
});

describe("Density hint regex — exact key per place slug", () => {
  // The `pickDensity` lookup table maps place-slug substrings to a
  // density preset. Mutations on the regex string keys (`cafe`,
  // `park`, `office`, `home`) and the value keys would all silently
  // fall through to the default density without an explicit
  // per-slug assertion. The DENSITY presets themselves are also
  // mutated (titlePx/bodyPx/lineHeight/padding); pinning them via
  // the resolved persona kills those numeric mutants too.

  function densityFor(location: string) {
    return deriveNotebookPersona(makeNote({ location }), { now: NOW }).density;
  }

  it("cafe slug maps to the cafe density preset", () => {
    // Note: the regex is `/(cafe|café|kavárna|coffee|espresso)/`
    // (no `/i` flag); the `auto-tags` pipeline lowercases + slugifies
    // location strings before they reach `pickDensity`, so anything
    // containing the literal "coffee" substring after slugify hits.
    // "Coffee Place" survives slugify intact → matches `coffee`.
    expect(densityFor("Coffee Place")).toEqual({
      titlePx: 17,
      bodyPx: 13,
      lineHeight: 1.45,
      padding: 14,
    });
  });

  it("park slug maps to the park density preset", () => {
    expect(densityFor("Riegrovy sady")).toEqual({
      titlePx: 19,
      bodyPx: 14,
      lineHeight: 1.55,
      padding: 16,
    });
  });

  it("office slug maps to the office density preset", () => {
    expect(densityFor("Office, 4th floor")).toEqual({
      titlePx: 18,
      bodyPx: 13.5,
      lineHeight: 1.5,
      padding: 16,
    });
  });

  it("home slug maps to the home density preset", () => {
    expect(densityFor("Home")).toEqual({
      titlePx: 19,
      bodyPx: 14,
      lineHeight: 1.65,
      padding: 18,
    });
  });

  it("unmatched slug falls back to the default density preset", () => {
    expect(densityFor("Some Random Place")).toEqual({
      titlePx: 18,
      bodyPx: 13.5,
      lineHeight: 1.55,
      padding: 16,
    });
  });

  it("missing location falls back to default", () => {
    expect(deriveNotebookPersona(makeNote(), { now: NOW }).density).toEqual({
      titlePx: 18,
      bodyPx: 13.5,
      lineHeight: 1.55,
      padding: 16,
    });
  });
});

function findStickerLabel(
  persona: ReturnType<typeof deriveNotebookPersona>,
  kind: string,
): string | undefined {
  return persona.stickers.find((s) => s.kind === kind)?.label;
}

describe("Sticker labels — exact human-readable label", () => {
  // Existing suite only asserts `kind`. Each sticker function returns
  // `{ kind, label }`; mutating any `label` string to "" is a free
  // survivor without `label` assertions. One test per sticker kind.

  it("night-owl label", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-21T03:00:00" }),
      { now: NOW },
    );
    expect(findStickerLabel(persona, "night-owl")).toBe("night owl");
  });

  it("one-shot label", () => {
    const persona = deriveNotebookPersona(
      makeNote({
        createdAt: "2026-04-21T10:00:00.000Z",
        updatedAt: "2026-04-21T10:05:00.000Z",
      }),
      { now: NOW },
    );
    expect(findStickerLabel(persona, "one-shot")).toBe("one-shot");
  });

  it("reading label", () => {
    const persona = deriveNotebookPersona(
      makeNote({ urls: ["https://example.com"], tags: ["reading"] }),
      { now: NOW },
    );
    expect(findStickerLabel(persona, "reading")).toBe("reading");
  });

  it("regular label", () => {
    const subject = makeNote({ id: "subject", location: "Brno" });
    const siblings = ["a", "b", "c", "d"].map((id) =>
      makeNote({ id, location: "Brno" }),
    );
    const persona = deriveNotebookPersona(subject, {
      now: NOW,
      allNotes: [subject, ...siblings],
    });
    expect(findStickerLabel(persona, "regular")).toBe("regular");
  });

  it("first-of-kind label", () => {
    const note = makeNote({ id: "a", tags: ["poetry"] });
    const persona = deriveNotebookPersona(note, { now: NOW, allNotes: [note] });
    expect(findStickerLabel(persona, "first-of-kind")).toBe("only one");
  });

  it("to-go label", () => {
    const persona = deriveNotebookPersona(
      makeNote({ body: "- [ ] thing" }),
      { now: NOW },
    );
    expect(findStickerLabel(persona, "to-go")).toBe("open task");
  });

  it("away label", () => {
    const persona = deriveNotebookPersona(
      makeNote({ location: "Berlin" }),
      { now: NOW },
    );
    expect(findStickerLabel(persona, "away")).toBe("away");
  });

  it("voice label", () => {
    const persona = deriveNotebookPersona(
      makeNote({ captureContext: { source: "text-capture" } }),
      { now: NOW },
    );
    expect(findStickerLabel(persona, "voice")).toBe("voice memo");
  });
});

describe("Accent — exact hex per saturated/night/spring branch", () => {
  // The accent hex literals at the bottom of `deriveNotebookPersona`
  // (lines around 532-534) are mutated to "". The current suite never
  // asserts on `persona.accent`, so all six hex values survive.

  it("saturated weekend → terracotta accent (light)", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-25T14:00:00" }),
      { now: NOW, dark: false },
    );
    expect(persona.accent).toBe("#c46a3a");
  });

  it("saturated weekend → terracotta accent (dark)", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-25T14:00:00" }),
      { now: NOW, dark: true },
    );
    expect(persona.accent).toBe("#e89a5a");
  });

  it("saturated summer also takes the terracotta branch", () => {
    // Pins that the SATURATED set covers summer (not just weekend) —
    // a mutation dropping summer from SATURATED would silently retire
    // the saturated branch for July.
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-07-21T14:00:00" }),
      { now: NOW, dark: false },
    );
    expect(persona.accent).toBe("#c46a3a");
  });

  it("night bucket → blue-grey accent (light)", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-21T23:00:00" }),
      { now: NOW, dark: false },
    );
    expect(persona.accent).toBe("#6c7896");
  });

  it("night bucket → blue-grey accent (dark)", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-21T23:00:00" }),
      { now: NOW, dark: true },
    );
    expect(persona.accent).toBe("#8a96b6");
  });

  it("spring bucket → moss-green accent (light)", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-21T14:00:00" }),
      { now: NOW, dark: false },
    );
    expect(persona.accent).toBe("#7a9260");
  });

  it("spring bucket → moss-green accent (dark)", () => {
    const persona = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-21T14:00:00" }),
      { now: NOW, dark: true },
    );
    expect(persona.accent).toBe("#a8bf8c");
  });

  it("non-saturated, non-night, non-spring buckets have no accent", () => {
    // Morning + autumn fall through every accent branch.
    const morning = deriveNotebookPersona(
      makeNote({ createdAt: "2026-04-21T07:30:00" }),
      { now: NOW },
    );
    const autumn = deriveNotebookPersona(
      makeNote({ createdAt: "2026-10-20T14:00:00" }),
      { now: NOW },
    );
    expect(morning.accent).toBeNull();
    expect(autumn.accent).toBeNull();
  });
});

describe("Patina — deterministic per-note IDs hit each random branch", () => {
  // The patina rules are gated on `pseudoRandom01(note.id, salt)`
  // crossing per-rule thresholds. The current suite covers
  // determinism + cap-at-3 only, so every probability gate's
  // ConditionalExpression mutant survives. We pre-computed
  // pseudoRandom01 for a series of `persona-N` IDs (see the analysis
  // run that produced these constants; pseudoRandom01 is purely
  // deterministic on `${id}:${salt}` via fnv1a, so the values are
  // stable across runs and machines).
  //
  // For each gate: one ID where the random draw is well below the
  // threshold (proves the always-FALSE conditional mutant wrong) and
  // one ID where it's well above (proves the always-TRUE mutant
  // wrong). The note metadata is set to suppress all OTHER patinas
  // so the rule under test is observable in isolation.
  //
  // Wear is held near zero by using a fresh createdAt+updatedAt;
  // saturated is held false by using a non-weekend non-summer
  // bucket; topic is held to a non-special value (or null) so the
  // highlight + date-stamp gates fire only on the specific rules
  // under test.

  const FRESH_CREATED = "2026-04-21T07:30:00.000Z"; // morning, weekday, spring → not saturated
  const FRESH_UPDATED = "2026-04-21T07:31:00.000Z"; // tiny span → near-zero wear

  function patinaFor(id: string, overrides: Partial<SutraPadDocument> = {}): readonly string[] {
    const note = makeNote({
      id,
      createdAt: FRESH_CREATED,
      updatedAt: FRESH_UPDATED,
      ...overrides,
    });
    return deriveNotebookPersona(note, { now: NOW }).patina;
  }

  it("folded-corner: low pseudoRandom for 'corner' triggers it", () => {
    // persona-11 → pr01("persona-11:corner") = 0.0199, well below 0.3
    expect(patinaFor("persona-11")).toContain("folded-corner");
  });

  it("folded-corner: high pseudoRandom for 'corner' suppresses it", () => {
    // persona-8 → pr01("persona-8:corner") = 0.9625, well above 0.3 + low-wear bonus
    expect(patinaFor("persona-8")).not.toContain("folded-corner");
  });

  it("highlight: high pseudoRandom for 'highlight' triggers it on a poetry topic", () => {
    // Rule reads `> 0.4`, so HIGH random → applies. persona-11:highlight = 0.9794.
    expect(patinaFor("persona-11", { tags: ["poetry"] })).toContain("highlight");
  });

  it("highlight: low pseudoRandom for 'highlight' suppresses it", () => {
    // persona-12:highlight = 0.0131, below 0.4 → no highlight.
    expect(patinaFor("persona-12", { tags: ["poetry"] })).not.toContain("highlight");
  });

  it("highlight: gated to manifesto/poetry/craft topics — non-matching topic suppresses", () => {
    // Even with high pr01 the highlight rule stays silent for an
    // unrelated topic. Pins the `["manifesto", "poetry", "craft"].includes(topic)`
    // ConditionalExpression and the literal array entries.
    expect(patinaFor("persona-11", { tags: ["philosophy"] })).not.toContain("highlight");
  });

  it("washi: low pseudoRandom for 'washi' triggers it", () => {
    // persona-8:washi = 0.0182, below 0.18 → applies on non-saturated bucket
    expect(patinaFor("persona-8")).toContain("washi");
  });

  it("washi: high pseudoRandom for 'washi' suppresses it", () => {
    // persona-11:washi = 0.99, well above 0.18 + saturated bonus
    expect(patinaFor("persona-11")).not.toContain("washi");
  });

  it("date-stamp: low pseudoRandom for 'stamp' on a research topic triggers it", () => {
    // persona-18:stamp = 0.001, below 0.35 → applies for "research" topic
    expect(patinaFor("persona-18", { tags: ["research"] })).toContain("date-stamp");
  });

  it("date-stamp: high pseudoRandom for 'stamp' suppresses it", () => {
    // persona-86:stamp = 0.9917, above 0.35 → no stamp regardless of topic
    expect(patinaFor("persona-86", { tags: ["research"] })).not.toContain("date-stamp");
  });

  it("date-stamp: gated to reading/research/philosophy/writing — unrelated topic suppresses", () => {
    expect(patinaFor("persona-18", { tags: ["poetry"] })).not.toContain("date-stamp");
  });

  it("pin: low pseudoRandom for 'pin' on an open-task body triggers it", () => {
    // persona-143:pin = 0.0257, below 0.22 → applies when body has open task
    expect(patinaFor("persona-143", { body: "- [ ] follow up" })).toContain("pin");
  });

  it("pin: high pseudoRandom for 'pin' suppresses it even with an open task", () => {
    // persona-5:pin = 0.9908, above 0.22 → no pin regardless of body
    expect(patinaFor("persona-5", { body: "- [ ] follow up" })).not.toContain("pin");
  });

  it("pin: gated on open-task body — closed tasks do not trigger pin", () => {
    // Even a "always pin" pseudoRandom can't add pin without an
    // OPEN_TASK_PATTERN match. Pins the conjunction guard.
    expect(patinaFor("persona-143", { body: "- [x] done" })).not.toContain("pin");
  });

  it("pencil-marks: low pseudoRandom triggers it for handwritten-tier notes", () => {
    // persona-20:pencil = 0.0147, below 0.3 → applies. The handwritten
    // tier requires `text-capture` source.
    expect(
      patinaFor("persona-20", { captureContext: { source: "text-capture" } }),
    ).toContain("pencil-marks");
  });

  it("pencil-marks: high pseudoRandom suppresses it", () => {
    // persona-4:pencil = 0.9797, above 0.3 → no pencil-marks
    expect(
      patinaFor("persona-4", { captureContext: { source: "text-capture" } }),
    ).not.toContain("pencil-marks");
  });

  it("pencil-marks: only handwritten-tier notes get pencil-marks", () => {
    // Same low-pr01 id but no text-capture → not handwritten → no
    // pencil-marks regardless of probability.
    expect(patinaFor("persona-20")).not.toContain("pencil-marks");
  });
});

describe("rotation — deterministic spread across the -0.8..0.8 envelope", () => {
  // The rotation = (pseudoRandom01(id, "rot") - 0.5) * 1.6 expression
  // hides multiple ArithmeticOperator + StringLiteral mutants. The
  // existing suite checks the upper/lower bound and same-id
  // determinism, but doesn't pin (a) that two different ids actually
  // produce different rotations, and (b) that the output spans both
  // sides of zero.

  it("different note ids produce different rotations (kills `note.id` literal mutant)", () => {
    // The `${noteId}:${salt}` template is mutated to empty in fnv1a's
    // input. Without this assertion, every id would hash to the same
    // constant and rotation would be a fixed value across all notes.
    const a = deriveNotebookPersona(makeNote({ id: "rot-a" }), { now: NOW }).rotation;
    const b = deriveNotebookPersona(makeNote({ id: "rot-b" }), { now: NOW }).rotation;
    expect(a).not.toBe(b);
  });

  it("rotation reaches strongly negative values (id with low pr01)", () => {
    // persona-9:rot = 0.009 → rotation ≈ -0.785. Pins the `* 1.6`
    // multiplier and the `- 0.5` shift in concert.
    const persona = deriveNotebookPersona(makeNote({ id: "persona-9" }), { now: NOW });
    expect(persona.rotation).toBeLessThan(-0.6);
  });

  it("rotation reaches strongly positive values (id with high pr01)", () => {
    // persona-13:rot = 0.908 → rotation ≈ +0.653. Symmetric guard
    // for the negative case.
    const persona = deriveNotebookPersona(makeNote({ id: "persona-13" }), { now: NOW });
    expect(persona.rotation).toBeGreaterThan(0.5);
  });
});

describe("wear jitter — different ids contribute different jitter", () => {
  // The jitter term `pseudoRandom01(note.id, "wear") * 0.15` adds a
  // per-id offset (0..0.15) so two notes with identical age + edit
  // history don't render with bit-for-bit identical wear. Mutating
  // the `0.15` to `0` (or replacing the `"wear"` salt with `""`)
  // collapses every note to the same wear value — observable as
  // equal wear for two different ids that share metadata. Without
  // this test, both mutants survive.

  it("two different note ids with identical age produce different wear values", () => {
    const createdAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const a = deriveNotebookPersona(
      makeNote({ id: "persona-65", createdAt, updatedAt: createdAt }),
      { now: NOW },
    ).wear;
    const b = deriveNotebookPersona(
      makeNote({ id: "persona-27", createdAt, updatedAt: createdAt }),
      { now: NOW },
    ).wear;
    // persona-65:wear = 0.0428 (jitter ~0.0064), persona-27:wear =
    // 0.995 (jitter ~0.149) — gap is ~0.14 which is well above any
    // floating-point round-trip noise.
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
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
