import { formatDate } from "../../logic/formatting";
import type { NotesViewMode } from "../../logic/notes-view";
import type { SutraPadDocument } from "../../../types";

export function buildNotesList(
  currentNoteId: string,
  notes: SutraPadDocument[],
  onSelectNote: (noteId: string) => void,
  viewMode?: NotesViewMode,
): HTMLDivElement {
  const notesList = document.createElement("div");
  // Callers that don't opt into a view mode (e.g. the tags page) keep the
  // original single-column card-list styling. Notes passes the user's
  // toggled mode through so the container picks up a grid / compact variant.
  notesList.className =
    viewMode === undefined ? "notes-list" : `notes-list notes-list--${viewMode}`;

  if (notes.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "notes-list-empty";
    emptyState.textContent = "No notes match the current tag filter.";
    notesList.append(emptyState);
    return notesList;
  }

  for (const note of notes) {
    const button = document.createElement("button");
    button.className = `note-list-item${note.id === currentNoteId ? " is-active" : ""}`;
    button.type = "button";
    button.addEventListener("click", () => onSelectNote(note.id));

    const excerpt = note.body.trim() || "Empty note";
    button.innerHTML = `
      <strong>${note.title || "Untitled note"}</strong>
      <span>${formatDate(note.updatedAt)}</span>
      <p>${excerpt.slice(0, 72)}</p>
    `;

    if (note.tags.length > 0) {
      const tagsRow = document.createElement("div");
      tagsRow.className = "note-list-tags";
      for (const tag of note.tags) {
        const chip = document.createElement("span");
        chip.className = "note-list-tag";
        chip.textContent = tag;
        tagsRow.append(chip);
      }
      button.append(tagsRow);
    }

    notesList.append(button);
  }

  return notesList;
}
