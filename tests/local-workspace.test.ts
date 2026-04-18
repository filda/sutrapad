import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_WORKSPACE_KEY,
  loadLocalWorkspace,
  normalizeWorkspace,
  persistLocalWorkspace,
} from "../src/app/storage/local-workspace";

describe("local workspace storage", () => {
  it("normalizes missing metadata on older notes", () => {
    const normalized = normalizeWorkspace({
      activeNoteId: null,
      notes: [
        {
          id: "1",
          title: "Alpha",
          body: "Look at https://example.com/alpha.",
          updatedAt: "2026-04-18T10:00:00.000Z",
          location: "  Prague  ",
          coordinates: {
            latitude: 50.0755,
            longitude: 14.4378,
          },
        },
      ],
    } as never);

    expect(normalized.activeNoteId).toBe("1");
    expect(normalized.notes[0]).toMatchObject({
      createdAt: "2026-04-18T10:00:00.000Z",
      updatedAt: "2026-04-18T10:00:00.000Z",
      location: "Prague",
      urls: ["https://example.com/alpha"],
      tags: [],
    });
  });

  it("drops invalid coordinates during normalization", () => {
    const normalized = normalizeWorkspace({
      activeNoteId: "1",
      notes: [
        {
          id: "1",
          title: "Alpha",
          body: "",
          urls: [],
          tags: [],
          updatedAt: "2026-04-18T10:00:00.000Z",
          createdAt: "2026-04-18T10:00:00.000Z",
          coordinates: {
            latitude: Number.NaN,
            longitude: 14.4378,
          },
        },
      ],
    } as never);

    expect(normalized.notes[0].coordinates).toBeUndefined();
  });

  it("loads and persists workspaces through the configured storage", () => {
    const getItem = vi.fn().mockReturnValue(
      JSON.stringify({
        activeNoteId: "1",
        notes: [
          {
            id: "1",
            title: "Alpha",
            body: "",
            urls: [],
            tags: [],
            updatedAt: "2026-04-18T10:00:00.000Z",
            createdAt: "2026-04-18T10:00:00.000Z",
          },
        ],
      }),
    );
    const setItem = vi.fn();

    const workspace = loadLocalWorkspace({ getItem });

    expect(getItem).toHaveBeenCalledWith(LOCAL_WORKSPACE_KEY);
    expect(workspace.activeNoteId).toBe("1");

    persistLocalWorkspace(workspace, { setItem });
    expect(setItem).toHaveBeenCalledWith(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
  });

  it("falls back to a fresh workspace when storage is empty or broken", () => {
    expect(loadLocalWorkspace({ getItem: () => null }).notes).toHaveLength(1);
    expect(loadLocalWorkspace({ getItem: () => "{nope" }).notes).toHaveLength(1);
  });
});
