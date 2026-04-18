import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  buildTagIndex,
  areWorkspacesEqual,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  createWorkspace,
  extractUrlsFromText,
  filterNotesByAllTags,
  mergeWorkspaces,
  upsertNote,
} from "./lib/notebook";
import { collectCaptureContext } from "./lib/capture-context";
import {
  buildNoteCaptureTitle,
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
import { type MenuItemId } from "./app/logic/menu";
import {
  readActivePageFromLocation,
  writeActivePageToLocation,
} from "./app/logic/active-page";
const BOOKMARKLET_HELPER_KEY = "sutrapad-bookmarklet-helper-expanded";

export { generateFreshNoteDetails } from "./app/capture/fresh-note";
export { resolveDisplayedNote } from "./app/logic/displayed-note";
export { buildNoteMetadata } from "./app/logic/note-metadata";
export { readTagFiltersFromLocation, writeTagFiltersToLocation } from "./app/logic/tag-filters";
export {
  readActivePageFromLocation,
  writeActivePageToLocation,
} from "./app/logic/active-page";
export { restoreSessionOnStartup } from "./app/session/session";
export { withAuthRetry } from "./app/session/auth-retry";
export { runWorkspaceSave } from "./app/session/workspace-sync";

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
    const nextUrl = writeActivePageToLocation(
      window.location.href,
      activeMenuItem,
      appBasePath,
    );
    if (nextUrl !== window.location.href) {
      window.history.replaceState({}, "", nextUrl);
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
        onSelectNote: (noteId) => {
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
        onNewNote: () => {
          void (async () => {
            try {
              syncState = "loading";
              lastError = "";
              render();

              const { title, location, coordinates, captureContext } = await generateFreshNoteDetails();
              workspace = createNewNoteWorkspace(
                workspace,
                title,
                location,
                coordinates,
                captureContext,
              );
              persistLocalWorkspace(workspace);
              syncState = "idle";
              render();
            } catch {
              workspace = createNewNoteWorkspace(workspace);
              persistLocalWorkspace(workspace);
              syncState = "idle";
              render();
            }
          })();
        },
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
    ensureVisibleActiveNote();
    syncTagFiltersToLocation();
    syncActivePageToLocation();

    const currentNote = getCurrentNote();
    const displayedNote = resolveDisplayedNote(workspace, selectedTagFilters);
    renderAppPage({
      root,
      workspace,
      currentNoteId: displayedNote?.id ?? "",
      selectedTagFilters,
      note: displayedNote,
      currentNote,
      syncState,
      statusText: getStatusText(),
      profile,
      appRootUrl,
      bookmarkletHelperExpanded,
      bookmarkletMessage,
      iosShortcutUrl,
      buildStamp: formatBuildStamp(__APP_VERSION__, __APP_COMMIT_HASH__, __APP_BUILD_TIME__),
      activeMenuItem,
      onSelectMenuItem: (id) => {
        if (activeMenuItem === id) return;
        activeMenuItem = id;
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
      onNewNote: () => {
        void (async () => {
          try {
            syncState = "loading";
            lastError = "";
            render();

            const { title, location, coordinates, captureContext } = await generateFreshNoteDetails();
            workspace = createNewNoteWorkspace(
              workspace,
              title,
              location,
              coordinates,
              captureContext,
            );
            persistLocalWorkspace(workspace);
            syncState = "idle";
            render();
          } catch {
            workspace = createNewNoteWorkspace(workspace);
            persistLocalWorkspace(workspace);
            syncState = "idle";
            render();
          }
        })();
      },
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

  const captureIncomingUrl = async (): Promise<void> => {
    const notePayload = readNoteCapture(window.location.href);
    if (notePayload) {
      const { title, location, coordinates, captureContext } = await generateFreshNoteDetails(
        new Date(),
        resolveCurrentCoordinates,
        reverseGeocodeCoordinates,
        async (options) => collectCaptureContext({ ...options, source: "text-capture" }),
      );

      workspace = createTextNoteWorkspace(workspace, {
        title,
        body: notePayload.note,
        location,
        coordinates,
        captureContext,
      });
      persistLocalWorkspace(workspace);
      window.history.replaceState({}, "", clearCaptureParamsFromLocation(window.location.href));
      return;
    }

    const urlPayload = readUrlCapture(window.location.href);
    if (!urlPayload) {
      return;
    }

    const resolvedTitle =
      urlPayload.title ??
      (await resolveTitleFromUrl(urlPayload.url)) ??
      deriveTitleFromUrl(urlPayload.url);
    const { captureContext } = await collectNoteCaptureDetails(
      "url-capture",
      new Date(),
      resolveCurrentCoordinates,
      reverseGeocodeCoordinates,
      collectCaptureContext,
      urlPayload.captureContext,
    );

    workspace = createCapturedNoteWorkspace(workspace, {
      title: resolvedTitle,
      url: urlPayload.url,
      captureContext,
    });
    persistLocalWorkspace(workspace);

    window.history.replaceState({}, "", clearCaptureParamsFromLocation(window.location.href));
  };

  void (async () => {
    try {
      await captureIncomingUrl();
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
