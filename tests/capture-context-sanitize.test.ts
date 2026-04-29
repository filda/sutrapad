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

// Per-sub-sanitiser coverage. The original suite exercised the
// top-level entry path with mostly-good data, which left every
// sub-sanitiser's "non-object input" guard, "no usable fields →
// drop the snapshot" branch, and several boundary equality checks
// uncovered or untested. Each sub-sanitiser is private; we exercise
// it through the public entry by setting the corresponding field on
// the input object.
describe("sanitizeCaptureContext sub-sanitisers", () => {
  describe("screen snapshot", () => {
    it("drops the snapshot when `screen` is not an object", () => {
      // Covers the `!raw || typeof raw !== "object"` entry guard. A
      // string / number / array / null / undefined `screen` field
      // must collapse to absent.
      for (const screen of ["nope", 42, null, [], true]) {
        const result = sanitizeCaptureContext({ screen });
        expect(result?.screen).toBeUndefined();
      }
    });

    it("drops the snapshot when every screen field is invalid", () => {
      // Covers `Object.values(result).some(v => v !== undefined)`
      // false-branch — when nothing survives the per-field clamps,
      // the whole snapshot collapses.
      const result = sanitizeCaptureContext({
        screen: {
          viewportWidth: NaN,
          viewportHeight: -1,
          screenWidth: Infinity,
          screenHeight: 1e30,
          pixelRatio: -0.5,
          orientation: "",
        },
      });
      expect(result?.screen).toBeUndefined();
    });

    it("keeps a partial snapshot when a single field is valid", () => {
      // Covers the `some(v => v !== undefined)` true-branch and the
      // object-literal assembly: a single non-undefined field must
      // be enough to keep the snapshot.
      const result = sanitizeCaptureContext({
        screen: { pixelRatio: 2, viewportWidth: NaN, orientation: "" },
      });
      expect(result?.screen).toEqual({
        pixelRatio: 2,
        viewportWidth: undefined,
        viewportHeight: undefined,
        screenWidth: undefined,
        screenHeight: undefined,
        orientation: undefined,
      });
    });
  });

  describe("scroll snapshot", () => {
    it("drops the snapshot for non-object `scroll`", () => {
      for (const scroll of ["str", 0, null, [1, 2], false]) {
        expect(sanitizeCaptureContext({ scroll })?.scroll).toBeUndefined();
      }
    });

    it("drops the snapshot when every scroll field is invalid", () => {
      const result = sanitizeCaptureContext({
        scroll: { x: NaN, y: Infinity, progress: -1 },
      });
      expect(result?.scroll).toBeUndefined();
    });
  });

  describe("network snapshot", () => {
    it("drops the snapshot for non-object `network`", () => {
      for (const network of ["str", 0, null, [1, 2], false]) {
        expect(sanitizeCaptureContext({ network })?.network).toBeUndefined();
      }
    });

    it("keeps a partial snapshot when only `online` is set", () => {
      // Smallest possible valid network snapshot: just the offline
      // flag, every numeric/string field invalid. Exercises the
      // ObjectLiteral assembly.
      const result = sanitizeCaptureContext({
        network: { online: false, rtt: NaN, downlink: -1, effectiveType: "" },
      });
      expect(result?.network).toEqual({
        online: false,
        rtt: undefined,
        downlink: undefined,
        effectiveType: undefined,
        saveData: undefined,
      });
    });

    it("drops the snapshot when every network field is invalid", () => {
      const result = sanitizeCaptureContext({
        network: {
          online: "yes",
          effectiveType: "",
          rtt: NaN,
          downlink: -1,
          saveData: 1,
        },
      });
      expect(result?.network).toBeUndefined();
    });
  });

  describe("battery snapshot", () => {
    it("drops the snapshot for non-object `battery`", () => {
      for (const battery of ["str", 0, null, [], false]) {
        expect(sanitizeCaptureContext({ battery })?.battery).toBeUndefined();
      }
    });

    it("drops the snapshot when both battery fields are invalid", () => {
      const result = sanitizeCaptureContext({
        battery: { levelPercent: 200, charging: "yes" },
      });
      expect(result?.battery).toBeUndefined();
    });
  });

  describe("weather snapshot", () => {
    it("drops the snapshot for non-object `weather`", () => {
      for (const weather of ["str", 0, null, [], false]) {
        expect(sanitizeCaptureContext({ weather })?.weather).toBeUndefined();
      }
    });

    it("drops the snapshot when source is open-meteo but every other field is invalid", () => {
      // Edge: source is the only literal-valid field, but the
      // `hasContent` check requires at least one non-source field too.
      const result = sanitizeCaptureContext({
        weather: {
          source: "open-meteo",
          temperatureC: NaN,
          weatherCode: -1,
          windSpeedKmh: -1,
          isDay: "yes",
        },
      });
      expect(result?.weather).toBeUndefined();
    });
  });

  describe("experimental snapshot", () => {
    it("drops the snapshot for non-object `experimental`", () => {
      for (const experimental of ["str", 0, null, [], false]) {
        expect(
          sanitizeCaptureContext({ experimental })?.experimental,
        ).toBeUndefined();
      }
    });

    it("keeps the snapshot when ambientLightLux is in range", () => {
      // Smallest-valid case — exercises the ObjectLiteral build and
      // the `some(v => v !== undefined)` true branch.
      const result = sanitizeCaptureContext({
        experimental: { ambientLightLux: 350 },
      });
      expect(result?.experimental).toEqual({ ambientLightLux: 350 });
    });

    it("drops the snapshot when ambientLightLux is invalid", () => {
      const result = sanitizeCaptureContext({
        experimental: { ambientLightLux: -5 },
      });
      expect(result?.experimental).toBeUndefined();
    });
  });

  describe("page metadata", () => {
    it("drops the metadata for non-object `page`", () => {
      for (const page of ["nope", 0, null, [], false]) {
        expect(sanitizeCaptureContext({ page })?.page).toBeUndefined();
      }
    });

    it("drops the metadata when every page field is invalid", () => {
      const result = sanitizeCaptureContext({
        page: {
          title: "",
          lang: "   ",
          description: 42,
          canonicalUrl: "javascript:alert(1)",
          ogTitle: null,
          ogDescription: undefined,
          ogImage: "data:text/html,",
          author: "",
          publishedTime: "",
        },
      });
      expect(result?.page).toBeUndefined();
    });
  });
});

// Boundary checks for the field-level clamps. Stryker spotted survivors
// around the equality operators and arithmetic — these tests pin the
// inclusive/exclusive semantics of each clamp so a future refactor that
// flipped `<=` to `<` (or the reverse) would surface immediately.
describe("sanitizeCaptureContext boundary semantics", () => {
  it("accepts each VALID_DEVICE_TYPES value through unchanged", () => {
    // Without these the hand-rolled set entries (`"mobile"`,
    // `"tablet"`, `"desktop"`) survive Stryker's StringLiteral mutation
    // — `"mobile"` flipped to `""` would only break a test that
    // actually feeds in `"mobile"`.
    expect(sanitizeCaptureContext({ deviceType: "mobile" })?.deviceType).toBe("mobile");
    expect(sanitizeCaptureContext({ deviceType: "tablet" })?.deviceType).toBe("tablet");
    expect(sanitizeCaptureContext({ deviceType: "desktop" })?.deviceType).toBe("desktop");
  });

  it("clampNumber treats min and max as inclusive endpoints", () => {
    // levelPercent uses [0, 100]. The boundary mutants Stryker fired
    // on the `value < min || value > max` check would survive without
    // a test that pins the inclusive endpoints exactly.
    expect(sanitizeCaptureContext({ battery: { levelPercent: 0 } })?.battery?.levelPercent).toBe(0);
    expect(sanitizeCaptureContext({ battery: { levelPercent: 100 } })?.battery?.levelPercent).toBe(100);
    // Just outside both ends rejects.
    expect(sanitizeCaptureContext({ battery: { levelPercent: -0.0001 } })?.battery).toBeUndefined();
    expect(sanitizeCaptureContext({ battery: { levelPercent: 100.0001 } })?.battery).toBeUndefined();
  });

  it("clampString preserves a string sitting exactly at the budget length", () => {
    // STRING_BUDGETS.medium = 512. Build a string of exactly 512
    // chars. It must come through verbatim — the `<= budget` check
    // is inclusive. A `<` mutant would slice it to 511.
    const exactlyAtBudget = "x".repeat(512);
    const result = sanitizeCaptureContext({ timezone: exactlyAtBudget });
    expect(result?.timezone).toBe(exactlyAtBudget);
    expect(result?.timezone?.length).toBe(512);
  });

  it("languages caps at exactly the maxItems boundary", () => {
    // sanitizeStringArray's `out.length >= maxItems` break — the
    // `>=` mutant would either let one extra through or stop
    // one short. We pin both ends.
    const sixteen = Array.from({ length: 16 }, (_, i) => `lang-${i}`);
    const seventeen = [...sixteen, "lang-16"];
    expect(sanitizeCaptureContext({ languages: sixteen })?.languages).toHaveLength(16);
    expect(sanitizeCaptureContext({ languages: seventeen })?.languages).toHaveLength(16);
  });

  it("languages collapses to undefined when nothing valid survives the filter", () => {
    // Covers the `out.length > 0 ? out : undefined` branch — every
    // candidate is non-string, the array drops.
    const result = sanitizeCaptureContext({ languages: [42, null, undefined, {}] });
    expect(result?.languages).toBeUndefined();
  });

  it("timezoneOffsetMinutes accepts ±14h endpoints exactly", () => {
    // The `-14 * 60` / `14 * 60` arithmetic is what Stryker flipped
    // to `/` and survived — without a test that actually exercises
    // ±840 minutes, the operator never matters. We pin both signed
    // endpoints and just-outside rejection.
    expect(
      sanitizeCaptureContext({ timezoneOffsetMinutes: 14 * 60 })?.timezoneOffsetMinutes,
    ).toBe(14 * 60);
    expect(
      sanitizeCaptureContext({ timezoneOffsetMinutes: -14 * 60 })?.timezoneOffsetMinutes,
    ).toBe(-14 * 60);
    expect(
      sanitizeCaptureContext({ timezoneOffsetMinutes: 14 * 60 + 1 })?.timezoneOffsetMinutes,
    ).toBeUndefined();
  });

  it("forwards `os`, `browser`, and `locale` straight through when valid", () => {
    // Without these the `if (locale !== undefined)` /
    // `if (os !== undefined)` / `if (browser !== undefined)` field
    // assignments survive Stryker's `→ "false"` flip — the rest of
    // the suite never asserts on these specific output fields.
    const result = sanitizeCaptureContext({
      locale: "en-GB",
      os: "macOS",
      browser: "Safari",
    });
    expect(result?.locale).toBe("en-GB");
    expect(result?.os).toBe("macOS");
    expect(result?.browser).toBe("Safari");
  });

  it("timeOnPageMs accepts the full 30-day budget but rejects beyond it", () => {
    // Mirrors the timezone test for the `30 * 24 * 3600 * 1000`
    // arithmetic — same operator-flip survivor pattern.
    const thirtyDays = 30 * 24 * 3600 * 1000;
    expect(
      sanitizeCaptureContext({ timeOnPageMs: thirtyDays })?.timeOnPageMs,
    ).toBe(thirtyDays);
    expect(
      sanitizeCaptureContext({ timeOnPageMs: thirtyDays + 1 })?.timeOnPageMs,
    ).toBeUndefined();
  });
});
