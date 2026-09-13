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
 *
 * `attempts` is the circuit breaker. Because `render()` re-triggers this
 * for as long as the displayed note is a placeholder, any hydration that
 * does not "stick" — the fetch fails every time, the body cannot be applied,
 * the commit is undone by something else — becomes fetch → render → fetch
 * forever, with no error on the console and a page that never paints
 * (production, 2026-09-13). After `HYDRATE_MAX_ATTEMPTS_PER_NOTE` tries the
 * note is left as a placeholder and a single `[hydrate]` warning names the
 * note, the attempt count and the last outcome.
 */
import { HYDRATE_MAX_ATTEMPTS_PER_NOTE } from "../../lib/budgets";
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";
import type { NoteBodyCache } from "../logic/note-body-cache";
import { applyHydratedNote } from "../logic/note-hydration";

export interface HydrateNoteOnOpenOptions {
  /** The note currently displayed in the detail/editor view. */
  note: SutraPadDocument;
  bodyCache: NoteBodyCache;
  /** Note ids with a fetch currently in flight; mutated in place. */
  inFlight: Set<string>;
  /**
   * Hydration attempts per note id for the whole app session; mutated in
   * place. Once a note reaches `HYDRATE_MAX_ATTEMPTS_PER_NOTE` it is never
   * fetched again this session.
   */
  attempts: Map<string, number>;
  fetchNoteBody: (fileId: string) => Promise<SutraPadDocument>;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  /** Re-renders once hydration lands (or fails) so the loading state clears. */
  render: () => void;
}

/**
 * Why `applyHydratedNote` left the workspace untouched — the one piece of
 * information the breaker warning needs to make the next incident a
 * one-look diagnosis instead of a guess.
 */
export function explainHydrationNoop(
  workspace: SutraPadWorkspace,
  noteId: string,
  hydrated: SutraPadDocument,
): string {
  const current = workspace.notes.find((note) => note.id === noteId);
  if (!current) return "note is no longer in the workspace";
  if (current.hydrated !== false) return "note is already hydrated in the workspace";
  if (hydrated.id !== noteId) return `fetched body carries a different id (${hydrated.id})`;
  return "unknown";
}

/**
 * No-ops immediately (no state read, no fetch) when `note` is already
 * hydrated, a fetch for it is already in flight, or the breaker has
 * tripped for it — safe to call on every render without extra guards at
 * the call site.
 */
export function hydrateNoteOnOpen(options: HydrateNoteOnOpenOptions): void {
  const {
    note,
    bodyCache,
    inFlight,
    attempts,
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

  const tried = attempts.get(note.id) ?? 0;
  if (tried >= HYDRATE_MAX_ATTEMPTS_PER_NOTE) {
    // Breaker tripped. Warn exactly once — the warning is the diagnosis;
    // repeating it on every render would just bury it.
    if (tried === HYDRATE_MAX_ATTEMPTS_PER_NOTE) {
      attempts.set(note.id, tried + 1);
      console.warn(
        `[hydrate] giving up on note ${note.id} (file ${fileId}) after ${tried} attempts — leaving it as a placeholder`,
      );
    }
    return;
  }
  attempts.set(note.id, tried + 1);

  inFlight.add(note.id);
  // async/await (not a .then/.catch/.finally chain) — matches the
  // fire-and-forget pattern used elsewhere (e.g. `onSignIn` in
  // render-callbacks.ts) and sidesteps the `promise/no-callback-in-promise`
  // + `promise/always-return` lint rules a chained version tripped here.
  void (async () => {
    try {
      const hydrated = await fetchNoteBody(fileId);
      bodyCache.set(note.id, hydrated);
      const before = getWorkspace();
      const next = applyHydratedNote(before, note.id, hydrated);
      if (next === before) {
        console.warn(
          `[hydrate] note ${note.id} attempt ${tried + 1}: body fetched but not applied — ${explainHydrationNoop(before, note.id, hydrated)}`,
        );
      } else {
        setWorkspace(next);
        persistWorkspace(next);
        // Trust the commit only once it is observable: the counter resets
        // when the workspace really holds the hydrated note, so a commit
        // that keeps getting undone still trips the breaker.
        const stuck = getWorkspace().notes.find((candidate) => candidate.id === note.id);
        if (stuck?.hydrated === true) {
          attempts.delete(note.id);
        } else {
          console.warn(
            `[hydrate] note ${note.id} attempt ${tried + 1}: body applied but the workspace commit did not stick`,
          );
        }
      }
    } catch (error) {
      console.warn(`[hydrate] note ${note.id} attempt ${tried + 1} failed:`, error);
    } finally {
      inFlight.delete(note.id);
      render();
    }
  })();
}
