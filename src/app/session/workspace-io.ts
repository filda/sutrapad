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

import { areWorkspacesEqual, stripEmptyDraftNotes } from "../../lib/notebook";
import type { GoogleDriveStore } from "../../services/drive-store";
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";
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
import {
  runNoteImport,
  type NoteImportProgress,
} from "../logic/import-batches";

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
   * Fetches a single note's real body by Drive file id — the hydrate-on-open
   * counterpart to the body-less placeholders `loadWorkspace` now seeds
   * `workspace.notes` with. See `src/app/lifecycle/hydrate-note-on-open.ts`.
   */
  fetchNoteBody: (fileId: string) => Promise<SutraPadDocument>;
  /**
   * Cross-device progressive refresh. Phase-1 inventory updates the
   * count + drops deleted notes; subsequent phases stream the JSONs
   * newest-first. Used by the focus / visibility-driven refresh
   * trigger in `createApp`; manual "Load from Drive" still goes
   * through `loadWorkspace` for the all-or-nothing replace semantics.
   */
  refreshWorkspace: (options?: WorkspaceRefreshOptions) => Promise<void>;
  /**
   * Batch-imports notes created elsewhere (the drag-and-drop import) by
   * uploading each through the app's own token so the files are app-owned
   * and visible under the `drive.file` scope. Uploads run throttled in
   * batches; once done, the workspace is reloaded from Drive so the imported
   * notes appear and the clean-snapshot baseline includes them.
   */
  importNotes: (
    notes: SutraPadDocument[],
    options?: { onProgress?: (progress: NoteImportProgress) => void },
  ) => Promise<NoteImportProgress>;
  /**
   * Maintenance rebuild (Phase 2 notes-scaling): walks every note's real
   * body on Drive once and rewrites the persisted index + tag/link/task
   * indexes from scratch. See `GoogleDriveStore.rebuildIndexes` for the
   * mechanics. Interactive-only (no background mode) — this is a manual,
   * user-triggered action from the Settings page, not something autosave
   * ever calls.
   */
  rebuildIndexes: () => Promise<{ noteCount: number }>;
  /**
   * Returns `true` when the local workspace carries unsynced changes
   * relative to the last successful Drive load / save. Empty drafts
   * are normalised away before the comparison so a brand-new untouched
   * `+ Add` draft doesn't read as dirty (that note will never reach
   * Drive on its own).
   *
   * Consumed by the focus-refresh canRefresh gate to skip a refresh
   * that would otherwise apply Drive state on top of in-flight local
   * edits — see `app.ts` for the wiring.
   */
  isWorkspaceDirty: () => boolean;
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

  // Snapshot of the workspace we last successfully synced with Drive
  // (either pushed via save or pulled via load / restoreAfterSignIn).
  // The save path consults this before doing any work: if the current
  // workspace deep-equals the snapshot, the bytes on Drive are already
  // what we'd be pushing, so we skip the whole `runWorkspaceSave`
  // pulse — no Drive RTT, no "saving / idle" UI flicker, no
  // tag/link/task index rewrite.
  //
  // Why a single snapshot and not per-note tracking: the autosave path
  // pushes the entire workspace in one transaction (index file +
  // derived caches + head pointer), so the "is anything different?"
  // question is workspace-shaped, not note-shaped. A per-note
  // snapshot would let us skip individual note uploads inside
  // `GoogleDriveStore.saveWorkspace` — but that helper already has its
  // own per-note short-circuit keyed on `updatedAt`, and the outer
  // wrapper saves a much bigger pulse (the four index files) when it
  // bails entirely. Workspace-level is the cheaper coarse-grained
  // gate.
  //
  // Updated on: successful load, successful save, the initial load
  // leg of `restoreWorkspaceAfterSignIn`, and the post-merge save leg
  // of the same (when one was needed). Deliberately *not* updated on
  // refresh — the progressive merge produces a workspace that's a mix
  // of local edits and Drive-fetched notes, so it doesn't represent
  // "what's on Drive" in a way the save path can use as a baseline.
  let lastSyncedWorkspace: SutraPadWorkspace | null = null;

  // Ids of every note this session has confirmed to exist on Drive at
  // some point — populated from successful loads, saves, and the
  // fetched-bodies legs of progressive refreshes. Consumed by
  // `applyDriveRefresh`: a local note whose id is absent here cannot
  // have been deleted on another device (Drive has never seen it), so
  // refresh preserves it instead of dropping. Bug fix for the
  // visibility-refresh race where typing into a brand-new note during
  // the inventory-fetch window let the next phase merge stomp the
  // not-yet-synced draft + (via blur-on-render) the user's keystrokes
  // landed on the wrong note.
  const knownDriveIds = new Set<string>();
  const rememberDriveIds = (notes: readonly { id: string }[]): void => {
    for (const note of notes) knownDriveIds.add(note.id);
  };

  const loadRemoteWorkspaceAndMarkClean = async (): Promise<SutraPadWorkspace> => {
    const loaded = await withAuthRetry(
      () => getStore().loadWorkspace(),
      retryContext,
    );
    lastSyncedWorkspace = loaded;
    rememberDriveIds(loaded.notes);
    return loaded;
  };

  const loadWorkspace = (): Promise<void> =>
    runWorkspaceLoad({
      loadRemoteWorkspace: loadRemoteWorkspaceAndMarkClean,
      setWorkspace,
      persistLocalWorkspace,
      setSyncState,
      setLastError,
      render,
      cancelAutoSave,
    });

  // Phase 2 notes-scaling: fetches one note's real body on detail-open
  // (see `hydrateNoteOnOpen`). Interactive mode — the user is actively
  // waiting to see the note, unlike the background autosave path, so a
  // silent-refresh focus hiccup on a 401 is an acceptable trade for
  // actually showing their content. Folds the id into `knownDriveIds` like
  // every other successful Drive read: a placeholder can only exist because
  // `loadWorkspace` saw this note on Drive, so this isn't new information,
  // but keeping the bookkeeping uniform costs nothing.
  const fetchNoteBody = async (fileId: string): Promise<SutraPadDocument> => {
    const note = await withAuthRetry(
      () => getStore().fetchNoteByFileId(fileId),
      retryContext,
    );
    rememberDriveIds([note]);
    return note;
  };

  const restoreWorkspaceAfterSignIn = (): Promise<void> =>
    runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: loadRemoteWorkspaceAndMarkClean,
      // Note: `runWorkspaceRestoreAfterSignIn` only invokes
      // `saveRemoteWorkspace` when the merge produced changes versus
      // the just-loaded remote — so reaching this closure already
      // means we have new bytes to push.
      saveRemoteWorkspace: async (ws) => {
        await withAuthRetry(() => getStore().saveWorkspace(ws), retryContext);
        lastSyncedWorkspace = ws;
        rememberDriveIds(ws.notes);
      },
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
  const saveWorkspace = (mode: SaveMode = "interactive"): Promise<void> => {
    const toSave = stripEmptyDraftNotes(getWorkspace());

    // Clean-snapshot guard. If the workspace matches what we last
    // synced with Drive, there's nothing new to push — interactive
    // and background paths both bail at this point. Returning here
    // (rather than inside `runWorkspaceSave`) means no syncState
    // pulse, no cancelAutoSave call: the save attempt simply did not
    // happen. A future call after a real edit produces a different
    // workspace and the guard falls through.
    if (
      lastSyncedWorkspace !== null &&
      areWorkspacesEqual(lastSyncedWorkspace, toSave)
    ) {
      return Promise.resolve();
    }

    return runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(getWorkspace()),
      saveRemoteWorkspace: async () => {
        await withAuthRetry(
          () => getStore().saveWorkspace(toSave),
          {
            ...retryContext,
            mode,
          },
        );
        lastSyncedWorkspace = toSave;
        rememberDriveIds(toSave.notes);
      },
      setSyncState,
      setLastError,
      render,
      refreshStatus,
      cancelAutoSave,
    });
  };

  // Progressive refresh: Drive I/O is bound through `withAuthRetry`
  // (interactive mode — focus is a user-driven trigger, so a 401 should
  // attempt the silent-refresh path) and the existing render / sync-state
  // hooks. The orchestrator owns batching + merge order.
  const refreshWorkspace = (
    options: WorkspaceRefreshOptions = {},
  ): Promise<void> =>
    runWorkspaceRefresh(
      {
        loadInventory: async () => {
          const inventory = await withAuthRetry(
            () => getStore().loadNoteInventory(),
            retryContext,
          );
          // Every id Drive currently lists is confirmed to exist on
          // Drive. Folding them into the known-set widens the set
          // we use to distinguish "deleted on another device" from
          // "never pushed from this device" inside `applyDriveRefresh`.
          rememberDriveIds(inventory.map((entry) => ({ id: entry.noteId })));
          return inventory;
        },
        fetchNoteByFileId: async (fileId) => {
          const note = await withAuthRetry(
            () => getStore().fetchNoteByFileId(fileId),
            retryContext,
          );
          rememberDriveIds([note]);
          return note;
        },
        getKnownDriveIds: () => knownDriveIds,
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

  const importNotes = async (
    notes: SutraPadDocument[],
    options: { onProgress?: (progress: NoteImportProgress) => void } = {},
  ): Promise<NoteImportProgress> => {
    // Look up existing note files once so a re-import updates them in place
    // (upsert) rather than creating duplicate note-<id>.json files on Drive.
    const inventory = await withAuthRetry(
      () => getStore().loadNoteInventory(),
      retryContext,
    );
    const fileIdByNoteId = new Map(
      inventory.map((entry) => [entry.noteId, entry.fileId]),
    );
    const result = await runNoteImport({
      notes,
      appendNote: (note) =>
        withAuthRetry(
          () =>
            getStore().appendNoteToWorkspace(note, fileIdByNoteId.get(note.id)),
          retryContext,
        ),
      onProgress: options.onProgress,
    });
    // Reconcile: reload the folder view so the imported (app-owned) notes
    // appear and the clean-snapshot baseline includes them. Skipped when
    // nothing was uploaded so an empty/failed drop doesn't churn the load.
    if (result.done > 0) {
      await loadWorkspace();
    }
    return result;
  };

  // Interactive-only: a rebuild is a deliberate Settings-page action the
  // user is actively waiting on, not a background/autosave path — so a
  // 401 mid-rebuild is fine to resolve via the normal silent-refresh retry.
  const rebuildIndexes = (): Promise<{ noteCount: number }> =>
    withAuthRetry(() => getStore().rebuildIndexes(), retryContext);

  const isWorkspaceDirty = (): boolean => {
    if (lastSyncedWorkspace === null) return false;
    return !areWorkspacesEqual(
      lastSyncedWorkspace,
      stripEmptyDraftNotes(getWorkspace()),
    );
  };

  return {
    loadWorkspace,
    saveWorkspace,
    restoreWorkspaceAfterSignIn,
    fetchNoteBody,
    refreshWorkspace,
    importNotes,
    rebuildIndexes,
    isWorkspaceDirty,
  };
}
