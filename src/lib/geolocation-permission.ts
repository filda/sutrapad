/**
 * Read-only probe of the browser's geolocation permission state.
 *
 * Used by the in-app consent flow: when the user clicks "Allow" on
 * the consent card we want to know whether `getCurrentPosition` is
 * about to silently fail because the user previously denied location
 * for this origin in the browser's site settings. Without this probe
 * we'd fire `getCurrentPosition`, get an instant "permission denied"
 * error callback, and the user — who just clicked "Allow" — would
 * see the consent card silently disappear and nothing happen.
 *
 * Three concrete states map straight from the Permissions API:
 *
 *   - `"granted"` — the user has already allowed location for this
 *                 origin. `getCurrentPosition` will resolve without a
 *                 prompt (subject to the browser's accuracy / battery
 *                 cooldown).
 *   - `"denied"`  — the user has actively blocked location. The site
 *                 settings panel is the only way to undo this; calling
 *                 `getCurrentPosition` will reject immediately.
 *   - `"prompt"`  — the user hasn't been asked yet by the browser.
 *                 `getCurrentPosition` will surface the native prompt.
 *
 * A fourth `null` return covers feature detection: the Permissions
 * API itself is not universally available (older Safari builds,
 * locked-down WebViews), and even where it ships the `"geolocation"`
 * descriptor occasionally throws (`TypeError` on some Firefox
 * configs). Callers treat `null` as "I can't tell" and fall back to
 * trying `getCurrentPosition` and observing the error — same as the
 * pre-consent-card behaviour.
 */

export type GeolocationPermissionState =
  | "granted"
  | "denied"
  | "prompt"
  | null;

interface PermissionsApiLike {
  query: (descriptor: { name: PermissionName }) => Promise<{
    state: PermissionState;
  }>;
}

interface NavigatorWithPermissions {
  permissions?: PermissionsApiLike;
}

/**
 * Reads the current geolocation permission state via the Permissions
 * API. Returns `null` when the API isn't usable on this device —
 * never throws, so the caller doesn't need a try/catch around it.
 *
 * The `navigatorLike` parameter exists for tests; production callers
 * leave it absent so the real `navigator` is used.
 */
export async function resolveGeolocationPermissionState(
  navigatorLike: NavigatorWithPermissions = navigator,
): Promise<GeolocationPermissionState> {
  const permissions = navigatorLike.permissions;
  // Stryker disable next-line ConditionalExpression: the `typeof query !==
  // "function"` half is an equivalent mutant — when `permissions.query`
  // is missing or non-callable, both the early return and the catch
  // path below produce `null`, so no test can observe the difference.
  // The guard stays for readability / clarity even though Stryker
  // can't kill its mutants.
  if (!permissions || typeof permissions.query !== "function") {
    return null;
  }

  try {
    const status = await permissions.query({ name: "geolocation" });
    // The Permissions API spec ties the state values to the three
    // strings above. A future spec extension that introduced a fourth
    // value would surface here as a TypeScript narrowing miss — we
    // explicitly pass through whatever string the browser returns to
    // keep the probe from lying, and re-cast through `unknown` so the
    // narrow stays honest.
    return status.state as GeolocationPermissionState;
  } catch {
    // `permissions.query({ name: "geolocation" })` rejects on
    // browsers that ship Permissions API but refuse the geolocation
    // descriptor (older Firefox, some embedded WebViews). Treat the
    // same as "API not available" — the caller will fall back to
    // calling `getCurrentPosition` directly.
    return null;
  }
}
