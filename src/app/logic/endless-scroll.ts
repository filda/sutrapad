/**
 * Endless-scroll state for the Notes list.
 *
 * The notes list can hold thousands of cards; rendering them all at once
 * janks the page. Instead the page renders only the first `limit` cards and
 * grows the limit as the user scrolls toward the bottom. Variable-height
 * cards rule out fixed-row windowing, so this is batch-append: the visible
 * count only ever grows (never recycles), which keeps the initial render
 * bounded while matching the existing masonry-ish, differently-sized cards.
 *
 * State is a module singleton keyed by a "list signature" (page + active
 * filter + view mode). When the signature changes the limit resets, so
 * changing the tag filter starts from the top again; revisiting the same list
 * keeps its grown limit so a re-render (edit / sync) does not collapse the
 * list back to the first batch (which would also break scroll restoration).
 */

/** Cards rendered on first paint of a list. */
export const INITIAL_LIMIT = 60;
/** Cards added each time the user scrolls near the bottom. */
export const GROW_BATCH = 40;
/** Grow this many px before the actual bottom, so content is ready ahead. */
export const PREFETCH_PX = 800;

interface ListState {
  key: string;
  total: number;
  limit: number;
}

let state: ListState | null = null;

/**
 * Declares the list being rendered and returns how many cards to show.
 * Resets the limit to the initial batch when the signature changes; otherwise
 * keeps the previously grown limit (clamped to the current total, which may
 * have shrunk after a delete).
 */
export function syncListState(key: string, total: number): number {
  if (state === null || state.key !== key) {
    state = { key, total, limit: Math.min(INITIAL_LIMIT, total) };
  } else {
    state.total = total;
    if (state.limit > total) state.limit = total;
  }
  return state.limit;
}

/** True when the scroll position is within the prefetch margin of the bottom. */
export function shouldGrow(
  scrollY: number,
  viewportHeight: number,
  documentHeight: number,
  prefetchPx: number = PREFETCH_PX,
): boolean {
  return scrollY + viewportHeight + prefetchPx >= documentHeight;
}

/**
 * Grows the visible limit by one batch. Returns `true` when the limit actually
 * changed (so the caller should re-render), `false` when everything is already
 * shown or there is no active list.
 */
export function growVisible(): boolean {
  if (state === null || state.limit >= state.total) return false;
  state.limit = Math.min(state.limit + GROW_BATCH, state.total);
  return true;
}

/** Whether the active list still has hidden cards below the current limit. */
export function hasMore(): boolean {
  return state !== null && state.limit < state.total;
}

/** Current visible limit (0 when no list is active). Exposed for the view. */
export function currentLimit(): number {
  return state?.limit ?? 0;
}

/** Clears the singleton — test hook and a reset point for teardown. */
export function resetListState(): void {
  state = null;
}
