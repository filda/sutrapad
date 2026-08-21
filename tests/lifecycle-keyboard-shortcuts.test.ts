// @vitest-environment happy-dom
//
// First focused test for `src/app/lifecycle/keyboard-shortcuts.ts`. Its
// deferred-list entry was honest about the gap — "tests/keyboard-shortcuts
// covers `src/lib/keyboard-shortcuts.ts`, not this module" — and the split is
// exactly where the untested behaviour lives. `reduceShortcut` is a pure,
// well-tested state machine; this file is everything around it:
//
//   - **the DOM adapter.** It reads seven fields off the `KeyboardEvent` and
//     synthesises `isDetailRoute` from two store getters. A wrong field (or a
//     hard-coded `false`) makes a whole class of shortcut fire where it
//     should not, and the pure reducer's suite cannot see it.
//   - **`preventDefault` is conditional.** It fires only when the reducer
//     claims the keystroke — including on the `G` prefix, which claims the
//     key without acting. Both the positive and negative case need asserting.
//   - **the dispatch table.** `goto` has a no-op guard (already on that page
//     *and* not in a detail view), and three of its four side effects are
//     order-sensitive: purge the empty draft first, then switch. Escape
//     shares the purge. A mutant that drops the purge leaves a blank note
//     pinned to the list, which is the bug this wiring exists to prevent.
//   - **the state carries across events.** `G` then `T` is two keydowns; the
//     module holds the reducer state in a closure between them. A mutant that
//     re-seeds from `initialShortcutState` on every event breaks every
//     sequence shortcut and no single-key test would notice.
//
// The reducer is used for real here rather than mocked — it is observable,
// deterministic, and mocking it would leave the adapter asserting itself.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireKeyboardShortcuts } from "../src/app/lifecycle/keyboard-shortcuts";
import { G_PREFIX_TIMEOUT_MS } from "../src/lib/keyboard-shortcuts";
import type { MenuItemId } from "../src/app/logic/menu";

const NOW = 1_800_000_000_000;

interface HarnessOptions {
  activeMenuItem?: MenuItemId;
  detailNoteId?: string | null;
}

function wire({ activeMenuItem = "notes", detailNoteId = null }: HarnessOptions = {}) {
  const state = { activeMenuItem, detailNoteId };
  /** Every effect, in the order it was invoked — order is part of the contract. */
  const calls: string[] = [];
  const spies = {
    setActiveMenuItem: vi.fn((next: MenuItemId) => {
      state.activeMenuItem = next;
      calls.push(`setActiveMenuItem:${next}`);
    }),
    setDetailNoteId: vi.fn((next: string | null) => {
      state.detailNoteId = next;
      calls.push(`setDetailNoteId:${next}`);
    }),
    handleNewNote: vi.fn(() => calls.push("handleNewNote")),
    purgeEmptyDraftNotes: vi.fn(() => calls.push("purgeEmptyDraftNotes")),
    render: vi.fn(() => calls.push("render")),
  };
  const dispose = wireKeyboardShortcuts({
    getActiveMenuItem: () => state.activeMenuItem,
    getDetailNoteId: () => state.detailNoteId,
    ...spies,
  });
  return { ...spies, calls, state, dispose };
}

interface KeyOptions {
  target?: EventTarget;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/** Dispatches a real keydown and hands back the event so `defaultPrevented` is readable. */
function press(key: string, options: KeyOptions = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
  });
  (options.target ?? window).dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("wireKeyboardShortcuts new note", () => {
  it("creates a note on N and claims the keystroke", () => {
    const { handleNewNote, dispose } = wire();

    const event = press("n");

    expect(handleNewNote).toHaveBeenCalledOnce();
    // Without preventDefault the `n` also lands wherever focus happens to be.
    expect(event.defaultPrevented).toBe(true);
    dispose();
  });

  it("does not touch the router or purge anything", () => {
    // `+ Add` owns the navigation; the shortcut only delegates.
    const { calls, dispose } = wire();

    press("N");

    expect(calls).toEqual(["handleNewNote"]);
    dispose();
  });
});

describe("wireKeyboardShortcuts goto sequences", () => {
  it("carries the G prefix across two separate keydowns", () => {
    // The reducer state lives in a closure between events. Re-seeding it per
    // event would break every sequence shortcut while leaving `N` working.
    const { calls, dispose } = wire({ activeMenuItem: "tags" });

    press("g");
    press("t");

    expect(calls).toEqual([
      "purgeEmptyDraftNotes",
      "setActiveMenuItem:home",
      "setDetailNoteId:null",
      "render",
    ]);
    dispose();
  });

  it("routes all four destinations", () => {
    const seen: string[] = [];
    for (const [second] of [
      ["t", "home"],
      ["n", "notes"],
      ["l", "links"],
      ["k", "tasks"],
    ] as const) {
      const harness = wire({ activeMenuItem: "settings" });
      press("g");
      press(second);
      seen.push(`${second} → ${harness.setActiveMenuItem.mock.calls.flat().join()}`);
      harness.dispose();
    }

    expect(seen).toEqual([
      "t → home",
      "n → notes",
      "l → links",
      "k → tasks",
    ]);
  });

  it("purges the empty draft before switching pages", () => {
    // Order matters: purging after the switch would evaluate the draft
    // against the page the user just left.
    const { calls, dispose } = wire({ activeMenuItem: "notes", detailNoteId: "n-1" });

    press("g");
    press("l");

    expect(calls.indexOf("purgeEmptyDraftNotes")).toBe(0);
    expect(calls).toEqual([
      "purgeEmptyDraftNotes",
      "setActiveMenuItem:links",
      "setDetailNoteId:null",
      "render",
    ]);
    dispose();
  });

  it("does nothing when the destination is already the current list", () => {
    const { calls, dispose } = wire({ activeMenuItem: "notes", detailNoteId: null });

    press("g");
    press("n");

    expect(calls).toEqual([]);
    dispose();
  });

  it("still bounces out of the detail view when the tab is already active", () => {
    // Both halves of the guard matter: same page *and* no detail. From
    // `notes` + a detail note, `G N` must return to the list — same
    // affordance as clicking the Notes tab.
    const { calls, dispose } = wire({ activeMenuItem: "notes", detailNoteId: "n-1" });

    press("g");
    press("n");

    expect(calls).toEqual([
      "purgeEmptyDraftNotes",
      "setActiveMenuItem:notes",
      "setDetailNoteId:null",
      "render",
    ]);
    dispose();
  });

  it("claims the prefix key but not the key that ends an unrecognised sequence", () => {
    const { calls, dispose } = wire({ activeMenuItem: "tags" });

    // `G` acts on nothing yet but must not be typed into the page either.
    expect(press("g").defaultPrevented).toBe(true);
    // `x` after G is not a destination: the sequence drops and the key
    // behaves normally.
    expect(press("x").defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    dispose();
  });

  it("lets a stale G prefix lapse", () => {
    // The reducer expires the prefix using the `now` this module supplies
    // from `Date.now()` — a hard-coded or frozen clock would keep a prefix
    // armed forever.
    const { calls, dispose } = wire({ activeMenuItem: "tags" });
    press("g");

    vi.setSystemTime(NOW + G_PREFIX_TIMEOUT_MS + 1);
    press("t");

    expect(calls).toEqual([]);
    dispose();
  });

  it("keeps a prefix alive inside the timeout", () => {
    const { calls, dispose } = wire({ activeMenuItem: "tags" });
    press("g");

    vi.setSystemTime(NOW + G_PREFIX_TIMEOUT_MS - 1);
    press("t");

    expect(calls).toContain("setActiveMenuItem:home");
    dispose();
  });
});

describe("wireKeyboardShortcuts escape", () => {
  it("leaves the detail editor and purges an untouched draft", () => {
    const { calls, dispose } = wire({ activeMenuItem: "notes", detailNoteId: "n-1" });

    const event = press("Escape");

    expect(calls).toEqual(["purgeEmptyDraftNotes", "setDetailNoteId:null", "render"]);
    expect(event.defaultPrevented).toBe(true);
    dispose();
  });

  it("does not switch the active page on the way out", () => {
    // Escape returns to the list the note belongs to; it is not a route
    // change.
    const { setActiveMenuItem, dispose } = wire({
      activeMenuItem: "notes",
      detailNoteId: "n-1",
    });

    press("Escape");

    expect(setActiveMenuItem).not.toHaveBeenCalled();
    dispose();
  });

  it("ignores Escape outside a detail route", () => {
    // `isDetailRoute` is synthesised here from two getters. Hard-coding it
    // true would make Escape fire on every page.
    const onList = wire({ activeMenuItem: "notes", detailNoteId: null });
    expect(press("Escape").defaultPrevented).toBe(false);
    expect(onList.calls).toEqual([]);
    onList.dispose();

    // A detail id on a different page is not the detail route either.
    const elsewhere = wire({ activeMenuItem: "tags", detailNoteId: "n-1" });
    press("Escape");
    expect(elsewhere.calls).toEqual([]);
    elsewhere.dispose();
  });

  it("re-reads both getters on every keystroke", () => {
    // Opening a note after wiring must arm Escape without a re-install.
    const harness = wire({ activeMenuItem: "notes", detailNoteId: null });
    press("Escape");
    expect(harness.calls).toEqual([]);

    harness.state.detailNoteId = "n-2";
    press("Escape");

    expect(harness.calls).toEqual(["purgeEmptyDraftNotes", "setDetailNoteId:null", "render"]);
    harness.dispose();
  });
});

describe("wireKeyboardShortcuts suppression", () => {
  it("stays out of the way while the user is typing", () => {
    // `isEditingTarget` is read off the real event target. Without it, `n`
    // in a note body would open a second draft mid-sentence.
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    const { calls, dispose } = wire();

    const event = press("n", { target: textarea });

    expect(calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    dispose();
  });

  it("ignores every modifier combination", () => {
    // Ctrl/Cmd/Alt belong to the browser and the OS.
    const { calls, dispose } = wire();

    press("n", { metaKey: true });
    press("n", { ctrlKey: true });
    press("n", { altKey: true });

    expect(calls).toEqual([]);
    dispose();
  });

  it("passes each modifier flag through independently", () => {
    // All three are read off the event; a mutant that always sends `false`
    // for one of them re-enables that combination.
    const { handleNewNote, dispose } = wire();

    press("n", { altKey: true });
    expect(handleNewNote).not.toHaveBeenCalled();

    press("n");
    expect(handleNewNote).toHaveBeenCalledOnce();
    dispose();
  });
});

describe("wireKeyboardShortcuts lifecycle", () => {
  it("listens on the window and detaches on dispose", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { handleNewNote, dispose } = wire();

    expect(add).toHaveBeenCalledWith("keydown", expect.any(Function));

    dispose();
    press("n");

    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(handleNewNote).not.toHaveBeenCalled();
    add.mockRestore();
    remove.mockRestore();
  });

  it("gives each installation its own sequence state", () => {
    // Two wirings must not share the G prefix — a leaked module-level state
    // would let one instance's `G` complete inside the other.
    const first = wire({ activeMenuItem: "tags" });
    const second = wire({ activeMenuItem: "tags" });

    press("g");
    press("t");

    expect(first.setActiveMenuItem).toHaveBeenCalledExactlyOnceWith("home");
    expect(second.setActiveMenuItem).toHaveBeenCalledExactlyOnceWith("home");
    first.dispose();
    second.dispose();
  });
});
