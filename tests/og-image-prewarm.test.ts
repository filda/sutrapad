import { describe, expect, it } from "vitest";
import type { SutraPadDocument } from "../src/types";
import type { CachedOgImageEntry } from "../src/app/logic/og-image";
import type { OgImageCache } from "../src/app/logic/og-image-cache";
import {
  DEFAULT_PREWARM_CONCURRENCY,
  planOgImagePrewarm,
  runOgImagePrewarm,
} from "../src/app/logic/og-image-prewarm";
import { tick } from "./tick";

function makeNote(
  overrides: Partial<SutraPadDocument> & { id: string },
): SutraPadDocument {
  return {
    title: "Test",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

const SAMPLE_HIT: CachedOgImageEntry = {
  imageUrl: "https://cdn.example/og.jpg",
  resolvedAt: "2026-04-24T10:00:00.000Z",
};

const SAMPLE_MISS: CachedOgImageEntry = {
  imageUrl: null,
  resolvedAt: "2026-04-24T10:00:00.000Z",
};

describe("DEFAULT_PREWARM_CONCURRENCY", () => {
  it("pins to four so a future tweak is a deliberate code change", () => {
    // Four is the polite ceiling on the free allorigins proxy. Bumping
    // without thinking would risk rate limits; nudging down would lose
    // the "drains in seconds" property the prewarm exists to provide.
    expect(DEFAULT_PREWARM_CONCURRENCY).toBe(4);
  });
});

describe("planOgImagePrewarm", () => {
  it("returns an empty plan for an empty workspace", () => {
    expect(planOgImagePrewarm([], {})).toEqual([]);
  });

  it("skips notes that have no primary URL", () => {
    // Hand-typed notes can't have an og:image lookup at all — they go
    // straight to the gradient band path. Including them would queue a
    // doomed allorigins call.
    const notes = [makeNote({ id: "a" }), makeNote({ id: "b", title: "no urls here" })];
    expect(planOgImagePrewarm(notes, {})).toEqual([]);
  });

  it("queues URL-bearing notes whose URL isn't yet cached", () => {
    const notes = [
      makeNote({ id: "a", urls: ["https://nytimes.com/article"] }),
    ];
    expect(planOgImagePrewarm(notes, {})).toEqual([
      { url: "https://nytimes.com/article", notes: [notes[0]] },
    ]);
  });

  it("short-circuits URLs that already have a positive cache hit", () => {
    const url = "https://nytimes.com/article";
    // Cached positive: the resolver would short-circuit Stage 2 anyway,
    // but planning around it keeps the pool focused on URLs that
    // actually need a round-trip.
    const cache: OgImageCache = { [url]: SAMPLE_HIT };
    const notes = [makeNote({ id: "a", urls: [url] })];
    expect(planOgImagePrewarm(notes, cache)).toEqual([]);
  });

  it("short-circuits URLs that already have a cached negative", () => {
    const url = "https://nytimes.com/article";
    // Cached miss = "we already tried, there is no og:image". The whole
    // point of cached negatives is that we never re-ask.
    const cache: OgImageCache = { [url]: SAMPLE_MISS };
    const notes = [makeNote({ id: "a", urls: [url] })];
    expect(planOgImagePrewarm(notes, cache)).toEqual([]);
  });

  it("folds multiple notes pointing at the same URL into one target", () => {
    const url = "https://nytimes.com/article";
    const noteA = makeNote({ id: "a", urls: [url] });
    const noteB = makeNote({
      id: "b",
      urls: [url],
      captureContext: { source: "url-capture", page: { ogImage: "https://capture/og.jpg" } },
    });
    // Both donors travel together so the resolver's Stage 1
    // capture-time lookup can find an og:image on either one — picking
    // only the first note would silently lose hits when the canonical
    // capture happens to be on the later note in document order.
    const plan = planOgImagePrewarm([noteA, noteB], {});
    expect(plan).toEqual([{ url, notes: [noteA, noteB] }]);
  });

  it("prefers the canonical URL over the raw note.urls list", () => {
    const canonical = "https://nytimes.com/article";
    const note = makeNote({
      id: "a",
      urls: ["https://nytimes.com/article?utm=tracking"],
      captureContext: {
        source: "url-capture",
        page: { canonicalUrl: canonical },
      },
    });
    // `deriveNotePrimaryUrl` prefers the canonical URL when the
    // bookmarklet caught a `<link rel="canonical">`; planning has to
    // mirror that choice or the prewarm would resolve the tracking
    // variant and the lazy render would still pay the canonical fetch.
    const plan = planOgImagePrewarm([note], {});
    expect(plan).toEqual([{ url: canonical, notes: [note] }]);
  });

  it("returns one target per distinct URL across a mixed workspace", () => {
    const urlA = "https://nytimes.com/a";
    const urlB = "https://github.com/x/y";
    const notes = [
      makeNote({ id: "1", urls: [urlA] }),
      makeNote({ id: "2", urls: [urlB] }),
      makeNote({ id: "3" }), // hand-typed — skip
      makeNote({ id: "4", urls: [urlA] }), // dupe → folds into target A
    ];
    const plan = planOgImagePrewarm(notes, {});
    expect(plan.map((t) => t.url).toSorted()).toEqual([urlA, urlB].toSorted());
    const targetA = plan.find((t) => t.url === urlA);
    expect(targetA?.notes).toHaveLength(2);
  });
});

function createMemoryCache(initial: OgImageCache = {}): {
  readonly snapshot: () => OgImageCache;
  readonly loadCache: () => OgImageCache;
  readonly persistCache: (cache: OgImageCache) => void;
} {
  let current: OgImageCache = { ...initial };
  return {
    snapshot: () => current,
    loadCache: () => current,
    persistCache: (cache) => {
      current = { ...cache };
    },
  };
}

describe("runOgImagePrewarm", () => {

  it("is a no-op when there are no targets", async () => {
    let fetchCalls = 0;
    const cache = createMemoryCache();
    await runOgImagePrewarm([], {
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("nope");
      },
      loadCache: cache.loadCache,
      persistCache: cache.persistCache,
    });
    expect(fetchCalls).toBe(0);
  });

  it("short-circuits before reading the cache when there are no targets", async () => {
    // Pins the `if (targets.length === 0) return` early-exit. Without
    // it the runner would still produce identical observable behaviour
    // (Promise.all([]) settles immediately), but it would also call
    // loadCache → `window.localStorage.getItem` on every load with a
    // fully-warm workspace. The early-exit is the property we want to
    // pin; the assertion below catches a future refactor that drops
    // it.
    let loadCacheCalls = 0;
    await runOgImagePrewarm([], {
      fetchImpl: async () => new Response("", { status: 200 }),
      loadCache: () => {
        loadCacheCalls += 1;
        return {};
      },
      persistCache: () => {},
    });
    expect(loadCacheCalls).toBe(0);
  });

  it("returns capture-time hits without writing the cache (resolver invariant)", async () => {
    const captureHit = "https://capture/og.jpg";
    const note = makeNote({
      id: "a",
      urls: ["https://nytimes.com/article"],
      captureContext: { source: "url-capture", page: { ogImage: captureHit } },
    });
    let fetchCalls = 0;
    const cache = createMemoryCache();
    await runOgImagePrewarm(
      [{ url: "https://nytimes.com/article", notes: [note] }],
      {
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("nope");
        },
        loadCache: cache.loadCache,
        persistCache: cache.persistCache,
      },
    );
    // Stage 1 in og-image.ts: capture-time hits short-circuit before
    // putCachedEntry. The runner must respect that — otherwise the next
    // page render would read a stale cache entry tied to a value that
    // belonged on the note, not in the cache.
    expect(fetchCalls).toBe(0);
    expect(cache.snapshot()).toEqual({});
  });

  it("resolves a target via the proxy and persists the result", async () => {
    const url = "https://nytimes.com/article";
    const html = `<meta property="og:image" content="https://cdn/fetched.jpg">`;
    const cache = createMemoryCache();
    await runOgImagePrewarm([{ url, notes: [] }], {
      fetchImpl: async () => new Response(html, { status: 200 }),
      loadCache: cache.loadCache,
      persistCache: cache.persistCache,
    });
    const stored = cache.snapshot()[url];
    expect(stored?.imageUrl).toBe("https://cdn/fetched.jpg");
    expect(typeof stored?.resolvedAt).toBe("string");
  });

  it("caches a negative when the proxy returns HTML without an og:image", async () => {
    const url = "https://example.com/no-og";
    const cache = createMemoryCache();
    await runOgImagePrewarm([{ url, notes: [] }], {
      fetchImpl: async () => new Response("<html><body>nothing here</body></html>", { status: 200 }),
      loadCache: cache.loadCache,
      persistCache: cache.persistCache,
    });
    // Cached null is the "we tried, give up" marker the renderer relies
    // on to avoid hammering the proxy every time the card mounts. Drop
    // the negative and every card render starts fetching again.
    expect(cache.snapshot()[url]?.imageUrl).toBeNull();
  });

  it("drains every target even when one resolution throws", async () => {
    const urls = ["https://a.test", "https://b.test", "https://c.test"];
    const cache = createMemoryCache();
    // Throw on the second persist — the resolver itself swallows
    // network errors and writes a negative, but in defence-in-depth
    // we want the runner's try/catch to keep the pool alive even when
    // someone surfaces a synchronous failure from putCachedEntry / a
    // future resolver change.
    let persistCallCount = 0;
    let fetchCallCount = 0;
    await runOgImagePrewarm(
      urls.map((url) => ({ url, notes: [] })),
      {
        concurrency: 1,
        fetchImpl: async () => {
          fetchCallCount += 1;
          return new Response("", { status: 200 });
        },
        loadCache: cache.loadCache,
        persistCache: (next) => {
          persistCallCount += 1;
          if (persistCallCount === 2) {
            throw new Error("simulated quota exceeded");
          }
          cache.persistCache(next);
        },
      },
    );
    // Every URL was attempted — the worker's try/catch kept the pool
    // alive after the second persist threw. Without it the third
    // target would never have been fetched.
    expect(fetchCallCount).toBe(3);
    // The third write succeeds and includes the second URL's negative
    // entry from the in-memory cache, so storage ends up with all
    // three; the asserted invariant is "no target was silently
    // dropped from attempted fetches", not "every persist landed".
    expect(Object.keys(cache.snapshot()).toSorted()).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
  });

  it("runs targets in parallel up to the concurrency cap", async () => {
    // Track how many fetches are in flight at any one time. With
    // concurrency = 2 and three never-resolving promises, the peak
    // should be exactly 2.
    let inFlight = 0;
    let peak = 0;
    const gates: Array<() => void> = [];

    const fetchImpl = (): Promise<Response> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<Response>((resolve) => {
        gates.push(() => {
          inFlight -= 1;
          resolve(new Response("", { status: 200 }));
        });
      });
    };

    const cache = createMemoryCache();
    const runPromise = runOgImagePrewarm(
      ["https://a.test", "https://b.test", "https://c.test"].map((u) => ({ url: u, notes: [] })),
      {
        concurrency: 2,
        fetchImpl,
        loadCache: cache.loadCache,
        persistCache: cache.persistCache,
      },
    );

    // Wait a microtask cycle so the workers have started and reached
    // their first await point.
    await tick();
    expect(peak).toBe(2);

    // Drain the gates one by one; the third worker only enters the
    // pool after the first two settle. Sequential `await` is the whole
    // point — releasing one gate, waiting for the resolver tick, then
    // releasing the next is how we observe the FIFO entry order.
    while (gates.length > 0) {
      const open = gates.shift();
      open?.();
      // eslint-disable-next-line no-await-in-loop
      await tick();
    }
    await runPromise;
    expect(peak).toBe(2);
  });

  it("respects concurrency = 1 (sequential)", async () => {
    // Useful when a future preference wants polite single-flight prewarming.
    const cache = createMemoryCache();
    let inFlight = 0;
    let peak = 0;
    await runOgImagePrewarm(
      [
        { url: "https://x.test", notes: [] },
        { url: "https://y.test", notes: [] },
      ],
      {
        concurrency: 1,
        fetchImpl: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await tick();
          inFlight -= 1;
          return new Response("", { status: 200 });
        },
        loadCache: cache.loadCache,
        persistCache: cache.persistCache,
      },
    );
    expect(peak).toBe(1);
  });

  it("clamps a zero or negative concurrency request to one lane", async () => {
    // Defence: a caller that mistakenly hands in 0 (e.g. `process.env`
    // coerced to a number) shouldn't hang the prewarm forever waiting
    // on a worker pool that never starts.
    const cache = createMemoryCache();
    let calls = 0;
    await runOgImagePrewarm(
      [
        { url: "https://x.test", notes: [] },
        { url: "https://y.test", notes: [] },
      ],
      {
        concurrency: 0,
        fetchImpl: async () => {
          calls += 1;
          return new Response("", { status: 200 });
        },
        loadCache: cache.loadCache,
        persistCache: cache.persistCache,
      },
    );
    expect(calls).toBe(2);
  });
});
