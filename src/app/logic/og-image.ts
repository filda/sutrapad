/**
 * Pure logic for the Links page's OpenGraph-image lookup stack.
 *
 * Lookup priority (cheap → expensive):
 *
 *   1. `captureContext.page.ogImage` on a note that contains the URL.
 *      The bookmarklet already scrapes `<meta property="og:image">`
 *      at capture time (see `capture-context.ts` → `resolvePageSnapshot`),
 *      so every note captured via the bookmarklet ships its og:image
 *      on disk. No runtime network needed in the happy path.
 *   2. A previously-resolved entry in the localStorage cache (see
 *      `og-image-cache.ts`). The cache is permanent: once a URL has
 *      been resolved (hit *or* miss), we don't ask again. Most sites
 *      change their og:image rarely; the occasional stale thumb is a
 *      much better trade than a proxy call on every render.
 *   3. A CORS-proxy fetch of the target URL's HTML via allorigins,
 *      parsed locally with `extractOgImageFromHtml`. Free, no API key,
 *      but each call sends the URL to api.allorigins.win.
 *   4. Nothing — the card renderer falls back to the gradient thumb.
 *
 * The priority is wired by `resolveOgImageForUrl` below; the individual
 * extraction helpers are exported for tests.
 */
import type { SutraPadCaptureContext, SutraPadDocument } from "../../types";
import { safeFetch } from "../../lib/safe-fetch";

/**
 * allorigins returns the raw body of a URL with permissive CORS
 * headers, so we can fetch arbitrary cross-origin HTML from the
 * browser. This is the endpoint the runtime fallback path hits.
 */
export const ALLORIGINS_ENDPOINT = "https://api.allorigins.win/raw";

export function buildAllOriginsUrl(url: string): string {
  return `${ALLORIGINS_ENDPOINT}?url=${encodeURIComponent(url)}`;
}

/**
 * Google's s2/favicons endpoint returns a square PNG for the given
 * domain at the requested size. CORS-friendly for image use (we don't
 * need to read the bytes, just display them).
 *
 * 64 px is the smallest size that renders crisply at the Links list's
 * 20 px inline icon on a 2× display; smaller sizes get fuzzy on hi-DPI.
 */
export function buildFaviconUrl(hostname: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
}

/**
 * Extracts the capture-time og:image from a note's captureContext.
 * The value lives at `context.page.ogImage` (see
 * `SutraPadCapturePageMetadata`) — `resolvePageSnapshot` in
 * `capture-context.ts` populates it from the bookmarklet's scrape
 * of `<meta property="og:image">`. Returns null when the field is
 * missing, blank, or the context was never populated (hand-typed
 * note with no bookmarklet involvement).
 */
export function extractOgImageFromCaptureContext(
  context: SutraPadCaptureContext | undefined,
): string | null {
  const value = context?.page?.ogImage;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed;
}

/**
 * Walks each note that references `url` and returns the first
 * captureContext.page.ogImage we find. `notes` is the full set of
 * candidates (not the whole workspace) — the caller scopes it down
 * using the link index's `noteIds` list.
 */
export function findCaptureTimeOgImage(
  notes: readonly SutraPadDocument[],
): string | null {
  for (const note of notes) {
    const candidate = extractOgImageFromCaptureContext(note.captureContext);
    if (candidate !== null) return candidate;
  }
  return null;
}

/**
 * Priority order for the meta attributes we'll accept as an
 * og:image source. The canonical og namespace comes first; the
 * twitter:image variants are a surprisingly common second-best that
 * many sites set alongside (or instead of) the og tags.
 *
 * Each entry names the HTML attribute that identifies the meta tag
 * (`property` or `name`) and the value we're matching against.
 */
const OG_IMAGE_META_SOURCES: ReadonlyArray<{
  readonly attr: "property" | "name";
  readonly value: string;
}> = [
  { attr: "property", value: "og:image" },
  { attr: "property", value: "og:image:url" },
  { attr: "property", value: "og:image:secure_url" },
  { attr: "name", value: "twitter:image" },
  { attr: "name", value: "twitter:image:src" },
];

/**
 * Matches a `<meta ...>` tag, capturing the inner attribute soup. We
 * scan every meta element with a single regex pass and then look for
 * the property/content pairs inside — much cheaper than five separate
 * regex scans over the whole HTML body.
 */
const META_TAG_PATTERN = /<meta\b([^>]*)>/gi;

/**
 * Pulls a single attribute value out of a `<meta>` tag's inner
 * attribute string. Handles both single- and double-quoted values,
 * plus unquoted bare-word attributes (spec-permissive HTML). Returns
 * `null` when the attribute isn't present.
 */
function readMetaAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = pattern.exec(attrs);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Pulls `<meta property="og:image" content="…">` (with fallbacks to
 * og:image:url / og:image:secure_url / twitter:image / twitter:image:src)
 * out of a raw HTML string. Uses a regex-only scan so it's testable
 * in the node vitest environment (no DOMParser dep).
 *
 * Returns the absolute URL, resolved against `baseUrl` when the og
 * tag contains a relative path (a handful of sites do this). Returns
 * null when no og:image-ish meta is present or the value is blank.
 */
export function extractOgImageFromHtml(
  html: string,
  baseUrl: string,
): string | null {
  // First pass — index every meta tag's attribute soup by the
  // (property|name) → content pair it carries. A single regex sweep
  // over the HTML body costs O(n) and avoids re-scanning for each of
  // the five fallback sources below.
  const seen = new Map<string, string>();
  for (const match of html.matchAll(META_TAG_PATTERN)) {
    const attrs = match[1];
    const content = readMetaAttribute(attrs, "content")?.trim();
    if (!content) continue;

    const property = readMetaAttribute(attrs, "property")?.trim().toLowerCase();
    if (property) {
      seen.set(`property:${property}`, content);
      continue;
    }
    const name = readMetaAttribute(attrs, "name")?.trim().toLowerCase();
    if (name) {
      seen.set(`name:${name}`, content);
    }
  }

  // Second pass — walk our priority list and return the first hit.
  for (const source of OG_IMAGE_META_SOURCES) {
    const hit = seen.get(`${source.attr}:${source.value}`);
    if (hit) {
      return absolutizeUrl(hit, baseUrl);
    }
  }
  return null;
}

/**
 * Resolves a (possibly relative) URL against a base. Returns the
 * input unchanged when it already looks absolute; returns null when
 * resolution fails entirely (bad base or nonsensical relative path).
 */
export function absolutizeUrl(candidate: string, baseUrl: string): string | null {
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Parameters for the end-to-end resolution. Kept as an options bag so
 * the caller can inject a fake `fetch` + cache in tests without
 * reaching for a DI container.
 */
export interface ResolveOgImageOptions {
  /**
   * URL of the link whose thumbnail we want.
   */
  url: string;
  /**
   * Notes that contain this URL (as returned by `buildLinkIndex` →
   * `.noteIds`, resolved through the workspace's notes map). The
   * resolver walks them looking for a capture-time og:image before
   * reaching for the network.
   */
  notes: readonly SutraPadDocument[];
  /**
   * Cache lookup — returns an entry if one exists for this URL. When
   * the entry's `imageUrl` is null the resolver treats that as a
   * cached *miss* and does not refetch.
   */
  getCachedEntry: (url: string) => CachedOgImageEntry | null;
  /**
   * Writes a resolved entry (hit or miss) back to the cache.
   */
  putCachedEntry: (url: string, entry: CachedOgImageEntry) => void;
  /**
   * Injection point for `window.fetch`. Tests substitute a stub;
   * production callers pass `fetch`.
   */
  fetchImpl?: typeof fetch;
}

export interface CachedOgImageEntry {
  /**
   * Resolved og:image URL, or null when the resolver tried and found
   * nothing (cached negative — don't refetch).
   */
  readonly imageUrl: string | null;
  /**
   * ISO timestamp of when the resolution happened. Used as a signal
   * that the entry is present; there's no TTL today — most site
   * og:images don't churn enough to justify one.
   */
  readonly resolvedAt: string;
}

/**
 * Full resolution pipeline. Returns the resolved og:image URL, or
 * null when every stage failed. Pure with respect to its inputs
 * modulo the provided `putCachedEntry` side-effect — the caller
 * controls where "cache" actually lives.
 */
export async function resolveOgImageForUrl(
  options: ResolveOgImageOptions,
): Promise<string | null> {
  // Stage 1 — capture-time og:image stored on a note.
  const captureHit = findCaptureTimeOgImage(options.notes);
  if (captureHit !== null) return captureHit;

  // Stage 2 — localStorage cache. A cached null is a "we tried, give
  // up" marker; don't call the network again.
  const cached = options.getCachedEntry(options.url);
  if (cached !== null) return cached.imageUrl;

  // Stage 3 — runtime fetch through the CORS proxy. Production wraps
  // the network call in `safeFetch` so a stalled allorigins endpoint
  // can't keep the Links page spinning forever; tests inject a stub
  // via `fetchImpl` and bypass the timeout layer.
  const fetchImpl = options.fetchImpl ?? safeFetch;
  let resolved: string | null = null;
  try {
    const response = await fetchImpl(buildAllOriginsUrl(options.url));
    if (response.ok) {
      const html = await response.text();
      resolved = extractOgImageFromHtml(html, options.url);
    }
  } catch {
    // Network error, DNS failure, allorigins down, timeout — all
    // silent. Cache the negative so we don't hammer the proxy on every
    // render with the same failing URL.
    resolved = null;
  }

  options.putCachedEntry(options.url, {
    imageUrl: resolved,
    resolvedAt: new Date().toISOString(),
  });
  return resolved;
}
