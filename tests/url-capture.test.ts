import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractHtmlLang,
  buildNoteCaptureTitle,
  clearCaptureParamsFromLocation,
  derivePlaceLabel,
  deriveTitleFromUrl,
  extractHtmlTitle,
  formatCoordinates,
  getDaypart,
  readNoteCapture,
  readUrlCapture,
  resolveCurrentCoordinates,
  resolveTitleFromUrl,
  reverseGeocodeCoordinates,
} from "../src/lib/url-capture";

describe("url capture helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the capture payload from the query string", () => {
    const payload = readUrlCapture(
      "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com%2Fhello-world&title=Hello%20World",
    );

    expect(payload).toEqual({
      title: "Hello World",
      url: "https://example.com/hello-world",
    });
  });

  it("reads serialized source-page metadata from the query string", () => {
    const capture = encodeURIComponent(
      JSON.stringify({
        referrer: "https://news.example.com/",
        timeOnPageMs: 4200,
        scroll: {
          x: 0,
          y: 240,
          progress: 0.5,
        },
        page: {
          description: "Example article",
        },
      }),
    );

    expect(
      readUrlCapture(
        `https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com%2Fpost&capture=${capture}`,
      ),
    ).toEqual({
      url: "https://example.com/post",
      captureContext: {
        referrer: "https://news.example.com/",
        timeOnPageMs: 4200,
        scroll: {
          x: 0,
          y: 240,
          progress: 0.5,
        },
        page: {
          description: "Example article",
        },
      },
    });
  });

  it("ignores invalid serialized capture metadata values", () => {
    expect(
      readUrlCapture(
        "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com%2Fpost&capture=true",
      ),
    ).toEqual({
      url: "https://example.com/post",
      captureContext: undefined,
    });

    expect(
      readUrlCapture(
        "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com%2Fpost&capture=%7Bnot-json",
      ),
    ).toEqual({
      url: "https://example.com/post",
      captureContext: undefined,
    });
  });

  it("trims title whitespace and rejects invalid captured URLs", () => {
    expect(
      readUrlCapture(
        "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com%2Fpost&title=%20%20Hello%20there%20%20",
      ),
    ).toEqual({
      title: "Hello there",
      url: "https://example.com/post",
    });

    expect(
      readUrlCapture("https://filda.github.io/sutrapad/?url=not-a-real-url&title=Hello"),
    ).toBeNull();
  });

  it("clears capture parameters from the location", () => {
    expect(
      clearCaptureParamsFromLocation(
        "https://filda.github.io/sutrapad/?url=https%3A%2F%2Fexample.com&title=Hello&x=1",
      ),
    ).toBe("https://filda.github.io/sutrapad/?x=1");
  });

  it("removes note captures as well when clearing the location", () => {
    expect(
      clearCaptureParamsFromLocation(
        "https://filda.github.io/sutrapad/?note=Remember%20milk&title=Hello&url=https%3A%2F%2Fexample.com",
      ),
    ).toBe("https://filda.github.io/sutrapad/");
  });

  it("reads the note payload from the query string", () => {
    expect(
      readNoteCapture("https://filda.github.io/sutrapad/?note=Remember%20milk"),
    ).toEqual({
      note: "Remember milk",
    });
  });

  it("trims note captures and ignores empty note payloads", () => {
    expect(
      readNoteCapture("https://filda.github.io/sutrapad/?note=%20%20Remember%20milk%20%20"),
    ).toEqual({
      note: "Remember milk",
    });

    expect(readNoteCapture("https://filda.github.io/sutrapad/?note=%20%20%20")).toBeNull();
  });

  it("derives a reasonable fallback title from the captured URL", () => {
    expect(deriveTitleFromUrl("https://example.com/hello-world_post")).toBe(
      "hello world post · example.com",
    );
  });

  it("strips www and file extensions when deriving fallback titles", () => {
    expect(deriveTitleFromUrl("https://www.example.com/articles/test-page.html")).toBe(
      "test page · example.com",
    );
  });

  it("keeps the last non-empty path segment when the URL ends with a slash", () => {
    expect(deriveTitleFromUrl("https://www.example.com/articles/hello--world__/")).toBe(
      "hello world · example.com",
    );
  });

  it("only strips a leading www. from the host and leaves www-like segments alone", () => {
    // Kills Regex mutation that drops the ^ anchor in /^www\./:
    // without the anchor, any "www." substring in the host would get removed.
    expect(deriveTitleFromUrl("https://mywww.example.com/story")).toBe(
      "story · mywww.example.com",
    );
  });

  it("strips only the trailing file extension from the last segment", () => {
    // Kills Regex mutation that drops the $ anchor in /\.[a-z0-9]+$/i:
    // without the anchor, the first ".something" would be stripped instead of the last.
    expect(deriveTitleFromUrl("https://example.com/articles/foo.bar.html")).toBe(
      "foo.bar · example.com",
    );
  });

  it("falls back to the host when the derived segment is empty after trimming", () => {
    expect(deriveTitleFromUrl("https://example.com/.html")).toBe("example.com");
  });

  it("extracts a title from HTML", () => {
    expect(
      extractHtmlTitle(
        '<html lang="en"><head><title>  Example Page  </title></head></html>',
      ),
    ).toBe("Example Page");
  });

  it("normalizes HTML titles and decodes a few common entities", () => {
    expect(
      extractHtmlTitle(
        '<html lang="en"><head><title>  Fish &amp; Chips &lt;3 &gt; 2  </title></head></html>',
      ),
    ).toBe("Fish & Chips <3 > 2");

    expect(extractHtmlTitle('<html lang="en"><body>No title</body></html>')).toBeNull();
  });

  it("extracts titles from <title> tags that carry attributes", () => {
    // Kills Regex mutation that rewrites [^>]* to [>]* in the title pattern.
    expect(
      extractHtmlTitle(
        '<html><head><title class="page-title" data-id="42">Attributed title</title></head></html>',
      ),
    ).toBe("Attributed title");
  });

  it("collapses runs of whitespace inside titles into a single space", () => {
    // Kills Regex mutation that drops the + quantifier from /\s+/g: with the
    // quantifier gone, each whitespace character is replaced individually and
    // runs of spaces/tabs are preserved instead of collapsed.
    expect(
      extractHtmlTitle(
        "<html><head><title>Spaced\t\t  out  title</title></head></html>",
      ),
    ).toBe("Spaced out title");
  });

  it("returns null when the <title> body is blank after normalization", () => {
    expect(extractHtmlTitle("<html><head><title>   </title></head></html>")).toBeNull();
  });

  it("extracts the document language from the html tag", () => {
    expect(
      extractHtmlLang('<html lang="cs-CZ"><head><title>Example</title></head></html>'),
    ).toBe("cs-CZ");

    expect(
      extractHtmlLang("<html data-theme='paper' lang='en'><head></head></html>"),
    ).toBe("en");

    expect(extractHtmlLang('<html data-theme="paper" lang=""><head></head></html>')).toBeNull();
  });

  it("extracts languages from loose html lang attributes", () => {
    expect(
      extractHtmlLang("<html data-theme='paper' lang='cs-CZ'><head></head></html>"),
    ).toBe("cs-CZ");
    expect(
      extractHtmlLang("<html data-theme='paper' lang=cs><head></head></html>"),
    ).toBe("cs");
  });

  it("returns null when the html tag has no lang attribute at all", () => {
    expect(extractHtmlLang("<html><head></head></html>")).toBeNull();
  });

  it("loads a title from a reachable page and ignores failed fetches", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () => '<html lang="en"><head><title> Loaded title </title></head></html>',
        })
        .mockResolvedValueOnce({
          ok: false,
          text: () => '<html lang="en"><head></head></html>',
        }),
    );

    await expect(resolveTitleFromUrl("https://example.com/post")).resolves.toBe("Loaded title");
    await expect(resolveTitleFromUrl("https://example.com/missing")).resolves.toBeNull();
  });

  it("returns null from resolveTitleFromUrl when fetch itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(resolveTitleFromUrl("https://example.com/post")).resolves.toBeNull();
  });

  it("builds a note capture title from date and place", () => {
    // The numeric date is locale-formatted, so we assert on the structure rather
    // than a specific ordering of day/month/year.
    const title = buildNoteCaptureTitle(
      new Date("2026-04-14T00:15:00"),
      "LibeÅˆ",
    );
    expect(title).toContain("2026");
    expect(title).toContain("14");
    expect(title).toContain("4");
    expect(title.endsWith(" · midnight · LibeÅˆ")).toBe(true);
  });

  it("builds a note capture title without a place when none is provided", () => {
    const title = buildNoteCaptureTitle(new Date("2026-04-14T12:00:00"));
    expect(title).toContain("2026");
    expect(title).toContain("14");
    expect(title).toContain("4");
    expect(title.endsWith(" · high noon")).toBe(true);
  });

  it("detects dayparts and formats coordinates", () => {
    expect(getDaypart(new Date("2026-04-14T00:15:00"))).toBe("midnight");
    expect(getDaypart(new Date("2026-04-14T06:30:00"))).toBe("early morning");
    expect(getDaypart(new Date("2026-04-14T12:00:00"))).toBe("high noon");
    expect(getDaypart(new Date("2026-04-14T16:45:00"))).toBe("late afternoon");
    expect(getDaypart(new Date("2026-04-14T21:15:00"))).toBe("late evening");
    expect(formatCoordinates({ latitude: 50.1034, longitude: 14.4721 })).toBe(
      "50.1034, 14.4721",
    );
  });

  // Boundary table: each row is exactly on a boundary or one minute either side.
  // Designed to kill EqualityOperator mutations (< -> <=) on every daypart threshold.
  it.each([
    ["2026-04-14T00:00:00", "midnight"],
    ["2026-04-14T00:59:00", "midnight"],
    ["2026-04-14T01:00:00", "late night"],
    ["2026-04-14T04:29:00", "late night"],
    ["2026-04-14T04:30:00", "early morning"],
    ["2026-04-14T06:59:00", "early morning"],
    ["2026-04-14T07:00:00", "morning"],
    ["2026-04-14T11:29:00", "morning"],
    ["2026-04-14T11:30:00", "high noon"],
    ["2026-04-14T12:29:00", "high noon"],
    ["2026-04-14T12:30:00", "afternoon"],
    ["2026-04-14T14:59:00", "afternoon"],
    ["2026-04-14T15:00:00", "late afternoon"],
    ["2026-04-14T17:59:00", "late afternoon"],
    ["2026-04-14T18:00:00", "evening"],
    ["2026-04-14T20:59:00", "evening"],
    ["2026-04-14T21:00:00", "late evening"],
    ["2026-04-14T22:59:00", "late evening"],
    ["2026-04-14T23:00:00", "night"],
    ["2026-04-14T23:30:00", "night"],
  ])("maps %s to daypart %s", (iso, expected) => {
    expect(getDaypart(new Date(iso))).toBe(expected);
  });

  it("derives a place label from reverse geocoding data", () => {
    expect(
      derivePlaceLabel({
        suburb: "LibeÅˆ",
        city: "Prague",
      }),
    ).toBe("LibeÅˆ");

    expect(
      derivePlaceLabel({
        town: "Å˜Ã­Äany",
        country: "Czechia",
      }),
    ).toBe("Å˜Ã­Äany");
  });

  it("skips blank place labels and falls back to the next populated field", () => {
    expect(
      derivePlaceLabel({
        suburb: "   ",
        city: "Prague",
      }),
    ).toBe("Prague");

    expect(derivePlaceLabel()).toBeNull();
  });
});

// Direct coverage for the two thin wrappers around browser APIs that the rest
// of the capture pipeline only sees through dependency injection:
//
//  - `resolveCurrentCoordinates` — the `navigator.geolocation.getCurrentPosition`
//    promise-ifier, including the privacy/performance options it passes through.
//  - `reverseGeocodeCoordinates` — the Nominatim caller with its
//    `Accept-Language` fallback chain, error handling, and localStorage cache.
//
// Both functions are mutated by Stryker (the `src/lib` glob is in scope), but
// `app.test.ts` and `apply-fresh-note-details.test.ts` cover them only via
// mocks injected into `generateFreshNoteDetails` / `collectNoteCaptureDetails`,
// so the wrapper code itself never runs in tests. Without these blocks every
// mutant inside them is a coverage-free survivor.

describe("resolveCurrentCoordinates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when geolocation is missing from the navigator", async () => {
    vi.stubGlobal("navigator", {});
    await expect(resolveCurrentCoordinates()).resolves.toBeNull();
  });

  it("resolves with the position's latitude and longitude on success", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          success({
            coords: {
              latitude: 50.0755,
              longitude: 14.4378,
              accuracy: 12,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: 0,
          } as GeolocationPosition);
        },
      },
    });

    await expect(resolveCurrentCoordinates()).resolves.toEqual({
      latitude: 50.0755,
      longitude: 14.4378,
    });
  });

  it("resolves with null when the browser invokes the error callback", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _success: PositionCallback,
          error?: PositionErrorCallback,
        ) => {
          error?.({
            code: 1,
            message: "User denied geolocation",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    });

    await expect(resolveCurrentCoordinates()).resolves.toBeNull();
  });

  it("passes the privacy and performance options getCurrentPosition expects", () => {
    // The prompt UX (battery cost, staleness, hang risk) is driven by this
    // third argument. Flipping `enableHighAccuracy` to true or removing the
    // timeout changes the live behaviour materially, so pin all three.
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    // Fire-and-forget — the spy never invokes either callback so the inner
    // promise never settles. The Promise executor runs synchronously, so the
    // spy has already been called by the time the next statement executes.
    void resolveCurrentCoordinates();

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 60000,
    });
  });
});

const NOMINATIM_CACHE_KEY = "sutrapad-nominatim-cache";

function createNominatimStorageMock(initial: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

interface BrowserStubOptions {
  storage?: Storage;
  languages?: readonly string[];
  language?: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function stubReverseGeocodeGlobals(options: BrowserStubOptions = {}): {
  storage: Storage;
  fetchSpy: ReturnType<typeof vi.fn>;
} {
  const storage = options.storage ?? createNominatimStorageMock();
  const fetchSpy = vi.fn(
    options.fetchImpl ?? (() => new Response("{}", { status: 200 })),
  );
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", {
    languages: options.languages,
    language: options.language,
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { storage, fetchSpy };
}

function readAcceptLanguage(init: RequestInit | undefined): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.["Accept-Language"];
}

describe("reverseGeocodeCoordinates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls Nominatim's reverse endpoint with the requested lat/lon and standard query params", async () => {
    const { fetchSpy } = stubReverseGeocodeGlobals({
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ address: { city: "Prague" } }), {
          status: 200,
        })),
    });

    await reverseGeocodeCoordinates({ latitude: 50.0755, longitude: 14.4378 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url.startsWith("https://nominatim.openstreetmap.org/reverse?")).toBe(
      true,
    );
    expect(url).toContain("format=jsonv2");
    expect(url).toContain("zoom=16");
    expect(url).toContain("addressdetails=1");
    expect(url).toContain("lat=50.0755");
    expect(url).toContain("lon=14.4378");
  });

  it("sends Accept-Language built from navigator.languages joined by comma", async () => {
    const { fetchSpy } = stubReverseGeocodeGlobals({ languages: ["cs", "en-US"] });
    await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 });
    expect(readAcceptLanguage(fetchSpy.mock.calls[0][1] as RequestInit)).toBe(
      "cs,en-US",
    );
  });

  it("falls back to navigator.language when navigator.languages is missing", async () => {
    const { fetchSpy } = stubReverseGeocodeGlobals({ language: "cs-CZ" });
    await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 });
    expect(readAcceptLanguage(fetchSpy.mock.calls[0][1] as RequestInit)).toBe(
      "cs-CZ",
    );
  });

  it("falls back to navigator.language when navigator.languages is an empty list", async () => {
    // `[].join(",")` is `""` (falsy) — guards the `||` semantics on the
    // first link of the Accept-Language chain, which an `&&` mutation would
    // happily flip without this case.
    const { fetchSpy } = stubReverseGeocodeGlobals({
      languages: [],
      language: "cs-CZ",
    });
    await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 });
    expect(readAcceptLanguage(fetchSpy.mock.calls[0][1] as RequestInit)).toBe(
      "cs-CZ",
    );
  });

  it("falls back to 'en' when neither navigator.languages nor navigator.language is set", async () => {
    const { fetchSpy } = stubReverseGeocodeGlobals();
    await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 });
    expect(readAcceptLanguage(fetchSpy.mock.calls[0][1] as RequestInit)).toBe(
      "en",
    );
  });

  it("returns null when the Nominatim response is not ok", async () => {
    stubReverseGeocodeGlobals({
      fetchImpl: () => Promise.resolve(new Response("{}", { status: 500 })),
    });
    expect(
      await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 }),
    ).toBeNull();
  });

  it("returns null when the response carries no usable place label", async () => {
    stubReverseGeocodeGlobals({
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ address: {} }), { status: 200 })),
    });
    expect(
      await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 }),
    ).toBeNull();
  });

  it("swallows fetch errors and returns null", async () => {
    stubReverseGeocodeGlobals({
      fetchImpl: () => {
        throw new Error("network down");
      },
    });
    expect(
      await reverseGeocodeCoordinates({ latitude: 0, longitude: 0 }),
    ).toBeNull();
  });

  it("persists the resolved label and short-circuits a second call for the same coordinates", async () => {
    const { fetchSpy, storage } = stubReverseGeocodeGlobals({
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ address: { city: "Prague" } }), {
          status: 200,
        })),
    });

    expect(
      await reverseGeocodeCoordinates({ latitude: 50.0755, longitude: 14.4378 }),
    ).toBe("Prague");
    expect(
      await reverseGeocodeCoordinates({ latitude: 50.0755, longitude: 14.4378 }),
    ).toBe("Prague");

    // One network call, one cache entry keyed at ~111 m precision
    // (`toFixed(3)` on each axis). Asserting the persisted JSON shape pins
    // both the saveNominatimCache wire-up and the cache key scheme — a
    // mutant that flipped `toFixed(3)` to `toFixed(2)` (or dropped the
    // save call entirely) would surface here.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(
      storage.getItem(NOMINATIM_CACHE_KEY) ?? "{}",
    ) as Record<string, string>;
    expect(persisted).toEqual({ "50.075,14.438": "Prague" });
  });

  it("treats coordinates that round to the same ~100 m bucket as a cache hit", async () => {
    const { fetchSpy } = stubReverseGeocodeGlobals({
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ address: { city: "Prague" } }), {
          status: 200,
        })),
    });

    await reverseGeocodeCoordinates({ latitude: 50.0755, longitude: 14.4378 });
    // Both axes round to the same `toFixed(3)` slot (`50.075,14.438`), so
    // the second call must serve from cache without touching the network.
    await reverseGeocodeCoordinates({ latitude: 50.0754, longitude: 14.4382 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed cache entry and overwrites it on the next successful lookup", async () => {
    const storage = createNominatimStorageMock({
      [NOMINATIM_CACHE_KEY]: "{not-json",
    });
    const { fetchSpy } = stubReverseGeocodeGlobals({
      storage,
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ address: { city: "Prague" } }), {
          status: 200,
        })),
    });

    expect(
      await reverseGeocodeCoordinates({ latitude: 50.0755, longitude: 14.4378 }),
    ).toBe("Prague");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(storage.getItem(NOMINATIM_CACHE_KEY) ?? "{}") as Record<
        string,
        string
      >,
    ).toEqual({ "50.075,14.438": "Prague" });
  });
});
