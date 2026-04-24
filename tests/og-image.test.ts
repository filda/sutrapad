import { describe, expect, it } from "vitest";
import {
  absolutizeUrl,
  ALLORIGINS_ENDPOINT,
  buildAllOriginsUrl,
  buildFaviconUrl,
  extractOgImageFromCaptureContext,
  extractOgImageFromHtml,
  findCaptureTimeOgImage,
  resolveOgImageForUrl,
  type CachedOgImageEntry,
} from "../src/app/logic/og-image";
import type { SutraPadCaptureContext, SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> & { id: string }): SutraPadDocument {
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

describe("buildAllOriginsUrl", () => {
  it("URL-encodes the target so query characters don't bleed out", () => {
    // If we used raw concatenation, a target URL with its own `?`
    // would collide with the proxy's query string and the proxy
    // would see a garbage request.
    expect(buildAllOriginsUrl("https://nytimes.com/a?b=c&d=e")).toBe(
      `${ALLORIGINS_ENDPOINT}?url=${encodeURIComponent("https://nytimes.com/a?b=c&d=e")}`,
    );
  });

  it("uses the documented allorigins raw endpoint (regression pin)", () => {
    expect(ALLORIGINS_ENDPOINT).toBe("https://api.allorigins.win/raw");
  });
});

describe("buildFaviconUrl", () => {
  it("points at Google's s2 favicon service with the default 64px size", () => {
    // 64 px is the smallest size that renders crisply at the list's
    // 20 px inline icon on a 2× display. If the default drifts, list
    // previews on hi-DPI screens will blur — pin it.
    expect(buildFaviconUrl("nytimes.com")).toBe(
      "https://www.google.com/s2/favicons?domain=nytimes.com&sz=64",
    );
  });

  it("honours an explicit size override", () => {
    expect(buildFaviconUrl("github.com", 128)).toBe(
      "https://www.google.com/s2/favicons?domain=github.com&sz=128",
    );
  });

  it("URL-encodes the hostname defensively", () => {
    // Internationalised domains can contain characters that matter
    // in a query string (unlikely but possible). Encoding keeps the
    // URL well-formed regardless of what the caller hands over.
    expect(buildFaviconUrl("test domain")).toBe(
      "https://www.google.com/s2/favicons?domain=test%20domain&sz=64",
    );
  });
});

describe("extractOgImageFromCaptureContext", () => {
  it("returns null when the context is undefined", () => {
    expect(extractOgImageFromCaptureContext(undefined)).toBeNull();
  });

  it("returns null when the page sub-object is absent", () => {
    const ctx: SutraPadCaptureContext = { source: "url-capture" };
    expect(extractOgImageFromCaptureContext(ctx)).toBeNull();
  });

  it("returns null when page.ogImage is absent", () => {
    const ctx: SutraPadCaptureContext = {
      source: "url-capture",
      page: { title: "Hello" },
    };
    expect(extractOgImageFromCaptureContext(ctx)).toBeNull();
  });

  it("returns null when page.ogImage is an empty string", () => {
    const ctx: SutraPadCaptureContext = {
      source: "url-capture",
      page: { ogImage: "" },
    };
    expect(extractOgImageFromCaptureContext(ctx)).toBeNull();
  });

  it("returns null when page.ogImage is whitespace-only", () => {
    const ctx: SutraPadCaptureContext = {
      source: "url-capture",
      page: { ogImage: "   " },
    };
    expect(extractOgImageFromCaptureContext(ctx)).toBeNull();
  });

  it("returns the trimmed URL when present in the page metadata", () => {
    // The bookmarklet scraper in `capture-context.ts` populates
    // `captureContext.page.ogImage` from `<meta property="og:image">`.
    // Same storage slot, just nested under `page` alongside the other
    // scraped meta (title, description, canonicalUrl, author, etc.).
    const ctx: SutraPadCaptureContext = {
      source: "url-capture",
      page: { ogImage: "  https://cdn.example/og.jpg  " },
    };
    expect(extractOgImageFromCaptureContext(ctx)).toBe(
      "https://cdn.example/og.jpg",
    );
  });
});

describe("findCaptureTimeOgImage", () => {
  it("returns null when no note has a page.ogImage", () => {
    const notes = [
      makeNote({ id: "a" }),
      makeNote({ id: "b", captureContext: { source: "url-capture" } }),
    ];
    expect(findCaptureTimeOgImage(notes)).toBeNull();
  });

  it("returns the first note's page.ogImage when one is present", () => {
    const notes = [
      makeNote({
        id: "a",
        captureContext: {
          source: "url-capture",
          page: { ogImage: "https://cdn/1.jpg" },
        },
      }),
      makeNote({
        id: "b",
        captureContext: {
          source: "url-capture",
          page: { ogImage: "https://cdn/2.jpg" },
        },
      }),
    ];
    // The caller passes notes in link-index order (newest first), so
    // honoring the first match means we pick the most recent
    // capture's thumbnail — which is the one most likely to still
    // be accurate for the current state of the source page.
    expect(findCaptureTimeOgImage(notes)).toBe("https://cdn/1.jpg");
  });

  it("skips over notes without a page.ogImage to reach a later match", () => {
    const notes = [
      makeNote({ id: "a", captureContext: { source: "url-capture" } }),
      makeNote({
        id: "b",
        captureContext: {
          source: "url-capture",
          page: { ogImage: "https://cdn/b.jpg" },
        },
      }),
    ];
    expect(findCaptureTimeOgImage(notes)).toBe("https://cdn/b.jpg");
  });
});

describe("absolutizeUrl", () => {
  it("returns an already-absolute URL unchanged (normalised)", () => {
    expect(
      absolutizeUrl("https://cdn.example/image.jpg", "https://site.example"),
    ).toBe("https://cdn.example/image.jpg");
  });

  it("resolves a root-relative path against the base", () => {
    expect(absolutizeUrl("/og.jpg", "https://site.example/article/1")).toBe(
      "https://site.example/og.jpg",
    );
  });

  it("resolves a document-relative path against the base", () => {
    expect(absolutizeUrl("og.jpg", "https://site.example/article/1")).toBe(
      "https://site.example/article/og.jpg",
    );
  });

  it("returns null when resolution fails outright", () => {
    // Garbage base — the URL constructor throws, we swallow and
    // surface null so a bad source URL never crashes the resolver.
    expect(absolutizeUrl("og.jpg", "not a url")).toBeNull();
  });
});

describe("extractOgImageFromHtml", () => {
  const base = "https://nytimes.com/article/42";

  it("returns null when there are no meta tags at all", () => {
    expect(extractOgImageFromHtml("<html><body>text</body></html>", base)).toBeNull();
  });

  it("finds the canonical og:image", () => {
    const html = `<head><meta property="og:image" content="https://cdn/og.jpg"></head>`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/og.jpg");
  });

  it("supports single-quoted attribute values", () => {
    const html = `<meta property='og:image' content='https://cdn/og.jpg'>`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/og.jpg");
  });

  it("trims whitespace inside the content attribute value", () => {
    const html = `<meta property="og:image" content="   https://cdn/og.jpg  ">`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/og.jpg");
  });

  it("resolves a relative og:image against the base URL", () => {
    const html = `<meta property="og:image" content="/og.jpg">`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://nytimes.com/og.jpg");
  });

  it("prefers og:image over og:image:url when both exist", () => {
    // Priority pin: canonical tag wins over the secondary URL hint.
    // Same-same for a site that publishes both, but the order matters
    // when they disagree (e.g. secure_url pointing at a tracking CDN).
    const html = `
      <meta property="og:image:url" content="https://cdn/secondary.jpg">
      <meta property="og:image" content="https://cdn/primary.jpg">
    `;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/primary.jpg");
  });

  it("falls back to twitter:image when og:image is missing", () => {
    const html = `<meta name="twitter:image" content="https://cdn/tw.jpg">`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/tw.jpg");
  });

  it("falls back to twitter:image:src as the last source", () => {
    const html = `<meta name="twitter:image:src" content="https://cdn/tw2.jpg">`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/tw2.jpg");
  });

  it("ignores meta tags with the wrong property", () => {
    // A page full of og:title / og:description / article:published_time
    // meta tags shouldn't trick the parser into returning a random
    // non-image URL.
    const html = `
      <meta property="og:title" content="Neat">
      <meta property="og:description" content="Yep">
      <meta property="article:author" content="https://author">
    `;
    expect(extractOgImageFromHtml(html, base)).toBeNull();
  });

  it("handles lowercase property comparison case-insensitively", () => {
    // Some sites use OG:Image in weird casings. Spec allows it.
    const html = `<meta property="OG:IMAGE" content="https://cdn/og.jpg">`;
    expect(extractOgImageFromHtml(html, base)).toBe("https://cdn/og.jpg");
  });

  it("returns null when the content attribute is blank", () => {
    const html = `<meta property="og:image" content="">`;
    expect(extractOgImageFromHtml(html, base)).toBeNull();
  });
});

describe("resolveOgImageForUrl", () => {
  const url = "https://nytimes.com/article";

  function setupCache(initial: Record<string, CachedOgImageEntry> = {}) {
    const store = { ...initial };
    return {
      getCachedEntry: (key: string) => store[key] ?? null,
      putCachedEntry: (key: string, entry: CachedOgImageEntry) => {
        store[key] = entry;
      },
      store,
    };
  }

  it("returns the capture-time og:image without touching cache or network", async () => {
    const captureHit = "https://capture/og.jpg";
    const notes = [
      makeNote({
        id: "a",
        captureContext: { source: "url-capture", page: { ogImage: captureHit } },
      }),
    ];
    const cache = setupCache();
    let fetchCalled = false;
    const result = await resolveOgImageForUrl({
      url,
      notes,
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("nope");
      },
    });
    expect(result).toBe(captureHit);
    expect(fetchCalled).toBe(false);
    // Capture-time hit must not pollute the cache — the cache is for
    // runtime fetches only.
    expect(cache.store).toEqual({});
  });

  it("returns a cached hit without hitting the network", async () => {
    const cache = setupCache({
      [url]: { imageUrl: "https://cached/og.jpg", resolvedAt: "2026-04-24T10:00:00.000Z" },
    });
    let fetchCalled = false;
    const result = await resolveOgImageForUrl({
      url,
      notes: [],
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("nope");
      },
    });
    expect(result).toBe("https://cached/og.jpg");
    expect(fetchCalled).toBe(false);
  });

  it("respects a cached *miss* and does not refetch", async () => {
    // A cached `imageUrl: null` means "we tried, there isn't one".
    // Refetching on every render would defeat the whole point of
    // caching a negative.
    const cache = setupCache({
      [url]: { imageUrl: null, resolvedAt: "2026-04-24T10:00:00.000Z" },
    });
    let fetchCalled = false;
    const result = await resolveOgImageForUrl({
      url,
      notes: [],
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("nope");
      },
    });
    expect(result).toBeNull();
    expect(fetchCalled).toBe(false);
  });

  it("fetches through the proxy on a cache miss and stores the result", async () => {
    const cache = setupCache();
    const html = `<meta property="og:image" content="https://cdn/fetched.jpg">`;
    let fetchedUrl = "";
    const result = await resolveOgImageForUrl({
      url,
      notes: [],
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async (input) => {
        fetchedUrl = typeof input === "string" ? input : input.toString();
        return new Response(html, { status: 200 });
      },
    });
    expect(result).toBe("https://cdn/fetched.jpg");
    expect(fetchedUrl).toBe(buildAllOriginsUrl(url));
    expect(cache.store[url]?.imageUrl).toBe("https://cdn/fetched.jpg");
  });

  it("caches a negative result when the HTML has no og:image", async () => {
    const cache = setupCache();
    const result = await resolveOgImageForUrl({
      url,
      notes: [],
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async () => new Response("<html>no og here</html>", { status: 200 }),
    });
    expect(result).toBeNull();
    expect(cache.store[url]?.imageUrl).toBeNull();
  });

  it("caches a negative when the proxy response is not OK", async () => {
    const cache = setupCache();
    const result = await resolveOgImageForUrl({
      url,
      notes: [],
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async () => new Response("", { status: 500 }),
    });
    expect(result).toBeNull();
    expect(cache.store[url]?.imageUrl).toBeNull();
  });

  it("caches a negative when fetch itself throws", async () => {
    // Network down, DNS failure, allorigins.win offline — all silent,
    // all cached as a miss so we don't retry on every render.
    const cache = setupCache();
    const result = await resolveOgImageForUrl({
      url,
      notes: [],
      getCachedEntry: cache.getCachedEntry,
      putCachedEntry: cache.putCachedEntry,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result).toBeNull();
    expect(cache.store[url]?.imageUrl).toBeNull();
  });
});
