import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  buildTagIndex,
  areWorkspacesEqual,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  extractUrlsFromText,
  filterNotesByAllTags,
  mergeWorkspaces,
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
export { restoreSessionOnStartup } from "./app/session/session";
export { withAuthRetry } from "./app/session/auth-retry";
export { runWorkspaceSave } from "./app/session/workspace-sync";

async function createFreshWorkspaceNote(
  workspace: SutraPadWorkspace,
): Promise<SutraPadWorkspace> {
  try {
    const { title, location, coordinates, captureContext } = await generateFreshNoteDetails();
    return createNewNoteWorkspace(
      workspace,
      title,
      location,
      coordinates,
      captureContext,
    );
  } catch {
    return createNewNoteWorkspace(workspace);
  }
}

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

  const getCurrentNote = (): SutraPadDocument => {
    const note = workspace.notes.find((entry) => entry.id === workspace.activeNoteId);
    return note ?? workspace.notes[0];
  };

  const scheduleAutoSave = (): void => {
    if (!profile) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void saveWorkspace("background");
    }, 2000);
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    const current = getCurrentNote();
    workspace = upsertNote(workspace, current.id, updater);

    persistLocalWorkspace(workspace);
    scheduleAutoSave();
  };

  const syncSelectedTagFilters = (): void => {
    const availableTags = new Set(buildTagIndex(workspace).tags.map((entry) => entry.tag));
    selectedTagFilters = selectedTagFilters.filter((tag) => availableTags.has(tag));
  };

  const syncTagFiltersToLocation = (): void => {
    const nextUrl = writeTagFiltersToLocation(window.location.href, selectedTagFilters);
    if (nextUrl !== window.location.href) {
      window.history.replaceState({}, "", nextUrl);
    }
  };

  const syncActivePageToLocation = (): void => {
    const nextUrl =
      activeMenuItem === "notes" && detailNoteId !== null
        ? writeNoteDetailIdToLocation(window.location.href, detailNoteId, appBasePath)
        : writeActivePageToLocation(window.location.href, activeMenuItem, appBasePath);
    if (nextUrl !== window.location.href) {
      window.history.replaceState({}, "", nextUrl);
    }
  };

  const syncNotesViewToLocation = (): void => {
    // Only the notes list cares about ?view — keep tags/links/home URLs clean
    // by stripping the param when we navigate away from the notes list.
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
  };

  const syncDetailNoteId = (): void => {
    if (detailNoteId === null) return;
    if (activeMenuItem !== "notes") {
      detailNoteId = null;
      return;
    }
    if (!workspace.notes.some((note) => note.id === detailNoteId)) {
      detailNoteId = null;
      return;
    }
    // Keep workspace.activeNoteId in sync with the route so the input handlers
    // mutate the note the user is looking at (including a fresh deep-link load).
    if (workspace.activeNoteId !== detailNoteId) {
      workspace = {
        ...workspace,
        activeNoteId: detailNoteId,
      };
      persistLocalWorkspace(workspace);
    }
  };

  const ensureVisibleActiveNote = (): void => {
    const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
    if (
      filteredNotes.length > 0 &&
      workspace.activeNoteId &&
      !filteredNotes.some((note) => note.id === workspace.activeNoteId)
    ) {
      workspace = {
        ...workspace,
        activeNoteId: filteredNotes[0].id,
      };
      persistLocalWorkspace(workspace);
    }
  };

  const handleNewNote = (): void => {
    void (async () => {
      syncState = "loading";
      lastError = "";
      render();

      workspace = await createFreshWorkspaceNote(workspace);
      persistLocalWorkspace(workspace);
      // createNewNoteWorkspace sets the new note as activeNoteId; mirror
      // that into the detail route so the user lands in the editor.
      detailNoteId = workspace.activeNoteId ?? null;
      activeMenuItem = "notes";
      syncState = "idle";
      render();
    })();
  };

  const refreshNotesPanel = (): void => {
    syncSelectedTagFilters();
    ensureVisibleActiveNote();
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
          ensureVisibleActiveNote();
          syncTagFiltersToLocation();
          render();
        },
        onClearTagFilters: () => {
          selectedTagFilters = [];
          syncTagFiltersToLocation();
          render();
        },
        onNewNote: handleNewNote,
      }),
    );
  };

  const getStatusText = (): string =>
    syncState === "loading"
      ? "Loading…"
      : syncState === "saving"
        ? "Saving…"
        : syncState === "error"
          ? lastError || "A synchronization error occurred."
          : (() => {
              const displayedNote = resolveDisplayedNote(workspace, selectedTagFilters);
              if (!displayedNote && selectedTagFilters.length > 0) {
                return "No notes match all selected tags.";
              }

              const note = displayedNote ?? getCurrentNote();
              return profile
                ? `Notebook synced from Drive. Last change: ${formatDate(note.updatedAt)}`
                : `Editing local notebook. Last change: ${formatDate(note.updatedAt)}`;
            })();

  const refreshStatus = (): void => {
    const status = root.querySelector(".status");
    if (!(status instanceof HTMLParagraphElement)) {
      return;
    }

    status.className = `status status-${syncState}`;
    status.textContent = getStatusText();
  };

  const render = (): void => {
    syncSelectedTagFilters();
    syncDetailNoteId();
    // Only re-point activeNoteId when we're on the list route. On the detail
    // route the URL pins which note is being edited, so we must not let the
    // tag filter shift activeNoteId away from the note the user is looking at.
    if (detailNoteId === null) {
      ensureVisibleActiveNote();
    }
    syncTagFiltersToLocation();
    syncActivePageToLocation();
    syncNotesViewToLocation();

    const currentNote = getCurrentNote();
    // On the detail route we deliberately ignore the tag filter — the URL is
    // authoritative about which note is being edited. On the list route the
    // filter drives which note's metadata feeds the (hidden) editor.
    const detailNote =
      detailNoteId !== null
        ? (workspace.notes.find((note) => note.id === detailNoteId) ?? null)
        : null;
    const displayedNote =
      detailNote ?? resolveDisplayedNote(workspace, selectedTagFilters);
    renderAppPage({
      root,
      workspace,
      currentNoteId: displayedNote?.id ?? "",
      selectedTagFilters,
      note: displayedNote,
      currentNote: detailNote ?? currentNote,
      syncState,
      statusText: getStatusText(),
      profile,
      appRootUrl,
      bookmarkletHelperExpanded,
      bookmarkletMessage,
      iosShortcutUrl,
      buildStamp: formatBuildStamp(__APP_VERSION__, __APP_COMMIT_HASH__, __APP_BUILD_TIME__),
      activeMenuItem,
      detailNoteId,
      notesViewMode,
      onChangeNotesView: (mode) => {
        if (mode === notesViewMode) return;
        notesViewMode = mode;
        persistNotesView(mode);
        render();
      },
      onSelectMenuItem: (id) => {
        // Action-style menu items (e.g. "Add") do not have a page of their own
        // — they run a side-effect and leave the user on the notes view, same
        // as the "New note" button on the notebook list.
        if (isMenuActionItemId(id)) {
          handleNewNote();
          return;
        }
        // Selecting a top-level nav item always drops back to the list/page
        // view of that item, even if we were already on the same menu item's
        // detail route (e.g. clicking "Notes" from /notes/<id> goes to the list).
        if (activeMenuItem === id && detailNoteId === null) return;
        activeMenuItem = id;
        detailNoteId = null;
        render();
      },
      onSignIn: () => {
        void (async () => {
          try {
            syncState = "loading";
            lastError = "";
            render();
            profile = await auth.signIn();
            await restoreWorkspaceAfterSignIn();
          } catch (error) {
            syncState = "error";
            lastError = error instanceof Error ? error.message : "Sign-in failed.";
            render();
          }
        })();
      },
      onLoadNotebook: () => void loadWorkspace(),
      onSaveNotebook: () => void saveWorkspace(),
      onSignOut: () => {
        auth.signOut();
        profile = null;
        syncState = "idle";
        lastError = "";
        render();
      },
      onToggleBookmarkletHelper: () => {
        bookmarkletHelperExpanded = !bookmarkletHelperExpanded;
        window.localStorage.setItem(
          BOOKMARKLET_HELPER_KEY,
          bookmarkletHelperExpanded ? "expanded" : "collapsed",
        );
        render();
      },
      onCopyBookmarklet: () => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(buildBookmarklet(appRootUrl));
            bookmarkletMessage =
              "Bookmarklet copied. In Safari, create any bookmark, edit it, and paste this code into its URL field.";
          } catch {
            bookmarkletMessage =
              "Copy failed. In Safari, you can still drag the bookmarklet or manually copy the link target.";
          }
          render();
        })();
      },
      onSelectNote: (noteId) => {
        // Selecting a note from anywhere — list, tags page, links page — now
        // opens the detail route. The list/detail views are mutually exclusive
        // so we always land on the editor for the chosen note.
        activeMenuItem = "notes";
        detailNoteId = noteId;
        workspace = {
          ...workspace,
          activeNoteId: noteId,
        };
        persistLocalWorkspace(workspace);
        render();
      },
      onBackToNotes: () => {
        detailNoteId = null;
        render();
      },
      onToggleTagFilter: (tag) => {
        selectedTagFilters = selectedTagFilters.includes(tag)
          ? selectedTagFilters.filter((entry) => entry !== tag)
          : [...selectedTagFilters, tag];
        ensureVisibleActiveNote();
        syncTagFiltersToLocation();
        render();
      },
      onClearTagFilters: () => {
        selectedTagFilters = [];
        syncTagFiltersToLocation();
        render();
      },
      onNewNote: handleNewNote,
      onRemoveSelectedFilter: (tag) => {
        selectedTagFilters = selectedTagFilters.filter((entry) => entry !== tag);
        ensureVisibleActiveNote();
        syncTagFiltersToLocation();
        render();
      },
      onTitleInput: (value) => {
        replaceCurrentNote((currentWorkspaceNote) => ({
          ...currentWorkspaceNote,
          title: value,
          updatedAt: new Date().toISOString(),
        }));
        syncState = "idle";
        refreshNotesPanel();
      },
      onBodyInput: (value) => {
        replaceCurrentNote((currentWorkspaceNote) => ({
          ...currentWorkspaceNote,
          body: value,
          urls: extractUrlsFromText(value),
          updatedAt: new Date().toISOString(),
        }));
        refreshNotesPanel();
      },
      onAddTag: (value) => {
        const tag = value.trim().toLowerCase();
        if (!tag || getCurrentNote().tags.includes(tag)) return;
        replaceCurrentNote((currentWorkspaceNote) => ({
          ...currentWorkspaceNote,
          tags: [...currentWorkspaceNote.tags, tag],
          updatedAt: new Date().toISOString(),
        }));
        syncState = "idle";
        render();
      },
      onRemoveTag: (tag) => {
        if (!tag) return;
        replaceCurrentNote((currentWorkspaceNote) => ({
          ...currentWorkspaceNote,
          tags: currentWorkspaceNote.tags.filter((entry) => entry !== tag),
          updatedAt: new Date().toISOString(),
        }));
        syncState = "idle";
        render();
      },
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
