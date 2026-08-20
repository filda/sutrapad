import {
  DEFAULT_MENU_ITEM,
  isMenuActionItemId,
  isMenuItemId,
  type MenuItemId,
} from "./menu";

/**
 * Normalizes a Vite-style base (`"/"`, `"/sutrapad/"`, `"sutrapad"`, …) into a
 * leading-slash, trailing-slash form so it can be used as a prefix for the
 * pathname.
 */
function normalizeBase(base: string): string {
  const trimmed = base.trim();
  // No fast path for `""` / `"/"`: both already fall out of the two lines
  // below as `"/"` (`""` gains the leading slash, which is also a trailing
  // one). A separate guard for them was five unkillable mutants pretending to
  // be a branch.
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function readPathSegments(url: string, base: string): string[] {
  const baseWithSlash = normalizeBase(base);
  const { pathname } = new URL(url);
  if (!pathname.startsWith(baseWithSlash)) return [];
  return pathname
    .slice(baseWithSlash.length)
    .split("/")
    .filter((segment) => segment.length > 0);
}

/**
 * Reads the active page from the URL's pathname. The pathname is interpreted
 * relative to the app's Vite `base` — e.g. with `base = "/sutrapad/"`:
 *
 *   `/sutrapad/`        → "notes" (default, kept out of the URL)
 *   `/sutrapad`         → "notes" (missing trailing slash still resolves)
 *   `/sutrapad/links`   → "links"
 *   `/sutrapad/unknown` → "notes" (unknown slug falls back safely)
 */
export function readActivePageFromLocation(url: string, base: string): MenuItemId {
  const baseWithSlash = normalizeBase(base);
  const { pathname } = new URL(url);

  // One gate, not three. The two paths that used to get their own early
  // returns land here anyway: `<base>` with its trailing slash leaves an empty
  // remainder, which is not a menu id, and `<base>` without it fails
  // `startsWith` — both end at `DEFAULT_MENU_ITEM` like every other miss. The
  // separate guards were seven mutants no test could kill, because every arm
  // of the funnel returns the same value.
  if (!pathname.startsWith(baseWithSlash)) {
    return DEFAULT_MENU_ITEM;
  }

  const remainder = pathname.slice(baseWithSlash.length).split("/")[0];
  let candidate: string;
  try {
    candidate = decodeURIComponent(remainder);
  } catch {
    return DEFAULT_MENU_ITEM;
  }

  const normalized = candidate.trim().toLowerCase();
  if (!isMenuItemId(normalized)) return DEFAULT_MENU_ITEM;
  // Action-only menu ids (e.g. "add") have no dedicated page — surface them as
  // the default page so a deep link never lands on an empty placeholder view.
  return isMenuActionItemId(normalized) ? DEFAULT_MENU_ITEM : normalized;
}

/**
 * Writes the active page into the URL's pathname as a slug. The default menu
 * item maps back to the bare base path so canonical URLs stay clean. Query
 * parameters and hash are preserved unchanged.
 */
export function writeActivePageToLocation(
  url: string,
  page: MenuItemId,
  base: string,
): string {
  const baseWithSlash = normalizeBase(base);
  const nextUrl = new URL(url);
  nextUrl.pathname =
    page === DEFAULT_MENU_ITEM ? baseWithSlash : `${baseWithSlash}${page}`;
  return nextUrl.toString();
}

/**
 * Reads a note detail id from the URL's pathname when it has the shape
 * `<base>notes/<id>`. Returns the decoded id, or `null` when the URL is not
 * on a note detail route (different page, missing id, malformed encoding).
 *
 * The validation of *whether* that id actually exists in the workspace is a
 * caller concern — this helper only parses the shape of the URL.
 */
export function readNoteDetailIdFromLocation(
  url: string,
  base: string,
): string | null {
  const segments = readPathSegments(url, base);
  if (segments.length < 2) return null;
  if (segments[0].toLowerCase() !== "notes") return null;

  try {
    const decoded = decodeURIComponent(segments[1]).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Writes a note detail id into the URL's pathname as `<base>notes/<id>`.
 * The id is URL-encoded so arbitrary characters (slashes, spaces, …) are safe.
 * Query parameters and hash are preserved unchanged.
 */
export function writeNoteDetailIdToLocation(
  url: string,
  noteId: string,
  base: string,
): string {
  const baseWithSlash = normalizeBase(base);
  const nextUrl = new URL(url);
  nextUrl.pathname = `${baseWithSlash}notes/${encodeURIComponent(noteId)}`;
  return nextUrl.toString();
}
