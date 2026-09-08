/**
 * Index-aware focus refresh (2026-09-08 rewrite). The orchestrator makes
 * one cheap Drive read and merges it through `applyDriveRefresh`; these
 * tests pin the merge outcomes, the sync-state / repaint choreography and
 * — the regression the rewrite exists for — that no note body is ever
 * fetched by a refresh.
 */
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  runWorkspaceRefresh,
  type WorkspaceRefreshEffects,
} from "../src/app/session/workspace-refresh";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

function note(id: string, body: string, updatedAt: string): SutraPadDocument {
  return { id, title: id, body, urls: [], tags: [], createdAt: updatedAt, updatedAt };
}

/** What `loadWorkspace` hands back for an indexed note. */
function placeholder(id: string, updatedAt: string): SutraPadDocument {
  return { ...note(id, "", updatedAt), hydrated: false, fileId: `file-${id}` };
}

function workspace(
  notes: SutraPadDocument[],
  activeNoteId: string | null = notes[0]?.id ?? null,
): SutraPadWorkspace {
  return { notes, activeNoteId };
}

interface RefreshHarness {
  state: { workspace: SutraPadWorkspace };
  loadRemoteWorkspace: Mock;
  setWorkspace: Mock;
  persistLocalWorkspace: Mock;
  setSyncState: Mock;
  setLastError: Mock;
  render: Mock;
  cancelAutoSave: Mock;
}

function makeHarness(initial: SutraPadWorkspace, remote: SutraPadWorkspace = workspace([])): RefreshHarness {
  const state = { workspace: initial };
  return {
    state,
    loadRemoteWorkspace: vi.fn().mockResolvedValue(remote),
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
): WorkspaceRefreshEffects {
  return {
    loadRemoteWorkspace: h.loadRemoteWorkspace,
    getKnownDriveIds:
      knownDriveIds === "every-local-note"
        ? () => new Set(h.state.workspace.notes.map((n) => n.id))
        : () => knownDriveIds,
    getWorkspace: () => h.state.workspace,
    setWorkspace: h.setWorkspace,
    persistLocalWorkspace: h.persistLocalWorkspace,
    setSyncState: h.setSyncState,
    setLastError: h.setLastError,
    render: h.render,
    cancelAutoSave: h.cancelAutoSave,
  };
}

/** `syncState | note ids` at every repaint — the user-visible filmstrip. */
function filmstripOf(h: RefreshHarness): string[] {
  const frames: string[] = [];
  h.render.mockImplementation(() => {
    const syncState = h.setSyncState.mock.calls.at(-1)?.[0] ?? "idle";
    frames.push(`${syncState}|${h.state.workspace.notes.map((n) => n.id).join(",")}`);
  });
  return frames;
}

const T1 = "2026-05-01T10:00:00.000Z";
const T2 = "2026-05-02T10:00:00.000Z";

describe("runWorkspaceRefresh", () => {
  it("cancels pending autosave and walks loading → idle, reading Drive exactly once", async () => {
    const h = makeHarness(workspace([note("a", "alpha", T1)]), workspace([placeholder("a", T1)]));
    const result = await runWorkspaceRefresh(effects(h));
    expect(h.cancelAutoSave).toHaveBeenCalledTimes(1);
    expect(h.setSyncState.mock.calls.map(([s]) => s)).toEqual(["loading", "idle"]);
    expect(h.setLastError).toHaveBeenCalledWith("");
    expect(h.loadRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ changed: false });
  });

  it("drops a note that vanished from Drive", async () => {
    const h = makeHarness(
      workspace([note("a", "alpha", T1), note("gone", "deleted elsewhere", T1)]),
      workspace([placeholder("a", T1)]),
    );
    const result = await runWorkspaceRefresh(effects(h));
    expect(h.state.workspace.notes.map((n) => n.id)).toEqual(["a"]);
    expect(result.changed).toBe(true);
  });

  it("replaces a note Drive holds a newer copy of with its placeholder (body re-hydrates on open)", async () => {
    const h = makeHarness(
      workspace([note("a", "old body", T1)]),
      workspace([placeholder("a", T2)]),
    );
    await runWorkspaceRefresh(effects(h));
    expect(h.state.workspace.notes[0]).toMatchObject({ id: "a", updatedAt: T2, hydrated: false, body: "" });
  });

  it("keeps a local mid-edit whose updatedAt is newer or equal (strict-greater rule)", async () => {
    const h = makeHarness(
      workspace([note("a", "typing…", T2), note("b", "same stamp", T1)]),
      workspace([placeholder("a", T1), placeholder("b", T1)]),
    );
    const result = await runWorkspaceRefresh(effects(h));
    expect(h.state.workspace.notes.map((n) => n.body)).toEqual(["typing…", "same stamp"]);
    expect(result.changed).toBe(false);
  });

  it("merges against the workspace as it is *after* the Drive read, not before", async () => {
    // A keystroke landed while the load was in flight: the merge must see it.
    const h = makeHarness(workspace([note("a", "before", T1)]));
    h.loadRemoteWorkspace.mockImplementation(() => {
      h.state.workspace = workspace([note("a", "typed during load", T2)]);
      return Promise.resolve(workspace([placeholder("a", T1)]));
    });
    await runWorkspaceRefresh(effects(h));
    expect(h.state.workspace.notes[0].body).toBe("typed during load");
  });

  it("appends notes that are new on Drive as placeholders", async () => {
    const h = makeHarness(
      workspace([note("a", "alpha", T1)]),
      workspace([placeholder("a", T1), placeholder("new", T2)]),
    );
    await runWorkspaceRefresh(effects(h));
    const byId = new Map(h.state.workspace.notes.map((n) => [n.id, n.hydrated]));
    expect([...byId.entries()].toSorted()).toEqual([["a", undefined], ["new", false]]);
  });

  it("preserves a local-only note Drive has never seen, and an empty draft", async () => {
    const h = makeHarness(
      workspace([note("a", "alpha", T1), note("fresh", "not yet pushed", T2), note("draft", "", T2)]),
      workspace([placeholder("a", T1)]),
    );
    await runWorkspaceRefresh(effects(h, new Set(["a"])));
    expect(h.state.workspace.notes.map((n) => n.id).toSorted()).toEqual(["a", "draft", "fresh"]);
  });

  it("keeps every local-only note when no getKnownDriveIds effect is wired", async () => {
    const h = makeHarness(
      workspace([note("a", "alpha", T1), note("b", "local only", T1)]),
      workspace([placeholder("a", T1)]),
    );
    const { getKnownDriveIds: _omitted, ...withoutKnown } = effects(h);
    await runWorkspaceRefresh(withoutKnown);
    expect(h.state.workspace.notes.map((n) => n.id)).toContain("b");
  });

  it("transitions to error and surfaces the message when the Drive read fails", async () => {
    const h = makeHarness(workspace([note("a", "alpha", T1)]));
    h.loadRemoteWorkspace.mockRejectedValue(new Error("Drive 503"));
    const result = await runWorkspaceRefresh(effects(h));
    expect(h.setSyncState).toHaveBeenLastCalledWith("error");
    expect(h.setLastError).toHaveBeenLastCalledWith("Drive 503");
    expect(h.setWorkspace).not.toHaveBeenCalled();
    expect(result).toEqual({ changed: false });
  });

  it("falls back to a generic message when the failure is not an Error", async () => {
    const h = makeHarness(workspace([]));
    h.loadRemoteWorkspace.mockRejectedValue("nope");
    await runWorkspaceRefresh(effects(h));
    expect(h.setLastError).toHaveBeenLastCalledWith("Refreshing from Google Drive failed.");
  });

  it("works when Drive is empty (brand-new folder) and the local workspace is too", async () => {
    const h = makeHarness(workspace([]), workspace([]));
    await expect(runWorkspaceRefresh(effects(h))).resolves.toEqual({ changed: false });
    expect(h.setSyncState).toHaveBeenLastCalledWith("idle");
  });
});

describe("runWorkspaceRefresh repaints and persistence", () => {
  it("repaints exactly twice and commits once when something changed", async () => {
    const h = makeHarness(
      workspace([note("a", "alpha", T1), note("gone", "x", T1)]),
      workspace([placeholder("a", T1)]),
    );
    const frames = filmstripOf(h);
    await runWorkspaceRefresh(effects(h));
    expect(frames).toEqual(["loading|a,gone", "idle|a"]);
    expect(h.setWorkspace).toHaveBeenCalledTimes(1);
    expect(h.persistLocalWorkspace).toHaveBeenCalledTimes(1);
    expect(h.persistLocalWorkspace).toHaveBeenCalledWith(h.state.workspace);
  });

  it("repaints twice and never commits or persists on a steady-state no-op", async () => {
    const h = makeHarness(workspace([note("a", "alpha", T1)]), workspace([placeholder("a", T1)]));
    const frames = filmstripOf(h);
    await runWorkspaceRefresh(effects(h));
    expect(frames).toEqual(["loading|a", "idle|a"]);
    expect(h.setWorkspace).not.toHaveBeenCalled();
    expect(h.persistLocalWorkspace).not.toHaveBeenCalled();
  });

  it("repaints the error state over the notes the user still has", async () => {
    const h = makeHarness(workspace([note("a", "alpha", T1)]));
    h.loadRemoteWorkspace.mockRejectedValue(new Error("boom"));
    const frames = filmstripOf(h);
    await runWorkspaceRefresh(effects(h));
    expect(frames).toEqual(["loading|a", "error|a"]);
  });
});
