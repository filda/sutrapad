import type {
  SutraPadDocument,
  SutraPadTagEntry,
  SutraPadWorkspace,
} from "../../types";
import { buildCombinedTagIndex } from "../../lib/notebook";

/**
 * Pure logic for the global command palette (opened with `/`). Builds a flat
 * set of searchable entries from the workspace — only two kinds are in scope
 * per the scope conversation: `note` (navigate to detail) and `tag` (replace
 * the current tag filter and jump to the notes list).
 *
 * Everything here is DOM-free so the match/sort rules stay unit-testable and
 * so the view layer doesn't need to know workspace internals.
 */

export type PaletteEntryKind = "note" | "tag";

export interface PaletteEntryNotePayload {
  kind: "note";
  noteId: string;
}

export interface PaletteEntryTagPayload {
  kind: "tag";
  tag: string;
}

export type PaletteEntryPayload =
  | PaletteEntryNotePayload
  | PaletteEntryTagPayload;

export interface PaletteEntry {
  /**
   * Globally unique id across all entries, formed as `<kind>:<value>`. Used
   * as the stable React-style key the view uses for highlighting the active
   * row — not exposed to the user.
   */
  id: string;
  kind: PaletteEntryKind;
  label: string;
  subtitle?: string;
  payload: PaletteEntryPayload;
}

export interface PaletteGroups {
  notes: PaletteEntry[];
  tags: PaletteEntry[];
}

/**
 * Empty-query default for the notes group. The palette is first and foremost
 * a "jump to thing I just touched" surface, so the handful of most-recent
 * notes is the most useful default. Tags stay fully listed because the list
 * is already compact (count-sorted, short labels).
 */
export const PALETTE_EMPTY_QUERY_RECENT_NOTES = 5;

export function buildPaletteEntries(
  workspace: SutraPadWorkspace,
): PaletteGroups {
  // Order notes newest-first so the empty-query default naturally slices the
  // top of the list and so an active-substring filter preserves a recency
  // bias when several titles tie.
  const orderedNotes = workspace.notes.toSorted((left, right) =>
    left.updatedAt < right.updatedAt
      ? 1
      : left.updatedAt > right.updatedAt
        ? -1
        : 0,
  );

  const notes: PaletteEntry[] = orderedNotes.map((note) => ({
    id: `note:${note.id}`,
    kind: "note",
    label: paletteNoteLabel(note),
    subtitle: paletteNoteSubtitle(note),
    payload: { kind: "note", noteId: note.id },
  }));

  // buildCombinedTagIndex already sorts count-desc + alpha, so we can reuse
  // that ordering verbatim for the palette — the palette's tag group is an
  // alternate surface for the Tags page, so matching its sort keeps the two
  // feeling like the same list.
  const tagIndex = buildCombinedTagIndex(workspace);
  const tags: PaletteEntry[] = tagIndex.tags.map((entry) => ({
    id: `tag:${entry.tag}`,
    kind: "tag",
    label: entry.tag,
    subtitle: paletteTagSubtitle(entry),
    payload: { kind: "tag", tag: entry.tag },
  }));

  return { notes, tags };
}

function paletteNoteLabel(note: SutraPadDocument): string {
  return note.title.trim() || "Untitled note";
}

function paletteNoteSubtitle(note: SutraPadDocument): string | undefined {
  if (note.tags.length === 0) return undefined;
  // Prefix with `#` so the user can eyeball which chips the note carries
  // without mentally switching contexts from the label (a title). Cap at
  // three so a note with an accidental ten-tag spray doesn't blow the row.
  return note.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ");
}

function paletteTagSubtitle(entry: SutraPadTagEntry): string {
  const countLabel = `${entry.count} note${entry.count === 1 ? "" : "s"}`;
  const kindLabel = entry.kind === "auto" ? "auto" : "user";
  return `${countLabel} · ${kindLabel}`;
}

/**
 * Narrows `groups` to entries whose label or subtitle contains `query`
 * (case-insensitive, whitespace-trimmed). When the query is empty, returns
 * the top-N recent notes + all tags, giving the palette a useful "just
 * opened" state without any typing.
 *
 * The match rule is substring rather than fuzzy because the palette surface
 * is small and the user is typing a known label; a fuzzy scorer would just
 * introduce noise and ordering jitter without meaningfully improving hits.
 */
export function filterPaletteEntries(
  groups: PaletteGroups,
  query: string,
): PaletteGroups {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return {
      notes: groups.notes.slice(0, PALETTE_EMPTY_QUERY_RECENT_NOTES),
      tags: groups.tags,
    };
  }

  const matches = (entry: PaletteEntry): boolean => {
    if (entry.label.toLowerCase().includes(needle)) return true;
    if (entry.subtitle && entry.subtitle.toLowerCase().includes(needle)) {
      return true;
    }
    return false;
  };

  return {
    notes: groups.notes.filter(matches),
    tags: groups.tags.filter(matches),
  };
}

/**
 * Flattens the two-group palette into a single sequence in visible order
 * (notes first, then tags). The view uses this for keyboard navigation —
 * arrow keys cycle through this list; each id is unique so the active
 * highlight is unambiguous.
 */
export function flattenPaletteGroups(groups: PaletteGroups): PaletteEntry[] {
  return [...groups.notes, ...groups.tags];
}

export type PaletteNavigation = "next" | "prev";

/**
 * Computes the next active entry id given a keyboard navigation direction.
 * Wraps around the ends of the list so the palette never has a "dead" key
 * press. Returns `null` when there is nothing to select — the view treats
 * that as "no active highlight, Enter is a no-op".
 */
export function navigatePaletteEntries(
  entries: readonly PaletteEntry[],
  currentId: string | null,
  direction: PaletteNavigation,
): string | null {
  if (entries.length === 0) return null;

  const currentIndex =
    currentId !== null
      ? entries.findIndex((entry) => entry.id === currentId)
      : -1;

  if (currentIndex === -1) {
    // When the current id is missing (never set, or a previous entry has
    // just been filtered out by a keystroke) we snap to the edge nearest
    // the caller's direction. That preserves the expectation that the very
    // first ArrowDown after opening the palette highlights the top row.
    const snapIndex = direction === "next" ? 0 : entries.length - 1;
    return entries[snapIndex]?.id ?? null;
  }

  const offset = direction === "next" ? 1 : -1;
  const nextIndex =
    (currentIndex + offset + entries.length) % entries.length;
  return entries[nextIndex]?.id ?? null;
}

/**
 * Computes the next tag-filter set after the palette activates a tag row.
 * Toggles membership — if the tag is already filtered, it comes out;
 * otherwise it joins the existing set. Kept here (not in `app.ts`) so the
 * palette's filter-toggle semantics travel with the module and stay unit
 * testable — and so the view can render the "Add" vs "Remove" badge from
 * the same source of truth the selection handler will consult.
 */
export function togglePaletteTagFilter(
  selectedTagFilters: readonly string[],
  tag: string,
): string[] {
  return selectedTagFilters.includes(tag)
    ? selectedTagFilters.filter((entry) => entry !== tag)
    : [...selectedTagFilters, tag];
}

/**
 * Ensures the active id still exists in `entries`. Call after every filter
 * change to keep the highlight tethered to a visible row. Returns the
 * first entry id when the current id has been filtered out, or `null` when
 * the list is empty.
 */
export function reconcileActiveEntryId(
  entries: readonly PaletteEntry[],
  currentId: string | null,
): string | null {
  if (entries.length === 0) return null;
  if (
    currentId !== null &&
    entries.some((entry) => entry.id === currentId)
  ) {
    return currentId;
  }
  return entries[0]?.id ?? null;
}
