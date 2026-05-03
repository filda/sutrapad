// @vitest-environment happy-dom
//
// Behavior tests for `wirePaletteAccess` — the palette wiring layer that
// the global `/` shortcut and the topbar `+ tag` click both feed into.
// `palette.test.ts` covers pure logic in `src/app/logic/palette.ts`; this
// suite covers the wiring side, specifically:
//
//   - the keyboard `/` opens the palette via `mountPalette`
//   - picking a tag entry from a filterable page (notes/links/tasks/tags)
//     keeps the user there — no forced reroute to Notes
//   - picking a tag entry from a non-filterable page (home/capture/
//     settings/privacy) routes to Notes so the toggle doesn't fire
//     invisibly (legacy behaviour)
//   - on Notes, the detail pin is cleared so the user lands on the list
//     where the filter is visualised
//   - the toggle still updates the filter set, the URL, and applies the
//     visible-active-note reconciliation regardless of where it landed

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wirePaletteAccess } from "../src/app/lifecycle/palette";
import type { MenuItemId } from "../src/app/logic/menu";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

// `wirePaletteAccess` calls into `mountPalette` from
// `../src/app/view/palette`. We stub it so we can drive `onSelectEntry`
// directly without simulating the rendered list-of-entries DOM.
type MountPaletteOptions = {
  groups: unknown;
  selectedTagFilters: string[];
  onSelectEntry: (entry: { payload: { kind: "tag"; tag: string } }) => void;
  onClose: () => void;
};
let lastMount: MountPaletteOptions | null = null;
let mountCount = 0;
// Hold the most recently returned handle so lifecycle tests can assert on
// `update` / `destroy` invocations driven by `refresh` / `dispose`. Fresh
// per mount so a re-open after `onClose` lands a clean handle.
let lastUpdate = vi.fn();
let lastDestroy = vi.fn();

vi.mock("../src/app/view/palette", () => ({
  mountPalette: (options: MountPaletteOptions) => {
    mountCount += 1;
    lastMount = options;
    lastUpdate = vi.fn();
    lastDestroy = vi.fn();
    return {
      update: lastUpdate,
      destroy: lastDestroy,
    };
  },
}));

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "n",
    title: "note",
    body: "",
    tags: [],
    urls: [],
    createdAt: "2026-04-21T09:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

// Every `setup()` pushes its `dispose` into this list so `afterEach` can
// guarantee teardown even when an assertion failure short-circuits the
// in-test `wired.access.dispose()` call. Without this, a leaked `keydown`
// listener from a failing test would mount palettes during the next
// test's `dispatchEvent`, producing follow-on mountCount drift that
// masks the real failure.
const disposers: Array<() => void> = [];

function setup(activeMenuItem: MenuItemId, initialFilters: string[] = []) {
  const note = makeNote({ id: "n1", title: "First", tags: ["work"] });
  let workspace: SutraPadWorkspace = { notes: [note], activeNoteId: note.id };
  let filters = [...initialFilters];

  const setWorkspace = vi.fn((next: SutraPadWorkspace) => {
    workspace = next;
  });
  const setActiveMenuItem = vi.fn();
  const setDetailNoteId = vi.fn();
  const getActiveMenuItem = vi.fn(() => activeMenuItem);
  const setSelectedTagFilters = vi.fn((next: string[]) => {
    filters = next;
  });
  const persistWorkspace = vi.fn();
  const purgeEmptyDraftNotes = vi.fn();
  const render = vi.fn();

  const access = wirePaletteAccess({
    host: document.body,
    getWorkspace: () => workspace,
    setWorkspace,
    getActiveMenuItem,
    setActiveMenuItem,
    setDetailNoteId,
    getSelectedTagFilters: () => filters,
    setSelectedTagFilters,
    getFilterMode: () => "all",
    persistWorkspace,
    purgeEmptyDraftNotes,
    render,
  });
  disposers.push(access.dispose);

  return {
    access,
    setActiveMenuItem,
    setDetailNoteId,
    setSelectedTagFilters,
    persistWorkspace,
    purgeEmptyDraftNotes,
    render,
    getFilters: () => filters,
  };
}

beforeEach(() => {
  lastMount = null;
  mountCount = 0;
  // Fresh spies per test — the previous test's mount handle reassigned
  // these, and a "no mount happened" assertion would otherwise see the
  // earlier test's call count.
  lastUpdate = vi.fn();
  lastDestroy = vi.fn();
});

afterEach(() => {
  // Calling `dispose` is idempotent (window.removeEventListener with an
  // already-removed handler is a no-op, and `handle?.destroy()` short-
  // circuits when the handle is null), so running it here on top of the
  // explicit per-test calls is safe and cleans up after assertion failures.
  while (disposers.length > 0) {
    try {
      disposers.pop()?.();
    } catch {
      // swallow — teardown errors shouldn't mask the original assertion failure
    }
  }
  document.body.innerHTML = "";
  // Reset the URL so a follow-up test in the same file doesn't inherit
  // ?tags=… from the URL-sync test.
  window.history.replaceState({}, "", "/");
});

describe("wirePaletteAccess tag-pick routing", () => {
  it("opens the palette on `/` keydown when the focus isn't editable", () => {
    const wired = setup("notes");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    expect(mountCount).toBe(1);
    wired.access.dispose();
  });

  it("keeps the user on Notes and clears the detail pin when picking a tag from Notes", () => {
    const wired = setup("notes");
    wired.access.open();
    expect(lastMount).not.toBeNull();
    lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

    expect(wired.setActiveMenuItem).not.toHaveBeenCalled();
    expect(wired.setDetailNoteId).toHaveBeenCalledWith(null);
    expect(wired.setSelectedTagFilters).toHaveBeenCalledWith(["work"]);
    expect(wired.render).toHaveBeenCalledTimes(1);
    wired.access.dispose();
  });

  it.each(["links", "tasks", "tags"] as const)(
    "stays on %s without rerouting or touching the detail pin",
    (page) => {
      const wired = setup(page);
      wired.access.open();
      lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

      expect(wired.setActiveMenuItem).not.toHaveBeenCalled();
      expect(wired.setDetailNoteId).not.toHaveBeenCalled();
      expect(wired.setSelectedTagFilters).toHaveBeenCalledWith(["work"]);
      wired.access.dispose();
    },
  );

  it.each(["home", "capture", "settings", "privacy"] as const)(
    "routes to Notes when picking a tag from %s",
    (page) => {
      const wired = setup(page);
      wired.access.open();
      lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

      expect(wired.setActiveMenuItem).toHaveBeenCalledWith("notes");
      expect(wired.setDetailNoteId).toHaveBeenCalledWith(null);
      expect(wired.setSelectedTagFilters).toHaveBeenCalledWith(["work"]);
      wired.access.dispose();
    },
  );

  it("toggles the tag off when it's already in the active filter set", () => {
    const wired = setup("links", ["work", "urgent"]);
    wired.access.open();
    lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

    expect(wired.setSelectedTagFilters).toHaveBeenCalledWith(["urgent"]);
    wired.access.dispose();
  });

  it("syncs the new filter set to the URL", () => {
    const wired = setup("tasks");
    wired.access.open();
    lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

    expect(window.location.search).toContain("tags=work");
    wired.access.dispose();
  });

  it("purges any in-flight empty draft before applying the filter", () => {
    const wired = setup("links");
    wired.access.open();
    lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

    expect(wired.purgeEmptyDraftNotes).toHaveBeenCalledTimes(1);
    wired.access.dispose();
  });
});

describe("wirePaletteAccess keyboard guards", () => {
  // The `/` keydown listener is the global entry point. Each guard below
  // protects a real bug class (typing `/` mid-sentence shouldn't pop the
  // palette; `Cmd-/` shouldn't either; etc.). Without these tests the
  // condition mutants on lines 153–155 all survive — the existing
  // happy-path test only proves a bare `/` opens, not that anything else
  // is rejected.

  it("ignores keys other than `/`", () => {
    const wired = setup("notes");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    expect(mountCount).toBe(0);
    wired.access.dispose();
  });

  it.each([
    ["metaKey", { metaKey: true }],
    ["ctrlKey", { ctrlKey: true }],
    ["altKey", { altKey: true }],
  ] as const)(
    "ignores `/` when %s is held (browser/system shortcut, not ours)",
    (_label, modifiers) => {
      const wired = setup("notes");
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", ...modifiers }),
      );
      expect(mountCount).toBe(0);
      wired.access.dispose();
    },
  );

  it("ignores `/` while focus is in an editable target so users can type slashes mid-note", () => {
    const wired = setup("notes");
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    // `bubbles: true` so the event reaches the window-level listener; the
    // listener inspects `event.target`, which `dispatchEvent` sets to the
    // textarea when dispatched from there.
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );
    expect(mountCount).toBe(0);
    wired.access.dispose();
  });
});

describe("wirePaletteAccess lifecycle", () => {
  // Open/close/refresh/dispose bookkeeping. The wiring layer guarantees
  // there's never more than one palette mounted at once and that HMR
  // teardown removes the keydown listener so reloads don't accumulate
  // stale handlers (the `dispose` block-statement mutant survived without
  // this).

  it("`open()` is idempotent — a second call while one palette is already open does nothing", () => {
    const wired = setup("notes");
    wired.access.open();
    wired.access.open();
    expect(mountCount).toBe(1);
    wired.access.dispose();
  });

  it("`onClose` resets internal state so the next `open()` mounts a fresh palette", () => {
    const wired = setup("notes");
    wired.access.open();
    expect(mountCount).toBe(1);
    // Simulate the user dismissing the palette (Esc / outside click) —
    // the view layer fires `onClose`, which must release the handle so a
    // follow-up open isn't suppressed by the idempotency guard.
    lastMount?.onClose();
    wired.access.open();
    expect(mountCount).toBe(2);
    wired.access.dispose();
  });

  it("`refresh` forwards the latest workspace + filters to the open palette", () => {
    const wired = setup("notes");
    wired.access.open();
    expect(lastUpdate).not.toHaveBeenCalled();
    const nextWorkspace: SutraPadWorkspace = {
      notes: [makeNote({ id: "n2", title: "Second", tags: ["urgent"] })],
      activeNoteId: "n2",
    };
    wired.access.refresh(nextWorkspace, ["urgent"]);
    expect(lastUpdate).toHaveBeenCalledTimes(1);
    // Second arg is the selected-filter array, forwarded verbatim.
    expect(lastUpdate.mock.calls[0]?.[1]).toEqual(["urgent"]);
    wired.access.dispose();
  });

  it("`refresh` is a no-op when no palette is currently mounted (optional-chained handle)", () => {
    const wired = setup("notes");
    expect(() =>
      wired.access.refresh({ notes: [], activeNoteId: null }, []),
    ).not.toThrow();
    expect(lastUpdate).not.toHaveBeenCalled();
    wired.access.dispose();
  });

  it("`dispose` removes the keydown listener so post-dispose `/` keys don't re-open the palette", () => {
    const wired = setup("notes");
    wired.access.dispose();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    expect(mountCount).toBe(0);
  });

  it("`dispose` destroys the currently open palette so HMR teardown leaves no stale view", () => {
    const wired = setup("notes");
    wired.access.open();
    expect(lastDestroy).not.toHaveBeenCalled();
    wired.access.dispose();
    expect(lastDestroy).toHaveBeenCalledTimes(1);
  });
});
