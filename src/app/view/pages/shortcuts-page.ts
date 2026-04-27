/**
 * Keyboard shortcuts cheat-sheet — long-form list of every key the app
 * actually responds to.
 *
 * **Layout** is lifted from the v3 design handoff
 * (`extracted/13_footer_static_pages.jsx`, `ShortcutsScreen`): grouped
 * tables under a kbd-grid container, monospace key column on the left,
 * action description on the right.
 *
 * **Content** is *not* the v3 copy verbatim. The v3 prototype lists
 * combinations like `⌘ + V` (paste link as note), `⌘ + Shift + S`
 * (browser-wide save), `⌘ + Enter` (save & close), `⌘ + K` (add tag),
 * `F` (focus filter) — none of which exist in the current codebase. A
 * cheat-sheet that documents shortcuts the app doesn't implement is
 * worse than no cheat-sheet at all (the user presses the key, nothing
 * happens, and they lose trust in the rest of the page). The rows below
 * mirror the actual handlers in:
 *   - `src/lib/keyboard-shortcuts.ts` — `N`, `G T/N/L/K`, `Escape`
 *   - `src/app/lifecycle/palette.ts`   — `/` opens the palette
 *   - `src/app/view/chrome/tag-filter-bar.ts` — typeahead navigation
 *
 * **Updating:** when a new global shortcut lands in `keyboard-shortcuts.ts`
 * (or a new context-specific one in a chrome module), add a row here in
 * the matching group. The table is cheap to keep in sync because each
 * row is a `[keyCombo, description]` tuple — no DOM building per row.
 */

import { buildStaticPageShell } from "../chrome/static-page-shell";
import type { MenuItemId } from "../../logic/menu";

export interface ShortcutsPageOptions {
  onSelectMenuItem: (id: MenuItemId) => void;
}

interface ShortcutGroup {
  heading: string;
  rows: ReadonlyArray<readonly [keys: readonly string[], description: string]>;
}

/**
 * Each row's `keys` is an array because some shortcuts are sequential
 * (`G` then `T`) — rendering joins the array with `then` so the prose
 * reads naturally. Single-key shortcuts pass a one-element array.
 */
const GROUPS: readonly ShortcutGroup[] = [
  {
    heading: "Navigation",
    rows: [
      [["G", "T"], "Home (Today)"],
      [["G", "N"], "Notes"],
      [["G", "L"], "Links"],
      [["G", "K"], "Tasks"],
      [["/"], "Open the palette (search notes + tags)"],
    ],
  },
  {
    heading: "Capture",
    rows: [
      [["N"], "New note — opens the editor with a fresh draft"],
    ],
  },
  {
    heading: "In a note",
    rows: [
      [["Esc"], "Leave the detail editor and return to the notes list"],
    ],
  },
  {
    heading: "Tag filter (topbar typeahead)",
    rows: [
      [["↑"], "Previous suggestion"],
      [["↓"], "Next suggestion"],
      [["Enter"], "Commit the highlighted suggestion as a filter chip"],
      [["Tab"], "Autocomplete to the highlighted suggestion (Tab again commits)"],
      [["Backspace"], "Remove the last filter chip when the input is empty"],
      [["Esc"], "Close the dropdown — three Escapes in a row clear all filters"],
    ],
  },
];

export function buildShortcutsPage({
  onSelectMenuItem,
}: ShortcutsPageOptions): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "kbd-grid";
  for (const group of GROUPS) {
    grid.append(buildGroup(group));
  }

  return buildStaticPageShell({
    eyebrow: "Keyboard shortcuts",
    titleHtml: "The <em>quick keys.</em>",
    subtitle:
      "SutraPad is keyboard-first. Here's the full sheet — every combination below is wired in the current build.",
    lastUpdated: "April 2026",
    content: [grid],
    onSelectMenuItem,
  });
}

function buildGroup(group: ShortcutGroup): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "kbd-group";

  const heading = document.createElement("h3");
  heading.className = "kbd-group-head";
  heading.textContent = group.heading;
  wrapper.append(heading);

  const table = document.createElement("table");
  table.className = "kbd-table";
  const tbody = document.createElement("tbody");
  for (const [keys, description] of group.rows) {
    tbody.append(buildRow(keys, description));
  }
  table.append(tbody);
  wrapper.append(table);

  return wrapper;
}

function buildRow(
  keys: readonly string[],
  description: string,
): HTMLTableRowElement {
  const tr = document.createElement("tr");

  const keyCell = document.createElement("td");
  keyCell.className = "kbd-key-cell";
  for (const [index, key] of keys.entries()) {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "kbd-sep";
      sep.textContent = " then ";
      keyCell.append(sep);
    }
    const kbd = document.createElement("kbd");
    kbd.className = "kbd-key";
    kbd.textContent = key;
    keyCell.append(kbd);
  }
  tr.append(keyCell);

  const descCell = document.createElement("td");
  descCell.className = "kbd-desc-cell";
  descCell.textContent = description;
  tr.append(descCell);

  return tr;
}
