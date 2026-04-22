import {
  buildAvailableCombinedTagIndex,
  buildCombinedTagIndex,
  filterNotesByTags,
} from "../../../lib/notebook";
import type {
  SutraPadTagEntry,
  SutraPadTagFilterMode,
  SutraPadWorkspace,
} from "../../../types";
import {
  buildNotesList,
  type NotesListPersonaOptions,
} from "../shared/notes-list";
import { buildPageHeader } from "../shared/page-header";
import { buildSelectedFiltersBar } from "../shared/selected-filters-bar";
import { appendTagChipContent } from "../shared/tag-chip-content";

export interface TagsPageOptions {
  workspace: SutraPadWorkspace;
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  currentNoteId: string;
  /** See NotesPanelOptions.personaOptions — same contract, off when absent. */
  personaOptions?: NotesListPersonaOptions;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void;
  onRemoveSelectedFilter: (tag: string) => void;
  onOpenNote: (noteId: string) => void;
}

const FILTER_MODE_OPTIONS: ReadonlyArray<{
  mode: SutraPadTagFilterMode;
  label: string;
  ariaLabel: string;
}> = [
  { mode: "all", label: "All", ariaLabel: "Match every selected tag" },
  { mode: "any", label: "Any", ariaLabel: "Match any selected tag" },
];

function buildFilterModeToggle(
  activeMode: SutraPadTagFilterMode,
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "filter-mode-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Combine selected tags with");

  for (const option of FILTER_MODE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-mode-button${option.mode === activeMode ? " is-active" : ""}`;
    button.textContent = option.label;
    button.setAttribute("aria-pressed", option.mode === activeMode ? "true" : "false");
    button.setAttribute("aria-label", option.ariaLabel);
    button.addEventListener("click", () => {
      if (option.mode !== activeMode) onChangeFilterMode(option.mode);
    });
    group.append(button);
  }

  return group;
}

function appendTagChips(
  cloud: HTMLElement,
  entries: readonly SutraPadTagEntry[],
  selectedTagFilters: string[],
  onToggleTagFilter: (tag: string) => void,
): void {
  for (const entry of entries) {
    const chip = document.createElement("button");
    chip.type = "button";
    const isAuto = entry.kind === "auto";
    chip.className = [
      "tag-filter-chip",
      isAuto ? "is-auto" : "",
      selectedTagFilters.includes(entry.tag) ? "is-active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    appendTagChipContent(chip, entry.tag, isAuto, ` · ${entry.count}`);
    chip.addEventListener("click", () => onToggleTagFilter(entry.tag));
    cloud.append(chip);
  }
}

export function buildTagsPage({
  workspace,
  selectedTagFilters,
  filterMode,
  currentNoteId,
  personaOptions,
  onToggleTagFilter,
  onClearTagFilters,
  onChangeFilterMode,
  onRemoveSelectedFilter,
  onOpenNote,
}: TagsPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "tags-page";

  // We build the full combined index (not the narrowed "available" one) so the
  // empty-state decision is based on whether *any* tag exists anywhere —
  // narrowing by the current filter would mislead a user whose selection
  // accidentally filtered out every other tag.
  const fullIndex = buildCombinedTagIndex(workspace);

  const noteCount = workspace.notes.length;
  const actions: HTMLElement[] = [
    buildFilterModeToggle(filterMode, onChangeFilterMode),
  ];
  if (selectedTagFilters.length > 0) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "button button-ghost";
    clearButton.textContent = "Clear filters";
    clearButton.addEventListener("click", onClearTagFilters);
    actions.push(clearButton);
  }

  section.append(
    buildPageHeader({
      eyebrow: `Tags · ${fullIndex.tags.length} unique · ${noteCount} note${noteCount === 1 ? "" : "s"}`,
      titleHtml: "A <em>constellation</em> of what you think about.",
      subtitle:
        "Click tags to filter. Combine several and we'll show the notebooks that live where they overlap — All narrows to intersection, Any expands to union.",
      actions,
    }),
  );

  if (fullIndex.tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tags-page-empty";
    empty.textContent =
      "No tags yet. Add tags to your notes, or capture a page to auto-tag it by device, date, and location.";
    section.append(empty);
    return section;
  }

  // For the rendered cloud we use the *available* index: narrows to tags that
  // still yield results under the current selection + mode, so the next click
  // is never a dead end. When there's no active selection this collapses to
  // the full index, preserving the original "show everything" behaviour.
  const availableIndex = buildAvailableCombinedTagIndex(
    workspace,
    selectedTagFilters,
    filterMode,
  );
  const userEntries = availableIndex.tags.filter((entry) => entry.kind !== "auto");
  const autoEntries = availableIndex.tags.filter((entry) => entry.kind === "auto");

  if (userEntries.length > 0) {
    const userHeading = document.createElement("p");
    userHeading.className = "tags-cloud-heading";
    userHeading.textContent = "Your tags";
    section.append(userHeading);

    const userCloud = document.createElement("div");
    userCloud.className = "tags-cloud-wide";
    appendTagChips(userCloud, userEntries, selectedTagFilters, onToggleTagFilter);
    section.append(userCloud);
  }

  if (autoEntries.length > 0) {
    const autoHeading = document.createElement("p");
    autoHeading.className = "tags-cloud-heading is-auto";
    autoHeading.textContent = "Auto tags";
    section.append(autoHeading);

    const autoCloud = document.createElement("div");
    autoCloud.className = "tags-cloud-wide";
    appendTagChips(autoCloud, autoEntries, selectedTagFilters, onToggleTagFilter);
    section.append(autoCloud);
  }

  if (selectedTagFilters.length === 0) {
    const hint = document.createElement("p");
    hint.className = "tags-page-hint";
    hint.textContent =
      "Select one or more tags to see matching notebooks. Use All to require every tag, Any for a union.";
    section.append(hint);
    return section;
  }

  const matches = document.createElement("section");
  matches.className = "tags-page-matches";

  const selectedFiltersBar = buildSelectedFiltersBar({
    selectedTagFilters,
    filterMode,
    autoTagLookup: new Set(autoEntries.map((entry) => entry.tag)),
    onRemoveSelectedFilter,
  });
  matches.append(selectedFiltersBar);

  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    filterMode,
  );

  if (filteredNotes.length > 0) {
    const summary = document.createElement("p");
    summary.className = "tags-page-summary";
    const modePhrase = filterMode === "any" ? "any selected tag" : "every selected tag";
    summary.textContent = `Showing ${filteredNotes.length} notebook${filteredNotes.length === 1 ? "" : "s"} that match ${modePhrase}.`;
    matches.append(summary);
  }

  matches.append(
    buildNotesList(
      currentNoteId,
      filteredNotes,
      onOpenNote,
      undefined,
      personaOptions,
    ),
  );
  section.append(matches);

  return section;
}
