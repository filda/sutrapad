import { DEFAULT_NOTE_TITLE, countTasksInNote } from "../../../lib/notebook";
import {
  deriveNotebookPersona,
  type NotebookPersona,
} from "../../../lib/notebook-persona";
import { formatDate } from "../../logic/formatting";
import { pickNoteThumbSeed } from "../../logic/link-thumb-seed";
import { deriveNotePrimaryUrl } from "../../logic/note-primary-url";
import type { NotesViewMode } from "../../logic/notes-view";
import {
  createOgImageResolver,
  type OgImageResolver,
} from "../../logic/og-image-resolver";
import { describeTaskChip } from "../../logic/task-chip";
import type { SutraPadDocument } from "../../../types";
import { buildCardDate, buildCardTitle } from "./card-header";
import { EMPTY_COPY, buildEmptyState } from "./empty-state";
import { buildLinkThumb } from "./link-thumb";
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
  // Thumb header is cards-only — list/row stays compact (favicon + text rail
  // already serves the same "this came from the web" signal). Building one
  // resolver per render keeps every card on the same localStorage cache
  // snapshot, mirroring the Links and Tasks pages.
  const resolver = renderAsRow ? null : createOgImageResolver();

  for (const note of notes) {
    const persona = personaOptions
      ? deriveNotebookPersona(note, {
          allNotes: personaOptions.allNotes,
          dark: personaOptions.dark,
        })
      : null;

    const button = renderAsRow
      ? buildRowItem(note, persona, currentNoteId)
      : buildCardItem(note, persona, currentNoteId, resolver);

    button.addEventListener("click", () => onSelectNote(note.id));
    notesList.append(button);
  }

  return notesList;
}

function buildCardItem(
  note: SutraPadDocument,
  persona: NotebookPersona | null,
  currentNoteId: string,
  resolver: OgImageResolver | null,
): HTMLButtonElement {
  const button = document.createElement("button");
  // Step 1 of cards-unification: every primary entity surface (Notes here,
  // plus Links and Tasks on their own pages) carries the shared
  // `entity-card entity-card--{kind}` shell alongside its legacy
  // per-page class. The shell delivers the canonical surface
  // (`surface-strong` + `var(--r-md)` + `shadow-card` + hover lift);
  // `note-list-item` keeps the inner-content selectors and the
  // `.is-active` highlight.
  //
  // Step 4 adds `has-persona` to the card itself when persona is on (rather
  // than relying on `.notes-list--persona` to scope the per-card rules via
  // descendant selectors). This matches the Links / Tasks renderers and
  // means a Notes card rendered outside of its usual list wrapper still
  // gets the persona paper / ink / patina without depending on its parent.
  // `.notes-list--persona` stays on the list for list-level concerns (the
  // `gap` value the persona grid wants).
  button.className = `entity-card entity-card--note note-list-item${note.id === currentNoteId ? " is-active" : ""}${persona ? " has-persona" : ""}`;
  button.type = "button";

  if (persona) applyPersonaStyles(button, persona);

  // Thumb header — same shape as Links/Tasks cards. Notes without a URL
  // (hand-typed) still get the gradient (no domain chip) so the card
  // grid keeps a consistent rhythm across notebooks. The resolver is
  // null on legacy callers (e.g. tags-page renders a list, not the
  // grid) — guard it so we don't allocate a thumb in those slots.
  //
  // `gradientSeed` lifts the band hue off per-note metadata (tag →
  // hostname → note.id) so a grid full of hand-typed notes no longer
  // collapses to one shared olive bucket — see
  // `pickNoteThumbSeed` for the priority chain.
  if (resolver !== null) {
    const primaryUrl = deriveNotePrimaryUrl(note);
    button.append(
      buildLinkThumb({
        url: primaryUrl,
        notes: [note],
        resolver,
        gradientSeed: pickNoteThumbSeed(note),
      }),
    );
  }

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
  // Step 3 of cards-unification: title + date come from the shared
  // `card-header` helper so the trim + `DEFAULT_NOTE_TITLE` fallback and
  // the `<h3>` / `<time dateTime>` semantics live in one place. Notes
  // pre-helper used a bare `note.title ||` check — switching to the
  // helper means whitespace-only titles also fall back to the default,
  // which closes a tiny rendering discrepancy with Links / Tasks.
  const titleEl = buildCardTitle(note.title, "note");

  // Step 5: shared `.card-meta` wrapper class (Notes + Links). Was
  // `.note-list-meta` (a `<span>` with `display: flex`, which is
  // semantically a block container in disguise); the element is now a
  // `<div>` to match what its layout already was. Tasks uses
  // `.task-card-sub` instead because its meta carries separators and
  // badges that the flat date/chip wrapper can't express.
  const meta = document.createElement("div");
  meta.className = "card-meta";

  meta.append(buildCardDate(note.updatedAt, "note"));

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
      chip.className = "tag-chip";
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
  title.textContent = note.title || DEFAULT_NOTE_TITLE;
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
      chip.className = "tag-chip";
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

