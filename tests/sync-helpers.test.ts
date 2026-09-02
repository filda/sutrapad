// @vitest-environment happy-dom
//
// First focused test for `src/app/sync-helpers.ts` — the shared layer between
// render callbacks, palette selection and the per-frame `render()` loop. Two
// distinct kinds of thing live in it and both were unmeasured:
//
//   - the four `sync*ToLocation` writers, the only DOM-touching part (they
//     call `window.history.replaceState`). Their contract has a quiet half:
//     *not* writing when the URL would come out unchanged, which keeps the
//     history stack from filling with identical entries. That half is only
//     observable by spying on `replaceState`, so every writer test does.
//   - the pure selection helpers (`syncDetailRouteSelection`,
//     `ensureVisibleActiveNoteSelection`, `getAppStatusText`), which decide
//     which note the app considers current. Their failure mode is a blank
//     editor or a note that silently swaps under the user after a filter
//     change, and `create-app-smoke.test.ts` — the only thing executing them
//     until now — asserts rendered HTML, one route at a time.
//
// `tests/render-callbacks.test.ts` already drives the two tag-filter writers
// end-to-end from the handler side; this file pins the branches that no
// handler reaches (the stale-`?view=` strip, the no-write early outs).
//
// Four survivors in the mutation report are equivalent:
//   - `syncDetailRouteSelection`'s `if (detailNoteId === null)` early return.
//     Every later branch also returns `{detailNoteId: null, workspace,
//     shouldPersistWorkspace: false}` for a null id (no note has `id === null`,
//     and `null === null` satisfies the already-active check), so removing the
//     guard changes nothing observable. It is a readability fast-path.
//   - both mutants of `selectedTagFilters.length > 0` in `getAppStatusText`.
//     `resolveDisplayedNote` only returns null when the filter matched nothing,
//     which with no filters means an empty `workspace.notes` — and there the
//     original code throws on `note.updatedAt` anyway (`getCurrentWorkspaceNote`
//     hands back `undefined`). `normalizeWorkspace` / `createWorkspace`
//     guarantee at least one note, so the state is unreachable rather than
//     handled; asserting a crash would pin the wrong contract.

import { beforeEach, describe, expect, it, vi } from "vitest";
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
} from "../src/app/sync-helpers";
import type { SutraPadDocument, SutraPadWorkspace, UserProfile } from "../src/types";
import { createWorkspace, stripEmptyDraftNotes } from "../src/lib/notebook";

const BASE = "/";

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

const workspaceOf = (
  notes: SutraPadDocument[],
  activeNoteId: string | null,
): SutraPadWorkspace => ({ notes, activeNoteId });

const PROFILE: UserProfile = { email: "f@example.com", name: "Filip", picture: "" };

/** Spy on the history writer so "wrote nothing" is assertable, not inferred. */
function watchReplaceState() {
  return vi.spyOn(window.history, "replaceState");
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("getCurrentWorkspaceNote", () => {
  it("returns the active note", () => {
    const workspace = workspaceOf([makeNote({ id: "n-1" }), makeNote({ id: "n-2" })], "n-2");

    expect(getCurrentWorkspaceNote(workspace).id).toBe("n-2");
  });

  it("falls back to the first note when the active id is stale", () => {
    // Happens after a refresh drops the note that was open.
    const workspace = workspaceOf([makeNote({ id: "n-1" }), makeNote({ id: "n-2" })], "gone");

    expect(getCurrentWorkspaceNote(workspace).id).toBe("n-1");
  });

  it("falls back to the first note when nothing is active", () => {
    const workspace = workspaceOf([makeNote({ id: "n-1" })], null);

    expect(getCurrentWorkspaceNote(workspace).id).toBe("n-1");
  });
});

describe("syncTagFiltersToLocation", () => {
  it("writes the canonical tag list", () => {
    const replaceState = watchReplaceState();

    syncTagFiltersToLocation(["Beta", "alpha"]);

    expect(window.location.search).toBe("?tags=alpha%2Cbeta");
    // The empty title is part of the contract: `replaceState` takes
    // (state, title, url) and anything non-empty in the middle slot is a
    // history entry we did not mean to name.
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      {},
      "",
      expect.stringContaining("?tags=alpha%2Cbeta"),
    );
  });

  it("strips the parameter when the last filter goes away", () => {
    window.history.replaceState({}, "", "/?tags=alpha");

    syncTagFiltersToLocation([]);

    expect(window.location.search).toBe("");
  });

  it("does not touch history when the URL already says the same thing", () => {
    window.history.replaceState({}, "", "/?tags=alpha");
    const replaceState = watchReplaceState();

    syncTagFiltersToLocation(["alpha"]);

    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("syncFilterModeToLocation", () => {
  it("writes the non-default mode", () => {
    const replaceState = watchReplaceState();

    syncFilterModeToLocation("any");

    expect(window.location.search).toBe("?tagsMode=any");
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      {},
      "",
      expect.stringContaining("?tagsMode=any"),
    );
  });

  it("strips the parameter for the default mode", () => {
    window.history.replaceState({}, "", "/?tagsMode=any");

    syncFilterModeToLocation("all");

    expect(window.location.search).toBe("");
  });

  it("does not touch history when the mode is already in the URL", () => {
    window.history.replaceState({}, "", "/?tagsMode=any");
    const replaceState = watchReplaceState();

    syncFilterModeToLocation("any");

    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("syncActivePageToLocation", () => {
  it("writes the note detail path when a note is open", () => {
    const replaceState = watchReplaceState();

    syncActivePageToLocation("notes", "n-42", BASE);

    expect(window.location.pathname).toBe("/notes/n-42");
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      {},
      "",
      expect.stringContaining("/notes/n-42"),
    );
  });

  it("writes the bare notebook path when no note is open", () => {
    window.history.replaceState({}, "", "/notes/n-42");

    syncActivePageToLocation("notes", null, BASE);

    // "notes" is the default menu item, so its canonical path is the root.
    expect(window.location.pathname).toBe("/");
  });

  it("ignores a stale detail id on another page", () => {
    // The detail id can still be set while the route has already moved on;
    // the page wins, otherwise the URL would claim a notebook detail route
    // while the Tasks page is on screen.
    syncActivePageToLocation("tasks", "n-42", BASE);

    expect(window.location.pathname).toBe("/tasks");
  });

  it("honours the app base path", () => {
    window.history.replaceState({}, "", "/sutrapad/");

    syncActivePageToLocation("tags", null, "/sutrapad/");

    expect(window.location.pathname).toBe("/sutrapad/tags");
  });

  it("preserves the query string while rewriting the path", () => {
    window.history.replaceState({}, "", "/?tags=alpha");

    syncActivePageToLocation("links", null, BASE);

    expect(window.location.pathname).toBe("/links");
    expect(window.location.search).toBe("?tags=alpha");
  });

  it("does not touch history when the path is already right", () => {
    window.history.replaceState({}, "", "/tasks");
    const replaceState = watchReplaceState();

    syncActivePageToLocation("tasks", null, BASE);

    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("syncViewToLocation", () => {
  it("writes the notebook list mode on the notebook list route", () => {
    const replaceState = watchReplaceState();

    syncViewToLocation("notes", null, "list", "cards");

    expect(window.location.search).toBe("?view=list");
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      {},
      "",
      expect.stringContaining("?view=list"),
    );
  });

  it("uses the links mode on the links route", () => {
    // Both pages share the `?view=` slug, so the route decides which mode
    // owns it — crossing these would show the Links page in the notebook's
    // mode after a nav.
    const replaceState = watchReplaceState();

    syncViewToLocation("links", null, "cards", "list");

    expect(window.location.search).toBe("?view=list");
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      {},
      "",
      expect.stringContaining("?view=list"),
    );
  });

  it("does not touch history when the links mode is already in the URL", () => {
    window.history.replaceState({}, "", "/links?view=list");
    const replaceState = watchReplaceState();

    syncViewToLocation("links", null, "cards", "list");

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("strips a stale value on a route that owns no view mode", () => {
    window.history.replaceState({}, "", "/?view=list");
    const replaceState = watchReplaceState();

    syncViewToLocation("tags", null, "list", "list");

    expect(window.location.search).toBe("");
    expect(replaceState).toHaveBeenCalledExactlyOnceWith({}, "", expect.any(String));
  });

  it("strips the value on the note detail route", () => {
    // The detail route is not the list, so the list's mode must not linger
    // in a URL the user might share.
    window.history.replaceState({}, "", "/notes/n-1?view=list");

    syncViewToLocation("notes", "n-1", "list", "cards");

    expect(window.location.search).toBe("");
  });

  it("does not touch history on a mode-less route with a clean URL", () => {
    const replaceState = watchReplaceState();

    syncViewToLocation("tags", null, "list", "list");

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("does not touch history when the notebook mode is already in the URL", () => {
    window.history.replaceState({}, "", "/?view=list");
    const replaceState = watchReplaceState();

    syncViewToLocation("notes", null, "list", "cards");

    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe("syncDetailRouteSelection", () => {
  const workspace = workspaceOf([makeNote({ id: "n-1" }), makeNote({ id: "n-2" })], "n-1");

  it("passes through when no note is open", () => {
    const result = syncDetailRouteSelection("notes", null, workspace);

    expect(result).toEqual({
      detailNoteId: null,
      workspace,
      shouldPersistWorkspace: false,
    });
  });

  it("clears the detail id when the route left the notebook", () => {
    const result = syncDetailRouteSelection("tasks", "n-2", workspace);

    expect(result.detailNoteId).toBeNull();
    expect(result.workspace).toBe(workspace);
    expect(result.shouldPersistWorkspace).toBe(false);
  });

  it("clears a detail id the workspace no longer holds", () => {
    // A deep link to a deleted note, or a note dropped by a sync — the app
    // must fall back to the list rather than render an empty editor.
    const result = syncDetailRouteSelection("notes", "gone", workspace);

    expect(result.detailNoteId).toBeNull();
    expect(result.workspace).toBe(workspace);
    expect(result.shouldPersistWorkspace).toBe(false);
  });

  it("rebinds the active note to the one the route names", () => {
    const result = syncDetailRouteSelection("notes", "n-2", workspace);

    expect(result.detailNoteId).toBe("n-2");
    expect(result.workspace.activeNoteId).toBe("n-2");
    expect(result.shouldPersistWorkspace).toBe(true);
    // Non-mutating: the caller's workspace must be left alone.
    expect(workspace.activeNoteId).toBe("n-1");
  });

  it("asks for no write when the active note already matches the route", () => {
    const result = syncDetailRouteSelection("notes", "n-1", workspace);

    expect(result.workspace).toBe(workspace);
    expect(result.shouldPersistWorkspace).toBe(false);
  });
});

describe("ensureVisibleActiveNoteSelection", () => {
  const tagged = workspaceOf(
    [
      makeNote({ id: "n-1", tags: ["praha"] }),
      makeNote({ id: "n-2", tags: ["brno"] }),
      makeNote({ id: "n-3", tags: ["brno", "praha"] }),
    ],
    "n-1",
  );

  it("leaves an active note that survives the filter", () => {
    const result = ensureVisibleActiveNoteSelection(tagged, ["praha"], "all");

    expect(result.workspace).toBe(tagged);
    expect(result.shouldPersistWorkspace).toBe(false);
  });

  it("moves the selection to the first visible note when the active one is filtered out", () => {
    const result = ensureVisibleActiveNoteSelection(tagged, ["brno"], "all");

    expect(result.workspace.activeNoteId).toBe("n-2");
    expect(result.shouldPersistWorkspace).toBe(true);
    expect(tagged.activeNoteId).toBe("n-1");
  });

  it("keeps the selection when the filter matches nothing at all", () => {
    // Nothing to move to, and clearing the selection would blank the editor
    // for a filter the user is about to undo.
    const result = ensureVisibleActiveNoteSelection(tagged, ["ostrava"], "all");

    expect(result.workspace).toBe(tagged);
    expect(result.shouldPersistWorkspace).toBe(false);
  });

  it("does nothing when no note is active yet", () => {
    const result = ensureVisibleActiveNoteSelection(
      workspaceOf([makeNote({ id: "n-1", tags: ["praha"] })], null),
      ["brno"],
      "all",
    );

    expect(result.shouldPersistWorkspace).toBe(false);
  });

  it("respects any-mode when deciding what is visible", () => {
    // `n-1` carries only `praha`: visible under any-mode, hidden under
    // all-mode. The mode has to reach `filterNotesByTags` for the selection
    // to survive here.
    const result = ensureVisibleActiveNoteSelection(tagged, ["praha", "brno"], "any");

    expect(result.workspace).toBe(tagged);
    expect(result.shouldPersistWorkspace).toBe(false);
  });
});

describe("applyVisibleActiveNoteSelection", () => {
  const tagged = workspaceOf(
    [makeNote({ id: "n-1", tags: ["praha"] }), makeNote({ id: "n-2", tags: ["brno"] })],
    "n-1",
  );

  it("persists the rebound workspace and returns it", () => {
    const persistWorkspace = vi.fn();

    const result = applyVisibleActiveNoteSelection(tagged, ["brno"], "all", persistWorkspace);

    expect(result.activeNoteId).toBe("n-2");
    expect(persistWorkspace).toHaveBeenCalledExactlyOnceWith(result);
  });

  it("skips the write when the selection did not have to move", () => {
    const persistWorkspace = vi.fn();

    const result = applyVisibleActiveNoteSelection(tagged, ["praha"], "all", persistWorkspace);

    expect(result).toBe(tagged);
    expect(persistWorkspace).not.toHaveBeenCalled();
  });
});

describe("getAppStatusText", () => {
  const workspace = workspaceOf([makeNote({ id: "n-1", tags: ["praha"] })], "n-1");
  const base = {
    lastError: "",
    workspace,
    selectedTagFilters: [] as string[],
    filterMode: "all" as const,
    profile: null,
  };

  it("reports the in-flight sync states", () => {
    expect(getAppStatusText({ ...base, syncState: "loading" })).toBe("Loading…");
    expect(getAppStatusText({ ...base, syncState: "saving" })).toBe("Saving…");
  });

  it("shows the specific error when there is one", () => {
    expect(
      getAppStatusText({ ...base, syncState: "error", lastError: "Drive said no" }),
    ).toBe("Drive said no");
  });

  it("falls back to a generic error when the message is empty", () => {
    expect(getAppStatusText({ ...base, syncState: "error" })).toBe(
      "A synchronization error occurred.",
    );
  });

  it("distinguishes an empty any-mode filter from an all-mode one", () => {
    // Same "nothing matched" situation, different advice: with any-mode the
    // user needs a different tag, with all-mode they can drop one.
    expect(
      getAppStatusText({
        ...base,
        syncState: "idle",
        selectedTagFilters: ["ostrava"],
        filterMode: "any",
      }),
    ).toBe("No notes match any selected tag.");
    expect(
      getAppStatusText({
        ...base,
        syncState: "idle",
        selectedTagFilters: ["ostrava"],
        filterMode: "all",
      }),
    ).toBe("No notes match all selected tags.");
  });

  it("says local when nobody is signed in", () => {
    const text = getAppStatusText({ ...base, syncState: "idle" });

    expect(text).toContain("Editing local notebook.");
    expect(text).toContain("Last change:");
  });

  it("says synced from Drive once a profile is present", () => {
    const text = getAppStatusText({ ...base, syncState: "idle", profile: PROFILE });

    expect(text).toContain("Notebook synced from Drive.");
  });

  it("timestamps the note the filter actually displays", () => {
    // Not the active note: with a filter on, the status line has to follow
    // whatever the list is showing, otherwise it reports a date for a note
    // that isn't on screen.
    const twoNotes = workspaceOf(
      [
        makeNote({ id: "n-1", tags: ["praha"], updatedAt: "2026-08-01T10:00:00.000Z" }),
        makeNote({ id: "n-2", tags: ["brno"], updatedAt: "2026-03-04T09:00:00.000Z" }),
      ],
      "n-1",
    );

    const text = getAppStatusText({
      ...base,
      workspace: twoNotes,
      syncState: "idle",
      selectedTagFilters: ["brno"],
    });

    expect(text).toContain(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date("2026-03-04T09:00:00.000Z"),
      ),
    );
  });
});

describe("getAppStatusText on an empty workspace", () => {
  // Regression: this used to throw `TypeError: Cannot read properties of
  // undefined (reading 'updatedAt')`. The chain that reaches it starts from a
  // fresh install —
  //
  //   createWorkspace()          → one note, and that note is an empty draft
  //   stripEmptyDraftNotes(…)    → zero notes
  //   render() → refreshStatus() → getAppStatusText(…)  → throw
  //
  // Both `purgeEmptyDraftNotes` call sites in
  // `lifecycle/keyboard-shortcuts.ts` render immediately after purging, so
  // pressing Escape on the detail route of a brand-new notebook, before
  // typing anything, was enough.
  const empty = { notes: [], activeNoteId: null };

  it("reports the local notebook without a last-change stamp", () => {
    expect(
      getAppStatusText({
        syncState: "idle",
        lastError: "",
        workspace: empty,
        selectedTagFilters: [],
        filterMode: "any",
        profile: null,
      }),
    ).toBe("Editing local notebook.");
  });

  it("reports the synced notebook without a last-change stamp", () => {
    expect(
      getAppStatusText({
        syncState: "idle",
        lastError: "",
        workspace: empty,
        selectedTagFilters: [],
        filterMode: "any",
        profile: { name: "Filip", email: "f@example.com", picture: "" },
      }),
    ).toBe("Notebook synced from Drive.");
  });

  it("still reports sync state ahead of the empty check", () => {
    for (const [syncState, expected] of [
      ["loading", "Loading…"],
      ["saving", "Saving…"],
    ] as const) {
      expect(
        getAppStatusText({
          syncState,
          lastError: "",
          workspace: empty,
          selectedTagFilters: [],
          filterMode: "any",
          profile: null,
        }),
      ).toBe(expected);
    }
  });

  it("survives the real fresh-install purge chain", () => {
    const stripped = stripEmptyDraftNotes(createWorkspace());
    expect(stripped.notes).toHaveLength(0);
    expect(() =>
      getAppStatusText({
        syncState: "idle",
        lastError: "",
        workspace: stripped,
        selectedTagFilters: [],
        filterMode: "any",
        profile: null,
      }),
    ).not.toThrow();
  });
});
