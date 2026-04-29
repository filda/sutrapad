/**
 * "+ Add" / `N` handler — creates a draft note, optionally backfills
 * its title + location + capture-context after async geolocation
 * resolves, and re-renders the app via a focus-preserving pass so the
 * patch lands in the DOM without yanking the user's caret out of the
 * fresh body / title input.
 *
 * Lifted out of `app.ts` so the wiring layer there can pass the
 * store getters/setters in via `NewNoteHandlerOptions` rather than
 * keeping the inline closure around. The inner async backfill
 * preserves its existing race-safety: if the user navigates away
 * (workspace mutated, draft purged) before geolocation resolves, the
 * patch quietly drops on the floor.
 */
import { applyFreshNoteDetails } from "../capture/apply-fresh-note-details";
import { generateFreshNoteDetails } from "../capture/fresh-note";
import {
  isLocationCaptureEnabled,
  type CaptureLocationPreference,
} from "../logic/capture-location";
import {
  createNewNoteWorkspace,
  isEmptyDraftNote,
  upsertNote,
} from "../../lib/notebook";
import type { SutraPadWorkspace } from "../../types";
import type { MenuItemId } from "../logic/menu";
import type { SyncState } from "../session/workspace-sync";

export interface NewNoteHandlerOptions {
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  setDetailNoteId: (detailNoteId: string | null) => void;
  setActiveMenuItem: (menuItemId: MenuItemId) => void;
  setSyncState: (syncState: SyncState) => void;
  setLastError: (lastError: string) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  scheduleAutoSave: () => void;
  /**
   * Synchronously re-renders the app while preserving focus + caret
   * on whichever editor input (title / body / tag typeahead) is
   * active. Called from the post-geolocation backfill so the patch
   * (title, location, captureContext) lands in the DOM in one focus-
   * safe pass — the alternative (letting the atom subscriber fire its
   * own microtask render via `setWorkspace`) replaces the textarea
   * the user is mid-word in and drops focus, which is the bug we
   * actively guard against here.
   */
  rerenderPreservingActiveEditorFocus: () => void;
  /**
   * Reads the live capture-location preference. Called at the moment
   * the async backfill kicks off (not at handler-construction time)
   * so toggling the Settings switch takes effect on the very next
   * `+ Add`. When `"off"`, the geolocation prompt is suppressed —
   * `generateFreshNoteDetails` is run with a no-op coordinates
   * resolver so the rest of the title / capture-context backfill
   * still happens, just without a place label.
   */
  getCaptureLocationPreference: () => CaptureLocationPreference;
}

export function handleNewNoteCreation({
  getWorkspace,
  setWorkspace,
  setDetailNoteId,
  setActiveMenuItem,
  setSyncState,
  setLastError,
  persistWorkspace,
  scheduleAutoSave,
  rerenderPreservingActiveEditorFocus,
  getCaptureLocationPreference,
}: NewNoteHandlerOptions): void {
  const nextWorkspace = createNewNoteWorkspace(getWorkspace());
  persistWorkspace(nextWorkspace);
  setWorkspace(nextWorkspace);
  const newNoteId = nextWorkspace.activeNoteId;
  setDetailNoteId(newNoteId ?? null);
  setActiveMenuItem("notes");
  setSyncState("idle");
  setLastError("");
  if (!newNoteId) return;

  // Read the preference now (rather than on every coords call) so a
  // race-y mid-flight toggle doesn't half-fire one prompt and skip
  // another inside the same backfill. The async closure below sees
  // a stable snapshot.
  const locationCaptureEnabled = isLocationCaptureEnabled(
    getCaptureLocationPreference(),
  );

  void (async () => {
    let details: Awaited<ReturnType<typeof generateFreshNoteDetails>>;
    try {
      details = locationCaptureEnabled
        ? await generateFreshNoteDetails()
        : // Suppress the geolocation prompt entirely by replacing the
          // coords resolver with a `null` returner. `generateFreshNoteDetails`
          // already handles that path: no coords → no reverse-geocode →
          // no `location` field → captureContext built without coordinates.
          // The note still gets a prettified time-of-day title, just no
          // place label.
          await generateFreshNoteDetails(undefined, async () => null);
    } catch (error) {
      // Geolocation / reverse-geocoding / capture-context probes can
      // all reject (denied permission, network, AbortController
      // abort). The new note keeps its placeholder title and lives on
      // — log so the silent skip is at least visible in devtools.
      console.warn("Fresh note detail backfill failed:", error);
      return;
    }

    const latestWorkspace = getWorkspace();
    const currentNote = latestWorkspace.notes.find((note) => note.id === newNoteId);
    if (!currentNote) return;
    // Always let the cosmetic title/location/captureContext backfill run
    // — the prettified "Úterý odpoledne v Praze" title is a feature, and
    // local persist keeps it around so a mid-compose refresh still shows
    // the nice label. What we *don't* do is schedule a Drive push: an
    // empty draft (no body, no user tags) has no business arriving on
    // Drive just because geolocation resolved two seconds after the
    // click. The nav-away purge evicts the note locally if the user
    // walks away, and `saveRemoteWorkspace` also strips empty drafts
    // before push as a belt-and-braces guard.
    const patchedNote = applyFreshNoteDetails(currentNote, details);
    if (patchedNote === currentNote) return;

    const patchedWorkspace = upsertNote(latestWorkspace, newNoteId, () => patchedNote);
    setWorkspace(patchedWorkspace);
    persistWorkspace(patchedWorkspace);
    if (!isEmptyDraftNote(patchedNote)) {
      scheduleAutoSave();
    }

    // Earlier shape called `setWorkspace` (which schedules a microtask
    // render via the atom subscriber chain) and then patched the title /
    // metadata in place to keep the DOM in sync until that render
    // landed. Problem: the queued render still fires on the microtask,
    // rebuilds the editor card, and drops focus from whatever input
    // the user is mid-keystroke in — which the user experiences as
    // "fresh note loses focus right after I start typing". We now
    // drive a focus-preserving render synchronously here instead. The
    // explicit render flips `renderScheduled` back to false in its
    // `finally`, so the queued microtask sees nothing to do and skips,
    // leaving the user's caret untouched.
    //
    // The render rebuilds the notes-panel as well, so the previously
    // appended `refreshNotesPanel()` call is no longer needed — it
    // would just replay the same work on the freshly rendered DOM.
    rerenderPreservingActiveEditorFocus();
  })();
}
