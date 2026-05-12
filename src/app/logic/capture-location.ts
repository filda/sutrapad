/**
 * Capture-location consent preference. Controls whether `+ Add` (and
 * other "fresh note" creation paths) calls
 * `navigator.geolocation.getCurrentPosition` on the user's behalf.
 *
 * **Three states** so we can tell "user said no" apart from "user
 * hasn't decided yet":
 *
 *   - `"on"`     — explicit opt-in. The geolocation prompt fires.
 *   - `"off"`    — explicit opt-out. The prompt is suppressed.
 *   - `"unanswered"` — the user hasn't been asked yet. The prompt is
 *                 suppressed and the in-app consent card surfaces on
 *                 the detail view so they can decide. Default for new
 *                 users.
 *
 * The `"unanswered"` state is the default for cold-start users so the
 * native browser prompt never appears unannounced. Cold-start firing
 * was the previous shape's failure mode — most users read it as "why
 * is the app asking for my location?" with no surrounding context.
 *
 * Storage is currently device-local (lives in `localStorage` only). A
 * later phase plans to lift the consent to Drive so it travels with
 * the account; until then each device picks the decision once.
 *
 * Storage key bumped to `…-consent` when the third state landed —
 * pre-tristate values (only `"on"` / `"off"` ever existed) at the old
 * key are intentionally ignored. Same-key migration would conflate a
 * default-persisted `"off"` (subscribe-fires-on-init from the atom
 * default) with an explicit user `"off"`, which is exactly the
 * distinction this rewrite exists to fix.
 *
 * Scope note: this gate affects fresh-note creation *and* the
 * URL-capture / silent-capture flows. Bookmarklet captures with the
 * consent state `"unanswered"` silently skip location capture rather
 * than popping a modal in the capture iframe — the user resolves the
 * decision in the main app the next time they open it.
 */
export type CaptureLocationPreference = "on" | "off" | "unanswered";

/**
 * Default preference on first run. `"unanswered"` keeps the
 * geolocation prompt away from cold-start users (same effect as the
 * previous `"off"` default at the API layer) while letting the
 * consent card surface in the editor so they can opt in deliberately.
 */
export const DEFAULT_CAPTURE_LOCATION_PREFERENCE: CaptureLocationPreference =
  "unanswered";

const STORAGE_KEY = "sutrapad-capture-location-consent";

const ALL_PREFERENCES: ReadonlySet<CaptureLocationPreference> =
  new Set<CaptureLocationPreference>(["on", "off", "unanswered"]);

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
 * valid (e.g. a legacy `"true"` literal from a pre-tristate shape).
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
 * the string literal. Anything other than `"on"` (including
 * `"unanswered"`) suppresses the prompt at the API layer — the consent
 * card is responsible for moving the user out of `"unanswered"`.
 */
export function isLocationCaptureEnabled(
  preference: CaptureLocationPreference,
): boolean {
  return preference === "on";
}

/**
 * True when the in-app consent card should be shown so the user can
 * resolve `"unanswered"` into a definite `"on"` / `"off"`. Both
 * explicit values suppress the card — once the user has answered, the
 * Settings → Privacy toggle is the only surface that mentions the
 * preference.
 */
export function requiresLocationConsent(
  preference: CaptureLocationPreference,
): boolean {
  return preference === "unanswered";
}
