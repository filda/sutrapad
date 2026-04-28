/**
 * Browser-environment detection helpers for the auth flow.
 *
 * Safari and iOS need adapted behavior in the GIS Token Model: their
 * Intelligent Tracking Prevention (ITP) blocks cross-site iframe
 * storage, so the silent-refresh round-trip GIS performs against
 * `accounts.google.com` is more likely to fail than on Chrome /
 * Firefox without ITP. The auth bootstrap and the silent-capture
 * runner both branch on these signals — Safari users get an
 * explanatory note under the Sign-In button instead of seeing a
 * generic loading spinner, and the silent-capture flow stashes the
 * captured URL into `sessionStorage` so a one-tap interactive sign-in
 * can drain the buffer instead of dropping the capture.
 *
 * The utilities are pure functions that read `navigator` /
 * `window.navigator` once per call. They do NOT cache results because
 * the underlying signals (`userAgent`, `standalone`) are fixed for
 * the lifetime of a document — caching would only save a property
 * read while making the helpers harder to test in isolation.
 *
 * Detection notes:
 *  - `isSafari` excludes Chrome/Edge on iOS (which inject "CriOS" /
 *    "EdgiOS" into the UA but still ship WebKit underneath). For the
 *    auth flow the relevant question is "does this engine apply
 *    WebKit ITP", and on iOS that's universally true regardless of
 *    the UA brand. So `isIOS` is the broader signal; `isSafari` is
 *    the narrower one for Mac desktop.
 *  - `isIOS` matches iPhone / iPad / iPod. iPadOS 13+ presents itself
 *    as Mac in the UA — the `maxTouchPoints` heuristic catches that.
 *  - `isStandalone` reads `(navigator as Navigator & { standalone? }).standalone`,
 *    which is iOS Safari's non-standard signal that the page was
 *    launched from a home-screen icon. The standardized
 *    `display-mode: standalone` media query is also valid but harder
 *    to test from pure JS without `matchMedia` plumbing; the
 *    iOS-specific flag is sufficient because `isStandalone` is only
 *    used to gate iOS PWA fast-path behavior.
 */

/**
 * Subset of `Navigator` that exposes the iOS-specific `standalone`
 * boolean. The flag is non-standard, only present on WebKit, and not
 * declared in `lib.dom.d.ts`. Modeling it explicitly here keeps the
 * cast localised to one place instead of leaking `as any` into call
 * sites.
 */
interface NavigatorWithStandalone extends Navigator {
  readonly standalone?: boolean;
}

export function isSafari(userAgent: string = navigator.userAgent): boolean {
  // Safari's UA always carries "Safari" but so do Chrome/Edge/Opera
  // on macOS — they additionally carry their own brand token, which
  // is the cleanest exclusion. Android Chrome also carries "Safari"
  // for compat, hence the explicit `android` exclusion.
  if (/chrome|chromium|edg|opr|fxios|crios|edgios|android/i.test(userAgent)) {
    return false;
  }
  return /safari/i.test(userAgent);
}

export function isIOS(
  userAgent: string = navigator.userAgent,
  maxTouchPoints: number = navigator.maxTouchPoints,
): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  // iPadOS 13+ identifies as Mac. The `Macintosh` UA combined with
  // touch support is the documented heuristic — desktop Macs report
  // `maxTouchPoints === 0`, iPads in desktop-mode report `> 1`.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function isStandalone(
  nav: NavigatorWithStandalone = window.navigator,
): boolean {
  return nav.standalone === true;
}
