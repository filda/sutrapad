/**
 * Links page view mode. Parallels `notes-view.ts` — the pattern is
 * deliberately copy-adapted rather than factored into a shared registry
 * because (a) there are only two instances so far, and (b) the
 * storage/URL surface reads more clearly when each page owns its own
 * constants. If a third page grows a view toggle, the three modules
 * should be collapsed into a generic helper at that point.
 *
 * Per handoff v2 (`docs/design_handoff_sutrapad2/src/screen_rest.jsx`)
 * the Links page's primary layout is a grid of preview cards, with the
 * flat text-heavy list kept as an opt-in alternative for users who
 * want more URLs on screen.
 */
export type LinksViewMode = "cards" | "list";

export const DEFAULT_LINKS_VIEW: LinksViewMode = "cards";

/**
 * Shared `?view=<mode>` query parameter — same key Notes uses. Reusing
 * is safe because only one page is active at a time, and the URL sync
 * helper in `app.ts` strips the param whenever we're not on a page
 * that owns it (see `syncNotesViewToLocation` / `syncLinksViewToLocation`).
 */
const VIEW_QUERY_PARAM = "view";

/**
 * Deliberately separate localStorage key from notes-view — the two
 * page preferences should drift independently: a user may prefer cards
 * on Notes but a dense list on Links (or vice versa), so we persist
 * them as two distinct slots.
 */
const STORAGE_KEY = "sutrapad-links-view";

const ALL_MODES: ReadonlySet<LinksViewMode> = new Set<LinksViewMode>(["cards", "list"]);

export function isLinksViewMode(value: unknown): value is LinksViewMode {
  return typeof value === "string" && ALL_MODES.has(value as LinksViewMode);
}

export function readLinksViewFromLocation(url: string): LinksViewMode | null {
  const raw = new URL(url).searchParams.get(VIEW_QUERY_PARAM);
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  return isLinksViewMode(normalized) ? normalized : null;
}

/**
 * Writes the view mode into the URL. The default mode is stripped so
 * the canonical URL stays clean. Other query params and the hash are
 * preserved.
 */
export function writeLinksViewToLocation(url: string, mode: LinksViewMode): string {
  const nextUrl = new URL(url);
  if (mode === DEFAULT_LINKS_VIEW) {
    nextUrl.searchParams.delete(VIEW_QUERY_PARAM);
  } else {
    nextUrl.searchParams.set(VIEW_QUERY_PARAM, mode);
  }
  return nextUrl.toString();
}

export function loadStoredLinksView(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): LinksViewMode | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  return isLinksViewMode(raw) ? raw : null;
}

export function persistLinksView(
  mode: LinksViewMode,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, mode);
}

/**
 * Resolves the initial view mode from (in priority order) URL, then
 * local storage, then the default. Exposed so both the app bootstrap
 * and tests can share the same resolution logic.
 */
export function resolveInitialLinksView(
  url: string,
  storage?: Pick<Storage, "getItem">,
): LinksViewMode {
  return (
    readLinksViewFromLocation(url) ?? loadStoredLinksView(storage) ?? DEFAULT_LINKS_VIEW
  );
}
