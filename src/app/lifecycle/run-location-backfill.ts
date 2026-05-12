/**
 * Second-chance location backfill. Used after the user resolves the
 * consent card with "Allow" on a draft that was already created with
 * the no-location title (`"5/12/2026 · afternoon"`). The note's title
 * and capture-context are intact; this helper only fills the missing
 * `location` + `coordinates` slots, never rewrites the title.
 *
 * The title is intentionally left alone — `applyFreshNoteDetails`
 * gates a title overwrite on the existing title still being
 * `DEFAULT_NOTE_TITLE`, which it isn't any more after the first
 * backfill. So this helper just produces fresh details and lets
 * `applyFreshNoteDetails` do the right thing (no-op on title, fill on
 * location / coordinates). The metadata strip in the editor card
 * picks up the new location string on the next render.
 *
 * Status return values let the consent card decide what to do next:
 *
 *   - `"filled"`           — coordinates resolved, location patched
 *                            on the note (or the note didn't need a
 *                            patch because it already carried both
 *                            slots).
 *   - `"no-coords"`        — geolocation returned `null` (timeout,
 *                            unavailable). The consent card resets
 *                            to its idle state so the user can try
 *                            again.
 *   - `"draft-missing"`    — the active draft is gone (purged because
 *                            the user navigated away). Nothing to
 *                            patch.
 */
import {
  applyFreshNoteDetails,
  type FreshNoteDetails,
} from "../capture/apply-fresh-note-details";
import { generateFreshNoteDetails } from "../capture/fresh-note";
import { upsertNote } from "../../lib/notebook";
import type { SutraPadWorkspace } from "../../types";

export type LocationBackfillStatus =
  | "filled"
  | "no-coords"
  | "draft-missing";

export interface RunLocationBackfillOptions {
  noteId: string;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  scheduleAutoSave: () => void;
  /**
   * Synchronously re-renders the app preserving focus + caret. Same
   * contract `handleNewNoteCreation` uses so the editor card update
   * doesn't steal focus from whatever the user is typing in.
   */
  rerenderPreservingActiveEditorFocus: () => void;
  /**
   * Injected details producer. Defaults to `generateFreshNoteDetails`
   * with its own defaults (real geolocation, real reverse-geocode,
   * real capture-context builder). Tests inject a mock so the
   * resolver chain doesn't need `document` / `window` shims for the
   * capture-context branch.
   */
  generateDetails?: () => Promise<FreshNoteDetails>;
}

/**
 * Resolves the location for an existing draft and patches the
 * workspace. Never throws — failures surface via the status return so
 * the consent card UI can react.
 */
export async function runLocationBackfill({
  noteId,
  getWorkspace,
  setWorkspace,
  persistWorkspace,
  scheduleAutoSave,
  rerenderPreservingActiveEditorFocus,
  generateDetails = () => generateFreshNoteDetails(),
}: RunLocationBackfillOptions): Promise<LocationBackfillStatus> {
  let details: FreshNoteDetails;
  try {
    details = await generateDetails();
  } catch (error) {
    // `generateFreshNoteDetails` shouldn't throw under the normal
    // coordinates resolver (each leg has its own try/catch). A throw
    // here means something genuinely unexpected; surface as
    // `"no-coords"` so the card resets and the user can retry.
    console.warn("Location backfill failed:", error);
    return "no-coords";
  }

  if (!details.coordinates) {
    // Geolocation resolved with `null` — timeout, unavailable, or the
    // browser silently denied (we already pre-checked permission in
    // the consent card, but transient denials are still possible).
    return "no-coords";
  }

  const latestWorkspace = getWorkspace();
  const currentNote = latestWorkspace.notes.find((note) => note.id === noteId);
  if (!currentNote) {
    return "draft-missing";
  }

  const patchedNote = applyFreshNoteDetails(currentNote, details);
  // `applyFreshNoteDetails` returns the original reference when there's
  // nothing to fill — e.g. the user navigated away from the draft and
  // back, or the title backfill from `+ Add` already populated
  // everything. Either way nothing to do; report `"filled"` because
  // the slot is already in the desired state.
  if (patchedNote === currentNote) {
    return "filled";
  }

  const patchedWorkspace = upsertNote(
    latestWorkspace,
    noteId,
    () => patchedNote,
  );
  setWorkspace(patchedWorkspace);
  persistWorkspace(patchedWorkspace);
  scheduleAutoSave();
  rerenderPreservingActiveEditorFocus();
  return "filled";
}
