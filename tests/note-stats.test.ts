import { describe, expect, it } from "vitest";
import { computeNoteStats } from "../src/app/logic/note-stats";
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

describe("computeNoteStats", () => {
  it("reports zero words for a blank or whitespace-only body", () => {
    // Empty strings previously split to [""] and mis-counted as one word; the
    // zero guard here pins that regression down.
    expect(computeNoteStats(makeNote({ body: "" })).wordCount).toBe(0);
    expect(computeNoteStats(makeNote({ body: "   \n\t  " })).wordCount).toBe(0);
  });

  it("counts whitespace-separated tokens as words", () => {
    const stats = computeNoteStats(makeNote({ body: "one two three four five" }));
    expect(stats.wordCount).toBe(5);
  });

  it("floors the read-minute estimate at one minute for short notes", () => {
    // Even a single-word note should show "1 min read" — rounding would make
    // a 5-word note register as 0 minutes, which reads as broken in the UI.
    expect(computeNoteStats(makeNote({ body: "quick" })).readMinutes).toBe(1);
  });

  it("rounds read time from the word count at 220 wpm", () => {
    const body = Array.from({ length: 660 }, () => "word").join(" ");
    // 660 / 220 = 3 minutes exactly.
    expect(computeNoteStats(makeNote({ body })).readMinutes).toBe(3);
  });

  it("surfaces open and completed task counts", () => {
    const body = "- [ ] first\n- [x] second\n- [ ] third";
    const stats = computeNoteStats(makeNote({ body }));

    expect(stats.openTasks).toBe(2);
    expect(stats.doneTasks).toBe(1);
  });

  it("counts bare links in the body", () => {
    const body = "See https://example.com and http://anchor.org/path for refs.";
    expect(computeNoteStats(makeNote({ body })).linkCount).toBe(2);
  });

  it("takes the max of captured URLs and body links", () => {
    // A note captured via bookmarklet stores the URL in `urls`. If the user
    // later pastes the same link into the body, we don't want to double it —
    // but we also don't want a single-URL capture to report zero when the
    // body happens not to mention the link yet.
    const stats = computeNoteStats(
      makeNote({ body: "no links here", urls: ["https://captured.example"] }),
    );
    expect(stats.linkCount).toBe(1);
  });

  it("reports the note's tag count as-is", () => {
    const stats = computeNoteStats(makeNote({ tags: ["work", "ideas", "reading"] }));
    expect(stats.tagCount).toBe(3);
  });

  it("stops link-matching at the closing parenthesis around an inline URL", () => {
    // Markdown-style "(see https://example.com/path)" should match
    // `https://example.com/path`, not the trailing `)`. A regression
    // here would render link counts as still-2 for sentences that
    // bracket their links.
    const body = "see (https://example.com/path) and (https://b.example/a) more";
    const stats = computeNoteStats(makeNote({ body }));
    expect(stats.linkCount).toBe(2);
  });

  it("stops link-matching at any whitespace character (newline, tab)", () => {
    // The regex uses `[^\s)]+` — newlines and tabs must terminate the
    // match, otherwise multi-paragraph notes would glue the next URL
    // onto the previous one and the count would drop.
    const body = "https://a.example\nhttps://b.example\thttps://c.example next";
    expect(computeNoteStats(makeNote({ body })).linkCount).toBe(3);
  });

  it("returns exactly readMinutes=1 at zero words (Math.max floor)", () => {
    // Math.round(0/220) is 0 — the floor at 1 must catch this so the
    // UI never renders "0 min read".
    expect(computeNoteStats(makeNote({ body: "" })).readMinutes).toBe(1);
  });

  it("readMinutes rounds down on the half boundary at 110 words", () => {
    // 110 / 220 = 0.5 — Math.round goes to 1 (ties-away-from-zero in
    // ECMA), and the floor at 1 keeps the same value. Pinned so a
    // swap to Math.floor or Math.ceil reads as a behaviour change.
    const body = Array.from({ length: 110 }, () => "word").join(" ");
    expect(computeNoteStats(makeNote({ body })).readMinutes).toBe(1);
  });

  it("readMinutes ticks to 2 once the word count crosses 330", () => {
    // 330 / 220 = 1.5 → rounds to 2. 329 / 220 ≈ 1.495 → rounds to 1.
    // Boundary check that pins both the divisor (220) and the round.
    expect(
      computeNoteStats(makeNote({
        body: Array.from({ length: 329 }, () => "word").join(" "),
      })).readMinutes,
    ).toBe(1);
    expect(
      computeNoteStats(makeNote({
        body: Array.from({ length: 330 }, () => "word").join(" "),
      })).readMinutes,
    ).toBe(2);
  });

  it("treats tabs and newlines as word separators (not as part of a word)", () => {
    // The split pattern is /\s+/ — replacing it with a single-character
    // class would still pass for spaces only. This test pins the
    // multi-whitespace behaviour explicitly.
    const stats = computeNoteStats(makeNote({ body: "one\ttwo\nthree four" }));
    expect(stats.wordCount).toBe(4);
  });

  it("falls back to body-link count when urls is undefined (no captured-link list)", () => {
    // `note.urls?.length ?? 0` — if optional chaining were dropped to
    // `note.urls.length` the test would crash; if `?? 0` were dropped
    // to `?? capturedFallback` the math.max would shift.
    const stats = computeNoteStats(
      makeNote({ body: "see https://a.example", urls: undefined as unknown as never }),
    );
    expect(stats.linkCount).toBe(1);
  });

  it("prefers the captured-urls count when it exceeds the body-link count", () => {
    // Math.max(bodyLinks, captured) — captured wins here. A swap to
    // Math.min would drop the count to 1 and the bookmarklet capture
    // would visibly under-report.
    const stats = computeNoteStats(
      makeNote({
        body: "https://only.example",
        urls: ["https://a.example", "https://b.example", "https://c.example"],
      }),
    );
    expect(stats.linkCount).toBe(3);
  });

  it("prefers the body-link count when it exceeds captured", () => {
    // Reverse direction of the Math.max — guards against a swap that
    // always picked one source.
    const stats = computeNoteStats(
      makeNote({
        body: "https://a.example https://b.example https://c.example",
        urls: ["https://only.example"],
      }),
    );
    expect(stats.linkCount).toBe(3);
  });
});
