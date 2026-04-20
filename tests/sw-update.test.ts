import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserUpdateEnvironment,
  createUpdateCoordinator,
  DEFAULT_UPDATE_INTERVAL_MS,
  type UpdateCoordinatorEnvironment,
  type VisibilityStateLike,
} from "../src/app/session/sw-update";

interface FakeEnvironment extends UpdateCoordinatorEnvironment {
  triggerInterval: () => void;
  triggerVisibilityChange: (state: VisibilityStateLike) => void;
  setOnline: (online: boolean) => void;
  readonly scheduledIntervalMs: () => number | undefined;
  readonly isClearCalled: () => boolean;
  readonly isVisibilityUnsubscribed: () => boolean;
}

function buildFakeEnvironment(initialState: VisibilityStateLike = "visible"): FakeEnvironment {
  let intervalCallback: (() => void) | null = null;
  let scheduledMs: number | undefined;
  let intervalCleared = false;

  let visibilityListener: (() => void) | null = null;
  let visibilityUnsubscribed = false;
  let visibilityState: VisibilityStateLike = initialState;

  let online = true;

  const env: FakeEnvironment = {
    setInterval: (callback, ms) => {
      intervalCallback = callback;
      scheduledMs = ms;
      return Symbol("interval");
    },
    clearInterval: () => {
      intervalCleared = true;
    },
    onVisibilityChange: (listener) => {
      visibilityListener = listener;
      return () => {
        visibilityUnsubscribed = true;
      };
    },
    getVisibilityState: () => visibilityState,
    isOnline: () => online,
    triggerInterval: () => {
      intervalCallback?.();
    },
    triggerVisibilityChange: (state) => {
      visibilityState = state;
      visibilityListener?.();
    },
    setOnline: (value) => {
      online = value;
    },
    scheduledIntervalMs: () => scheduledMs,
    isClearCalled: () => intervalCleared,
    isVisibilityUnsubscribed: () => visibilityUnsubscribed,
  };

  return env;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createUpdateCoordinator", () => {
  it("schedules periodic update checks at the configured interval", () => {
    const env = buildFakeEnvironment();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    createUpdateCoordinator({ checkForUpdate, intervalMs: 1000, environment: env });

    expect(env.scheduledIntervalMs()).toBe(1000);
  });

  it("defaults the interval to one hour when no intervalMs is provided", () => {
    const env = buildFakeEnvironment();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    createUpdateCoordinator({ checkForUpdate, environment: env });

    expect(env.scheduledIntervalMs()).toBe(DEFAULT_UPDATE_INTERVAL_MS);
  });

  it("runs a check when the interval fires", async () => {
    const env = buildFakeEnvironment();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    createUpdateCoordinator({ checkForUpdate, intervalMs: 1000, environment: env });

    env.triggerInterval();
    await Promise.resolve();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("runs a check when the tab becomes visible", async () => {
    const env = buildFakeEnvironment("hidden");
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    createUpdateCoordinator({ checkForUpdate, intervalMs: 1000, environment: env });
    env.triggerVisibilityChange("visible");
    await Promise.resolve();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not run a check when the tab becomes hidden", async () => {
    const env = buildFakeEnvironment("visible");
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    createUpdateCoordinator({ checkForUpdate, intervalMs: 1000, environment: env });
    env.triggerVisibilityChange("hidden");
    await Promise.resolve();

    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("skips checks when offline", async () => {
    const env = buildFakeEnvironment();
    env.setOnline(false);
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    createUpdateCoordinator({ checkForUpdate, intervalMs: 1000, environment: env });
    env.triggerInterval();
    await Promise.resolve();

    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("forwards errors from checkForUpdate to onCheckError instead of throwing", async () => {
    const env = buildFakeEnvironment();
    const failure = new Error("network down");
    const checkForUpdate = vi.fn().mockRejectedValue(failure);
    const onCheckError = vi.fn();

    const handle = createUpdateCoordinator({
      checkForUpdate,
      intervalMs: 1000,
      environment: env,
      onCheckError,
    });

    await expect(handle.check()).resolves.toBeUndefined();
    expect(onCheckError).toHaveBeenCalledWith(failure);
  });

  it("stop() cancels the interval and unsubscribes the visibility listener", () => {
    const env = buildFakeEnvironment();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    const handle = createUpdateCoordinator({
      checkForUpdate,
      intervalMs: 1000,
      environment: env,
    });

    handle.stop();

    expect(env.isClearCalled()).toBe(true);
    expect(env.isVisibilityUnsubscribed()).toBe(true);
  });

  it("does not run checks after stop() even if the fake interval keeps firing", async () => {
    const env = buildFakeEnvironment();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    const handle = createUpdateCoordinator({
      checkForUpdate,
      intervalMs: 1000,
      environment: env,
    });

    handle.stop();
    env.triggerInterval();
    await Promise.resolve();

    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("manual check() runs the underlying check and awaits its resolution", async () => {
    const env = buildFakeEnvironment();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);

    const handle = createUpdateCoordinator({
      checkForUpdate,
      intervalMs: 1000,
      environment: env,
    });

    await handle.check();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("createBrowserUpdateEnvironment", () => {
  it("wires interval helpers to window and only clears numeric handles", () => {
    const setIntervalSpy = vi.fn().mockReturnValue(123);
    const clearIntervalSpy = vi.fn();
    vi.stubGlobal("window", {
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
    });

    const environment = createBrowserUpdateEnvironment();
    const callback = vi.fn();
    const handle = environment.setInterval(callback, 2500);

    expect(setIntervalSpy).toHaveBeenCalledWith(callback, 2500);
    expect(handle).toBe(123);

    environment.clearInterval(handle);
    environment.clearInterval(Symbol("ignored"));

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
  });

  it("subscribes and unsubscribes visibility listeners through document", () => {
    const addEventListenerSpy = vi.fn();
    const removeEventListenerSpy = vi.fn();
    vi.stubGlobal("document", {
      addEventListener: addEventListenerSpy,
      removeEventListener: removeEventListenerSpy,
      visibilityState: "hidden",
    });
    const environment = createBrowserUpdateEnvironment();
    const listener = vi.fn();

    const unsubscribe = environment.onVisibilityChange(listener);

    expect(addEventListenerSpy).toHaveBeenCalledWith("visibilitychange", listener);

    unsubscribe();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("visibilitychange", listener);
  });

  it("reads the current document visibility state", () => {
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: "prerender",
    });
    const environment = createBrowserUpdateEnvironment();

    expect(environment.getVisibilityState()).toBe("prerender");
  });

  it("treats navigator.onLine=false as offline and other states as online", () => {
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      visibilityState: "visible",
    });
    vi.stubGlobal("window", {
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    });
    const environment = createBrowserUpdateEnvironment();
    vi.stubGlobal("navigator", { onLine: false });
    expect(environment.isOnline()).toBe(false);

    vi.stubGlobal("navigator", { onLine: true });
    expect(environment.isOnline()).toBe(true);
  });
});
