// @vitest-environment happy-dom
//
// First focused test for `src/app/view/pages/shortcuts-page.ts` — the
// keyboard cheat-sheet. The module header states the invariant that makes
// this page worth measuring at all: **every combination listed here is wired
// in the current build**, and the v3 prototype's shortcuts that were never
// implemented were deliberately dropped. A cheat-sheet documenting a key that
// does nothing is worse than no cheat-sheet, because the user presses it,
// nothing happens, and they stop trusting the rest of the page.
//
// So the table is asserted whole — every key, every description, group by
// group — and then cross-checked against the real handler. There is no
// exported shortcut table to diff against (the keys live inside
// `reduceShortcut`'s branches), so the check drives the reducer over the
// alphabet and asks which keys produce an action. That second assertion is
// the one that fails when someone adds a shortcut and forgets this page.
//
// The one piece of real rendering logic is the multi-key row: `["G", "T"]`
// renders as two `<kbd>`s with a " then " separator between them, and the
// separator must appear *between* keys only — `index > 0`, not `>= 0`. A
// single-key row is the fixture that tells those apart.

import { describe, expect, it, vi } from "vitest";
import { buildShortcutsPage } from "../src/app/view/pages/shortcuts-page";
import {
  initialShortcutState,
  reduceShortcut,
  type ShortcutEvent,
} from "../src/lib/keyboard-shortcuts";

const ALPHABET = [..."abcdefghijklmnopqrstuvwxyz"];

const keydown = (key: string): ShortcutEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isEditingTarget: false,
  isDetailRoute: false,
  now: 1_800_000_000_000,
});

function mount() {
  const onSelectMenuItem = vi.fn();
  const page = buildShortcutsPage({ onSelectMenuItem });
  return { page, onSelectMenuItem };
}

const groups = (page: HTMLElement): HTMLElement[] => [
  ...page.querySelectorAll<HTMLElement>(".kbd-group"),
];

/** `["h3.kbd-group-head", "table.kbd-table"]` for one element's children. */
const childShape = (parent: Element): string[] =>
  [...parent.children].map((child) => `${child.tagName.toLowerCase()}.${child.className}`);

/** The pipe-joined class list of one row's cells. */
const cellShape = (row: Element): string =>
  [...row.children].map((cell) => cell.className).join("|");

/** `"G then T → Home (Today)"` for every row of one group, in order. */
const rowsOf = (group: HTMLElement): string[] =>
  [...group.querySelectorAll("tbody tr")].map(
    (row) =>
      `${row.querySelector(".kbd-key-cell")?.textContent} → ${
        row.querySelector(".kbd-desc-cell")?.textContent
      }`,
  );

describe("buildShortcutsPage shell", () => {
  it("fills the header slots and claims the sheet is current", () => {
    const { page } = mount();

    expect(page.className).toBe("static-page");
    expect(page.querySelector(".static-page-eyebrow")?.textContent).toBe(
      "Keyboard shortcuts",
    );
    // The promise in the subtitle is the reason the table below is asserted
    // exhaustively.
    expect(page.querySelector(".static-page-subtitle")?.textContent).toBe(
      "SutraPad is keyboard-first. Here's the full sheet — every combination below is wired in the current build.",
    );
    expect(page.querySelector(".static-page-meta")?.textContent).toBe(
      "Last updated · April 2026",
    );
  });

  it("emphasises the second half of the title", () => {
    const { page } = mount();
    const title = page.querySelector(".static-page-title");

    expect(title?.textContent).toBe("The quick keys.");
    expect(title?.querySelector("em")?.textContent).toBe("quick keys.");
  });

  it("wraps every group in one grid inside the prose article", () => {
    const { page } = mount();

    expect([...(page.querySelector(".prose")?.children ?? [])].map((c) => c.className)).toEqual([
      "kbd-grid",
    ]);
    expect(page.querySelectorAll(".kbd-grid > .kbd-group")).toHaveLength(4);
  });
});

describe("buildShortcutsPage groups", () => {
  it("names the four groups in order", () => {
    const { page } = mount();

    expect(groups(page).map((group) => group.querySelector(".kbd-group-head")?.textContent)).toEqual([
      "Navigation",
      "Capture",
      "In a note",
      "Tag filter (topbar typeahead)",
    ]);
  });

  it("gives each group a heading above its own table", () => {
    const { page } = mount();

    expect(groups(page).map((group) => childShape(group))).toEqual(
      Array.from({ length: 4 }, () => ["h3.kbd-group-head", "table.kbd-table"]),
    );
  });

  it("keeps the group heads at h3, below the page title", () => {
    // The shell owns the `<h1>` and this page has no `<h2>` layer, so h3 is
    // deliberate — it slots under a section heading the shell may add later.
    const { page } = mount();

    expect(page.querySelectorAll(".prose h3")).toHaveLength(4);
    expect(page.querySelectorAll(".prose h2")).toHaveLength(0);
  });

  it("lists the navigation keys", () => {
    const { page } = mount();

    expect(rowsOf(groups(page)[0] as HTMLElement)).toEqual([
      "G then T → Home (Today)",
      "G then N → Notes",
      "G then L → Links",
      "G then K → Tasks",
      "/ → Open the palette (search notes + tags)",
    ]);
  });

  it("lists the capture and in-note keys", () => {
    const { page } = mount();

    expect(rowsOf(groups(page)[1] as HTMLElement)).toEqual([
      "N → New note — opens the editor with a fresh draft",
    ]);
    expect(rowsOf(groups(page)[2] as HTMLElement)).toEqual([
      "Esc → Leave the detail editor and return to the notes list",
    ]);
  });

  it("lists the typeahead keys", () => {
    const { page } = mount();

    expect(rowsOf(groups(page)[3] as HTMLElement)).toEqual([
      "↑ → Previous suggestion",
      "↓ → Next suggestion",
      "Enter → Commit the highlighted suggestion as a filter chip",
      "Tab → Autocomplete to the highlighted suggestion (Tab again commits)",
      "Backspace → Remove the last filter chip when the input is empty",
      "Esc → Close the dropdown — three Escapes in a row clear all filters",
    ]);
  });
});

describe("buildShortcutsPage rows", () => {
  it("separates a sequential shortcut's keys and leaves a single key bare", () => {
    // `index > 0` is the whole rule: a `>= 0` mutant prefixes " then " to the
    // first key of every row, which only a one-key row exposes cleanly.
    const { page } = mount();
    const navRows = [...(groups(page)[0]?.querySelectorAll("tbody tr") ?? [])];
    const cellOf = (index: number) => navRows[index]?.querySelector(".kbd-key-cell");

    expect([...(cellOf(0)?.children ?? [])].map((c) => c.tagName.toLowerCase())).toEqual([
      "kbd",
      "span",
      "kbd",
    ]);
    expect(cellOf(0)?.querySelector(".kbd-sep")?.textContent).toBe(" then ");
    // The `/` row is one key: no separator at all.
    expect([...(cellOf(4)?.children ?? [])].map((c) => c.tagName.toLowerCase())).toEqual(["kbd"]);
    expect(cellOf(4)?.querySelector(".kbd-sep")).toBeNull();
  });

  it("renders keys as <kbd> and descriptions as plain cells", () => {
    // `<kbd>` is what the monospace key styling hangs off; a `<span>` would
    // render the sheet in body type.
    const { page } = mount();
    const keys = [...page.querySelectorAll(".kbd-key")];

    expect(keys.every((key) => key.tagName.toLowerCase() === "kbd")).toBe(true);
    expect(page.querySelectorAll(".kbd-desc-cell kbd")).toHaveLength(0);
    // 4 nav keys × 2 + `/` + N + Esc + 6 typeahead = 17 keys over 13 rows.
    expect(keys).toHaveLength(17);
    expect(page.querySelectorAll(".kbd-table tbody tr")).toHaveLength(13);
  });

  it("puts the key cell before the description in every row", () => {
    const { page } = mount();
    const shapes = [...page.querySelectorAll(".kbd-table tbody tr")].map((row) =>
      cellShape(row),
    );

    expect(new Set(shapes)).toEqual(new Set(["kbd-key-cell|kbd-desc-cell"]));
  });

  it("wraps every row in a tbody rather than hanging it off the table", () => {
    const { page } = mount();

    expect(page.querySelectorAll(".kbd-table > tbody")).toHaveLength(4);
    expect(page.querySelectorAll(".kbd-table > tr")).toHaveLength(0);
  });
});

describe("buildShortcutsPage against the real handlers", () => {
  it("documents every key the global reducer actually responds to", () => {
    // The page's whole promise is that nothing here is aspirational. There is
    // no exported table to diff against — the shortcuts live inside
    // `reduceShortcut` — so the check drives the reducer over the alphabet and
    // asks which keys produce an action. This is the assertion that fails when
    // a shortcut lands in the reducer and nobody adds a row.
    const { page } = mount();
    const documented = new Set(
      [...page.querySelectorAll(".kbd-key")].map((key) => key.textContent?.toLowerCase()),
    );

    const armed = reduceShortcut(initialShortcutState, keydown("g")).state;
    const live = [
      ...ALPHABET.filter(
        (key) => reduceShortcut(initialShortcutState, keydown(key)).action !== null,
      ),
      ...ALPHABET.filter((key) => reduceShortcut(armed, keydown(key)).action !== null),
    ];

    // Sanity: the sweep found something, so an empty `missing` means covered
    // rather than "nothing was checked".
    // Alphabetical, because the sweep walks the alphabet: `n` alone
    // (new note), then `k`/`l`/`n`/`t` after the G prefix.
    expect(live).toEqual(["n", "k", "l", "n", "t"]);
    expect(live.filter((key) => !documented.has(key))).toEqual([]);
  });

  it("documents the G prefix itself and the Escape route", () => {
    const { page } = mount();
    const documented = new Set(
      [...page.querySelectorAll(".kbd-key")].map((key) => key.textContent),
    );

    // `G` arms the prefix rather than acting, so the sweep above cannot see
    // it; `Escape` only acts on the detail route.
    expect(reduceShortcut(initialShortcutState, keydown("g")).state.pending).toBe("g");
    expect(documented.has("G")).toBe(true);

    expect(
      reduceShortcut(initialShortcutState, { ...keydown("Escape"), isDetailRoute: true }).action,
    ).toEqual({ kind: "escape" });
    expect(documented.has("Esc")).toBe(true);
  });
});
