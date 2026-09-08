/**
 * Focus / visibility refresh — "did another device change something while
 * this tab was in the background?"
 *
 * **Index-aware since 2026-09-08.** The previous orchestrator predated the
 * lazy-body model: it fetched every note JSON in the folder in batches of
 * five and committed + repainted after each batch. On a ~6 470-note
 * workspace that was ~1 300 batches, each serialising a multi-megabyte
 * workspace into localStorage and re-rendering — the 3–4.5 s long tasks
 * and the minutes-long "loading" pill the Diagnostics card surfaced on its
 * first day. It also silently re-hydrated the whole workspace into memory,
 * undoing Phase 2 on every tab switch.
 *
 * Now a refresh is one cheap `loadWorkspace` (folder inventory + index →
 * body-less placeholders, the same ≤ `LOAD_MAX_REQUESTS` round-trips a
 * cold start pays) merged into the live workspace by `applyDriveRefresh`:
 *
 *   - a note missing from Drive disappears locally (unless it is an empty
 *     draft or an id Drive has never seen — see `applyDriveRefresh`);
 *   - a note Drive holds a strictly newer copy of is replaced by its fresh
 *     placeholder — the body re-hydrates on open, exactly like after a
 *     cold load; the note currently on screen re-hydrates immediately
 *     because `hydrateNoteOnOpen` runs on every render;
 *   - a note the user is editing (local `updatedAt` ≥ remote) keeps its
 *     local copy, body included;
 *   - notes new on Drive appear as placeholders.
 *
 * Exactly one commit + render when anything changed, none otherwise. The
 * caller re-seeds the resident summary / task / link indexes when `changed`
 * is true, because a replaced placeholder's summary comes from the Drive
 * index, not from a body we no longer fetch.
 */
import { applyDriveRefresh } from "../../lib/notebook";
import type { SutraPadWorkspace } from "../../types";
import type { SyncState } from "./workspace-sync";

export interface WorkspaceRefreshEffects {
  /**
   * The cheap Drive read: `GoogleDriveStore.loadWorkspace` behind
   * `withAuthRetry`. Returns placeholders for indexed notes and hydrated
   * copies only for orphans the index does not know.
   */
  loadRemoteWorkspace: () => Promise<SutraPadWorkspace>;
  /**
   * Snapshot of ids the caller has confirmed to exist on Drive (from
   * prior loads, saves and refreshes). Threaded into `applyDriveRefresh`
   * so brand-new local notes that Drive has never seen aren't dropped as
   * "deleted on another device". Optional; when absent the orchestrator
   * falls back to an empty set, which preserves every local-only note.
   */
  getKnownDriveIds?: () => ReadonlySet<string>;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistLocalWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (state: SyncState) => void;
  setLastError: (message: string) => void;
  render: () => void;
  /**
   * Cancels any pending background autosave timer before the refresh
   * starts. Same reasoning as `runWorkspaceLoad`: a 2 s-old keystroke
   * timer would otherwise fire after the merge lands and stomp the
   * just-refreshed workspace back onto Drive. Optional so tests and
   * sign-out paths that never armed an autosave can leave it out.
   */
  cancelAutoSave?: () => void;
}

export interface WorkspaceRefreshResult {
  /** True when the merge changed the live workspace (and was committed). */
  changed: boolean;
}

export async function runWorkspaceRefresh(
  effects: WorkspaceRefreshEffects,
): Promise<WorkspaceRefreshResult> {
  try {
    effects.cancelAutoSave?.();
    effects.setSyncState("loading");
    effects.setLastError("");
    effects.render();

    const remote = await effects.loadRemoteWorkspace();

    // Re-read the live workspace *after* the await: a keystroke that landed
    // while the load was in flight must be part of the merge, not
    // overwritten by it.
    const local = effects.getWorkspace();
    const knownDriveIds = effects.getKnownDriveIds?.() ?? new Set<string>();
    const inventory = remote.notes.map((note) => ({ noteId: note.id }));
    const next = applyDriveRefresh(local, remote.notes, inventory, knownDriveIds);
    const changed = next !== local;
    if (changed) {
      effects.setWorkspace(next);
      effects.persistLocalWorkspace(next);
    }

    effects.setSyncState("idle");
    effects.render();
    return { changed };
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(
      error instanceof Error ? error.message : "Refreshing from Google Drive failed.",
    );
    effects.render();
    return { changed: false };
  }
}
