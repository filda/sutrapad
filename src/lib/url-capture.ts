export interface UrlCapturePayload {
  title?: string;
  url: string;
}

export interface NoteCapturePayload {
  note: string;
}

export function readUrlCapture(urlString: string): UrlCapturePayload | null {
  const currentUrl = new URL(urlString);
  const capturedUrl = currentUrl.searchParams.get("url");

  if (!capturedUrl) {
    return null;
  }

  try {
    const normalizedUrl = new URL(capturedUrl).toString();
    const title = currentUrl.searchParams.get("title")?.trim() || undefined;
    return {
      title,
      url: normalizedUrl,
    };
  } catch {
    return null;
  }
}

export function readNoteCapture(urlString: string): NoteCapturePayload | null {
  const currentUrl = new URL(urlString);
  const note = currentUrl.searchParams.get("note")?.trim();

  if (!note) {
    return null;
  }

  return { note };
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
  const host = url.hostname.replace(/^www\./, "");
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const lastSegment = pathSegments.at(-1);

  if (!lastSegment) {
    return host;
  }

  const decodedSegment = decodeURIComponent(lastSegment)
    .replace(/[-_]+/g, " ")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim();

  return decodedSegment ? `${decodedSegment} · ${host}` : host;
}

export function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (!match) {
    return null;
  }

  const normalized = match[1]
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  return normalized || null;
}

export async function resolveTitleFromUrl(urlString: string): Promise<string | null> {
  try {
    const response = await fetch(urlString);
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
  const formattedDate = new Intl.DateTimeFormat("en-GB", {
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

export async function resolveCurrentCoordinates(): Promise<Coordinates | null> {
  if (!("geolocation" in navigator)) {
    return null;
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
    const response = await fetch(
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
