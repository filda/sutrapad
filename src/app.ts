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
  mergeHashtagsIntoTags,
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
import type { NotesListPersonaOptions } from "./app/view/shared/notes-list";
import { buildPaletteEntries, togglePaletteTagFilter } from "./app/logic/palette";
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

function syncNotesViewToLocation(
  activeMenuItem: MenuItemId,
  detailNoteId: string | null,
  notesViewMode: NotesViewMode,
): void {
  const shouldExpose = activeMenuItem === "notes" && detailNoteId === null;
  if (!shouldExpose) {
    const stripped = new URL(window.location.href);
    if (stripped.searchParams.has("view")) {
      stripped.searchParams.delete("view");
      window.history.replaceState({}, "", stripped.toString());
    }
    return;
  }

  const nextUrl = writeNotesViewToLocation(window.location.href, notesViewMode);
  if (nextUrl !== window.location.href) {
    window.history.replaceState({}, "", nextUrl);
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
  getCurrentTheme: () => ThemeChoice;
  setCurrentTheme: (theme: ThemeChoice) => void;
  getPersonaPreference: () => PersonaPreference;
  setPersonaPreference: (preference: PersonaPreference) => void;
  handleNewNote: () => void;
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
  getCurrentTheme,
  setCurrentTheme,
  getPersonaPreference,
  setPersonaPreference,
  handleNewNote,
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
        } catch {
          setBookmarkletMessage(
            "Copy failed. In Safari, you can still drag the bookmarklet or manually copy the link target.",
          );
        }
        render();
      })();
    },
    onSelectNote: (noteId: string) => {
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
      setDetailNoteId(null);
      render();
    },
    onOpenCapture: () => {
      // Mirrors `onBackToNotes`'s shape: clear the detail context first,
      // then flip the active menu item. Order matters so the next render
      // pass doesn't see a detail-editor route on the capture page.
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
  const shouldRefocus =
    active instanceof HTMLElement &&
    (active.classList.contains("tag-text-input") ||
      active.classList.contains("tag-chip-remove") ||
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
    } catch {
      return;
    }

    const latestWorkspace = getWorkspace();
    const currentNote = latestWorkspace.notes.find((note) => note.id === newNoteId);
    if (!currentNote) return;
    const patchedNote = applyFreshNoteDetails(currentNote, details);
    if (patchedNote === currentNote) return;

    const patchedWorkspace = upsertNote(latestWorkspace, newNoteId, () => patchedNote);
    setWorkspace(patchedWorkspace);
    persistWorkspace(patchedWorkspace);
    scheduleAutoSave();

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
  render: () => void;
}

export interface PaletteAccess {
  /** Opens the palette programmatically (click path — keydown handler uses the same closure). */
  open: () => void;
  /** Called from render() so the palette's visible list follows the workspace + filter state. */
  refresh: (workspace: SutraPadWorkspace, selectedTagFilters: readonly string[]) => void;
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

  window.addEventListener("keydown", (event) => {
    if (event.key !== "/") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditingTarget(event.target)) return;
    event.preventDefault();
    open();
  });

  return {
    open,
    refresh: (workspace, selectedTagFilters) => {
      handle?.update(buildPaletteEntries(workspace), selectedTagFilters);
    },
  };
}

interface WireKeyboardShortcutsOptions {
  getActiveMenuItem: () => MenuItemId;
  getDetailNoteId: () => string | null;
  setActiveMenuItem: (next: MenuItemId) => void;
  setDetailNoteId: (next: string | null) => void;
  handleNewNote: () => void;
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
function wireKeyboardShortcuts(options: WireKeyboardShortcutsOptions): void {
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
      options.setActiveMenuItem(action.menu);
      options.setDetailNoteId(null);
      options.render();
      return;
    }
    // action.kind === "escape" — only emitted when isDetailRoute was true
    options.setDetailNoteId(null);
    options.render();
  };

  window.addEventListener("keydown", (event) => {
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
  });
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
  // Visual theme is explicitly device-local — no URL sync, no Drive sync. It
  // was already applied on boot by `main.ts` to prevent a flash of the wrong
  // palette; this keeps our in-memory copy in sync with what the document
  // currently shows.
  let currentTheme: ThemeChoice = resolveInitialThemeChoice();
  // Notebook persona is explicitly device-local too: each browser/device
  // picks its own on/off stance, nothing flows through URL or Drive so a
  // shared link can't force a decorative view on the recipient.
  let personaPreference: PersonaPreference = resolveInitialPersonaPreference();
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
  const setCurrentThemeState = (next: ThemeChoice): void => { currentTheme = next; };
  const setPersonaPreferenceState = (next: PersonaPreference): void => { personaPreference = next; };
  const setBookmarkletMessageState = (next: string): void => { bookmarkletMessage = next; };

  const scheduleAutoSave = (): void => {
    if (!profile) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void saveWorkspace("background");
    }, 2000);
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    const current = getCurrentWorkspaceNote(workspace);
    workspace = upsertNote(workspace, current.id, updater);

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

  const handleNewNote = (): void =>
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
        onToggleTagFilter: (tag) => {
          selectedTagFilters = selectedTagFilters.includes(tag)
            ? selectedTagFilters.filter((entry) => entry !== tag)
            : [...selectedTagFilters, tag];
          const nextVisibleNote = ensureVisibleActiveNoteSelection(
            workspace,
            selectedTagFilters,
            filterMode,
          );
          workspace = nextVisibleNote.workspace;
          if (nextVisibleNote.shouldPersistWorkspace) {
            persistLocalWorkspace(workspace);
          }
          syncTagFiltersToLocation(selectedTagFilters);
          render();
        },
        onClearTagFilters: () => {
          selectedTagFilters = [];
          syncTagFiltersToLocation(selectedTagFilters);
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
    syncNotesViewToLocation(activeMenuItem, detailNoteId, notesViewMode);

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
      getCurrentTheme: () => currentTheme,
      setCurrentTheme: setCurrentThemeState,
      getPersonaPreference: () => personaPreference,
      setPersonaPreference: setPersonaPreferenceState,
      handleNewNote,
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
    });

  const saveWorkspace = async (mode: SaveMode = "interactive"): Promise<void> =>
    runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(workspace),
      saveRemoteWorkspace: () =>
        withAuthRetry(() => getStore().saveWorkspace(workspace), retryContext),
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
    render,
  });

  wireKeyboardShortcuts({
    getActiveMenuItem: () => activeMenuItem,
    getDetailNoteId: () => detailNoteId,
    setActiveMenuItem: setActiveMenuItemState,
    setDetailNoteId: setDetailNoteIdState,
    handleNewNote,
    render,
  });

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
