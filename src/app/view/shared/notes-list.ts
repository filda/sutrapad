import { countTasksInNote } from "../../../lib/notebook";
import { deriveNotebookPersona } from "../../../lib/notebook-persona";
import { formatDate } from "../../logic/formatting";
import type { NotesViewMode } from "../../logic/notes-view";
import { describeTaskChip } from "../../logic/task-chip";
import type { SutraPadDocument } from "../../../types";

export interface NotesListPersonaOptions {
  /**
   * Full notebook list — passed through to `deriveNotebookPersona` so the
   * `regular` / `first-of-kind` stickers can see how often a place or topic
   * recurs across the workspace. When the callers only have the filtered list
   * they can pass it again; the derivation is resilient to smaller populations.
   */
  allNotes: readonly SutraPadDocument[];
  /**
   * `true` when the active theme is a dark palette. The persona flips to the
   * dark variant of its paper colours so cards stay legible against the dark
   * page background.
   */
  dark: boolean;
}

export function buildNotesList(
  currentNoteId: string,
  notes: SutraPadDocument[],
  onSelectNote: (noteId: string) => void,
  viewMode?: NotesViewMode,
  personaOptions?: NotesListPersonaOptions,
): HTMLDivElement {
  const notesList = document.createElement("div");
  // Callers that don't opt into a view mode (e.g. the tags page) keep the
  // original single-column card-list styling. Notes passes the user's
  // toggled mode through so the container picks up a grid / compact variant.
  const personaClass = personaOptions ? " notes-list--persona" : "";
  notesList.className =
    viewMode === undefined
      ? `notes-list${personaClass}`
      : `notes-list notes-list--${viewMode}${personaClass}`;

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

    // Apply persona decoration before innerHTML so the inline style + data
    // attributes survive the assignment (innerHTML replaces children but not
    // attributes on the element itself).
    if (personaOptions) {
      decorateWithPersona(button, note, personaOptions);
    }

    const excerpt = note.body.trim() || "Empty note";
    // Branching/labelling lives in describeTaskChip so the UI stays purely
    // presentational: pick the class, drop in text + aria-label, or omit.
    const taskChip = describeTaskChip(countTasksInNote(note));
    const taskChipHtml =
      taskChip === null
        ? ""
        : `<span class="note-list-tasks${taskChip.tone === "all-done" ? " is-all-done" : ""}" aria-label="${taskChip.ariaLabel}">${taskChip.text}</span>`;

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

    if (personaOptions) {
      appendPersonaStickers(button, note, personaOptions);
    }

    notesList.append(button);
  }

  return notesList;
}

function decorateWithPersona(
  button: HTMLButtonElement,
  note: SutraPadDocument,
  options: NotesListPersonaOptions,
): void {
  const persona = deriveNotebookPersona(note, {
    allNotes: options.allNotes,
    dark: options.dark,
  });

  // Inline style so every card can have its own paper colour + rotation
  // without generating a rule per note. The custom properties feed into CSS
  // rules on `.note-list-item` (see styles.css) for ink-tinted borders and
  // accents that track the paper palette.
  button.style.setProperty("--nc-bg", persona.paper.bg);
  button.style.setProperty("--nc-ink", persona.paper.ink);
  if (persona.accent !== null) {
    button.style.setProperty("--nc-accent", persona.accent);
  }
  button.style.setProperty("--nc-title-font", persona.fonts.title);
  button.style.setProperty("--nc-body-font", persona.fonts.body);
  button.style.setProperty("--nc-rotation", `${persona.rotation}deg`);
  button.style.setProperty("--nc-wear", persona.wear.toFixed(3));

  button.dataset.fontTier = persona.fontTier;
  if (persona.patina.length > 0) {
    button.dataset.patina = persona.patina.join(" ");
  }
}

function appendPersonaStickers(
  button: HTMLButtonElement,
  note: SutraPadDocument,
  options: NotesListPersonaOptions,
): void {
  // Re-derive the persona; cheap (pure + no DOM work) and lets this helper
  // stay independent of decorateWithPersona. If this ever shows up in
  // profiling we can pass the persona in.
  const persona = deriveNotebookPersona(note, {
    allNotes: options.allNotes,
    dark: options.dark,
  });
  if (persona.stickers.length === 0) return;

  const stickerRow = document.createElement("div");
  stickerRow.className = "note-list-stickers";
  stickerRow.setAttribute("aria-hidden", "true");

  for (const sticker of persona.stickers) {
    const chip = document.createElement("span");
    chip.className = "note-list-sticker";
    chip.dataset.sticker = sticker.kind;
    chip.textContent = sticker.label;
    stickerRow.append(chip);
  }

  button.append(stickerRow);
}
