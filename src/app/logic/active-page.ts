import { DEFAULT_MENU_ITEM, isMenuItemId, type MenuItemId } from "./menu";

/**
 * Normalizes a Vite-style base (`"/"`, `"/sutrapad/"`, `"sutrapad"`, …) into a
 * leading-slash, trailing-slash form so it can be used as a prefix for the
 * pathname.
 */
function normalizeBase(base: string): string {
  const trimmed = base.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
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
  const baseWithoutTrailingSlash = baseWithSlash.slice(0, -1);
  const { pathname } = new URL(url);

  if (pathname === baseWithSlash || pathname === baseWithoutTrailingSlash) {
    return DEFAULT_MENU_ITEM;
  }

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
  return isMenuItemId(normalized) ? normalized : DEFAULT_MENU_ITEM;
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
