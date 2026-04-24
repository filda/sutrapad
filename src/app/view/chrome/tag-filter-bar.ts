import type { SutraPadTagEntry } from "../../../types";
import {
  rankTagFilterSuggestions,
  resolveTabCompletion,
} from "../../logic/tag-filter-typeahead";
import { buildTagPill } from "../shared/tag-pill";

/**
 * Topbar tag-filter strip. Ported from `docs/design_handoff_sutrapad2/src/tagfilter.jsx` —
 * the inline typeahead lives here so the chrome can filter without opening the
 * palette. The palette (opened via the `/` kbd pill or the global `/`
 * shortcut) is still available as a richer cmd-k surface over notes + tags.
 *
 * Keyboard contract (mirrors the prototype):
 *   - ArrowDown / ArrowUp — cycle the highlighted suggestion.
 *   - Enter with an active suggestion — commit.
 *   - Tab with a typed query — preview (first Tab fills the input with the
 *     highlighted suggestion's full name); a second Tab, now that the query
 *     exactly matches, commits.
 *   - Backspace on an empty input with filters active — remove the last chip.
 *   - Escape — close the dropdown; another Escape clears the query; a third
 *     Escape clears all active filters (if any).
 */
export interface TagFilterBarOptions {
  selectedTagFilters: readonly string[];
  /**
   * Full tag index (expected count-desc + alpha sorted by the caller) the
   * typeahead ranks against. Sorted-ness is part of the contract because
   * `rankTagFilterSuggestions` preserves within-tier ordering.
   */
  availableTagSuggestions: readonly SutraPadTagEntry[];
  /**
   * Persisted newest-first list of recent tag keys (max 8). Rendered as the
   * "Recently used" group when the input is focused with a blank query.
   */
  recentTagFilters: readonly string[];
  /**
   * Tags currently recognised as auto-derived. Passed in rather than
   * re-derived so the caller can hand over the same set it already built
   * for the rest of the render pass.
   */
  autoTagLookup: ReadonlySet<string>;
  onRemoveFilter: (tag: string) => void;
  onClearFilters: () => void;
  onOpenPalette: () => void;
  /**
   * Adds `tag` to the active filter set. App-level code owns the follow-on
   * work (rotating the recent-tag list, persisting, triggering re-render) —
   * this view just shouts "commit" once per user action.
   */
  onApplyFilter: (tag: string) => void;
}

/**
 * Suggestion shown in the dropdown — either a tag entry (typed or recent) or
 * a synthetic "empty" / "hint" row. `row` is rendered as a clickable option
 * only when `kind: "tag"`.
 */
type SuggestionRow =
  | { kind: "tag"; entry: SutraPadTagEntry; group: "suggestion" | "recent" | "popular" }
  | { kind: "empty"; query: string }
  | { kind: "group-label"; label: string };

/**
 * Empty-state view: a handful of recent tags above a "Popular" list built
 * from the available-tag index, minus anything already filtering or in
 * recent. Mirrors the prototype's open-state.
 */
const EMPTY_QUERY_RECENT_LIMIT = 5;
const EMPTY_QUERY_POPULAR_LIMIT = 6;

export function buildTagFilterBar({
  selectedTagFilters,
  availableTagSuggestions,
  recentTagFilters,
  autoTagLookup,
  onRemoveFilter,
  onClearFilters,
  onOpenPalette,
  onApplyFilter,
}: TagFilterBarOptions): HTMLElement {
  const bar = document.createElement("div");
  bar.className = `tag-filter-bar${selectedTagFilters.length > 0 ? " is-active" : ""}`;
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Active tag filters");

  const icon = document.createElement("span");
  icon.className = "tfb-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "#";
  bar.append(icon);

  const chips = document.createElement("div");
  chips.className = "tfb-chips";
  bar.append(chips);

  for (const tag of selectedTagFilters) {
    chips.append(
      buildTagPill({
        tag,
        kind: autoTagLookup.has(tag) ? "auto" : "user",
        active: true,
        onRemove: () => onRemoveFilter(tag),
        removeAriaLabel: `Remove filter ${tag}`,
      }),
    );
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tfb-input";
  input.placeholder =
    selectedTagFilters.length > 0 ? "" : "Filter by tag…";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", "Filter by tag");
  chips.append(input);

  const dropdown = document.createElement("div");
  dropdown.className = "tfb-dropdown";
  dropdown.setAttribute("role", "listbox");
  dropdown.hidden = true;
  bar.append(dropdown);

  // Local (closure) state. Kept out of app.ts on purpose: the query and the
  // active highlight are ephemeral to this render's instance of the bar and
  // flushed when the bar is rebuilt (which happens on every app re-render).
  let activeIdx = 0;
  let suggestions: readonly SutraPadTagEntry[] = [];

  const flatten = (rows: readonly SuggestionRow[]): SutraPadTagEntry[] =>
    rows
      .filter((row): row is Extract<SuggestionRow, { kind: "tag" }> => row.kind === "tag")
      .map((row) => row.entry);

  const computeRows = (): SuggestionRow[] => {
    const query = input.value;
    if (query.trim() === "") {
      return computeEmptyQueryRows(
        availableTagSuggestions,
        recentTagFilters,
        selectedTagFilters,
      );
    }
    return rankTagFilterSuggestions(
      availableTagSuggestions,
      query,
      selectedTagFilters,
    ).map<SuggestionRow>((entry) => ({
      kind: "tag",
      entry,
      group: "suggestion",
    }));
  };

  const renderDropdown = (): void => {
    const rows = computeRows();
    suggestions = flatten(rows);

    // Clamp activeIdx so it always points at a tag row; the view clamps
    // visually via the `.is-active` class, but the keyboard handlers read
    // `suggestions[activeIdx]` which must stay in range.
    if (activeIdx >= suggestions.length) activeIdx = 0;

    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);

    if (rows.length === 0) {
      // Can happen when the query is empty, the workspace has no tags, and
      // there are no recents — the prototype renders nothing in that case.
      input.setAttribute("aria-expanded", "false");
      dropdown.hidden = true;
      return;
    }

    if (rows.every((row) => row.kind === "empty")) {
      const empty = rows[0] as Extract<SuggestionRow, { kind: "empty" }>;
      const node = document.createElement("div");
      node.className = "tfb-empty";
      node.textContent = `No tag matches "${empty.query}"`;
      dropdown.append(node);
      input.setAttribute("aria-expanded", "true");
      dropdown.hidden = false;
      return;
    }

    let tagIndex = 0;
    for (const row of rows) {
      if (row.kind === "group-label") {
        const label = document.createElement("div");
        label.className = "tfb-group";
        label.textContent = row.label;
        dropdown.append(label);
        continue;
      }
      if (row.kind === "empty") continue;

      const option = document.createElement("button");
      option.type = "button";
      option.className = `tfb-suggest${tagIndex === activeIdx ? " is-active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-selected",
        tagIndex === activeIdx ? "true" : "false",
      );

      const name = document.createElement("span");
      name.className = "tfb-name";
      name.textContent = row.entry.tag;
      option.append(name);

      const count = document.createElement("span");
      count.className = "tfb-count mono";
      count.textContent = String(row.entry.count);
      option.append(count);

      const hoveredIndex = tagIndex;
      // mousedown so the suggestion is picked before the input's blur fires
      // and closes the dropdown.
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onApplyFilter(row.entry.tag);
      });
      option.addEventListener("mouseenter", () => {
        if (activeIdx !== hoveredIndex) {
          activeIdx = hoveredIndex;
          updateHighlight();
        }
      });

      dropdown.append(option);
      tagIndex += 1;
    }

    input.setAttribute("aria-expanded", "true");
    dropdown.hidden = false;
  };

  const updateHighlight = (): void => {
    const options = dropdown.querySelectorAll<HTMLButtonElement>(".tfb-suggest");
    options.forEach((option, index) => {
      const active = index === activeIdx;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
    });
  };

  input.addEventListener("input", () => {
    activeIdx = 0;
    renderDropdown();
  });

  input.addEventListener("focus", () => {
    renderDropdown();
  });

  input.addEventListener("blur", () => {
    // Delay so a mousedown on a `.tfb-suggest` runs before the dropdown is
    // torn down. Matches the pattern `tag-input.ts` uses.
    window.setTimeout(() => {
      if (!input.isConnected) return;
      dropdown.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }, 100);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (suggestions.length > 0) {
        event.preventDefault();
        onApplyFilter(suggestions[activeIdx].tag);
      }
      return;
    }

    if (event.key === "Tab") {
      const completion = resolveTabCompletion(input.value, suggestions);
      if (completion.kind === "preview") {
        event.preventDefault();
        input.value = completion.tag;
        activeIdx = 0;
        renderDropdown();
      } else if (completion.kind === "commit") {
        event.preventDefault();
        onApplyFilter(completion.tag);
      }
      // kind: "none" — fall through so Tab moves focus normally.
      return;
    }

    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      activeIdx = (activeIdx + 1) % suggestions.length;
      updateHighlight();
      return;
    }

    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      activeIdx =
        (activeIdx - 1 + suggestions.length) % suggestions.length;
      updateHighlight();
      return;
    }

    if (
      event.key === "Backspace" &&
      input.value === "" &&
      selectedTagFilters.length > 0
    ) {
      event.preventDefault();
      onRemoveFilter(selectedTagFilters[selectedTagFilters.length - 1]);
      return;
    }

    if (event.key === "Escape") {
      if (!dropdown.hidden) {
        event.preventDefault();
        dropdown.hidden = true;
        input.setAttribute("aria-expanded", "false");
        return;
      }
      if (input.value !== "") {
        event.preventDefault();
        input.value = "";
        return;
      }
      if (selectedTagFilters.length > 0) {
        event.preventDefault();
        onClearFilters();
      }
    }
  });

  if (selectedTagFilters.length > 0) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "tfb-clear";
    clear.setAttribute("aria-label", "Clear all filters");
    clear.title = "Clear all filters";
    clear.textContent = "×";
    clear.addEventListener("click", onClearFilters);
    bar.append(clear);
  }

  const hint = document.createElement("kbd");
  hint.className = "tfb-kbd";
  // `/` still routes to the palette — the palette is the cmd-k surface that
  // can search notes + tags, whereas this inline input is tags-only.
  hint.textContent = "/";
  hint.title = "Press / to open the command palette";
  hint.setAttribute("role", "button");
  hint.setAttribute("aria-label", "Open the command palette");
  hint.tabIndex = 0;
  hint.addEventListener("click", onOpenPalette);
  hint.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenPalette();
    }
  });
  bar.append(hint);

  return bar;
}

/**
 * Builds the "focus with blank query" dropdown content:
 *   - An optional "Recently used" group (up to 5 rows) — from persisted
 *     recents, minus anything already filtering.
 *   - A "Popular tags" group (up to 6 rows) — from the tag index, minus
 *     anything already filtering and anything already shown as a recent.
 *
 * Returns an empty array when there are no recents and no popular tags.
 */
function computeEmptyQueryRows(
  available: readonly SutraPadTagEntry[],
  recent: readonly string[],
  excluded: readonly string[],
): SuggestionRow[] {
  const excludedSet = new Set(excluded);
  const recentSet = new Set(recent);

  const recentRows: SuggestionRow[] = [];
  for (const tagName of recent) {
    if (excludedSet.has(tagName)) continue;
    const entry = available.find((candidate) => candidate.tag === tagName);
    if (!entry) continue;
    recentRows.push({ kind: "tag", entry, group: "recent" });
    if (recentRows.length >= EMPTY_QUERY_RECENT_LIMIT) break;
  }

  const popularRows: SuggestionRow[] = [];
  for (const entry of available) {
    if (excludedSet.has(entry.tag)) continue;
    if (recentSet.has(entry.tag)) continue;
    popularRows.push({ kind: "tag", entry, group: "popular" });
    if (popularRows.length >= EMPTY_QUERY_POPULAR_LIMIT) break;
  }

  const rows: SuggestionRow[] = [];
  if (recentRows.length > 0) {
    rows.push({ kind: "group-label", label: "Recently used" });
    rows.push(...recentRows);
  }
  if (popularRows.length > 0) {
    rows.push({ kind: "group-label", label: "Popular tags" });
    rows.push(...popularRows);
  }
  return rows;
}
