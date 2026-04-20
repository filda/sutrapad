import { DEFAULT_NOTE_TITLE } from "../../lib/notebook";
import type { SutraPadCoordinates, SutraPadDocument } from "../../types";

/**
 * Shape of the auto-resolved "fresh note" details we try to backfill on a
 * blank new note: a geocoded title, a human-readable location string, the raw
 * coordinates, and the capture-context snapshot (time-of-day, device, …).
 *
 * Mirrors the return type of `generateFreshNoteDetails`; kept intentionally
 * narrow so the merge helper has no transitive dependency on the URL/capture
 * module.
 */
export interface FreshNoteDetails {
  title: string;
  location?: string;
  coordinates?: SutraPadCoordinates;
  captureContext?: SutraPadDocument["captureContext"];
}

/**
 * Returns a copy of `note` with auto-resolved metadata merged in — but *only*
 * for fields the user has not already set. This keeps the async "after the
 * editor has opened" backfill from clobbering anything the user typed or a
 * previous capture flow set.
 *
 * Rules:
 *  - `title` is replaced only while it is still the placeholder default
 *    (`DEFAULT_NOTE_TITLE`). As soon as the user edits the title — even to an
 *    empty string — the auto title is no longer applied.
 *  - `location`, `coordinates`, and `captureContext` are filled in only when
 *    the note does not have them yet. They are not user-editable via the
 *    current editor UI, so "user hasn't set it" collapses to "it's empty".
 *
 * When there is nothing to change, the original `note` reference is returned
 * unchanged so callers can cheaply detect the no-op via identity.
 */
export function applyFreshNoteDetails(
  note: SutraPadDocument,
  details: FreshNoteDetails,
): SutraPadDocument {
  const shouldFillTitle =
    note.title === DEFAULT_NOTE_TITLE && details.title !== DEFAULT_NOTE_TITLE;
  const shouldFillLocation = !note.location && details.location !== undefined;
  const shouldFillCoordinates = !note.coordinates && details.coordinates !== undefined;
  const shouldFillCaptureContext =
    !note.captureContext && details.captureContext !== undefined;

  if (
    !shouldFillTitle &&
    !shouldFillLocation &&
    !shouldFillCoordinates &&
    !shouldFillCaptureContext
  ) {
    return note;
  }

  return {
    ...note,
    title: shouldFillTitle ? details.title : note.title,
    location: shouldFillLocation ? details.location : note.location,
    coordinates: shouldFillCoordinates ? details.coordinates : note.coordinates,
    captureContext: shouldFillCaptureContext
      ? details.captureContext
      : note.captureContext,
  };
}
