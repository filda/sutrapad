import {
  buildAvailableTagIndex,
  buildTagIndex,
  filterNotesByAllTags,
} from "../../../lib/notebook";
import type { SutraPadWorkspace } from "../../../types";
import { buildNotesList } from "../shared/notes-list";
import { buildSelectedFiltersBar } from "../shared/selected-filters-bar";

export interface TagsPageOptions {
  workspace: SutraPadWorkspace;
  selectedTagFilters: string[];
  currentNoteId: string;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onRemoveSelectedFilter: (tag: string) => void;
  onOpenNote: (noteId: string) => void;
}

export function buildTagsPage({
  workspace,
  selectedTagFilters,
  currentNoteId,
  onToggleTagFilter,
  onClearTagFilters,
  onRemoveSelectedFilter,
  onOpenNote,
}: TagsPageOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "tags-page";

  const header = document.createElement("header");
  header.className = "tags-page-header";

  const heading = document.createElement("div");
  heading.innerHTML = `
    <p class="panel-eyebrow">Tags</p>
    <h2>Browse by tag</h2>
  `;
  header.append(heading);

  if (selectedTagFilters.length > 0) {
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "button button-ghost";
    clearButton.textContent = "Clear filters";
    clearButton.onclick = onClearTagFilters;
    header.append(clearButton);
  }

  section.append(header);

  if (buildTagIndex(workspace).tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tags-page-empty";
    empty.textContent =
      "No tags yet. Add tags to your notes to see them here.";
    section.append(empty);
    return section;
  }

  const tagIndex = buildAvailableTagIndex(workspace, selectedTagFilters);

  const cloud = document.createElement("div");
  cloud.className = "tags-cloud-wide";

  for (const entry of tagIndex.tags) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `tag-filter-chip${selectedTagFilters.includes(entry.tag) ? " is-active" : ""}`;
    chip.textContent = `${entry.tag} · ${entry.count}`;
    chip.onclick = () => onToggleTagFilter(entry.tag);
    cloud.append(chip);
  }

  section.append(cloud);

  if (selectedTagFilters.length === 0) {
    const hint = document.createElement("p");
    hint.className = "tags-page-hint";
    hint.textContent = "Select one or more tags to see matching notebooks.";
    section.append(hint);
    return section;
  }

  const matches = document.createElement("section");
  matches.className = "tags-page-matches";

  const selectedFiltersBar = buildSelectedFiltersBar(
    selectedTagFilters,
    onRemoveSelectedFilter,
  );
  matches.append(selectedFiltersBar);

  const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);

  if (filteredNotes.length > 0) {
    const summary = document.createElement("p");
    summary.className = "tags-page-summary";
    summary.textContent = `Showing ${filteredNotes.length} notebook${filteredNotes.length === 1 ? "" : "s"} that match every selected tag.`;
    matches.append(summary);
  }

  matches.append(buildNotesList(currentNoteId, filteredNotes, onOpenNote));
  section.append(matches);

  return section;
}
