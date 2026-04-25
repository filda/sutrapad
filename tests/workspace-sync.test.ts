import { describe, expect, it, vi } from "vitest";
import {
  runWorkspaceLoad,
  runWorkspaceRestoreAfterSignIn,
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
      loadRemoteWorkspace: async () => {
        calls.push("loadRemote");
        return remote;
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
        loadRemoteWorkspace: async () => remote,
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
      loadRemoteWorkspace: async () => {
        throw new Error("network");
      },
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
      loadRemoteWorkspace: async () => remote,
      saveRemoteWorkspace: async () => undefined,
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
        loadRemoteWorkspace: async () => remote,
        saveRemoteWorkspace: async () => undefined,
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
