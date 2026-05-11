import { describe, expect, it } from "vitest";
import {
  evaluateBodyEdit,
  isTitleEditNoOp,
} from "../src/app/logic/note-edit-guards";
import type { SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "note-1",
    title: "Reading list",
    body: "first line\nsecond line",
    tags: ["read", "later"],
    urls: [],
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("isTitleEditNoOp", () => {
  it("returns true when the candidate equals the current title verbatim", () => {
    expect(isTitleEditNoOp(makeNote(), "Reading list")).toBe(true);
  });

  it("returns false when any character differs", () => {
    expect(isTitleEditNoOp(makeNote(), "Reading lists")).toBe(false);
  });

  it("treats trailing whitespace as a real edit (not trimmed)", () => {
    // The title input renders the value verbatim — a trailing space
    // is user-visible if the caret lands there. Trimming would mask
    // that.
    expect(isTitleEditNoOp(makeNote(), "Reading list ")).toBe(false);
  });

  it("returns true for the empty-vs-empty comparison", () => {
    expect(isTitleEditNoOp(makeNote({ title: "" }), "")).toBe(true);
  });

  it("returns false when only one side is empty", () => {
    expect(isTitleEditNoOp(makeNote({ title: "" }), "Anything")).toBe(false);
    expect(isTitleEditNoOp(makeNote({ title: "Anything" }), "")).toBe(false);
  });

  it("is case sensitive", () => {
    expect(isTitleEditNoOp(makeNote({ title: "Reading" }), "reading")).toBe(false);
  });
});

describe("evaluateBodyEdit", () => {
  it("reports no-op when body and tags would not change", () => {
    const note = makeNote({ body: "hello world", tags: ["read"] });
    const result = evaluateBodyEdit(note, "hello world", 11);
    expect(result.isNoOp).toBe(true);
    expect(result.tagsChanged).toBe(false);
    expect(result.mergedTags).toEqual(["read"]);
  });

  it("reports change when the body differs by a single character", () => {
    const note = makeNote({ body: "hello world", tags: [] });
    const result = evaluateBodyEdit(note, "hello worl", 10);
    expect(result.isNoOp).toBe(false);
    expect(result.tagsChanged).toBe(false);
    expect(result.mergedTags).toEqual([]);
  });

  it("reports change when a hashtag from the body promotes to a new tag", () => {
    const note = makeNote({ body: "lunch", tags: [] });
    // Caret well past the hashtag so the merge commits it.
    const result = evaluateBodyEdit(note, "lunch #cafeteria today", 22);
    expect(result.isNoOp).toBe(false);
    expect(result.tagsChanged).toBe(true);
    expect(result.mergedTags).toEqual(["cafeteria"]);
  });

  it("holds back an in-flight hashtag while the caret sits at its end", () => {
    // `caretPosition` matches the hashtag end → still being typed →
    // not committed even though a terminator (the trailing space)
    // follows. The body itself has changed, so the edit is not a
    // no-op either.
    const note = makeNote({ body: "lunch", tags: [] });
    const value = "lunch #cafe more";
    // Caret sits right after `#cafe`, before the space.
    const result = evaluateBodyEdit(note, value, "lunch #cafe".length);
    expect(result.isNoOp).toBe(false);
    expect(result.tagsChanged).toBe(false);
    expect(result.mergedTags).toEqual([]);
  });

  it("commits an in-flight hashtag on blur (caretPosition: undefined)", () => {
    // Same input as the previous test, but blur lifts the caret-aware
    // hold-back. The `#cafe` now promotes to a tag.
    const note = makeNote({ body: "lunch", tags: [] });
    const result = evaluateBodyEdit(note, "lunch #cafe more", undefined);
    expect(result.isNoOp).toBe(false);
    expect(result.tagsChanged).toBe(true);
    expect(result.mergedTags).toEqual(["cafe"]);
  });

  it("reports no-op on blur of an unchanged body when no new hashtag is in flight", () => {
    // The regression case: textarea detached during render fires
    // blur with the current body and no caret. Nothing's changed
    // and there's no pending tag — must be reported as no-op.
    const note = makeNote({ body: "old prose with #read tag", tags: ["read"] });
    const result = evaluateBodyEdit(note, "old prose with #read tag", undefined);
    expect(result.isNoOp).toBe(true);
    expect(result.tagsChanged).toBe(false);
    expect(result.mergedTags).toEqual(["read"]);
  });

  it("reports change when an existing hashtag in the body is now removed from the value", () => {
    // User actually deleted the body content. Body differs → not a
    // no-op, even if the tag list is unchanged (existing tags stay
    // because the merge only appends).
    const note = makeNote({ body: "old prose with #read tag", tags: ["read"] });
    const result = evaluateBodyEdit(note, "old prose with tag", undefined);
    expect(result.isNoOp).toBe(false);
    expect(result.tagsChanged).toBe(false);
    expect(result.mergedTags).toEqual(["read"]);
  });

  it("never reorders existing tags even when new tags are appended", () => {
    const note = makeNote({ body: "old", tags: ["alpha", "beta"] });
    const result = evaluateBodyEdit(note, "old plus #gamma here", 20);
    expect(result.isNoOp).toBe(false);
    expect(result.tagsChanged).toBe(true);
    expect(result.mergedTags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("treats empty-body-to-empty-body as no-op", () => {
    const note = makeNote({ body: "", tags: [] });
    const result = evaluateBodyEdit(note, "", undefined);
    expect(result.isNoOp).toBe(true);
    expect(result.tagsChanged).toBe(false);
    expect(result.mergedTags).toEqual([]);
  });
});
