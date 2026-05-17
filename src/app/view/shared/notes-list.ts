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
import { buildCardExcerpt } from "../../logic/card-excerpt";
import { describeTaskChip } from "../../logic/task-chip";
import type { SutraPadDocument } from "../../../types";
import {
  buildCardDate,
  buildCardHead,
  buildCardOpenButton,
  buildCardTitle,
  buildLocationLine,
  buildTagChipsRow,
} from "./card-header";
import { EMPTY_COPY, buildEmptyState } from "./empty-state";
import { buildIcon } from "./icons";
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

    const item = renderAsRow
      ? buildRowItem(note, persona, currentNoteId)
      : buildCardItem(note, persona, currentNoteId, resolver, onSelectNote);

    // Row mode has no inner interactives — wire the click here. Cards
    // mode wires its own click inside `buildCardItem` so the
    // `target.closest("a, button")` guard sits next to the arrow open
    // button (added with #9) and tag chips, keeping the inner-bail
    // logic colocated with the affordances it has to dodge.
    if (renderAsRow) {
      item.addEventListener("click", () => onSelectNote(note.id));
    }
    notesList.append(item);
  }

  return notesList;
}

/**
 * Builds a `·`-glyph `<span class="sep" aria-hidden="true">` interleaved
 * between `.card-meta` children (date, task chip, location). `aria-hidden`
 * so screen readers don't announce the dot between the chunks; the
 * surrounding flex `gap` still applies on either side. Matches the
 * `.task-card-sub .sep` separator pattern Tasks already uses inline.
 */
function buildMetaSeparator(): HTMLSpanElement {
  const sep = document.createElement("span");
  sep.className = "sep";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = "·";
  return sep;
}

function buildCardItem(
  note: SutraPadDocument,
  persona: NotebookPersona | null,
  currentNoteId: string,
  resolver: OgImageResolver | null,
  onSelectNote: (noteId: string) => void,
): HTMLElement {
  // Element is `<article>` (not `<button>`) to match the Links/Tasks card
  // renderers and avoid the WebKit/Chromium UA quirks that bit the og:image
  // rendering on the Notes grid — buttons apply enough non-standard handling
  // around `overflow: hidden` + `border-radius` + multi-layer backgrounds
  // that the top edge of a `cover`-fitted og:image clipped imperceptibly
  // differently than a plain `<article>`/`<div>` would, leaving a thin
  // sliver of the persona paper showing above the band. Switching to
  // `<article>` resolves it.
  //
  // #9 dropped the `role="button"` + `tabIndex=0` + Enter/Space keydown
  // handler the card used to carry: nesting an inner `<button>` (the
  // `.entity-card-open` arrow) inside a `role=button` ancestor is a
  // a11y anti-pattern (screen readers announce the wrapper's button
  // semantics and then the inner button separately, which reads as
  // duplicate actions). Keyboard activation now flows through the
  // inner arrow button — focused via Tab, activated with Enter/Space
  // like any real `<button>`. Whole-card click stays as a
  // mouse/touch convenience handler; the `target.closest("a, button")`
  // guard keeps it from double-firing when the inner arrow or any
  // future inline anchor handles the click itself.
  const card = document.createElement("article");
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
  card.className = `entity-card entity-card--note note-list-item${note.id === currentNoteId ? " is-active" : ""}${persona ? " has-persona" : ""}`;
  card.addEventListener("click", (event) => {
    // Inner interactives (the arrow open-button, any future anchors)
    // handle their own click → bail so the card-level shortcut
    // doesn't double-fire alongside the inner listener. The
    // arrow's `stopPropagation` already prevents bubbling for the
    // mouse path; the guard belongs to here too so a keyboard or
    // synthetic event that bypasses `stopPropagation` still routes
    // through one handler only.
    if ((event.target as HTMLElement).closest("a, button")) return;
    onSelectNote(note.id);
  });

  if (persona) applyPersonaStyles(card, persona);

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
    card.append(
      buildLinkThumb({
        url: primaryUrl,
        notes: [note],
        resolver,
        gradientSeed: pickNoteThumbSeed(note),
      }),
    );
  }

  // Step 6 of cards-unification: excerpt comes from the shared
  // `buildCardExcerpt` helper (same pipeline as Links). Notes keeps a
  // 72-char budget for its single-line excerpt — Links uses the
  // default 160 chars and clamps with CSS. When the helper returns
  // `null` (body is empty after trim) Notes still renders the
  // "Empty note" placeholder so the card never collapses to bare
  // title + meta.
  const excerptText = buildCardExcerpt(note.body, { maxChars: 72 });
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
  //
  // #9: the title now lives inside a shared `.entity-card-head` flex
  // row next to the `.entity-card-open` arrow button. Same affordance
  // as Tasks (which always had the arrow) and Links (which moved off
  // its `.link-card-source` text chip to the arrow pattern).
  const titleEl = buildCardTitle(note.title, "note");
  const head = buildCardHead(
    titleEl,
    buildCardOpenButton("Open note", () => onSelectNote(note.id)),
  );

  // Step 5: shared `.card-meta` wrapper class (Notes + Links). Was
  // `.note-list-meta` (a `<span>` with `display: flex`, which is
  // semantically a block container in disguise); the element is now a
  // `<div>` to match what its layout already was. Tasks uses
  // `.task-card-sub` instead because its meta carries separators and
  // badges that the flat date/chip wrapper can't express.
  //
  // #11 adds an explicit `·` separator span between meta children so
  // the three pieces (date, task chip, location) read as a delimited
  // list rather than three items the flex `gap` slapped together. The
  // separators are aria-hidden so screen readers still hear three
  // distinct chunks (the date's absolute timestamp, the chip's
  // aria-label, the venue text) without the dot interrupting them.
  const meta = document.createElement("div");
  meta.className = "card-meta";

  const metaChildren: HTMLElement[] = [buildCardDate(note.updatedAt, "note")];

  if (taskChip !== null) {
    // Tone drives both the muted `is-all-done` class AND the icon
    // identity (`check` for completed, `checkbox` outline for still-
    // open). Pre-#11 the leading glyph was a Unicode codepoint baked
    // into `taskChip.text` (`☐`/`✓`) — that fell back to tofu on font
    // stacks without the geometric-shapes block, so the chip looked
    // visibly broken next to the SVG `pin` icon in `.card-location`.
    const chipEl = document.createElement("span");
    chipEl.className = `note-list-tasks${taskChip.tone === "all-done" ? " is-all-done" : ""}`;
    chipEl.setAttribute("aria-label", taskChip.ariaLabel);
    chipEl.append(
      buildIcon(taskChip.tone === "all-done" ? "check" : "checkbox", 12),
    );
    const countEl = document.createElement("span");
    countEl.className = "note-list-tasks-count";
    countEl.textContent = taskChip.text;
    chipEl.append(countEl);
    metaChildren.push(chipEl);
  }

  // #10: optional pin + venue chip from the shared `buildLocationLine`
  // helper. Order matches Links / Tasks: location lands LAST in the
  // row so the data (date, counts) reads first and the spatial
  // context trails as ambient information. The helper returns `null`
  // when there's nothing to show (blank / `"—"` placeholder).
  const locationEl = buildLocationLine(note.location);
  if (locationEl) metaChildren.push(locationEl);

  for (const [index, child] of metaChildren.entries()) {
    if (index > 0) meta.append(buildMetaSeparator());
    meta.append(child);
  }

  const excerptEl = document.createElement("p");
  excerptEl.className = "card-excerpt";
  excerptEl.textContent = excerptText ?? "Empty note";

  card.append(head, meta, excerptEl);

  const tagsRow = buildTagChipsRow(note.tags, "note-list-tags");
  if (tagsRow) card.append(tagsRow);

  if (persona) appendPersonaStickers(card, persona);

  return card;
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

