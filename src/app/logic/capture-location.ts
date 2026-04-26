/**
 * Capture-location preference. Controls whether `+ Add` (and other
 * "fresh note" creation paths) calls `navigator.geolocation.getCurrentPosition`
 * on the user's behalf.
 *
 * **Default is `"off"`** — the geolocation prompt should never appear
 * unless the user has explicitly opted in via Settings. The previous
 * behaviour fired the prompt the first time the user clicked `+ Add`,
 * which most users read as "why is the app asking for my location?"
 * with no surrounding context.
 *
 * This preference is device-local (lives in `localStorage` only, no
 * URL sync, no Drive sync). Users sharing a workspace across devices
 * pick the toggle on each device individually — same shape as the
 * persona / theme preferences.
 *
 * Scope note: this gate only affects *fresh-note* creation. Notes that
 * already carry a `location` keep it on subsequent renders, and the
 * silent-capture / URL-capture flows (driven from the bookmarklet) are
 * intentionally NOT gated — the user has already opted into that
 * pipeline by installing the bookmarklet. If we later want to gate
 * those flows too, this preference is the obvious lever.
 */
export type CaptureLocationPreference = "on" | "off";

/**
 * Default preference on first run. Off keeps the geolocation prompt
 * away from cold-start users who have no idea why it's appearing.
 */
export const DEFAULT_CAPTURE_LOCATION_PREFERENCE: CaptureLocationPreference =
  "off";

const STORAGE_KEY = "sutrapad-capture-location-enabled";

const ALL_PREFERENCES: ReadonlySet<CaptureLocationPreference> =
  new Set<CaptureLocationPreference>(["on", "off"]);

export function isCaptureLocationPreference(
  value: unknown,
): value is CaptureLocationPreference {
  // `Set.has` returns false for any non-string value (null, numbers, objects)
  // so no separate `typeof value === "string"` guard is needed.
  return ALL_PREFERENCES.has(value as CaptureLocationPreference);
}

export function loadStoredCaptureLocationPreference(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): CaptureLocationPreference | null {
  const raw = storage.getItem(STORAGE_KEY);
  return isCaptureLocationPreference(raw) ? raw : null;
}

export function persistCaptureLocationPreference(
  preference: CaptureLocationPreference,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, preference);
}

/**
 * Resolves the initial preference from local storage, falling back to
 * the default when nothing is stored or the stored value is no longer
 * valid (e.g. an old `"true"` literal from a previous shape).
 */
export function resolveInitialCaptureLocationPreference(
  storage?: Pick<Storage, "getItem">,
): CaptureLocationPreference {
  return (
    loadStoredCaptureLocationPreference(storage) ??
    DEFAULT_CAPTURE_LOCATION_PREFERENCE
  );
}

/**
 * Convenience boolean for code paths that only care whether location
 * capture should fire. Keeps call sites readable without re-remembering
 * the string literal.
 */
export function isLocationCaptureEnabled(
  preference: CaptureLocationPreference,
): boolean {
  return preference === "on";
}
