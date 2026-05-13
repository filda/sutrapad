import type { MenuItemId } from "./menu";

/**
 * Identifies a route for the purpose of per-page scroll memory.
 *
 * - `page` covers every top-level menu destination (notes list, links, tasks,
 *   tags, settings, …). We remember scrollY per `pageId` so revisiting the
 *   page restores the user where they were.
 * - `note-detail` carries the detail noteId so transitions between two
 *   different notes count as separate routes. We deliberately do *not*
 *   remember scrollY for note-detail keys (see `planScrollTransition`) —
 *   opening a note should land you at the top, even on a revisit, matching
 *   the pre-existing behaviour the user is used to.
 */
export type RouteScrollKey =
  | { kind: "page"; pageId: MenuItemId }
  | { kind: "note-detail"; noteId: string };

/**
 * Builds the scroll-memory route key for the current render. The shape
 * mirrors the existing detail-route discriminator in `app.ts` (an
 * activeMenuItem of `"notes"` combined with a non-null `detailNoteId`
 * means we're on a note detail page), so the helper has the same
 * "notes list vs. notes detail" notion of identity that the rest of
 * the renderer already trusts.
 */
export function routeScrollKey(
  activeMenuItem: MenuItemId,
  detailNoteId: string | null,
): RouteScrollKey {
  if (activeMenuItem === "notes" && detailNoteId !== null) {
    return { kind: "note-detail", noteId: detailNoteId };
  }
  return { kind: "page", pageId: activeMenuItem };
}

/** Structural equality for two route keys. */
export function routeKeysEqual(
  a: RouteScrollKey,
  b: RouteScrollKey,
): boolean {
  if (a.kind === "page" && b.kind === "page") {
    return a.pageId === b.pageId;
  }
  if (a.kind === "note-detail" && b.kind === "note-detail") {
    return a.noteId === b.noteId;
  }
  return false;
}

/**
 * What the renderer should do with `window.scrollY` for the current
 * transition. The renderer reads `capturePrevious` *before* it tears down
 * the old DOM (to grab the previous scrollY at the right moment) and
 * applies `restoreScrollY` *after* the new DOM is in place.
 */
export interface ScrollTransitionPlan {
  /**
   * `true` when the renderer should snapshot `window.scrollY` into the
   * scroll-memory map under the previous route key before re-rendering.
   *
   * Only set for transitions out of a `page`-kind key. Detail-kind keys
   * don't contribute to memory: capturing per-note detail scroll would
   * surprise the user on a revisit (they expect a freshly opened note to
   * start at the top).
   */
  capturePrevious: boolean;
  /**
   * `null` means "leave `window.scrollY` alone" — used on first render and
   * on same-key re-renders (e.g. an autosave triggers a render while the
   * user is mid-scroll). A number means "scroll to this Y after render";
   * `0` is the natural fallback for unvisited pages and for every
   * detail-kind route (matches the existing reset-to-top behaviour).
   */
  restoreScrollY: number | null;
}

export interface PlanScrollTransitionInput {
  /**
   * Route key of the previous render. `null` on the very first render
   * pass — the renderer has nothing to capture or restore from then, so
   * the plan is "do nothing".
   */
  previousKey: RouteScrollKey | null;
  /** Route key of the render about to happen. */
  currentKey: RouteScrollKey;
  /**
   * Looks up a stored scrollY for a route key. Returns `undefined` when
   * the user hasn't visited that page yet (so the helper can fall back
   * to 0). Pass `(key) => map.get(serialize(key))` from the caller.
   */
  memoryRead: (key: RouteScrollKey) => number | undefined;
}

/**
 * Pure decision function for the per-render scroll choreography.
 *
 * Behaviour summary:
 *   - First render (no previous): nothing happens.
 *   - Same key (e.g. autosave-triggered re-render): nothing happens, so
 *     the user's in-flight scroll isn't snapped away.
 *   - Transition from a page-kind key: capture previous, restore current.
 *   - Transition from a detail-kind key: skip capture, still restore current.
 *   - Transition into a detail-kind key: restoreScrollY is always 0
 *     (regardless of stored memory) — opening a note lands at the top.
 *   - Transition into a page-kind key: restoreScrollY is the stored value,
 *     or 0 on first visit.
 */
export function planScrollTransition({
  previousKey,
  currentKey,
  memoryRead,
}: PlanScrollTransitionInput): ScrollTransitionPlan {
  if (previousKey === null) {
    return { capturePrevious: false, restoreScrollY: null };
  }
  if (routeKeysEqual(previousKey, currentKey)) {
    return { capturePrevious: false, restoreScrollY: null };
  }
  const capturePrevious = previousKey.kind === "page";
  const restoreScrollY =
    currentKey.kind === "note-detail" ? 0 : (memoryRead(currentKey) ?? 0);
  return { capturePrevious, restoreScrollY };
}

/**
 * Serializes a route key to a string usable as a `Map` key. Kept here so
 * the caller doesn't need to know the discriminated-union shape — they
 * just pass keys in and out of their `Map<string, number>` via this
 * helper.
 */
export function serializeRouteKey(key: RouteScrollKey): string {
  return key.kind === "page"
    ? `page:${key.pageId}`
    : `note-detail:${key.noteId}`;
}
