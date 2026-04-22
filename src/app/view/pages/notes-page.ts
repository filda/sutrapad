import {
  buildCombinedTagIndex,
  filterNotesByTags,
} from "../../../lib/notebook";
import type { NotesViewMode } from "../../logic/notes-view";
import type {
  SutraPadTagFilterMode,
  SutraPadWorkspace,
} from "../../../types";
import {
  buildNotesList,
  type NotesListPersonaOptions,
} from "../shared/notes-list";
import { buildNewNoteButton } from "../shared/new-note-button";
import { buildPageHeader } from "../shared/page-header";
import { appendTagChipContent } from "../shared/tag-chip-content";

export interface NotesPanelOptions {
  workspace: SutraPadWorkspace;
  currentNoteId: string;
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  notesViewMode: NotesViewMode;
  /**
   * Persona decoration options. `undefined` keeps the original flat-card
   * rendering; passing an object turns on the persona layer (paper palette,
   * rotation, stickers, patina). The object carries the full workspace notes
   * list so recurrence-based stickers can see the population.
   */
  personaOptions?: NotesListPersonaOptions;
  onSelectNote: (noteId: string) => void;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onNewNote: () => void;
  onChangeNotesView: (mode: NotesViewMode) => void;
}

const VIEW_TOGGLE_OPTIONS: ReadonlyArray<{ mode: NotesViewMode; label: string }> = [
  { mode: "list", label: "List" },
  { mode: "cards", label: "Cards" },
];

function buildViewToggle(
  active: NotesViewMode,
  onChange: (mode: NotesViewMode) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "view-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Notebook view");

  for (const option of VIEW_TOGGLE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `view-toggle-button${option.mode === active ? " is-active" : ""}`;
    button.textContent = option.label;
    button.setAttribute("aria-pressed", option.mode === active ? "true" : "false");
    button.addEventListener("click", () => {
      if (option.mode !== active) onChange(option.mode);
    });
    group.append(button);
  }

  return group;
}

export function buildNotesPanel({
  workspace,
  currentNoteId,
  selectedTagFilters,
  filterMode,
  notesViewMode,
  personaOptions,
  onSelectNote,
  onToggleTagFilter,
  onClearTagFilters,
  onNewNote,
  onChangeNotesView,
}: NotesPanelOptions): HTMLElement {
  const notesPanel = document.createElement("aside");
  notesPanel.className = "notes-panel";

  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    filterMode,
  );
  const combinedIndex = buildCombinedTagIndex(workspace);

  notesPanel.append(
    buildNotesPageHeader({
      totalNotes: workspace.notes.length,
      filteredNotes: filteredNotes.length,
      filterCount: selectedTagFilters.length,
      onNewNote,
    }),
  );

  if (combinedIndex.tags.length > 0) {
    const filterSection = document.createElement("section");
    filterSection.className = "tag-filter-card";

    const filterHeader = document.createElement("div");
    filterHeader.className = "tag-filter-header";

    const filterTitle = document.createElement("p");
    filterTitle.className = "panel-eyebrow";
    filterTitle.textContent =
      selectedTagFilters.length > 0 ? `Filter (${selectedTagFilters.length})` : "Filter";
    filterHeader.append(filterTitle);

    if (selectedTagFilters.length > 0) {
      const clearFiltersButton = document.createElement("button");
      clearFiltersButton.type = "button";
      clearFiltersButton.className = "tag-filter-clear";
      clearFiltersButton.textContent = "Clear";
      clearFiltersButton.addEventListener("click", onClearTagFilters);
      filterHeader.append(clearFiltersButton);
    }

    const cloud = document.createElement("div");
    cloud.className = "tag-filter-cloud";

    for (const entry of combinedIndex.tags) {
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

    filterSection.append(filterHeader, cloud);
    notesPanel.append(filterSection);
  }

  notesPanel.append(
    buildNotesToolbar({
      filterCount: selectedTagFilters.length,
      filterMode,
      notesViewMode,
      onChangeNotesView,
    }),
  );

  notesPanel.append(
    buildNotesList(
      currentNoteId,
      filteredNotes,
      onSelectNote,
      notesViewMode,
      personaOptions,
    ),
  );
  return notesPanel;
}

interface NotesPageHeaderOptions {
  totalNotes: number;
  filteredNotes: number;
  filterCount: number;
  onNewNote: () => void;
}

function buildNotesPageHeader({
  totalNotes,
  filteredNotes,
  filterCount,
  onNewNote,
}: NotesPageHeaderOptions): HTMLElement {
  const countPart =
    filterCount === 0
      ? `${totalNotes} note${totalNotes === 1 ? "" : "s"}`
      : `${filteredNotes} of ${totalNotes}`;
  const filterPart =
    filterCount === 0
      ? ""
      : ` · filtered by ${filterCount} tag${filterCount === 1 ? "" : "s"}`;

  const newNoteButton = buildNewNoteButton(onNewNote);

  return buildPageHeader({
    eyebrow: `Notebook · ${countPart}${filterPart}`,
    titleHtml: "Your <em>notebook</em>.",
    subtitle:
      "Every note is a page. Pick one up — it opens full-width so you have room to read, edit and see its context.",
    actions: newNoteButton,
  });
}

interface NotesToolbarOptions {
  filterCount: number;
  filterMode: SutraPadTagFilterMode;
  notesViewMode: NotesViewMode;
  onChangeNotesView: (mode: NotesViewMode) => void;
}

function buildNotesToolbar({
  filterCount,
  filterMode,
  notesViewMode,
  onChangeNotesView,
}: NotesToolbarOptions): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "notes-toolbar";

  const hint = document.createElement("p");
  hint.className = "notes-toolbar-hint";
  if (filterCount === 0) {
    hint.textContent = "Pick tags in the filter to narrow the list.";
  } else {
    const modePhrase = filterMode === "any" ? "any selected tag" : "every selected tag";
    hint.textContent = `Showing notes that match ${modePhrase}.`;
  }
  toolbar.append(hint);

  toolbar.append(buildViewToggle(notesViewMode, onChangeNotesView));
  return toolbar;
}
