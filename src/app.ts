import { GoogleAuthService } from "./services/google-auth";
import {
  GoogleDrivePreferencesStore,
  GoogleDriveStore,
} from "./services/drive-store";
import {
  buildCombinedTagIndex,
  stripEmptyDraftNotes,
  upsertNote,
} from "./lib/notebook";
import type { SutraPadDocument } from "./types";
import { resolveDisplayedNote } from "./app/logic/displayed-note";
import { formatBuildStamp } from "./app/logic/formatting";
import { formatLastChange } from "./app/logic/editor-sync-crumb";
import {
  planScrollTransition,
  routeScrollKey,
  serializeRouteKey,
  type RouteScrollKey,
} from "./app/logic/route-scroll-memory";
import {
  ensureVisibleActiveNoteSelection,
  getAppStatusText,
  getCurrentWorkspaceNote,
  syncActivePageToLocation,
  syncDetailRouteSelection,
  syncFilterModeToLocation,
  syncTagFiltersToLocation,
  syncViewToLocation,
} from "./app/sync-helpers";
import { runAppBootstrap } from "./app/session/session";
import type { AuthRetryContext } from "./app/session/auth-retry";
import { createWorkspaceIO } from "./app/session/workspace-io";
import { createPreferencesIO } from "./app/session/preferences-io";
import { persistLocalWorkspace } from "./app/storage/local-workspace";
import { renderAppPage } from "./app/view/render-app";
import { syncPillLabel } from "./app/view/chrome/topbar";
import { buildNotesPanel } from "./app/view/pages/notes-page";
import {
  isDarkThemeId,
  resolveThemeId,
  watchAutoTheme,
} from "./app/logic/theme";
import { isPersonaEnabled } from "./app/logic/persona";
import type { NotesListPersonaOptions } from "./app/view/shared/notes-list";
import { createAppStateStore } from "./app/state-store";
import { createRenderCallbacks } from "./app/render-callbacks";
import { captureActiveEditorFocus } from "./app/render-helpers";
import { handleNewNoteCreation } from "./app/lifecycle/handle-new-note";
import { wirePaletteAccess } from "./app/lifecycle/palette";
import { wireKeyboardShortcuts } from "./app/lifecycle/keyboard-shortcuts";
import { captureIncomingWorkspaceFromUrl } from "./app/lifecycle/capture-import";
import { isLocationCaptureEnabled } from "./app/logic/capture-location";
import { resolveCurrentCoordinates } from "./lib/url-capture";
import {
  createBrowserFocusRefreshEnvironment,
  createFocusRefreshCoordinator,
} from "./app/lifecycle/focus-refresh";
import { loadOgImageCache } from "./app/logic/og-image-cache";
import {
  planOgImagePrewarm,
  runOgImagePrewarm,
} from "./app/logic/og-image-prewarm";
import type { PaletteAccess as ExtractedPaletteAccess } from "./app/view/palette-types";

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
export { bootstrapSessionOnStartup } from "./app/session/session";
export { withAuthRetry } from "./app/session/auth-retry";
export { runWorkspaceSave } from "./app/session/workspace-sync";


// captureIncomingWorkspaceFromUrl, handleNewNoteCreation,
// wirePaletteAccess, wireKeyboardShortcuts and their option
// interfaces were extracted into ./app/lifecycle/. createApp imports
// them from there. Helper extractions in earlier passes:
//   - render-callbacks  → ./app/render-callbacks
//   - render-helpers    → ./app/render-helpers
//   - sync helpers      → ./app/sync-helpers
//   - state-store       → ./app/state-store

/**
 * Re-exported from `./app/view/palette-types` so existing call sites
 * (and `RenderCallbackOptions` consumers) keep importing
 * `PaletteAccess` from `app.ts` unchanged. The interface itself was
 * lifted into a dedicated module so cross-cutting consumers
 * (state-store) can refer to it without re-entering the giant
 * `app.ts` import graph.
 */
export type PaletteAccess = ExtractedPaletteAccess;


// `createApp` is the application's composition root: it instantiates the
// state-store, defines the closure-bound mutators that the
// already-extracted helpers (`createRenderCallbacks`, `createWorkspaceIO`,
// `wirePaletteAccess`, `wireKeyboardShortcuts`, `runAppBootstrap`, …)
// need, and wires them together. Most other functions in the codebase
// stay well under the 350-line `max-lines-per-function` budget; this one
// legitimately exceeds it because every additional extraction would
// surface a deps interface roughly the size of the extracted block, with
// no readability win. Treat the disable as a per-function exception, not
// a license to loosen the project-wide rule. If the function grows much
// past ~450 lines, time to revisit (likely candidate: lift `render` to a
// dedicated module behind an explicit `RenderContext`).
// eslint-disable-next-line max-lines-per-function
export function createApp(root: HTMLElement): void {
  const auth = new GoogleAuthService();
  const iosShortcutUrl = "https://www.icloud.com/shortcuts/969e1b627e4a46deae3c690ef0c9ca84";
  const appBasePath = import.meta.env.BASE_URL;
  const appRootUrl = window.location.origin + appBasePath;

  // Build the reactive state-store. The store owns every atom + its
  // setter wrapper + persist subscribers in one place; `createApp` is
  // a wiring layer over that. Destructure named atoms for read paths
  // and named setters for write paths — the variable names match the
  // legacy `let X = …` / `setXState` shape so render-callback dispatch
  // and effects bags don't need to learn a new vocabulary.
  const store = createAppStateStore({ appBasePath });
  const {
    profile$,
    workspace$,
    syncState$,
    lastError$,
    bookmarkletMessage$,
    autoSaveTimer$,
    selectedTagFilters$,
    filterMode$,
    activeMenuItem$,
    detailNoteId$,
    notesViewMode$,
    linksViewMode$,
    currentTheme$,
    personaPreference$,
    captureLocationPreference$,
    locationConsentBlocked$,
    tasksFilter$,
    tasksShowDone$,
    tasksOneThingKey$,
    visibleTagClasses$,
    tagsSearchQuery$,
    dismissedTagAliases$,
    recentTagFilters$,
    paletteAccess$,
  } = store;
  const setProfileState = store.setProfile;
  const setWorkspaceState = store.setWorkspace;
  const setSyncStateValue = store.setSyncState;
  const setLastErrorValue = store.setLastError;
  const setBookmarkletMessageState = store.setBookmarkletMessage;
  const setSelectedTagFiltersState = store.setSelectedTagFilters;
  const setFilterModeState = store.setFilterMode;
  const setActiveMenuItemState = store.setActiveMenuItem;
  const setDetailNoteIdState = store.setDetailNoteId;
  const setNotesViewModeState = store.setNotesViewMode;
  const setLinksViewModeState = store.setLinksViewMode;
  const setCurrentThemeState = store.setCurrentTheme;
  const setPersonaPreferenceState = store.setPersonaPreference;
  const setCaptureLocationPreferenceState = store.setCaptureLocationPreference;
  const setLocationConsentBlockedState = store.setLocationConsentBlocked;
  const setTasksFilterState = store.setTasksFilter;
  const setTasksShowDoneState = store.setTasksShowDone;
  const setTasksOneThingKeyState = store.setTasksOneThingKey;
  const setVisibleTagClassesState = store.setVisibleTagClasses;
  const setTagsSearchQueryState = store.setTagsSearchQuery;
  const setDismissedTagAliasesState = store.setDismissedTagAliases;
  const setRecentTagFiltersState = store.setRecentTagFilters;

  // When the user picked "auto", the concrete palette depends on the OS
  // light/dark preference. Subscribe once so a system switch during a live
  // session re-applies the theme without a reload.
  watchAutoTheme(() => currentTheme$.get());

  const scheduleAutoSave = (): void => {
    if (!profile$.get()) return;
    const previousTimer = autoSaveTimer$.get();
    if (previousTimer) clearTimeout(previousTimer);
    autoSaveTimer$.set(setTimeout(() => {
      autoSaveTimer$.set(null);
      // Fire-time guard. The schedule-time `if (!profile)` covers
      // "user wasn't signed in when typing"; this re-check covers
      // the race where the user signed *out* between schedule (2 s
      // ago) and fire. Without it, `saveWorkspace("background")`
      // would call into Drive without a valid token and surface as
      // a sync error pulse for an action the user never asked for.
      if (!profile$.get()) return;
      void saveWorkspace("background");
    }, 2000));
  };

  /**
   * Cancels any pending background autosave. Used by manual Load and
   * sign-in restore to make sure their own write (or "no write at
   * all" decision) is the single source of truth for the transition,
   * rather than racing the user's last-keystroke timer.
   */
  const cancelAutoSave = (): void => {
    const timer = autoSaveTimer$.get();
    if (timer) {
      clearTimeout(timer);
      autoSaveTimer$.set(null);
    }
  };

  // Render scheduling. `render()` is the synchronous re-render entry
  // point — handlers that need the new DOM available immediately
  // (focus restoration, scroll preservation) keep calling it directly.
  // `scheduleRender()` is the debounced version that atom subscribers
  // use: a chain of N atom updates in the same handler triggers a
  // single microtask-flushed re-render rather than N immediate ones.
  // The flag is shared so a synchronous `render()` from a handler
  // pre-empts any pending microtask, avoiding the "render synchronously
  // then render again on the next tick" double-up.
  let renderScheduled = false;
  let renderSuppressionDepth = 0;
  // Per-page scroll memory. The serialized route key (page:notes,
  // note-detail:<id>, …) maps to the last `window.scrollY` captured for
  // that route, so the user lands at the same spot when they revisit a
  // list page. See `route-scroll-memory.ts` for the decision logic;
  // app.ts is only responsible for the side-effecting capture/restore.
  let previousScrollKey: RouteScrollKey | null = null;
  const scrollMemory = new Map<string, number>();
  const withRenderSuppressed = (action: () => void): void => {
    renderSuppressionDepth += 1;
    try {
      action();
    } finally {
      renderSuppressionDepth -= 1;
    }
  };
  const scheduleRender = (): void => {
    if (renderSuppressionDepth > 0) return;
    if (renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => {
      if (renderScheduled) render();
    });
  };

  /**
   * Applies `updater` to the note identified by `noteId` and commits the
   * result. When the id no longer resolves to a real note (refresh
   * dropped it, sign-in merge collapsed it, etc.), `upsertNote` returns
   * the workspace unchanged and we drop the edit — that is the failure
   * mode `replaceCurrentNote`'s comment below describes, lifted here so
   * any caller with an explicit note binding gets the same guarantee.
   */
  const replaceNote = (
    noteId: string,
    updater: (note: SutraPadDocument) => SutraPadDocument,
  ): void => {
    const previousWorkspace = workspace$.get();
    const next = upsertNote(previousWorkspace, noteId, updater);
    if (next === previousWorkspace) return;

    withRenderSuppressed(() => workspace$.set(next));
    persistLocalWorkspace(next);
    scheduleAutoSave();
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    // Route the edit through `activeNoteId` directly rather than laundering it
    // through `getCurrentWorkspaceNote` (which silently falls back to
    // `notes[0]` for display purposes). If `activeNoteId` is null or no
    // longer resolves to a real note — e.g. the note was removed during a
    // sign-in merge while a debounced keystroke was in-flight — `upsertNote`
    // returns the workspace unchanged and we drop the edit rather than
    // clobber an unrelated note.
    const activeNoteId = workspace$.get().activeNoteId;
    if (activeNoteId === null) return;
    replaceNote(activeNoteId, updater);
  };

  const syncSelectedTagFilters = (): void => {
    // Combined index covers both user tags and auto-derived tags, so a filter
    // like `device:mobile` survives a workspace reload instead of being
    // silently dropped because `buildTagIndex` only knew about user tags.
    const availableTags = new Set(
      buildCombinedTagIndex(workspace$.get()).tags.map((entry) => entry.tag),
    );
    const currentFilters = selectedTagFilters$.get();
    const nextFilters = currentFilters.filter((tag) => availableTags.has(tag));
    if (
      nextFilters.length === currentFilters.length &&
      nextFilters.every((tag, index) => tag === currentFilters[index])
    ) {
      return;
    }
    selectedTagFilters$.set(nextFilters);
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
    const previous = workspace$.get();
    const cleaned = stripEmptyDraftNotes(previous);
    if (cleaned === previous) return false;
    workspace$.set(cleaned);
    persistLocalWorkspace(cleaned);
    // If the detail route was pinned to the discarded draft, drop the
    // pin so `render()` doesn't try to resolve a dangling id. The
    // `ensureVisibleActiveNoteSelection` pass inside `render()` will
    // rebind `activeNoteId` to the next visible note.
    const detailNoteId = detailNoteId$.get();
    if (detailNoteId !== null && !cleaned.notes.some((note) => note.id === detailNoteId)) {
      detailNoteId$.set(null);
    }
    return true;
  };

  const handleNewNote = (): void => {
    // Mash the "+ Add" / `N` repeatedly without typing and we'd otherwise
    // leave a chain of identical Untitled stubs in the workspace. Sweeping
    // first keeps the list honest: at most one active draft at a time.
    purgeEmptyDraftNotes();
    handleNewNoteCreation({
      getWorkspace: () => workspace$.get(),
      setWorkspace: setWorkspaceState,
      setDetailNoteId: setDetailNoteIdState,
      setActiveMenuItem: setActiveMenuItemState,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      persistWorkspace: persistLocalWorkspace,
      scheduleAutoSave,
      // Drive the render synchronously at the end of the geolocation
      // backfill so the queued microtask render (from the unwrapped
      // `setWorkspace` above) gets pre-empted by the
      // `renderScheduled` flag handshake. Focus + caret preservation
      // is now baked into `render()` itself via the capture/restore
      // around `renderAppPage`, so no special wrapper is needed here.
      rerenderPreservingActiveEditorFocus: () => render(),
      // Read the latest preference at call time (not at createApp
      // start) so toggling Settings → Privacy → "Capture location"
      // takes effect on the very next `+ Add` without a reload.
      getCaptureLocationPreference: () => captureLocationPreference$.get(),
    });
  };

  /**
   * Resolves the persona render-time options from the current preference and
   * theme state. Returning `undefined` when persona is off keeps the
   * decoration path skipped entirely rather than paying for a derivation
   * every render — the notes-list helper treats `undefined` as "flat cards".
   */
  const resolveCurrentPersonaOptions = (): NotesListPersonaOptions | undefined => {
    if (!isPersonaEnabled(personaPreference$.get())) return undefined;
    return {
      allNotes: workspace$.get().notes,
      dark: isDarkThemeId(resolveThemeId(currentTheme$.get())),
    };
  };

  const refreshNotesPanel = (): void => {
    syncSelectedTagFilters();
    const visibleActiveNote = ensureVisibleActiveNoteSelection(
      workspace$.get(),
      selectedTagFilters$.get(),
      filterMode$.get(),
    );
    workspace$.set(visibleActiveNote.workspace);
    if (visibleActiveNote.shouldPersistWorkspace) {
      persistLocalWorkspace(visibleActiveNote.workspace);
    }
    const currentPanel = root.querySelector(".notes-panel");
    if (!currentPanel) {
      return;
    }

    const workspace = workspace$.get();
    const selectedTagFilters = selectedTagFilters$.get();
    const filterMode = filterMode$.get();
    const notesViewMode = notesViewMode$.get();
    currentPanel.replaceWith(
      buildNotesPanel({
        workspace,
        currentNoteId:
          resolveDisplayedNote(workspace, selectedTagFilters, filterMode)?.id ?? "",
        selectedTagFilters,
        filterMode,
        notesViewMode,
        personaOptions: resolveCurrentPersonaOptions(),
        onChangeNotesView: (mode) => notesViewMode$.set(mode),
        onSelectNote: (noteId) => {
          activeMenuItem$.set("notes");
          detailNoteId$.set(noteId);
          const next = { ...workspace$.get(), activeNoteId: noteId };
          workspace$.set(next);
          persistLocalWorkspace(next);
        },
        onNewNote: handleNewNote,
      }),
    );
  };

  const refreshStatus = (): void => {
    const syncState = syncState$.get();
    const workspace = workspace$.get();
    const profile = profile$.get();
    const statusText = getAppStatusText({
      syncState,
      lastError: lastError$.get(),
      workspace,
      selectedTagFilters: selectedTagFilters$.get(),
      filterMode: filterMode$.get(),
      profile,
    });

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

    // Patch the detail-topbar's `synced HH:mm` crumb in place too. A
    // background save bumps the active note's `updatedAt` before the
    // network call settles, so the crumb would otherwise stay stale
    // until the next render. We only touch the crumb when there is
    // exactly one — i.e. the user is on the detail route; on the notes
    // list / other pages, the selector returns null and the patch is a
    // no-op. Mirrors the sync-pill in-place patching pattern above.
    const syncCrumb = root.querySelector(".crumb-sync");
    if (syncCrumb instanceof HTMLElement) {
      const activeNote = getCurrentWorkspaceNote(workspace);
      syncCrumb.textContent = formatLastChange(activeNote.updatedAt, {
        signedIn: profile !== null,
      });
    }
  };

  const render = (): void => {
    // Set the flag *true* for the entire body of render(): the
    // mutations below (`syncSelectedTagFilters` filters into a fresh
    // array, `workspace$.set(detailRoute.workspace)` etc. land new
    // object references) all fire their atom subscribers, and each
    // subscriber calls `scheduleRender`. Without this guard,
    // `scheduleRender` would see `renderScheduled = false`, queue a
    // microtask, and as soon as the synchronous render returns the
    // microtask would call render() again — which mutates the same
    // atoms with new references — looping the browser in microtasks
    // forever (no paint, no console error, blank page). Holding the
    // flag true throughout keeps every in-render schedule a no-op.
    //
    // Resetting the flag in `finally` (rather than at the top, which
    // is what we used to do) also pre-empts any pending microtask
    // queued *before* this synchronous render: when the microtask
    // eventually flushes it sees `renderScheduled = false` and skips
    // — that's the "shared-flag handshake" referenced in
    // `scheduleRender`.
    renderScheduled = true;
    // Editor focus snapshot. Captured *before* any of the synchronous
    // rebuild work below — `renderAppPage` empties `root.innerHTML`,
    // so the title input / body textarea / tag typeahead the user is
    // typing into get replaced wholesale. We restore in `finally`
    // (after the new DOM is in place) so any path that triggers a
    // re-render — atom subscriber chain, manual call, async
    // resolver — leaves the caret exactly where it was. Restore is a
    // no-op when focus was outside the editor card, so it's safe to
    // run unconditionally.
    const focusSnapshot = captureActiveEditorFocus();
    let scrollRestoreY: number | null = null;
    try {
      syncSelectedTagFilters();
      const detailRoute = syncDetailRouteSelection(
        activeMenuItem$.get(),
        detailNoteId$.get(),
        workspace$.get(),
      );
      detailNoteId$.set(detailRoute.detailNoteId);
      workspace$.set(detailRoute.workspace);
      if (detailRoute.shouldPersistWorkspace) {
        persistLocalWorkspace(detailRoute.workspace);
      }
      if (detailNoteId$.get() === null) {
        const visibleActiveNote = ensureVisibleActiveNoteSelection(
          workspace$.get(),
          selectedTagFilters$.get(),
          filterMode$.get(),
        );
        workspace$.set(visibleActiveNote.workspace);
        if (visibleActiveNote.shouldPersistWorkspace) {
          persistLocalWorkspace(visibleActiveNote.workspace);
        }
      }
      // Snapshot every reactive read for the rest of this render — the
      // values are passed into renderAppPage and friends, which expect a
      // consistent view of state for the duration of the call.
      const workspace = workspace$.get();
      const selectedTagFilters = selectedTagFilters$.get();
      const filterMode = filterMode$.get();
      const activeMenuItem = activeMenuItem$.get();
      const detailNoteId = detailNoteId$.get();
      // Per-page scroll memory: decide whether to capture `window.scrollY`
      // for the page we're leaving, and whether to restore a stored value
      // for the page we're entering. The plan is computed *before*
      // `renderAppPage` tears down the DOM so the captured scrollY still
      // corresponds to the page the user was actually looking at.
      const currentScrollKey = routeScrollKey(activeMenuItem, detailNoteId);
      const scrollPlan = planScrollTransition({
        previousKey: previousScrollKey,
        currentKey: currentScrollKey,
        memoryRead: (key) => scrollMemory.get(serializeRouteKey(key)),
      });
      if (scrollPlan.capturePrevious && previousScrollKey !== null) {
        scrollMemory.set(serializeRouteKey(previousScrollKey), window.scrollY);
      }
      previousScrollKey = currentScrollKey;
      scrollRestoreY = scrollPlan.restoreScrollY;
      const notesViewMode = notesViewMode$.get();
      const linksViewMode = linksViewMode$.get();
      const syncState = syncState$.get();
      const profile = profile$.get();
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
        getWorkspace: () => workspace$.get(),
        setWorkspace: setWorkspaceState,
        setSyncState: setSyncStateValue,
        setLastError: setLastErrorValue,
        setBookmarkletMessage: setBookmarkletMessageState,
        getSelectedTagFilters: () => selectedTagFilters,
        setSelectedTagFilters: setSelectedTagFiltersState,
        getFilterMode: () => filterMode$.get(),
        setFilterMode: setFilterModeState,
        getActiveMenuItem: () => activeMenuItem$.get(),
        setActiveMenuItem: setActiveMenuItemState,
        getDetailNoteId: () => detailNoteId$.get(),
        setDetailNoteId: setDetailNoteIdState,
        setNotesViewMode: setNotesViewModeState,
        setLinksViewMode: setLinksViewModeState,
        setTasksFilter: setTasksFilterState,
        setTasksShowDone: setTasksShowDoneState,
        setTasksOneThingKey: setTasksOneThingKeyState,
        getVisibleTagClasses: () => visibleTagClasses$.get(),
        setVisibleTagClasses: setVisibleTagClassesState,
        getTagsSearchQuery: () => tagsSearchQuery$.get(),
        setTagsSearchQuery: setTagsSearchQueryState,
        getDismissedTagAliases: () => dismissedTagAliases$.get(),
        setDismissedTagAliases: setDismissedTagAliasesState,
        getRecentTagFilters: () => recentTagFilters$.get(),
        setRecentTagFilters: setRecentTagFiltersState,
        setCurrentTheme: setCurrentThemeState,
        setPersonaPreference: setPersonaPreferenceState,
        setCaptureLocationPreference: setCaptureLocationPreferenceState,
        setLocationConsentBlocked: setLocationConsentBlockedState,
        handleNewNote,
        purgeEmptyDraftNotes,
        loadWorkspace,
        saveWorkspace: () => saveWorkspace(),
        restoreWorkspaceAfterSignIn,
        replaceCurrentNote,
        replaceNote,
        persistWorkspace: persistLocalWorkspace,
        scheduleAutoSave,
        render,
        refreshNotesPanel,
      });
      paletteAccess$.get()?.refresh(workspace, selectedTagFilters);
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
          lastError: lastError$.get(),
          workspace,
          selectedTagFilters,
          filterMode,
          profile,
        }),
        profile,
        appRootUrl,
        bookmarkletMessage: bookmarkletMessage$.get(),
        iosShortcutUrl,
        buildStamp: formatBuildStamp(__APP_VERSION__, __APP_COMMIT_HASH__, __APP_BUILD_TIME__),
        activeMenuItem,
        detailNoteId,
        notesViewMode,
        linksViewMode,
        tasksFilter: tasksFilter$.get(),
        tasksShowDone: tasksShowDone$.get(),
        tasksOneThingKey: tasksOneThingKey$.get(),
        visibleTagClasses: visibleTagClasses$.get(),
        tagsSearchQuery: tagsSearchQuery$.get(),
        dismissedTagAliases: dismissedTagAliases$.get(),
        recentTagFilters: recentTagFilters$.get(),
        currentTheme: currentTheme$.get(),
        personaPreference: personaPreference$.get(),
        captureLocationPreference: captureLocationPreference$.get(),
        locationConsentBlocked: locationConsentBlocked$.get(),
        onOpenPalette: () => paletteAccess$.get()?.open(),
        getAccessToken: () => auth.getAccessToken(),
        ...callbacks,
      });
    } finally {
      // Releasing the guard outside the try means a thrown render() doesn't
      // leave the flag stuck `true` (which would silently kill all future
      // schedule attempts — every scheduleRender would short-circuit and
      // the UI would freeze without any further error). The `finally` runs
      // either way: success path hits it after `renderAppPage`, failure
      // path hits it before the throw propagates out of createApp.
      renderScheduled = false;
      // Restore the editor input focus + caret captured at the top.
      // Run inside the same `finally` so a throw that unwinds the
      // synchronous render still gets a focus-restoration attempt
      // against whatever DOM landed before the failure. Restore is a
      // no-op when the snapshot was taken outside the editor card.
      focusSnapshot.restore();
      // `scrollRestoreY === null` means "this is a same-page re-render
      // (or first render) — leave scroll alone so an autosave doesn't
      // yank the user". A concrete number means "scroll there"; 0 is
      // the standard fallback for fresh pages and detail entries.
      if (scrollRestoreY !== null) {
        window.scrollTo({ top: scrollRestoreY, left: 0, behavior: "auto" });
      }
    }
  };

  // Atom-driven render scheduling. Subscribing every UI-affecting atom
  // (provided by the store as `renderingAtoms`) means handlers can
  // mutate state and forget about triggering re-renders explicitly —
  // the chain `setX(value) → atom.set() → subscriber → scheduleRender
  // → microtask → render()` runs itself. Synchronous ad-hoc
  // `render()` calls in handlers stay valid for the few sites that
  // need the new DOM available immediately (focus restoration, scroll
  // preservation); the shared `renderScheduled` flag makes those
  // calls pre-empt the microtask.
  //
  // Persist side effects (theme + apply, notesView, linksView, …)
  // already live as subscribers inside the store itself.
  const disposeRenderSubscriptions = store.renderingAtoms.map((atom$) =>
    atom$.subscribe(scheduleRender),
  );

  const getStore = (): GoogleDriveStore => {
    const token = auth.getAccessToken();
    if (!token) {
      throw new Error("The user is not signed in.");
    }

    return new GoogleDriveStore(token);
  };

  // Preferences store returns null instead of throwing when signed out
  // so the IO layer can treat sign-in state as a soft gate (no-op
  // schedule / load) rather than a hard error. `getStore` throws for
  // the workspace path because every call site there is gated on
  // `profile$` upstream; the preferences path is fired from the
  // dismissed-tag-aliases atom subscriber, which runs regardless of
  // sign-in state.
  const getPreferencesStore = (): GoogleDrivePreferencesStore | null => {
    const token = auth.getAccessToken();
    if (!token) return null;
    return new GoogleDrivePreferencesStore(token);
  };

  const retryContext: AuthRetryContext = {
    refreshSession: () => auth.refreshSession(),
    onProfileRefreshed: (refreshedProfile) => {
      profile$.set(refreshedProfile);
    },
  };

  const {
    loadPreferences,
    schedulePreferencesSave,
    cancelPreferencesSave,
  } = createPreferencesIO({
    getPreferencesStore,
    retryContext,
    getDismissedTagAliases: () => dismissedTagAliases$.get(),
    setDismissedTagAliases: (next) =>
      withRenderSuppressed(() => setDismissedTagAliasesState(next)),
    getProfile: () => profile$.get(),
  });

  // Push dismissed-pair changes to Drive (debounced). Subscribed once;
  // the IO layer owns the signed-in / clean-snapshot guards so this
  // wiring stays a one-liner. localStorage persistence keeps running
  // via its own subscriber registered inside the store.
  const disposePreferencesAutosave = dismissedTagAliases$.subscribe(() => {
    schedulePreferencesSave();
  });

  const workspaceIO = createWorkspaceIO({
    getStore,
    retryContext,
    getWorkspace: () => workspace$.get(),
    setWorkspace: (workspace) => withRenderSuppressed(() => setWorkspaceState(workspace)),
    persistLocalWorkspace,
    setSyncState: (syncState) => withRenderSuppressed(() => setSyncStateValue(syncState)),
    setLastError: (lastError) => withRenderSuppressed(() => setLastErrorValue(lastError)),
    render,
    refreshStatus,
    cancelAutoSave,
  });

  // Fire-and-forget prewarm of the og:image cache. Walks every note
  // whose primary URL isn't yet cached and runs the existing resolver
  // pipeline in parallel so a card grid painted right after this fires
  // already has its og:images on the first paint instead of waiting
  // for per-card allorigins round-trips. Lazy resolution still kicks
  // in for URLs the user types in *after* load.
  const scheduleOgImagePrewarm = (): void => {
    const targets = planOgImagePrewarm(
      workspace$.get().notes,
      loadOgImageCache(),
    );
    if (targets.length === 0) return;
    // No await — the load path doesn't care when the prewarm finishes,
    // only that it has started. Cache writes happen incrementally so a
    // page render mid-prewarm sees partial-but-monotonic warming.
    void runOgImagePrewarm(targets);
  };

  // Compose the two IO concerns: every successful Drive workspace
  // load / sign-in restore also pulls the preferences file. We do
  // this at the app-wiring layer (rather than threading a callback
  // into `createWorkspaceIO`) so the workspace IO stays focused on
  // the notebook concern and the composition is visible at a glance.
  const loadWorkspace = async (): Promise<void> => {
    await workspaceIO.loadWorkspace();
    await loadPreferences();
    scheduleOgImagePrewarm();
  };
  const restoreWorkspaceAfterSignIn = async (): Promise<void> => {
    await workspaceIO.restoreWorkspaceAfterSignIn();
    await loadPreferences();
    scheduleOgImagePrewarm();
  };
  const { saveWorkspace, refreshWorkspace, isWorkspaceDirty } = workspaceIO;

  // Focus / visibility-driven cross-device refresh. The gate captures
  // every reason we must NOT auto-refresh in the background:
  //   - no signed-in profile → no Drive token to spend.
  //   - sync is mid-write → letting a refresh fan out alongside a save
  //     would race two flows over the same notes; the next focus event
  //     after the save settles will pick it back up.
  //   - autosave timer is pending → a typed-but-not-yet-pushed local
  //     edit is waiting to land. Refreshing first would round-trip the
  //     pre-edit state into the workspace, the autosave would then
  //     stomp it back out, and we'd have burned two RTTs to do nothing.
  //   - workspace is dirty against the last-synced snapshot → there are
  //     local edits Drive hasn't seen yet. This catches the race the
  //     autosave-timer check alone misses: the timer can fire (clearing
  //     itself to null) and start a save that succeeds, but a follow-up
  //     keystroke immediately after re-arms the timer; if the visibility
  //     event lands in the small window between the save settling and
  //     the next keystroke landing, the timer check passes but the
  //     workspace still differs from what's on Drive. The refresh that
  //     would then run could drop just-typed local-only notes, which
  //     the render-detach blur cascade documented in
  //     `editor-card.ts:bodyInput.blur` would then stamp onto a sibling.
  // The coordinator owns the throttle + in-flight guard so this stays
  // a pure predicate.
  const focusRefresh = createFocusRefreshCoordinator({
    refresh: () => refreshWorkspace(),
    canRefresh: () => {
      if (!profile$.get()) return false;
      if (syncState$.get() === "saving") return false;
      if (autoSaveTimer$.get() !== null) return false;
      if (isWorkspaceDirty()) return false;
      return true;
    },
    environment: createBrowserFocusRefreshEnvironment(),
    onError: (error) => {
      // Surface in devtools but don't propagate — the refresh path
      // already commits sync state = "error" + lastError via the
      // orchestrator; this hook is just for visibility in logs.
      console.warn("Focus refresh failed", error);
    },
  });

  paletteAccess$.set(wirePaletteAccess({
    host: document.body,
    getWorkspace: () => workspace$.get(),
    setWorkspace: setWorkspaceState,
    getActiveMenuItem: () => activeMenuItem$.get(),
    setActiveMenuItem: setActiveMenuItemState,
    setDetailNoteId: setDetailNoteIdState,
    getSelectedTagFilters: () => selectedTagFilters$.get(),
    setSelectedTagFilters: setSelectedTagFiltersState,
    getFilterMode: () => filterMode$.get(),
    persistWorkspace: persistLocalWorkspace,
    purgeEmptyDraftNotes,
    render,
  }));

  const disposeKeyboardShortcuts = wireKeyboardShortcuts({
    getActiveMenuItem: () => activeMenuItem$.get(),
    getDetailNoteId: () => detailNoteId$.get(),
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
  //
  // Cross-tab sign-out propagation was removed alongside the
  // localStorage token cache: with no shared persisted state there's
  // nothing for a peer tab's sign-out to revoke here, and the
  // in-memory token in this tab will be replaced (or invalidated) on
  // its next interactive action via `withAuthRetry`.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      paletteAccess$.get()?.dispose();
      disposeKeyboardShortcuts();
      focusRefresh.stop();
      disposePreferencesAutosave();
      cancelPreferencesSave();
      for (const dispose of disposeRenderSubscriptions) dispose();
      store.dispose();
    });
  }

  void runAppBootstrap({
    auth,
    // Gate the bookmarklet / URL-capture flow on the same consent
    // preference the main `+ Add` path reads. Read at call time (not
    // at wire time) so a `localStorage` change between modules sees
    // the freshest value. `"unanswered"` and `"off"` both fall to the
    // null resolver — bookmarklet captures never pop a geolocation
    // prompt inside the capture iframe; the user resolves the
    // consent the next time they open the main app.
    captureIncomingWorkspaceFromUrl: (workspace) =>
      captureIncomingWorkspaceFromUrl(workspace, {
        resolveCoordinates: isLocationCaptureEnabled(
          captureLocationPreference$.get(),
        )
          ? resolveCurrentCoordinates
          : () => Promise.resolve(null),
      }),
    getWorkspace: () => workspace$.get(),
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
