import type { SutraPadTagEntry } from "../../types";

/**
 * Pure logic for the topbar tag-filter typeahead. Keeps the ranking rules,
 * recent-tag persistence, and Tab-completion semantics DOM-free so the view
 * layer in `tag-filter-bar.ts` can stay presentational.
 *
 * Ported from the handoff prototype `docs/design_handoff_sutrapad2/src/tagfilter.jsx`.
 * The three handoff-specific invariants captured here are:
 *
 *   1. Recent tags are persisted to `localStorage.sp_recent_tags` (JSON array,
 *      newest-first, max 8) so the next session shows the last-used filters
 *      in the dropdown.
 *   2. Suggestions rank starts-with matches above contains-only matches, with
 *      count-desc as the tiebreaker — mirrors the prototype's ranking.
 *   3. Tab is a two-stage completion: if the query is a strict prefix of the
 *      first suggestion, Tab previews (auto-fills the input with the full
 *      name); a second Tab (query now equals the full name) commits the tag.
 */

/**
 * Storage key verbatim from `tagfilter.jsx` — kept identical so a user who has
 * previously used a handoff-built preview still sees their recent tags on the
 * real app (and vice-versa).
 */
export const RECENT_TAG_FILTERS_STORAGE_KEY = "sp_recent_tags";

/**
 * Hard cap matching the handoff. The dropdown shows at most the top five
 * recent tags in any given render; the extra buffer (8) lets older entries
 * rotate back into view as the more recent ones get filtered out.
 */
export const RECENT_TAG_FILTERS_MAX = 8;

/**
 * Reads the recent-tag list from storage. Defensive on every axis — malformed
 * JSON, non-array payloads, and non-string entries all degrade to an empty
 * list rather than crashing. An over-long persisted list (shouldn't happen
 * but costs nothing to guard) is capped to `RECENT_TAG_FILTERS_MAX`.
 */
export function loadRecentTagFilters(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): string[] {
  const raw = storage.getItem(RECENT_TAG_FILTERS_STORAGE_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const strings = parsed.filter((entry): entry is string => typeof entry === "string");
  return strings.slice(0, RECENT_TAG_FILTERS_MAX);
}

/**
 * Writes the list as a JSON array. An empty list serialises to `"[]"` so a
 * present-but-empty slot remains machine-legible and distinguishable from a
 * missing slot (loader returns `[]` in both cases; the difference matters
 * only to telemetry / debugging, not to UX).
 */
export function persistRecentTagFilters(
  keys: readonly string[],
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(
    RECENT_TAG_FILTERS_STORAGE_KEY,
    JSON.stringify([...keys]),
  );
}

/**
 * Returns a new list with `tag` in the newest-first position. Duplicates of
 * `tag` are removed so an already-recent tag float-to-top rather than being
 * added twice. The resulting list is capped at `RECENT_TAG_FILTERS_MAX`.
 *
 * Blank/whitespace tags are a no-op — a stray commit of `""` must not insert
 * a phantom row. Callers should ideally reject blank tags earlier, but the
 * guard is cheap and keeps the storage contract clean.
 */
export function pushRecentTagFilter(
  current: readonly string[],
  tag: string,
  max: number = RECENT_TAG_FILTERS_MAX,
): string[] {
  if (tag.trim() === "") return [...current];
  const next = [tag, ...current.filter((entry) => entry !== tag)];
  return next.slice(0, max);
}

/**
 * Ranks suggestions for the typeahead dropdown. Input is the full tag index
 * (expected to already be count-desc + alpha sorted by `buildTagIndex`), the
 * user's current query, and the set of tags already active as filters.
 *
 * Rules:
 *   - Case-insensitive substring match on the tag name; empty query matches
 *     every non-excluded tag (empty-state "popular" list).
 *   - Starts-with matches rank above contains-only matches, with the input
 *     order (count desc) preserved within each tier.
 *   - Active filter tags are excluded so the dropdown never offers a no-op.
 *   - The result is capped at `limit` so a workspace with hundreds of tags
 *     doesn't render a scrollable wall.
 */
export function rankTagFilterSuggestions(
  available: readonly SutraPadTagEntry[],
  query: string,
  excluded: readonly string[],
  limit = 8,
): SutraPadTagEntry[] {
  const needle = query.trim().toLowerCase();
  const excludedSet = new Set(excluded);

  const startsWith: SutraPadTagEntry[] = [];
  const contains: SutraPadTagEntry[] = [];

  for (const entry of available) {
    if (excludedSet.has(entry.tag)) continue;
    const name = entry.tag.toLowerCase();
    if (needle === "") {
      startsWith.push(entry);
      continue;
    }
    if (name.startsWith(needle)) {
      startsWith.push(entry);
    } else if (name.includes(needle)) {
      contains.push(entry);
    }
  }

  return [...startsWith, ...contains].slice(0, limit);
}

/**
 * Result of a Tab keypress in the typeahead input:
 *
 *   - `none`: do nothing (no suggestions, or empty query — Tab falls through
 *     to its default focus-cycling behaviour).
 *   - `preview`: replace the input value with `tag` (the first suggestion's
 *     full name). This is the first-Tab stage.
 *   - `commit`: add `tag` to the filter set. Triggered when the query already
 *     exactly matches the first suggestion, i.e. the second Tab after a
 *     preview stage, or when the user typed the full name themselves.
 */
export type TabCompletion =
  | { readonly kind: "none" }
  | { readonly kind: "preview"; readonly tag: string }
  | { readonly kind: "commit"; readonly tag: string };

/**
 * Decides how a Tab keypress should resolve given the current query and the
 * currently-ranked suggestions. The first suggestion is the Tab target — the
 * caller is expected to reorder so the keyboard-active row is at index 0.
 *
 * Blank queries short-circuit to `none` so Tab on a fresh empty input never
 * commits a random tag. An empty suggestion list likewise yields `none`.
 */
export function resolveTabCompletion(
  query: string,
  suggestions: readonly SutraPadTagEntry[],
): TabCompletion {
  const trimmed = query.trim();
  if (trimmed === "") return { kind: "none" };
  if (suggestions.length === 0) return { kind: "none" };

  const target = suggestions[0].tag;
  if (trimmed.toLowerCase() === target.toLowerCase()) {
    return { kind: "commit", tag: target };
  }
  return { kind: "preview", tag: target };
}
