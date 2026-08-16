import { describe, expect, it, vi } from "vitest";
import { hydrateNoteOnOpen } from "../src/app/lifecycle/hydrate-note-on-open";
import { createNoteBodyCache } from "../src/app/logic/note-body-cache";
import { buildPlaceholderNote } from "../src/lib/note-card-meta";
import type { SutraPadDocument, SutraPadNoteSummary, SutraPadWorkspace } from "../src/types";

function summary(overrides: Partial<SutraPadNoteSummary> & Pick<SutraPadNoteSummary, "id">): SutraPadNoteSummary {
  return {
    title: "Real title",
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    fileId: "drive-file-1",
    ...overrides,
  };
}

function fullDoc(overrides: Partial<SutraPadDocument> & Pick<SutraPadDocument, "id">): SutraPadDocument {
  return {
    title: "Real title",
    body: "The real body from Drive",
    urls: [],
    tags: [],
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("hydrateNoteOnOpen", () => {
  it("no-ops for an already-hydrated note (no fetch, no render)", () => {
    const hydrated = fullDoc({ id: "1" });
    const fetchNoteBody = vi.fn();
    const render = vi.fn();

    hydrateNoteOnOpen({
      note: hydrated,
      bodyCache: createNoteBodyCache(),
      inFlight: new Set(),
      fetchNoteBody,
      getWorkspace: () => ({ activeNoteId: "1", notes: [hydrated] }),
      setWorkspace: vi.fn(),
      persistWorkspace: vi.fn(),
      render,
    });

    expect(fetchNoteBody).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("no-ops when a fetch for the same note is already in flight", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1" }));
    const fetchNoteBody = vi.fn();

    hydrateNoteOnOpen({
      note: placeholder,
      bodyCache: createNoteBodyCache(),
      inFlight: new Set(["1"]),
      fetchNoteBody,
      getWorkspace: () => ({ activeNoteId: "1", notes: [placeholder] }),
      setWorkspace: vi.fn(),
      persistWorkspace: vi.fn(),
      render: vi.fn(),
    });

    expect(fetchNoteBody).not.toHaveBeenCalled();
  });

  it("applies a still-cached body synchronously without fetching again", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1" }));
    const cache = createNoteBodyCache();
    cache.set("1", fullDoc({ id: "1", body: "cached from an earlier open" }));
    const fetchNoteBody = vi.fn();
    const setWorkspace = vi.fn();
    const persistWorkspace = vi.fn();
    const render = vi.fn();
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [placeholder] };

    hydrateNoteOnOpen({
      note: placeholder,
      bodyCache: cache,
      inFlight: new Set(),
      fetchNoteBody,
      getWorkspace: () => workspace,
      setWorkspace,
      persistWorkspace,
      render,
    });

    expect(fetchNoteBody).not.toHaveBeenCalled();
    expect(setWorkspace).toHaveBeenCalledTimes(1);
    const applied = setWorkspace.mock.calls[0][0] as SutraPadWorkspace;
    expect(applied.notes[0].body).toBe("cached from an earlier open");
    expect(applied.notes[0].hydrated).toBe(true);
    expect(persistWorkspace).toHaveBeenCalledWith(applied);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the placeholder has no fileId to fetch from", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1", fileId: undefined }));
    const fetchNoteBody = vi.fn();

    hydrateNoteOnOpen({
      note: placeholder,
      bodyCache: createNoteBodyCache(),
      inFlight: new Set(),
      fetchNoteBody,
      getWorkspace: () => ({ activeNoteId: "1", notes: [placeholder] }),
      setWorkspace: vi.fn(),
      persistWorkspace: vi.fn(),
      render: vi.fn(),
    });

    expect(fetchNoteBody).not.toHaveBeenCalled();
  });

  it("fetches, caches, applies, and re-renders once resolved", async () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1", fileId: "drive-file-1" }));
    const cache = createNoteBodyCache();
    const inFlight = new Set<string>();
    const fetched = fullDoc({ id: "1", body: "fetched from Drive" });
    const fetchNoteBody = vi.fn().mockResolvedValue(fetched);
    const setWorkspace = vi.fn();
    const persistWorkspace = vi.fn();
    const render = vi.fn();
    let workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [placeholder] };

    hydrateNoteOnOpen({
      note: placeholder,
      bodyCache: cache,
      inFlight,
      fetchNoteBody,
      getWorkspace: () => workspace,
      setWorkspace: (next) => {
        workspace = next;
        setWorkspace(next);
      },
      persistWorkspace,
      render,
    });

    // Fetch is in flight synchronously.
    expect(fetchNoteBody).toHaveBeenCalledWith("drive-file-1");
    expect(inFlight.has("1")).toBe(true);

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    expect(cache.get("1")?.body).toBe("fetched from Drive");
    expect(setWorkspace).toHaveBeenCalledTimes(1);
    expect(workspace.notes[0].body).toBe("fetched from Drive");
    expect(workspace.notes[0].hydrated).toBe(true);
    expect(persistWorkspace).toHaveBeenCalledWith(workspace);
    expect(inFlight.has("1")).toBe(false);
  });

  it("clears inFlight and re-renders (without applying anything) when the fetch fails", async () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1", fileId: "drive-file-1" }));
    const inFlight = new Set<string>();
    const fetchNoteBody = vi.fn().mockRejectedValue(new Error("network down"));
    const setWorkspace = vi.fn();
    const render = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    hydrateNoteOnOpen({
      note: placeholder,
      bodyCache: createNoteBodyCache(),
      inFlight,
      fetchNoteBody,
      getWorkspace: () => ({ activeNoteId: "1", notes: [placeholder] }),
      setWorkspace,
      persistWorkspace: vi.fn(),
      render,
    });

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    expect(setWorkspace).not.toHaveBeenCalled();
    expect(inFlight.has("1")).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not clobber a note hydrated (or edited) by a faster second open while the first fetch was in flight", async () => {
    // Guards the race `applyHydratedNote` itself protects against: by the
    // time this fetch resolves, the note is no longer a placeholder (either
    // a second, faster hydration already landed, or the user's edit did).
    const placeholder = buildPlaceholderNote(summary({ id: "1", fileId: "drive-file-1" }));
    const alreadyHydrated = fullDoc({ id: "1", body: "landed first" });
    // Stable reference across calls — a real `getWorkspace` (an atom read)
    // returns the same object until something calls `setWorkspace`, and
    // `hydrateNoteOnOpen`'s "did anything change?" check relies on that.
    const workspaceAfterFirstHydration: SutraPadWorkspace = {
      activeNoteId: "1",
      notes: [alreadyHydrated],
    };
    const fetchNoteBody = vi.fn().mockResolvedValue(fullDoc({ id: "1", body: "stale, arrived second" }));
    const setWorkspace = vi.fn();
    const render = vi.fn();

    hydrateNoteOnOpen({
      note: placeholder,
      bodyCache: createNoteBodyCache(),
      inFlight: new Set(),
      fetchNoteBody,
      // The workspace has already moved on by the time this resolves.
      getWorkspace: () => workspaceAfterFirstHydration,
      setWorkspace,
      persistWorkspace: vi.fn(),
      render,
    });

    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    expect(setWorkspace).not.toHaveBeenCalled();
  });
});
