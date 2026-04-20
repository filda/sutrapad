import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  buildTagIndex,
  areWorkspacesEqual,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  DEFAULT_NOTE_TITLE,
  extractUrlsFromText,
  filterNotesByAllTags,
  mergeWorkspaces,
  toggleTaskInBody,
  upsertNote,
} from "./lib/notebook";
import { collectCaptureContext } from "./lib/capture-context";
import {
  clearCaptureParamsFromLocation,
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
  SutraPadWorkspace,
  UserProfile,
} from "./types";
import { generateFreshNoteDetails, collectNoteCaptureDetails } from "./app/capture/fresh-note";
import { applyFreshNoteDetails } from "./app/capture/apply-fresh-note-details";
import { resolveDisplayedNote } from "./app/logic/displayed-note";
import { formatBuildStamp, formatDate } from "./app/logic/formatting";
import { buildNoteMetadata } from "./app/logic/note-metadata";
import { readTagFiltersFromLocation, writeTagFiltersToLocation } from "./app/logic/tag-filters";
import { restoreSessionOnStartup } from "./app/session/session";
import { withAuthRetry, type AuthRetryContext } from "./app/session/auth-retry";
import { runWorkspaceSave, type SaveMode, type SyncState } from "./app/session/workspace-sync";
import { loadLocalWorkspace, persistLocalWorkspace } from "./app/storage/local-workspace";
import { renderAppPage } from "./app/view/render-app";
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
  persistThemeChoice,
  resolveInitialThemeChoice,
  type ThemeChoice,
} from "./app/logic/theme";
const BOOKMARKLET_HELPER_KEY = "sutrapad-bookmarklet-helper-expanded";

export { generateFreshNoteDetails } from "./app/capture/fresh-note";
export { resolveDisplayedNote } from "./app/logic/displayed-note";
export { buildNoteMetadata } from "./app/logic/note-metadata";
export { readTagFiltersFromLocation, writeTagFiltersToLocation } from "./app/logic/tag-filters";
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
): {
  workspace: SutraPadWorkspace;
  shouldPersistWorkspace: boolean;
} {
  const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
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
  profile,
}: {
  syncState: SyncState;
  lastError: string;
  workspace: SutraPadWorkspace;
  selectedTagFilters: string[];
  profile: UserProfile | null;
}): string {
  if (syncState === "loading") return "Loading…";
  if (syncState === "saving") return "Saving…";
  if (syncState === "error") return lastError || "A synchronization error occurred.";

  const displayedNote = resolveDisplayedNote(workspace, selectedTagFilters);
  if (!displayedNote && selectedTagFilters.length > 0) {
    return "No notes match all selected tags.";
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
  getBookmarkletHelperExpanded: () => boolean;
  setBookmarkletHelperExpanded: (expanded: boolean) => void;
  setBookmarkletMessage: (message: string) => void;
  getSelectedTagFilters: () => string[];
  setSelectedTagFilters: (selectedTagFilters: string[]) => void;
  getActiveMenuItem: () => MenuItemId;
  setActiveMenuItem: (menuItemId: MenuItemId) => void;
  getDetailNoteId: () => string | null;
  setDetailNoteId: (detailNoteId: string | null) => void;
  getNotesViewMode: () => NotesViewMode;
  setNotesViewMode: (notesViewMode: NotesViewMode) => void;
  getCurrentTheme: () => ThemeChoice;
  setCurrentTheme: (theme: ThemeChoice) => void;
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

function toggleSelectedTagFilter(selectedTagFilters: string[], tag: string): string[] {
  return selectedTagFilters.includes(tag)
    ? selectedTagFilters.filter((entry) => entry !== tag)
    : [...selectedTagFilters, tag];
}

function applyVisibleActiveNoteSelection(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  persistWorkspace: (workspace: SutraPadWorkspace) => void,
): SutraPadWorkspace {
  const visibleActiveNote = ensureVisibleActiveNoteSelection(workspace, selectedTagFilters);
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
  getBookmarkletHelperExpanded,
  setBookmarkletHelperExpanded,
  setBookmarkletMessage,
  getSelectedTagFilters,
  setSelectedTagFilters,
  getActiveMenuItem,
  setActiveMenuItem,
  getDetailNoteId,
  setDetailNoteId,
  getNotesViewMode,
  setNotesViewMode,
  getCurrentTheme,
  setCurrentTheme,
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
    onToggleBookmarkletHelper: () => {
      const nextExpanded = !getBookmarkletHelperExpanded();
      setBookmarkletHelperExpanded(nextExpanded);
      window.localStorage.setItem(
        BOOKMARKLET_HELPER_KEY,
        nextExpanded ? "expanded" : "collapsed",
      );
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
    onToggleTagFilter: (tag: string) => {
      const nextSelectedTagFilters = toggleSelectedTagFilter(getSelectedTagFilters(), tag);
      setSelectedTagFilters(nextSelectedTagFilters);
      setWorkspace(
        applyVisibleActiveNoteSelection(getWorkspace(), nextSelectedTagFilters, persistWorkspace),
      );
      syncTagFiltersToLocation(nextSelectedTagFilters);
      render();
    },
    onClearTagFilters: () => {
      setSelectedTagFilters([]);
      syncTagFiltersToLocation([]);
      render();
    },
    onNewNote: handleNewNote,
    onRemoveSelectedFilter: (tag: string) => {
      const nextSelectedTagFilters = getSelectedTagFilters().filter((entry) => entry !== tag);
      setSelectedTagFilters(nextSelectedTagFilters);
      setWorkspace(
        applyVisibleActiveNoteSelection(getWorkspace(), nextSelectedTagFilters, persistWorkspace),
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
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        body: value,
        urls: extractUrlsFromText(value),
        updatedAt: new Date().toISOString(),
      }));
      refreshNotesPanel();
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
  let bookmarkletHelperExpanded =
    window.localStorage.getItem(BOOKMARKLET_HELPER_KEY) !== "collapsed";
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTagFilters: string[] = readTagFiltersFromLocation(window.location.href);
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
  // When the user picked "auto", the concrete palette depends on the OS
  // light/dark preference. Subscribe once so a system switch during a live
  // session re-applies the theme without a reload.
  const darkSchemeMedia =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  darkSchemeMedia?.addEventListener?.("change", () => {
    if (currentTheme === "auto") {
      applyThemeChoice(currentTheme);
    }
  });

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
    const availableTags = new Set(buildTagIndex(workspace).tags.map((entry) => entry.tag));
    selectedTagFilters = selectedTagFilters.filter((tag) => availableTags.has(tag));
  };

  const handleNewNote = (): void =>
    handleNewNoteCreation({
      root,
      getWorkspace: () => workspace,
      setWorkspace: (nextWorkspace) => {
        workspace = nextWorkspace;
      },
      getDetailNoteId: () => detailNoteId,
      setDetailNoteId: (nextDetailNoteId) => {
        detailNoteId = nextDetailNoteId;
      },
      setActiveMenuItem: (nextActiveMenuItem) => {
        activeMenuItem = nextActiveMenuItem;
      },
      setSyncState: (nextSyncState) => {
        syncState = nextSyncState;
      },
      setLastError: (nextLastError) => {
        lastError = nextLastError;
      },
      persistWorkspace: persistLocalWorkspace,
      scheduleAutoSave,
      render,
      refreshNotesPanel,
    });

  const refreshNotesPanel = (): void => {
    syncSelectedTagFilters();
    const visibleActiveNote = ensureVisibleActiveNoteSelection(workspace, selectedTagFilters);
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
        currentNoteId: resolveDisplayedNote(workspace, selectedTagFilters)?.id ?? "",
        selectedTagFilters,
        notesViewMode,
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
          const nextVisibleNote = ensureVisibleActiveNoteSelection(workspace, selectedTagFilters);
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
    const status = root.querySelector(".status");
    if (!(status instanceof HTMLParagraphElement)) {
      return;
    }

    status.className = `status status-${syncState}`;
    status.textContent = getAppStatusText({
      syncState,
      lastError,
      workspace,
      selectedTagFilters,
      profile,
    });
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
      const visibleActiveNote = ensureVisibleActiveNoteSelection(workspace, selectedTagFilters);
      workspace = visibleActiveNote.workspace;
      if (visibleActiveNote.shouldPersistWorkspace) {
        persistLocalWorkspace(workspace);
      }
    }
    syncTagFiltersToLocation(selectedTagFilters);
    syncActivePageToLocation(activeMenuItem, detailNoteId, appBasePath);
    syncNotesViewToLocation(activeMenuItem, detailNoteId, notesViewMode);

    const currentNote = getCurrentWorkspaceNote(workspace);
    const detailNote =
      detailNoteId !== null
        ? (workspace.notes.find((note) => note.id === detailNoteId) ?? null)
        : null;
    const displayedNote =
      detailNote ?? resolveDisplayedNote(workspace, selectedTagFilters);
    const callbacks = createRenderCallbacks({
      auth,
      appRootUrl,
      setProfile: (nextProfile) => {
        profile = nextProfile;
      },
      getWorkspace: () => workspace,
      setWorkspace: (nextWorkspace) => {
        workspace = nextWorkspace;
      },
      setSyncState: (nextSyncState) => {
        syncState = nextSyncState;
      },
      setLastError: (nextLastError) => {
        lastError = nextLastError;
      },
      getBookmarkletHelperExpanded: () => bookmarkletHelperExpanded,
      setBookmarkletHelperExpanded: (expanded) => {
        bookmarkletHelperExpanded = expanded;
      },
      setBookmarkletMessage: (message) => {
        bookmarkletMessage = message;
      },
      getSelectedTagFilters: () => selectedTagFilters,
      setSelectedTagFilters: (nextSelectedTagFilters) => {
        selectedTagFilters = nextSelectedTagFilters;
      },
      getActiveMenuItem: () => activeMenuItem,
      setActiveMenuItem: (nextActiveMenuItem) => {
        activeMenuItem = nextActiveMenuItem;
      },
      getDetailNoteId: () => detailNoteId,
      setDetailNoteId: (nextDetailNoteId) => {
        detailNoteId = nextDetailNoteId;
      },
      getNotesViewMode: () => notesViewMode,
      setNotesViewMode: (nextNotesViewMode) => {
        notesViewMode = nextNotesViewMode;
      },
      getCurrentTheme: () => currentTheme,
      setCurrentTheme: (nextCurrentTheme) => {
        currentTheme = nextCurrentTheme;
      },
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
    renderAppPage({
      root,
      workspace,
      currentNoteId: displayedNote?.id ?? "",
      selectedTagFilters,
      note: displayedNote,
      currentNote: detailNote ?? currentNote,
      syncState,
      statusText: getAppStatusText({
        syncState,
        lastError,
        workspace,
        selectedTagFilters,
        profile,
      }),
      profile,
      appRootUrl,
      bookmarkletHelperExpanded,
      bookmarkletMessage,
      iosShortcutUrl,
      buildStamp: formatBuildStamp(__APP_VERSION__, __APP_COMMIT_HASH__, __APP_BUILD_TIME__),
      activeMenuItem,
      detailNoteId,
      notesViewMode,
      currentTheme,
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

  const loadWorkspace = async (): Promise<void> => {
    try {
      syncState = "loading";
      lastError = "";
      render();
      workspace = await withAuthRetry(() => getStore().loadWorkspace(), retryContext);
      persistLocalWorkspace(workspace);
      syncState = "idle";
      render();
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "Loading from Google Drive failed.";
      render();
    }
  };

  const restoreWorkspaceAfterSignIn = async (): Promise<void> => {
    try {
      syncState = "loading";
      lastError = "";
      render();

      const remoteWorkspace = await withAuthRetry(
        () => getStore().loadWorkspace(),
        retryContext,
      );
      const mergedWorkspace = mergeWorkspaces(workspace, remoteWorkspace);
      const needsRemoteSave = !areWorkspacesEqual(mergedWorkspace, remoteWorkspace);

      workspace = mergedWorkspace;
      persistLocalWorkspace(workspace);

      if (needsRemoteSave) {
        syncState = "saving";
        render();
        await withAuthRetry(() => getStore().saveWorkspace(workspace), retryContext);
      }

      syncState = "idle";
      render();
    } catch (error) {
      syncState = "error";
      lastError =
        error instanceof Error ? error.message : "Loading from Google Drive failed.";
      render();
    }
  };

  const saveWorkspace = async (mode: SaveMode = "interactive"): Promise<void> =>
    runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(workspace),
      saveRemoteWorkspace: () =>
        withAuthRetry(() => getStore().saveWorkspace(workspace), retryContext),
      setSyncState: (state) => {
        syncState = state;
      },
      setLastError: (message) => {
        lastError = message;
      },
      render,
      refreshStatus,
    });

  void (async () => {
    try {
      workspace = await captureIncomingWorkspaceFromUrl(workspace);
      persistLocalWorkspace(workspace);
      window.history.replaceState({}, "", clearCaptureParamsFromLocation(window.location.href));
      await auth.initialize();

      profile = await restoreSessionOnStartup(
        auth,
        (restoredProfile) => {
          profile = restoredProfile;
        },
        restoreWorkspaceAfterSignIn,
      );
      if (profile) {
        return;
      }
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "App initialization failed.";
    }

    render();
  })();

  render();
}
