import type { SutraPadWorkspace } from "../../types";
import { areWorkspacesEqual, mergeWorkspaces } from "../../lib/notebook";

export type SyncState = "idle" | "loading" | "saving" | "error";
export type SaveMode = "interactive" | "background";

export async function runWorkspaceSave(
  mode: SaveMode,
  effects: {
    persistLocalWorkspace: () => void;
    saveRemoteWorkspace: () => Promise<void>;
    setSyncState: (state: SyncState) => void;
    setLastError: (message: string) => void;
    render: () => void;
    refreshStatus: () => void;
  },
): Promise<void> {
  const refreshUi = mode === "interactive" ? effects.render : effects.refreshStatus;

  try {
    effects.setSyncState("saving");
    effects.setLastError("");
    effects.persistLocalWorkspace();
    refreshUi();
    await effects.saveRemoteWorkspace();
    effects.setSyncState("idle");
    refreshUi();
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(error instanceof Error ? error.message : "Saving to Google Drive failed.");
    refreshUi();
  }
}

/**
 * Manual "Load from Drive" action — pulls the remote workspace and replaces
 * the local one. The effects bag keeps app.ts free of Drive lifecycle
 * branching; shape matches `runWorkspaceSave` for consistency.
 *
 * `cancelAutoSave` cancels any pending background-save timer before the
 * load runs. Without it, a debounced autosave armed by the user's last
 * keystroke can fire after `setWorkspace(loaded)` and push the just-
 * loaded remote workspace right back to Drive. The push is a no-op
 * functionally (loaded → loaded) but it consumes a Drive round-trip
 * and registers a spurious "saving" pulse in the UI.
 */
export async function runWorkspaceLoad(effects: {
  loadRemoteWorkspace: () => Promise<SutraPadWorkspace>;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistLocalWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (state: SyncState) => void;
  setLastError: (message: string) => void;
  render: () => void;
  cancelAutoSave?: () => void;
}): Promise<void> {
  try {
    effects.cancelAutoSave?.();
    effects.setSyncState("loading");
    effects.setLastError("");
    effects.render();
    const loaded = await effects.loadRemoteWorkspace();
    effects.setWorkspace(loaded);
    effects.persistLocalWorkspace(loaded);
    effects.setSyncState("idle");
    effects.render();
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(
      error instanceof Error ? error.message : "Loading from Google Drive failed.",
    );
    effects.render();
  }
}

/**
 * Sign-in merge flow — pulls the remote workspace, merges it with whatever is
 * already in the browser, and pushes back if the merge produced changes the
 * remote doesn't yet know about. Equality check prevents a no-op round trip.
 *
 * `cancelAutoSave` is the more important of the two new effect hooks
 * here. Without it: the user's last keystroke armed an autosave for
 * 2 s out, sign-in restore merges the remote workspace over the
 * local, the autosave fires while merge is mid-flight or just after,
 * and either races the merge's `saveRemoteWorkspace` (two writes
 * stomping on each other) or pushes a workspace that's already
 * superseded. Cancelling first means the merge's own save is the
 * single source of truth for this transition; subsequent user edits
 * will re-arm the autosave from the merged baseline.
 */
export async function runWorkspaceRestoreAfterSignIn(effects: {
  loadRemoteWorkspace: () => Promise<SutraPadWorkspace>;
  saveRemoteWorkspace: (workspace: SutraPadWorkspace) => Promise<void>;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistLocalWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (state: SyncState) => void;
  setLastError: (message: string) => void;
  render: () => void;
  cancelAutoSave?: () => void;
}): Promise<void> {
  try {
    effects.cancelAutoSave?.();
    effects.setSyncState("loading");
    effects.setLastError("");
    effects.render();

    const remoteWorkspace = await effects.loadRemoteWorkspace();
    const mergedWorkspace = mergeWorkspaces(effects.getWorkspace(), remoteWorkspace);
    const needsRemoteSave = !areWorkspacesEqual(mergedWorkspace, remoteWorkspace);

    effects.setWorkspace(mergedWorkspace);
    effects.persistLocalWorkspace(mergedWorkspace);

    if (needsRemoteSave) {
      effects.setSyncState("saving");
      effects.render();
      await effects.saveRemoteWorkspace(mergedWorkspace);
    }

    effects.setSyncState("idle");
    effects.render();
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(
      error instanceof Error ? error.message : "Loading from Google Drive failed.",
    );
    effects.render();
  }
}
