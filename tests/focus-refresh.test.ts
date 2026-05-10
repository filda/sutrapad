import { describe, expect, it, vi } from "vitest";
import {
  createFocusRefreshCoordinator,
  type FocusRefreshEnvironment,
  type VisibilityStateLike,
} from "../src/app/lifecycle/focus-refresh";

interface FakeEnvHandle {
  env: FocusRefreshEnvironment;
  fireVisibility: () => void;
  firePageShow: () => void;
  setVisibility: (state: VisibilityStateLike) => void;
  setNow: (ms: number) => void;
  visibilityListenerCount: () => number;
  pageShowListenerCount: () => number;
}

function fakeEnv(initial: VisibilityStateLike = "visible"): FakeEnvHandle {
  let visibility: VisibilityStateLike = initial;
  let nowMs = 0;
  const visibilityListeners: Array<() => void> = [];
  const pageShowListeners: Array<() => void> = [];
  return {
    env: {
      onVisibilityChange: (listener) => {
        visibilityListeners.push(listener);
        return () => {
          const i = visibilityListeners.indexOf(listener);
          if (i >= 0) visibilityListeners.splice(i, 1);
        };
      },
      onPageShow: (listener) => {
        pageShowListeners.push(listener);
        return () => {
          const i = pageShowListeners.indexOf(listener);
          if (i >= 0) pageShowListeners.splice(i, 1);
        };
      },
      getVisibilityState: () => visibility,
      now: () => nowMs,
    },
    fireVisibility: () => {
      for (const fn of visibilityListeners) fn();
    },
    firePageShow: () => {
      for (const fn of pageShowListeners) fn();
    },
    setVisibility: (state) => {
      visibility = state;
    },
    setNow: (ms) => {
      nowMs = ms;
    },
    visibilityListenerCount: () => visibilityListeners.length,
    pageShowListenerCount: () => pageShowListeners.length,
  };
}

describe("createFocusRefreshCoordinator", () => {
  it("subscribes to visibilitychange and pageshow on construction", async () => {
    const handle = fakeEnv();
    const coordinator = createFocusRefreshCoordinator({
      refresh: async () => undefined,
      canRefresh: () => true,
      environment: handle.env,
    });

    expect(handle.visibilityListenerCount()).toBe(1);
    expect(handle.pageShowListenerCount()).toBe(1);

    coordinator.stop();
    expect(handle.visibilityListenerCount()).toBe(0);
    expect(handle.pageShowListenerCount()).toBe(0);
  });

  it("triggers a refresh when the tab becomes visible", async () => {
    // The headline path: Filip switches tabs back to SutraPad,
    // visibilitychange fires, refresh runs.
    const handle = fakeEnv("hidden");
    const refresh = vi.fn().mockResolvedValue(undefined);
    createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
    });

    // Hidden → fire change. The event listener reads visibility
    // again before deciding; we make it "visible" first.
    handle.setVisibility("visible");
    handle.fireVisibility();
    // The listener kicks off a microtask; flush the queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger when the visibility event fires while still hidden", async () => {
    // visibilitychange fires on both transitions; only the visible
    // direction should refresh.
    const handle = fakeEnv("hidden");
    const refresh = vi.fn().mockResolvedValue(undefined);
    createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
    });

    handle.fireVisibility(); // still "hidden"
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("triggers on pageshow (bfcache restore on mobile Safari)", async () => {
    const handle = fakeEnv("visible");
    const refresh = vi.fn().mockResolvedValue(undefined);
    createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
    });

    handle.firePageShow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("respects the canRefresh gate (skip when sync is saving)", async () => {
    // The gate fires the predicate at every visibility event so a
    // refresh that was blocked once can run as soon as the predicate
    // flips true on the next event.
    let canRefresh = false;
    const handle = fakeEnv("visible");
    const refresh = vi.fn().mockResolvedValue(undefined);
    createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => canRefresh,
      environment: handle.env,
    });

    // Bump the clock past the throttle window before each fire so
    // throttling doesn't suppress the second event.
    handle.setNow(60_000);
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).not.toHaveBeenCalled();

    canRefresh = true;
    handle.setNow(120_000);
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("throttles rapid successive triggers within the min-interval window", async () => {
    // Tab-flicker: visibilitychange + pageshow + visibilitychange in
    // quick succession should NOT fan out three refreshes.
    const handle = fakeEnv("visible");
    const refresh = vi.fn().mockResolvedValue(undefined);
    createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
      minIntervalMs: 15_000,
    });

    handle.setNow(1_000);
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));

    handle.setNow(5_000); // within the 15 s window
    handle.firePageShow();
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalledTimes(1);

    // Outside the window — next event runs.
    handle.setNow(30_000);
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates re-entrant triggers while a refresh is in flight", async () => {
    // The refresh promise hasn't resolved yet when a second event
    // arrives. The second trigger must not spawn a parallel refresh
    // — that would race the same Drive query against itself.
    const handle = fakeEnv("visible");
    const inFlight: { resolve?: () => void } = {};
    const refresh = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          inFlight.resolve = resolve;
        }),
    );
    const coordinator = createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
    });

    // First trigger — starts the in-flight refresh.
    handle.setNow(1_000);
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);

    // Second trigger arrives while the first is still in flight.
    // Even at a clock that's past the throttle window, the
    // in-flight guard wins.
    handle.setNow(60_000);
    void coordinator.trigger();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);

    // Resolve the first; the in-flight slot opens up.
    inFlight.resolve?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    handle.setNow(120_000);
    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("swallows refresh errors and routes them to onError", async () => {
    // A transient Drive failure must not crash the coordinator: the
    // orchestrator already surfaces sync state = "error" + a
    // user-visible message; this hook just makes the failure visible
    // in devtools / tests.
    const handle = fakeEnv("visible");
    const boom = new Error("Drive 503");
    const refresh = vi.fn().mockRejectedValue(boom);
    const onError = vi.fn();
    createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
      onError,
    });

    handle.fireVisibility();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("stop() prevents any further triggers, including via trigger()", async () => {
    const handle = fakeEnv("visible");
    const refresh = vi.fn().mockResolvedValue(undefined);
    const coordinator = createFocusRefreshCoordinator({
      refresh,
      canRefresh: () => true,
      environment: handle.env,
    });

    coordinator.stop();
    handle.fireVisibility();
    handle.firePageShow();
    await coordinator.trigger();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).not.toHaveBeenCalled();
  });
});
