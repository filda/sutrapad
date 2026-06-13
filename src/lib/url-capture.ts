import type { SutraPadCaptureContext } from "../types";
import { sanitizeCaptureContext } from "./capture-context-sanitize";
import { safeFetch } from "./safe-fetch";
import { httpUrlOrNull } from "./safe-url";

export interface UrlCapturePayload {
  title?: string;
  url: string;
  captureContext?: Partial<SutraPadCaptureContext>;
}

export interface NoteCapturePayload {
  note: string;
}

/**
 * Length caps for the raw capture query params — the bookmarklet's
 * non-JSON attack surface (the `?capture=` JSON is clamped separately in
 * `capture-context-sanitize.ts`). The bookmarklet runs on a third-party
 * page, so a crafted `?title=` / `?note=` / `?selection=` could be
 * megabytes; clamping keeps a single capture from blowing the localStorage
 * / Drive-upload budget. URLs cap at the same 2048 the captureContext
 * sanitiser uses; free text caps at a generous ceiling that still holds any
 * realistic quote. `CAPTURE_TEXT_MAX` is shared with the selection reader
 * in `silent-capture.ts`.
 */
const CAPTURE_URL_MAX = 2048;
const CAPTURE_TITLE_MAX = 512;
export const CAPTURE_TEXT_MAX = 100_000;

function clampLength(value: string, max: number): string {
  // `slice` already returns the whole string when it's within budget, so no
  // length guard is needed — the conditional form just adds an equivalent
  // mutant with no behavioural difference.
  return value.slice(0, max);
}

export function readUrlCapture(urlString: string): UrlCapturePayload | null {
  const currentUrl = new URL(urlString);
  const capturedUrl = currentUrl.searchParams.get("url");

  // Scheme-gate + normalise the captured URL. `?url=` is attacker-
  // controllable (the bookmarklet runs on a third-party page), so
  // `javascript:` / `data:` / `blob:` / malformed values must never become
  // a note's URL — drop the whole capture instead. The length cap stops a
  // multi-KB URL from bloating the stored note. `httpUrlOrNull` also handles
  // the absent param (`null`) and empty string, returning null for both.
  const normalizedUrl = httpUrlOrNull(capturedUrl);
  if (normalizedUrl === null || normalizedUrl.length > CAPTURE_URL_MAX) {
    return null;
  }

  const rawTitle = currentUrl.searchParams.get("title")?.trim();
  const title = rawTitle ? clampLength(rawTitle, CAPTURE_TITLE_MAX) : undefined;
  const serializedCaptureContext = currentUrl.searchParams.get("capture");
  return {
    title,
    url: normalizedUrl,
    captureContext: parseCaptureContext(serializedCaptureContext),
  };
}

function parseCaptureContext(
  serializedCaptureContext: string | null,
): Partial<SutraPadCaptureContext> | undefined {
  if (!serializedCaptureContext) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedCaptureContext);
  } catch {
    return undefined;
  }

  // The `?capture=` payload is fully attacker-controllable (the
  // bookmarklet runs on a third-party page). Funnel everything through
  // the sanitiser so unknown keys, oversized strings, non-finite
  // numbers, and `javascript:` URLs never reach `note.captureContext`.
  return sanitizeCaptureContext(parsed);
}

export function readNoteCapture(urlString: string): NoteCapturePayload | null {
  const currentUrl = new URL(urlString);
  const note = currentUrl.searchParams.get("note")?.trim();

  if (!note) {
    return null;
  }

  return { note: clampLength(note, CAPTURE_TEXT_MAX) };
}

export function clearCaptureParamsFromLocation(urlString: string): string {
  const currentUrl = new URL(urlString);
  currentUrl.searchParams.delete("url");
  currentUrl.searchParams.delete("title");
  currentUrl.searchParams.delete("note");
  return currentUrl.toString();
}

export function deriveTitleFromUrl(urlString: string): string {
  const url = new URL(urlString);
  const host = url.hostname.replace(/^www\./u, "");
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const lastSegment = pathSegments.at(-1);

  if (!lastSegment) {
    return host;
  }

  const decodedSegment = decodeURIComponent(lastSegment)
    .replaceAll(/[-_]+/gu, " ")
    .replace(/\.[a-z0-9]+$/iu, "")
    .trim();

  return decodedSegment ? `${decodedSegment} · ${host}` : host;
}

export function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/iu);
  if (!match) {
    return null;
  }

  const normalized = match[1]
    .replaceAll(/\s+/gu, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();

  return normalized || null;
}

export function extractHtmlLang(html: string): string | null {
  const match = html.match(/<html[^>]*\blang=["']?([^"'\s>]+)["']?[^>]*>/iu);
  const lang = match?.[1]?.trim();
  return lang || null;
}

export async function resolveTitleFromUrl(urlString: string): Promise<string | null> {
  try {
    const response = await safeFetch(urlString);
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return extractHtmlTitle(html);
  } catch {
    return null;
  }
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

interface NominatimReverseResponse {
  address?: Record<string, string | undefined>;
}

const NOMINATIM_CACHE_KEY = "sutrapad-nominatim-cache";

export function getDaypart(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const time = hours + minutes / 60;

  if (time < 1) {
    return "midnight";
  }
  if (time < 4.5) {
    return "late night";
  }
  if (time < 7) {
    return "early morning";
  }
  if (time < 11.5) {
    return "morning";
  }
  if (time < 12.5) {
    return "high noon";
  }
  if (time < 15) {
    return "afternoon";
  }
  if (time < 18) {
    return "late afternoon";
  }
  if (time < 21) {
    return "evening";
  }
  if (time < 23) {
    return "late evening";
  }

  return "night";
}

export function formatCoordinates(coordinates: Coordinates): string {
  return `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`;
}

export function buildNoteCaptureTitle(date: Date, place?: string): string {
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);

  const parts = [formattedDate, getDaypart(date)];
  if (place) {
    parts.push(place);
  }

  return parts.join(" · ");
}

function getCoordinatesCacheKey(coordinates: Coordinates): string {
  return `${coordinates.latitude.toFixed(3)},${coordinates.longitude.toFixed(3)}`;
}

function loadNominatimCache(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(NOMINATIM_CACHE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveNominatimCache(cache: Record<string, string>): void {
  window.localStorage.setItem(NOMINATIM_CACHE_KEY, JSON.stringify(cache));
}

export function derivePlaceLabel(address?: Record<string, string | undefined>): string | null {
  if (!address) {
    return null;
  }

  const candidates = [
    address.suburb,
    address.city_district,
    address.borough,
    address.neighbourhood,
    address.quarter,
    address.hamlet,
    address.village,
    address.town,
    address.city,
    address.county,
    address.state,
    address.country,
  ];

  for (const candidate of candidates) {
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

export function resolveCurrentCoordinates(): Promise<Coordinates | null> {
  if (!("geolocation" in navigator)) {
    return Promise.resolve(null);
  }

  return new Promise<Coordinates | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60000,
      },
    );
  });
}

export async function reverseGeocodeCoordinates(
  coordinates: Coordinates,
): Promise<string | null> {
  const cacheKey = getCoordinatesCacheKey(coordinates);
  const cache = loadNominatimCache();
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  try {
    const response = await safeFetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1&lat=${coordinates.latitude}&lon=${coordinates.longitude}`,
      {
        headers: {
          "Accept-Language": navigator.languages?.join(",") || navigator.language || "en",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as NominatimReverseResponse;
    const label = derivePlaceLabel(payload.address);
    if (!label) {
      return null;
    }

    cache[cacheKey] = label;
    saveNominatimCache(cache);
    return label;
  } catch {
    return null;
  }
}
