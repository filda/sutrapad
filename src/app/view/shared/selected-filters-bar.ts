export function buildSelectedFiltersBar(
  selectedTagFilters: string[],
  onRemoveSelectedFilter: (tag: string) => void,
): HTMLDivElement {
  const selectedFiltersBar = document.createElement("div");
  selectedFiltersBar.className = "selected-filters";
  selectedFiltersBar.hidden = selectedTagFilters.length === 0;

  if (selectedTagFilters.length > 0) {
    const label = document.createElement("span");
    label.className = "selected-filters-label";
    label.textContent = "Filtered by";
    selectedFiltersBar.append(label);

    for (const tag of selectedTagFilters) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "selected-filter-chip";
      chip.textContent = tag;
      chip.addEventListener("click", () => onRemoveSelectedFilter(tag));
      selectedFiltersBar.append(chip);
    }
  }

  return selectedFiltersBar;
}
