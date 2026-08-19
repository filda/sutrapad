// @vitest-environment happy-dom
//
// First focused test for `src/app/state-store.ts` — 413 lines that, until
// now, nothing measured. `create-app-smoke.test.ts` executes the factory but
// asserts on rendered HTML, which is far too coarse to notice that (say) a
// persist subscriber stopped firing or that `dispose()` tore down the wrong
// list. The module was in `DEFERRED_FROM_MUTATION` for exactly that reason.
//
// What is worth pinning here, in the order the factory does it:
//
//   1. Every atom's *initial* value — several read `window.location.href` or
//      localStorage, so a wrong seed means the app opens on the wrong page or
//      silently forgets a preference. Construction-time bugs are invisible to
//      a test that only pokes setters.
//   2. The `workspace$` subscription that keeps the three derived indexes
//      (summaries / tasks / links) in sync, including the hydration-aware
//      carry-forward — the load-bearing half of "a placeholder must never
//      blank out good data".
//   3. The persist subscribers, one per preference. Each writes a different
//      key, so a copy-paste slip between them is a real failure mode.
//   4. `dispose()`, whose whole job is unobservable except by asserting that
//      writes *stop*.
//   5. `renderingAtoms` — the list `createApp` subscribes `scheduleRender` to.
//      An atom missing from it means "user changes X, nothing repaints"; an
//      internal atom wrongly present means a render per autosave timer tick.
//
// happy-dom is required: the factory touches `window.location`,
// `localStorage`, and (via `applyThemeChoice`) `document.documentElement`.
//
// Two survivors in the mutation report are equivalent, not gaps:
//   - the `savedAt: ""` seed passed to `reconcileTaskIndexForWorkspace` — the
//     helper always stamps its own `savedAt` and never reads the previous
//     index's, so any string works;
//   - `activeMenuItem$.get() === "notes"` → `true`, because
//     `readNoteDetailIdFromLocation` already returns null unless the first
//     path segment is `notes`. The guard is a readability shortcut, not a
//     behavioural one; the `!==` mutant of it *is* killed below.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppStateStore, type AppStateStore } from "../src/app/state-store";
import { LOCAL_WORKSPACE_KEY } from "../src/app/storage/local-workspace";
import { RECENT_TAG_FILTERS_STORAGE_KEY } from "../src/app/logic/tag-filter-typeahead";
import type {
  SutraPadDocument,
  SutraPadLinkIndex,
  SutraPadTaskIndex,
  SutraPadWorkspace,
} from "../src/types";

const APP_BASE = "/";

/** Storage keys the factory's persist subscribers own, by preference. */
const KEYS = {
  workspace: LOCAL_WORKSPACE_KEY,
  notesView: "sutrapad-notes-view",
  linksView: "sutrapad-links-view",
  theme: "sutrapad-theme",
  persona: "sutrapad-persona-enabled",
  captureLocation: "sutrapad-capture-location-consent",
  visibleTagClasses: "sutrapad-visible-tag-classes",
  dismissedAliases: "sutrapad-dismissed-tag-aliases",
  recentFilters: RECENT_TAG_FILTERS_STORAGE_KEY,
} as const;

const makeNote = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "",
  urls: [],
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  tags: [],
  ...overrides,
});

const makeWorkspace = (notes: SutraPadDocument[]): SutraPadWorkspace => ({
  notes,
  activeNoteId: null,
});

/** Seeds the local-workspace slot the factory reads at construction time. */
function storeWorkspace(workspace: SutraPadWorkspace): void {
  localStorage.setItem(KEYS.workspace, JSON.stringify(workspace));
}

let stores: AppStateStore[] = [];

/**
 * Builds a store at `url` and registers it for teardown. Every store
 * subscribes persist side effects to its own atoms, so a leaked one would
 * keep writing to localStorage during later tests.
 */
function createStoreAt(url: string, appBasePath = APP_BASE): AppStateStore {
  window.history.replaceState({}, "", url);
  const store = createAppStateStore({ appBasePath });
  stores.push(store);
  return store;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  for (const store of stores) store.dispose();
  stores = [];
});

describe("createAppStateStore route and preference seeding", () => {
  it("opens on the default page with no filters at the app root", () => {
    const store = createStoreAt("/");

    // DEFAULT_MENU_ITEM is "notes" — the root URL carries no page segment.
    expect(store.activeMenuItem$.get()).toBe("notes");
    expect(store.detailNoteId$.get()).toBeNull();
    expect(store.selectedTagFilters$.get()).toEqual([]);
    expect(store.filterMode$.get()).toBe("all");
  });

  it("lands directly on a note detail when the URL names one", () => {
    const store = createStoreAt("/notes/n-42");

    expect(store.activeMenuItem$.get()).toBe("notes");
    expect(store.detailNoteId$.get()).toBe("n-42");
  });

  it("leaves the detail id unset on a page that is not the notebook", () => {
    const store = createStoreAt("/tasks/t-1");

    expect(store.activeMenuItem$.get()).toBe("tasks");
    expect(store.detailNoteId$.get()).toBeNull();
  });

  it("resolves the page against the configured base path", () => {
    const store = createStoreAt("/sutrapad/tags", "/sutrapad/");

    expect(store.activeMenuItem$.get()).toBe("tags");
  });

  it("takes tag filters and the match mode from the query string", () => {
    const store = createStoreAt("/?tags=Beta,alpha,alpha&tagsMode=any");

    // The reader lowercases, de-duplicates and sorts.
    expect(store.selectedTagFilters$.get()).toEqual(["alpha", "beta"]);
    expect(store.filterMode$.get()).toBe("any");
  });

  it("falls back to all-mode when tagsMode is not a known value", () => {
    const store = createStoreAt("/?tagsMode=nonsense");

    expect(store.filterMode$.get()).toBe("all");
  });

  it("prefers the URL over storage for the notebook view mode", () => {
    localStorage.setItem(KEYS.notesView, "cards");
    const store = createStoreAt("/?view=list");

    expect(store.notesViewMode$.get()).toBe("list");
  });

  it("restores view modes, theme and consent preferences from storage", () => {
    localStorage.setItem(KEYS.notesView, "list");
    localStorage.setItem(KEYS.linksView, "list");
    localStorage.setItem(KEYS.theme, "dark");
    localStorage.setItem(KEYS.persona, "on");
    localStorage.setItem(KEYS.captureLocation, "on");
    localStorage.setItem(KEYS.visibleTagClasses, "place,topic");
    localStorage.setItem(KEYS.dismissedAliases, "a|b");
    localStorage.setItem(KEYS.recentFilters, JSON.stringify(["praha"]));

    const store = createStoreAt("/");

    expect(store.notesViewMode$.get()).toBe("list");
    expect(store.linksViewMode$.get()).toBe("list");
    expect(store.currentTheme$.get()).toBe("dark");
    expect(store.personaPreference$.get()).toBe("on");
    expect(store.captureLocationPreference$.get()).toBe("on");
    expect([...store.visibleTagClasses$.get()].toSorted()).toEqual(["place", "topic"]);
    expect([...store.dismissedTagAliases$.get()]).toEqual(["a|b"]);
    expect(store.recentTagFilters$.get()).toEqual(["praha"]);
  });

  it("seeds the workspace from the local slot", () => {
    storeWorkspace(makeWorkspace([makeNote({ id: "stored", title: "Ze storage" })]));

    const store = createStoreAt("/");

    expect(store.workspace$.get().notes.map((note) => note.id)).toEqual(["stored"]);
  });

  it("starts the transient and internal atoms at their documented defaults", () => {
    // These carry no persistence on purpose: a reload must return the user to
    // the consent card and an idle Backup card, and the internal atoms must
    // not arrive pre-populated.
    const store = createStoreAt("/");

    expect(store.profile$.get()).toBeNull();
    expect(store.syncState$.get()).toBe("idle");
    expect(store.lastError$.get()).toBe("");
    expect(store.bookmarkletMessage$.get()).toBe("");
    expect(store.autoSaveTimer$.get()).toBeNull();
    expect(store.locationConsentBlocked$.get()).toBe(false);
    expect(store.tasksFilter$.get()).toBe("all");
    expect(store.tasksShowDone$.get()).toBe(false);
    expect(store.tasksOneThingKey$.get()).toBeNull();
    expect(store.tagsSearchQuery$.get()).toBe("");
    expect(store.paletteAccess$.get()).toBeNull();
    expect(store.rebuildStatus$.get().state).toBe("idle");
  });
});

describe("createAppStateStore derived indexes", () => {
  const taskNote = makeNote({
    id: "n-tasks",
    body: "- [ ] Koupit mléko\n- [x] Zavolat Petrovi",
    urls: ["https://example.com/a"],
  });

  it("derives summaries, tasks and links from the seeded workspace", () => {
    storeWorkspace(makeWorkspace([taskNote]));

    const store = createStoreAt("/");

    expect(store.noteSummaries$.get().map((summary) => summary.id)).toEqual(["n-tasks"]);
    expect(store.taskIndex$.get().tasks.map((task) => task.text)).toEqual([
      "Koupit mléko",
      "Zavolat Petrovi",
    ]);
    expect(store.linkIndex$.get().links.map((link) => link.url)).toEqual([
      "https://example.com/a",
    ]);
  });

  it("recomputes all three indexes when the workspace changes", () => {
    // An empty local slot yields `createWorkspace()` — one blank starter note,
    // so the baseline is 1 summary and 0 tasks, not an empty everything.
    const store = createStoreAt("/");
    expect(store.noteSummaries$.get()).toHaveLength(1);

    store.setWorkspace(makeWorkspace([taskNote]));

    expect(store.noteSummaries$.get().map((summary) => summary.id)).toEqual(["n-tasks"]);
    expect(store.taskIndex$.get().tasks).toHaveLength(2);
    expect(store.linkIndex$.get().links).toHaveLength(1);
  });

  it("carries a placeholder's summary and tasks forward instead of blanking them", () => {
    // The reconcile helpers only preserve previous data if the subscription
    // passes them the *current* atom value. Hand them `[]` instead and a
    // body-less placeholder wipes the note's card metadata and tasks — the
    // data-loss shape this subscription exists to prevent.
    const store = createStoreAt("/");
    store.setWorkspace(makeWorkspace([taskNote]));

    store.setWorkspace(
      makeWorkspace([{ ...taskNote, body: "", urls: [], hydrated: false }]),
    );

    expect(store.noteSummaries$.get().map((summary) => summary.id)).toEqual(["n-tasks"]);
    expect(store.taskIndex$.get().tasks.map((task) => task.text)).toEqual([
      "Koupit mléko",
      "Zavolat Petrovi",
    ]);
  });

  it("drops a note's links as soon as it leaves the workspace", () => {
    // Links stay on the plain builder (no carry-forward), so this is the
    // half of the subscription that must *not* preserve anything.
    const store = createStoreAt("/");
    store.setWorkspace(makeWorkspace([taskNote]));
    expect(store.linkIndex$.get().links).toHaveLength(1);

    store.setWorkspace(makeWorkspace([makeNote({ id: "n-other" })]));

    expect(store.linkIndex$.get().links).toEqual([]);
  });
});

describe("createAppStateStore persist subscribers", () => {
  it("writes the notebook view mode", () => {
    const store = createStoreAt("/");
    store.setNotesViewMode("list");
    expect(localStorage.getItem(KEYS.notesView)).toBe("list");
  });

  it("writes the links view mode to its own key", () => {
    const store = createStoreAt("/");
    store.setLinksViewMode("list");
    expect(localStorage.getItem(KEYS.linksView)).toBe("list");
    // Both view modes default to "cards" and share the `?view=` parameter;
    // crossing the wires here would make one silently overwrite the other.
    expect(localStorage.getItem(KEYS.notesView)).toBeNull();
  });

  it("writes the persona preference", () => {
    const store = createStoreAt("/");
    store.setPersonaPreference("on");
    expect(localStorage.getItem(KEYS.persona)).toBe("on");
  });

  it("writes the capture-location preference", () => {
    const store = createStoreAt("/");
    store.setCaptureLocationPreference("on");
    expect(localStorage.getItem(KEYS.captureLocation)).toBe("on");
  });

  it("writes the visible tag classes as a CSV", () => {
    const store = createStoreAt("/");
    store.setVisibleTagClasses(new Set(["topic", "place"]));
    expect(localStorage.getItem(KEYS.visibleTagClasses)).toBe("topic,place");
  });

  it("writes the dismissed alias pairs", () => {
    const store = createStoreAt("/");
    store.setDismissedTagAliases(new Set(["praha|prague"]));
    expect(localStorage.getItem(KEYS.dismissedAliases)).toBe("praha|prague");
  });

  it("writes the recent tag filters as JSON", () => {
    const store = createStoreAt("/");
    store.setRecentTagFilters(["praha", "brno"]);
    expect(localStorage.getItem(KEYS.recentFilters)).toBe('["praha","brno"]');
  });

  it("both persists the theme and applies it to the document", () => {
    // Two side effects behind one subscriber: dropping either one leaves a
    // user who picked "midnight" staring at the default palette (apply lost)
    // or back on it after a reload (persist lost).
    const store = createStoreAt("/");

    store.setCurrentTheme("midnight");

    expect(localStorage.getItem(KEYS.theme)).toBe("midnight");
    expect(document.documentElement.dataset.theme).toBe("midnight");
  });

  it("does not write again when a setter lands on the value already held", () => {
    // The atom's `Object.is` short-circuit is what makes "mutation always
    // persists" cheap: a toggle that ends where it started must not churn
    // localStorage. Clearing the key and re-setting the same value proves
    // the subscriber never ran, without mocking Storage.
    const store = createStoreAt("/");
    store.setNotesViewMode("list");
    localStorage.removeItem(KEYS.notesView);

    store.setNotesViewMode("list");

    expect(localStorage.getItem(KEYS.notesView)).toBeNull();
  });

  it("leaves transient UI state out of storage", () => {
    const store = createStoreAt("/");
    const before = localStorage.length;

    store.setLocationConsentBlocked(true);
    store.setTasksFilter("stale");
    store.setTasksShowDone(true);
    store.setTagsSearchQuery("praha");
    store.setRebuildStatus({ state: "running" });

    expect(localStorage.length).toBe(before);
  });
});

describe("createAppStateStore dispose", () => {
  it("stops persisting preference changes", () => {
    const store = createStoreAt("/");

    store.dispose();
    store.setNotesViewMode("list");

    expect(localStorage.getItem(KEYS.notesView)).toBeNull();
    // The atom itself still works — only the side effect is gone.
    expect(store.notesViewMode$.get()).toBe("list");
  });

  it("stops syncing the derived indexes", () => {
    const store = createStoreAt("/");
    const seeded = store.noteSummaries$.get().map((summary) => summary.id);

    store.dispose();
    store.setWorkspace(makeWorkspace([makeNote({ id: "after-dispose" })]));

    expect(store.workspace$.get().notes.map((note) => note.id)).toEqual(["after-dispose"]);
    // The summaries atom still holds the pre-dispose derivation.
    expect(store.noteSummaries$.get().map((summary) => summary.id)).toEqual(seeded);
  });

  it("is safe to call twice", () => {
    // HMR teardown can run more than once against the same store; the
    // disposers are idempotent and must not throw on the second pass.
    const store = createStoreAt("/");

    store.dispose();
    expect(() => store.dispose()).not.toThrow();
  });
});

describe("createAppStateStore setters and render wiring", () => {
  it("routes every setter to its own atom", () => {
    const store = createStoreAt("/");
    const workspace = makeWorkspace([makeNote({ id: "n-set" })]);

    store.setProfile({ email: "filip@example.com", name: "Filip", picture: "" });
    store.setWorkspace(workspace);
    store.setNoteSummaries([]);
    store.setSyncState("saving");
    store.setLastError("boom");
    store.setBookmarkletMessage("hotovo");
    store.setSelectedTagFilters(["praha"]);
    store.setFilterMode("any");
    store.setActiveMenuItem("tags");
    store.setDetailNoteId("n-set");
    store.setNotesViewMode("list");
    store.setLinksViewMode("list");
    store.setCurrentTheme("dark");
    store.setPersonaPreference("on");
    store.setCaptureLocationPreference("on");
    store.setLocationConsentBlocked(true);
    store.setTasksFilter("stale");
    store.setTasksShowDone(true);
    store.setTasksOneThingKey("n-set:1");
    store.setVisibleTagClasses(new Set(["topic"]));
    store.setTagsSearchQuery("praha");
    store.setDismissedTagAliases(new Set(["a|b"]));

    expect(store.profile$.get()?.email).toBe("filip@example.com");
    expect(store.workspace$.get()).toBe(workspace);
    expect(store.syncState$.get()).toBe("saving");
    expect(store.lastError$.get()).toBe("boom");
    expect(store.bookmarkletMessage$.get()).toBe("hotovo");
    expect(store.selectedTagFilters$.get()).toEqual(["praha"]);
    expect(store.filterMode$.get()).toBe("any");
    expect(store.activeMenuItem$.get()).toBe("tags");
    expect(store.detailNoteId$.get()).toBe("n-set");
    expect(store.notesViewMode$.get()).toBe("list");
    expect(store.linksViewMode$.get()).toBe("list");
    expect(store.currentTheme$.get()).toBe("dark");
    expect(store.personaPreference$.get()).toBe("on");
    expect(store.captureLocationPreference$.get()).toBe("on");
    expect(store.locationConsentBlocked$.get()).toBe(true);
    expect(store.tasksFilter$.get()).toBe("stale");
    expect(store.tasksShowDone$.get()).toBe(true);
    expect(store.tasksOneThingKey$.get()).toBe("n-set:1");
    expect([...store.visibleTagClasses$.get()]).toEqual(["topic"]);
    expect(store.tagsSearchQuery$.get()).toBe("praha");
    expect([...store.dismissedTagAliases$.get()]).toEqual(["a|b"]);
  });

  it("routes the index and rebuild setters to their own atoms", () => {
    // These four are the ones `app.ts` calls directly after a Drive load or a
    // maintenance rebuild, rather than letting the `workspace$` subscription
    // derive them — so each needs an assertion of its own. The starter
    // workspace seeds one summary, which is what makes clearing the summaries
    // observable here.
    const store = createStoreAt("/");
    expect(store.noteSummaries$.get()).toHaveLength(1);
    const taskIndex: SutraPadTaskIndex = {
      version: 1,
      savedAt: "2026-08-01T00:00:00.000Z",
      tasks: [],
    };
    const linkIndex: SutraPadLinkIndex = {
      version: 1,
      savedAt: "2026-08-01T00:00:00.000Z",
      links: [],
    };

    store.setNoteSummaries([]);
    store.setTaskIndex(taskIndex);
    store.setLinkIndex(linkIndex);
    store.setRebuildStatus({ state: "done", noteCount: 3 });

    expect(store.noteSummaries$.get()).toEqual([]);
    expect(store.taskIndex$.get()).toBe(taskIndex);
    expect(store.linkIndex$.get()).toBe(linkIndex);
    expect(store.rebuildStatus$.get()).toEqual({ state: "done", noteCount: 3 });
  });

  it("copies the recent-filter list so a caller's later mutation cannot leak in", () => {
    const store = createStoreAt("/");
    const caller = ["praha"];

    store.setRecentTagFilters(caller);
    caller.push("brno");

    expect(store.recentTagFilters$.get()).toEqual(["praha"]);
  });

  it("re-persists the recent filters when the same contents arrive as a new array", () => {
    // The defensive copy is also what makes the atom's identity check
    // meaningful: an equal-but-distinct array is a real change here.
    const store = createStoreAt("/");
    store.setRecentTagFilters(["praha"]);
    localStorage.removeItem(KEYS.recentFilters);

    store.setRecentTagFilters(["praha"]);

    expect(localStorage.getItem(KEYS.recentFilters)).toBe('["praha"]');
  });

  it("exposes exactly the user-visible atoms for render scheduling", () => {
    const store = createStoreAt("/");

    expect(store.renderingAtoms).toEqual([
      store.workspace$,
      store.profile$,
      store.syncState$,
      store.lastError$,
      store.bookmarkletMessage$,
      store.selectedTagFilters$,
      store.filterMode$,
      store.activeMenuItem$,
      store.detailNoteId$,
      store.notesViewMode$,
      store.linksViewMode$,
      store.tasksFilter$,
      store.tasksShowDone$,
      store.tasksOneThingKey$,
      store.visibleTagClasses$,
      store.tagsSearchQuery$,
      store.dismissedTagAliases$,
      store.recentTagFilters$,
      store.currentTheme$,
      store.personaPreference$,
      store.captureLocationPreference$,
      store.locationConsentBlocked$,
    ]);
  });

  it("keeps internal and explicitly-rendered atoms out of the render list", () => {
    // `autoSaveTimer$` / `paletteAccess$` are not user-visible; the Phase 2
    // index atoms and `rebuildStatus$` are rendered by explicit `render()`
    // calls in `app.ts` instead. Either one landing in this list means a
    // render per autosave tick or per rebuild progress step.
    const store = createStoreAt("/");

    for (const internal of [
      store.autoSaveTimer$,
      store.paletteAccess$,
      store.noteSummaries$,
      store.taskIndex$,
      store.linkIndex$,
      store.rebuildStatus$,
    ]) {
      expect(store.renderingAtoms).not.toContain(internal);
    }
  });

  it("notifies through every atom in the render list", () => {
    // `createApp` subscribes `scheduleRender` to this list once; if any entry
    // were a plain value rather than a live atom the app would stop
    // repainting for that slice of state.
    const store = createStoreAt("/");
    const seen = new Set<number>();
    for (const [index, source] of store.renderingAtoms.entries()) {
      source.subscribe(() => seen.add(index));
    }

    store.setLastError("boom");

    expect(seen).toEqual(new Set([3]));
  });
});
