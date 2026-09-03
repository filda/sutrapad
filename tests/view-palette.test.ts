// @vitest-environment happy-dom
//
// Focused test for `src/app/view/palette.ts` — the command-palette overlay.
//
// This module was the worst hole the mutation-scope guard had ever caught.
// `tests/lifecycle-palette.test.ts` imports it, so it *looked* covered, but it
// `vi.mock`s the whole module: a 2026-08-17 measurement put the file at
// **0.00 % with all 166 mutants NoCoverage**. Not one line had ever executed.
// It has sat in `DEFERRED_FROM_MUTATION` since, with the reason
// "lifecycle-palette.test.ts vi.mocks it — zero real coverage", and that list
// says of itself: "anything here is a promise, not a parking lot".
//
// This suite is that promise being kept. It drives the real overlay against a
// real DOM: the mount shape, both empty-state messages, the per-row chip that
// tells the user what Enter will do, keyboard navigation, the two teardown
// routes, and the shortcut-hint strip cross-checked against the reducer it
// claims to mirror.
//
// NB the palette owns its own DOM between renders — the caller deliberately
// does not re-render on keystrokes, or the input would lose focus mid-typing.
// So every assertion here reads the live overlay after driving real events,
// never a rebuilt tree.

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPalette, type PaletteHandle } from "../src/app/view/palette";
import type { PaletteEntry, PaletteGroups } from "../src/app/logic/palette";
import {
  initialShortcutState,
  reduceShortcut,
  type ShortcutEvent,
} from "../src/lib/keyboard-shortcuts";

const noteEntry = (id: string, label: string, subtitle?: string): PaletteEntry => ({
  id: `note:${id}`,
  kind: "note",
  label,
  subtitle,
  payload: { kind: "note", noteId: id },
});

const tagEntry = (tag: string, label = tag): PaletteEntry => ({
  id: `tag:${tag}`,
  kind: "tag",
  label,
  payload: { kind: "tag", tag },
});

const groupsOf = (
  notes: PaletteEntry[] = [],
  tags: PaletteEntry[] = [],
): PaletteGroups => ({ notes, tags });

const GROUPS = groupsOf(
  [noteEntry("n-1", "Alpha note", "yesterday"), noteEntry("n-2", "Beta note")],
  [tagEntry("work"), tagEntry("home")],
);

let handle: PaletteHandle | null = null;

interface MountResult {
  host: HTMLElement;
  onSelectEntry: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  handle: PaletteHandle;
}

function mount(
  groups: PaletteGroups = GROUPS,
  selectedTagFilters: readonly string[] = [],
): MountResult {
  const host = document.createElement("div");
  document.body.append(host);
  const onSelectEntry = vi.fn();
  const onClose = vi.fn();
  handle = mountPalette({
    host,
    groups,
    selectedTagFilters,
    onSelectEntry,
    onClose,
  });
  return { host, onSelectEntry, onClose, handle };
}

afterEach(() => {
  handle?.destroy();
  handle = null;
  document.body.innerHTML = "";
});

const backdropOf = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>(".palette-backdrop");

const inputOf = (host: HTMLElement): HTMLInputElement =>
  host.querySelector<HTMLInputElement>(".palette-input") as HTMLInputElement;

const rowsOf = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(".pr-item"),
];

const rowLabels = (host: HTMLElement): (string | null)[] =>
  rowsOf(host).map((row) => row.querySelector(".pr-item-label")?.textContent ?? null);

const activeIdOf = (host: HTMLElement): string | undefined =>
  rowsOf(host).find((row) => row.classList.contains("is-active"))?.dataset.entryId;

/**
 * The results area's children in append order, by *first* class — headers
 * included. Only the first token, because the seeded-active row also carries
 * `is-active` and this helper is about append order, not highlight state.
 */
const resultsShape = (host: HTMLElement): string[] => [
  ...(host.querySelector(".palette-results")?.children ?? []),
].map((child) => child.className.split(" ")[0]);

function type(host: HTMLElement, value: string): void {
  const input = inputOf(host);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Dispatches a keydown on the input and reports whether default was prevented. */
function press(host: HTMLElement, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  inputOf(host).dispatchEvent(event);
  return event.defaultPrevented;
}

describe("mountPalette overlay shape", () => {
  it("builds a modal dialog around an input, a results area and the hint strip", () => {
    const { host } = mount();
    const backdrop = backdropOf(host);

    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute("role")).toBe("dialog");
    expect(backdrop?.getAttribute("aria-modal")).toBe("true");
    expect(backdrop?.getAttribute("aria-label")).toBe("Command palette");

    // Paint order inside the palette is the contract: input, results, hints.
    const palette = backdrop?.querySelector(".palette");
    expect([...(palette?.children ?? [])].map((child) => child.className)).toEqual([
      "palette-input",
      "palette-results",
      "palette-hints",
    ]);
  });

  it("configures the input so a search field does not autocomplete or spellcheck", () => {
    const { host } = mount();
    const input = inputOf(host);

    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("Search notes and tags…");
    expect(input.autocomplete).toBe("off");
    expect(input.spellcheck).toBe(false);
    expect(input.getAttribute("aria-label")).toBe("Search notes and tags");
  });

  it("focuses the input, and does so after the overlay is in the document", () => {
    // The source comment is explicit that focus has to follow `append` or the
    // first keystroke is lost in some browsers. An element outside the
    // document cannot take focus, so asserting `activeElement` is what pins
    // the ordering rather than merely the call.
    const { host } = mount();
    expect(document.activeElement).toBe(inputOf(host));
  });

  it("appends to the host it was given, not to document.body", () => {
    const { host } = mount();
    expect(backdropOf(host)?.parentElement).toBe(host);
  });
});

describe("mountPalette results rendering", () => {
  it("groups notes and tags under their own headers", () => {
    const { host } = mount();

    expect(resultsShape(host)).toEqual([
      "pr-group",
      "pr-item",
      "pr-item",
      "pr-group",
      "pr-item",
      "pr-item",
    ]);
    expect(
      [...host.querySelectorAll(".pr-group")].map((h) => h.textContent),
    ).toEqual(["Notes", "Tags"]);
  });

  it("omits the Notes header when only tags match", () => {
    const { host } = mount(groupsOf([], [tagEntry("work")]));
    expect(
      [...host.querySelectorAll(".pr-group")].map((h) => h.textContent),
    ).toEqual(["Tags"]);
  });

  it("omits the Tags header when only notes match", () => {
    const { host } = mount(groupsOf([noteEntry("n-1", "Alpha")], []));
    expect(
      [...host.querySelectorAll(".pr-group")].map((h) => h.textContent),
    ).toEqual(["Notes"]);
  });

  it("renders a row's label and its optional subtitle", () => {
    const { host } = mount();
    const [first, second] = rowsOf(host);

    expect(first.querySelector(".pr-item-label")?.textContent).toBe("Alpha note");
    expect(first.querySelector(".pr-item-sub")?.textContent).toBe("yesterday");
    // The second note has no subtitle — the element must be absent, not empty.
    expect(second.querySelector(".pr-item-sub")).toBeNull();
  });

  it("exposes each row as an option with a stable entry id", () => {
    const { host } = mount();
    const rows = rowsOf(host);

    expect(rows.map((row) => row.dataset.entryId)).toEqual([
      "note:n-1",
      "note:n-2",
      "tag:work",
      "tag:home",
    ]);
    expect(rows.every((row) => row.getAttribute("role") === "option")).toBe(true);
    expect(rows.every((row) => (row as HTMLButtonElement).type === "button")).toBe(true);
  });
});

describe("mountPalette empty states", () => {
  // Two different messages, and which one shows is the only thing the
  // `currentQuery.trim() ?` ternary decides.
  it("tells a first-run user the notebook is empty", () => {
    const { host } = mount(groupsOf());
    const empty = host.querySelector(".palette-empty");

    expect(empty?.textContent).toBe(
      "This notebook is empty. Start a note or add a tag.",
    );
    expect(rowsOf(host)).toHaveLength(0);
  });

  it("says 'No matches.' when a query filtered everything out", () => {
    const { host } = mount();
    type(host, "zzzz-no-such-thing");

    expect(host.querySelector(".palette-empty")?.textContent).toBe("No matches.");
  });

  it("treats a whitespace-only query as no query at all", () => {
    // `.trim()` is what makes these two cases differ; a query of spaces
    // filters nothing out, so reaching the empty state needs empty groups.
    const { host } = mount(groupsOf());
    type(host, "   ");

    expect(host.querySelector(".palette-empty")?.textContent).toBe(
      "This notebook is empty. Start a note or add a tag.",
    );
  });

  it("drops the group headers along with the rows", () => {
    const { host } = mount();
    type(host, "zzzz");
    expect(resultsShape(host)).toEqual(["palette-empty"]);
  });
});

describe("mountPalette tag chips announce what Enter will do", () => {
  it("labels a note row 'Note' so it cannot be confused with a same-named tag", () => {
    const { host } = mount(groupsOf([noteEntry("n-1", "work")], [tagEntry("work")]));
    const [noteRow, tagRow] = rowsOf(host);

    expect(noteRow.querySelector(".pr-item-kind")?.textContent).toBe("Note");
    expect(tagRow.querySelector(".pr-item-kind")?.textContent).toBe("Add");
  });

  it("offers 'Add' for a tag that is not filtering yet", () => {
    const { host } = mount(GROUPS, []);
    const chip = rowsOf(host)[2].querySelector(".pr-item-kind");

    expect(chip?.textContent).toBe("Add");
    expect(chip?.classList.contains("is-add")).toBe(true);
    expect(chip?.classList.contains("is-remove")).toBe(false);
  });

  it("offers 'Remove' for a tag already in the filter set", () => {
    const { host } = mount(GROUPS, ["work"]);
    const chips = rowsOf(host).map((row) => row.querySelector(".pr-item-kind"));

    // Row 2 is `work` (filtering), row 3 is `home` (not) — so the same render
    // has to produce both arms, which a fixture with one tag could not show.
    expect(chips[2]?.textContent).toBe("Remove");
    expect(chips[2]?.classList.contains("is-remove")).toBe(true);
    expect(chips[3]?.textContent).toBe("Add");
    expect(chips[3]?.classList.contains("is-add")).toBe(true);
  });

  it("never puts a kind chip class on a note row", () => {
    const { host } = mount(GROUPS, ["work"]);
    const chip = rowsOf(host)[0].querySelector(".pr-item-kind");
    expect(chip?.className).toBe("pr-item-kind");
  });
});

describe("mountPalette keyboard navigation", () => {
  it("seeds the first row as active so Enter always has a target", () => {
    // `reconcileActiveEntryId(flat, null)` returns `flat[0].id`, so a freshly
    // opened palette already has a highlight — Enter is never a no-op on a
    // non-empty list.
    const { host } = mount();
    expect(activeIdOf(host)).toBe("note:n-1");
  });

  it("moves the highlight down and up across group boundaries", () => {
    const { host } = mount();

    expect(press(host, "ArrowDown")).toBe(true);
    expect(activeIdOf(host)).toBe("note:n-2");

    press(host, "ArrowDown");
    // This press crosses from the notes group into the tags group — the flat
    // list the navigation walks is built from both.
    expect(activeIdOf(host)).toBe("tag:work");

    expect(press(host, "ArrowUp")).toBe(true);
    expect(activeIdOf(host)).toBe("note:n-2");
  });

  it("keeps aria-selected in step with the visual highlight", () => {
    const { host } = mount();
    press(host, "ArrowDown");

    const selected = rowsOf(host).filter(
      (row) => row.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.entryId).toBe("note:n-2");
    expect(selected[0].classList.contains("is-active")).toBe(true);
  });

  it("scrolls the newly-active row into view, and only that row", () => {
    const { host } = mount();
    const rows = rowsOf(host);
    // ArrowDown moves off the seeded first row onto the second, so it is the
    // second row that has to be scrolled into view. Spying on the OTHERS too
    // is the half that matters: `if (isActive)` guards this call, and a
    // fixture that only checks the active row cannot tell that guard from
    // `if (true)` — which would scroll every row on every keystroke and fight
    // the user's scroll position.
    const spies = rows.map((row) => vi.spyOn(row, "scrollIntoView"));

    press(host, "ArrowDown");

    expect(spies[1]).toHaveBeenCalledWith({ block: "nearest" });
    expect(spies[0]).not.toHaveBeenCalled();
    expect(spies[2]).not.toHaveBeenCalled();
    expect(spies[3]).not.toHaveBeenCalled();
  });

  it("highlights on hover without rebuilding the list", () => {
    const { host } = mount();
    const before = rowsOf(host);

    before[3].dispatchEvent(new Event("mouseenter", { bubbles: true }));

    expect(activeIdOf(host)).toBe("tag:home");
    // Same element objects — a hover must not re-render, or the input would
    // lose focus and the user's typing with it.
    expect(rowsOf(host)[3]).toBe(before[3]);
  });
});

describe("mountPalette selection", () => {
  it("reports the clicked entry and tears the overlay down", () => {
    const { host, onSelectEntry, onClose } = mount();

    rowsOf(host)[1].dispatchEvent(new Event("click", { bubbles: true }));

    expect(onSelectEntry).toHaveBeenCalledTimes(1);
    expect(onSelectEntry.mock.calls[0][0].payload).toEqual({
      kind: "note",
      noteId: "n-2",
    });
    expect(backdropOf(host)).toBeNull();
    // Selecting is not closing: the caller navigates, it does not also get an
    // onClose it would have to distinguish.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("commits the highlighted entry on Enter", () => {
    const { host, onSelectEntry } = mount();
    press(host, "ArrowDown");

    expect(press(host, "Enter")).toBe(true);
    expect(onSelectEntry.mock.calls[0][0].id).toBe("note:n-2");
    expect(backdropOf(host)).toBeNull();
  });

  it("commits the seeded first row when Enter is the very first key", () => {
    const { host, onSelectEntry } = mount();

    press(host, "Enter");

    expect(onSelectEntry.mock.calls[0][0].id).toBe("note:n-1");
  });

  it("does nothing on Enter when the list is empty", () => {
    // `activateCurrent`'s `if (!target) return;`. Reaching it needs an empty
    // list, not merely an unpressed palette — `reconcileActiveEntryId` seeds a
    // highlight whenever there is a row to seed, so the guard's only live
    // input is "nothing to select".
    const { host, onSelectEntry, onClose } = mount(groupsOf());

    expect(press(host, "Enter")).toBe(true);
    expect(onSelectEntry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(backdropOf(host)).not.toBeNull();
  });

  it("re-seeds the highlight to the top match when the query changes", () => {
    // Typing drops the previous highlight (`currentActiveId = null`) and
    // `renderResults` reconciles it to the new first row, so Enter always
    // commits the top match rather than whatever the user had highlighted
    // before the list changed under them.
    const { host } = mount();
    press(host, "ArrowDown");
    press(host, "ArrowDown");
    expect(activeIdOf(host)).toBe("tag:work");

    type(host, "note");
    expect(rowLabels(host)).toEqual(["Alpha note", "Beta note"]);
    expect(activeIdOf(host)).toBe("note:n-1");
  });
});

describe("mountPalette dismissal", () => {
  it("closes on Escape without reporting a selection", () => {
    const { host, onSelectEntry, onClose } = mount();

    expect(press(host, "Escape")).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectEntry).not.toHaveBeenCalled();
    expect(backdropOf(host)).toBeNull();
  });

  it("closes on a mousedown that starts on the backdrop", () => {
    const { host, onClose } = mount();
    const backdrop = backdropOf(host) as HTMLElement;

    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backdropOf(host)).toBeNull();
  });

  it("does not close on a mousedown that starts inside the palette", () => {
    // `event.target === backdrop` is the whole guard: a drag that begins on a
    // row and ends over the backdrop must not dismiss the palette. The event
    // bubbles to the backdrop either way, so only the target tells them apart.
    const { host, onClose } = mount();

    rowsOf(host)[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();
    expect(backdropOf(host)).not.toBeNull();
  });

  it("ignores an unhandled key", () => {
    const { host, onClose, onSelectEntry } = mount();

    expect(press(host, "Tab")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSelectEntry).not.toHaveBeenCalled();
    expect(backdropOf(host)).not.toBeNull();
  });
});

describe("PaletteHandle", () => {
  it("re-applies the live query to the replaced groups", () => {
    // The case this exists for: a background Drive load finishes while the
    // palette is open. The user's typing has to survive it.
    const { host, handle: h } = mount();
    type(host, "beta");
    expect(rowLabels(host)).toEqual(["Beta note"]);

    h.update(
      groupsOf([noteEntry("n-3", "Beta redux"), noteEntry("n-4", "Gamma")], []),
      [],
    );

    expect(rowLabels(host)).toEqual(["Beta redux"]);
  });

  it("re-reads the filter snapshot so the chips follow it", () => {
    const { host, handle: h } = mount(GROUPS, []);
    expect(rowsOf(host)[2].querySelector(".pr-item-kind")?.textContent).toBe("Add");

    h.update(GROUPS, ["work"]);

    expect(rowsOf(host)[2].querySelector(".pr-item-kind")?.textContent).toBe("Remove");
  });

  it("is idempotent on destroy", () => {
    const { host, handle: h, onClose } = mount();

    h.destroy();
    h.destroy();

    expect(backdropOf(host)).toBeNull();
    // Teardown is not a close: `onClose` belongs to the Escape/backdrop
    // routes, and destroy() is the caller tearing down its own overlay.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores update() after destroy", () => {
    const { host, handle: h } = mount();
    h.destroy();

    h.update(groupsOf([noteEntry("n-9", "Should not appear")], []), []);

    expect(backdropOf(host)).toBeNull();
    expect(host.querySelector(".pr-item")).toBeNull();
  });

  it("leaves the DOM alone when destroyed after a selection already tore it down", () => {
    const { host, handle: h } = mount();
    rowsOf(host)[0].dispatchEvent(new Event("click", { bubbles: true }));

    expect(() => h.destroy()).not.toThrow();
    expect(backdropOf(host)).toBeNull();
  });
});

/** The hint strip as `[keys, label]` pairs, in append order. */
function hintRows(host: HTMLElement): (readonly [string[], string])[] {
  return [...host.querySelectorAll<HTMLElement>(".palette-hint")].map(
    (row) =>
      [
        [...row.querySelectorAll(".palette-hint-key")].map((k) => k.textContent ?? ""),
        row.querySelector(".palette-hint-label")?.textContent ?? "",
      ] as const,
  );
}

/**
 * A bare keydown payload for `reduceShortcut` — no modifiers, and explicitly
 * not from an editing target (the reducer suppresses every shortcut when the
 * user is typing into a field, which would make this sweep report nothing).
 */
function shortcutKeydown(key: string): ShortcutEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isEditingTarget: false,
    isDetailRoute: false,
    // Fixed clock: the `G` prefix expires on a timeout, and a real `Date.now()`
    // between the two presses of a pair would make this sweep flaky.
    now: 0,
  };
}

describe("palette shortcut hints", () => {
  // Recipe #27: the expected strip is written out literally rather than read
  // back from the module, so a hint quietly disappearing is a failure and not
  // a self-fulfilling assertion.
  const EXPECTED_HINTS: readonly (readonly [readonly string[], string])[] = [
    [["N"], "New note"],
    [["G", "T"], "Today"],
    [["G", "N"], "Notes"],
    [["G", "L"], "Links"],
    [["G", "K"], "Tasks"],
    [["Esc"], "Close"],
  ];

  it("shows exactly the documented strip, in order", () => {
    const { host } = mount();
    expect(hintRows(host)).toEqual(EXPECTED_HINTS);
  });

  it("renders each key as its own kbd element", () => {
    // The `G …` pairs are two keycaps, not one — the source comment calls this
    // out as the "press them in order" affordance.
    const { host } = mount();
    const keycaps = [...host.querySelectorAll(".palette-hint-key")];

    expect(keycaps.every((k) => k.tagName === "KBD")).toBe(true);
    expect(keycaps).toHaveLength(
      EXPECTED_HINTS.reduce((total, [keys]) => total + keys.length, 0),
    );
  });

  it("only advertises shortcuts the global reducer actually implements", () => {
    // The source comment promises this strip mirrors `lib/keyboard-shortcuts`
    // and warns that drift would be silent. There is no exported table to diff
    // against, so drive the reducer with each advertised sequence and require
    // an action to come out. This is the assertion that fails when a hint
    // outlives the shortcut it names.
    for (const [keys, label] of EXPECTED_HINTS) {
      if (label === "Close") continue; // Esc is the palette's own, not the reducer's.

      let state = initialShortcutState;
      let action: unknown = null;
      for (const key of keys) {
        const result = reduceShortcut(state, shortcutKeydown(key.toLowerCase()));
        state = result.state;
        action = result.action;
      }
      expect(action, `no reducer action for ${keys.join(" ")} (${label})`).not.toBeNull();
    }
  });
});

describe("palette highlight is singular", () => {
  // These four assertions exist because the obvious ones cannot see the
  // mutants. `activeIdOf` reads the FIRST matching row, so a highlight
  // painted onto every row looks identical to one painted onto the right
  // row — only a count can tell them apart.
  const activeRows = (host: HTMLElement) =>
    rowsOf(host).filter((row) => row.classList.contains("is-active"));

  const selectedRows = (host: HTMLElement) =>
    rowsOf(host).filter((row) => row.getAttribute("aria-selected") === "true");

  it("marks exactly one row active on the initial render", () => {
    const { host } = mount();
    expect(activeRows(host)).toHaveLength(1);
    expect(activeRows(host)[0].dataset.entryId).toBe("note:n-1");
  });

  it("sets aria-selected on exactly one row before any navigation", () => {
    // `buildResultItem` writes aria-selected at build time, and
    // `highlightActive` overwrites it on every arrow press — so an assertion
    // made *after* navigating is testing `highlightActive`, not the builder.
    // This one has to run on the untouched first render.
    const { host } = mount();
    expect(selectedRows(host)).toHaveLength(1);
    expect(selectedRows(host)[0].dataset.entryId).toBe("note:n-1");
    expect(
      rowsOf(host).filter((row) => row.getAttribute("aria-selected") === "false"),
    ).toHaveLength(3);
  });

  it("still marks exactly one row active after navigating", () => {
    const { host } = mount();
    press(host, "ArrowDown");
    press(host, "ArrowDown");

    expect(activeRows(host)).toHaveLength(1);
    expect(selectedRows(host)).toHaveLength(1);
    expect(activeRows(host)[0].dataset.entryId).toBe("tag:work");
  });

  it("moves the highlight rather than accumulating it across hovers", () => {
    const { host } = mount();
    const rows = rowsOf(host);

    rows[1].dispatchEvent(new Event("mouseenter", { bubbles: true }));
    rows[3].dispatchEvent(new Event("mouseenter", { bubbles: true }));

    expect(activeRows(host)).toHaveLength(1);
    expect(activeRows(host)[0].dataset.entryId).toBe("tag:home");
  });
});

describe("palette teardown latches", () => {
  it("stops re-rendering the detached overlay after destroy", () => {
    // `destroyed = true` and the `if (destroyed) return` in `update` are only
    // observable on the DETACHED tree: once the backdrop is off the host,
    // querying the host finds nothing whether or not the palette kept
    // rendering into it. So hold the reference and watch it directly.
    const { host, handle: h } = mount();
    const detached = backdropOf(host) as HTMLElement;
    const before = [...detached.querySelectorAll(".pr-item")].map(
      (row) => (row as HTMLElement).dataset.entryId,
    );

    h.destroy();
    h.update(groupsOf([noteEntry("n-9", "Should not appear")], []), []);

    expect(
      [...detached.querySelectorAll(".pr-item")].map(
        (row) => (row as HTMLElement).dataset.entryId,
      ),
    ).toEqual(before);
    expect(detached.textContent).not.toContain("Should not appear");
  });

  it("ignores update() after a selection tore the overlay down", () => {
    const { host, handle: h } = mount();
    const detached = backdropOf(host) as HTMLElement;
    rowsOf(host)[0].dispatchEvent(new Event("click", { bubbles: true }));

    h.update(groupsOf([noteEntry("n-9", "Should not appear")], []), []);

    expect(detached.textContent).not.toContain("Should not appear");
  });
});
