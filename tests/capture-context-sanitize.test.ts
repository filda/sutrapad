import { describe, expect, it } from "vitest";
import { sanitizeCaptureContext } from "../src/lib/capture-context-sanitize";

describe("sanitizeCaptureContext", () => {
  it("returns undefined for non-object inputs", () => {
    expect(sanitizeCaptureContext(null)).toBeUndefined();
    expect(sanitizeCaptureContext(undefined)).toBeUndefined();
    expect(sanitizeCaptureContext("nope")).toBeUndefined();
    expect(sanitizeCaptureContext(42)).toBeUndefined();
    expect(sanitizeCaptureContext([])).toBeUndefined();
  });

  it("strips unknown top-level keys silently", () => {
    const result = sanitizeCaptureContext({
      source: "url-capture",
      maliciousField: "drop me",
      __proto__: { polluted: true },
    });
    expect(result).toEqual({ source: "url-capture" });
    expect(result && "maliciousField" in result).toBe(false);
  });

  it("rejects unknown source values", () => {
    expect(sanitizeCaptureContext({ source: "evil-capture" })).toBeUndefined();
    expect(sanitizeCaptureContext({ source: 42 })).toBeUndefined();
  });

  it("accepts every known source", () => {
    expect(sanitizeCaptureContext({ source: "new-note" })).toEqual({
      source: "new-note",
    });
    expect(sanitizeCaptureContext({ source: "text-capture" })).toEqual({
      source: "text-capture",
    });
    expect(sanitizeCaptureContext({ source: "url-capture" })).toEqual({
      source: "url-capture",
    });
  });

  it("clamps oversized strings to per-field budgets", () => {
    const huge = "x".repeat(10_000);
    const result = sanitizeCaptureContext({
      timezone: huge,
      page: { title: huge, description: huge, ogImage: `https://x.test/${huge}` },
    });
    // medium budget = 512
    expect(result?.timezone?.length).toBe(512);
    expect(result?.page?.title?.length).toBe(512);
    // long budget = 1024
    expect(result?.page?.description?.length).toBe(1024);
    // url budget = 2048
    expect(result?.page?.ogImage?.length).toBe(2048);
  });

  it("strips `javascript:` and other non-http schemes from URL fields", () => {
    const result = sanitizeCaptureContext({
      page: {
        ogImage: 'javascript:alert("pwn")',
        canonicalUrl: "data:text/html,<script>alert(1)</script>",
      },
      referrer: "vbscript:msgbox(1)",
    });
    // page itself should drop because every field collapsed to undefined
    expect(result?.page).toBeUndefined();
    expect(result?.referrer).toBeUndefined();
  });

  it("accepts http and https URLs", () => {
    const result = sanitizeCaptureContext({
      page: {
        ogImage: "https://example.com/img.png",
        canonicalUrl: "http://example.com/article",
      },
      referrer: "https://news.example.com/",
    });
    expect(result?.page?.ogImage).toBe("https://example.com/img.png");
    expect(result?.page?.canonicalUrl).toBe("http://example.com/article");
    expect(result?.referrer).toBe("https://news.example.com/");
  });

  it("drops malformed URL strings", () => {
    const result = sanitizeCaptureContext({
      page: { ogImage: "not a url at all" },
    });
    expect(result?.page).toBeUndefined();
  });

  it("rejects non-finite numbers and out-of-range values", () => {
    const result = sanitizeCaptureContext({
      timezoneOffsetMinutes: Infinity,
      timeOnPageMs: NaN,
      scroll: { x: -Infinity, y: 1e30, progress: 2.5 },
      battery: { levelPercent: -10, charging: "yes" },
      weather: {
        source: "open-meteo",
        temperatureC: 9999,
        weatherCode: -1,
        windSpeedKmh: NaN,
        isDay: 1,
      },
    });
    expect(result?.timezoneOffsetMinutes).toBeUndefined();
    expect(result?.timeOnPageMs).toBeUndefined();
    expect(result?.scroll).toBeUndefined();
    expect(result?.battery).toBeUndefined();
    expect(result?.weather).toBeUndefined();
  });

  it("clamps in-range numerics through unchanged", () => {
    const result = sanitizeCaptureContext({
      timezoneOffsetMinutes: 60,
      timeOnPageMs: 12_345,
      scroll: { x: 0, y: 100, progress: 0.5 },
      battery: { levelPercent: 75, charging: false },
      weather: {
        source: "open-meteo",
        temperatureC: 22,
        weatherCode: 3,
        windSpeedKmh: 12,
        isDay: true,
      },
    });
    expect(result?.timezoneOffsetMinutes).toBe(60);
    expect(result?.timeOnPageMs).toBe(12_345);
    expect(result?.scroll).toEqual({ x: 0, y: 100, progress: 0.5 });
    expect(result?.battery).toEqual({ levelPercent: 75, charging: false });
    expect(result?.weather).toEqual({
      temperatureC: 22,
      weatherCode: 3,
      windSpeedKmh: 12,
      isDay: true,
      source: "open-meteo",
    });
  });

  it("rejects weather snapshots whose source isn't open-meteo", () => {
    const result = sanitizeCaptureContext({
      weather: {
        source: "evil-weather",
        temperatureC: 25,
      },
    });
    expect(result?.weather).toBeUndefined();
  });

  it("rejects unknown deviceType values", () => {
    expect(
      sanitizeCaptureContext({ deviceType: "smart-toaster" })?.deviceType,
    ).toBeUndefined();
    expect(
      sanitizeCaptureContext({ deviceType: "mobile" })?.deviceType,
    ).toBe("mobile");
  });

  it("filters non-string entries from languages and caps length", () => {
    const result = sanitizeCaptureContext({
      languages: [
        "en",
        "cs",
        42,
        null,
        ...Array.from({ length: 100 }, (_, i) => `xx-${i}`),
      ],
    });
    expect(result?.languages?.length).toBe(16);
    // Pure-string filter ran first; the two real entries lead.
    expect(result?.languages?.[0]).toBe("en");
    expect(result?.languages?.[1]).toBe("cs");
  });

  it("returns undefined when every field collapses", () => {
    const result = sanitizeCaptureContext({
      source: "junk",
      timeOnPageMs: NaN,
      page: { ogImage: "javascript:alert(1)" },
    });
    expect(result).toBeUndefined();
  });

  it("trims leading and trailing whitespace from string fields", () => {
    const result = sanitizeCaptureContext({
      timezone: "  Europe/Prague  ",
      page: { title: "  Cool article  " },
    });
    expect(result?.timezone).toBe("Europe/Prague");
    expect(result?.page?.title).toBe("Cool article");
  });

  it("treats blank / whitespace-only strings as absent", () => {
    const result = sanitizeCaptureContext({
      timezone: "   ",
      page: { title: "" },
    });
    expect(result?.timezone).toBeUndefined();
    expect(result?.page).toBeUndefined();
  });
});
