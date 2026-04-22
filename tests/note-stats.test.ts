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
});
