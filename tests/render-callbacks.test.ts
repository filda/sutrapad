// @vitest-environment happy-dom
//
// First focused test for `src/app/render-callbacks.ts` — 599 lines wiring
// ~35 UI gestures to state mutations, persistence and side effects. Until now
// only `create-app-smoke.test.ts` executed it, and that suite asserts on
// rendered HTML: it cannot see that a handler forgot to persist, skipped its
// autosave, or navigated without dropping the empty draft first.
//
// The module is a pure function of its 35-callback options bag, so the whole
// surface is reachable by handing it spies and asserting on the calls. Three
// things this leans on deliberately:
//
//   - `replaceCurrentNote` / `replaceNote` fakes *apply* the updater they are
//     given and record the result. Most of the interesting logic lives inside
//     those writer closures (which fields get stamped, whether `urls` is
//     re-extracted, which tag list is committed) and a spy that merely counts
//     calls would leave all of it unasserted.
//   - the four `sync*ToLocation` helpers are the real ones, so the URL
//     assertions here check the actual `history.replaceState` result rather
//     than a mock's argument.
//   - `runLocationBackfill` is mocked: it owns the geolocation round-trip and
//     has its own suite (`tests/run-location-backfill.test.ts`). What matters
//     here is *whether* and *with what note id* it gets kicked off.
//
// Guard rails worth knowing: the "purge the untouched draft before navigating"
// sweep is asserted on every nav path, because a missed one means an Untitled
// stub rides along to Drive.
//
// One survivor in the mutation report is equivalent: `onMergeTagAlias`'s
// `if (from === to) return` is a duplicate of the identical early return
// inside `mergeTagInWorkspace`, so removing the outer one changes nothing
// observable — the helper hands back the same workspace reference and the
// `next === current` check below catches it. The handler's guard only saves a
// `getWorkspace()` call; it could be deleted outright if we ever want the
// mutant gone rather than explained.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/lifecycle/run-location-backfill", () => ({
  runLocationBackfill: vi.fn(() => Promise.resolve()),
}));

import { runLocationBackfill } from "../src/app/lifecycle/run-location-backfill";
import {
  createRenderCallbacks,
  type RenderCallbackOptions,
} from "../src/app/render-callbacks";
import type { GoogleAuthService } from "../src/services/google-auth";
import type { TagClassId } from "../src/app/logic/tag-class";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

const makeNote = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "tělo",
  urls: [],
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  tags: [],
  ...overrides,
});

interface HarnessState {
  workspace: SutraPadWorkspace;
  selectedTagFilters: string[];
  filterMode: "all" | "any";
  activeMenuItem: Parameters<RenderCallbackOptions["setActiveMenuItem"]>[0];
  detailNoteId: string | null;
  visibleTagClasses: Set<TagClassId>;
  tagsSearchQuery: string;
  dismissedTagAliases: Set<string>;
  recentTagFilters: readonly string[];
}

/**
 * Builds the callback bag against spies plus a mutable state object, so
 * handlers that read-after-write within one gesture (`onApplyTagFilter`
 * rotating the recents it just read) see their own effect.
 */
function harness(initial: Partial<HarnessState> = {}) {
  const state: HarnessState = {
    workspace: { notes: [makeNote()], activeNoteId: "n-1" },
    selectedTagFilters: [],
    filterMode: "all",
    activeMenuItem: "notes",
    detailNoteId: null,
    visibleTagClasses: new Set<TagClassId>(["topic", "place"]),
    tagsSearchQuery: "",
    dismissedTagAliases: new Set<string>(),
    recentTagFilters: [],
    ...initial,
  };

  /** Notes produced by the `replaceCurrentNote` / `replaceNote` writers. */
  const writes: Array<{ noteId: string; note: SutraPadDocument }> = [];

  const auth = {
    signIn: vi.fn(() => Promise.resolve({ email: "f@example.com", name: "Filip", picture: "" })),
    signOut: vi.fn(),
  };

  const spies = {
    setProfile: vi.fn(),
    setWorkspace: vi.fn((next: SutraPadWorkspace) => {
      state.workspace = next;
    }),
    setSyncState: vi.fn(),
    setLastError: vi.fn(),
    setBookmarkletMessage: vi.fn(),
    setSelectedTagFilters: vi.fn((next: string[]) => {
      state.selectedTagFilters = next;
    }),
    setFilterMode: vi.fn((next: "all" | "any") => {
      state.filterMode = next;
    }),
    setActiveMenuItem: vi.fn((next: HarnessState["activeMenuItem"]) => {
      state.activeMenuItem = next;
    }),
    setDetailNoteId: vi.fn((next: string | null) => {
      state.detailNoteId = next;
    }),
    setNotesViewMode: vi.fn(),
    setLinksViewMode: vi.fn(),
    setTasksFilter: vi.fn(),
    setTasksShowDone: vi.fn(),
    setTasksOneThingKey: vi.fn(),
    setVisibleTagClasses: vi.fn((next: Set<TagClassId>) => {
      state.visibleTagClasses = next;
    }),
    setTagsSearchQuery: vi.fn((next: string) => {
      state.tagsSearchQuery = next;
    }),
    setDismissedTagAliases: vi.fn((next: Set<string>) => {
      state.dismissedTagAliases = next;
    }),
    setRecentTagFilters: vi.fn((next: readonly string[]) => {
      state.recentTagFilters = next;
    }),
    setCurrentTheme: vi.fn(),
    setPersonaPreference: vi.fn(),
    setCaptureLocationPreference: vi.fn(),
    setLocationConsentBlocked: vi.fn(),
    handleNewNote: vi.fn(),
    purgeEmptyDraftNotes: vi.fn(() => false),
    loadWorkspace: vi.fn(() => Promise.resolve()),
    saveWorkspace: vi.fn(() => Promise.resolve()),
    restoreWorkspaceAfterSignIn: vi.fn(() => Promise.resolve()),
    rebuildIndex: vi.fn(() => Promise.resolve()),
    persistWorkspace: vi.fn(),
    scheduleAutoSave: vi.fn(),
    render: vi.fn(),
    refreshNotesPanel: vi.fn(),
  };

  const applyTo = (noteId: string, updater: (note: SutraPadDocument) => SutraPadDocument) => {
    const target = state.workspace.notes.find((entry) => entry.id === noteId);
    if (!target) return;
    const next = updater(target);
    writes.push({ noteId, note: next });
    state.workspace = {
      ...state.workspace,
      notes: state.workspace.notes.map((entry) => (entry.id === noteId ? next : entry)),
    };
  };

  const callbacks = createRenderCallbacks({
    auth: auth as unknown as GoogleAuthService,
    appRootUrl: "https://sutrapad.example/",
    getWorkspace: () => state.workspace,
    getSelectedTagFilters: () => state.selectedTagFilters,
    getFilterMode: () => state.filterMode,
    getActiveMenuItem: () => state.activeMenuItem,
    getDetailNoteId: () => state.detailNoteId,
    getVisibleTagClasses: () => state.visibleTagClasses,
    getTagsSearchQuery: () => state.tagsSearchQuery,
    getDismissedTagAliases: () => state.dismissedTagAliases,
    getRecentTagFilters: () => state.recentTagFilters,
    replaceCurrentNote: vi.fn((updater) => {
      applyTo(state.workspace.activeNoteId ?? state.workspace.notes[0].id, updater);
    }),
    replaceNote: vi.fn((noteId: string, updater) => {
      applyTo(noteId, updater);
    }),
    ...spies,
  });

  return { callbacks, spies, state, writes, auth, lastWrite: () => writes.at(-1) };
}

/** Latest note handed to a `replace*` writer, for field-level assertions. */
function written(h: ReturnType<typeof harness>): SutraPadDocument {
  const write = h.lastWrite();
  if (!write) throw new Error("no note write was recorded");
  return write.note;
}

/** Replaces `navigator.clipboard` for the bookmarklet-copy handler. */
function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

/**
 * Replaces `navigator.permissions`. `"unavailable"` removes the API entirely,
 * which is what `resolveGeolocationPermissionState` maps to `null`.
 */
function stubPermissions(state: PermissionState | "unavailable"): void {
  Object.defineProperty(navigator, "permissions", {
    value: state === "unavailable" ? undefined : { query: () => Promise.resolve({ state }) },
    configurable: true,
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  document.body.innerHTML = "";
  vi.mocked(runLocationBackfill).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRenderCallbacks preference passthroughs", () => {
  it("hands each preference gesture straight to its setter", () => {
    // These are one-liners on purpose: the atom store's `Object.is` check and
    // persist subscribers do the rest. What can still break is the wiring —
    // a handler pointed at the wrong setter.
    const h = harness();

    h.callbacks.onChangeNotesView("list");
    h.callbacks.onChangeLinksView("list");
    h.callbacks.onChangeTasksFilter("stale");
    h.callbacks.onToggleTasksShowDone(true);
    h.callbacks.onSetOneThing("n-1:2");
    h.callbacks.onChangeTheme("midnight");
    h.callbacks.onChangePersonaPreference("on");
    h.callbacks.onChangeCaptureLocationPreference("on");

    expect(h.spies.setNotesViewMode).toHaveBeenCalledExactlyOnceWith("list");
    expect(h.spies.setLinksViewMode).toHaveBeenCalledExactlyOnceWith("list");
    expect(h.spies.setTasksFilter).toHaveBeenCalledExactlyOnceWith("stale");
    expect(h.spies.setTasksShowDone).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.spies.setTasksOneThingKey).toHaveBeenCalledExactlyOnceWith("n-1:2");
    expect(h.spies.setCurrentTheme).toHaveBeenCalledExactlyOnceWith("midnight");
    expect(h.spies.setPersonaPreference).toHaveBeenCalledExactlyOnceWith("on");
    expect(h.spies.setCaptureLocationPreference).toHaveBeenCalledExactlyOnceWith("on");
  });

  it("commits the 'Not now' consent choice as off", () => {
    const h = harness();

    h.callbacks.onDenyLocationCapture();

    expect(h.spies.setCaptureLocationPreference).toHaveBeenCalledExactlyOnceWith("off");
  });

  it("toggles a tag class off and back on", () => {
    const h = harness();

    h.callbacks.onToggleTagClass("topic");
    expect([...h.state.visibleTagClasses]).not.toContain("topic");
    expect([...h.state.visibleTagClasses]).toContain("place");

    h.callbacks.onToggleTagClass("topic");
    expect([...h.state.visibleTagClasses]).toContain("topic");
  });

  it("records a dismissed alias pair", () => {
    const h = harness();

    h.callbacks.onDismissTagAlias("praha", "prague");

    expect(h.spies.setDismissedTagAliases).toHaveBeenCalledOnce();
    expect([...h.state.dismissedTagAliases]).toHaveLength(1);
  });
});

describe("createRenderCallbacks tags-search input", () => {
  it("renders synchronously and restores focus with the caret at the end", () => {
    // The synchronous render pre-empts the atom-driven microtask so the focus
    // restore below lands on the freshly-mounted input, not the doomed one.
    const h = harness();
    h.spies.render.mockImplementation(() => {
      document.body.innerHTML = '<input class="tags-search-input" value="praha">';
    });

    h.callbacks.onChangeTagsSearchQuery("praha");

    expect(h.spies.setTagsSearchQuery).toHaveBeenCalledExactlyOnceWith("praha");
    expect(h.spies.render).toHaveBeenCalledOnce();
    const input = document.querySelector<HTMLInputElement>(".tags-search-input");
    expect(document.activeElement).toBe(input);
    expect(input?.selectionStart).toBe("praha".length);
  });

  it("leaves the caret alone when the render did not replace the input", () => {
    // The `document.activeElement !== nextInput` half of the guard: when the
    // render happened to keep the same node (or focus never left it),
    // re-focusing would slam the caret to the end mid-word.
    const h = harness();
    document.body.innerHTML = '<input class="tags-search-input" value="praha">';
    const input = document.querySelector<HTMLInputElement>(".tags-search-input");
    input?.focus();
    input?.setSelectionRange(2, 2);

    h.callbacks.onChangeTagsSearchQuery("praha-nove");

    expect(input?.selectionStart).toBe(2);
  });

  it("does nothing when the query has not actually changed", () => {
    const h = harness({ tagsSearchQuery: "praha" });

    h.callbacks.onChangeTagsSearchQuery("praha");

    expect(h.spies.setTagsSearchQuery).not.toHaveBeenCalled();
    expect(h.spies.render).not.toHaveBeenCalled();
  });

  it("survives a render that mounts no search input", () => {
    // The Tags page can navigate away in the same turn; the handler must not
    // throw on the missing node.
    const h = harness();

    expect(() => h.callbacks.onChangeTagsSearchQuery("praha")).not.toThrow();
  });
});

describe("createRenderCallbacks tag-alias merge", () => {
  const taggedWorkspace = (): SutraPadWorkspace => ({
    notes: [makeNote({ id: "n-1", tags: ["praha"] }), makeNote({ id: "n-2", tags: ["brno"] })],
    activeNoteId: "n-1",
  });

  it("merges the tag, persists and schedules a save", () => {
    const h = harness({ workspace: taggedWorkspace() });

    h.callbacks.onMergeTagAlias("praha", "prague");

    expect(h.state.workspace.notes[0].tags).toEqual(["prague"]);
    expect(h.spies.persistWorkspace).toHaveBeenCalledOnce();
    expect(h.spies.scheduleAutoSave).toHaveBeenCalledOnce();
  });

  it("carries an active filter from the old tag to the new one", () => {
    const h = harness({
      workspace: taggedWorkspace(),
      selectedTagFilters: ["praha", "brno"],
    });

    h.callbacks.onMergeTagAlias("praha", "prague");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith(["prague", "brno"]);
  });

  it("drops the duplicate when both tags were already filtered on", () => {
    const h = harness({
      workspace: taggedWorkspace(),
      selectedTagFilters: ["praha", "prague"],
    });

    h.callbacks.onMergeTagAlias("praha", "prague");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith(["prague"]);
  });

  it("leaves the filter strip alone when the merged tag was not filtered on", () => {
    const h = harness({ workspace: taggedWorkspace(), selectedTagFilters: ["brno"] });

    h.callbacks.onMergeTagAlias("praha", "prague");

    expect(h.spies.setSelectedTagFilters).not.toHaveBeenCalled();
  });

  it("does nothing when the two tags are the same", () => {
    const h = harness({ workspace: taggedWorkspace() });

    h.callbacks.onMergeTagAlias("praha", "praha");

    expect(h.spies.setWorkspace).not.toHaveBeenCalled();
    expect(h.spies.scheduleAutoSave).not.toHaveBeenCalled();
  });

  it("does nothing when no note carries the tag", () => {
    const h = harness({ workspace: taggedWorkspace() });

    h.callbacks.onMergeTagAlias("ostrava", "moravia");

    expect(h.spies.setWorkspace).not.toHaveBeenCalled();
    expect(h.spies.persistWorkspace).not.toHaveBeenCalled();
    expect(h.spies.scheduleAutoSave).not.toHaveBeenCalled();
  });
});

describe("createRenderCallbacks navigation", () => {
  it("treats an action menu item as 'new note' and navigates nowhere", () => {
    const h = harness();

    h.callbacks.onSelectMenuItem("add");

    expect(h.spies.handleNewNote).toHaveBeenCalledOnce();
    expect(h.spies.setActiveMenuItem).not.toHaveBeenCalled();
    expect(h.spies.purgeEmptyDraftNotes).not.toHaveBeenCalled();
  });

  it("ignores a tap on the page already showing its list", () => {
    const h = harness({ activeMenuItem: "tasks", detailNoteId: null });

    h.callbacks.onSelectMenuItem("tasks");

    expect(h.spies.setActiveMenuItem).not.toHaveBeenCalled();
    expect(h.spies.purgeEmptyDraftNotes).not.toHaveBeenCalled();
  });

  it("returns to the list when the same page is tapped from a detail view", () => {
    // Same menu id, but a detail note is open — the tap means "back to the
    // list", so it must not be swallowed by the no-op guard.
    const h = harness({ activeMenuItem: "notes", detailNoteId: "n-1" });

    h.callbacks.onSelectMenuItem("notes");

    expect(h.spies.purgeEmptyDraftNotes).toHaveBeenCalledOnce();
    expect(h.spies.setActiveMenuItem).toHaveBeenCalledExactlyOnceWith("notes");
    expect(h.spies.setDetailNoteId).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("drops the untouched draft before switching pages", () => {
    const h = harness({ activeMenuItem: "notes" });

    h.callbacks.onSelectMenuItem("tags");

    expect(h.spies.purgeEmptyDraftNotes).toHaveBeenCalledOnce();
    expect(h.spies.setActiveMenuItem).toHaveBeenCalledExactlyOnceWith("tags");
    expect(h.spies.setDetailNoteId).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("opens a note: purge, route to the notebook, rebind active, persist", () => {
    const h = harness({ activeMenuItem: "home" });

    h.callbacks.onSelectNote("n-1");

    expect(h.spies.purgeEmptyDraftNotes).toHaveBeenCalledOnce();
    expect(h.spies.setActiveMenuItem).toHaveBeenCalledExactlyOnceWith("notes");
    expect(h.spies.setDetailNoteId).toHaveBeenCalledExactlyOnceWith("n-1");
    expect(h.state.workspace.activeNoteId).toBe("n-1");
    expect(h.spies.persistWorkspace).toHaveBeenCalledExactlyOnceWith(h.state.workspace);
  });

  it("goes back to the list without changing the page", () => {
    const h = harness({ detailNoteId: "n-1" });

    h.callbacks.onBackToNotes();

    expect(h.spies.purgeEmptyDraftNotes).toHaveBeenCalledOnce();
    expect(h.spies.setDetailNoteId).toHaveBeenCalledExactlyOnceWith(null);
    expect(h.spies.setActiveMenuItem).not.toHaveBeenCalled();
  });

  it("clears the detail context before flipping to the capture page", () => {
    // Order matters: a render between the two would otherwise see a detail
    // route on the capture page.
    const h = harness({ detailNoteId: "n-1" });

    h.callbacks.onOpenCapture();

    expect(h.spies.purgeEmptyDraftNotes).toHaveBeenCalledOnce();
    expect(h.spies.setDetailNoteId).toHaveBeenCalledExactlyOnceWith(null);
    expect(h.spies.setActiveMenuItem).toHaveBeenCalledExactlyOnceWith("capture");
    expect(h.spies.setDetailNoteId.mock.invocationCallOrder[0]).toBeLessThan(
      h.spies.setActiveMenuItem.mock.invocationCallOrder[0],
    );
  });

  it("routes 'new note' to the same handler the menu action uses", () => {
    const h = harness();

    h.callbacks.onNewNote();

    expect(h.spies.handleNewNote).toHaveBeenCalledOnce();
  });
});

describe("createRenderCallbacks tag filters", () => {
  it("adds a filter, reselects a visible note and writes the URL", () => {
    const h = harness();

    h.callbacks.onToggleTagFilter("praha");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith(["praha"]);
    expect(h.spies.setWorkspace).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("?tags=praha");
  });

  it("removes an active filter on a second toggle", () => {
    const h = harness({ selectedTagFilters: ["praha"] });
    window.history.replaceState({}, "", "/?tags=praha");

    h.callbacks.onToggleTagFilter("praha");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith([]);
    expect(window.location.search).toBe("");
  });

  it("adds a typeahead commit and rotates it into the recents", () => {
    const h = harness({ recentTagFilters: ["brno"] });

    h.callbacks.onApplyTagFilter("praha");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith(["praha"]);
    expect(h.spies.setRecentTagFilters).toHaveBeenCalledExactlyOnceWith(["praha", "brno"]);
    expect(window.location.search).toBe("?tags=praha");
  });

  it("never un-filters on a stale suggestion click, but still bumps the recents", () => {
    // `onApplyTagFilter` is add-only by design — the palette's toggle path is
    // the one allowed to remove. A second commit of an active tag must leave
    // the filter alone and only reorder the recents.
    const h = harness({ selectedTagFilters: ["praha"], recentTagFilters: ["brno", "praha"] });

    h.callbacks.onApplyTagFilter("praha");

    expect(h.spies.setSelectedTagFilters).not.toHaveBeenCalled();
    expect(h.spies.setWorkspace).not.toHaveBeenCalled();
    expect(h.spies.setRecentTagFilters).toHaveBeenCalledExactlyOnceWith(["praha", "brno"]);
  });

  it("clears every filter and strips the query parameter", () => {
    const h = harness({ selectedTagFilters: ["praha", "brno"] });
    window.history.replaceState({}, "", "/?tags=brno,praha");

    h.callbacks.onClearTagFilters();

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith([]);
    expect(window.location.search).toBe("");
  });

  it("removes one filter and leaves the rest in place", () => {
    const h = harness({ selectedTagFilters: ["praha", "brno"] });

    h.callbacks.onRemoveSelectedFilter("praha");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledExactlyOnceWith(["brno"]);
    expect(window.location.search).toBe("?tags=brno");
  });

  it("switches the match mode and writes it to the URL", () => {
    const h = harness({ filterMode: "all", selectedTagFilters: ["praha"] });

    h.callbacks.onChangeFilterMode("any");

    expect(h.spies.setFilterMode).toHaveBeenCalledExactlyOnceWith("any");
    expect(h.spies.setWorkspace).toHaveBeenCalledOnce();
    expect(window.location.search).toContain("tagsMode=any");
  });

  it("ignores a match-mode change that is already in effect", () => {
    const h = harness({ filterMode: "all" });

    h.callbacks.onChangeFilterMode("all");

    expect(h.spies.setFilterMode).not.toHaveBeenCalled();
    expect(h.spies.setWorkspace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});

describe("createRenderCallbacks account actions", () => {
  it("signs in: clears the error, stores the profile, restores the workspace", async () => {
    const h = harness();

    h.callbacks.onSignIn();
    await vi.waitFor(() => expect(h.spies.restoreWorkspaceAfterSignIn).toHaveBeenCalledOnce());

    expect(h.spies.setSyncState).toHaveBeenCalledWith("loading");
    expect(h.spies.setLastError).toHaveBeenCalledWith("");
    expect(h.spies.setProfile).toHaveBeenCalledWith(
      expect.objectContaining({ email: "f@example.com" }),
    );
  });

  it("surfaces a failed sign-in as an error state with the thrown message", async () => {
    const h = harness();
    h.auth.signIn.mockRejectedValueOnce(new Error("popup closed"));

    h.callbacks.onSignIn();
    await vi.waitFor(() => expect(h.spies.setLastError).toHaveBeenCalledWith("popup closed"));

    expect(h.spies.setSyncState).toHaveBeenCalledWith("error");
    expect(h.spies.restoreWorkspaceAfterSignIn).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the rejection is not an Error", async () => {
    const h = harness();
    h.auth.signIn.mockRejectedValueOnce("nope");

    h.callbacks.onSignIn();
    await vi.waitFor(() =>
      expect(h.spies.setLastError).toHaveBeenCalledWith("Sign-in failed."),
    );
  });

  it("signs out and resets the session state", () => {
    const h = harness();

    h.callbacks.onSignOut();

    expect(h.auth.signOut).toHaveBeenCalledOnce();
    expect(h.spies.setProfile).toHaveBeenCalledExactlyOnceWith(null);
    expect(h.spies.setSyncState).toHaveBeenCalledExactlyOnceWith("idle");
    expect(h.spies.setLastError).toHaveBeenCalledExactlyOnceWith("");
  });

  it("kicks off the load, save and rebuild flows", () => {
    const h = harness();

    h.callbacks.onLoadNotebook();
    h.callbacks.onSaveNotebook();
    h.callbacks.onRebuildIndex();

    expect(h.spies.loadWorkspace).toHaveBeenCalledOnce();
    expect(h.spies.saveWorkspace).toHaveBeenCalledOnce();
    expect(h.spies.rebuildIndex).toHaveBeenCalledOnce();
  });
});

describe("createRenderCallbacks bookmarklet copy", () => {
  it("copies the bookmarklet and explains the Safari workaround", async () => {
    const h = harness();
    const writeText = vi.fn((_text: string) => Promise.resolve());
    stubClipboard(writeText);

    h.callbacks.onCopyBookmarklet();
    await vi.waitFor(() => expect(h.spies.setBookmarkletMessage).toHaveBeenCalledOnce());

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("javascript:");
    expect(h.spies.setBookmarkletMessage.mock.calls[0][0]).toContain("Bookmarklet copied");
  });

  it("reports a clipboard rejection and logs the cause", async () => {
    const h = harness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubClipboard(() => Promise.reject(new Error("not allowed")));

    h.callbacks.onCopyBookmarklet();
    await vi.waitFor(() => expect(h.spies.setBookmarkletMessage).toHaveBeenCalledOnce());

    expect(h.spies.setBookmarkletMessage.mock.calls[0][0]).toContain("Copy failed");
    // The log line is the only place the underlying permission / focus error
    // surfaces, so both halves of it matter: without the prefix a devtools
    // reader can't tell which feature failed.
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Bookmarklet clipboard copy failed:",
      expect.any(Error),
    );
  });
});

describe("createRenderCallbacks location consent", () => {
  it("shows the blocked panel instead of firing a doomed position request", async () => {
    const h = harness({ detailNoteId: "n-1" });
    stubPermissions("denied");

    await h.callbacks.onAllowLocationCapture();

    expect(h.spies.setLocationConsentBlocked).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.spies.setCaptureLocationPreference).not.toHaveBeenCalled();
    expect(runLocationBackfill).not.toHaveBeenCalled();
  });

  it("saves the preference and backfills the open draft when allowed", async () => {
    const h = harness({ detailNoteId: "n-1" });
    stubPermissions("granted");

    await h.callbacks.onAllowLocationCapture();

    expect(h.spies.setCaptureLocationPreference).toHaveBeenCalledExactlyOnceWith("on");
    expect(runLocationBackfill).toHaveBeenCalledOnce();
    expect(vi.mocked(runLocationBackfill).mock.calls[0][0]).toMatchObject({ noteId: "n-1" });
    expect(h.spies.setLocationConsentBlocked).not.toHaveBeenCalled();
  });

  it("treats a browser without the Permissions API as 'ask and see'", async () => {
    // `resolveGeolocationPermissionState` returns null there, which must not
    // be mistaken for "denied" — older Safari would lose the feature entirely.
    const h = harness({ detailNoteId: "n-1" });
    stubPermissions("unavailable");

    await h.callbacks.onAllowLocationCapture();

    expect(h.spies.setCaptureLocationPreference).toHaveBeenCalledExactlyOnceWith("on");
    expect(runLocationBackfill).toHaveBeenCalledOnce();
  });

  it("saves the preference but skips the backfill with no draft open", async () => {
    const h = harness({ detailNoteId: null });
    stubPermissions("prompt");

    await h.callbacks.onAllowLocationCapture();

    expect(h.spies.setCaptureLocationPreference).toHaveBeenCalledExactlyOnceWith("on");
    expect(runLocationBackfill).not.toHaveBeenCalled();
  });
});

describe("createRenderCallbacks title edits", () => {
  it("stamps the new title and refreshes the notes panel", () => {
    const h = harness();

    h.callbacks.onTitleInput("Nový titul");

    expect(written(h).title).toBe("Nový titul");
    expect(written(h).updatedAt).not.toBe("2026-08-01T10:00:00.000Z");
    expect(h.spies.setSyncState).toHaveBeenCalledExactlyOnceWith("idle");
    expect(h.spies.refreshNotesPanel).toHaveBeenCalledOnce();
  });

  it("drops the phantom input a re-render fires against itself", () => {
    // The title input is rebuilt on every render with the current value, so
    // an `input` event carrying the unchanged title is DOM noise — committing
    // it would bump `updatedAt` and trigger an autosave for nothing.
    const h = harness();

    h.callbacks.onTitleInput("První");

    expect(h.writes).toEqual([]);
    expect(h.spies.refreshNotesPanel).not.toHaveBeenCalled();
  });

  it("writes through the bound note id when the input carries one", () => {
    const h = harness({
      workspace: {
        notes: [makeNote({ id: "n-1" }), makeNote({ id: "n-2", title: "Druhá" })],
        activeNoteId: "n-1",
      },
    });

    h.callbacks.onTitleInput("Přepsaná", "n-2");

    expect(h.lastWrite()?.noteId).toBe("n-2");
    expect(written(h).title).toBe("Přepsaná");
  });

  it("silently drops an edit for a note the workspace no longer holds", () => {
    const h = harness();

    h.callbacks.onTitleInput("Nový titul", "n-gone");

    expect(h.writes).toEqual([]);
    expect(h.spies.setSyncState).not.toHaveBeenCalled();
  });
});

describe("createRenderCallbacks body edits", () => {
  it("commits the body, re-extracts URLs and keeps the panel fresh", () => {
    const h = harness();

    h.callbacks.onBodyInput("čti https://example.com/x", undefined);

    expect(written(h).body).toBe("čti https://example.com/x");
    expect(written(h).urls).toEqual(["https://example.com/x"]);
    expect(h.spies.refreshNotesPanel).toHaveBeenCalledOnce();
    expect(h.spies.render).not.toHaveBeenCalled();
  });

  it("re-renders instead of refreshing when a hashtag becomes a chip", () => {
    // A new tag has to appear in the chip row, which only a full render draws
    // — but the render swaps the textarea, hence the focus-preserving wrapper.
    const h = harness();

    h.callbacks.onBodyInput("tělo #praha ", undefined);

    expect(written(h).tags).toContain("praha");
    expect(h.spies.render).toHaveBeenCalledOnce();
    expect(h.spies.refreshNotesPanel).not.toHaveBeenCalled();
  });

  it("holds back a hashtag that is still being typed at the caret", () => {
    // Caret sits at the end of `#pra`, so the token is in flight: committing
    // it would create a `pra` tag the user never finished.
    const h = harness();
    const value = "tělo #pra";

    h.callbacks.onBodyInput(value, value.length);

    expect(written(h).tags).not.toContain("pra");
    expect(h.spies.render).not.toHaveBeenCalled();
  });

  it("drops the blur event a detaching render fires with an unchanged body", () => {
    const h = harness();

    h.callbacks.onBodyInput("tělo", undefined);

    expect(h.writes).toEqual([]);
    expect(h.spies.refreshNotesPanel).not.toHaveBeenCalled();
    expect(h.spies.render).not.toHaveBeenCalled();
  });

  it("routes a late blur to the note the textarea was mounted for", () => {
    // The failure this defends against: a refresh drops the note being typed
    // into, the render detaches the focused textarea, and the blur that
    // follows would stamp the stale value onto whatever is active now.
    const h = harness({
      workspace: {
        notes: [makeNote({ id: "n-1" }), makeNote({ id: "n-2", body: "jiné" })],
        activeNoteId: "n-1",
      },
    });

    h.callbacks.onBodyInput("pozdní text", undefined, "n-2");

    expect(h.lastWrite()?.noteId).toBe("n-2");
    expect(h.state.workspace.notes[0].body).toBe("tělo");
  });
});

describe("createRenderCallbacks task toggle", () => {
  const taskWorkspace = (): SutraPadWorkspace => ({
    notes: [
      makeNote({ id: "n-1", body: "- [ ] Koupit mléko\nvolný text" }),
      makeNote({ id: "n-2" }),
    ],
    activeNoteId: "n-2",
  });

  it("ticks the checkbox, persists and schedules a save", () => {
    const h = harness({ workspace: taskWorkspace() });

    h.callbacks.onToggleTask("n-1", 0);

    expect(h.state.workspace.notes[0].body).toContain("- [x] Koupit mléko");
    expect(h.spies.persistWorkspace).toHaveBeenCalledOnce();
    expect(h.spies.scheduleAutoSave).toHaveBeenCalledOnce();
  });

  it("keeps the previously active note active", () => {
    // `upsertNote` rebinds `activeNoteId` to the note it touched; ticking a
    // checkbox from the list must not hijack which note the editor shows.
    const h = harness({ workspace: taskWorkspace() });

    h.callbacks.onToggleTask("n-1", 0);

    expect(h.state.workspace.activeNoteId).toBe("n-2");
  });

  it("ignores a toggle for a note that is gone", () => {
    const h = harness({ workspace: taskWorkspace() });

    h.callbacks.onToggleTask("n-gone", 0);

    expect(h.spies.setWorkspace).not.toHaveBeenCalled();
    expect(h.spies.scheduleAutoSave).not.toHaveBeenCalled();
  });

  it("ignores a line that is not a task", () => {
    const h = harness({ workspace: taskWorkspace() });

    h.callbacks.onToggleTask("n-1", 1);

    expect(h.spies.setWorkspace).not.toHaveBeenCalled();
    expect(h.spies.persistWorkspace).not.toHaveBeenCalled();
    expect(h.spies.scheduleAutoSave).not.toHaveBeenCalled();
  });
});

describe("createRenderCallbacks manual tags", () => {
  it("normalises a typed tag before adding it", () => {
    const h = harness();

    h.callbacks.onAddTag("  Praha  ");

    expect(written(h).tags).toEqual(["praha"]);
    expect(h.spies.setSyncState).toHaveBeenCalledExactlyOnceWith("idle");
    expect(h.spies.render).toHaveBeenCalledOnce();
  });

  it("ignores a blank tag", () => {
    const h = harness();

    h.callbacks.onAddTag("   ");

    expect(h.writes).toEqual([]);
    expect(h.spies.render).not.toHaveBeenCalled();
  });

  it("ignores a tag the note already carries", () => {
    const h = harness({
      workspace: { notes: [makeNote({ tags: ["praha"] })], activeNoteId: "n-1" },
    });

    h.callbacks.onAddTag("PRAHA");

    expect(h.writes).toEqual([]);
  });

  it("removes a tag and leaves the others", () => {
    const h = harness({
      workspace: { notes: [makeNote({ tags: ["praha", "brno"] })], activeNoteId: "n-1" },
    });

    h.callbacks.onRemoveTag("praha");

    expect(written(h).tags).toEqual(["brno"]);
    expect(h.spies.setSyncState).toHaveBeenCalledExactlyOnceWith("idle");
    expect(h.spies.render).toHaveBeenCalledOnce();
  });

  it("ignores an empty tag removal", () => {
    const h = harness();

    h.callbacks.onRemoveTag("");

    expect(h.writes).toEqual([]);
    expect(h.spies.render).not.toHaveBeenCalled();
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------
//
// Four statement-deletion survivors. Three are a `setWorkspace` whose *result*
// nobody checked — the suite asserts that the filter set and the route moved,
// and stops there. The workspace commit is the other half: it is what keeps
// the editor from showing a note the filtered list no longer contains.

describe("createRenderCallbacks: the workspace commits", () => {
  const twoNotes = (): SutraPadWorkspace => ({
    notes: [
      { ...makeNote(), id: "n-work", tags: ["work"] },
      { ...makeNote(), id: "n-home", tags: ["home"] },
    ],
    activeNoteId: "n-home",
  });

  it("rebinds the active note when a note is opened", () => {
    const h = harness();

    h.callbacks.onSelectNote("n-1");

    const committed = h.spies.setWorkspace.mock.calls.at(-1)?.[0] as SutraPadWorkspace;
    expect(committed.activeNoteId).toBe("n-1");
    // Same object to the store and to the persister, or the note on screen
    // and the note on disk drift apart.
    expect(h.spies.persistWorkspace).toHaveBeenCalledWith(committed);
  });

  it("moves the active note into view when a filter hides it", () => {
    // `applyVisibleActiveNoteSelection` picks a still-visible note when the
    // active one drops out of the filtered list. Without the commit the filter
    // applies to the list while the editor keeps showing the hidden note.
    const h = harness({ workspace: twoNotes() });

    h.callbacks.onApplyTagFilter("work");

    const committed = h.spies.setWorkspace.mock.calls.at(-1)?.[0] as SutraPadWorkspace;
    expect(committed.activeNoteId).toBe("n-work");
  });

  it("commits the reconciliation again when a filter chip is removed", () => {
    // Removing a filter widens the list, and the same reconciliation runs on
    // the way back. Its own `setWorkspace` is a separate call site from the
    // one above and survives separately.
    const h = harness({ workspace: twoNotes(), selectedTagFilters: ["home"] });

    h.callbacks.onRemoveSelectedFilter("home");

    expect(h.spies.setSelectedTagFilters).toHaveBeenCalledWith([]);
    expect(h.spies.setWorkspace).toHaveBeenCalledTimes(1);
    const committed = h.spies.setWorkspace.mock.calls.at(-1)?.[0] as SutraPadWorkspace;
    expect(committed.notes.map((entry) => entry.id)).toEqual(["n-work", "n-home"]);
  });
});
