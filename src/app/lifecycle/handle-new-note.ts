/**
 * "+ Add" / `N` handler — creates a draft note, optionally backfills
 * its title + location + capture-context after async geolocation
 * resolves, and refreshes the notes panel in place.
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
import { buildNoteMetadata } from "../logic/note-metadata";
import {
  createNewNoteWorkspace,
  DEFAULT_NOTE_TITLE,
  isEmptyDraftNote,
  upsertNote,
} from "../../lib/notebook";
import type { SutraPadWorkspace } from "../../types";
import type { MenuItemId } from "../logic/menu";
import type { SyncState } from "../session/workspace-sync";

export interface NewNoteHandlerOptions {
  root: HTMLElement;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  getDetailNoteId: () => string | null;
  setDetailNoteId: (detailNoteId: string | null) => void;
  setActiveMenuItem: (menuItemId: MenuItemId) => void;
  setSyncState: (syncState: SyncState) => void;
  setLastError: (lastError: string) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  scheduleAutoSave: () => void;
  refreshNotesPanel: () => void;
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
  root,
  getWorkspace,
  setWorkspace,
  getDetailNoteId,
  setDetailNoteId,
  setActiveMenuItem,
  setSyncState,
  setLastError,
  persistWorkspace,
  scheduleAutoSave,
  refreshNotesPanel,
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

    if (getDetailNoteId() === newNoteId) {
      const titleInput = root.querySelector<HTMLInputElement>(".title-input");
      if (
        titleInput &&
        titleInput.value === DEFAULT_NOTE_TITLE &&
        document.activeElement !== titleInput
      ) {
        titleInput.value = patchedNote.title;
      }
      const metadataEl = root.querySelector(".note-metadata");
      if (metadataEl) metadataEl.textContent = buildNoteMetadata(patchedNote);
    }
    refreshNotesPanel();
  })();
}
