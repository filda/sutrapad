import type { SutraPadTagFilterMode } from "../../../types";
import { appendTagChipContent } from "./tag-chip-content";

export interface SelectedFiltersBarOptions {
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  /**
   * Set of tag values currently recognised as auto-derived. Passed in (rather
   * than re-derived) so the caller can reuse whatever combined index it just
   * built — avoids walking every note twice per render.
   */
  autoTagLookup: ReadonlySet<string>;
  onRemoveSelectedFilter: (tag: string) => void;
}

export function buildSelectedFiltersBar({
  selectedTagFilters,
  filterMode,
  autoTagLookup,
  onRemoveSelectedFilter,
}: SelectedFiltersBarOptions): HTMLDivElement {
  const selectedFiltersBar = document.createElement("div");
  selectedFiltersBar.className = "selected-filters";
  selectedFiltersBar.hidden = selectedTagFilters.length === 0;

  if (selectedTagFilters.length === 0) {
    return selectedFiltersBar;
  }

  const label = document.createElement("span");
  label.className = "selected-filters-label";
  // Mentioning the mode in the label makes the combination rule visible even
  // when the mode toggle (which lives above the chip cloud) has scrolled out
  // of view. "All" / "Any" mirrors the toggle's button copy exactly so the
  // connection is obvious.
  label.textContent =
    selectedTagFilters.length === 1
      ? "Filtered by"
      : `Filtered by ${filterMode === "any" ? "any" : "all"} of`;
  selectedFiltersBar.append(label);

  for (const tag of selectedTagFilters) {
    const chip = document.createElement("button");
    chip.type = "button";
    const isAuto = autoTagLookup.has(tag);
    chip.className = `selected-filter-chip${isAuto ? " is-auto" : ""}`;
    appendTagChipContent(chip, tag, isAuto);
    chip.setAttribute("aria-label", `Remove filter ${tag}`);
    chip.addEventListener("click", () => onRemoveSelectedFilter(tag));
    selectedFiltersBar.append(chip);
  }

  return selectedFiltersBar;
}
