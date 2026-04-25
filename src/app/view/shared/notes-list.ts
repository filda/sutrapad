import { countTasksInNote } from "../../../lib/notebook";
import {
  deriveNotebookPersona,
  type NotebookPersona,
} from "../../../lib/notebook-persona";
import { formatDate } from "../../logic/formatting";
import type { NotesViewMode } from "../../logic/notes-view";
import { describeTaskChip } from "../../logic/task-chip";
import type { SutraPadDocument } from "../../../types";
import { EMPTY_COPY, buildEmptyState } from "./empty-state";
import { applyPersonaStyles, appendPersonaStickers } from "./persona-decor";

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
  const personaClass = personaOptions ? " notes-list--persona" : "";
  // Callers that don't opt into a view mode (e.g. the tags page) keep the
  // original single-column card-list styling. Notes passes the user's toggled
  // mode through so the container picks up a grid / horizontal-list variant.
  notesList.className =
    viewMode === undefined
      ? `notes-list${personaClass}`
      : `notes-list notes-list--${viewMode}${personaClass}`;

  if (notes.length === 0) {
    // Inline filter-miss: data exists somewhere, just not under the active
    // filter. The topbar tag-filter-bar already offers a Clear action, so
    // the inline card doesn't need to duplicate it — keeping it copy-only
    // avoids a second "Clear filter" button competing for attention.
    notesList.append(
      buildEmptyState({
        ...EMPTY_COPY.notes_filtered,
      }),
    );
    return notesList;
  }

  const renderAsRow = viewMode === "list";

  for (const note of notes) {
    const persona = personaOptions
      ? deriveNotebookPersona(note, {
          allNotes: personaOptions.allNotes,
          dark: personaOptions.dark,
        })
      : null;

    const button = renderAsRow
      ? buildRowItem(note, persona, currentNoteId)
      : buildCardItem(note, persona, currentNoteId);

    button.addEventListener("click", () => onSelectNote(note.id));
    notesList.append(button);
  }

  return notesList;
}

function buildCardItem(
  note: SutraPadDocument,
  persona: NotebookPersona | null,
  currentNoteId: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `note-list-item${note.id === currentNoteId ? " is-active" : ""}`;
  button.type = "button";

  if (persona) applyPersonaStyles(button, persona);

  const excerpt = note.body.trim() || "Empty note";
  // Branching/labelling lives in describeTaskChip so the UI stays purely
  // presentational: pick the class, drop in text + aria-label, or omit.
  const taskChip = describeTaskChip(countTasksInNote(note));

  // Build the card via DOM APIs (textContent only). The previous template-
  // literal `innerHTML` interpolation made `note.title` and `note.body`
  // attacker-controllable XSS sinks: a bookmarklet capture from a malicious
  // page (or a hand-crafted `?selection=…` URL) would land an active payload
  // in the cards view that runs every time the notes list renders. See
  // tests/notes-list-xss.test.ts for the regression.
  const titleEl = document.createElement("strong");
  titleEl.textContent = note.title || "Untitled note";

  const meta = document.createElement("span");
  meta.className = "note-list-meta";

  const dateEl = document.createElement("span");
  dateEl.className = "note-list-date";
  dateEl.textContent = formatDate(note.updatedAt);
  meta.append(dateEl);

  if (taskChip !== null) {
    const chipEl = document.createElement("span");
    chipEl.className = `note-list-tasks${taskChip.tone === "all-done" ? " is-all-done" : ""}`;
    chipEl.setAttribute("aria-label", taskChip.ariaLabel);
    chipEl.textContent = taskChip.text;
    meta.append(chipEl);
  }

  const excerptEl = document.createElement("p");
  excerptEl.textContent = excerpt.slice(0, 72);

  button.append(titleEl, meta, excerptEl);

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

  if (persona) appendPersonaStickers(button, persona);

  return button;
}

/**
 * Row renderer for "list" view — a horizontal rail modelled on the handoff's
 * `.notebook-row`: paper swatch on the left, title + excerpt column, a
 * right-side tag strip, then the date. When the persona layer is active the
 * swatch takes the note's paper colour; without a persona it falls back to a
 * neutral accent dot so the row still reads as a clickable item.
 */
function buildRowItem(
  note: SutraPadDocument,
  persona: NotebookPersona | null,
  currentNoteId: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `notebook-row${note.id === currentNoteId ? " is-active" : ""}${persona ? " has-persona" : ""}`;
  button.type = "button";

  if (persona) applyPersonaStyles(button, persona);

  const swatch = document.createElement("span");
  swatch.className = "nr-swatch";
  swatch.setAttribute("aria-hidden", "true");
  button.append(swatch);

  const body = document.createElement("div");
  body.className = "nr-body";

  const title = document.createElement("span");
  title.className = "nr-title";
  title.textContent = note.title || "Untitled note";
  body.append(title);

  const excerpt = note.body.trim().replace(/\n+/g, " ");
  if (excerpt.length > 0) {
    const sub = document.createElement("span");
    sub.className = "nr-sub";
    sub.textContent = excerpt.slice(0, 140);
    body.append(sub);
  }

  button.append(body);

  if (note.tags.length > 0) {
    const tagsRow = document.createElement("div");
    tagsRow.className = "nr-tags";
    // Cap row tag display so a long tag list doesn't push the date off the row;
    // the full set stays discoverable once the note is opened.
    for (const tag of note.tags.slice(0, 4)) {
      const chip = document.createElement("span");
      chip.className = "note-list-tag";
      chip.textContent = tag;
      tagsRow.append(chip);
    }
    button.append(tagsRow);
  }

  const date = document.createElement("span");
  date.className = "nr-date";
  date.textContent = formatDate(note.updatedAt);
  button.append(date);

  return button;
}

