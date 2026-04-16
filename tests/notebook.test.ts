import { describe, expect, it, vi } from "vitest";
import {
  buildTagIndex,
  areWorkspacesEqual,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  createWorkspace,
  filterNotesByAllTags,
  isPristineWorkspace,
  mergeWorkspaces,
  sortNotes,
  upsertNote,
} from "../src/lib/notebook";
import type { SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> & Pick<SutraPadDocument, "id" | "updatedAt">): SutraPadDocument {
  return { title: "Test note", body: "", tags: [], ...overrides };
}

describe("notebook helpers", () => {
  it("creates a workspace with one active note", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"));

    const workspace = createWorkspace();

    expect(workspace.notes).toHaveLength(1);
    expect(workspace.activeNoteId).toBe(workspace.notes[0].id);
    expect(workspace.notes[0].title).toBe("Untitled note");
    expect(workspace.notes[0].body).toBe("");
    expect(workspace.notes[0].tags).toEqual([]);

    vi.useRealTimers();
  });

  it("sorts notes by updatedAt descending", () => {
    const notes: SutraPadDocument[] = [
      makeNote({ id: "1", title: "Older", updatedAt: "2026-04-13T10:00:00.000Z" }),
      makeNote({ id: "2", title: "Newest", updatedAt: "2026-04-13T12:00:00.000Z" }),
      makeNote({ id: "3", title: "Middle", updatedAt: "2026-04-13T11:00:00.000Z" }),
    ];

    expect(sortNotes(notes).map((note) => note.id)).toEqual(["2", "3", "1"]);
  });

  it("builds a tag index with note links and counts", () => {
    const workspace = {
      activeNoteId: "1",
      notes: [
        makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
        makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea"] }),
        makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work"] }),
      ],
    };

    expect(buildTagIndex(workspace, "2026-04-13T12:30:00.000Z")).toEqual({
      version: 1,
      savedAt: "2026-04-13T12:30:00.000Z",
      tags: [
        { tag: "idea", noteIds: ["1", "2"], count: 2 },
        { tag: "work", noteIds: ["1", "3"], count: 2 },
      ],
    });
  });

  it("filters notes by requiring every selected tag", () => {
    const notes: SutraPadDocument[] = [
      makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
      makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea"] }),
      makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work", "draft"] }),
    ];

    expect(filterNotesByAllTags(notes, ["work"]).map((note) => note.id)).toEqual(["1", "3"]);
    expect(filterNotesByAllTags(notes, ["work", "idea"]).map((note) => note.id)).toEqual(["1"]);
    expect(filterNotesByAllTags(notes, ["missing"])).toEqual([]);
    expect(filterNotesByAllTags(notes, [])).toEqual(notes);
  });

  it("updates a note and keeps it active", () => {
    const workspace = {
      activeNoteId: "1",
      notes: [
        makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" }),
        makeNote({ id: "2", title: "Beta", updatedAt: "2026-04-13T11:00:00.000Z" }),
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

  it("updates only the targeted note when upserting", () => {
    const workspace = {
      activeNoteId: "2",
      notes: [
        makeNote({ id: "1", title: "Alpha", body: "Keep me", updatedAt: "2026-04-13T10:00:00.000Z" }),
        makeNote({ id: "2", title: "Beta", body: "Change me", updatedAt: "2026-04-13T11:00:00.000Z" }),
      ],
    };

    const updated = upsertNote(workspace, "2", (note) => ({
      ...note,
      body: "Changed",
      updatedAt: "2026-04-13T12:00:00.000Z",
    }));

    expect(updated.notes.find((note) => note.id === "1")?.body).toBe("Keep me");
    expect(updated.notes.find((note) => note.id === "2")?.body).toBe("Changed");
    expect(updated.notes).toHaveLength(2);
  });

  it("creates a new note and makes it active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
    };

    const updated = createNewNoteWorkspace(workspace);

    expect(updated.notes).toHaveLength(2);
    expect(updated.activeNoteId).toBe(updated.notes[0].id);
    expect(updated.notes[0].title).toBe("Untitled note");

    vi.useRealTimers();
  });

  it("creates a new note with a provided generated title", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
    };

    const updated = createNewNoteWorkspace(workspace, "14/04/2026 · high noon · Libeň");

    expect(updated.notes[0].title).toBe("14/04/2026 · high noon · Libeň");
    expect(updated.activeNoteId).toBe(updated.notes[0].id);

    vi.useRealTimers();
  });

  it("creates a captured link note and makes it active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T14:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
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
      notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
    };

    const updated = createTextNoteWorkspace(workspace, {
      title: "14/4/2026 Â· midnight",
      body: "A quick note",
      location: "Prague",
      coordinates: {
        latitude: 50.0755,
        longitude: 14.4378,
      },
    });

    expect(updated.activeNoteId).toBe(updated.notes[0].id);
    expect(updated.notes[0].title).toBe("14/4/2026 Â· midnight");
    expect(updated.notes[0].body).toBe("A quick note");
    expect(updated.notes[0].location).toBe("Prague");
    expect(updated.notes[0].coordinates).toEqual({
      latitude: 50.0755,
      longitude: 14.4378,
    });

    vi.useRealTimers();
  });

  it("stores the generated location on newly created notes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

    const workspace = {
      activeNoteId: "1",
      notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
    };

    const updated = createNewNoteWorkspace(
      workspace,
      "14/04/2026 · high noon · Prague",
      "Prague",
      {
        latitude: 50.0755,
        longitude: 14.4378,
      },
    );

    expect(updated.notes[0].title).toBe("14/04/2026 · high noon · Prague");
    expect(updated.notes[0].location).toBe("Prague");
    expect(updated.notes[0].coordinates).toEqual({
      latitude: 50.0755,
      longitude: 14.4378,
    });

    vi.useRealTimers();
  });

  it("treats the default local workspace as pristine", () => {
    const workspace = {
      activeNoteId: "1",
      notes: [makeNote({ id: "1", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" })],
    };

    expect(isPristineWorkspace(workspace)).toBe(true);
  });

  it("does not treat edited or multi-note workspaces as pristine", () => {
    expect(
      isPristineWorkspace({
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Untitled note", body: "Draft", updatedAt: "2026-04-13T10:00:00.000Z" })],
      }),
    ).toBe(false);

    expect(
      isPristineWorkspace({
        activeNoteId: "2",
        notes: [makeNote({ id: "1", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" })],
      }),
    ).toBe(false);

    expect(
      isPristineWorkspace({
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" }),
          makeNote({ id: "2", title: "Second", updatedAt: "2026-04-13T11:00:00.000Z" }),
        ],
      }),
    ).toBe(false);
  });

  it("merges local notes into an otherwise empty remote workspace", () => {
    const localWorkspace = {
      activeNoteId: "local-1",
      notes: [
        makeNote({ id: "local-1", title: "Draft", body: "Write first, sign in later.", updatedAt: "2026-04-13T10:00:00.000Z" }),
      ],
    };
    const remoteWorkspace = {
      activeNoteId: "remote-1",
      notes: [
        makeNote({ id: "remote-1", title: "Untitled note", updatedAt: "2026-04-13T09:00:00.000Z" }),
      ],
    };

    expect(mergeWorkspaces(localWorkspace, remoteWorkspace)).toEqual(localWorkspace);
  });

  it("keeps the remote notebook when the local workspace is still pristine", () => {
    const localWorkspace = {
      activeNoteId: "local-1",
      notes: [
        makeNote({ id: "local-1", title: "Untitled note", updatedAt: "2026-04-13T09:00:00.000Z" }),
      ],
    };
    const remoteWorkspace = {
      activeNoteId: "remote-1",
      notes: [
        makeNote({ id: "remote-1", title: "Saved note", body: "Already in Drive.", updatedAt: "2026-04-13T10:00:00.000Z" }),
      ],
    };

    expect(mergeWorkspaces(localWorkspace, remoteWorkspace)).toEqual(remoteWorkspace);
  });

  it("prefers the newer version when the same note exists locally and remotely", () => {
    const merged = mergeWorkspaces(
      {
        activeNoteId: "shared",
        notes: [
          makeNote({ id: "shared", title: "Local draft", body: "Local body", updatedAt: "2026-04-13T12:00:00.000Z" }),
        ],
      },
      {
        activeNoteId: "shared",
        notes: [
          makeNote({ id: "shared", title: "Remote draft", body: "Remote body", updatedAt: "2026-04-13T10:00:00.000Z" }),
        ],
      },
    );

    expect(merged.notes).toHaveLength(1);
    expect(merged.notes[0]).toMatchObject({
      id: "shared",
      title: "Local draft",
      body: "Local body",
      updatedAt: "2026-04-13T12:00:00.000Z",
    });
    expect(merged.activeNoteId).toBe("shared");
  });

  it("detects when two workspaces are equivalent", () => {
    const leftWorkspace = {
      activeNoteId: "1",
      notes: [
        makeNote({ id: "2", title: "Beta", updatedAt: "2026-04-13T11:00:00.000Z" }),
        makeNote({ id: "1", title: "Alpha", body: "Hello", tags: ["draft"], updatedAt: "2026-04-13T10:00:00.000Z" }),
      ],
    };
    const rightWorkspace = {
      activeNoteId: "1",
      notes: [
        makeNote({ id: "1", title: "Alpha", body: "Hello", tags: ["draft"], updatedAt: "2026-04-13T10:00:00.000Z" }),
        makeNote({ id: "2", title: "Beta", updatedAt: "2026-04-13T11:00:00.000Z" }),
      ],
    };

    expect(areWorkspacesEqual(leftWorkspace, rightWorkspace)).toBe(true);
  });

  it("detects when two workspaces differ", () => {
    expect(
      areWorkspacesEqual(
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", body: "Hello", updatedAt: "2026-04-13T10:00:00.000Z" })] },
        { activeNoteId: "2", notes: [makeNote({ id: "1", title: "Alpha", body: "Hello", updatedAt: "2026-04-13T10:00:00.000Z" })] },
      ),
    ).toBe(false);

    expect(
      areWorkspacesEqual(
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", body: "Hello", updatedAt: "2026-04-13T10:00:00.000Z" })] },
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", body: "Changed", updatedAt: "2026-04-13T10:00:00.000Z" })] },
      ),
    ).toBe(false);
  });

  it("detects tag differences between otherwise identical workspaces", () => {
    expect(
      areWorkspacesEqual(
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: [], updatedAt: "2026-04-13T10:00:00.000Z" })] },
      ),
    ).toBe(false);

    expect(
      areWorkspacesEqual(
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work", "personal"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["personal", "work"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
      ),
    ).toBe(false);
  });

  it("considers workspaces equal when tags match", () => {
    expect(
      areWorkspacesEqual(
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work", "draft"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
        { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work", "draft"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
      ),
    ).toBe(true);
  });
});
