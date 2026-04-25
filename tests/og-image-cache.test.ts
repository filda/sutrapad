import { describe, expect, it } from "vitest";
import type { CachedOgImageEntry } from "../src/app/logic/og-image";
import {
  loadOgImageCache,
  OG_IMAGE_CACHE_MAX_ENTRIES,
  OG_IMAGE_CACHE_STORAGE_KEY,
  persistOgImageCache,
  setOgImageCacheEntry,
} from "../src/app/logic/og-image-cache";

function createStorage(initial: Record<string, string> = {}): Pick<
  Storage,
  "getItem" | "setItem"
> {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

const sampleEntry: CachedOgImageEntry = {
  imageUrl: "https://cdn.example/og.jpg",
  resolvedAt: "2026-04-24T10:00:00.000Z",
};

describe("OG_IMAGE_CACHE_STORAGE_KEY", () => {
  it("uses a versioned slot so a future shape change can migrate cleanly", () => {
    // Pin: if the cache ever grows a TTL or changes its key shape,
    // the suffix bump should be deliberate. Silent slot rename would
    // mean every user's warm cache disappears overnight.
    expect(OG_IMAGE_CACHE_STORAGE_KEY).toBe("sutrapad-og-image-cache-v1");
  });
});

describe("loadOgImageCache", () => {
  it("returns an empty map when the slot is empty", () => {
    expect(loadOgImageCache(createStorage())).toEqual({});
  });

  it("parses a well-formed JSON payload", () => {
    const storage = createStorage({
      [OG_IMAGE_CACHE_STORAGE_KEY]: JSON.stringify({
        "https://a": sampleEntry,
      }),
    });
    expect(loadOgImageCache(storage)).toEqual({ "https://a": sampleEntry });
  });

  it("returns an empty map on malformed JSON (never throws)", () => {
    const storage = createStorage({
      [OG_IMAGE_CACHE_STORAGE_KEY]: "{not json",
    });
    expect(loadOgImageCache(storage)).toEqual({});
  });

  it("returns an empty map when the parsed value isn't an object", () => {
    const storage = createStorage({
      [OG_IMAGE_CACHE_STORAGE_KEY]: JSON.stringify(["array"]),
    });
    expect(loadOgImageCache(storage)).toEqual({});
  });

  it("drops entries that don't match the expected shape", () => {
    // Defensive: if a future bug writes malformed entries, the loader
    // returns only the valid ones rather than feeding junk into the
    // resolver.
    const storage = createStorage({
      [OG_IMAGE_CACHE_STORAGE_KEY]: JSON.stringify({
        "https://valid": sampleEntry,
        "https://missing-ts": { imageUrl: "https://cdn/og.jpg" },
        "https://bad-image": { imageUrl: 42, resolvedAt: "2026-04-24T10:00:00.000Z" },
        "https://empty-image": { imageUrl: "", resolvedAt: "2026-04-24T10:00:00.000Z" },
      }),
    });
    expect(loadOgImageCache(storage)).toEqual({ "https://valid": sampleEntry });
  });

  it("preserves explicit-null imageUrl entries (cached negative)", () => {
    // A cached null IS a valid entry — it means "we tried, no og:image
    // exists for this URL". Dropping it would cause the resolver to
    // refetch on every render.
    const negative: CachedOgImageEntry = {
      imageUrl: null,
      resolvedAt: "2026-04-24T10:00:00.000Z",
    };
    const storage = createStorage({
      [OG_IMAGE_CACHE_STORAGE_KEY]: JSON.stringify({
        "https://no-og": negative,
      }),
    });
    expect(loadOgImageCache(storage)).toEqual({ "https://no-og": negative });
  });
});

describe("persistOgImageCache", () => {
  it("writes the cache as JSON under the storage key", () => {
    const writes: Record<string, string> = {};
    persistOgImageCache(
      { "https://a": sampleEntry },
      {
        setItem(key, value) {
          writes[key] = value;
        },
      },
    );
    expect(writes[OG_IMAGE_CACHE_STORAGE_KEY]).toBe(
      JSON.stringify({ "https://a": sampleEntry }),
    );
  });

  it("round-trips with loadOgImageCache", () => {
    const storage = createStorage();
    persistOgImageCache({ "https://a": sampleEntry }, storage);
    expect(loadOgImageCache(storage)).toEqual({ "https://a": sampleEntry });
  });

  it("writes an empty cache as '{}' (present-but-empty slot)", () => {
    // An empty-but-present slot is different from a missing slot.
    // The loader returns `{}` for both, but the difference matters
    // for debugging ("we tried to persist" vs "cache was never used").
    const writes: Record<string, string> = {};
    persistOgImageCache(
      {},
      {
        setItem(key, value) {
          writes[key] = value;
        },
      },
    );
    expect(writes[OG_IMAGE_CACHE_STORAGE_KEY]).toBe("{}");
  });
});

describe("setOgImageCacheEntry", () => {
  it("returns a new cache with the entry added", () => {
    const input = {};
    const result = setOgImageCacheEntry(input, "https://a", sampleEntry);
    expect(result).toEqual({ "https://a": sampleEntry });
  });

  it("replaces an existing entry for the same URL", () => {
    const input = { "https://a": sampleEntry };
    const replacement: CachedOgImageEntry = {
      imageUrl: "https://cdn/new.jpg",
      resolvedAt: "2026-04-25T10:00:00.000Z",
    };
    expect(setOgImageCacheEntry(input, "https://a", replacement)).toEqual({
      "https://a": replacement,
    });
  });

  it("does not mutate the input cache (referential purity)", () => {
    // The resolver uses the returned reference to decide whether to
    // persist. If we mutated in place, equality checks would flag
    // "nothing changed" even after a new entry.
    const input = { "https://a": sampleEntry };
    const snapshot = { ...input };
    setOgImageCacheEntry(input, "https://b", sampleEntry);
    expect(input).toEqual(snapshot);
  });

  it("exposes a sensible default cap", () => {
    // Pin the value: a silent reduction would mass-evict warm caches;
    // a silent increase would let a misbehaving build push past the
    // localStorage quota again. Either change should be deliberate.
    expect(OG_IMAGE_CACHE_MAX_ENTRIES).toBe(500);
  });

  it("evicts the oldest entry when the cap is exceeded", () => {
    let cache = {} as Record<string, CachedOgImageEntry>;
    // Fill to the cap, then add one more — the very first entry must
    // be the one that disappears.
    for (let i = 0; i < 3; i += 1) {
      cache = setOgImageCacheEntry(cache, `https://url-${i}`, sampleEntry, 3);
    }
    expect(Object.keys(cache)).toEqual(["https://url-0", "https://url-1", "https://url-2"]);

    cache = setOgImageCacheEntry(cache, "https://url-3", sampleEntry, 3);
    // url-0 evicted, the rest preserved in the same relative order,
    // url-3 at the tail.
    expect(Object.keys(cache)).toEqual(["https://url-1", "https://url-2", "https://url-3"]);
  });

  it("updates move the touched URL to the tail (LRU semantics)", () => {
    let cache = {} as Record<string, CachedOgImageEntry>;
    for (let i = 0; i < 3; i += 1) {
      cache = setOgImageCacheEntry(cache, `https://url-${i}`, sampleEntry, 3);
    }
    // Re-write url-0 with a fresh entry — should move it to the end.
    const refresh: CachedOgImageEntry = {
      imageUrl: "https://cdn/refresh.jpg",
      resolvedAt: "2026-04-25T11:00:00.000Z",
    };
    cache = setOgImageCacheEntry(cache, "https://url-0", refresh, 3);
    expect(Object.keys(cache)).toEqual([
      "https://url-1",
      "https://url-2",
      "https://url-0",
    ]);
    expect(cache["https://url-0"]).toEqual(refresh);
  });

  it("trims a heavily over-capped cache down in a single call", () => {
    // Defensive against a corrupt loader (or a manual cache injection
    // from devtools): a 1000-entry input should still come back at
    // exactly the cap.
    const input: Record<string, CachedOgImageEntry> = {};
    for (let i = 0; i < 1000; i += 1) input[`https://url-${i}`] = sampleEntry;
    const result = setOgImageCacheEntry(input, "https://url-fresh", sampleEntry, 100);
    expect(Object.keys(result)).toHaveLength(100);
    // url-fresh is the most recent and must survive.
    expect(result["https://url-fresh"]).toEqual(sampleEntry);
  });
});
