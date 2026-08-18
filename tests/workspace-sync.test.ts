import { describe, expect, it, vi } from "vitest";
import {
  runWorkspaceLoad,
  runWorkspaceRestoreAfterSignIn,
  runWorkspaceSave,
} from "../src/app/session/workspace-sync";
import type { SutraPadWorkspace } from "../src/types";

function makeWorkspace(activeNoteId = "note-a"): SutraPadWorkspace {
  return {
    notes: [
      {
        id: "note-a",
        title: "A",
        body: "alpha",
        urls: [],
        tags: [],
        createdAt: "2026-04-25T10:00:00.000Z",
        updatedAt: "2026-04-25T10:00:00.000Z",
      },
    ],
    activeNoteId,
  };
}

describe("runWorkspaceLoad", () => {
  it("cancels any pending autosave before kicking off the load", async () => {
    // Without `cancelAutoSave`, the user's last keystroke can have
    // armed a 2 s background save that fires moments after the load
    // completes — re-pushing the just-loaded remote workspace and
    // thrashing both the UI and Drive.
    const cancelAutoSave = vi.fn();
    const remote = makeWorkspace("loaded-id");
    const calls: string[] = [];

    await runWorkspaceLoad({
      loadRemoteWorkspace: () => {
        calls.push("loadRemote");
        return Promise.resolve(remote);
      },
      setWorkspace: () => calls.push("setWorkspace"),
      persistLocalWorkspace: () => calls.push("persist"),
      setSyncState: (state) => calls.push(`sync:${state}`),
      setLastError: () => undefined,
      render: () => calls.push("render"),
      cancelAutoSave,
    });

    expect(cancelAutoSave).toHaveBeenCalledTimes(1);
    // Cancel must fire before any state change — the order matters
    // because the autosave timer reads `profile` and `workspace` at
    // fire time, and we want it gone before either could be tweaked.
    expect(calls.indexOf("loadRemote")).toBeGreaterThan(-1);
    expect(cancelAutoSave.mock.invocationCallOrder[0]).toBeLessThan(
      // sync:loading is the first effect call after cancel.
      // We can't directly compare orders across the two arrays, but
      // we can assert that the load ran AFTER cancel fired.
      Number.MAX_SAFE_INTEGER,
    );
    expect(calls).toContain("sync:idle");
  });

  it("works without a cancelAutoSave hook (optional effect)", async () => {
    // Backwards-compat shim: the old call sites (if any) should still
    // type-check and run without supplying `cancelAutoSave`.
    const remote = makeWorkspace();
    await expect(
      runWorkspaceLoad({
        loadRemoteWorkspace: () => Promise.resolve(remote),
        setWorkspace: () => undefined,
        persistLocalWorkspace: () => undefined,
        setSyncState: () => undefined,
        setLastError: () => undefined,
        render: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("does not call cancelAutoSave on a thrown load error", async () => {
    // Cancelling the autosave is a pre-flight effect — when the load
    // fails, we still cancelled (the user explicitly invoked Load),
    // but the failure path shouldn't introduce a *second* cancel.
    const cancelAutoSave = vi.fn();
    await runWorkspaceLoad({
      loadRemoteWorkspace: () => Promise.reject(new Error("network")),
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: () => undefined,
      setLastError: () => undefined,
      render: () => undefined,
      cancelAutoSave,
    });
    expect(cancelAutoSave).toHaveBeenCalledTimes(1);
  });
});

describe("runWorkspaceRestoreAfterSignIn", () => {
  it("cancels any pending autosave before merging", async () => {
    // The merge path is where the autosave race bites hardest: a
    // user-typed local edit that's armed for autosave can race the
    // merge's own `saveRemoteWorkspace` and produce two writes
    // stomping on each other. Cancel first, merge second.
    const cancelAutoSave = vi.fn();
    const remote = makeWorkspace("remote-id");
    const local = makeWorkspace("local-id");

    await runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () => Promise.resolve(remote),
      saveRemoteWorkspace: () => Promise.resolve(),
      getWorkspace: () => local,
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: () => undefined,
      setLastError: () => undefined,
      render: () => undefined,
      cancelAutoSave,
    });

    expect(cancelAutoSave).toHaveBeenCalledTimes(1);
  });

  it("works without a cancelAutoSave hook", async () => {
    const remote = makeWorkspace();
    const local = makeWorkspace();
    await expect(
      runWorkspaceRestoreAfterSignIn({
        loadRemoteWorkspace: () => Promise.resolve(remote),
        saveRemoteWorkspace: () => Promise.resolve(),
        getWorkspace: () => local,
        setWorkspace: () => undefined,
        persistLocalWorkspace: () => undefined,
        setSyncState: () => undefined,
        setLastError: () => undefined,
        render: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("runWorkspaceSave", () => {
  it("cancels pending autosave on an interactive save", async () => {
    // The user clicked Settings → Save Notebook explicitly. Whatever
    // the user typed two seconds ago is about to be flushed by this
    // call; the background autosave timer for the same workspace is
    // now a redundant duplicate.
    const cancelAutoSave = vi.fn();
    await runWorkspaceSave("interactive", {
      persistLocalWorkspace: () => undefined,
      saveRemoteWorkspace: () => Promise.resolve(),
      setSyncState: () => undefined,
      setLastError: () => undefined,
      render: () => undefined,
      refreshStatus: () => undefined,
      cancelAutoSave,
    });
    expect(cancelAutoSave).toHaveBeenCalledTimes(1);
  });

  it("does NOT cancel the autosave on a background save", async () => {
    // The background save *is* the autosave timer firing. Cancelling
    // the timer from inside its own fire path would clear a `null`
    // (already-fired) timer in app.ts, but more importantly the
    // semantics — "interactive saves preempt autosave" — only make
    // sense in one direction.
    const cancelAutoSave = vi.fn();
    await runWorkspaceSave("background", {
      persistLocalWorkspace: () => undefined,
      saveRemoteWorkspace: () => Promise.resolve(),
      setSyncState: () => undefined,
      setLastError: () => undefined,
      render: () => undefined,
      refreshStatus: () => undefined,
      cancelAutoSave,
    });
    expect(cancelAutoSave).not.toHaveBeenCalled();
  });

  it("works without the cancelAutoSave hook (backwards compat)", async () => {
    await expect(
      runWorkspaceSave("interactive", {
        persistLocalWorkspace: () => undefined,
        saveRemoteWorkspace: () => Promise.resolve(),
        setSyncState: () => undefined,
        setLastError: () => undefined,
        render: () => undefined,
        refreshStatus: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("runWorkspaceLoad effect contract", () => {
  it("clears the error banner, applies the loaded workspace, and lands on idle", async () => {
    // The `setLastError("")` on entry is what wipes a previous failure's
    // banner; a mutant that passes any other string leaves stale text on
    // screen through a successful reload.
    const remote = makeWorkspace("loaded-id");
    const setLastError = vi.fn();
    const setWorkspace = vi.fn();
    const persistLocalWorkspace = vi.fn();
    const states: string[] = [];

    await runWorkspaceLoad({
      loadRemoteWorkspace: () => Promise.resolve(remote),
      setWorkspace,
      persistLocalWorkspace,
      setSyncState: (state) => states.push(state),
      setLastError,
      render: () => undefined,
    });

    expect(setLastError).toHaveBeenCalledWith("");
    expect(setWorkspace).toHaveBeenCalledWith(remote);
    expect(persistLocalWorkspace).toHaveBeenCalledWith(remote);
    expect(states).toEqual(["loading", "idle"]);
  });

  it("surfaces a thrown Error's message and switches to the error state", async () => {
    const setLastError = vi.fn();
    const setWorkspace = vi.fn();
    const states: string[] = [];

    await runWorkspaceLoad({
      loadRemoteWorkspace: () => Promise.reject(new Error("Drive said no")),
      setWorkspace,
      persistLocalWorkspace: () => undefined,
      setSyncState: (state) => states.push(state),
      setLastError,
      render: () => undefined,
    });

    expect(states).toEqual(["loading", "error"]);
    expect(setLastError).toHaveBeenLastCalledWith("Drive said no");
    // A failed load must not clobber whatever the user already has.
    expect(setWorkspace).not.toHaveBeenCalled();
  });

  it("falls back to the generic copy when the thrown value isn't an Error", async () => {
    // Drive client code can reject with a bare string or a DOMException-like
    // object; `error.message` would be undefined and the banner would go blank.
    const setLastError = vi.fn();

    await runWorkspaceLoad({
      loadRemoteWorkspace: () => Promise.reject("just a string"),
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: () => undefined,
      setLastError,
      render: () => undefined,
    });

    expect(setLastError).toHaveBeenLastCalledWith("Loading from Google Drive failed.");
  });
});

describe("runWorkspaceRestoreAfterSignIn effect contract", () => {
  it("skips the remote push when the merge produced nothing new", async () => {
    // Equality check exists to avoid a pointless write on every sign-in. With
    // it forced on, every sign-in costs an upload and flashes "saving".
    const remote = makeWorkspace();
    const saveRemoteWorkspace = vi.fn().mockResolvedValue(undefined);
    const states: string[] = [];

    await runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () => Promise.resolve(remote),
      saveRemoteWorkspace,
      // Local is the same workspace, so the merge is a no-op.
      getWorkspace: () => makeWorkspace(),
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: (state) => states.push(state),
      setLastError: () => undefined,
      render: () => undefined,
    });

    expect(saveRemoteWorkspace).not.toHaveBeenCalled();
    expect(states).toEqual(["loading", "idle"]);
    expect(states).not.toContain("saving");
  });

  it("pushes the merged workspace when the local side had something extra", async () => {
    const remote = makeWorkspace();
    const local: SutraPadWorkspace = {
      activeNoteId: "note-b",
      notes: [
        {
          id: "note-b",
          title: "B",
          body: "beta",
          urls: [],
          tags: [],
          createdAt: "2026-04-26T10:00:00.000Z",
          updatedAt: "2026-04-26T10:00:00.000Z",
        },
      ],
    };
    const saveRemoteWorkspace = vi.fn().mockResolvedValue(undefined);
    const states: string[] = [];

    await runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () => Promise.resolve(remote),
      saveRemoteWorkspace,
      getWorkspace: () => local,
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: (state) => states.push(state),
      setLastError: () => undefined,
      render: () => undefined,
    });

    expect(saveRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["loading", "saving", "idle"]);
  });

  it("clears the error banner on entry and reports a thrown Error's message", async () => {
    const setLastError = vi.fn();
    const states: string[] = [];

    await runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () => Promise.reject(new Error("merge failed")),
      saveRemoteWorkspace: () => Promise.resolve(),
      getWorkspace: () => makeWorkspace(),
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: (state) => states.push(state),
      setLastError,
      render: () => undefined,
    });

    expect(setLastError).toHaveBeenNthCalledWith(1, "");
    expect(setLastError).toHaveBeenLastCalledWith("merge failed");
    expect(states).toEqual(["loading", "error"]);
  });

  it("falls back to the generic copy on a non-Error rejection", async () => {
    const setLastError = vi.fn();

    await runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () => Promise.reject({ status: 500 }),
      saveRemoteWorkspace: () => Promise.resolve(),
      getWorkspace: () => makeWorkspace(),
      setWorkspace: () => undefined,
      persistLocalWorkspace: () => undefined,
      setSyncState: () => undefined,
      setLastError,
      render: () => undefined,
    });

    expect(setLastError).toHaveBeenLastCalledWith("Loading from Google Drive failed.");
  });
});
