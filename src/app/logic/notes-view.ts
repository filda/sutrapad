/**
 * Notebook listing view mode: a compact list of one-liners vs. a grid of
 * dynamically-sized cards. The choice lives in two places on purpose — the
 * URL so the mode survives a share or copy, and localStorage so it sticks
 * across sessions.
 */
export type NotesViewMode = "list" | "cards";

export const DEFAULT_NOTES_VIEW: NotesViewMode = "cards";

const VIEW_QUERY_PARAM = "view";
const STORAGE_KEY = "sutrapad-notes-view";

const ALL_MODES: ReadonlySet<NotesViewMode> = new Set<NotesViewMode>(["list", "cards"]);

export function isNotesViewMode(value: unknown): value is NotesViewMode {
  return typeof value === "string" && ALL_MODES.has(value as NotesViewMode);
}

export function readNotesViewFromLocation(url: string): NotesViewMode | null {
  const raw = new URL(url).searchParams.get(VIEW_QUERY_PARAM);
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  return isNotesViewMode(normalized) ? normalized : null;
}

/**
 * Writes the view mode into the URL as `?view=<mode>`. The default mode is
 * stripped so the canonical URL stays clean. Other query parameters and the
 * hash are preserved.
 */
export function writeNotesViewToLocation(url: string, mode: NotesViewMode): string {
  const nextUrl = new URL(url);
  if (mode === DEFAULT_NOTES_VIEW) {
    nextUrl.searchParams.delete(VIEW_QUERY_PARAM);
  } else {
    nextUrl.searchParams.set(VIEW_QUERY_PARAM, mode);
  }
  return nextUrl.toString();
}

export function loadStoredNotesView(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): NotesViewMode | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  return isNotesViewMode(raw) ? raw : null;
}

export function persistNotesView(
  mode: NotesViewMode,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, mode);
}

/**
 * Resolves the initial view mode from (in priority order) URL, then local
 * storage, then the default. Exposed so both the app bootstrap and tests can
 * share the same resolution logic.
 */
export function resolveInitialNotesView(
  url: string,
  storage?: Pick<Storage, "getItem">,
): NotesViewMode {
  return (
    readNotesViewFromLocation(url) ?? loadStoredNotesView(storage) ?? DEFAULT_NOTES_VIEW
  );
}
