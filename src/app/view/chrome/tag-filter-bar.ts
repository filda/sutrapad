import { buildTagPill } from "../shared/tag-pill";

/**
 * Topbar tag-filter strip. Ported loosely from
 * docs/design_handoff_sutrapad/src/tagfilter.jsx, minus the typeahead: the
 * palette (`/` shortcut or click on the trigger) is the single suggestion
 * engine, so this component only surfaces the *current* filter set plus a
 * button that hands off to the palette. Keeping it purely presentational
 * avoids duplicating rank/filter logic.
 *
 * The strip renders:
 *   1. A tag icon (decorative).
 *   2. One `.tag-pill` per active filter with an inner `×` for removal.
 *   3. A dashed "+ Filter by tag…" trigger button that opens the palette.
 *   4. A clear-all control (only when at least one filter is active).
 *   5. A `/` keyboard-hint pill matching the palette shortcut.
 */
export interface TagFilterBarOptions {
  selectedTagFilters: readonly string[];
  /**
   * Tags currently recognised as auto-derived. Passed in rather than
   * re-derived so the caller can hand over the same set it already built
   * for the rest of the render pass.
   */
  autoTagLookup: ReadonlySet<string>;
  onRemoveFilter: (tag: string) => void;
  onClearFilters: () => void;
  onOpenPalette: () => void;
}

export function buildTagFilterBar({
  selectedTagFilters,
  autoTagLookup,
  onRemoveFilter,
  onClearFilters,
  onOpenPalette,
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
    // `active` is true because this strip only ever shows tags already in
    // the filter set — the pill visual should read as "selected".
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

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tfb-trigger";
  trigger.setAttribute(
    "aria-label",
    selectedTagFilters.length > 0
      ? "Add another tag filter"
      : "Open the command palette to filter by tag",
  );
  const triggerLabel = document.createElement("span");
  triggerLabel.className = "tfb-trigger-label";
  triggerLabel.textContent =
    selectedTagFilters.length > 0 ? "+ tag" : "Filter by tag…";
  trigger.append(triggerLabel);
  trigger.addEventListener("click", onOpenPalette);
  chips.append(trigger);

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
  // Mirrors the palette shortcut so users discover `/` from either surface.
  // Clicking the hint opens the palette directly — a small UX bonus for
  // mouse users that costs nothing.
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
