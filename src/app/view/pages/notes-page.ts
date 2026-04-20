import { buildTagIndex, filterNotesByAllTags, filterTagSuggestions } from "../../../lib/notebook";
import { buildNoteMetadata } from "../../logic/note-metadata";
import type { NotesViewMode } from "../../logic/notes-view";
import type { SutraPadDocument, SutraPadTagEntry, SutraPadWorkspace } from "../../../types";
import type { SyncState } from "../../session/workspace-sync";
import { buildNotesList } from "../shared/notes-list";
import { buildSelectedFiltersBar } from "../shared/selected-filters-bar";

export interface NotesPanelOptions {
  workspace: SutraPadWorkspace;
  currentNoteId: string;
  selectedTagFilters: string[];
  notesViewMode: NotesViewMode;
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
  notesViewMode,
  onSelectNote,
  onToggleTagFilter,
  onClearTagFilters,
  onNewNote,
  onChangeNotesView,
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

  const headerActions = document.createElement("div");
  headerActions.className = "notes-panel-header-actions";
  headerActions.append(buildViewToggle(notesViewMode, onChangeNotesView));

  const newNoteButton = document.createElement("button");
  newNoteButton.className = "button";
  newNoteButton.textContent = "New note";
  newNoteButton.addEventListener("click", onNewNote);
  headerActions.append(newNoteButton);

  notesHeader.append(headerActions);
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

  notesPanel.append(
    buildNotesList(currentNoteId, filteredNotes, onSelectNote, notesViewMode),
  );
  return notesPanel;
}

function buildTagInput(
  note: SutraPadDocument,
  availableTagSuggestions: readonly SutraPadTagEntry[],
  onAddTag: (value: string) => void,
  onRemoveTag: (tag: string) => void,
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "tags-field";

  const row = document.createElement("div");
  row.className = "tags-row";

  const input = document.createElement("input");
  input.className = "tag-text-input";
  input.type = "text";
  input.setAttribute("aria-label", "Add tag");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const suggestionsList = document.createElement("ul");
  suggestionsList.className = "tag-suggestions";
  suggestionsList.setAttribute("role", "listbox");
  suggestionsList.hidden = true;

  let highlightedIndex = 0;
  let currentSuggestions: SutraPadTagEntry[] = [];

  const closeSuggestions = (): void => {
    suggestionsList.hidden = true;
    input.setAttribute("aria-expanded", "false");
    currentSuggestions = [];
    highlightedIndex = 0;
  };

  const renderSuggestions = (): void => {
    currentSuggestions = filterTagSuggestions(
      availableTagSuggestions,
      input.value,
      note.tags,
    );

    while (suggestionsList.firstChild) {
      suggestionsList.removeChild(suggestionsList.firstChild);
    }

    if (currentSuggestions.length === 0) {
      closeSuggestions();
      return;
    }

    if (highlightedIndex >= currentSuggestions.length) {
      highlightedIndex = 0;
    }

    for (let index = 0; index < currentSuggestions.length; index += 1) {
      const entry = currentSuggestions[index];
      const option = document.createElement("li");
      option.className = `tag-suggestion${index === highlightedIndex ? " is-active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === highlightedIndex ? "true" : "false");

      const label = document.createElement("span");
      label.className = "tag-suggestion-label";
      label.textContent = entry.tag;

      const count = document.createElement("span");
      count.className = "tag-suggestion-count";
      count.textContent = String(entry.count);

      option.append(label, count);
      // Use mousedown so the suggestion is picked before the input's blur fires
      // and closes the dropdown.
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        addTag(entry.tag);
      });
      option.addEventListener("mouseenter", () => {
        highlightedIndex = index;
        updateHighlight();
      });

      suggestionsList.append(option);
    }

    suggestionsList.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  const updateHighlight = (): void => {
    const options = suggestionsList.querySelectorAll<HTMLLIElement>(".tag-suggestion");
    options.forEach((option, index) => {
      const active = index === highlightedIndex;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
      if (active) option.scrollIntoView({ block: "nearest" });
    });
  };

  const addTag = (value: string): void => {
    const tag = value.trim().toLowerCase();
    if (!tag || note.tags.includes(tag)) return;
    // onAddTag triggers a full app render, which replaces this entire tag
    // input with a freshly built one (app.ts re-focuses it). Any DOM updates
    // below would run on the detached old nodes, so we just delegate.
    onAddTag(value);
  };

  input.addEventListener("keydown", (e) => {
    const hasOpenSuggestions = !suggestionsList.hidden && currentSuggestions.length > 0;

    if (e.key === "ArrowDown") {
      if (!hasOpenSuggestions) {
        renderSuggestions();
        return;
      }
      e.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % currentSuggestions.length;
      updateHighlight();
      return;
    }

    if (e.key === "ArrowUp") {
      if (!hasOpenSuggestions) return;
      e.preventDefault();
      highlightedIndex =
        (highlightedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      updateHighlight();
      return;
    }

    if (e.key === "Escape") {
      if (hasOpenSuggestions) {
        e.preventDefault();
        closeSuggestions();
      }
      return;
    }

    if ((e.key === "Enter" || e.key === "Tab") && hasOpenSuggestions) {
      // Tab with a highlighted suggestion commits that tag; without suggestions
      // we let Tab fall through so focus moves to the next field normally.
      e.preventDefault();
      addTag(currentSuggestions[highlightedIndex].tag);
      return;
    }

    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input.value);
      return;
    }

    if (e.key === "Backspace" && input.value === "") {
      const tags = note.tags;
      if (tags.length === 0) return;
      onRemoveTag(tags.at(-1) ?? "");
    }
  });

  input.addEventListener("input", () => {
    highlightedIndex = 0;
    renderSuggestions();
  });

  input.addEventListener("focus", () => {
    renderSuggestions();
  });

  input.addEventListener("blur", () => {
    // A small delay lets a click on a suggestion fire before we close the list
    // and commit any remaining text. Without it, blur fires first and the
    // suggestion row disappears before its click handler runs.
    window.setTimeout(() => {
      // If the input has been detached from the DOM (e.g. the keyboard path
      // already committed a tag and triggered a re-render), skip the flush —
      // otherwise we'd commit the stale partial text from the old input on
      // top of the tag we just added.
      if (!input.isConnected) return;
      if (input.value.trim()) {
        addTag(input.value);
        input.value = "";
      }
      closeSuggestions();
    }, 100);
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
      // onRemoveTag triggers a full app render (app.ts refocuses the new tag
      // input), so no local DOM updates are needed here.
      removeBtn.addEventListener("click", () => {
        onRemoveTag(tag);
      });

      chip.append(label, removeBtn);
      row.append(chip);
    }

    input.placeholder = note.tags.length === 0 ? "Add tags…" : "";
    row.append(input);
  };

  renderChips();
  wrapper.append(row, suggestionsList);
  return wrapper;
}

export interface EditorCardOptions {
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  selectedTagFilters: string[];
  availableTagSuggestions: readonly SutraPadTagEntry[];
  syncState: SyncState;
  statusText: string;
  onRemoveSelectedFilter: (tag: string) => void;
  onTitleInput: (value: string) => void;
  onBodyInput: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
  onBackToNotes?: () => void;
}

export function buildEditorCard({
  note,
  currentNote,
  selectedTagFilters,
  availableTagSuggestions,
  syncState,
  statusText,
  onRemoveSelectedFilter,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
  onBackToNotes,
}: EditorCardOptions): HTMLElement {
  const editor = document.createElement("section");
  editor.className = "editor-card";

  if (onBackToNotes) {
    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "editor-back-button";
    backButton.textContent = "← Back to notes";
    backButton.addEventListener("click", onBackToNotes);
    editor.append(backButton);
  }

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
    buildTagInput(displayedNote, availableTagSuggestions, onAddTag, onRemoveTag),
    bodyInput,
    noteMetadata,
  );

  return editor;
}
