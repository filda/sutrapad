/**
 * Sanitiser for the bookmarklet's `?capture=` JSON payload.
 *
 * The bookmarklet serialises a `SutraPadCaptureContext`-shaped object
 * from whatever third-party page the user clicked it on. That input is
 * fully attacker-controllable: a malicious page can return arbitrary
 * shapes, oversized strings (Drive-quota DoS), nonsense numbers
 * (`Infinity`, `NaN`), `javascript:` URLs in `ogImage` (image src
 * fallthrough is benign in modern browsers, but we don't rely on that),
 * or extra keys that pollute the persisted note shape.
 *
 * Defensive contract:
 *   - White-list known keys; drop everything else.
 *   - Type-check each field; coerce with `undefined` on mismatch.
 *   - Clamp string length to a per-field budget (title, description,
 *     URL bands) so a single capture can't exhaust localStorage or the
 *     Drive multipart upload size.
 *   - Reject URLs whose scheme isn't `http(s):` (so `javascript:`,
 *     `data:`, `vbscript:` never make it into `note.captureContext`).
 *   - Clamp numerics to sane physical / human-scale ranges and drop
 *     non-finite values.
 *
 * Pure & DOM-free so it runs in the silent-capture runner before any
 * DOM is touched. Failures degrade silently: the sanitiser returns the
 * fields it could keep, never throws.
 */

import type {
  SutraPadCaptureBatterySnapshot,
  SutraPadCaptureContext,
  SutraPadCaptureExperimentalSnapshot,
  SutraPadCaptureNetworkSnapshot,
  SutraPadCapturePageMetadata,
  SutraPadCaptureScreenSnapshot,
  SutraPadCaptureScrollSnapshot,
  SutraPadCaptureSource,
  SutraPadCaptureWeatherSnapshot,
} from "../types";

/**
 * Per-field length budgets. Tuned to hold every realistic real-world
 * value (a long page title still fits in 512 chars, a meta description
 * comfortably in 1024) while making a megabyte-sized payload from a
 * malicious page impossible.
 */
const STRING_BUDGETS = {
  /** Short identifier-ish strings: locales, language codes, deviceType, os, browser, orientation. */
  short: 64,
  /** Medium strings: timezone names, page titles, og titles, authors, location labels. */
  medium: 512,
  /** Long strings: descriptions, og descriptions. */
  long: 1024,
  /** URL-shaped strings: canonical URLs, og:image, referrer, publishedTime. */
  url: 2048,
} as const;

/** Source values explicitly enumerated by `SutraPadCaptureSource`. */
const VALID_SOURCES: ReadonlySet<string> = new Set<SutraPadCaptureSource>([
  "new-note",
  "text-capture",
  "url-capture",
]);

const VALID_DEVICE_TYPES: ReadonlySet<string> = new Set([
  "mobile",
  "tablet",
  "desktop",
]);

/**
 * Narrows an unknown to one of the enumerated capture-source literals,
 * dropping anything else (wrong type, unknown literal). Hoisted out of
 * `sanitizeCaptureContext` to keep that function under the cyclomatic
 * complexity budget.
 */
function sanitizeSource(value: unknown): SutraPadCaptureSource | undefined {
  if (typeof value !== "string") return undefined;
  if (!VALID_SOURCES.has(value)) return undefined;
  return value as SutraPadCaptureSource;
}

/**
 * Narrows an unknown to a known device-type literal. Same rationale as
 * `sanitizeSource` — keeping the field-by-field assembly in
 * `sanitizeCaptureContext` flat.
 */
function sanitizeDeviceType(
  value: unknown,
): SutraPadCaptureContext["deviceType"] | undefined {
  if (typeof value !== "string") return undefined;
  if (!VALID_DEVICE_TYPES.has(value)) return undefined;
  return value as SutraPadCaptureContext["deviceType"];
}

/**
 * Trims and clamps a candidate to a finite-length string. Returns
 * `undefined` for non-strings, `null`, blanks, and after-trim empties
 * — every consumer in `auto-tags.ts` expects "absent or non-empty".
 */
function clampString(value: unknown, budget: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  // Slice on the original (pre-trim) length isn't right — we want the
  // visual content to be <= budget. Use the trimmed string.
  return trimmed.length <= budget ? trimmed : trimmed.slice(0, budget);
}

/**
 * Like `clampString` but only accepts URLs whose scheme is `http(s):`.
 * Drops everything else — `javascript:`, `data:`, `vbscript:`,
 * malformed input, blank input. The `ogImage` field is the highest-
 * risk consumer because the Links page renders it inside an `<img>`
 * src; modern browsers ignore `javascript:` URLs in image contexts,
 * but this layer doesn't rely on that.
 */
function clampHttpUrl(value: unknown): string | undefined {
  const trimmed = clampString(value, STRING_BUDGETS.url);
  if (trimmed === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return trimmed;
}

/**
 * Numeric guard: returns the value when it's a finite number inside
 * `[min, max]`, otherwise `undefined`. NaN, Infinity, and non-numbers
 * collapse to `undefined`.
 */
function clampNumber(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/**
 * Boolean strict-equality guard. Truthy/falsy coercion is deliberately
 * NOT applied — `true` from a malicious payload that means something
 * else upstream shouldn't sneak in as boolean truth here.
 */
function clampBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeStringArray(
  value: unknown,
  budget: number,
  maxItems: number,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const candidate of value) {
    const clipped = clampString(candidate, budget);
    if (clipped !== undefined) out.push(clipped);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

function sanitizePageMetadata(
  raw: unknown,
): SutraPadCapturePageMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: SutraPadCapturePageMetadata = {
    title: clampString(r.title, STRING_BUDGETS.medium),
    lang: clampString(r.lang, STRING_BUDGETS.short),
    description: clampString(r.description, STRING_BUDGETS.long),
    canonicalUrl: clampHttpUrl(r.canonicalUrl),
    ogTitle: clampString(r.ogTitle, STRING_BUDGETS.medium),
    ogDescription: clampString(r.ogDescription, STRING_BUDGETS.long),
    ogImage: clampHttpUrl(r.ogImage),
    author: clampString(r.author, STRING_BUDGETS.medium),
    publishedTime: clampString(r.publishedTime, STRING_BUDGETS.short),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

function sanitizeScreenSnapshot(
  raw: unknown,
): SutraPadCaptureScreenSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: SutraPadCaptureScreenSnapshot = {
    // Viewport caps at 16k px — well past every real display, blocks
    // gibberish like 1e308 from polluting render maths.
    viewportWidth: clampNumber(r.viewportWidth, 0, 16384),
    viewportHeight: clampNumber(r.viewportHeight, 0, 16384),
    screenWidth: clampNumber(r.screenWidth, 0, 16384),
    screenHeight: clampNumber(r.screenHeight, 0, 16384),
    pixelRatio: clampNumber(r.pixelRatio, 0, 16),
    orientation: clampString(r.orientation, STRING_BUDGETS.short),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

function sanitizeScrollSnapshot(
  raw: unknown,
): SutraPadCaptureScrollSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: SutraPadCaptureScrollSnapshot = {
    // Page scroll positions can run to a few hundred thousand on
    // infinite-scroll feeds; 1e7 is a generous ceiling that still
    // rejects nonsense.
    x: clampNumber(r.x, -1e7, 1e7),
    y: clampNumber(r.y, -1e7, 1e7),
    progress: clampNumber(r.progress, 0, 1),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

function sanitizeNetworkSnapshot(
  raw: unknown,
): SutraPadCaptureNetworkSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: SutraPadCaptureNetworkSnapshot = {
    online: clampBoolean(r.online),
    effectiveType: clampString(r.effectiveType, STRING_BUDGETS.short),
    rtt: clampNumber(r.rtt, 0, 60_000),
    downlink: clampNumber(r.downlink, 0, 1e6),
    saveData: clampBoolean(r.saveData),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

function sanitizeBatterySnapshot(
  raw: unknown,
): SutraPadCaptureBatterySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: SutraPadCaptureBatterySnapshot = {
    levelPercent: clampNumber(r.levelPercent, 0, 100),
    charging: clampBoolean(r.charging),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

function sanitizeWeatherSnapshot(
  raw: unknown,
): SutraPadCaptureWeatherSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  // Source is a literal `"open-meteo"` in the type, but we only carry
  // weather we ourselves fetched from open-meteo. Reject any other
  // value rather than coerce — the field exists for future provenance.
  if (r.source !== "open-meteo") return undefined;
  const result: SutraPadCaptureWeatherSnapshot = {
    temperatureC: clampNumber(r.temperatureC, -100, 100),
    weatherCode: clampNumber(r.weatherCode, 0, 99),
    windSpeedKmh: clampNumber(r.windSpeedKmh, 0, 1000),
    isDay: clampBoolean(r.isDay),
    source: "open-meteo",
  };
  // `source` is always present; drop the snapshot only when no other
  // field carried information.
  const hasContent = Object.entries(result).some(
    ([key, v]) => key !== "source" && v !== undefined,
  );
  return hasContent ? result : undefined;
}

function sanitizeExperimentalSnapshot(
  raw: unknown,
): SutraPadCaptureExperimentalSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const result: SutraPadCaptureExperimentalSnapshot = {
    // Ambient-light sensor reports up to ~120000 lux (direct sunlight);
    // 1e6 is a comfortable ceiling.
    ambientLightLux: clampNumber(r.ambientLightLux, 0, 1_000_000),
  };
  return Object.values(result).some((v) => v !== undefined) ? result : undefined;
}

/**
 * Top-level entry point — sanitise the raw JSON-parsed object from
 * `?capture=` into a `Partial<SutraPadCaptureContext>` containing only
 * trusted, length-clamped, type-checked fields. Returns `undefined`
 * when the input was nothing usable.
 *
 * The `source` field on the full `SutraPadCaptureContext` is filled in
 * by the caller (the silent-capture runner forces it to `url-capture`
 * regardless of payload). We accept and pass through `source` here for
 * completeness — but only when it matches a known literal — so a
 * future pipeline that trusts `payload.captureContext.source` doesn't
 * inherit the validation responsibility.
 */
export function sanitizeCaptureContext(
  raw: unknown,
): Partial<SutraPadCaptureContext> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const result: Partial<SutraPadCaptureContext> = {};

  const source = sanitizeSource(r.source);
  if (source !== undefined) result.source = source;

  const timezone = clampString(r.timezone, STRING_BUDGETS.medium);
  if (timezone !== undefined) result.timezone = timezone;

  // ±14h covers every real timezone offset; padding for historical
  // ones (Pacific/Kiritimati was UTC+14, no historic offset exceeded
  // ±13h).
  const tzOffset = clampNumber(r.timezoneOffsetMinutes, -14 * 60, 14 * 60);
  if (tzOffset !== undefined) result.timezoneOffsetMinutes = tzOffset;

  const locale = clampString(r.locale, STRING_BUDGETS.short);
  if (locale !== undefined) result.locale = locale;

  const languages = sanitizeStringArray(r.languages, STRING_BUDGETS.short, 16);
  if (languages !== undefined) result.languages = languages;

  const referrer = clampHttpUrl(r.referrer);
  if (referrer !== undefined) result.referrer = referrer;

  const deviceType = sanitizeDeviceType(r.deviceType);
  if (deviceType !== undefined) result.deviceType = deviceType;

  const os = clampString(r.os, STRING_BUDGETS.short);
  if (os !== undefined) result.os = os;

  const browser = clampString(r.browser, STRING_BUDGETS.short);
  if (browser !== undefined) result.browser = browser;

  const screen = sanitizeScreenSnapshot(r.screen);
  if (screen !== undefined) result.screen = screen;

  const scroll = sanitizeScrollSnapshot(r.scroll);
  if (scroll !== undefined) result.scroll = scroll;

  // 30 days = an absurdly long single-page session. Beyond that we
  // assume the value is junk.
  const timeOnPageMs = clampNumber(r.timeOnPageMs, 0, 30 * 24 * 3600 * 1000);
  if (timeOnPageMs !== undefined) result.timeOnPageMs = timeOnPageMs;

  const page = sanitizePageMetadata(r.page);
  if (page !== undefined) result.page = page;

  const network = sanitizeNetworkSnapshot(r.network);
  if (network !== undefined) result.network = network;

  const battery = sanitizeBatterySnapshot(r.battery);
  if (battery !== undefined) result.battery = battery;

  const weather = sanitizeWeatherSnapshot(r.weather);
  if (weather !== undefined) result.weather = weather;

  const experimental = sanitizeExperimentalSnapshot(r.experimental);
  if (experimental !== undefined) result.experimental = experimental;

  return Object.keys(result).length > 0 ? result : undefined;
}
