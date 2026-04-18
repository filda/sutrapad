import { formatDate } from "../../logic/formatting";
import type { SutraPadDocument } from "../../../types";

export function buildNotesList(
  currentNoteId: string,
  notes: SutraPadDocument[],
  onSelectNote: (noteId: string) => void,
): HTMLDivElement {
  const notesList = document.createElement("div");
  notesList.className = "notes-list";

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
    button.onclick = () => onSelectNote(note.id);

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
