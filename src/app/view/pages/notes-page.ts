import { buildTagIndex, filterNotesByAllTags } from "../../../lib/notebook";
import { buildNoteMetadata } from "../../logic/note-metadata";
import type { SutraPadDocument, SutraPadWorkspace } from "../../../types";
import type { SyncState } from "../../session/workspace-sync";
import { buildNotesList } from "../shared/notes-list";
import { buildSelectedFiltersBar } from "../shared/selected-filters-bar";

export interface NotesPanelOptions {
  workspace: SutraPadWorkspace;
  currentNoteId: string;
  selectedTagFilters: string[];
  onSelectNote: (noteId: string) => void;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onNewNote: () => void;
}

export function buildNotesPanel({
  workspace,
  currentNoteId,
  selectedTagFilters,
  onSelectNote,
  onToggleTagFilter,
  onClearTagFilters,
  onNewNote,
}: NotesPanelOptions): HTMLElement {
  const notesPanel = document.createElement("aside");
  notesPanel.className = "notes-panel";

  const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
  const tagIndex = buildTagIndex(workspace);

  const notesHeader = document.createElement("div");
  notesHeader.className = "notes-panel-header";
  notesHeader.innerHTML = `
    <div>
      <p class="panel-eyebrow">Notebook</p>
      <h2>${workspace.notes.length} note${workspace.notes.length === 1 ? "" : "s"}</h2>
    </div>
  `;

  const newNoteButton = document.createElement("button");
  newNoteButton.className = "button";
  newNoteButton.textContent = "New note";
  newNoteButton.addEventListener("click", onNewNote);
  notesHeader.append(newNoteButton);
  notesPanel.append(notesHeader);

  if (tagIndex.tags.length > 0) {
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

    for (const entry of tagIndex.tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `tag-filter-chip${selectedTagFilters.includes(entry.tag) ? " is-active" : ""}`;
      chip.textContent = `${entry.tag} · ${entry.count}`;
      chip.addEventListener("click", () => onToggleTagFilter(entry.tag));
      cloud.append(chip);
    }

    filterSection.append(filterHeader, cloud);

    if (selectedTagFilters.length > 0) {
      const filterHint = document.createElement("p");
      filterHint.className = "tag-filter-hint";
      filterHint.textContent =
        filteredNotes.length === 0
          ? "No notes match all selected tags."
          : `Showing ${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"} that match every selected tag.`;
      filterSection.append(filterHint);
    }

    notesPanel.append(filterSection);
  }

  notesPanel.append(buildNotesList(currentNoteId, filteredNotes, onSelectNote));
  return notesPanel;
}

function buildTagInput(
  note: SutraPadDocument,
  onAddTag: (value: string) => void,
  onRemoveTag: (tag: string) => void,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tags-row";

  const input = document.createElement("input");
  input.className = "tag-text-input";
  input.type = "text";
  input.setAttribute("aria-label", "Add tag");

  const addTag = (value: string): void => {
    const tag = value.trim().toLowerCase();
    if (!tag || note.tags.includes(tag)) return;
    onAddTag(value);
    renderChips();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input.value);
      input.value = "";
      input.focus();
    } else if (e.key === "Backspace" && input.value === "") {
      const tags = note.tags;
      if (tags.length === 0) return;
      onRemoveTag(tags.at(-1) ?? "");
      renderChips();
      input.focus();
    }
  });

  input.addEventListener("blur", () => {
    if (input.value.trim()) {
      addTag(input.value);
      input.value = "";
    }
  });

  row.addEventListener("click", (e) => {
    if (e.target === row) input.focus();
  });

  const renderChips = (): void => {
    while (row.firstChild) row.removeChild(row.firstChild);

    for (const tag of note.tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";

      const label = document.createElement("span");
      label.textContent = tag;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "tag-chip-remove";
      removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        onRemoveTag(tag);
        renderChips();
        input.focus();
      });

      chip.append(label, removeBtn);
      row.append(chip);
    }

    input.placeholder = note.tags.length === 0 ? "Add tags…" : "";
    row.append(input);
  };

  renderChips();
  return row;
}

export interface EditorCardOptions {
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  selectedTagFilters: string[];
  syncState: SyncState;
  statusText: string;
  onRemoveSelectedFilter: (tag: string) => void;
  onTitleInput: (value: string) => void;
  onBodyInput: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
}

export function buildEditorCard({
  note,
  currentNote,
  selectedTagFilters,
  syncState,
  statusText,
  onRemoveSelectedFilter,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
}: EditorCardOptions): HTMLElement {
  const editor = document.createElement("section");
  editor.className = "editor-card";

  const status = document.createElement("p");
  status.className = `status status-${syncState}`;
  status.textContent = statusText;

  const selectedFiltersBar = buildSelectedFiltersBar(selectedTagFilters, onRemoveSelectedFilter);

  if (!note && selectedTagFilters.length > 0) {
    const emptyEditor = document.createElement("div");
    emptyEditor.className = "empty-editor-state";
    emptyEditor.innerHTML = `
      <h2>No notebook matches this filter.</h2>
      <p>Try removing one of the selected tags or clear the filter to see all notes again.</p>
    `;
    editor.append(status, selectedFiltersBar, emptyEditor);
    return editor;
  }

  const displayedNote = note ?? currentNote;

  const titleInput = document.createElement("input");
  titleInput.className = "title-input";
  titleInput.placeholder = "Note title";
  titleInput.value = displayedNote.title;
  titleInput.addEventListener("input", () => onTitleInput(titleInput.value));

  const bodyInput = document.createElement("textarea");
  bodyInput.className = "body-input";
  bodyInput.placeholder = "Start writing...";
  bodyInput.value = displayedNote.body;
  bodyInput.addEventListener("input", () => onBodyInput(bodyInput.value));

  const noteMetadata = document.createElement("p");
  noteMetadata.className = "note-metadata";
  noteMetadata.textContent = buildNoteMetadata(displayedNote);

  editor.append(
    status,
    selectedFiltersBar,
    titleInput,
    buildTagInput(displayedNote, onAddTag, onRemoveTag),
    bodyInput,
    noteMetadata,
  );

  return editor;
}
