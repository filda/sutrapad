import { filterNotesByTags } from "../../../lib/notebook";
import type { NotesViewMode } from "../../logic/notes-view";
import type {
  SutraPadTagFilterMode,
  SutraPadWorkspace,
} from "../../../types";
import { EMPTY_COPY, buildEmptyScene } from "../shared/empty-state";
import {
  buildNotesList,
  type NotesListPersonaOptions,
} from "../shared/notes-list";
import { buildNewNoteButton } from "../shared/new-note-button";
import { buildPageHeader } from "../shared/page-header";

export interface NotesPanelOptions {
  workspace: SutraPadWorkspace;
  currentNoteId: string;
  selectedTagFilters: string[];
  filterMode: SutraPadTagFilterMode;
  notesViewMode: NotesViewMode;
  /**
   * Persona decoration options. `undefined` keeps the original flat-card
   * rendering; passing an object turns on the persona layer (paper palette,
   * rotation, stickers, patina). The object carries the full workspace notes
   * list so recurrence-based stickers can see the population.
   */
  personaOptions?: NotesListPersonaOptions;
  onSelectNote: (noteId: string) => void;
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

/**
 * Notes screen. Per handoff v2 (`docs/design_handoff_sutrapad2/src/screen_notes.jsx`)
 * there is deliberately no in-page tag cloud here — filtering is driven from
 * the topbar tag-filter-bar (`/` opens the palette) so the Notes surface
 * stays focused on the notebook grid/list. The page therefore renders just
 * four stacked pieces:
 *
 *   1. Page header (eyebrow with filtered/total counts + "New note" CTA)
 *   2. Toolbar (muted hint about where filtering lives, view-toggle)
 *   3. Empty state, when filters match nothing or the workspace is blank
 *   4. Notes list (cards or rows, depending on `notesViewMode`)
 */
export function buildNotesPanel({
  workspace,
  currentNoteId,
  selectedTagFilters,
  filterMode,
  notesViewMode,
  personaOptions,
  onSelectNote,
  onNewNote,
  onChangeNotesView,
}: NotesPanelOptions): HTMLElement {
  const notesPanel = document.createElement("aside");
  notesPanel.className = "notes-panel";

  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    filterMode,
  );

  notesPanel.append(
    buildNotesPageHeader({
      totalNotes: workspace.notes.length,
      filteredNotes: filteredNotes.length,
      filterCount: selectedTagFilters.length,
      onNewNote,
    }),
  );

  if (workspace.notes.length === 0) {
    // First-run: no notebooks anywhere in the workspace. Show the
    // full-bleed scene with the "Write your first note" CTA instead of
    // rendering the toolbar + inline miss — the user has nothing to
    // filter and the toolbar's view-toggle would be moot.
    notesPanel.append(
      buildEmptyScene({
        ...EMPTY_COPY.notes,
        onCta: onNewNote,
      }),
    );
    return notesPanel;
  }

  notesPanel.append(
    buildNotesToolbar({
      filterCount: selectedTagFilters.length,
      filterMode,
      notesViewMode,
      onChangeNotesView,
    }),
  );

  notesPanel.append(
    buildNotesList(
      currentNoteId,
      filteredNotes,
      onSelectNote,
      notesViewMode,
      personaOptions,
    ),
  );
  return notesPanel;
}

interface NotesPageHeaderOptions {
  totalNotes: number;
  filteredNotes: number;
  filterCount: number;
  onNewNote: () => void;
}

function buildNotesPageHeader({
  totalNotes,
  filteredNotes,
  filterCount,
  onNewNote,
}: NotesPageHeaderOptions): HTMLElement {
  const countPart =
    filterCount === 0
      ? `${totalNotes} note${totalNotes === 1 ? "" : "s"}`
      : `${filteredNotes} of ${totalNotes}`;
  const filterPart =
    filterCount === 0
      ? ""
      : ` · filtered by ${filterCount} tag${filterCount === 1 ? "" : "s"}`;

  const newNoteButton = buildNewNoteButton(onNewNote);

  return buildPageHeader({
    eyebrow: `Notebook · ${countPart}${filterPart}`,
    titleHtml: "Your <em>notebook</em>.",
    subtitle:
      "Every note is a page. Pick one up — it opens full-width so you have room to read, edit and see its context.",
    actions: newNoteButton,
  });
}

interface NotesToolbarOptions {
  filterCount: number;
  filterMode: SutraPadTagFilterMode;
  notesViewMode: NotesViewMode;
  onChangeNotesView: (mode: NotesViewMode) => void;
}

/**
 * Builds the hint element for the notes toolbar. Wraps plain text around an
 * inline `<kbd>` when pointing the user at the `/` palette shortcut, so the
 * key hint renders as a rounded kbd chip rather than a raw character — the
 * handoff spells this out in its filter-by-bar copy.
 */
function buildNotesToolbarHint(
  filterCount: number,
  filterMode: SutraPadTagFilterMode,
): HTMLElement {
  const hint = document.createElement("p");
  hint.className = "notes-toolbar-hint muted";

  if (filterCount === 0) {
    hint.append(document.createTextNode("Filter by tag from the bar above, or type "));
    const kbd = document.createElement("kbd");
    kbd.className = "mono";
    kbd.textContent = "/";
    hint.append(kbd);
    hint.append(document.createTextNode(" to focus it."));
    return hint;
  }

  const modePhrase = filterMode === "any" ? "any selected tag" : "every selected tag";
  hint.textContent = `Showing notes that match ${modePhrase}.`;
  return hint;
}

function buildNotesToolbar({
  filterCount,
  filterMode,
  notesViewMode,
  onChangeNotesView,
}: NotesToolbarOptions): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "notes-toolbar";

  toolbar.append(buildNotesToolbarHint(filterCount, filterMode));
  toolbar.append(buildViewToggle(notesViewMode, onChangeNotesView));
  return toolbar;
}
