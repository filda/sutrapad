/**
 * Coordinates service-worker update checks.
 *
 * The coordinator is deliberately DOM-free and side-effect-free at construction
 * time. It takes a `checkForUpdate` callback (which wraps
 * `ServiceWorkerRegistration.update()`) and drives it on:
 *   1. a periodic timer (default: 60 minutes), and
 *   2. visibility changes when the tab returns to the foreground.
 *
 * UI is wired through the `onUpdateAvailable` callback; the coordinator itself
 * never touches the DOM, which keeps it testable in a Node/Vitest environment.
 */

export const DEFAULT_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export type VisibilityStateLike = "visible" | "hidden" | "prerender" | "unloaded";

export interface UpdateCoordinatorEnvironment {
  /** Schedules a periodic check. Returns a cancel handle. */
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** Subscribes to visibility changes; returns an unsubscribe function. */
  onVisibilityChange: (listener: () => void) => () => void;
  /** Reads the current visibility state (so the initial check can be skipped when hidden). */
  getVisibilityState: () => VisibilityStateLike;
  /** True when the network is available; used to skip checks when offline. */
  isOnline: () => boolean;
}

export interface UpdateCoordinatorOptions {
  checkForUpdate: () => Promise<void>;
  intervalMs?: number;
  environment: UpdateCoordinatorEnvironment;
  /** Called when a check fails; defaults to a no-op. Kept for tests and logging. */
  onCheckError?: (error: unknown) => void;
}

export interface UpdateCoordinatorHandle {
  /** Manually trigger a check; resolves once the underlying check settles. */
  check: () => Promise<void>;
  /** Cancel timers and visibility listeners. */
  stop: () => void;
}

export function createUpdateCoordinator(options: UpdateCoordinatorOptions): UpdateCoordinatorHandle {
  const { checkForUpdate, environment, onCheckError } = options;
  const intervalMs = options.intervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;

  let stopped = false;

  const runCheck = async (): Promise<void> => {
    if (stopped) return;
    if (!environment.isOnline()) return;
    try {
      await checkForUpdate();
    } catch (error) {
      onCheckError?.(error);
    }
  };

  const intervalHandle = environment.setInterval(() => {
    void runCheck();
  }, intervalMs);

  const unsubscribeVisibility = environment.onVisibilityChange(() => {
    if (environment.getVisibilityState() === "visible") {
      void runCheck();
    }
  });

  return {
    check: runCheck,
    stop: () => {
      if (stopped) return;
      stopped = true;
      environment.clearInterval(intervalHandle);
      unsubscribeVisibility();
    },
  };
}

/**
 * Builds a `UpdateCoordinatorEnvironment` backed by the browser globals.
 * Kept separate from `createUpdateCoordinator` so that tests can construct
 * a coordinator with a fake environment without touching `window`.
 */
export function createBrowserUpdateEnvironment(): UpdateCoordinatorEnvironment {
  return {
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => {
      if (typeof handle === "number") {
        window.clearInterval(handle);
      }
    },
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    getVisibilityState: () => document.visibilityState as VisibilityStateLike,
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  };
}
