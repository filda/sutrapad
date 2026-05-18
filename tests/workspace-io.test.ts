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
  store: {
    loadWorkspace: ReturnType<typeof vi.fn>;
    saveWorkspace: ReturnType<typeof vi.fn>;
    loadNoteInventory: ReturnType<typeof vi.fn>;
    fetchNoteByFileId: ReturnType<typeof vi.fn>;
  };
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
    loadNoteInventory: vi.fn().mockResolvedValue([]),
    fetchNoteByFileId: vi.fn(),
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

  it("refreshWorkspace routes inventory and per-file fetches through withAuthRetry", async () => {
    // The progressive cross-device refresh closes over the same
    // getStore() + retryContext pair as load / save. A 401 mid-refresh
    // therefore hits the same silent-refresh path. Pin the call
    // routing here so a refactor that drops one of the two store
    // methods from the orchestrator surfaces immediately.
    const h = makeHarness();
    h.store.loadNoteInventory.mockResolvedValue([
      {
        noteId: "remote-1",
        fileId: "drive-file-1",
        modifiedTime: "2026-04-26T08:00:00.000Z",
      },
    ]);
    h.store.fetchNoteByFileId.mockResolvedValue(realNote("remote-1"));

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

    await io.refreshWorkspace();

    expect(h.store.loadNoteInventory).toHaveBeenCalledTimes(1);
    expect(h.store.fetchNoteByFileId).toHaveBeenCalledWith("drive-file-1");
    // The orchestrator's autosave cancel is the same race-prevention
    // guarantee `runWorkspaceLoad` makes — a focus refresh fires while
    // a 2 s-old keystroke timer is still armed.
    expect(h.cancelAutoSave).toHaveBeenCalledTimes(1);
    expect(h.setSyncState).toHaveBeenLastCalledWith("idle");
  });
});

describe("createWorkspaceIO clean-snapshot guard", () => {
  it("skips a second save when the workspace hasn't changed since the first", async () => {
    // Regression for the "open notebook → click around → multiple
    // autosaves fire" cascade. The first save establishes the clean
    // snapshot; the second save with an identical workspace must
    // not touch Drive, must not pulse syncState, must not run the
    // four-index rewrite.
    const h = makeHarness();
    let workspace = makeWorkspace([realNote("note-1")]);
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => workspace,
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

    const syncStateCallsAfterFirst = h.setSyncState.mock.calls.length;

    // Same workspace reference — represents the "blur fired but
    // value identical" case after fix #1 wouldn't have caught it.
    await io.saveWorkspace();
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
    // No second syncState pulse — the bail returns before runWorkspaceSave.
    expect(h.setSyncState.mock.calls.length).toBe(syncStateCallsAfterFirst);

    // A genuine edit (different body) re-arms the save path.
    workspace = makeWorkspace([
      { ...realNote("note-1"), body: "actually changed" },
    ]);
    await io.saveWorkspace();
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(2);
  });

  it("treats the empty-draft-only difference as no change (drafts get stripped)", async () => {
    // The save closure strips empty drafts before comparing against
    // the snapshot. So a local workspace that picked up a fresh `N`
    // press (empty draft) after the first save is still "clean" from
    // the remote's perspective: nothing visible-to-Drive changed.
    const h = makeHarness();
    let workspace = makeWorkspace([realNote("note-1")]);
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => workspace,
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

    workspace = makeWorkspace([realNote("note-1"), emptyDraft("draft-1")]);
    await io.saveWorkspace();
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("skips save when the workspace matches the freshly-loaded remote", async () => {
    // Sign-in restore (and manual Load) pull the remote down. If the
    // user's local state was already in sync (or got replaced by the
    // load), the very next autosave timer firing must not push the
    // same bytes back up.
    const h = makeHarness();
    const remoteNote = realNote("remote-only");
    h.store.loadWorkspace.mockResolvedValueOnce(makeWorkspace([remoteNote]));
    // After load, the harness keeps returning the loaded workspace
    // as the local snapshot — that's the post-load steady state.
    let localWorkspace: SutraPadWorkspace = makeWorkspace([remoteNote]);
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      localWorkspace = next;
    });

    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => localWorkspace,
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

    // Autosave-style save fires with no local changes — must bail.
    await io.saveWorkspace("background");
    expect(h.store.saveWorkspace).not.toHaveBeenCalled();
  });

  it("re-arms the save path after restoreWorkspaceAfterSignIn pushes a merged result", async () => {
    // The restore path's save closure must mark the merged workspace
    // as the new snapshot — otherwise the post-restore autosave
    // would redundantly push the same merged bytes again.
    const h = makeHarness();
    const remoteNote = realNote("remote-1");
    const localNote = realNote("local-1");
    h.store.loadWorkspace.mockResolvedValueOnce(makeWorkspace([remoteNote]));

    // The merge of local+remote contains both notes. After the
    // restore save succeeds, the snapshot equals that merged
    // workspace. We approximate that here by reporting the merged
    // shape as the local workspace from then on.
    let localWorkspace: SutraPadWorkspace = makeWorkspace([localNote]);
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      localWorkspace = next;
    });

    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => localWorkspace,
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.restoreWorkspaceAfterSignIn();

    // Load was hit once; the merge produced changes vs remote
    // (the local-only note), so the save was also hit once.
    expect(h.store.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);

    // The follow-up background autosave must not double-push.
    await io.saveWorkspace("background");
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("first-ever save proceeds when no snapshot has been established", async () => {
    // Boundary: cold start. No load, no prior save → snapshot is
    // null → the guard MUST fall through and let the save happen.
    // This is also the mutation-test sentinel for the "if snapshot
    // !== null" half of the guard — flipping it to `=== null` would
    // skip every save until the first load happened.
    const h = makeHarness();
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

    await io.saveWorkspace();

    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("a failed save leaves the snapshot un-updated so the next attempt retries", async () => {
    // If Drive rejects the save (network blip, 5xx), we did NOT
    // successfully sync. The snapshot must stay at its previous
    // value (or null) so the next save retries the same bytes
    // instead of believing the failed push went through.
    const h = makeHarness();
    h.store.saveWorkspace.mockRejectedValueOnce(new Error("drive 503"));
    const workspace = makeWorkspace([realNote("note-1")]);
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => workspace,
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
    expect(h.setSyncState).toHaveBeenCalledWith("error");

    // Retry: same workspace, but the failed first attempt didn't
    // mark it clean. So this MUST hit Drive again, not bail.
    await io.saveWorkspace();
    expect(h.store.saveWorkspace).toHaveBeenCalledTimes(2);
  });
});

describe("createWorkspaceIO isWorkspaceDirty", () => {
  it("returns false before any sync has established a baseline", async () => {
    // Cold start: there is no snapshot to compare against. The dirty
    // flag is consumed by the focus-refresh gate (see app.ts) and
    // returning `false` here keeps the gate open until the first
    // load lands. We never want the very first visibility event to
    // be blocked just because we haven't talked to Drive yet.
    const h = makeHarness();
    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => makeWorkspace([realNote("local")]),
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    expect(io.isWorkspaceDirty()).toBe(false);
  });

  it("returns false right after a load + no local edits", async () => {
    // Post-load steady state: local and snapshot match exactly.
    // The focus-refresh gate uses this to decide whether a refresh
    // can run without stomping in-flight edits.
    const h = makeHarness();
    const remote = realNote("remote");
    h.store.loadWorkspace.mockResolvedValueOnce(makeWorkspace([remote]));
    let localWorkspace: SutraPadWorkspace = makeWorkspace([]);
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      localWorkspace = next;
    });

    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => localWorkspace,
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.loadWorkspace();
    expect(io.isWorkspaceDirty()).toBe(false);
  });

  it("returns true when the local workspace diverges from the snapshot (real edit)", async () => {
    // This is the gate the bug regression hangs on: the user typed
    // into a brand-new note ⇒ local diverges from the last-synced
    // snapshot ⇒ dirty ⇒ focus-refresh skips. Without this signal
    // the refresh could fire mid-typing, drop the local-only note
    // (Drive doesn't know about it yet), and the render-detached
    // textarea's blur would stamp the typed value onto a sibling.
    const h = makeHarness();
    h.store.loadWorkspace.mockResolvedValueOnce(
      makeWorkspace([realNote("remote-1")]),
    );
    let localWorkspace: SutraPadWorkspace = makeWorkspace([]);
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      localWorkspace = next;
    });

    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => localWorkspace,
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.loadWorkspace();
    expect(io.isWorkspaceDirty()).toBe(false);

    // Simulate the user adding a new note with real content.
    localWorkspace = makeWorkspace([
      realNote("remote-1"),
      { ...realNote("local-only"), body: "Vopice" },
    ]);
    expect(io.isWorkspaceDirty()).toBe(true);
  });

  it("treats an empty-draft addition as clean (drafts get stripped before comparison)", async () => {
    // The `+ Add` / `N` press spawns an empty draft locally; that
    // draft is intentionally NEVER pushed to Drive (the save path's
    // stripEmptyDraftNotes filter). So a workspace that picked up
    // only an empty draft since the last sync isn't really "dirty"
    // from Drive's perspective — there is nothing pending to push.
    // If the gate treated drafts as dirty, every freshly-spawned
    // draft would lock out the visibility refresh until the user
    // typed something or navigated away — overly conservative.
    const h = makeHarness();
    h.store.loadWorkspace.mockResolvedValueOnce(
      makeWorkspace([realNote("remote-1")]),
    );
    let localWorkspace: SutraPadWorkspace = makeWorkspace([]);
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      localWorkspace = next;
    });

    const io = createWorkspaceIO({
      getStore: h.getStore,
      retryContext: {
        refreshSession: h.refreshSession,
        onProfileRefreshed: h.onProfileRefreshed,
      },
      getWorkspace: () => localWorkspace,
      setWorkspace: h.setWorkspace,
      persistLocalWorkspace: h.persistLocalWorkspace,
      setSyncState: h.setSyncState,
      setLastError: h.setLastError,
      render: h.render,
      refreshStatus: h.refreshStatus,
      cancelAutoSave: h.cancelAutoSave,
    });

    await io.loadWorkspace();

    localWorkspace = makeWorkspace([
      realNote("remote-1"),
      emptyDraft("fresh-draft"),
    ]);
    expect(io.isWorkspaceDirty()).toBe(false);
  });
});
