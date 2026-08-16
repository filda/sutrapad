/**
 * Hydration primitive for body-less placeholder notes (Phase 2 notes-scaling).
 *
 * `loadWorkspace` populates `workspace.notes` from the Drive index without
 * fetching bodies (see `src/services/drive/workspace-store.ts`), so most
 * resident notes start as a placeholder — `buildPlaceholderNote` in
 * `lib/note-card-meta.ts`, stamped with `hydrated: false`. Opening a note's
 * detail view fetches its real body once (`store.fetchNoteByFileId`, cached
 * via `createNoteBodyCache`) and `applyHydratedNote` writes the result back
 * onto the workspace.
 *
 * This is deliberately separate from `upsertNote` (`lib/notebook.ts`):
 * hydrating is not a user edit — it must not bump `updatedAt`, must not run
 * through the no-op guards, and unlike `upsertNote` it is exactly the one
 * operation allowed to write into a `hydrated: false` note. `upsertNote`'s
 * own guard (refusing to commit against a placeholder) is the other half of
 * the data-loss safety invariant; see its doc comment.
 */
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";

/**
 * Replaces the placeholder for `noteId` with its real, fetched body.
 *
 * No-ops (returns `workspace` unchanged, same reference) when:
 *   - the note is gone — deleted, or a refresh dropped it while the fetch
 *     was in flight;
 *   - the note is already hydrated — a second hydration racing behind the
 *     first (e.g. the user reopened the note before the first fetch
 *     resolved) must not clobber whatever the first one already put there.
 *
 * `activeNoteId` and every other note are left untouched; `updatedAt` is
 * whatever the fetched document already carries (hydrating never mints a
 * new one — it's not an edit).
 */
export function applyHydratedNote(
  workspace: SutraPadWorkspace,
  noteId: string,
  hydratedNote: SutraPadDocument,
): SutraPadWorkspace {
  const current = workspace.notes.find((note) => note.id === noteId);
  if (!current || current.hydrated !== false) {
    return workspace;
  }

  return {
    ...workspace,
    notes: workspace.notes.map((note) =>
      note.id === noteId ? { ...hydratedNote, hydrated: true } : note,
    ),
  };
}
