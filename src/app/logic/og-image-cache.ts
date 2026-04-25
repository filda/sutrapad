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
 * Maximum number of entries we keep in the OG-image cache. With
 * permanent (TTL-less) entries, an unbounded cache will eventually
 * tip over the 5–10 MiB localStorage quota and start throwing
 * `QuotaExceededError` on every write — silently breaking the OG
 * resolver for every URL the user encounters from then on.
 *
 * 500 entries is sized for the normal workspace shape (a few hundred
 * captured links per active user), and well below the byte ceiling
 * even with verbose negative-cache markers. The cap is exported so
 * tests can pin it without depending on the exact number.
 */
export const OG_IMAGE_CACHE_MAX_ENTRIES = 500;

/**
 * Returns a new cache with `entry` added under `url`. Pure —
 * constructs a fresh object so the in-memory reference changes
 * (helpful for callers that want to persist-on-change via equality).
 *
 * Insertion-order semantics + LRU eviction:
 *   - If `url` already exists, the entry is "moved" to the tail by
 *     dropping the old slot and re-inserting; this keeps recently-
 *     touched URLs at the freshest end.
 *   - If the resulting cache exceeds `maxEntries`, the oldest entries
 *     (head of insertion order) are evicted until the cap holds.
 *
 * `maxEntries` is overridable for tests and for a future "this
 * device has lots of room, raise the cap" preference.
 */
export function setOgImageCacheEntry(
  cache: OgImageCache,
  url: string,
  entry: CachedOgImageEntry,
  maxEntries: number = OG_IMAGE_CACHE_MAX_ENTRIES,
): OgImageCache {
  const next: Record<string, CachedOgImageEntry> = {};
  // Re-emit existing keys *except* the one we're about to update —
  // that way the new write lands at the tail and the URL counts as
  // most-recently-used after the call.
  for (const [key, value] of Object.entries(cache)) {
    if (key !== url) next[key] = value;
  }
  next[url] = entry;

  // Trim oldest entries until we're back at or below the cap. We
  // walk Object.keys (insertion order) and delete from the head;
  // bounded loop because each iteration shrinks `next` by one.
  const overflow = Object.keys(next).length - maxEntries;
  if (overflow > 0) {
    const keys = Object.keys(next);
    for (let i = 0; i < overflow; i += 1) {
      delete next[keys[i]];
    }
  }

  return next;
}
