import { describe, expect, it, vi } from "vitest";
import {
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  createWorkspace,
  sortNotes,
  upsertNote,
} from "../src/lib/notebook";
import type { SutraPadDocument } from "../src/types";

describe("notebook helpers", () => {
  it("creates a workspace with one active note", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"));

    const workspace = createWorkspace();

    expect(workspace.notes).toHaveLength(1);
    expect(workspace.activeNoteId).toBe(workspace.notes[0].id);
    expect(workspace.notes[0].title).toBe("Untitled note");

    vi.useRealTimers();
  });

  it("sorts notes by updatedAt descending", () => {
    const notes: SutraPadDocument[] = [
      { id: "1", title: "Older", body: "", updatedAt: "2026-04-13T10:00:00.000Z" },
      { id: "2", title: "Newest", body: "", updatedAt: "2026-04-13T12:00:00.000Z" },
      { id: "3", title: "Middle", body: "", updatedAt: "2026-04-13T11:00:00.000Z" },
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual(["2", "3", "1"]);
  });

  it("updates a note and keeps it active", () => {
    const workspace = {
      activeNoteId: "1",
      notes: [
        { id: "1", title: "Alpha", body: "", updatedAt: "2026-04-13T10:00:00.000Z" },
        { id: "2", title: "Beta", body: "", updatedAt: "2026-04-13T11:00:00.000Z" },
      ],
    };

    const updated = upsertNote(workspace, "1", (note) => ({
      ...note,
      title: "Alpha revised",
      updatedAt: "2026-04-13T12:00:00.000Z",
    }));

    expect(updated.activeNoteId).toBe("1");
    expect(updated.notes[0].id).toBe("1");
    expect(updated.notes[0].title).toBe("Alpha revised");
  });

  it("creates a new note and makes it active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [
        { id: "1", title: "Alpha", body: "", updatedAt: "2026-04-13T10:00:00.000Z" },
      ],
    };

    const updated = createNewNoteWorkspace(workspace);

    expect(updated.notes).toHaveLength(2);
    expect(updated.activeNoteId).toBe(updated.notes[0].id);
    expect(updated.notes[0].title).toBe("Untitled note");

    vi.useRealTimers();
  });

  it("creates a captured link note and makes it active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T14:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [
        { id: "1", title: "Alpha", body: "", updatedAt: "2026-04-13T10:00:00.000Z" },
      ],
    };

    const updated = createCapturedNoteWorkspace(workspace, {
      title: "Example page",
      url: "https://example.com/post",
    });

    expect(updated.activeNoteId).toBe(updated.notes[0].id);
    expect(updated.notes[0].title).toBe("Example page");
    expect(updated.notes[0].body).toBe("https://example.com/post");

    vi.useRealTimers();
  });

  it("creates a text note from captured text and makes it active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T15:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [
        { id: "1", title: "Alpha", body: "", updatedAt: "2026-04-13T10:00:00.000Z" },
      ],
    };

    const updated = createTextNoteWorkspace(workspace, {
      title: "14/4/2026 · midnight",
      body: "A quick note",
    });

    expect(updated.activeNoteId).toBe(updated.notes[0].id);
    expect(updated.notes[0].title).toBe("14/4/2026 · midnight");
    expect(updated.notes[0].body).toBe("A quick note");

    vi.useRealTimers();
  });
});
