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
  onSelectEntry: (entry: { payload: { kind: "tag"; tag: string } }) => void;
  onClose: () => void;
};
let lastMount: MountPaletteOptions | null = null;
let mountCount = 0;

vi.mock("../src/app/view/palette", () => ({
  mountPalette: (options: MountPaletteOptions) => {
    mountCount += 1;
    lastMount = options;
    return {
      update: vi.fn(),
      destroy: vi.fn(),
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
});

afterEach(() => {
  // Each test calls `dispose` itself (or the test ends without one) — but
  // a stray keydown listener from a previous test would be visible to the
  // next one if we ever forgot, so a belt-and-braces cleanup here keeps
  // suites independent.
  document.body.innerHTML = "";
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
    // Reset the URL so a follow-up test in the same file doesn't inherit
    // ?tags=work in window.location.
    window.history.replaceState({}, "", "/");
  });

  it("purges any in-flight empty draft before applying the filter", () => {
    const wired = setup("links");
    wired.access.open();
    lastMount?.onSelectEntry({ payload: { kind: "tag", tag: "work" } });

    expect(wired.purgeEmptyDraftNotes).toHaveBeenCalledTimes(1);
    wired.access.dispose();
  });
});
