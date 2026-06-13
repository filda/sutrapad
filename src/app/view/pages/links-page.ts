import {
  DEFAULT_NOTE_TITLE,
  buildLinkIndex,
  filterNotesByTags,
} from "../../../lib/notebook";
import { deriveNotebookPersona } from "../../../lib/notebook-persona";
import { buildCardExcerpt } from "../../logic/card-excerpt";
import { formatDate } from "../../logic/formatting";
import { deriveLinkHostname } from "../../logic/link-card";
import {
  buildCardDate,
  buildCardHead,
  buildCardOpenButton,
  buildCardTitle,
  buildLocationLine,
  buildTagChipsRow,
} from "../shared/card-header";
import type { LinksViewMode } from "../../logic/links-view";
import { buildFaviconUrl, type CachedOgImageEntry } from "../../logic/og-image";
import { buildIcon, type IconName } from "../shared/icons";
import {
  createOgImageResolver,
  type OgImageResolver,
} from "../../logic/og-image-resolver";
import { buildLinkThumb } from "../shared/link-thumb";
import {
  applyPersonaStyles,
  appendPersonaStickers,
} from "../shared/persona-decor";
import type { NotesListPersonaOptions } from "../shared/notes-list";
import type { SutraPadDocument, SutraPadWorkspace } from "../../../types";
import { EMPTY_COPY, buildEmptyScene, buildEmptyState } from "../shared/empty-state";
import { buildPageHeader } from "../shared/page-header";

export interface LinksPageOptions {
  workspace: SutraPadWorkspace;
  /**
   * Active topbar tag filter set. The Links page narrows to URLs from
   * notes that carry every selected tag (AND) — the same source-of-truth
   * the topbar's chip strip and the palette tag-pick already feed. An
   * empty array means "show everything", same as Notes.
   */
  selectedTagFilters: readonly string[];
  /**
   * Current layout preference (cards = handoff default, list = dense
   * opt-in). Threaded from `app.ts` so a full re-render preserves it.
   */
  linksViewMode: LinksViewMode;
  /**
   * Persona decoration. Same contract as `NotesPanelOptions.personaOptions`:
   * `undefined` keeps the flat-card render, an object turns on the persona
   * layer (paper palette, rotation, stickers) on each link card based on the
   * primary source note. Pass through from `render-app.ts` so the user's
   * persona toggle applies uniformly across Notes / Tasks / Links.
   */
  personaOptions?: NotesListPersonaOptions;
  onOpenNote: (noteId: string) => void;
  /**
   * Routes to the Capture page. Wired here because the first-run empty
   * state pitches the bookmarklet as the fastest way to accumulate links,
   * and the bookmarklet instructions live on Capture.
   */
  onOpenCapture: () => void;
  onChangeLinksView: (mode: LinksViewMode) => void;
  /**
   * Clears every active tag filter. Wired into the filter-miss empty
   * state so the user can recover without bouncing back to Notes just to
   * find the chip-strip × button.
   */
  onClearTagFilters: () => void;
}

/**
 * Order is `[Cards, List]` everywhere — matches the default-first rule
 * in `docs/conventions.md` → "Cross-page consistency". Icon names map
 * to handoff v2 (`screen_notes.jsx`): "cards" → `menu`, "list" →
 * `list`. The Notes page uses the same mapping; if it ever drifts,
 * fix here AND there.
 */
const VIEW_TOGGLE_OPTIONS: ReadonlyArray<{
  mode: LinksViewMode;
  label: string;
  icon: IconName;
}> = [
  { mode: "cards", label: "Cards", icon: "menu" },
  { mode: "list", label: "List", icon: "list" },
];

export function buildLinksPage({
  workspace,
  selectedTagFilters,
  linksViewMode,
  personaOptions,
  onOpenNote,
  onOpenCapture,
  onChangeLinksView,
  onClearTagFilters,
}: LinksPageOptions): HTMLElement {
  const section = document.createElement("section");
  const personaClass = personaOptions ? " links-page--persona" : "";
  section.className = `links-page${personaClass}`;

  // Always derive the unfiltered link index too — the eyebrow surfaces a
  // "filtered N of M" count when a filter is active, mirroring the Notes
  // page's `Notebook · 4 of 12 · filtered by 1 tag` shape.
  const totalLinkCount = buildLinkIndex(workspace).links.length;

  // Tag filter narrows by source note: a link sticks around when at least
  // one of its source notes carries every selected tag (AND). Cheaper to
  // filter the notes first and rebuild the index from the survivors than
  // to post-filter the link index — the latter would need every note's
  // tag set re-checked per (link × source-note) pair.
  const filterCount = selectedTagFilters.length;
  const filteredNotes =
    filterCount === 0
      ? workspace.notes
      : filterNotesByTags(workspace.notes, [...selectedTagFilters], "all");
  const linkIndex = buildLinkIndex({ ...workspace, notes: filteredNotes });
  const linkCount = linkIndex.links.length;

  const eyebrowCount =
    filterCount === 0
      ? `${linkCount}`
      : `${linkCount} of ${totalLinkCount}`;
  const eyebrowFilter =
    filterCount === 0
      ? ""
      : ` · filtered by ${filterCount} tag${filterCount === 1 ? "" : "s"}`;

  section.append(
    buildPageHeader({
      pageId: "links",
      eyebrow: `Links · ${eyebrowCount}${eyebrowFilter}`,
      title: { before: "A ", emphasis: "library", after: " of what caught your eye." },
      subtitle:
        "Every URL you've captured into a note, gathered here with the notebooks they first appeared in.",
    }),
  );

  if (totalLinkCount === 0) {
    // First-run full-bleed scene. CTA routes to the Capture page since
    // the handoff copy explicitly pitches the bookmarklet as the way to
    // start saving links.
    section.append(
      buildEmptyScene({
        ...EMPTY_COPY.links,
        onCta: onOpenCapture,
      }),
    );
    return section;
  }

  if (linkCount === 0) {
    // Workspace has links but the active tag filter killed them all —
    // dashed inline miss with a "Clear filter" escape, matching the
    // notes-page filter-miss treatment.
    section.append(buildLinksToolbar(linksViewMode, onChangeLinksView, filterCount));
    section.append(
      buildEmptyState({
        ...EMPTY_COPY.links_filtered,
        onSecondary: onClearTagFilters,
      }),
    );
    return section;
  }

  section.append(buildLinksToolbar(linksViewMode, onChangeLinksView, filterCount));

  const notesById = new Map(workspace.notes.map((note) => [note.id, note]));

  if (linksViewMode === "cards") {
    // Async og:image resolver scoped to this render cycle. The cache
    // lives in localStorage across sessions, so in the steady state
    // every card is populated from the cache on mount and the grid
    // paints without flashing. Fresh workspaces still show the
    // gradient for a beat while the first batch of proxy fetches
    // lands.
    const resolver = createOgImageResolver();
    section.append(
      buildLinksGrid(
        linkIndex.links,
        notesById,
        onOpenNote,
        resolver,
        personaOptions,
      ),
    );
  } else {
    section.append(buildLinksList(linkIndex.links, notesById, onOpenNote));
  }

  return section;
}

// Re-export the cache entry type so tests/external callers (if any) can
// reason about resolver shape without reaching into the helper module.
export type { CachedOgImageEntry };

/**
 * Strip above the grid/list: a muted hint on the left (what this page
 * is, how to narrow it down) and the cards/list view-toggle on the
 * right. Matches the structure of the Notes toolbar so a user who's
 * learned the pattern on Notes doesn't relearn it here.
 */
function buildLinksToolbar(
  linksViewMode: LinksViewMode,
  onChangeLinksView: (mode: LinksViewMode) => void,
  filterCount: number,
): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "links-toolbar";

  const hint = document.createElement("p");
  hint.className = "links-toolbar-hint muted";
  // When a filter is active, swap the discovery copy for an explicit
  // "what's narrowing this view" line — same approach the Notes
  // toolbar takes (`Showing notes that match every selected tag.`),
  // adapted to the Links surface. Links uses AND semantics regardless
  // of the global tagsMode; that's a deliberate simplification (per
  // scope decision 2026-04-26) so the page doesn't need its own
  // any/all toggle.
  hint.textContent =
    filterCount === 0
      ? "Sorted by most recent. Filter by tag from the bar above."
      : "Showing links from notes that match every selected tag.";
  toolbar.append(hint);

  toolbar.append(buildViewToggle(linksViewMode, onChangeLinksView));
  return toolbar;
}

/**
 * `[Cards | List]` pill group. Parallels the one in `notes-page.ts` —
 * they're deliberately two separate implementations because each page
 * is typed on its own view-mode union; a shared helper would need a
 * generic `V extends string` signature that reads worse than the
 * ~20 lines of duplication.
 */
function buildViewToggle(
  active: LinksViewMode,
  onChange: (mode: LinksViewMode) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "view-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Links view");

  for (const option of VIEW_TOGGLE_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `view-toggle-button${option.mode === active ? " is-active" : ""}`;
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    button.setAttribute("aria-pressed", option.mode === active ? "true" : "false");
    button.append(buildIcon(option.icon, 14));
    button.addEventListener("click", () => {
      if (option.mode !== active) onChange(option.mode);
    });
    group.append(button);
  }

  return group;
}

interface LinkEntry {
  readonly url: string;
  readonly noteIds: readonly string[];
  readonly count: number;
  readonly latestUpdatedAt: string;
}

/**
 * Grid of preview cards. Ports the handoff's `.links-grid` + `.link-card`
 * shape (gradient thumb with the hostname stamped on it, a title/desc
 * body, and a meta row with the save date + "attached to note" chip).
 *
 * Title derives from the most recent source note's title so the card
 * reads "why you saved it" — much more useful than the raw URL.
 * Description is the first line of that note's body with the URL
 * itself stripped out (see `buildCardExcerpt`), or the
 * URL itself if the body is empty/unrecoverable.
 */
function buildLinksGrid(
  links: readonly LinkEntry[],
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
  resolver: OgImageResolver,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "links-grid";

  for (const entry of links) {
    grid.append(
      buildLinkCard(entry, notesById, onOpenNote, resolver, personaOptions),
    );
  }

  return grid;
}

function buildLinkCard(
  entry: LinkEntry,
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
  resolver: OgImageResolver,
  personaOptions: NotesListPersonaOptions | undefined,
): HTMLElement {
  const card = document.createElement("article");
  // Shared `entity-card` shell + Links variant — see notes-list.ts for the
  // Step 1 cards-unification rationale. `link-card` stays so the existing
  // inner selectors (.link-card-title, .link-card-saved,
  // .link-card-notebooks, and the persona overrides) keep working
  // unchanged. Pre-#9 this list also named `.link-card-source` — that
  // chip was deleted with the arrow + whole-card click pattern.
  card.className = "entity-card entity-card--link link-card";

  // First note id in `entry.noteIds` is the most recently updated one
  // (buildLinkIndex sorts notes by recency before walking URLs), so
  // using it for the card preview matches "show me the most recent
  // context I saved this link in".
  const primaryNoteId = entry.noteIds[0];
  const primaryNote = primaryNoteId ? notesById.get(primaryNoteId) ?? null : null;

  // Walk every note containing this URL (not just the primary) so
  // capture-time og:image lookup can pick up a scrape from any past
  // capture of the same link — a user might have captured nytimes.com
  // three times with a bookmarklet, one of which had og:image.
  const notesForUrl: SutraPadDocument[] = [];
  for (const noteId of entry.noteIds) {
    const note = notesById.get(noteId);
    if (note) notesForUrl.push(note);
  }

  // Persona uses the primary source note: same paper/ink/rotation a user
  // would see on that note's card on the Notes page, so the workspace
  // reads with one consistent visual language across surfaces.
  const persona =
    personaOptions && primaryNote
      ? deriveNotebookPersona(primaryNote, {
          allNotes: personaOptions.allNotes,
          dark: personaOptions.dark,
        })
      : null;
  if (persona) {
    card.classList.add("has-persona");
    applyPersonaStyles(card, persona);
  }

  // #9: whole-card click routes to the primary source note (the same
  // action the inner `.entity-card-open` arrow performs and the
  // pre-#9 `.link-card-source` chip used to perform). The
  // `closest("a, button")` guard keeps the URL anchor and arrow from
  // double-firing through this handler — `<a href>`s and `<button>`s
  // own their click, the card-level shortcut only fires on
  // dead-space clicks (thumb gradient, between rows of metadata).
  // No handler when there's no source note to open — `entry.noteIds`
  // empty / unresolvable would be data weirdness, but the render
  // still has to survive it.
  if (primaryNote) {
    card.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("a, button")) return;
      onOpenNote(primaryNote.id);
    });
  }

  card.append(
    buildLinkThumb({ url: entry.url, notes: notesForUrl, resolver }),
  );
  card.append(buildLinkBody(entry, primaryNote, onOpenNote));

  if (persona) appendPersonaStickers(card, persona);

  return card;
}

function buildLinkBody(
  entry: LinkEntry,
  primaryNote: SutraPadDocument | null,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const body = document.createElement("div");
  body.className = "link-body";

  // Step 3 of cards-unification: title comes from the shared
  // `buildCardTitle` helper. The fallback chain (primaryNote's
  // DEFAULT_NOTE_TITLE when the note has no title, otherwise the bare
  // URL when there's no source note at all — shouldn't happen in
  // practice but stays safe if the data ever drifts) is expressed via
  // the helper's `fallback` option, which the helper picks when the
  // trimmed input is empty. Passing `primaryNote?.title ?? ""` reads
  // through both branches cleanly: with a note we hand off the note's
  // title (helper trims + falls back to "Untitled note" if empty);
  // without a note we pass "" and let the URL fallback fire.
  //
  // #9: title now lives inside the shared `.entity-card-head` flex row
  // next to the `.entity-card-open` arrow when there's a source note
  // to open. URL-without-source falls back to the bare title (no
  // arrow) — opening "the source note" isn't a meaningful action when
  // there isn't one.
  const titleEl = buildCardTitle(primaryNote?.title ?? "", "link", {
    fallback: primaryNote ? DEFAULT_NOTE_TITLE : entry.url,
  });
  if (primaryNote) {
    body.append(
      buildCardHead(
        titleEl,
        buildCardOpenButton("Open source note", () =>
          onOpenNote(primaryNote.id),
        ),
      ),
    );
  } else {
    body.append(titleEl);
  }

  // Step 6: excerpt comes from the shared `buildCardExcerpt` (Notes
  // uses the same helper). Element is `<p class="card-excerpt">` —
  // semantic paragraph + shared styling hook. Tasks doesn't have an
  // excerpt; its task list takes that slot.
  const description = primaryNote
    ? buildCardExcerpt(primaryNote.body, { stripUrl: entry.url })
    : null;
  if (description !== null) {
    const desc = document.createElement("p");
    desc.className = "card-excerpt";
    desc.textContent = description;
    body.append(desc);
  }

  body.append(buildLinkUrl(entry.url));
  body.append(buildLinkMeta(entry, primaryNote));

  // Tag chips reflect the primary source note's tags (the most recently
  // updated note containing this URL — same note that drives the title,
  // excerpt and persona above). Full set, no cap — matches the Notes
  // card. The row construction itself lives in `buildTagChipsRow`
  // (shared with Notes); the wrapper class is Links-scoped because
  // the row's gap/margin sits in the link-body grid, not Notes' card
  // body. Returns `null` when there are no tags so we can skip the
  // empty `<div>` entirely.
  if (primaryNote) {
    const tagsRow = buildTagChipsRow(primaryNote.tags, "link-card-tags");
    if (tagsRow) body.append(tagsRow);
  }

  return body;
}

function buildLinkUrl(url: string): HTMLElement {
  const anchor = document.createElement("a");
  anchor.className = "link-card-url";
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = url;
  return anchor;
}

function buildLinkMeta(
  entry: LinkEntry,
  primaryNote: SutraPadDocument | null,
): HTMLElement {
  // Step 5: shared `.card-meta` wrapper (Notes + Links). The inner
  // contents (date + source-note chip on Links, date + task chip on
  // Notes) still differ per surface, but the wrapper layout — flex
  // row, gap, baseline alignment — is identical, so a single class
  // carries the styling.
  //
  // #9: the source-note chip (`<button class="link-card-source">`)
  // was deleted with the move to whole-card click + shared
  // `.entity-card-open` arrow. The chip used to triple as title
  // duplicate / click target / "+N notebooks" indicator; the title
  // and click are now elsewhere, only the "+N" signal survives — as
  // plain text in `.link-card-notebooks` so it's read but not
  // confused with an interactive element. Singular case (count === 1)
  // stays implicit: the head already names the source note.
  //
  // #10: optional pin + venue chip trails the row when the primary
  // source note has a location. Sourced from `primaryNote.location`
  // through the shared `buildLocationLine` helper, so the same
  // strip-prefix / placeholder rules apply as on the Notes / Tasks
  // surfaces.
  const meta = document.createElement("div");
  meta.className = "card-meta";

  if (entry.latestUpdatedAt) {
    meta.append(buildCardDate(entry.latestUpdatedAt, "link"));
  }

  if (entry.count > 1) {
    const indicator = document.createElement("span");
    indicator.className = "link-card-notebooks";
    indicator.textContent = `Saved in ${entry.count} notebooks`;
    meta.append(indicator);
  }

  const locationEl = buildLocationLine(primaryNote?.location);
  if (locationEl) meta.append(locationEl);

  return meta;
}

/**
 * Compact list layout — ports the original Links page renderer verbatim
 * (URL on top, "Last added" timestamp, then chips for every notebook
 * that captured this link). Kept as the opt-in alternative to the
 * cards grid for users who want as many URLs on screen as possible.
 */
function buildLinksList(
  links: readonly LinkEntry[],
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const list = document.createElement("ul");
  list.className = "links-list";

  for (const entry of links) {
    list.append(buildLinkListItem(entry, notesById, onOpenNote));
  }

  return list;
}

function buildLinkListItem(
  entry: LinkEntry,
  notesById: ReadonlyMap<string, SutraPadDocument>,
  onOpenNote: (noteId: string) => void,
): HTMLElement {
  const item = document.createElement("li");
  item.className = "link-item";

  // Favicon lede — small inline icon so dense list rows still have a
  // per-domain visual anchor without a full gradient thumb. Google's
  // s2/favicons service resolves same-CORS for `<img>` display and
  // falls back to a neutral globe when the domain has no favicon of
  // its own, so we never render a broken image.
  const hostname = deriveLinkHostname(entry.url);
  if (hostname) {
    const favicon = document.createElement("img");
    favicon.className = "link-favicon";
    favicon.src = buildFaviconUrl(hostname);
    favicon.alt = "";
    favicon.width = 20;
    favicon.height = 20;
    favicon.loading = "lazy";
    favicon.decoding = "async";
    item.append(favicon);
  }

  const anchor = document.createElement("a");
  anchor.className = "link-url";
  anchor.href = entry.url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer noopener";
  anchor.textContent = entry.url;
  item.append(anchor);

  if (entry.latestUpdatedAt) {
    const lastAdded = document.createElement("time");
    lastAdded.className = "link-last-added";
    lastAdded.dateTime = entry.latestUpdatedAt;
    lastAdded.textContent = `Last added ${formatDate(entry.latestUpdatedAt)}`;
    item.append(lastAdded);
  }

  const references = document.createElement("div");
  references.className = "link-notebooks";

  const referenceLabel = document.createElement("span");
  referenceLabel.className = "link-notebooks-label";
  referenceLabel.textContent =
    entry.count === 1 ? "Found in" : `Found in ${entry.count} notebooks`;
  references.append(referenceLabel);

  const seenIds = new Set<string>();
  for (const noteId of entry.noteIds) {
    if (seenIds.has(noteId)) continue;
    seenIds.add(noteId);
    const note = notesById.get(noteId);
    if (!note) continue;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "link-notebook-chip";
    chip.textContent = note.title.trim() || DEFAULT_NOTE_TITLE;
    chip.addEventListener("click", () => onOpenNote(noteId));
    references.append(chip);
  }

  item.append(references);
  return item;
}
