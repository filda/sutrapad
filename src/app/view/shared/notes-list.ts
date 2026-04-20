import { countTasksInNote } from "../../../lib/notebook";
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
    const { open, done } = countTasksInNote(note);
    const total = open + done;
    // Only render the task chip when the note actually has tasks — keeps
    // task-free notes visually clean. "All done" gets a check glyph and a
    // muted variant so completed notebooks feel finished, not urgent.
    const taskChipHtml =
      total === 0
        ? ""
        : open === 0
          ? `<span class="note-list-tasks is-all-done" aria-label="${total} task${total === 1 ? "" : "s"}, all completed">✓ ${done}/${total}</span>`
          : `<span class="note-list-tasks" aria-label="${open} of ${total} task${total === 1 ? "" : "s"} open">☐ ${open}/${total}</span>`;

    button.innerHTML = `
      <strong>${note.title || "Untitled note"}</strong>
      <span class="note-list-meta">
        <span class="note-list-date">${formatDate(note.updatedAt)}</span>
        ${taskChipHtml}
      </span>
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
