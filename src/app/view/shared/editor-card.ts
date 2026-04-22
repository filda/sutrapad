import { buildNoteMetadata } from "../../logic/note-metadata";
import type { SutraPadDocument, SutraPadTagEntry } from "../../../types";
import type { SyncState } from "../../session/workspace-sync";
import { buildTagInput } from "./tag-input";

export interface EditorCardOptions {
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  /**
   * Active filters are only consulted to pick the right empty state copy:
   * when there's no match, we tell the user a filter is the reason rather
   * than falling through to the blank writing surface. The filter *chips*
   * themselves live in the topbar tag-filter strip now, so the editor card
   * no longer owns their presentation.
   */
  selectedTagFilters: string[];
  availableTagSuggestions: readonly SutraPadTagEntry[];
  syncState: SyncState;
  statusText: string;
  onTitleInput: (value: string) => void;
  onBodyInput: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
}

export function buildEditorCard({
  note,
  currentNote,
  selectedTagFilters,
  availableTagSuggestions,
  syncState,
  statusText,
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

  if (!note && selectedTagFilters.length > 0) {
    const emptyEditor = document.createElement("div");
    emptyEditor.className = "empty-editor-state";
    emptyEditor.innerHTML = `
      <h2>No notebook matches this filter.</h2>
      <p>Try removing one of the selected tags or clear the filter to see all notes again.</p>
    `;
    editor.append(status, emptyEditor);
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
    titleInput,
    buildTagInput(displayedNote, availableTagSuggestions, onAddTag, onRemoveTag),
    bodyInput,
    noteMetadata,
  );

  return editor;
}
