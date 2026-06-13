// @vitest-environment node
//
// Unit tests for `createOgImageResolver` — the per-render wrapper that
// owns the localStorage og:image cache and delegates the priority-chain
// walk to `resolveOgImageForUrl`. The wrapper itself has only two pieces
// of behaviour worth pinning:
//
//   1. `getCachedEntry` hands the resolver the *entry* for a warm URL
//      (the `?? null` only kicks in for a genuine miss).
//   2. `putCachedEntry` commits a fresh resolution back to storage —
//      it folds the new entry into the cache and persists it.
//
// Both are covered here by stubbing the cache module and the resolver
// so the wrapper's wiring is the only thing under test.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/app/logic/og-image-cache", () => ({
  loadOgImageCache: vi.fn(),
  persistOgImageCache: vi.fn(),
  setOgImageCacheEntry: vi.fn(),
}));
vi.mock("../src/app/logic/og-image", () => ({
  resolveOgImageForUrl: vi.fn(),
}));

import { createOgImageResolver } from "../src/app/logic/og-image-resolver";
import {
  loadOgImageCache,
  persistOgImageCache,
  setOgImageCacheEntry,
} from "../src/app/logic/og-image-cache";
import { resolveOgImageForUrl } from "../src/app/logic/og-image";
import type { CachedOgImageEntry } from "../src/app/logic/og-image";
import type { OgImageCache } from "../src/app/logic/og-image-cache";

const URL_A = "https://example.com/a";

function entry(imageUrl: string | null): CachedOgImageEntry {
  return { imageUrl, resolvedAt: "2026-05-01T00:00:00.000Z" };
}

describe("createOgImageResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the resolver the cached entry for a warm URL (not a null miss)", async () => {
    // The wrapper reads the cache once on construction and exposes it
    // through `getCachedEntry: (key) => cache[key] ?? null`. For a URL
    // that *is* in the snapshot, the resolver must receive the real
    // entry — the `?? null` fallback only applies to a genuine miss.
    const cached = entry("https://img.example.com/a.png");
    vi.mocked(loadOgImageCache).mockReturnValue({
      [URL_A]: cached,
    } as OgImageCache);

    // Stub the pipeline so it simply echoes whatever `getCachedEntry`
    // returns — that makes the wrapper's lookup the only thing the
    // assertion depends on.
    vi.mocked(resolveOgImageForUrl).mockImplementation((options) => {
      const hit = options.getCachedEntry(options.url);
      return Promise.resolve(hit ? hit.imageUrl : "__treated-as-miss__");
    });

    const resolver = createOgImageResolver();

    await expect(resolver.resolve(URL_A, [])).resolves.toBe(
      "https://img.example.com/a.png",
    );
  });

  it("persists a fresh resolution back to storage via putCachedEntry", async () => {
    // A cache miss that the pipeline resolves over the network calls
    // `putCachedEntry`, whose body must (a) fold the entry into the
    // cache through `setOgImageCacheEntry` and (b) persist the new
    // reference. An emptied body would silently drop every fresh
    // resolution from storage.
    vi.mocked(loadOgImageCache).mockReturnValue({} as OgImageCache);
    const fresh = entry("https://img.example.com/fresh.png");
    const nextCache = { [URL_A]: fresh } as OgImageCache;
    vi.mocked(setOgImageCacheEntry).mockReturnValue(nextCache);

    vi.mocked(resolveOgImageForUrl).mockImplementation((options) => {
      options.putCachedEntry(URL_A, fresh);
      return Promise.resolve(fresh.imageUrl);
    });

    const resolver = createOgImageResolver();
    await resolver.resolve(URL_A, []);

    expect(setOgImageCacheEntry).toHaveBeenCalledWith({}, URL_A, fresh);
    expect(persistOgImageCache).toHaveBeenCalledWith(nextCache);
  });

  it("threads the resolved url and notes straight through to the pipeline", async () => {
    // Guards the delegating call itself: the wrapper must pass the
    // caller's `url` + `notes` to `resolveOgImageForUrl` unchanged and
    // return its result verbatim.
    vi.mocked(loadOgImageCache).mockReturnValue({} as OgImageCache);
    vi.mocked(resolveOgImageForUrl).mockResolvedValue(null);

    const resolver = createOgImageResolver();
    const notes = [{ id: "n1" }] as never;

    await expect(resolver.resolve(URL_A, notes)).resolves.toBeNull();
    expect(resolveOgImageForUrl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(resolveOgImageForUrl).mock.calls[0][0]).toMatchObject({
      url: URL_A,
      notes,
    });
  });
});
