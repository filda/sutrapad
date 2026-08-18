// @vitest-environment happy-dom
//
// `createBrowserFocusRefreshEnvironment` is the thin adapter between the
// coordinator and the real globals. The coordinator suite deliberately runs
// DOM-free against an injected fake, which left this factory unexercised —
// including the two event names it subscribes to and the unsubscribers it
// returns. Those are exactly the things a typo breaks silently: the app would
// simply never refresh on tab-focus again.

import { describe, expect, it, vi } from "vitest";
import { createBrowserFocusRefreshEnvironment } from "../src/app/lifecycle/focus-refresh";

describe("createBrowserFocusRefreshEnvironment", () => {
  it("subscribes to document visibilitychange and stops on unsubscribe", () => {
    const env = createBrowserFocusRefreshEnvironment();
    const listener = vi.fn();
    const unsubscribe = env.onVisibilityChange(listener);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("subscribes to window pageshow and stops on unsubscribe", () => {
    // The bfcache path on mobile Safari — restored pages fire pageshow
    // without a visibilitychange.
    const env = createBrowserFocusRefreshEnvironment();
    const listener = vi.fn();
    const unsubscribe = env.onPageShow(listener);

    window.dispatchEvent(new Event("pageshow"));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new Event("pageshow"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the two subscriptions independent", () => {
    const env = createBrowserFocusRefreshEnvironment();
    const onVisibility = vi.fn();
    const onPageShow = vi.fn();
    env.onVisibilityChange(onVisibility);
    env.onPageShow(onPageShow);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(onVisibility).toHaveBeenCalledTimes(1);
    expect(onPageShow).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pageshow"));
    expect(onPageShow).toHaveBeenCalledTimes(1);
    expect(onVisibility).toHaveBeenCalledTimes(1);
  });

  it("reads the live visibility state and a real clock", () => {
    const env = createBrowserFocusRefreshEnvironment();
    expect(["visible", "hidden", "prerender", "unloaded"]).toContain(
      env.getVisibilityState(),
    );
    const before = Date.now();
    const reading = env.now();
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(Date.now());
  });
});
