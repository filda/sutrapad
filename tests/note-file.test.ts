import { describe, expect, it } from "vitest";
import {
  isNoteFileName,
  noteFileName,
  noteIdFromFileName,
} from "../src/lib/note-file";

describe("noteFileName", () => {
  it("builds the canonical note-<id>.json filename", () => {
    expect(noteFileName("abc-123")).toBe("note-abc-123.json");
  });
});

describe("isNoteFileName", () => {
  it("accepts a canonical note filename", () => {
    expect(isNoteFileName("note-abc-123.json")).toBe(true);
  });

  it("accepts ids containing hyphens (UUID shape)", () => {
    expect(
      isNoteFileName("note-045561f5-b419-53ce-be89-47e9835380a4.json"),
    ).toBe(true);
  });

  it("rejects a substring match that isn't anchored at the start", () => {
    // Drive's `name contains 'note-'` query returns this; the strict
    // client-side pattern must exclude it so it never becomes a note.
    expect(isNoteFileName("footnote-1.json")).toBe(false);
  });

  it("rejects the app's own non-note artifacts", () => {
    expect(isNoteFileName("sutrapad-index.json")).toBe(false);
    expect(isNoteFileName("sutrapad-head.json")).toBe(false);
    expect(isNoteFileName("index-2026-05-01T10-00-00-000Z.json")).toBe(false);
  });

  it("rejects an empty id and a wrong extension", () => {
    expect(isNoteFileName("note-.json")).toBe(false);
    expect(isNoteFileName("note-abc.txt")).toBe(false);
    expect(isNoteFileName("note-abc.json.bak")).toBe(false);
  });
});

describe("noteIdFromFileName", () => {
  it("extracts the id from a canonical filename", () => {
    expect(noteIdFromFileName("note-abc-123.json")).toBe("abc-123");
  });

  it("extracts a full UUID id", () => {
    expect(
      noteIdFromFileName("note-045561f5-b419-53ce-be89-47e9835380a4.json"),
    ).toBe("045561f5-b419-53ce-be89-47e9835380a4");
  });

  it("returns null for a non-note filename", () => {
    expect(noteIdFromFileName("sutrapad-index.json")).toBeNull();
    expect(noteIdFromFileName("footnote-1.json")).toBeNull();
    expect(noteIdFromFileName("note-.json")).toBeNull();
  });

  it("round-trips with noteFileName", () => {
    const id = "round-trip-id";
    expect(noteIdFromFileName(noteFileName(id))).toBe(id);
  });
});
