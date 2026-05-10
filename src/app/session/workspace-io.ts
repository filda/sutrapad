/**
 * Drive-backed workspace IO wiring.
 *
 * The three runners in `workspace-sync.ts` (`runWorkspaceLoad`,
 * `runWorkspaceSave`, `runWorkspaceRestoreAfterSignIn`) are pure
 * lifecycle orchestrators — they don't know about `GoogleDriveStore`
 * or `withAuthRetry`. The closure-binding step (turning a
 * `getStore()` + `retryContext` pair into the `loadRemoteWorkspace`
 * / `saveRemoteWorkspace` callbacks the runners want) lives here so
 * `createApp` doesn't have to repeat it three times.
 */

import { stripEmptyDraftNotes } from "../../lib/notebook";
import type { GoogleDriveStore } from "../../services/drive-store";
import type { SutraPadWorkspace } from "../../types";
import { withAuthRetry, type AuthRetryContext } from "./auth-retry";
import {
  runWorkspaceLoad,
  runWorkspaceRestoreAfterSignIn,
  runWorkspaceSave,
  type SaveMode,
  type SyncState,
} from "./workspace-sync";
import {
  runWorkspaceRefresh,
  type WorkspaceRefreshOptions,
} from "./workspace-refresh";

export interface WorkspaceIODeps {
  getStore: () => GoogleDriveStore;
  retryContext: AuthRetryContext;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistLocalWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (state: SyncState) => void;
  setLastError: (message: string) => void;
  render: () => void;
  refreshStatus: () => void;
  cancelAutoSave: () => void;
}

export interface WorkspaceIO {
  loadWorkspace: () => Promise<void>;
  saveWorkspace: (mode?: SaveMode) => Promise<void>;
  restoreWorkspaceAfterSignIn: () => Promise<void>;
  /**
   * Cross-device progressive refresh. Phase-1 inventory updates the
   * count + drops deleted notes; subsequent phases stream the JSONs
   * newest-first. Used by the focus / visibility-driven refresh
   * trigger in `createApp`; manual "Load from Drive" still goes
   * through `loadWorkspace` for the all-or-nothing replace semantics.
   */
  refreshWorkspace: (options?: WorkspaceRefreshOptions) => Promise<void>;
}

export function createWorkspaceIO(deps: WorkspaceIODeps): WorkspaceIO {
  const {
    getStore,
    retryContext,
    getWorkspace,
    setWorkspace,
    persistLocalWorkspace,
    setSyncState,
    setLastError,
    render,
    refreshStatus,
    cancelAutoSave,
  } = deps;

  const loadWorkspace = async (): Promise<void> =>
    runWorkspaceLoad({
      loadRemoteWorkspace: () =>
        withAuthRetry(() => getStore().loadWorkspace(), retryContext),
      setWorkspace,
      persistLocalWorkspace,
      setSyncState,
      setLastError,
      render,
      cancelAutoSave,
    });

  const restoreWorkspaceAfterSignIn = async (): Promise<void> =>
    runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () =>
        withAuthRetry(() => getStore().loadWorkspace(), retryContext),
      saveRemoteWorkspace: (ws) =>
        withAuthRetry(() => getStore().saveWorkspace(ws), retryContext),
      getWorkspace,
      setWorkspace,
      persistLocalWorkspace,
      setSyncState,
      setLastError,
      render,
      cancelAutoSave,
    });

  // Background autosave must not trigger the GIS silent-refresh iframe —
  // on mobile it steals focus from the active <textarea> mid-keystroke.
  // We forward the save mode into `withAuthRetry` so a 401 during autosave
  // propagates unchanged (surfaces as syncState = "error") and waits for
  // the user's next interactive save / load to drive the refresh.
  //
  // Strip empty drafts before the remote push so a note the user
  // spawned-then-cleared doesn't land on Drive: e.g. user hits N,
  // types one character (scheduling autosave), deletes it, and the
  // 2-second timer fires before they click away. We only filter
  // at the *remote* edge — the local copy is still there so the
  // user can keep typing, and the next nav-away purge sweeps it
  // normally.
  const saveWorkspace = async (mode: SaveMode = "interactive"): Promise<void> =>
    runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(getWorkspace()),
      saveRemoteWorkspace: () =>
        withAuthRetry(
          () => getStore().saveWorkspace(stripEmptyDraftNotes(getWorkspace())),
          {
            ...retryContext,
            mode,
          },
        ),
      setSyncState,
      setLastError,
      render,
      refreshStatus,
      cancelAutoSave,
    });

  // Progressive refresh: Drive I/O is bound through `withAuthRetry`
  // (interactive mode — focus is a user-driven trigger, so a 401 should
  // attempt the silent-refresh path) and the existing render / sync-state
  // hooks. The orchestrator owns batching + merge order.
  const refreshWorkspace = async (
    options: WorkspaceRefreshOptions = {},
  ): Promise<void> =>
    runWorkspaceRefresh(
      {
        loadInventory: () =>
          withAuthRetry(() => getStore().loadNoteInventory(), retryContext),
        fetchNoteByFileId: (fileId) =>
          withAuthRetry(
            () => getStore().fetchNoteByFileId(fileId),
            retryContext,
          ),
        getWorkspace,
        setWorkspace,
        persistLocalWorkspace,
        setSyncState,
        setLastError,
        render,
        cancelAutoSave,
      },
      options,
    );

  return {
    loadWorkspace,
    saveWorkspace,
    restoreWorkspaceAfterSignIn,
    refreshWorkspace,
  };
}
