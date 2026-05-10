/**
 * Cross-device refresh coordinator.
 *
 * Listens for "the tab just became visible / restored from bfcache"
 * and triggers a progressive workspace refresh. Without this, opening
 * SutraPad on a second device after a capture on the first leaves the
 * stale workspace on screen — count, list, body — until the user
 * reloads the page or hits Load manually.
 *
 * Modeled on `sw-update.ts`'s update coordinator: DOM-free at
 * construction time, takes an injected environment so tests can drive
 * the visibility / pageshow events without a real document. The
 * actual fetch is handed in as a callback so the coordinator stays
 * decoupled from `workspace-io`'s Drive bindings.
 *
 * Three guards keep the refresh from misfiring:
 *
 *   - **min-interval throttle.** Flipping between tabs hits
 *     `visibilitychange` and `pageshow` in rapid succession; we drop
 *     anything inside the throttle window. Default 15 s — short
 *     enough that "I was away for a minute" still refreshes, long
 *     enough that a tab-switch storm doesn't fan out to N parallel
 *     Drive batches.
 *   - **caller-supplied `canRefresh` gate.** Currently it covers
 *     "signed in" + "no save in flight" + "no autosave timer
 *     pending"; the coordinator only knows the gate is a boolean, so
 *     the wiring site can extend it without touching this file.
 *   - **in-flight de-duplication.** A second trigger that fires while
 *     a refresh is still in progress is a no-op — the refresh already
 *     reads the latest state on every merge and any captured change
 *     since the trigger will land in this run anyway.
 */

export type VisibilityStateLike = "visible" | "hidden" | "prerender" | "unloaded";

export interface FocusRefreshEnvironment {
  /**
   * Subscribes to `document.visibilitychange`. Returns the
   * unsubscribe function so the coordinator can tear listeners down
   * cleanly on HMR.
   */
  onVisibilityChange: (listener: () => void) => () => void;
  /**
   * Subscribes to `window.pageshow`. Mobile Safari restores the page
   * from bfcache without firing `visibilitychange`; `pageshow` is the
   * companion event we have to listen to for that path.
   */
  onPageShow: (listener: () => void) => () => void;
  /** Reads the current visibility state. */
  getVisibilityState: () => VisibilityStateLike;
  /**
   * Monotonic-ish "now" reading used by the min-interval throttle.
   * Defaults to `Date.now()` in the browser env; tests inject a fake
   * to drive the throttle deterministically.
   */
  now: () => number;
}

export interface FocusRefreshCoordinatorOptions {
  /** Runs the actual progressive refresh. */
  refresh: () => Promise<void>;
  /**
   * Gate consulted before every trigger. Returning `false` skips the
   * run entirely (no timestamp update, so the next visibility event
   * will try again — that's how the "I just signed in" wait-for-it
   * case becomes immediately responsive once the predicate flips
   * true).
   */
  canRefresh: () => boolean;
  environment: FocusRefreshEnvironment;
  /** Throttle window in milliseconds. Default 15 000. */
  minIntervalMs?: number;
  /**
   * Logging hook for refresh errors. The coordinator already swallows
   * the rejection so a transient Drive failure doesn't crash the
   * app; the hook lets tests + devtools see what happened.
   */
  onError?: (error: unknown) => void;
}

export interface FocusRefreshCoordinatorHandle {
  /**
   * Force a refresh attempt now, bypassing the visibility-state read
   * but still honouring the gate, throttle, and in-flight guard.
   * Used by tests and any future manual "refresh" affordance.
   */
  trigger: () => Promise<void>;
  /** Tear down both event subscriptions. */
  stop: () => void;
}

const DEFAULT_MIN_INTERVAL_MS = 15 * 1000;

export function createFocusRefreshCoordinator(
  options: FocusRefreshCoordinatorOptions,
): FocusRefreshCoordinatorHandle {
  const { refresh, canRefresh, environment, onError } = options;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;

  let lastRunAt = -Infinity;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const tryRun = async (): Promise<void> => {
    if (stopped) return;
    if (inFlight) return inFlight;
    if (!canRefresh()) return;
    const nowMs = environment.now();
    if (nowMs - lastRunAt < minIntervalMs) return;
    // Stamp the last-run time *before* the await so a re-entrant
    // trigger inside the same tick honours the throttle. The gate +
    // in-flight check above keep concurrent refreshes from stacking
    // even without this, but the timestamp is what makes the next
    // round honour the window.
    lastRunAt = nowMs;
    const run = (async () => {
      try {
        await refresh();
      } catch (error) {
        onError?.(error);
      }
    })();
    inFlight = run;
    try {
      await run;
    } finally {
      inFlight = null;
    }
  };

  const onVisible = (): void => {
    if (environment.getVisibilityState() === "visible") {
      void tryRun();
    }
  };

  const unsubscribeVisibility = environment.onVisibilityChange(onVisible);
  const unsubscribePageShow = environment.onPageShow(onVisible);

  return {
    trigger: tryRun,
    stop: () => {
      if (stopped) return;
      stopped = true;
      unsubscribeVisibility();
      unsubscribePageShow();
    },
  };
}

/**
 * Builds a `FocusRefreshEnvironment` against the browser globals.
 * Kept separate from the coordinator so tests don't have to stub
 * `document` / `window`.
 */
export function createBrowserFocusRefreshEnvironment(): FocusRefreshEnvironment {
  return {
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    onPageShow: (listener) => {
      window.addEventListener("pageshow", listener);
      return () => window.removeEventListener("pageshow", listener);
    },
    getVisibilityState: () => document.visibilityState as VisibilityStateLike,
    now: () => Date.now(),
  };
}
