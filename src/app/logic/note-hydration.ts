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

/**
 * Swaps hydrated local notes back to Drive's placeholders wherever Drive
 * holds the same version (`updatedAt` matches) — the inverse of
 * `applyHydratedNote`, for the sign-in merge.
 *
 * `mergeWorkspaces` lets the local copy win a tie so an unsynced edit is
 * never lost; but a tie also means the body on disk *is* the body on
 * Drive, and keeping thousands of them resident defeats the lazy-body
 * model: every workspace change re-derives their summaries and every
 * persist serialises them. A localStorage workspace left fully hydrated
 * (the pre-2026-09-08 refresh did exactly that) would otherwise stay
 * fully hydrated for every later session. Notes in `keepHydrated` — the
 * active one, so the editor doesn't flash "Loading…" — keep their body.
 * Notes with no remote twin, or with a different stamp (a local edit not
 * yet pushed), are untouched.
 */
export function adoptRemotePlaceholders(
  workspace: SutraPadWorkspace,
  remote: SutraPadWorkspace,
  keepHydrated: ReadonlySet<string>,
): SutraPadWorkspace {
  const remoteById = new Map(remote.notes.map((note) => [note.id, note]));
  let changed = false;
  const notes = workspace.notes.map((note) => {
    if (note.hydrated === false || keepHydrated.has(note.id)) return note;
    const twin = remoteById.get(note.id);
    if (!twin || twin.hydrated !== false || twin.updatedAt !== note.updatedAt) return note;
    changed = true;
    return twin;
  });
  return changed ? { ...workspace, notes } : workspace;
}
