/**
 * Reactive state-store for the SutraPad app.
 *
 * Pulls the 22 atoms + 20 setter wrappers + side-effect persist
 * subscribers out of `createApp` into a single named factory.
 * `createApp` then becomes a thin wiring point: build the store,
 * register render subscriptions, build the lifecycle pieces, run the
 * bootstrap.
 *
 * Why a factory rather than a singleton: HMR re-runs `createApp`
 * against the same `window`, and a singleton would smuggle stale
 * cross-tab subscribers and `Atom` instances forward across reloads.
 * Factory + `dispose()` keeps each `createApp` invocation contained.
 *
 * Design decisions:
 *   - Everything readable is exposed as `Readable<T>` (or `Atom<T>` if
 *     mutation happens externally). Callers don't see the
 *     setter-implementation; they call `setX(next)` and trust the
 *     atom's `Object.is` short-circuit + persist subscribers.
 *   - Persist side effects (theme + apply, notesView, linksView,
 *     visibleTagClasses, dismissedTagAliases, recentTagFilters,
 *     persona) live as `subscribe` callbacks here — keeping the
 *     "mutation always persists" invariant in one place rather than
 *     scattered across handlers.
 *   - `dispose()` tears down the persist subscribers. HMR teardown
 *     calls it so the next createApp's persist hooks aren't shadowed
 *     by ghost subscribers from the previous instance.
 */
import { atom, type Atom, type Readable } from "../lib/store";
import type {
  SutraPadTagFilterMode,
  SutraPadWorkspace,
  UserProfile,
} from "../types";
import { loadLocalWorkspace } from "./storage/local-workspace";
import {
  readActivePageFromLocation,
  readNoteDetailIdFromLocation,
} from "./logic/active-page";
import {
  readTagFilterModeFromLocation,
  readTagFiltersFromLocation,
} from "./logic/tag-filters";
import { type MenuItemId } from "./logic/menu";
import {
  persistNotesView,
  resolveInitialNotesView,
  type NotesViewMode,
} from "./logic/notes-view";
import {
  persistLinksView,
  resolveInitialLinksView,
  type LinksViewMode,
} from "./logic/links-view";
import {
  applyThemeChoice,
  persistThemeChoice,
  resolveInitialThemeChoice,
  type ThemeChoice,
} from "./logic/theme";
import {
  persistPersonaPreference,
  resolveInitialPersonaPreference,
  type PersonaPreference,
} from "./logic/persona";
import type { TagClassId } from "./logic/tag-class";
import {
  persistVisibleTagClasses,
  resolveInitialVisibleTagClasses,
} from "./logic/visible-tag-classes";
import {
  persistDismissedTagAliases,
  resolveInitialDismissedTagAliases,
} from "./logic/tag-aliases";
import {
  loadRecentTagFilters,
  persistRecentTagFilters,
} from "./logic/tag-filter-typeahead";
import type { TasksFilterId } from "./logic/tasks-filter";
import type { PaletteAccess } from "./view/palette-types";
import type { SyncState } from "./session/workspace-sync";

export interface AppStateStore {
  // Reactive state — atoms are exposed for `subscribe` / `get` / `set`.
  readonly profile$: Atom<UserProfile | null>;
  readonly workspace$: Atom<SutraPadWorkspace>;
  readonly syncState$: Atom<SyncState>;
  readonly lastError$: Atom<string>;
  readonly bookmarkletMessage$: Atom<string>;
  readonly autoSaveTimer$: Atom<ReturnType<typeof setTimeout> | null>;
  readonly selectedTagFilters$: Atom<string[]>;
  readonly filterMode$: Atom<SutraPadTagFilterMode>;
  readonly activeMenuItem$: Atom<MenuItemId>;
  readonly detailNoteId$: Atom<string | null>;
  readonly notesViewMode$: Atom<NotesViewMode>;
  readonly linksViewMode$: Atom<LinksViewMode>;
  readonly currentTheme$: Atom<ThemeChoice>;
  readonly personaPreference$: Atom<PersonaPreference>;
  readonly tasksFilter$: Atom<TasksFilterId>;
  readonly tasksShowDone$: Atom<boolean>;
  readonly tasksOneThingKey$: Atom<string | null>;
  readonly visibleTagClasses$: Atom<Set<TagClassId>>;
  readonly tagsSearchQuery$: Atom<string>;
  readonly dismissedTagAliases$: Atom<Set<string>>;
  readonly recentTagFilters$: Atom<readonly string[]>;
  readonly paletteAccess$: Atom<PaletteAccess | null>;
  // Setter wrappers — used by render-callbacks and external lifecycle
  // pieces that don't see the atoms directly. `setRecentTagFilters`
  // deep-copies its input so the atom's stored value stays unaliased
  // from the caller's reference.
  setProfile(next: UserProfile | null): void;
  setWorkspace(next: SutraPadWorkspace): void;
  setSyncState(next: SyncState): void;
  setLastError(next: string): void;
  setBookmarkletMessage(next: string): void;
  setSelectedTagFilters(next: string[]): void;
  setFilterMode(next: SutraPadTagFilterMode): void;
  setActiveMenuItem(next: MenuItemId): void;
  setDetailNoteId(next: string | null): void;
  setNotesViewMode(next: NotesViewMode): void;
  setLinksViewMode(next: LinksViewMode): void;
  setCurrentTheme(next: ThemeChoice): void;
  setPersonaPreference(next: PersonaPreference): void;
  setTasksFilter(next: TasksFilterId): void;
  setTasksShowDone(next: boolean): void;
  setTasksOneThingKey(next: string | null): void;
  setVisibleTagClasses(next: Set<TagClassId>): void;
  setTagsSearchQuery(next: string): void;
  setDismissedTagAliases(next: Set<string>): void;
  setRecentTagFilters(next: readonly string[]): void;
  /**
   * Returns the list of atoms that contribute to the user-visible
   * UI (workspace, filters, route, view modes, …) — every one of
   * these should trigger a re-render when it changes. Internal
   * atoms (`autoSaveTimer$`, `paletteAccess$`) are deliberately
   * excluded because their changes are not user-visible.
   *
   * `createApp` consumes this list to wire its `scheduleRender`
   * subscription in one go rather than enumerating each atom in
   * the wiring layer.
   */
  readonly renderingAtoms: ReadonlyArray<Readable<unknown>>;
  /**
   * Tears down internal persist subscribers. HMR teardown invokes
   * this so a stale store doesn't keep writing to localStorage after
   * the new createApp has its own store wired up.
   */
  dispose(): void;
}

export interface CreateAppStateStoreOptions {
  /**
   * Application base path (`import.meta.env.BASE_URL`). Used to read
   * the active route (`activeMenuItem`, `detailNoteId`) out of
   * `window.location.href` at construction time.
   */
  appBasePath: string;
}

export function createAppStateStore({
  appBasePath,
}: CreateAppStateStoreOptions): AppStateStore {
  const profile$ = atom<UserProfile | null>(null);
  const workspace$ = atom<SutraPadWorkspace>(loadLocalWorkspace());
  const syncState$ = atom<SyncState>("idle");
  const lastError$ = atom("");
  const bookmarkletMessage$ = atom("");
  const autoSaveTimer$ = atom<ReturnType<typeof setTimeout> | null>(null);
  const selectedTagFilters$ = atom<string[]>(
    readTagFiltersFromLocation(window.location.href),
  );
  const filterMode$ = atom<SutraPadTagFilterMode>(
    readTagFilterModeFromLocation(window.location.href),
  );
  const activeMenuItem$ = atom<MenuItemId>(
    readActivePageFromLocation(window.location.href, appBasePath),
  );
  // When the URL points at /notes/<id> on load, remember the id so
  // the first render lands directly on the detail page. The id is
  // validated against the workspace in `render()`; an unknown id
  // falls back to the list and the URL is rewritten at the next sync.
  const detailNoteId$ = atom<string | null>(
    activeMenuItem$.get() === "notes"
      ? readNoteDetailIdFromLocation(window.location.href, appBasePath)
      : null,
  );
  const notesViewMode$ = atom<NotesViewMode>(
    resolveInitialNotesView(window.location.href),
  );
  const linksViewMode$ = atom<LinksViewMode>(
    resolveInitialLinksView(window.location.href),
  );
  const currentTheme$ = atom<ThemeChoice>(resolveInitialThemeChoice());
  const personaPreference$ = atom<PersonaPreference>(
    resolveInitialPersonaPreference(),
  );
  const tasksFilter$ = atom<TasksFilterId>("all");
  const tasksShowDone$ = atom(false);
  const tasksOneThingKey$ = atom<string | null>(null);
  const visibleTagClasses$ = atom<Set<TagClassId>>(
    resolveInitialVisibleTagClasses(),
  );
  const tagsSearchQuery$ = atom("");
  const dismissedTagAliases$ = atom<Set<string>>(
    resolveInitialDismissedTagAliases(),
  );
  const recentTagFilters$ = atom<readonly string[]>(loadRecentTagFilters());
  const paletteAccess$ = atom<PaletteAccess | null>(null);

  // Persist side-effect subscribers. Each one writes to localStorage
  // (or, in the theme case, applies a CSS-class change) on every
  // legitimate atom mutation. The atom's own `Object.is` short-
  // circuit guarantees identical-value writes don't fire — so a
  // theme/persona toggle that lands on the same value is a no-op all
  // the way through.
  const disposers: Array<() => void> = [
    notesViewMode$.subscribe(persistNotesView),
    linksViewMode$.subscribe(persistLinksView),
    visibleTagClasses$.subscribe(persistVisibleTagClasses),
    dismissedTagAliases$.subscribe(persistDismissedTagAliases),
    recentTagFilters$.subscribe((value) => persistRecentTagFilters([...value])),
    currentTheme$.subscribe((choice) => {
      persistThemeChoice(choice);
      applyThemeChoice(choice);
    }),
    personaPreference$.subscribe(persistPersonaPreference),
  ];

  return {
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
    setProfile: (next) => profile$.set(next),
    setWorkspace: (next) => workspace$.set(next),
    setSyncState: (next) => syncState$.set(next),
    setLastError: (next) => lastError$.set(next),
    setBookmarkletMessage: (next) => bookmarkletMessage$.set(next),
    setSelectedTagFilters: (next) => selectedTagFilters$.set(next),
    setFilterMode: (next) => filterMode$.set(next),
    setActiveMenuItem: (next) => activeMenuItem$.set(next),
    setDetailNoteId: (next) => detailNoteId$.set(next),
    setNotesViewMode: (next) => notesViewMode$.set(next),
    setLinksViewMode: (next) => linksViewMode$.set(next),
    setCurrentTheme: (next) => currentTheme$.set(next),
    setPersonaPreference: (next) => personaPreference$.set(next),
    setTasksFilter: (next) => tasksFilter$.set(next),
    setTasksShowDone: (next) => tasksShowDone$.set(next),
    setTasksOneThingKey: (next) => tasksOneThingKey$.set(next),
    setVisibleTagClasses: (next) => visibleTagClasses$.set(next),
    setTagsSearchQuery: (next) => tagsSearchQuery$.set(next),
    setDismissedTagAliases: (next) => dismissedTagAliases$.set(next),
    // Defensive copy: the atom's `Object.is` check needs a referentially
    // distinct array to detect a "real" change, and callers might pass
    // a snapshot they keep mutating.
    setRecentTagFilters: (next) => recentTagFilters$.set([...next]),
    renderingAtoms: [
      workspace$,
      profile$,
      syncState$,
      lastError$,
      bookmarkletMessage$,
      selectedTagFilters$,
      filterMode$,
      activeMenuItem$,
      detailNoteId$,
      notesViewMode$,
      linksViewMode$,
      tasksFilter$,
      tasksShowDone$,
      tasksOneThingKey$,
      visibleTagClasses$,
      tagsSearchQuery$,
      dismissedTagAliases$,
      recentTagFilters$,
      currentTheme$,
      personaPreference$,
    ],
    dispose: () => {
      for (const off of disposers) off();
    },
  };
}
