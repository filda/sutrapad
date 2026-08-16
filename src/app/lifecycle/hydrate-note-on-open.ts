/**
 * Hydrates a placeholder note's body the first time its detail view is
 * rendered (Phase 2 notes-scaling).
 *
 * `loadWorkspace` seeds `workspace.notes` with body-less placeholders
 * (`hydrated: false`, see `SutraPadDocument`) read straight from the Drive
 * index — no body fetch on load. The first time the user actually looks at
 * one, this fetches the real body once (`fetchNoteBody`, backed by
 * `GoogleDriveStore.fetchNoteByFileId`) and applies it back onto the
 * workspace via `applyHydratedNote`. The fetched body is also cached in the
 * resident `NoteBodyCache` so flipping between the note, its links, and
 * back doesn't re-fetch — and so a note that's still cached from an earlier
 * open (LRU hasn't evicted it) applies synchronously with no fetch at all.
 *
 * Fire-and-forget, triggered from `render()` whenever the displayed note is
 * still a placeholder. `inFlight` dedupes: `render()` runs on every state
 * change, so without it a note sitting in view while some unrelated atom
 * changes would fire a duplicate fetch on every render until the first one
 * resolves.
 */
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";
import type { NoteBodyCache } from "../logic/note-body-cache";
import { applyHydratedNote } from "../logic/note-hydration";

export interface HydrateNoteOnOpenOptions {
  /** The note currently displayed in the detail/editor view. */
  note: SutraPadDocument;
  bodyCache: NoteBodyCache;
  /** Note ids with a fetch currently in flight; mutated in place. */
  inFlight: Set<string>;
  fetchNoteBody: (fileId: string) => Promise<SutraPadDocument>;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  /** Re-renders once hydration lands (or fails) so the loading state clears. */
  render: () => void;
}

/**
 * No-ops immediately (no state read, no fetch) when `note` is already
 * hydrated or a fetch for it is already in flight — safe to call on every
 * render without extra guards at the call site.
 */
export function hydrateNoteOnOpen(options: HydrateNoteOnOpenOptions): void {
  const {
    note,
    bodyCache,
    inFlight,
    fetchNoteBody,
    getWorkspace,
    setWorkspace,
    persistWorkspace,
    render,
  } = options;

  if (note.hydrated !== false || inFlight.has(note.id)) {
    return;
  }

  const cached = bodyCache.get(note.id);
  if (cached) {
    // Still resident from an earlier open — apply synchronously, no fetch.
    const next = applyHydratedNote(getWorkspace(), note.id, cached);
    if (next !== getWorkspace()) {
      setWorkspace(next);
      persistWorkspace(next);
      render();
    }
    return;
  }

  const fileId = note.fileId;
  if (!fileId) {
    // No fileId to fetch from — a placeholder built from a pre-Phase-2
    // index entry the maintenance rebuild hasn't backfilled yet. Nothing
    // to do until then.
    return;
  }

  inFlight.add(note.id);
  // async/await (not a .then/.catch/.finally chain) — matches the
  // fire-and-forget pattern used elsewhere (e.g. `onSignIn` in
  // render-callbacks.ts) and sidesteps the `promise/no-callback-in-promise`
  // + `promise/always-return` lint rules a chained version tripped here.
  void (async () => {
    try {
      const hydrated = await fetchNoteBody(fileId);
      bodyCache.set(note.id, hydrated);
      const next = applyHydratedNote(getWorkspace(), note.id, hydrated);
      if (next !== getWorkspace()) {
        setWorkspace(next);
        persistWorkspace(next);
      }
    } catch (error) {
      console.warn("Failed to hydrate note body:", error);
    } finally {
      inFlight.delete(note.id);
      render();
    }
  })();
}
