import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { runWorkspaceRefresh } from "../src/app/session/workspace-refresh";
import type { DriveNoteInventoryEntry } from "../src/app/session/workspace-refresh";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

function note(
  id: string,
  body: string,
  updatedAt: string,
): SutraPadDocument {
  return {
    id,
    title: id,
    body,
    urls: [],
    tags: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

function workspace(
  notes: SutraPadDocument[],
  activeNoteId: string | null = notes[0]?.id ?? null,
): SutraPadWorkspace {
  return { notes, activeNoteId };
}

interface RefreshHarness {
  state: { workspace: SutraPadWorkspace };
  loadInventory: Mock;
  fetchNoteByFileId: Mock;
  setWorkspace: Mock;
  persistLocalWorkspace: Mock;
  setSyncState: Mock;
  setLastError: Mock;
  render: Mock;
  cancelAutoSave: Mock;
}

function makeHarness(initial: SutraPadWorkspace): RefreshHarness {
  const state = { workspace: initial };
  return {
    state,
    loadInventory: vi.fn().mockResolvedValue([]),
    fetchNoteByFileId: vi.fn(),
    setWorkspace: vi.fn((next: SutraPadWorkspace) => {
      state.workspace = next;
    }),
    persistLocalWorkspace: vi.fn(),
    setSyncState: vi.fn(),
    setLastError: vi.fn(),
    render: vi.fn(),
    cancelAutoSave: vi.fn(),
  };
}

function effects(
  h: RefreshHarness,
  knownDriveIds: ReadonlySet<string> | "every-local-note" = "every-local-note",
) {
  // Default mirrors the realistic production state by the time a
  // refresh fires: every id currently visible locally was already
  // confirmed on Drive (loaded at startup or saved during this
  // session). Tests that exercise the local-only-never-pushed path
  // pass an explicit narrower set so applyDriveRefresh preserves the
  // unknown ids; tests that exercise cross-device deletion can rely
  // on the default's "every local id is known to Drive" snapshot.
  const resolvedKnown =
    knownDriveIds === "every-local-note"
      ? () => new Set(h.state.workspace.notes.map((n) => n.id))
      : () => knownDriveIds;
  return {
    loadInventory: h.loadInventory,
    fetchNoteByFileId: h.fetchNoteByFileId,
    getKnownDriveIds: resolvedKnown,
    getWorkspace: () => h.state.workspace,
    setWorkspace: h.setWorkspace,
    persistLocalWorkspace: h.persistLocalWorkspace,
    setSyncState: h.setSyncState,
    setLastError: h.setLastError,
    render: h.render,
    cancelAutoSave: h.cancelAutoSave,
  };
}

function entry(
  noteId: string,
  fileId: string,
  modifiedTime: string,
): DriveNoteInventoryEntry {
  return { noteId, fileId, modifiedTime };
}

describe("runWorkspaceRefresh", () => {
  it("cancels pending autosave and signals sync state at the start and end", async () => {
    // Mirror the contract `runWorkspaceLoad` already has: a refresh
    // armed by a focus event must not race a 2 s autosave timer
    // armed by the user's last keystroke. The pre-flight cancel is
    // what removes the race.
    const h = makeHarness(workspace([note("a", "alpha", "2026-05-01T10:00:00.000Z")]));
    h.loadInventory.mockResolvedValue([
      entry("a", "fa", "2026-05-01T10:00:00.000Z"),
    ]);
    h.fetchNoteByFileId.mockImplementation((fileId: string) => {
      if (fileId === "fa") return note("a", "alpha", "2026-05-01T10:00:00.000Z");
      throw new Error("unexpected fileId");
    });

    await runWorkspaceRefresh(effects(h));

    expect(h.cancelAutoSave).toHaveBeenCalledTimes(1);
    expect(h.setSyncState).toHaveBeenCalledWith("loading");
    expect(h.setSyncState).toHaveBeenLastCalledWith("idle");
    expect(h.setLastError).toHaveBeenCalledWith("");
  });

  it("drops a note that vanished from the inventory before any JSON is fetched (Phase 1)", async () => {
    // The headline win: the user opened Device B; another device
    // deleted "gone" since the last load. The Phase 1 merge prunes
    // it *before* a single note JSON has been fetched, so the count
    // and list update on the very first render.
    const h = makeHarness(
      workspace([
        note("a", "alpha", "2026-05-01T10:00:00.000Z"),
        note("gone", "deleted elsewhere", "2026-04-30T10:00:00.000Z"),
      ]),
    );
    h.loadInventory.mockResolvedValue([
      entry("a", "fa", "2026-05-01T10:00:00.000Z"),
    ]);
    h.fetchNoteByFileId.mockResolvedValue(
      note("a", "alpha", "2026-05-01T10:00:00.000Z"),
    );

    // Capture the workspace as it was at the moment of the first
    // post-inventory render — before any fetch happened.
    const sawAfterPhase1: SutraPadWorkspace[] = [];
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      h.state.workspace = next;
      if (h.fetchNoteByFileId.mock.calls.length === 0) {
        sawAfterPhase1.push(next);
      }
    });

    await runWorkspaceRefresh(effects(h));

    expect(sawAfterPhase1).toHaveLength(1);
    expect(sawAfterPhase1[0].notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("fetches the priority batch newest-first by modifiedTime", async () => {
    // The user sees their newly-captured note first. We don't promise
    // anything about the order *within* a parallel batch (Promise.all
    // resolves in fetch order, not call order), but the inventory
    // ORDER we hand to fetchNoteByFileId must be newest-modifiedTime
    // first.
    const h = makeHarness(workspace([]));
    h.loadInventory.mockResolvedValue([
      entry("oldest", "f1", "2026-04-01T00:00:00.000Z"),
      entry("newest", "f2", "2026-05-01T00:00:00.000Z"),
      entry("middle", "f3", "2026-04-15T00:00:00.000Z"),
    ]);
    h.fetchNoteByFileId.mockImplementation((fileId: string) => {
      if (fileId === "f1") return note("oldest", "", "2026-04-01T00:00:00.000Z");
      if (fileId === "f2") return note("newest", "", "2026-05-01T00:00:00.000Z");
      if (fileId === "f3") return note("middle", "", "2026-04-15T00:00:00.000Z");
      throw new Error("unknown");
    });

    await runWorkspaceRefresh(effects(h), { firstBatchSize: 1, batchSize: 1 });

    const fetchOrder = h.fetchNoteByFileId.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(fetchOrder).toEqual(["f2", "f3", "f1"]);
  });

  it("preserves a local mid-edit when the fetched copy is older (strict-greater rule)", async () => {
    // The user is typing on Device B; the refresh just landed
    // mid-keystroke. local.updatedAt has been bumped past whatever
    // Drive captured, so the merge keeps the in-flight body.
    const inflight = note("a", "user typing right now", "2026-05-01T10:05:00.000Z");
    const driveCopy = note("a", "older drive copy", "2026-05-01T10:00:00.000Z");

    const h = makeHarness(workspace([inflight]));
    h.loadInventory.mockResolvedValue([
      entry("a", "fa", "2026-05-01T10:00:00.000Z"),
    ]);
    h.fetchNoteByFileId.mockResolvedValue(driveCopy);

    await runWorkspaceRefresh(effects(h));

    expect(h.state.workspace.notes[0].body).toBe("user typing right now");
  });

  it("transitions to error sync state on a fetch failure and surfaces the message", async () => {
    // Network blip mid-batch. We don't try to be heroic — flip to
    // error, surface the message, leave the partial workspace state
    // in place. Subsequent focus events will retry.
    const h = makeHarness(workspace([]));
    h.loadInventory.mockResolvedValue([
      entry("a", "fa", "2026-05-01T10:00:00.000Z"),
    ]);
    h.fetchNoteByFileId.mockRejectedValue(new Error("Network down"));

    await runWorkspaceRefresh(effects(h));

    expect(h.setSyncState).toHaveBeenLastCalledWith("error");
    expect(h.setLastError).toHaveBeenCalledWith("Network down");
  });

  it("falls back to a generic message when the failure is not an Error instance", async () => {
    // Drive client throws strings in some paths; the orchestrator
    // must still produce a presentable message.
    const h = makeHarness(workspace([]));
    h.loadInventory.mockRejectedValue("not an Error");

    await runWorkspaceRefresh(effects(h));

    expect(h.setLastError).toHaveBeenLastCalledWith(
      "Refreshing from Google Drive failed.",
    );
  });

  it("does NOT call setWorkspace on a steady-state no-op refresh", async () => {
    // Open tab, all notes already in sync, focus the window. The
    // inventory matches local; no fetched note is strictly newer.
    // We should commit zero workspace changes — render still fires
    // for sync-state transitions, but nothing on the workspace side
    // moves.
    const stable = note("a", "alpha", "2026-05-01T10:00:00.000Z");
    const h = makeHarness(workspace([stable]));
    h.loadInventory.mockResolvedValue([
      entry("a", "fa", "2026-05-01T10:00:00.000Z"),
    ]);
    h.fetchNoteByFileId.mockResolvedValue(stable);

    await runWorkspaceRefresh(effects(h));

    expect(h.setWorkspace).not.toHaveBeenCalled();
    expect(h.persistLocalWorkspace).not.toHaveBeenCalled();
  });

  it("uses firstBatchSize for the priority batch and batchSize for catch-up batches", async () => {
    // Pins the size selector: the priority batch must use
    // `firstBatchSize` slots and every subsequent batch must use
    // `batchSize`. Without different values, the ternary selecting
    // between them is indistinguishable from "always batchSize" or
    // "always firstBatchSize" (both Stryker mutants).
    const h = makeHarness(workspace([]));
    h.loadInventory.mockResolvedValue([
      entry("n1", "f1", "2026-05-01T00:00:05.000Z"),
      entry("n2", "f2", "2026-05-01T00:00:04.000Z"),
      entry("n3", "f3", "2026-05-01T00:00:03.000Z"),
      entry("n4", "f4", "2026-05-01T00:00:02.000Z"),
      entry("n5", "f5", "2026-05-01T00:00:01.000Z"),
    ]);
    // Map fileId → its matching noteId so the fetched JSON's id
    // matches the inventory entry; the merge in applyDriveRefresh
    // keys on `note.id`, not the Drive fileId.
    const noteIdByFileId: Record<string, string> = {
      f1: "n1",
      f2: "n2",
      f3: "n3",
      f4: "n4",
      f5: "n5",
    };
    h.fetchNoteByFileId.mockImplementation((fileId: string) =>
      note(noteIdByFileId[fileId], "", "2026-05-01T00:00:00.000Z"),
    );

    // Snapshot how many fetch calls had landed by the time the second
    // batch started — captured by recording call counts at each
    // `setWorkspace` boundary (each batch ends with applyAndCommit
    // which calls setWorkspace).
    const fetchedSoFar: number[] = [];
    h.setWorkspace.mockImplementation((next: SutraPadWorkspace) => {
      h.state.workspace = next;
      fetchedSoFar.push(h.fetchNoteByFileId.mock.calls.length);
    });

    await runWorkspaceRefresh(effects(h), {
      firstBatchSize: 3,
      batchSize: 2,
    });

    // Phase 1 (inventory only, 0 fetches), then priority batch of 3
    // (3 fetches), then a catch-up batch of 2 (5 fetches total).
    // Phase 1 doesn't fire setWorkspace because inventory matched the
    // empty local; only the two fetch batches commit.
    expect(fetchedSoFar).toEqual([3, 5]);
  });

  it("works when the inventory is empty (brand-new workspace folder, nothing on Drive yet)", async () => {
    // Local carries a real body so it represents a note that *was*
    // synced before and is now being cleaned up — not a local-only
    // empty draft, which `applyDriveRefresh` deliberately preserves
    // through an empty-inventory refresh.
    const h = makeHarness(workspace([note("a", "real body", "2026-05-01T10:00:00.000Z")]));
    h.loadInventory.mockResolvedValue([]);

    await runWorkspaceRefresh(effects(h));

    expect(h.fetchNoteByFileId).not.toHaveBeenCalled();
    // Local note was not in the empty inventory → dropped.
    expect(h.state.workspace.notes).toHaveLength(0);
    expect(h.setSyncState).toHaveBeenLastCalledWith("idle");
  });
});
