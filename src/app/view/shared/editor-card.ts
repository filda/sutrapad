import { buildNoteMetadata } from "../../logic/note-metadata";
import type {
  SutraPadDocument,
  SutraPadTagEntry,
  SutraPadTagFilterMode,
} from "../../../types";
import type { SyncState } from "../../session/workspace-sync";
import { buildSelectedFiltersBar } from "./selected-filters-bar";
import { buildTagInput } from "./tag-input";

export interface EditorCardOptions {
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  autoTagLookup: ReadonlySet<string>;
  availableTagSuggestions: readonly SutraPadTagEntry[];
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
  filterMode,
  autoTagLookup,
  availableTagSuggestions,
  syncState,
  statusText,
  onRemoveSelectedFilter,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
}: EditorCardOptions): HTMLElement {
  const editor = document.createElement("section");
  editor.className = "editor-card detail-editor";

  const status = document.createElement("p");
  status.className = `status status-${syncState}`;
  status.textContent = statusText;

  const selectedFiltersBar = buildSelectedFiltersBar({
    selectedTagFilters,
    filterMode,
    autoTagLookup,
    onRemoveSelectedFilter,
  });

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
  titleInput.className = "title-input editor-title";
  titleInput.placeholder = "Note title";
  titleInput.value = displayedNote.title;
  titleInput.addEventListener("input", () => onTitleInput(titleInput.value));

  const bodyInput = document.createElement("textarea");
  bodyInput.className = "body-input editor-body";
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
