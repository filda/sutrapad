import { describe, expect, it, vi } from "vitest";
import { createWorkspaceIO } from "../src/app/session/workspace-io";
import type { GoogleDriveStore } from "../src/services/drive-store";
import type { SutraPadWorkspace } from "../src/types";

function makeWorkspace(notes: SutraPadWorkspace["notes"]): SutraPadWorkspace {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function realNote(id = "note-real"): SutraPadWorkspace["notes"][number] {
  return {
    id,
    title: "real",
    body: "actual content",
    urls: [],
    tags: [],
    createdAt: "2026-04-26T08:00:00.000Z",
    updatedAt: "2026-04-26T08:00:00.000Z",
  };
}

function emptyDraft(id = "note-draft"): SutraPadWorkspace["notes"][number] {
  // Empty title + empty body + no urls/tags is the shape `stripEmptyDraftNotes`
  // recognises as a freshly-spawned, never-typed-into draft.
  return {
    id,
    title: "",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-04-26T08:00:00.000Z",
    updatedAt: "2026-04-26T08:00:00.000Z",
  };
}

interface IOHarness {
  store: { loadWorkspace: ReturnType<typeof vi.fn>; saveWorkspace: ReturnType<typeof vi.fn> };
  getStore: () => GoogleDriveStore;
  refreshSession: ReturnType<typeof vi.fn>;
  onProfileRefreshed: ReturnType<typeof vi.fn>;
  cancelAutoSave: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  refreshStatus: ReturnType<typeof vi.fn>;
  setSyncState: ReturnType<typeof vi.fn>;
  setLastError: ReturnType<typeof vi.fn>;
  setWorkspace: ReturnType<typeof vi.fn>;
  persistLocalWorkspace: ReturnType<typeof vi.fn>;
}

function makeHarness(): IOHarness {
  const store = {
    loadWorkspace: vi.fn().mockResolvedValue(makeWorkspace([realNote("remote")])),
    saveWorkspace: vi.fn().mockResolvedValue(undefined),
  };
  return {
    store,
    getStore: () => store as unknown as GoogleDriveStore,
    refreshSession: vi.fn().mockResolvedValue(null),
    onProfileRefreshed: vi.fn(),
    cancelAutoSave: vi.fn(),
    render: vi.fn(),
    refreshStatus: vi.fn(),
    setSyncState: vi.fn(),
    setLastError: vi.fn(),
    setWorkspace: vi.fn(),
    persistLocalWorkspace: vi.fn(),
  };
}

describe("createWorkspaceIO", () => {
  it("loadWorkspace pulls the remote workspace through getStore() into setWorkspace", async () => {
    // The closure binding is what this module exists for: a single call
    // site in `app.ts` shouldn't hand-roll the `withAuthRetry(() => getStore().loadWorkspace())`
    // dance three times. Pin the wiring so a future refactor that drops
    // the `getStore()` indirection (or stops awaiting the remote) gets
    // caught here, not at runtime.
    const h = makeHarness();
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => makeWorkspace([]),
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.loadWorkspace();

    expect(h.store.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(h.setWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ activeNoteId: "remote" }),
    );
    expect(h.cancelAutoSave).toHaveBeenCalledTimes(1);
  });

  it("saveWorkspace strips empty-draft notes before pushing to remote", async () => {
    // The local workspace can carry a freshly-spawned draft (user hit
    // `N`, never typed). We must never persist that to Drive — the next
    // load on another device would resurrect a phantom Untitled note.
    // Pin the strip step so a future "simplification" that drops it
    // can't silently regress this guarantee.
    const h = makeHarness();
    const local = makeWorkspace([realNote("real-1"), emptyDraft("draft-1")]);
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => local,
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.saveWorkspace();

    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
    const pushed = h.store.saveWorkspace.mock.calls[0]?.[0] as SutraPadWorkspace;
    expect(pushed.notes.map((n) => n.id)).toEqual(["real-1"]);

    // The local persist receives the *unstripped* workspace — empty
    // drafts only get filtered at the remote edge so the user can keep
    // typing into them locally. Pin the closure binding (a mutant that
    // dropped the persist call survived an earlier Stryker run).
    expect(h.persistLocalWorkspace).toHaveBeenCalledTimes(1);
    expect(h.persistLocalWorkspace).toHaveBeenCalledWith(local);
  });

  it("saveWorkspace forwards mode='background' so a 401 propagates without GIS refresh", async () => {
    // The autosave-focus fix: a background save that hits 401 must not
    // trigger the silent-refresh iframe — on mobile the iframe steals
    // focus from the active <textarea>. workspace-io propagates the
    // mode to withAuthRetry's retry context; this test pins that
    // forward so an accidental drop of the mode field surfaces here.
    const h = makeHarness();
    h.store.saveWorkspace.mockRejectedValueOnce(
      Object.assign(new Error("auth expired"), { status: 401, code: "auth-expired" }),
    );
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => makeWorkspace([realNote()]),
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.saveWorkspace("background");

    // In background mode, withAuthRetry must NOT call refreshSession
    // (that would be the focus-stealing path). The save attempt itself
    // happened once and the 401 propagated.
    expect(h.refreshSession).not.toHaveBeenCalled();
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(h.setSyncState).toHaveBeenCalledWith("error");
  });

  it("restoreWorkspaceAfterSignIn calls both load and save against the remote", async () => {
    // The sign-in restore path is "load remote, merge, push back" — both
    // calls must route through getStore() with retry handling. Pin both
    // legs so a future refactor that drops the save side (and silently
    // leaves merge results local-only) is caught.
    const h = makeHarness();
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => makeWorkspace([realNote("local-1")]),
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.restoreWorkspaceAfterSignIn();

    expect(h.store.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(h.cancelAutoSave).toHaveBeenCalledTimes(1);
  });
});
