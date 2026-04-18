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
  resolveTitleFromUrl,
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
          text: async () => '<html lang="en"><head><title> Loaded title </title></head></html>',
        })
        .mockResolvedValueOnce({
          ok: false,
          text: async () => '<html lang="en"><head></head></html>',
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
    expect(buildNoteCaptureTitle(new Date("2026-04-14T00:15:00"), "LibeÅˆ")).toBe(
      "14/04/2026 · midnight · LibeÅˆ",
    );
  });

  it("builds a note capture title without a place when none is provided", () => {
    expect(buildNoteCaptureTitle(new Date("2026-04-14T12:00:00"))).toBe(
      "14/04/2026 · high noon",
    );
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
