/**
 * Pure localStorage-backed cache for resolved og:image URLs.
 *
 * The cache is an opaque map from URL → `{ imageUrl, resolvedAt }`.
 * Entries are added by `resolveOgImageForUrl` in `og-image.ts` and
 * read back on subsequent renders so the Links page doesn't refetch
 * the same URL across sessions.
 *
 * A negative (`imageUrl: null`) entry is a "we tried, there isn't
 * one" marker — equally worth caching so a URL without an og:image
 * doesn't hit the CORS proxy on every page load.
 */
import type { CachedOgImageEntry } from "./og-image";

/**
 * localStorage slot. Versioned via a "v1" suffix so a future shape
 * change (e.g. adding a TTL field) can ship alongside a clean
 * migration rather than an "oh, why did my cache go stale" bug.
 */
export const OG_IMAGE_CACHE_STORAGE_KEY = "sutrapad-og-image-cache-v1";

export type OgImageCache = Readonly<Record<string, CachedOgImageEntry>>;

/**
 * Loads the cache from storage, returning an empty map on every
 * failure path: missing slot, malformed JSON, non-object payload,
 * or entries with bad shapes. The Links page treats "cache empty"
 * and "cache corrupted" identically, so we degrade silently rather
 * than surface a "your cache is broken" error.
 */
export function loadOgImageCache(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): OgImageCache {
  const raw = storage.getItem(OG_IMAGE_CACHE_STORAGE_KEY);
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const validated: Record<string, CachedOgImageEntry> = {};
  for (const [url, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isValidCachedEntry(entry)) continue;
    validated[url] = entry;
  }
  return validated;
}

function isValidCachedEntry(value: unknown): value is CachedOgImageEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { imageUrl?: unknown; resolvedAt?: unknown };
  // `imageUrl` is either a non-empty string (hit) or an explicit
  // null (negative cache). Anything else means the stored shape
  // drifted and we should drop the entry rather than feed junk into
  // the resolver.
  const imageOk =
    candidate.imageUrl === null ||
    (typeof candidate.imageUrl === "string" && candidate.imageUrl.length > 0);
  const tsOk = typeof candidate.resolvedAt === "string";
  return imageOk && tsOk;
}

/**
 * Writes the cache back to storage as JSON. Called by the resolver
 * after every stage-3 fetch so the next render sees the result
 * immediately, no "warm up" delay.
 */
export function persistOgImageCache(
  cache: OgImageCache,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(OG_IMAGE_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

/**
 * Returns a new cache with `entry` added under `url`. Pure —
 * constructs a fresh object so the in-memory reference changes
 * (helpful for callers that want to persist-on-change via equality).
 */
export function setOgImageCacheEntry(
  cache: OgImageCache,
  url: string,
  entry: CachedOgImageEntry,
): OgImageCache {
  return { ...cache, [url]: entry };
}
