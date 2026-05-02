/**
 * Per-render resolver wrapping the localStorage og:image cache. Owns
 * the in-memory view of the cache, persists writes back to storage,
 * and hands callers a `resolve(url, notes)` method that walks the
 * priority chain in `og-image.ts`.
 *
 * Lifted out of `links-page.ts` so the Notes and Tasks card grids can
 * share the same resolver shape — they both render lots of cards at
 * once and want the same "warm cache → instant paint" behaviour the
 * Links page already had.
 */
import type { SutraPadDocument } from "../../types";
import {
  loadOgImageCache,
  persistOgImageCache,
  setOgImageCacheEntry,
  type OgImageCache,
} from "./og-image-cache";
import { resolveOgImageForUrl } from "./og-image";

export interface OgImageResolver {
  resolve: (
    url: string,
    notes: readonly SutraPadDocument[],
  ) => Promise<string | null>;
}

/**
 * Builds a resolver scoped to a single render cycle. The cache lives
 * in localStorage across sessions; this wrapper reads it once on
 * construction so every thumb on the page sees the same snapshot, and
 * persists back only when a fresh runtime resolution actually wrote a
 * new entry.
 */
export function createOgImageResolver(): OgImageResolver {
  let cache: OgImageCache = loadOgImageCache();

  return {
    resolve: async (url, notes) => {
      const result = await resolveOgImageForUrl({
        url,
        notes,
        getCachedEntry: (key) => cache[key] ?? null,
        putCachedEntry: (key, entry) => {
          // setOgImageCacheEntry returns a new reference on every call,
          // but the resolver only invokes putCachedEntry after a real
          // network round-trip — every call here is a write worth
          // committing to storage.
          cache = setOgImageCacheEntry(cache, key, entry);
          persistOgImageCache(cache);
        },
      });
      return result;
    },
  };
}
