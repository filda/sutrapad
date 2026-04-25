/**
 * Bounded `fetch` wrapper for external (untrusted) endpoints.
 *
 * Without a timeout, every external call in the app is a hang risk: a
 * slow page that the bookmarklet captures (`resolveTitleFromUrl`), a
 * Nominatim outage (`reverseGeocodeCoordinates`), or a stalled
 * allorigins proxy (og-image resolver) can leave the browser waiting
 * forever. The user-visible symptoms range from "the new note has no
 * title" (recoverable) to "the silent-capture splash never resolves"
 * (the bookmarklet just sits there).
 *
 * `safeFetch` adds two things on top of plain `fetch`:
 *
 *   1. A timeout enforced via `AbortController.abort()`. The default
 *      6 s is forgiving enough for a slow geocoder hop while staying
 *      well under the user's patience window.
 *   2. Caller-supplied `AbortSignal` chaining. If the caller already
 *      has its own abort signal (e.g. a per-page mount lifecycle), we
 *      respect it: aborting either source aborts the request.
 *
 * On timeout the promise rejects with the standard `AbortError`
 * (matching what `fetch` itself does when an external signal aborts),
 * so existing `catch` blocks that fall back to `null` keep working
 * without code changes.
 *
 * Drive / Google API calls deliberately bypass this helper — they
 * have their own auth-retry layer (`withAuthRetry`) and run against
 * trusted, latency-bounded endpoints. Only third-party / open
 * endpoints route through here.
 */

export interface SafeFetchOptions extends RequestInit {
  /**
   * Hard cap on the total request lifetime. Past this many milliseconds
   * the underlying `fetch` is aborted and the returned promise rejects.
   * Defaults to 6_000 ms — see helper-level comment for the rationale.
   */
  timeoutMs?: number;
}

export const DEFAULT_SAFE_FETCH_TIMEOUT_MS = 6_000;

/**
 * Like `fetch` but with a default timeout and signal chaining.
 *
 * Implementation detail — we don't reach for `AbortSignal.timeout()` /
 * `AbortSignal.any()` even though both ship in our supported browsers
 * (per `project_sutrapad_browser_support`): keeping a single
 * `AbortController` we own makes injection in tests trivial (a fake
 * `fetchImpl` can read `init.signal?.aborted` directly) and avoids a
 * subtle "the timeout signal aborted but my external signal didn't"
 * shape mismatch on the rejection reason.
 */
export async function safeFetch(
  input: RequestInfo | URL,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_SAFE_FETCH_TIMEOUT_MS, signal: externalSignal, ...rest } =
    options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Respect a caller-supplied signal if given. We don't use
  // `AbortSignal.any()` because tests sometimes pass plain mock
  // objects; a manual relay keeps the contract obvious.
  const onExternalAbort = (): void => controller.abort();
  // `listenerAdded` tracks whether we actually attached a listener
  // (we skip the attach when the external signal is already aborted —
  // there's nothing to wait for) so the finally block matches the
  // attach exactly. Without this flag the cleanup would call
  // `removeEventListener` on signals where we never added one — a
  // no-op today, but semantically misleading and a maintenance trap.
  let listenerAdded = false;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      listenerAdded = true;
    }
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (listenerAdded && externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}
