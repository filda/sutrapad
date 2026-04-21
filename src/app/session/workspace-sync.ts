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
 */
export async function runWorkspaceLoad(effects: {
  loadRemoteWorkspace: () => Promise<SutraPadWorkspace>;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistLocalWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (state: SyncState) => void;
  setLastError: (message: string) => void;
  render: () => void;
}): Promise<void> {
  try {
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
}): Promise<void> {
  try {
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
