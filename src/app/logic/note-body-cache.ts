/**
 * Bounded LRU cache of hydrated note documents (Phase 2, step 3d-ii).
 *
 * Once `loadWorkspace` stops holding every note body in memory, opening a note
 * detail hydrates its body on demand via `store.fetchNoteByFileId`. This cache
 * keeps the handful of most-recently-opened bodies around so flipping between
 * a note, its links, and back doesn't re-fetch — while an upper bound stops the
 * resident set from creeping back to "every body in memory", which is the whole
 * thing Phase 2 set out to avoid.
 *
 * LRU semantics: both `get` (a read) and `set` (a write) mark an entry as most
 * recently used; when the cache is over capacity the least-recently-used entry
 * is evicted. Backed by a `Map`, whose iteration order is insertion order —
 * deleting + re-inserting on touch keeps the oldest key at `keys().next()`.
 */
import type { SutraPadDocument } from "../../types";

/** Default resident-body ceiling. Small: detail viewing is one-at-a-time. */
export const DEFAULT_NOTE_BODY_CACHE_CAPACITY = 50;

export interface NoteBodyCache {
  /** Returns the cached body and marks it most-recently-used, else undefined. */
  get(noteId: string): SutraPadDocument | undefined;
  /** Inserts / refreshes a body, evicting the LRU entry when over capacity. */
  set(noteId: string, note: SutraPadDocument): void;
  /** Membership test that does NOT change recency. */
  has(noteId: string): boolean;
  /** Drops an entry (e.g. after an edit invalidates the cached body). */
  delete(noteId: string): void;
  /** Current number of resident bodies. */
  readonly size: number;
}

export function createNoteBodyCache(
  capacity: number = DEFAULT_NOTE_BODY_CACHE_CAPACITY,
): NoteBodyCache {
  // A capacity below 1 would evict every entry immediately, making the cache a
  // no-op; clamp so the cache always holds at least the note being viewed.
  const cap = Math.max(1, Math.floor(capacity));
  const entries = new Map<string, SutraPadDocument>();

  return {
    get(noteId) {
      const note = entries.get(noteId);
      if (note === undefined) return undefined;
      // Touch: move to the most-recently-used end.
      entries.delete(noteId);
      entries.set(noteId, note);
      return note;
    },
    set(noteId, note) {
      // Delete-then-set so an existing key moves to the MRU end rather than
      // keeping its old position.
      entries.delete(noteId);
      entries.set(noteId, note);
      while (entries.size > cap) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    has(noteId) {
      return entries.has(noteId);
    },
    delete(noteId) {
      entries.delete(noteId);
    },
    get size() {
      return entries.size;
    },
  };
}
