/**
 * Progressive cross-device refresh from Google Drive.
 *
 * Why this exists separate from `runWorkspaceLoad`:
 *
 * `loadWorkspace` is one big blocking fetch — folder lookup, then
 * `Promise.all` over every note JSON. Until the slowest note JSON
 * resolves the UI shows nothing new, which is what users feel as
 * "stale Notes count after I open SutraPad on the other device" and
 * "the load takes ages". For a focus-driven refresh we want:
 *
 *   1. The count (and any notes deleted on another device) to update
 *      immediately — a single folder-query RTT is enough.
 *   2. The newest few notes to arrive as a priority batch so the user
 *      sees the freshly captured note from the other device first.
 *   3. The remaining notes to catch up in background batches without
 *      blocking the UI.
 *
 * This orchestrator drives those three phases and merges each batch
 * back into the live workspace through `applyDriveRefresh`. Local
 * unsaved edits survive because the merge prefers the side with the
 * strictly larger `updatedAt` — the user typing in Device B keeps
 * bumping the local note past anything Drive captured before the
 * edit, and the merge picks local for that id.
 *
 * Pure orchestration, no Drive SDK or DOM. The effects bag isolates
 * Drive I/O behind two callbacks so tests can drive it without
 * stubbing the HTTP layer.
 */

import { applyDriveRefresh } from "../../lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";
import type { SyncState } from "./workspace-sync";

/**
 * Folder-query metadata for a single Drive note file. `noteId` is the
 * user-facing identifier (from the file's appProperties), `fileId` is
 * the Drive-side handle the orchestrator hands to `fetchNoteByFileId`
 * to retrieve the JSON body, and `modifiedTime` is Drive's
 * server-stamped revision time used to order the priority batch
 * newest-first. Kept here (rather than in `types.ts`) so the type
 * stays scoped to the refresh flow that owns it.
 */
export interface DriveNoteInventoryEntry {
  noteId: string;
  fileId: string;
  modifiedTime: string;
}

export interface WorkspaceRefreshEffects {
  loadInventory: () => Promise<DriveNoteInventoryEntry[]>;
  fetchNoteByFileId: (fileId: string) => Promise<SutraPadDocument>;
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

export interface WorkspaceRefreshOptions {
  /**
   * How many notes the priority (Phase 2) batch fetches in parallel.
   * Tuned for the cross-device wake-up case: the user typically cares
   * about the handful of notes they just captured on the other
   * device, and those are the ones at the top of the modifiedTime
   * order. Default 5.
   */
  firstBatchSize?: number;
  /**
   * Catch-up (Phase 3) batch size. Smaller than `firstBatchSize` would
   * starve the foreground; larger would fan out enough parallel
   * fetches to wedge mobile Safari's connection pool. Default 5.
   */
  batchSize?: number;
}

const DEFAULT_FIRST_BATCH_SIZE = 5;
const DEFAULT_BATCH_SIZE = 5;

/**
 * Runs the three-phase progressive refresh. Resolves once every note
 * in the inventory has been fetched and merged (or once a phase
 * fails, which transitions sync state to `"error"` and surfaces the
 * message).
 *
 * Phase 1 — inventory. A single folder query. The result is applied
 * immediately with an empty `fetchedNotes` set: any local note whose
 * id is no longer in the inventory disappears. New ids in the
 * inventory wait for Phase 2 to surface (we don't have a JSON to
 * apply for them yet). Render fires only when the inventory actually
 * changed something, so the steady-state no-op refresh doesn't burn
 * a render.
 *
 * Phase 2 — priority batch. Inventory entries are sorted newest-first
 * by `modifiedTime`; the top `firstBatchSize` JSONs are fetched in
 * parallel and merged in. The render after this batch is the one the
 * user sees as "the new note showed up".
 *
 * Phase 3 — catch-up. The remaining ids are fetched in `batchSize`
 * chunks, each merged + rendered as it lands. The merge always reads
 * the *latest* local workspace via `getWorkspace()`, so a keystroke
 * that bumped a note's `updatedAt` mid-refresh keeps its in-flight
 * value (per the merge rule in `applyDriveRefresh`).
 */
export async function runWorkspaceRefresh(
  effects: WorkspaceRefreshEffects,
  options: WorkspaceRefreshOptions = {},
): Promise<void> {
  const firstBatchSize = options.firstBatchSize ?? DEFAULT_FIRST_BATCH_SIZE;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  try {
    effects.cancelAutoSave?.();
    effects.setSyncState("loading");
    effects.setLastError("");
    effects.render();

    const inventory = await effects.loadInventory();

    // Phase 1: apply the inventory with no fetched bodies. Any
    // local note whose id is absent from the inventory disappears
    // immediately — the deletion case ("Device A deleted a note,
    // Device B comes back") updates the count before any JSON is
    // fetched. The addition case (Device A *created* a note) still
    // has to wait for Phase 2 to know the new note's body, since
    // Phase 1 doesn't have a JSON to apply for the new id.
    applyAndCommit(effects, [], inventory);

    // Phase 2 + 3: fetch JSONs newest-first in batches. `toSorted`
    // produces a stable order against `localeCompare` so ties (same
    // exact modifiedTime, possible with multi-file saves) don't shuffle
    // run-to-run.
    const orderedEntries = [...inventory].toSorted(
      (left, right) => right.modifiedTime.localeCompare(left.modifiedTime),
    );

    let cursor = 0;
    let isFirstBatch = true;
    while (cursor < orderedEntries.length) {
      const currentSize = isFirstBatch ? firstBatchSize : batchSize;
      const slice = orderedEntries.slice(cursor, cursor + currentSize);
      // Sequential await across batches is intentional: each batch
      // commits + renders before the next one starts, so the user
      // sees the priority batch on screen *before* we kick off the
      // catch-up RTTs. Parallel-everything would defeat the whole
      // progressive-render premise of this orchestrator.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const fetched = await Promise.all(
        slice.map(async (entry) => effects.fetchNoteByFileId(entry.fileId)),
      );

      applyAndCommit(effects, fetched, inventory);

      cursor += currentSize;
      isFirstBatch = false;
    }

    effects.setSyncState("idle");
    effects.render();
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(
      error instanceof Error ? error.message : "Refreshing from Google Drive failed.",
    );
    effects.render();
  }
}

/**
 * Re-reads the current local workspace, merges the fetched batch
 * against the canonical inventory, and commits only when the merge
 * produced an actual change. Skipping the render on a no-op keeps
 * Phase 1's "everything already in sync" path zero-cost — common when
 * the user just toggles away and back to the tab in a few seconds.
 *
 * Returns the merged workspace so callers (and tests) can inspect the
 * post-merge state without re-reading the store.
 */
function applyAndCommit(
  effects: WorkspaceRefreshEffects,
  fetched: readonly SutraPadDocument[],
  inventory: readonly DriveNoteInventoryEntry[],
): SutraPadWorkspace {
  const local = effects.getWorkspace();
  const next = applyDriveRefresh(local, fetched, inventory);
  if (next === local) return local;
  effects.setWorkspace(next);
  effects.persistLocalWorkspace(next);
  effects.render();
  return next;
}
