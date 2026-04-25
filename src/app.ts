import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  buildCombinedTagIndex,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  DEFAULT_NOTE_TITLE,
  extractUrlsFromText,
  filterNotesByTags,
  isEmptyDraftNote,
  mergeHashtagsIntoTags,
  stripEmptyDraftNotes,
  toggleTaskInBody,
  upsertNote,
} from "./lib/notebook";
import { collectCaptureContext } from "./lib/capture-context";
import {
  deriveTitleFromUrl,
  reverseGeocodeCoordinates,
  readNoteCapture,
  readUrlCapture,
  resolveTitleFromUrl,
  resolveCurrentCoordinates,
} from "./lib/url-capture";
import {
  buildSilentCaptureBody,
  extractSelectionFromUrl,
} from "./app/logic/silent-capture";
import { buildBookmarklet } from "./lib/bookmarklet";
import type {
  SutraPadDocument,
  SutraPadTagFilterMode,
  SutraPadWorkspace,
  UserProfile,
} from "./types";
import { generateFreshNoteDetails, collectNoteCaptureDetails } from "./app/capture/fresh-note";
import { applyFreshNoteDetails } from "./app/capture/apply-fresh-note-details";
import { resolveDisplayedNote } from "./app/logic/displayed-note";
import { formatBuildStamp, formatDate } from "./app/logic/formatting";
import { buildNoteMetadata } from "./app/logic/note-metadata";
import {
  readTagFilterModeFromLocation,
  readTagFiltersFromLocation,
  writeTagFilterModeToLocation,
  writeTagFiltersToLocation,
} from "./app/logic/tag-filters";
import { runAppBootstrap } from "./app/session/session";
import { withAuthRetry, type AuthRetryContext } from "./app/session/auth-retry";
import {
  runWorkspaceLoad,
  runWorkspaceRestoreAfterSignIn,
  runWorkspaceSave,
  type SaveMode,
  type SyncState,
} from "./app/session/workspace-sync";
import { loadLocalWorkspace, persistLocalWorkspace } from "./app/storage/local-workspace";
import { renderAppPage } from "./app/view/render-app";
import { syncPillLabel } from "./app/view/chrome/topbar";
import { buildNotesPanel } from "./app/view/pages/notes-page";
import { isMenuActionItemId, type MenuItemId } from "./app/logic/menu";
import {
  readActivePageFromLocation,
  readNoteDetailIdFromLocation,
  writeActivePageToLocation,
  writeNoteDetailIdToLocation,
} from "./app/logic/active-page";
import {
  persistNotesView,
  resolveInitialNotesView,
  writeNotesViewToLocation,
  type NotesViewMode,
} from "./app/logic/notes-view";
import {
  persistLinksView,
  resolveInitialLinksView,
  writeLinksViewToLocation,
  type LinksViewMode,
} from "./app/logic/links-view";
import {
  applyThemeChoice,
  isDarkThemeId,
  persistThemeChoice,
  resolveInitialThemeChoice,
  resolveThemeId,
  watchAutoTheme,
  type ThemeChoice,
} from "./app/logic/theme";
import {
  isPersonaEnabled,
  persistPersonaPreference,
  resolveInitialPersonaPreference,
  type PersonaPreference,
} from "./app/logic/persona";
import type { TagClassId } from "./app/logic/tag-class";
import {
  persistVisibleTagClasses,
  resolveInitialVisibleTagClasses,
  toggleTagClassVisibility,
} from "./app/logic/visible-tag-classes";
import {
  addDismissedTagAlias,
  mergeTagInWorkspace,
  persistDismissedTagAliases,
  resolveInitialDismissedTagAliases,
} from "./app/logic/tag-aliases";
import {
  loadRecentTagFilters,
  persistRecentTagFilters,
  pushRecentTagFilter,
} from "./app/logic/tag-filter-typeahead";
import type { NotesListPersonaOptions } from "./app/view/shared/notes-list";
import { buildPaletteEntries, togglePaletteTagFilter } from "./app/logic/palette";
import type { TasksFilterId } from "./app/logic/tasks-filter";
import { mountPalette, type PaletteHandle } from "./app/view/palette";
import {
  initialShortcutState,
  isEditingTarget,
  reduceShortcut,
  type ShortcutAction,
  type ShortcutState,
} from "./lib/keyboard-shortcuts";

export { generateFreshNoteDetails } from "./app/capture/fresh-note";
export { resolveDisplayedNote } from "./app/logic/displayed-note";
export { buildNoteMetadata } from "./app/logic/note-metadata";
export {
  readTagFilterModeFromLocation,
  readTagFiltersFromLocation,
  writeTagFilterModeToLocation,
  writeTagFiltersToLocation,
} from "./app/logic/tag-filters";
export {
  readActivePageFromLocation,
  readNoteDetailIdFromLocation,
  writeActivePageToLocation,
  writeNoteDetailIdToLocation,
} from "./app/logic/active-page";
export {
  DEFAULT_NOTES_VIEW,
  isNotesViewMode,
  loadStoredNotesView,
  persistNotesView,
  readNotesViewFromLocation,
  resolveInitialNotesView,
  writeNotesViewToLocation,
  type NotesViewMode,
} from "./app/logic/notes-view";
export {
  applyThemeChoice,
  DEFAULT_THEME_CHOICE,
  isDarkThemeId,
  isThemeChoice,
  loadStoredThemeChoice,
  persistThemeChoice,
  resolveInitialThemeChoice,
  resolveThemeId,
  THEMES,
  type ThemeChoice,
  type ThemeDescriptor,
  type ThemeId,
} from "./app/logic/theme";
export {
  DEFAULT_PERSONA_PREFERENCE,
  isPersonaEnabled,
  isPersonaPreference,
  loadStoredPersonaPreference,
  persistPersonaPreference,
  resolveInitialPersonaPreference,
  type PersonaPreference,
} from "./app/logic/persona";
export { restoreSessionOnStartup } from "./app/session/session";
export { withAuthRetry } from "./app/session/auth-retry";
export { runWorkspaceSave } from "./app/session/workspace-sync";

async function captureIncomingWorkspaceFromUrl(
  workspace: SutraPadWorkspace,
): Promise<SutraPadWorkspace> {
  const notePayload = readNoteCapture(window.location.href);
  if (notePayload) {
    const { title, location, coordinates, captureContext } = await generateFreshNoteDetails(
      new Date(),
      resolveCurrentCoordinates,
      reverseGeocodeCoordinates,
      async (options) => collectCaptureContext({ ...options, source: "text-capture" }),
    );

    return createTextNoteWorkspace(workspace, {
      title,
      body: notePayload.note,
      location,
      coordinates,
      captureContext,
    });
  }

  const urlPayload = readUrlCapture(window.location.href);
  if (!urlPayload) {
    return workspace;
  }

  const resolvedTitle =
    urlPayload.title ??
    (await resolveTitleFromUrl(urlPayload.url)) ??
    deriveTitleFromUrl(urlPayload.url);
  const { captureContext } = await collectNoteCaptureDetails({
    source: "url-capture",
    now: new Date(),
    resolveCoordinates: resolveCurrentCoordinates,
    reverseGeocode: reverseGeocodeCoordinates,
    captureContextBuilder: collectCaptureContext,
    sourceSnapshot: urlPayload.captureContext,
  });

  // The bookmarklet sends `?selection=` alongside `?url=` whenever the
  // user had text selected on the source page. The silent-capture
  // runner consumes both via `buildSilentCaptureBody`; if silent
  // failed and we landed in the fallback flow, that selection would
  // otherwise be silently dropped. Reusing the same builder keeps the
  // selection-prefix-then-URL formatting identical between the two
  // paths so the user's note doesn't read differently depending on
  // which route ran.
  const selection = extractSelectionFromUrl(window.location.href);
  if (selection !== null) {
    const note = createTextNoteWorkspace(workspace, {
      title: resolvedTitle,
      body: buildSilentCaptureBody(selection, urlPayload.url),
      captureContext,
    });
    return note;
  }

  return createCapturedNoteWorkspace(workspace, {
    title: resolvedTitle,
    url: urlPayload.url,
    captureContext,
  });
}

function getCurrentWorkspaceNote(workspace: SutraPadWorkspace): SutraPadDocument {
  const note = workspace.notes.find((entry) => entry.id === workspace.activeNoteId);
  return note ?? workspace.notes[0];
}

function syncTagFiltersToLocation(selectedTagFilters: string[]): void {
  const nextUrl = writeTagFiltersToLocation(window.location.href, selectedTagFilters);
  if (nextUrl !== window.location.href) {
    window.history.replaceState({}, "", nextUrl);
  }
}

function syncFilterModeToLocation(filterMode: SutraPadTagFilterMode): void {
  const nextUrl = writeTagFilterModeToLocation(window.location.href, filterMode);
  if (nextUrl !== window.location.href) {
    window.history.replaceState({}, "", nextUrl);
  }
}

function syncActivePageToLocation(
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
function syncViewToLocation(
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

function syncDetailRouteSelection(
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

function ensureVisibleActiveNoteSelection(
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

function getAppStatusText({
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

interface NewNoteHandlerOptions {
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
  render: () => void;
  refreshNotesPanel: () => void;
}

interface RenderCallbackOptions {
  auth: GoogleAuthService;
  appRootUrl: string;
  setProfile: (profile: UserProfile | null) => void;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (syncState: SyncState) => void;
  setLastError: (lastError: string) => void;
  setBookmarkletMessage: (message: string) => void;
  getSelectedTagFilters: () => string[];
  setSelectedTagFilters: (selectedTagFilters: string[]) => void;
  getFilterMode: () => SutraPadTagFilterMode;
  setFilterMode: (filterMode: SutraPadTagFilterMode) => void;
  getActiveMenuItem: () => MenuItemId;
  setActiveMenuItem: (menuItemId: MenuItemId) => void;
  getDetailNoteId: () => string | null;
  setDetailNoteId: (detailNoteId: string | null) => void;
  getNotesViewMode: () => NotesViewMode;
  setNotesViewMode: (notesViewMode: NotesViewMode) => void;
  getLinksViewMode: () => LinksViewMode;
  setLinksViewMode: (linksViewMode: LinksViewMode) => void;
  getTasksFilter: () => TasksFilterId;
  setTasksFilter: (next: TasksFilterId) => void;
  getTasksShowDone: () => boolean;
  setTasksShowDone: (next: boolean) => void;
  getTasksOneThingKey: () => string | null;
  setTasksOneThingKey: (next: string | null) => void;
  getVisibleTagClasses: () => ReadonlySet<TagClassId>;
  setVisibleTagClasses: (next: Set<TagClassId>) => void;
  getTagsSearchQuery: () => string;
  setTagsSearchQuery: (next: string) => void;
  getDismissedTagAliases: () => ReadonlySet<string>;
  setDismissedTagAliases: (next: Set<string>) => void;
  getRecentTagFilters: () => readonly string[];
  setRecentTagFilters: (next: readonly string[]) => void;
  getCurrentTheme: () => ThemeChoice;
  setCurrentTheme: (theme: ThemeChoice) => void;
  getPersonaPreference: () => PersonaPreference;
  setPersonaPreference: (preference: PersonaPreference) => void;
  handleNewNote: () => void;
  /**
   * Discards the active note if it's an empty draft (user hit "+ Add"
   * then walked away without typing). Returns true when a purge
   * happened. Callers should invoke this *before* every navigation so a
   * freshly-spawned-but-untouched note doesn't linger in the workspace
   * or get pushed to Drive.
   */
  purgeEmptyDraftNotes: () => boolean;
  loadWorkspace: () => Promise<void>;
  saveWorkspace: () => Promise<void>;
  restoreWorkspaceAfterSignIn: () => Promise<void>;
  replaceCurrentNote: (updater: (note: SutraPadDocument) => SutraPadDocument) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  scheduleAutoSave: () => void;
  render: () => void;
  refreshNotesPanel: () => void;
}

function applyVisibleActiveNoteSelection(
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

function createRenderCallbacks({
  auth,
  appRootUrl,
  setProfile,
  getWorkspace,
  setWorkspace,
  setSyncState,
  setLastError,
  setBookmarkletMessage,
  getSelectedTagFilters,
  setSelectedTagFilters,
  getFilterMode,
  setFilterMode,
  getActiveMenuItem,
  setActiveMenuItem,
  getDetailNoteId,
  setDetailNoteId,
  getNotesViewMode,
  setNotesViewMode,
  getLinksViewMode,
  setLinksViewMode,
  getTasksFilter,
  setTasksFilter,
  getTasksShowDone,
  setTasksShowDone,
  getTasksOneThingKey,
  setTasksOneThingKey,
  getVisibleTagClasses,
  setVisibleTagClasses,
  getTagsSearchQuery,
  setTagsSearchQuery,
  getDismissedTagAliases,
  setDismissedTagAliases,
  getRecentTagFilters,
  setRecentTagFilters,
  getCurrentTheme,
  setCurrentTheme,
  getPersonaPreference,
  setPersonaPreference,
  handleNewNote,
  purgeEmptyDraftNotes,
  loadWorkspace,
  saveWorkspace,
  restoreWorkspaceAfterSignIn,
  replaceCurrentNote,
  persistWorkspace,
  scheduleAutoSave,
  render,
  refreshNotesPanel,
}: RenderCallbackOptions) {
  return {
    onChangeNotesView: (mode: NotesViewMode) => {
      if (mode === getNotesViewMode()) return;
      setNotesViewMode(mode);
      persistNotesView(mode);
      render();
    },
    onChangeLinksView: (mode: LinksViewMode) => {
      if (mode === getLinksViewMode()) return;
      setLinksViewMode(mode);
      persistLinksView(mode);
      render();
    },
    onChangeTasksFilter: (filter: TasksFilterId) => {
      if (filter === getTasksFilter()) return;
      setTasksFilter(filter);
      render();
    },
    onToggleTasksShowDone: (showDone: boolean) => {
      if (showDone === getTasksShowDone()) return;
      setTasksShowDone(showDone);
      render();
    },
    onSetOneThing: (key: string | null) => {
      if (key === getTasksOneThingKey()) return;
      setTasksOneThingKey(key);
      render();
    },
    onToggleTagClass: (classId: TagClassId) => {
      const next = toggleTagClassVisibility(getVisibleTagClasses(), classId);
      setVisibleTagClasses(next);
      persistVisibleTagClasses(next);
      render();
    },
    onChangeTagsSearchQuery: (query: string) => {
      if (query === getTagsSearchQuery()) return;
      setTagsSearchQuery(query);
      // Full re-render is fine: the list view is modest and the Active-
      // filters / Classes blocks on the left panel need to stay in sync
      // with whatever state changed alongside this. The input itself
      // re-mounts, but we restore focus + caret below — same pattern
      // `renderPreservingBodyInputFocus` uses for the note body textarea.
      render();
      const nextInput = document.querySelector<HTMLInputElement>(
        ".tags-search-input",
      );
      if (nextInput && document.activeElement !== nextInput) {
        nextInput.focus();
        const end = nextInput.value.length;
        nextInput.setSelectionRange(end, end);
      }
    },
    onMergeTagAlias: (from: string, to: string) => {
      if (from === to) return;
      const current = getWorkspace();
      const next = mergeTagInWorkspace(current, from, to);
      if (next === current) return;
      setWorkspace(next);
      // Keep the active filter strip consistent: if the user was filtered
      // on `from`, carry them onto `to`. If they already had `to` selected
      // too, the duplicate is dropped. Anything else is left alone.
      const filters = getSelectedTagFilters();
      if (filters.includes(from)) {
        const rewritten = filters
          .map((tag) => (tag === from ? to : tag))
          .filter((tag, index, all) => all.indexOf(tag) === index);
        setSelectedTagFilters(rewritten);
      }
      persistWorkspace(next);
      scheduleAutoSave();
      render();
    },
    onDismissTagAlias: (canonical: string, alias: string) => {
      const next = addDismissedTagAlias(
        getDismissedTagAliases(),
        canonical,
        alias,
      );
      setDismissedTagAliases(next);
      persistDismissedTagAliases(next);
      render();
    },
    onChangeTheme: (choice: ThemeChoice) => {
      if (choice === getCurrentTheme()) return;
      setCurrentTheme(choice);
      persistThemeChoice(choice);
      applyThemeChoice(choice);
      render();
    },
    onChangePersonaPreference: (preference: PersonaPreference) => {
      if (preference === getPersonaPreference()) return;
      setPersonaPreference(preference);
      persistPersonaPreference(preference);
      render();
    },
    onSelectMenuItem: (id: MenuItemId) => {
      if (isMenuActionItemId(id)) {
        handleNewNote();
        return;
      }
      if (getActiveMenuItem() === id && getDetailNoteId() === null) return;
      // Drop the untouched draft (if any) on nav away so an accidental
      // "+ Add" click doesn't leave an Untitled stub behind.
      purgeEmptyDraftNotes();
      setActiveMenuItem(id);
      setDetailNoteId(null);
      render();
    },
    onSignIn: () => {
      void (async () => {
        try {
          setSyncState("loading");
          setLastError("");
          render();
          setProfile(await auth.signIn());
          await restoreWorkspaceAfterSignIn();
        } catch (error) {
          setSyncState("error");
          setLastError(error instanceof Error ? error.message : "Sign-in failed.");
          render();
        }
      })();
    },
    onLoadNotebook: () => void loadWorkspace(),
    onSaveNotebook: () => void saveWorkspace(),
    onSignOut: () => {
      auth.signOut();
      setProfile(null);
      setSyncState("idle");
      setLastError("");
      render();
    },
    onCopyBookmarklet: () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(buildBookmarklet(appRootUrl));
          setBookmarkletMessage(
            "Bookmarklet copied. In Safari, create any bookmark, edit it, and paste this code into its URL field.",
          );
        } catch (error) {
          // The user-visible copy failure message is enough for the
          // recovery path, but a `console.warn` keeps the underlying
          // cause discoverable in devtools — clipboard rejections
          // are easy to mistake for "the button is broken" without
          // the actual permission / focus error in the log.
          console.warn("Bookmarklet clipboard copy failed:", error);
          setBookmarkletMessage(
            "Copy failed. In Safari, you can still drag the bookmarklet or manually copy the link target.",
          );
        }
        render();
      })();
    },
    onSelectNote: (noteId: string) => {
      // Leaving the current detail (possibly an untouched fresh draft)
      // for another note — drop the draft before rebinding active, so
      // it doesn't keep occupying the workspace once we've moved on.
      purgeEmptyDraftNotes();
      setActiveMenuItem("notes");
      setDetailNoteId(noteId);
      const workspace = {
        ...getWorkspace(),
        activeNoteId: noteId,
      };
      setWorkspace(workspace);
      persistWorkspace(workspace);
      render();
    },
    onBackToNotes: () => {
      // "← Back to notes" from the detail topbar. Same untouched-draft
      // sweep as the other nav paths — the user is explicitly leaving
      // the editor, so a blank note doesn't get a free ride to Drive.
      purgeEmptyDraftNotes();
      setDetailNoteId(null);
      render();
    },
    onOpenCapture: () => {
      // Mirrors `onBackToNotes`'s shape: clear the detail context first,
      // then flip the active menu item. Order matters so the next render
      // pass doesn't see a detail-editor route on the capture page.
      purgeEmptyDraftNotes();
      setDetailNoteId(null);
      setActiveMenuItem("capture");
      render();
    },
    onToggleTagFilter: (tag: string) => {
      const nextSelectedTagFilters = togglePaletteTagFilter(getSelectedTagFilters(), tag);
      setSelectedTagFilters(nextSelectedTagFilters);
      setWorkspace(
        applyVisibleActiveNoteSelection(
          getWorkspace(),
          nextSelectedTagFilters,
          getFilterMode(),
          persistWorkspace,
        ),
      );
      syncTagFiltersToLocation(nextSelectedTagFilters);
      render();
    },
    onApplyTagFilter: (tag: string) => {
      // Commit path from the topbar's inline typeahead. Enter, second-Tab,
      // and suggestion clicks all land here. The palette has its own toggle
      // path (`onToggleTagFilter`) which can also *remove* an active filter
      // — this one is strictly "add if not already active" so a stale
      // suggestion click can't accidentally un-filter.
      const selected = getSelectedTagFilters();
      const nextSelectedTagFilters = selected.includes(tag) ? selected : [...selected, tag];
      if (nextSelectedTagFilters !== selected) {
        setSelectedTagFilters(nextSelectedTagFilters);
        setWorkspace(
          applyVisibleActiveNoteSelection(
            getWorkspace(),
            nextSelectedTagFilters,
            getFilterMode(),
            persistWorkspace,
          ),
        );
        syncTagFiltersToLocation(nextSelectedTagFilters);
      }
      // Rotate the recent-tag list regardless of whether the filter was
      // already active — the user just interacted with this tag, so it
      // belongs at the top of the recents next time they open the dropdown.
      const nextRecent = pushRecentTagFilter(getRecentTagFilters(), tag);
      setRecentTagFilters(nextRecent);
      persistRecentTagFilters(nextRecent);
      render();
    },
    onClearTagFilters: () => {
      setSelectedTagFilters([]);
      syncTagFiltersToLocation([]);
      render();
    },
    onChangeFilterMode: (mode: SutraPadTagFilterMode) => {
      if (mode === getFilterMode()) return;
      setFilterMode(mode);
      setWorkspace(
        applyVisibleActiveNoteSelection(
          getWorkspace(),
          getSelectedTagFilters(),
          mode,
          persistWorkspace,
        ),
      );
      syncFilterModeToLocation(mode);
      render();
    },
    onNewNote: handleNewNote,
    onRemoveSelectedFilter: (tag: string) => {
      const nextSelectedTagFilters = getSelectedTagFilters().filter((entry) => entry !== tag);
      setSelectedTagFilters(nextSelectedTagFilters);
      setWorkspace(
        applyVisibleActiveNoteSelection(
          getWorkspace(),
          nextSelectedTagFilters,
          getFilterMode(),
          persistWorkspace,
        ),
      );
      syncTagFiltersToLocation(nextSelectedTagFilters);
      render();
    },
    onTitleInput: (value: string) => {
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        title: value,
        updatedAt: new Date().toISOString(),
      }));
      setSyncState("idle");
      refreshNotesPanel();
    },
    onBodyInput: (value: string) => {
      const tagsBefore = getCurrentWorkspaceNote(getWorkspace()).tags;
      const mergedTags = mergeHashtagsIntoTags(tagsBefore, value);
      // Only re-render the whole editor when a new hashtag actually appeared
      // in the body — otherwise every keystroke would swap the textarea and
      // lose caret/IME state. The notes panel still refreshes for title/body
      // preview updates even when no new tag is added.
      const tagsChanged = mergedTags.length !== tagsBefore.length;

      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        body: value,
        urls: extractUrlsFromText(value),
        tags: mergedTags,
        updatedAt: new Date().toISOString(),
      }));

      if (tagsChanged) {
        renderPreservingBodyInputFocus(render);
      } else {
        refreshNotesPanel();
      }
    },
    onToggleTask: (noteId: string, lineIndex: number) => {
      const workspace = getWorkspace();
      const targetNote = workspace.notes.find((entry) => entry.id === noteId);
      if (!targetNote) return;

      const nextBody = toggleTaskInBody(targetNote.body, lineIndex);
      if (nextBody === targetNote.body) return;

      const previousActiveNoteId = workspace.activeNoteId;
      const updatedWorkspace = upsertNote(workspace, noteId, (note) => ({
        ...note,
        body: nextBody,
        urls: extractUrlsFromText(nextBody),
        updatedAt: new Date().toISOString(),
      }));
      setWorkspace({ ...updatedWorkspace, activeNoteId: previousActiveNoteId });
      persistWorkspace(getWorkspace());
      scheduleAutoSave();
      render();
    },
    onAddTag: (value: string) => {
      const tag = value.trim().toLowerCase();
      if (!tag || getCurrentWorkspaceNote(getWorkspace()).tags.includes(tag)) return;
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        tags: [...currentWorkspaceNote.tags, tag],
        updatedAt: new Date().toISOString(),
      }));
      setSyncState("idle");
      renderPreservingTagInputFocus(render);
    },
    onRemoveTag: (tag: string) => {
      if (!tag) return;
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        tags: currentWorkspaceNote.tags.filter((entry) => entry !== tag),
        updatedAt: new Date().toISOString(),
      }));
      setSyncState("idle");
      renderPreservingTagInputFocus(render);
    },
  };
}

/**
 * `render()` rebuilds the editor card wholesale, so the tag <input> gets
 * replaced and its focus/caret are dropped. For tag add/remove interactions
 * the user expects to keep typing more tags, so we detect whether focus (or a
 * recent click) came from the tag row and, if so, move focus to the freshly
 * rendered input after the DOM swap.
 */
function renderPreservingTagInputFocus(render: () => void): void {
  const active = document.activeElement;
  // `.tag-x` now appears on the topbar filter bar too, so scope the lookup
  // to the editor card — otherwise removing a topbar filter would yank
  // focus into the editor every time.
  const shouldRefocus =
    active instanceof HTMLElement &&
    active.closest(".editor-card") !== null &&
    (active.classList.contains("tag-text-input") ||
      active.classList.contains("tag-x") ||
      active.classList.contains("tag-suggestion"));

  render();

  if (shouldRefocus) {
    const nextInput = document.querySelector<HTMLInputElement>(".editor-card .tag-text-input");
    nextInput?.focus();
  }
}

/**
 * Auto-parsing hashtags from the body forces a full render when a new tag
 * appears (so the tag chips update), and a full render rebuilds the <textarea>
 * — dropping focus and the caret position. We capture selection before the
 * swap and restore it on the freshly-rendered node so the user's typing flow
 * is not interrupted mid-word.
 */
function renderPreservingBodyInputFocus(render: () => void): void {
  const active = document.activeElement;
  const wasBodyActive =
    active instanceof HTMLTextAreaElement && active.classList.contains("body-input");
  const savedStart = wasBodyActive ? active.selectionStart : 0;
  const savedEnd = wasBodyActive ? active.selectionEnd : 0;

  render();

  if (wasBodyActive) {
    const nextTextarea =
      document.querySelector<HTMLTextAreaElement>(".editor-card .body-input");
    if (nextTextarea) {
      nextTextarea.focus();
      nextTextarea.setSelectionRange(savedStart, savedEnd);
    }
  }
}

function handleNewNoteCreation({
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
  render,
  refreshNotesPanel,
}: NewNoteHandlerOptions): void {
  const nextWorkspace = createNewNoteWorkspace(getWorkspace());
  persistWorkspace(nextWorkspace);
  setWorkspace(nextWorkspace);
  const newNoteId = nextWorkspace.activeNoteId;
  setDetailNoteId(newNoteId ?? null);
  setActiveMenuItem("notes");
  setSyncState("idle");
  setLastError("");
  render();
  if (!newNoteId) return;

  void (async () => {
    let details: Awaited<ReturnType<typeof generateFreshNoteDetails>>;
    try {
      details = await generateFreshNoteDetails();
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

interface WirePaletteAccessOptions {
  host: HTMLElement;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (next: SutraPadWorkspace) => void;
  setActiveMenuItem: (next: MenuItemId) => void;
  setDetailNoteId: (next: string | null) => void;
  getSelectedTagFilters: () => string[];
  setSelectedTagFilters: (next: string[]) => void;
  getFilterMode: () => SutraPadTagFilterMode;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  /**
   * Called before the palette navigates away from the current view so an
   * untouched fresh draft doesn't linger in the workspace. Mirrors the
   * callback-level `purgeEmptyDraftNotes` used by `onSelectMenuItem` /
   * `onSelectNote` / `onBackToNotes` — the palette is just another nav
   * surface and needs the same sweep.
   */
  purgeEmptyDraftNotes: () => void;
  render: () => void;
}

export interface PaletteAccess {
  /** Opens the palette programmatically (click path — keydown handler uses the same closure). */
  open: () => void;
  /** Called from render() so the palette's visible list follows the workspace + filter state. */
  refresh: (workspace: SutraPadWorkspace, selectedTagFilters: readonly string[]) => void;
  /**
   * Tears down the global `/` keydown listener and closes any open
   * palette. Hooked up to `import.meta.hot?.dispose` so Vite's HMR
   * doesn't stack a second listener on every save.
   */
  dispose: () => void;
}

/**
 * Attaches the global `/` shortcut (GitHub-style: active anywhere outside an
 * editable target) and wires the palette's entry selections back into app
 * state. Kept at module scope so `createApp` stays a wiring function and so
 * the keyboard + selection logic is unit-testable in isolation from the rest
 * of the app.
 *
 * Note picks jump to the detail editor and keep `activeNoteId` in sync with
 * what was chosen, matching a list click. Tag picks *toggle* membership in
 * the current filter set (cumulative), matching how tag chips behave on the
 * notes list and making the per-row "Add" / "Remove" chip label literal.
 *
 * Returns an `openPalette` opener so non-keyboard callers (the topbar's
 * tag-filter strip clicks into this) can share the same open/close
 * bookkeeping as the `/` keydown listener — no second `isOpen` flag, no
 * parallel teardown path.
 */
function wirePaletteAccess(options: WirePaletteAccessOptions): PaletteAccess {
  // Local handle + open flag let the topbar "+ tag" click and the `/` keydown
  // share the same bookkeeping without either side having to know about the
  // other. `refresh` pushes the latest workspace + filters into the mounted
  // palette (called by render()); `open` mounts a fresh one if none is
  // currently open.
  let handle: PaletteHandle | null = null;
  const open = (): void => {
    if (handle !== null) return;
    handle = mountPalette({
      host: options.host,
      groups: buildPaletteEntries(options.getWorkspace()),
      selectedTagFilters: options.getSelectedTagFilters(),
      onSelectEntry: (entry) => {
        handle = null;
        // The palette is a navigation surface — sweep any dangling draft
        // before leaving the current view so it isn't left behind when
        // the user jumps to a different note or applies a tag filter.
        options.purgeEmptyDraftNotes();
        if (entry.payload.kind === "note") {
          const nextWorkspace: SutraPadWorkspace = {
            ...options.getWorkspace(),
            activeNoteId: entry.payload.noteId,
          };
          options.setWorkspace(nextWorkspace);
          options.persistWorkspace(nextWorkspace);
          options.setActiveMenuItem("notes");
          options.setDetailNoteId(entry.payload.noteId);
          options.render();
          return;
        }
        // Route to notes list first so the filter change lands on a surface
        // that honours it — filtering from home / capture / settings would
        // otherwise toggle invisibly. The toggle mirrors the notes-page
        // chip-click path (persist + URL + visible-active-note reconciliation).
        options.setActiveMenuItem("notes");
        options.setDetailNoteId(null);
        const nextFilters = togglePaletteTagFilter(
          options.getSelectedTagFilters(),
          entry.payload.tag,
        );
        options.setSelectedTagFilters(nextFilters);
        options.setWorkspace(
          applyVisibleActiveNoteSelection(
            options.getWorkspace(),
            nextFilters,
            options.getFilterMode(),
            options.persistWorkspace,
          ),
        );
        syncTagFiltersToLocation(nextFilters);
        options.render();
      },
      onClose: () => {
        handle = null;
      },
    });
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "/") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditingTarget(event.target)) return;
    event.preventDefault();
    open();
  };
  window.addEventListener("keydown", onKeydown);

  return {
    open,
    refresh: (workspace, selectedTagFilters) => {
      handle?.update(buildPaletteEntries(workspace), selectedTagFilters);
    },
    dispose: (): void => {
      // HMR re-runs `createApp` against the same `window`. Without
      // tearing down listeners on the previous instance, every save
      // adds another `keydown` handler — `/` would open N palettes
      // in a row after a few hot reloads.
      window.removeEventListener("keydown", onKeydown);
      handle?.destroy();
      handle = null;
    },
  };
}

interface WireKeyboardShortcutsOptions {
  getActiveMenuItem: () => MenuItemId;
  getDetailNoteId: () => string | null;
  setActiveMenuItem: (next: MenuItemId) => void;
  setDetailNoteId: (next: string | null) => void;
  handleNewNote: () => void;
  /**
   * Called before `G T/N/L/K` goto shortcuts and before `Esc` leaves a
   * detail route, so an untouched draft doesn't survive keyboard nav
   * the same way it wouldn't survive a click-based nav.
   */
  purgeEmptyDraftNotes: () => void;
  render: () => void;
}

/**
 * Attaches the global keyboard shortcuts (`N`, `G T/N/L/K`, `Esc` on
 * detail). Sibling of `wirePaletteAccess` — the `/` shortcut lives there
 * because it needs the palette handle. Kept at module scope so the
 * dispatch logic can be re-read without pulling `createApp` into every
 * context; the sequence-state reducer itself is already exercised in
 * `tests/keyboard-shortcuts.test.ts`.
 *
 * `goto` mirrors the topbar's `onSelectMenuItem` path (no-op if already
 * there, otherwise switch menu + clear detail + render) so hitting
 * `G N` while already on the notes *detail* route still bounces back
 * to the list — same affordance as clicking the Notes tab.
 */
function wireKeyboardShortcuts(options: WireKeyboardShortcutsOptions): () => void {
  let state: ShortcutState = initialShortcutState;

  const dispatch = (action: ShortcutAction): void => {
    if (action.kind === "new-note") {
      options.handleNewNote();
      return;
    }
    if (action.kind === "goto") {
      if (
        options.getActiveMenuItem() === action.menu &&
        options.getDetailNoteId() === null
      ) {
        return;
      }
      options.purgeEmptyDraftNotes();
      options.setActiveMenuItem(action.menu);
      options.setDetailNoteId(null);
      options.render();
      return;
    }
    // action.kind === "escape" — only emitted when isDetailRoute was true.
    // Escape from a fresh "+ Add" / `N` draft that was never typed into
    // should dispose the draft rather than leave it pinned to the notes
    // list, so the purge runs here too.
    options.purgeEmptyDraftNotes();
    options.setDetailNoteId(null);
    options.render();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    const result = reduceShortcut(state, {
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      isEditingTarget: isEditingTarget(event.target),
      isDetailRoute:
        options.getActiveMenuItem() === "notes" &&
        options.getDetailNoteId() !== null,
      now: Date.now(),
    });
    state = result.state;
    if (result.preventDefault) event.preventDefault();
    if (result.action !== null) dispatch(result.action);
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}

export function createApp(root: HTMLElement): void {
  const auth = new GoogleAuthService();
  const iosShortcutUrl = "https://www.icloud.com/shortcuts/969e1b627e4a46deae3c690ef0c9ca84";
  const appBasePath = import.meta.env.BASE_URL;
  const appRootUrl = window.location.origin + appBasePath;

  let profile: UserProfile | null = null;
  let workspace: SutraPadWorkspace = loadLocalWorkspace();
  let syncState: SyncState = "idle";
  let lastError = "";
  let bookmarkletMessage = "";
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTagFilters: string[] = readTagFiltersFromLocation(window.location.href);
  let filterMode: SutraPadTagFilterMode = readTagFilterModeFromLocation(window.location.href);
  let activeMenuItem: MenuItemId = readActivePageFromLocation(
    window.location.href,
    appBasePath,
  );
  // When the URL points at /notes/<id> on load, remember the id so the first
  // render lands directly on the detail page. The id is validated against the
  // workspace in `render()`; an unknown id falls back to the list and the URL
  // is rewritten at the next sync.
  let detailNoteId: string | null =
    activeMenuItem === "notes"
      ? readNoteDetailIdFromLocation(window.location.href, appBasePath)
      : null;
  // Notebook listing layout. URL wins on initial load so a shared link honours
  // the sender's choice, otherwise fall back to the last mode the user picked
  // on this device, otherwise the default (cards).
  let notesViewMode: NotesViewMode = resolveInitialNotesView(window.location.href);
  // Links page layout — same resolution strategy as notesViewMode, separate
  // storage slot so the two pages can drift independently.
  let linksViewMode: LinksViewMode = resolveInitialLinksView(window.location.href);
  // Visual theme is explicitly device-local — no URL sync, no Drive sync. It
  // was already applied on boot by `main.ts` to prevent a flash of the wrong
  // palette; this keeps our in-memory copy in sync with what the document
  // currently shows.
  let currentTheme: ThemeChoice = resolveInitialThemeChoice();
  // Notebook persona is explicitly device-local too: each browser/device
  // picks its own on/off stance, nothing flows through URL or Drive so a
  // shared link can't force a decorative view on the recipient.
  let personaPreference: PersonaPreference = resolveInitialPersonaPreference();
  // Tasks screen view state. Lives at the top level so `render()` (which
  // is triggered by any task checkbox toggle) doesn't wipe the user's
  // active chip, show-done stance, or "one thing" pin. Deliberately kept
  // in-memory — these are session-scoped UI preferences, not shareable
  // view-state, so they don't round-trip to the URL or localStorage.
  let tasksFilter: TasksFilterId = "all";
  let tasksShowDone = false;
  let tasksOneThingKey: string | null = null;
  // Tags page: which of the seven classes contribute tags to the list view,
  // and the (volatile) search query typed into the left-panel Search input.
  // Visibility persists to localStorage — device-local, so a shared link
  // never forces the recipient's class toggles. The query is intentionally
  // not persisted: it's in-progress typing, not a saved stance.
  let visibleTagClasses: Set<TagClassId> = resolveInitialVisibleTagClasses();
  let tagsSearchQuery = "";
  // Dismissed tag-alias pairs — the Settings hygiene card's "Keep separate"
  // action appends here. Persisted per-device to localStorage via
  // `persistDismissedTagAliases`; never round-trips to Drive because it's a
  // cleanup preference, not notebook content.
  let dismissedTagAliases: Set<string> = resolveInitialDismissedTagAliases();
  // Recently applied tag filters — newest-first, capped at 8. Drives the
  // "Recently used" group in the topbar's inline typeahead (see
  // `docs/design_handoff_sutrapad2/src/tagfilter.jsx`). Device-local + persisted
  // to `localStorage.sp_recent_tags` so the sidebar remembers between
  // sessions, but never syncs to Drive — a shared link should not seed the
  // recipient's typeahead with the sender's personal filter habits.
  let recentTagFilters: string[] = loadRecentTagFilters();
  // Filled in once `wirePaletteAccess` has mounted the `/` keybinding (near
  // the bottom of createApp). render() and the topbar's "+ tag" trigger both
  // reach the palette through this single reference, so the keyboard path
  // and the click path share the same open/close bookkeeping with no parallel
  // `isOpen` flag. Null until wiring completes, then stable for the session.
  let paletteAccess: PaletteAccess | null = null;
  // When the user picked "auto", the concrete palette depends on the OS
  // light/dark preference. Subscribe once so a system switch during a live
  // session re-applies the theme without a reload.
  watchAutoTheme(() => currentTheme);

  // Tiny typed setters for the mutable state above. Hoisted this high so the
  // helpers below (handleNewNote, palette wiring, Drive lifecycle, renderer
  // callbacks) can all pass `setWorkspaceState` instead of re-writing an
  // inline `(next) => { workspace = next; }` each time.
  const setWorkspaceState = (next: SutraPadWorkspace): void => { workspace = next; };
  const setSyncStateValue = (next: SyncState): void => { syncState = next; };
  const setLastErrorValue = (next: string): void => { lastError = next; };
  const setProfileState = (next: UserProfile | null): void => { profile = next; };
  const setSelectedTagFiltersState = (next: string[]): void => { selectedTagFilters = next; };
  const setFilterModeState = (next: SutraPadTagFilterMode): void => { filterMode = next; };
  const setActiveMenuItemState = (next: MenuItemId): void => { activeMenuItem = next; };
  const setDetailNoteIdState = (next: string | null): void => { detailNoteId = next; };
  const setNotesViewModeState = (next: NotesViewMode): void => { notesViewMode = next; };
  const setLinksViewModeState = (next: LinksViewMode): void => { linksViewMode = next; };
  const setCurrentThemeState = (next: ThemeChoice): void => { currentTheme = next; };
  const setPersonaPreferenceState = (next: PersonaPreference): void => { personaPreference = next; };
  const setBookmarkletMessageState = (next: string): void => { bookmarkletMessage = next; };
  const setTasksFilterState = (next: TasksFilterId): void => { tasksFilter = next; };
  const setTasksShowDoneState = (next: boolean): void => { tasksShowDone = next; };
  const setTasksOneThingKeyState = (next: string | null): void => { tasksOneThingKey = next; };
  const setVisibleTagClassesState = (next: Set<TagClassId>): void => { visibleTagClasses = next; };
  const setTagsSearchQueryState = (next: string): void => { tagsSearchQuery = next; };
  const setDismissedTagAliasesState = (next: Set<string>): void => { dismissedTagAliases = next; };
  const setRecentTagFiltersState = (next: readonly string[]): void => { recentTagFilters = [...next]; };

  const scheduleAutoSave = (): void => {
    if (!profile) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      // Fire-time guard. The schedule-time `if (!profile)` covers
      // "user wasn't signed in when typing"; this re-check covers
      // the race where the user signed *out* between schedule (2 s
      // ago) and fire. Without it, `saveWorkspace("background")`
      // would call into Drive without a valid token and surface as
      // a sync error pulse for an action the user never asked for.
      if (!profile) return;
      void saveWorkspace("background");
    }, 2000);
  };

  /**
   * Cancels any pending background autosave. Used by manual Load and
   * sign-in restore to make sure their own write (or "no write at
   * all" decision) is the single source of truth for the transition,
   * rather than racing the user's last-keystroke timer.
   */
  const cancelAutoSave = (): void => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    // Route the edit through `activeNoteId` directly rather than laundering it
    // through `getCurrentWorkspaceNote` (which silently falls back to
    // `notes[0]` for display purposes). If `activeNoteId` is null or no
    // longer resolves to a real note — e.g. the note was removed during a
    // sign-in merge while a debounced keystroke was in-flight — `upsertNote`
    // returns the workspace unchanged and we drop the edit rather than
    // clobber an unrelated note.
    const activeNoteId = workspace.activeNoteId;
    if (activeNoteId === null) return;

    const previousWorkspace = workspace;
    workspace = upsertNote(workspace, activeNoteId, updater);
    if (workspace === previousWorkspace) return;

    persistLocalWorkspace(workspace);
    scheduleAutoSave();
  };

  const syncSelectedTagFilters = (): void => {
    // Combined index covers both user tags and auto-derived tags, so a filter
    // like `device:mobile` survives a workspace reload instead of being
    // silently dropped because `buildTagIndex` only knew about user tags.
    const availableTags = new Set(
      buildCombinedTagIndex(workspace).tags.map((entry) => entry.tag),
    );
    selectedTagFilters = selectedTagFilters.filter((tag) => availableTags.has(tag));
  };

  /**
   * Removes in-memory empty-draft notes (from a "+ Add" / `N` spawn the
   * user never typed into) and commits the cleaned workspace to local
   * storage. Called from every navigation path that could leave the user
   * on a non-detail route with a dangling untouched draft — and also
   * before `handleNewNote` spawns a new draft, so the "hit N twice in a
   * row" case doesn't leave an orphaned stub behind.
   *
   * Returns true when a purge actually happened, false when the workspace
   * was already clean. Callers use the return value to decide whether to
   * re-render (no visible change means no render needed).
   */
  const purgeEmptyDraftNotes = (): boolean => {
    const cleaned = stripEmptyDraftNotes(workspace);
    if (cleaned === workspace) return false;
    workspace = cleaned;
    persistLocalWorkspace(workspace);
    // If the detail route was pinned to the discarded draft, drop the
    // pin so `render()` doesn't try to resolve a dangling id. The
    // `ensureVisibleActiveNoteSelection` pass inside `render()` will
    // rebind `activeNoteId` to the next visible note.
    if (detailNoteId !== null && !workspace.notes.some((note) => note.id === detailNoteId)) {
      detailNoteId = null;
    }
    return true;
  };

  const handleNewNote = (): void => {
    // Mash the "+ Add" / `N` repeatedly without typing and we'd otherwise
    // leave a chain of identical Untitled stubs in the workspace. Sweeping
    // first keeps the list honest: at most one active draft at a time.
    purgeEmptyDraftNotes();
    handleNewNoteCreation({
      root,
      getWorkspace: () => workspace,
      setWorkspace: setWorkspaceState,
      getDetailNoteId: () => detailNoteId,
      setDetailNoteId: setDetailNoteIdState,
      setActiveMenuItem: setActiveMenuItemState,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      persistWorkspace: persistLocalWorkspace,
      scheduleAutoSave,
      render,
      refreshNotesPanel,
    });
  };

  /**
   * Resolves the persona render-time options from the current preference and
   * theme state. Returning `undefined` when persona is off keeps the
   * decoration path skipped entirely rather than paying for a derivation
   * every render — the notes-list helper treats `undefined` as "flat cards".
   */
  const resolveCurrentPersonaOptions = (): NotesListPersonaOptions | undefined => {
    if (!isPersonaEnabled(personaPreference)) return undefined;
    return {
      allNotes: workspace.notes,
      dark: isDarkThemeId(resolveThemeId(currentTheme)),
    };
  };

  const refreshNotesPanel = (): void => {
    syncSelectedTagFilters();
    const visibleActiveNote = ensureVisibleActiveNoteSelection(
      workspace,
      selectedTagFilters,
      filterMode,
    );
    workspace = visibleActiveNote.workspace;
    if (visibleActiveNote.shouldPersistWorkspace) {
      persistLocalWorkspace(workspace);
    }
    const currentPanel = root.querySelector(".notes-panel");
    if (!currentPanel) {
      return;
    }

    currentPanel.replaceWith(
      buildNotesPanel({
        workspace,
        currentNoteId:
          resolveDisplayedNote(workspace, selectedTagFilters, filterMode)?.id ?? "",
        selectedTagFilters,
        filterMode,
        notesViewMode,
        personaOptions: resolveCurrentPersonaOptions(),
        onChangeNotesView: (mode) => {
          if (mode === notesViewMode) return;
          notesViewMode = mode;
          persistNotesView(mode);
          render();
        },
        onSelectNote: (noteId) => {
          activeMenuItem = "notes";
          detailNoteId = noteId;
          workspace = {
            ...workspace,
            activeNoteId: noteId,
          };
          persistLocalWorkspace(workspace);
          render();
        },
        onNewNote: handleNewNote,
      }),
    );
  };

  const refreshStatus = (): void => {
    const statusText = getAppStatusText({
      syncState,
      lastError,
      workspace,
      selectedTagFilters,
      filterMode,
      profile,
    });

    const status = root.querySelector(".status");
    if (status instanceof HTMLParagraphElement) {
      status.className = `status status-${syncState}`;
      status.textContent = statusText;
    }

    // Keep the topbar sync pill in sync with background saves — a full
    // `render()` always rebuilds it, but background-save triggers only this
    // lightweight path, so we update the pill in place here too.
    const pill = root.querySelector(".sync-pill");
    if (pill instanceof HTMLElement) {
      pill.className = `sync-pill is-${syncState}`;
      pill.title = statusText;
      pill.setAttribute("aria-label", statusText);
      const label = pill.querySelector(".sync-pill-label");
      if (label instanceof HTMLElement) {
        label.textContent = syncPillLabel(syncState);
      }
    }
  };

  const render = (): void => {
    syncSelectedTagFilters();
    const detailRoute = syncDetailRouteSelection(activeMenuItem, detailNoteId, workspace);
    detailNoteId = detailRoute.detailNoteId;
    workspace = detailRoute.workspace;
    if (detailRoute.shouldPersistWorkspace) {
      persistLocalWorkspace(workspace);
    }
    if (detailNoteId === null) {
      const visibleActiveNote = ensureVisibleActiveNoteSelection(
        workspace,
        selectedTagFilters,
        filterMode,
      );
      workspace = visibleActiveNote.workspace;
      if (visibleActiveNote.shouldPersistWorkspace) {
        persistLocalWorkspace(workspace);
      }
    }
    syncTagFiltersToLocation(selectedTagFilters);
    syncFilterModeToLocation(filterMode);
    syncActivePageToLocation(activeMenuItem, detailNoteId, appBasePath);
    syncViewToLocation(activeMenuItem, detailNoteId, notesViewMode, linksViewMode);

    const currentNote = getCurrentWorkspaceNote(workspace);
    const detailNote =
      detailNoteId !== null
        ? (workspace.notes.find((note) => note.id === detailNoteId) ?? null)
        : null;
    const displayedNote =
      detailNote ?? resolveDisplayedNote(workspace, selectedTagFilters, filterMode);
    const callbacks = createRenderCallbacks({
      auth,
      appRootUrl,
      setProfile: setProfileState,
      getWorkspace: () => workspace,
      setWorkspace: setWorkspaceState,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      setBookmarkletMessage: setBookmarkletMessageState,
      getSelectedTagFilters: () => selectedTagFilters,
      setSelectedTagFilters: setSelectedTagFiltersState,
      getFilterMode: () => filterMode,
      setFilterMode: setFilterModeState,
      getActiveMenuItem: () => activeMenuItem,
      setActiveMenuItem: setActiveMenuItemState,
      getDetailNoteId: () => detailNoteId,
      setDetailNoteId: setDetailNoteIdState,
      getNotesViewMode: () => notesViewMode,
      setNotesViewMode: setNotesViewModeState,
      getLinksViewMode: () => linksViewMode,
      setLinksViewMode: setLinksViewModeState,
      getTasksFilter: () => tasksFilter,
      setTasksFilter: setTasksFilterState,
      getTasksShowDone: () => tasksShowDone,
      setTasksShowDone: setTasksShowDoneState,
      getTasksOneThingKey: () => tasksOneThingKey,
      setTasksOneThingKey: setTasksOneThingKeyState,
      getVisibleTagClasses: () => visibleTagClasses,
      setVisibleTagClasses: setVisibleTagClassesState,
      getTagsSearchQuery: () => tagsSearchQuery,
      setTagsSearchQuery: setTagsSearchQueryState,
      getDismissedTagAliases: () => dismissedTagAliases,
      setDismissedTagAliases: setDismissedTagAliasesState,
      getRecentTagFilters: () => recentTagFilters,
      setRecentTagFilters: setRecentTagFiltersState,
      getCurrentTheme: () => currentTheme,
      setCurrentTheme: setCurrentThemeState,
      getPersonaPreference: () => personaPreference,
      setPersonaPreference: setPersonaPreferenceState,
      handleNewNote,
      purgeEmptyDraftNotes,
      loadWorkspace,
      saveWorkspace: () => saveWorkspace(),
      restoreWorkspaceAfterSignIn,
      replaceCurrentNote,
      persistWorkspace: persistLocalWorkspace,
      scheduleAutoSave,
      render,
      refreshNotesPanel,
    });
    paletteAccess?.refresh(workspace, selectedTagFilters);
    renderAppPage({
      root,
      workspace,
      currentNoteId: displayedNote?.id ?? "",
      selectedTagFilters,
      filterMode,
      note: displayedNote,
      currentNote: detailNote ?? currentNote,
      syncState,
      statusText: getAppStatusText({
        syncState,
        lastError,
        workspace,
        selectedTagFilters,
        filterMode,
        profile,
      }),
      profile,
      appRootUrl,
      bookmarkletMessage,
      iosShortcutUrl,
      buildStamp: formatBuildStamp(__APP_VERSION__, __APP_COMMIT_HASH__, __APP_BUILD_TIME__),
      activeMenuItem,
      detailNoteId,
      notesViewMode,
      linksViewMode,
      tasksFilter,
      tasksShowDone,
      tasksOneThingKey,
      visibleTagClasses,
      tagsSearchQuery,
      dismissedTagAliases,
      recentTagFilters,
      currentTheme,
      personaPreference,
      onOpenPalette: () => paletteAccess?.open(),
      ...callbacks,
    });
  };

  const getStore = (): GoogleDriveStore => {
    const token = auth.getAccessToken();
    if (!token) {
      throw new Error("The user is not signed in.");
    }

    return new GoogleDriveStore(token);
  };

  const retryContext: AuthRetryContext = {
    refreshSession: () => auth.refreshSession(),
    onProfileRefreshed: (refreshedProfile) => {
      profile = refreshedProfile;
    },
  };

  const loadWorkspace = async (): Promise<void> =>
    runWorkspaceLoad({
      loadRemoteWorkspace: () =>
        withAuthRetry(() => getStore().loadWorkspace(), retryContext),
      setWorkspace: setWorkspaceState,
      persistLocalWorkspace,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      render,
      cancelAutoSave,
    });

  const restoreWorkspaceAfterSignIn = async (): Promise<void> =>
    runWorkspaceRestoreAfterSignIn({
      loadRemoteWorkspace: () =>
        withAuthRetry(() => getStore().loadWorkspace(), retryContext),
      saveRemoteWorkspace: (ws) =>
        withAuthRetry(() => getStore().saveWorkspace(ws), retryContext),
      getWorkspace: () => workspace,
      setWorkspace: setWorkspaceState,
      persistLocalWorkspace,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      render,
      cancelAutoSave,
    });

  const saveWorkspace = async (mode: SaveMode = "interactive"): Promise<void> =>
    runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(workspace),
      // Background autosave must not trigger the GIS silent-refresh iframe —
      // on mobile it steals focus from the active <textarea> mid-keystroke.
      // We forward the save mode into `withAuthRetry` so a 401 during autosave
      // propagates unchanged (surfaces as syncState = "error") and waits for
      // the user's next interactive save / load to drive the refresh.
      //
      // Strip empty drafts before the remote push so a note the user
      // spawned-then-cleared doesn't land on Drive: e.g. user hits N,
      // types one character (scheduling autosave), deletes it, and the
      // 2-second timer fires before they click away. We only filter
      // at the *remote* edge — the local copy is still there so the
      // user can keep typing, and the next nav-away purge sweeps it
      // normally.
      saveRemoteWorkspace: () =>
        withAuthRetry(
          () => getStore().saveWorkspace(stripEmptyDraftNotes(workspace)),
          {
            ...retryContext,
            mode,
          },
        ),
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      render,
      refreshStatus,
    });

  paletteAccess = wirePaletteAccess({
    host: document.body,
    getWorkspace: () => workspace,
    setWorkspace: setWorkspaceState,
    setActiveMenuItem: setActiveMenuItemState,
    setDetailNoteId: setDetailNoteIdState,
    getSelectedTagFilters: () => selectedTagFilters,
    setSelectedTagFilters: setSelectedTagFiltersState,
    getFilterMode: () => filterMode,
    persistWorkspace: persistLocalWorkspace,
    purgeEmptyDraftNotes,
    render,
  });

  const disposeKeyboardShortcuts = wireKeyboardShortcuts({
    getActiveMenuItem: () => activeMenuItem,
    getDetailNoteId: () => detailNoteId,
    setActiveMenuItem: setActiveMenuItemState,
    setDetailNoteId: setDetailNoteIdState,
    handleNewNote,
    purgeEmptyDraftNotes,
    render,
  });

  // HMR re-runs `createApp` against the same `window` on every save.
  // Without explicit teardown the `keydown` listeners from
  // `wirePaletteAccess` and `wireKeyboardShortcuts` stack — a single
  // `/` press would open one palette per accumulated reload. The
  // optional `import.meta.hot` hook only exists in dev; production
  // builds tree-shake this branch.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      paletteAccess?.dispose();
      disposeKeyboardShortcuts();
    });
  }

  void runAppBootstrap({
    auth,
    captureIncomingWorkspaceFromUrl,
    getWorkspace: () => workspace,
    setWorkspace: setWorkspaceState,
    setProfile: setProfileState,
    setSyncState: setSyncStateValue,
    setLastError: setLastErrorValue,
    persistLocalWorkspace,
    restoreWorkspaceAfterSignIn,
    render,
  });

  render();
}
