import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  buildCombinedTagIndex,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  DEFAULT_NOTE_TITLE,
  isEmptyDraftNote,
  stripEmptyDraftNotes,
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
import type {
  SutraPadDocument,
  SutraPadTagFilterMode,
  SutraPadWorkspace,
} from "./types";
import { generateFreshNoteDetails, collectNoteCaptureDetails } from "./app/capture/fresh-note";
import { applyFreshNoteDetails } from "./app/capture/apply-fresh-note-details";
import { resolveDisplayedNote } from "./app/logic/displayed-note";
import { formatBuildStamp } from "./app/logic/formatting";
import { buildNoteMetadata } from "./app/logic/note-metadata";
import {
  applyVisibleActiveNoteSelection,
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
import { withAuthRetry, type AuthRetryContext } from "./app/session/auth-retry";
import {
  runWorkspaceLoad,
  runWorkspaceRestoreAfterSignIn,
  runWorkspaceSave,
  type SaveMode,
  type SyncState,
} from "./app/session/workspace-sync";
import { persistLocalWorkspace } from "./app/storage/local-workspace";
import { renderAppPage } from "./app/view/render-app";
import { syncPillLabel } from "./app/view/chrome/topbar";
import { buildNotesPanel } from "./app/view/pages/notes-page";
import { type MenuItemId } from "./app/logic/menu";
import {
  writeActivePageToLocation,
  writeNoteDetailIdToLocation,
} from "./app/logic/active-page";
import {
  writeNotesViewToLocation,
  type NotesViewMode,
} from "./app/logic/notes-view";
import {
  isDarkThemeId,
  resolveThemeId,
  watchAutoTheme,
  type ThemeChoice,
} from "./app/logic/theme";
import {
  isPersonaEnabled,
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
import { createAppStateStore } from "./app/state-store";
import { createRenderCallbacks } from "./app/render-callbacks";
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

// `getCurrentWorkspaceNote`, `sync*ToLocation`, `ensureVisible-`,
// `applyVisible-`, `syncDetailRouteSelection`, and `getAppStatusText`
// were lifted into `./app/sync-helpers` so render-callbacks,
// palette wiring, and the per-frame render() can all reach them
// without re-entering app.ts.

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
  refreshNotesPanel: () => void;
}

// `RenderCallbackOptions`, `createRenderCallbacks`, and the focus-
// preserving render wrappers (`renderPreservingTagInputFocus` /
// `renderPreservingBodyInputFocus`) were extracted into
// `./app/render-callbacks` and `./app/render-helpers` so the wiring
// layer here stays focused on store / lifecycle / bootstrap.

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

/**
 * Re-exported from `./app/view/palette-types` so existing call sites
 * (and `RenderCallbackOptions` consumers) keep importing
 * `PaletteAccess` from `app.ts` unchanged. The interface itself was
 * lifted into a dedicated module so cross-cutting consumers
 * (state-store) can refer to it without re-entering the giant
 * `app.ts` import graph.
 */
export type PaletteAccess = ExtractedPaletteAccess;

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
  const scheduleRender = (): void => {
    if (renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => {
      if (renderScheduled) render();
    });
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    // Route the edit through `activeNoteId` directly rather than laundering it
    // through `getCurrentWorkspaceNote` (which silently falls back to
    // `notes[0]` for display purposes). If `activeNoteId` is null or no
    // longer resolves to a real note — e.g. the note was removed during a
    // sign-in merge while a debounced keystroke was in-flight — `upsertNote`
    // returns the workspace unchanged and we drop the edit rather than
    // clobber an unrelated note.
    const previousWorkspace = workspace$.get();
    const activeNoteId = previousWorkspace.activeNoteId;
    if (activeNoteId === null) return;

    const next = upsertNote(previousWorkspace, activeNoteId, updater);
    if (next === previousWorkspace) return;

    workspace$.set(next);
    persistLocalWorkspace(next);
    scheduleAutoSave();
  };

  const syncSelectedTagFilters = (): void => {
    // Combined index covers both user tags and auto-derived tags, so a filter
    // like `device:mobile` survives a workspace reload instead of being
    // silently dropped because `buildTagIndex` only knew about user tags.
    const availableTags = new Set(
      buildCombinedTagIndex(workspace$.get()).tags.map((entry) => entry.tag),
    );
    selectedTagFilters$.set(
      selectedTagFilters$.get().filter((tag) => availableTags.has(tag)),
    );
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
      root,
      getWorkspace: () => workspace$.get(),
      setWorkspace: setWorkspaceState,
      getDetailNoteId: () => detailNoteId$.get(),
      setDetailNoteId: setDetailNoteIdState,
      setActiveMenuItem: setActiveMenuItemState,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      persistWorkspace: persistLocalWorkspace,
      scheduleAutoSave,
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
    const statusText = getAppStatusText({
      syncState,
      lastError: lastError$.get(),
      workspace: workspace$.get(),
      selectedTagFilters: selectedTagFilters$.get(),
      filterMode: filterMode$.get(),
      profile: profile$.get(),
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
    // Pre-empt any pending microtask render so an atom-driven
    // `scheduleRender` queued earlier doesn't double-fire after this
    // synchronous call returns. See `scheduleRender` comment for the
    // shared-flag handshake.
    renderScheduled = false;
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
      onOpenPalette: () => paletteAccess$.get()?.open(),
      ...callbacks,
    });
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

  const retryContext: AuthRetryContext = {
    refreshSession: () => auth.refreshSession(),
    onProfileRefreshed: (refreshedProfile) => {
      profile$.set(refreshedProfile);
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
      getWorkspace: () => workspace$.get(),
      setWorkspace: setWorkspaceState,
      persistLocalWorkspace,
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      render,
      cancelAutoSave,
    });

  const saveWorkspace = async (mode: SaveMode = "interactive"): Promise<void> =>
    runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(workspace$.get()),
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
          () => getStore().saveWorkspace(stripEmptyDraftNotes(workspace$.get())),
          {
            ...retryContext,
            mode,
          },
        ),
      setSyncState: setSyncStateValue,
      setLastError: setLastErrorValue,
      render,
      refreshStatus,
      cancelAutoSave,
    });

  paletteAccess$.set(wirePaletteAccess({
    host: document.body,
    getWorkspace: () => workspace$.get(),
    setWorkspace: setWorkspaceState,
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

  // Cross-tab sign-out: when the user signs out in another tab of
  // the same origin, the storage event fires here and we clear the
  // local in-memory token + flip the UI back to signed-out. Avoids
  // the "stale tab keeps using a revoked token" footgun until the
  // next 401 retroactively forces the issue.
  const disposeCrossTabSignOut = auth.subscribeToCrossTabSignOut(() => {
    setProfileState(null);
    setSyncStateValue("idle");
    setLastErrorValue("");
    cancelAutoSave();
  });

  // HMR re-runs `createApp` against the same `window` on every save.
  // Without explicit teardown the `keydown` listeners from
  // `wirePaletteAccess` and `wireKeyboardShortcuts` plus the
  // `storage` listener from `subscribeToCrossTabSignOut` stack — a
  // single `/` press would open one palette per accumulated reload
  // and one tab-level sign-out would fire N "you've been signed
  // out" handlers. The optional `import.meta.hot` hook only exists
  // in dev; production builds tree-shake this branch.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      paletteAccess$.get()?.dispose();
      disposeKeyboardShortcuts();
      disposeCrossTabSignOut();
      for (const dispose of disposeRenderSubscriptions) dispose();
      store.dispose();
    });
  }

  void runAppBootstrap({
    auth,
    captureIncomingWorkspaceFromUrl,
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
