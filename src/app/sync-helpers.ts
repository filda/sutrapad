/**
 * Shared sync / selection helpers for the SutraPad app shell.
 *
 * Lifted out of `app.ts` so render-callback handlers,
 * `wirePaletteAccess` selection logic, and the per-frame `render()`
 * loop can all reach the same single source of truth without a
 * cyclic import. Every helper is pure and DOM-free except the four
 * `sync*ToLocation` writers, which need to call
 * `window.history.replaceState`.
 */
import { filterNotesByTags } from "../lib/notebook";
import { resolveDisplayedNote } from "./logic/displayed-note";
import type {
  SutraPadDocument,
  SutraPadTagFilterMode,
  SutraPadWorkspace,
  UserProfile,
} from "../types";
import { formatDate } from "./logic/formatting";
import {
  writeActivePageToLocation,
  writeNoteDetailIdToLocation,
} from "./logic/active-page";
import { type MenuItemId } from "./logic/menu";
import {
  writeNotesViewToLocation,
  type NotesViewMode,
} from "./logic/notes-view";
import {
  writeLinksViewToLocation,
  type LinksViewMode,
} from "./logic/links-view";
import {
  writeTagFilterModeToLocation,
  writeTagFiltersToLocation,
} from "./logic/tag-filters";
import type { SyncState } from "./session/workspace-sync";

/**
 * Returns the workspace's active note, falling back to `notes[0]`
 * when `activeNoteId` is missing or stale. Renderers use this to
 * pick a "currently displayed" note even before the route logic has
 * resolved which one should actually be focused.
 */
export function getCurrentWorkspaceNote(
  workspace: SutraPadWorkspace,
): SutraPadDocument {
  const note = workspace.notes.find((entry) => entry.id === workspace.activeNoteId);
  return note ?? workspace.notes[0];
}

export function syncTagFiltersToLocation(selectedTagFilters: string[]): void {
  const nextUrl = writeTagFiltersToLocation(window.location.href, selectedTagFilters);
  if (nextUrl !== window.location.href) {
    window.history.replaceState({}, "", nextUrl);
  }
}

export function syncFilterModeToLocation(filterMode: SutraPadTagFilterMode): void {
  const nextUrl = writeTagFilterModeToLocation(window.location.href, filterMode);
  if (nextUrl !== window.location.href) {
    window.history.replaceState({}, "", nextUrl);
  }
}

export function syncActivePageToLocation(
  activeMenuItem: MenuItemId,
  detailNoteId: string | null,
  appBasePath: string,
): void {
  const nextUrl =
    activeMenuItem === "notes" && detailNoteId !== null
      ? writeNoteDetailIdToLocation(window.location.href, detailNoteId, appBasePath)
      : writeActivePageToLocation(window.location.href, activeMenuItem, appBasePath);
  if (nextUrl !== window.location.href) {
    window.history.replaceState({}, "", nextUrl);
  }
}

/**
 * Writes the `?view=<mode>` query param for whichever page owns it at
 * this moment — Notes list (cards/list) or Links (cards/list) — and
 * strips it on any other route so a stale value from the previously-
 * active page doesn't leak. Only one page owns the param at a time,
 * so sharing the slug is safe.
 */
export function syncViewToLocation(
  activeMenuItem: MenuItemId,
  detailNoteId: string | null,
  notesViewMode: NotesViewMode,
  linksViewMode: LinksViewMode,
): void {
  if (activeMenuItem === "notes" && detailNoteId === null) {
    const nextUrl = writeNotesViewToLocation(window.location.href, notesViewMode);
    if (nextUrl !== window.location.href) {
      window.history.replaceState({}, "", nextUrl);
    }
    return;
  }
  if (activeMenuItem === "links") {
    const nextUrl = writeLinksViewToLocation(window.location.href, linksViewMode);
    if (nextUrl !== window.location.href) {
      window.history.replaceState({}, "", nextUrl);
    }
    return;
  }
  // Neither page owns the slot — make sure a stale value from the
  // previous route doesn't stick.
  const stripped = new URL(window.location.href);
  if (stripped.searchParams.has("view")) {
    stripped.searchParams.delete("view");
    window.history.replaceState({}, "", stripped.toString());
  }
}

export function syncDetailRouteSelection(
  activeMenuItem: MenuItemId,
  detailNoteId: string | null,
  workspace: SutraPadWorkspace,
): {
  detailNoteId: string | null;
  workspace: SutraPadWorkspace;
  shouldPersistWorkspace: boolean;
} {
  if (detailNoteId === null) {
    return { detailNoteId, workspace, shouldPersistWorkspace: false };
  }
  if (activeMenuItem !== "notes") {
    return { detailNoteId: null, workspace, shouldPersistWorkspace: false };
  }
  if (!workspace.notes.some((note) => note.id === detailNoteId)) {
    return { detailNoteId: null, workspace, shouldPersistWorkspace: false };
  }
  if (workspace.activeNoteId === detailNoteId) {
    return { detailNoteId, workspace, shouldPersistWorkspace: false };
  }

  return {
    detailNoteId,
    workspace: {
      ...workspace,
      activeNoteId: detailNoteId,
    },
    shouldPersistWorkspace: true,
  };
}

export function ensureVisibleActiveNoteSelection(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  filterMode: SutraPadTagFilterMode,
): {
  workspace: SutraPadWorkspace;
  shouldPersistWorkspace: boolean;
} {
  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    filterMode,
  );
  if (
    filteredNotes.length === 0 ||
    !workspace.activeNoteId ||
    filteredNotes.some((note) => note.id === workspace.activeNoteId)
  ) {
    return { workspace, shouldPersistWorkspace: false };
  }

  return {
    workspace: {
      ...workspace,
      activeNoteId: filteredNotes[0].id,
    },
    shouldPersistWorkspace: true,
  };
}

/**
 * Convenience wrapper — runs `ensureVisibleActiveNoteSelection` and
 * persists the result if it changed. Render callbacks and palette
 * selection share this so the "active note follows visible filter"
 * invariant is enforced from a single place.
 */
export function applyVisibleActiveNoteSelection(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  filterMode: SutraPadTagFilterMode,
  persistWorkspace: (workspace: SutraPadWorkspace) => void,
): SutraPadWorkspace {
  const visibleActiveNote = ensureVisibleActiveNoteSelection(
    workspace,
    selectedTagFilters,
    filterMode,
  );
  if (visibleActiveNote.shouldPersistWorkspace) {
    persistWorkspace(visibleActiveNote.workspace);
  }
  return visibleActiveNote.workspace;
}

export function getAppStatusText({
  syncState,
  lastError,
  workspace,
  selectedTagFilters,
  filterMode,
  profile,
}: {
  syncState: SyncState;
  lastError: string;
  workspace: SutraPadWorkspace;
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  profile: UserProfile | null;
}): string {
  if (syncState === "loading") return "Loading…";
  if (syncState === "saving") return "Saving…";
  if (syncState === "error") return lastError || "A synchronization error occurred.";

  const displayedNote = resolveDisplayedNote(workspace, selectedTagFilters, filterMode);
  if (!displayedNote && selectedTagFilters.length > 0) {
    return filterMode === "any"
      ? "No notes match any selected tag."
      : "No notes match all selected tags.";
  }

  const note = displayedNote ?? getCurrentWorkspaceNote(workspace);
  return profile
    ? `Notebook synced from Drive. Last change: ${formatDate(note.updatedAt)}`
    : `Editing local notebook. Last change: ${formatDate(note.updatedAt)}`;
}
