import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleAuthService,
  MAX_IDLE_DAYS_BEFORE_EXPIRY,
  parseUserInfoResponse,
} from "../src/services/google-auth";

function createStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("GoogleAuthService persisted session restore", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();
  });

  it("restores a persisted session without calling the Google profile endpoint again", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "test-token",
        expiresAt,
        profile: {
          name: "Filda",
          email: "panfilda@gmail.com",
          picture: "https://example.com/avatar.png",
        },
      }),
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const auth = new GoogleAuthService();

    await expect(auth.restorePersistedSession()).resolves.toEqual({
      name: "Filda",
      email: "panfilda@gmail.com",
      picture: "https://example.com/avatar.png",
    });

    expect(auth.getAccessToken()).toBe("test-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs but does not throw when revoke fails synchronously", async () => {
    // The Google revoke call can throw synchronously when the GIS
    // script has been monkey-patched (e.g. an old version stuck in
    // the cache). The user-visible signed-out state must still hold.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      localStorage: window.localStorage,
      google: {
        accounts: {
          oauth2: {
            initTokenClient: () => ({ requestAccessToken: () => undefined }),
            revoke: () => {
              throw new Error("revoke broken");
            },
          },
        },
      },
    });
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "broken-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        profile: { name: "X", email: "x@x" },
      }),
    );

    const auth = new GoogleAuthService();
    await auth.restorePersistedSession();
    expect(() => auth.signOut()).not.toThrow();
    expect(auth.getAccessToken()).toBeNull();
    expect(localStorage.getItem("sutrapad-google-auth-session")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "Google token revoke failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("drops expired persisted sessions", async () => {
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "expired-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        profile: {
          name: "Filda",
          email: "panfilda@gmail.com",
        },
      }),
    );

    const auth = new GoogleAuthService();

    await expect(auth.restorePersistedSession()).resolves.toBeNull();
    expect(auth.getAccessToken()).toBeNull();
    expect(localStorage.getItem("sutrapad-google-auth-session")).toBeNull();
  });
});

describe("GoogleAuthService.refreshSession coalescing", () => {
  /**
   * Drive returns 401 → `withAuthRetry` calls `refreshSession`.
   * When three calls fly in parallel (workspace load + autosave +
   * tag index fetch all hitting the stale token in the same tick),
   * we want a single GIS silent-refresh round-trip, not three
   * racing each other.
   *
   * Tests stub Google Identity Services + `fetch` to avoid hitting
   * the real network. The harness lets each test queue a sequence
   * of token-callback responses; `expect(initCalls)` then asserts
   * how many times the underlying GIS round-trip actually ran.
   */

  type TokenCallback = (response: { access_token: string; expires_in: number; scope: string; token_type: string; error?: string }) => void;
  type ErrorCallback = () => void;

  function setupGoogleIdentityHarness(): {
    pendingRequests: Array<{ callback: TokenCallback; errorCallback: ErrorCallback | undefined; prompt: string }>;
    initCalls: { current: number };
  } {
    const pendingRequests: Array<{ callback: TokenCallback; errorCallback: ErrorCallback | undefined; prompt: string }> = [];
    const initCalls = { current: 0 };

    vi.stubGlobal("window", {
      localStorage: createStorageMock(),
      google: {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(
              (config: {
                callback: TokenCallback;
                error_callback?: ErrorCallback;
              }) => {
                initCalls.current += 1;
                return {
                  requestAccessToken: vi.fn((opts: { prompt?: string } = {}) => {
                    pendingRequests.push({
                      callback: config.callback,
                      errorCallback: config.error_callback,
                      prompt: opts.prompt ?? "",
                    });
                  }),
                };
              },
            ),
            revoke: vi.fn((_token: string, done: () => void) => done()),
          },
        },
      },
    });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();

    // Stub fetch (used by fetchUserProfile) so the userinfo round-trip
    // resolves with a valid profile shape.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ name: "Test", email: "t@t", picture: "p" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    // VITE_GOOGLE_CLIENT_ID is read from import.meta.env; stub it.
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "stub-client-id");

    return { pendingRequests, initCalls };
  }

  it("coalesces three concurrent refresh calls into a single GIS round-trip", async () => {
    const { pendingRequests, initCalls } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const initCallsBefore = initCalls.current;

    // Three concurrent callers (e.g. parallel Drive 401s).
    const refreshPromises = [
      service.refreshSession(),
      service.refreshSession(),
      service.refreshSession(),
    ];

    // Microtask flush so all three callers have time to register.
    await Promise.resolve();
    await Promise.resolve();

    // Only one underlying GIS round-trip is in flight.
    expect(pendingRequests).toHaveLength(1);
    expect(initCalls.current - initCallsBefore).toBe(1);

    // Resolve it — all three callers should see the same outcome.
    pendingRequests[0].callback({
      access_token: "fresh",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    const [a, b, c] = await Promise.all(refreshPromises);
    expect(a).toEqual({ name: "Test", email: "t@t", picture: "p" });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("clears the cache after the in-flight refresh settles, allowing a later retry", async () => {
    const { pendingRequests, initCalls } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const initCallsBefore = initCalls.current;

    const first = service.refreshSession();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "first",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await first;

    // A second refresh round (different 401, much later) is a fresh
    // GIS round-trip — the cache must not pin the first attempt's
    // result indefinitely.
    const second = service.refreshSession();
    await Promise.resolve();
    expect(pendingRequests).toHaveLength(2);
    pendingRequests[1].callback({
      access_token: "second",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await second;

    expect(initCalls.current - initCallsBefore).toBe(2);
  });

  it("clears the cache even when the in-flight refresh fails", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();

    const first = service.refreshSession();
    await Promise.resolve();
    // Trigger the GIS error_callback — refreshSession should resolve to null.
    pendingRequests[0].errorCallback?.();
    expect(await first).toBeNull();

    // Subsequent refresh must run a fresh attempt — the failed
    // promise must NOT be cached as a permanent "this auth is dead"
    // marker.
    const second = service.refreshSession();
    await Promise.resolve();
    expect(pendingRequests).toHaveLength(2);
    pendingRequests[1].callback({
      access_token: "recovery",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    expect(await second).not.toBeNull();
  });

  it("eagerly clears state when signIn's userinfo fetch fails", async () => {
    // Token grant succeeded but the follow-up userinfo fetch
    // returned an error shape (or threw). Without the catch in
    // signIn, `#accessToken` would sit set to a working Drive token
    // while `profile === null`, leaving the app in a broken
    // pseudo-signed-in state. Eager invalidate must wipe both
    // in-memory and persisted copies the same way refresh does,
    // and re-throw so the user-facing error path runs.
    const { pendingRequests } = setupGoogleIdentityHarness();
    // Override the fetch stub so userinfo throws.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("internal", { status: 500 }),
      ),
    );

    const service = new GoogleAuthService();
    await service.initialize();

    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "token-that-cannot-resolve-profile",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });

    await expect(signInPromise).rejects.toThrow();
    expect(service.getAccessToken()).toBeNull();
    expect(localStorage.getItem("sutrapad-google-auth-session")).toBeNull();
  });

  it("eagerly clears the persisted session when refresh fails", async () => {
    // Drive returned 401, silent refresh failed (ITP, cookies gone,
    // Google sign-out elsewhere). The persisted token in localStorage
    // is by definition dead — leaving it would fool the next
    // bootstrap into "signed in" state and replay the same dead token
    // against Drive. Wipe both in-memory and the on-disk copy.
    const { pendingRequests } = setupGoogleIdentityHarness();
    // Pre-populate localStorage with a "still valid by clock" session
    // so we can prove eager-invalidate clears it on refresh failure.
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "stale-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        profile: { name: "Stale", email: "s@s" },
      }),
    );

    const service = new GoogleAuthService();
    await service.initialize();
    expect(localStorage.getItem("sutrapad-google-auth-session")).not.toBeNull();

    const refresh = service.refreshSession();
    await Promise.resolve();
    pendingRequests[0].errorCallback?.();
    expect(await refresh).toBeNull();

    expect(service.getAccessToken()).toBeNull();
    expect(localStorage.getItem("sutrapad-google-auth-session")).toBeNull();
  });
});

describe("GoogleAuthService rolling idle expiry", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();
  });

  it("pins MAX_IDLE_DAYS_BEFORE_EXPIRY at 7 — silent change would evict warm caches", () => {
    expect(MAX_IDLE_DAYS_BEFORE_EXPIRY).toBe(7);
  });

  it("invalidates a session whose lastUsedAt is older than the idle cap", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "stale",
        expiresAt,
        profile: { name: "X", email: "x@x" },
        lastUsedAt: eightDaysAgo,
      }),
    );

    const auth = new GoogleAuthService();
    expect(await auth.restorePersistedSession()).toBeNull();
    expect(localStorage.getItem("sutrapad-google-auth-session")).toBeNull();
  });

  it("keeps a session whose lastUsedAt is just inside the idle cap", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    // 6 days ago — well under the 7-day cap, should survive.
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "warm",
        expiresAt,
        profile: { name: "X", email: "x@x" },
        lastUsedAt: sixDaysAgo,
      }),
    );

    const auth = new GoogleAuthService();
    const profile = await auth.restorePersistedSession();
    expect(profile).not.toBeNull();
    expect(auth.getAccessToken()).toBe("warm");
  });

  it("treats a missing lastUsedAt as fresh-now (backwards compat)", async () => {
    // Sessions persisted before the rolling-expiry rollout have no
    // lastUsedAt field. They must NOT be evicted on the very first
    // post-rollout bootstrap, because that would mass-sign-out every
    // active user the moment the deploy lands.
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "legacy",
        expiresAt,
        profile: { name: "X", email: "x@x" },
        // No lastUsedAt.
      }),
    );

    const auth = new GoogleAuthService();
    const profile = await auth.restorePersistedSession();
    expect(profile).not.toBeNull();
    expect(auth.getAccessToken()).toBe("legacy");
  });

  it("treats backward clock skew as zero idle (no false fresh marker)", async () => {
    // User moved their system clock backward (manual change, NTP
    // step). `lastUsedAt` is now in the future relative to
    // `Date.now()`. A naive `Date.now() - lastUsedAt` would go
    // negative and pass the idle check, treating an arbitrarily-old
    // session as fresh. The Math.max(…, 0) clamp prevents that.
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const oneHourFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "skewed",
        expiresAt,
        profile: { name: "X", email: "x@x" },
        lastUsedAt: oneHourFuture,
      }),
    );

    const auth = new GoogleAuthService();
    // Session should still be returned (idle is clamped to 0, well
    // under the 7-day cap), but the heartbeat should have re-anchored
    // lastUsedAt to "now" so the future timestamp doesn't persist.
    const profile = await auth.restorePersistedSession();
    expect(profile).not.toBeNull();
    const stored = JSON.parse(
      localStorage.getItem("sutrapad-google-auth-session") as string,
    );
    expect(new Date(stored.lastUsedAt).getTime()).toBeLessThanOrEqual(
      Date.now() + 1_000,
    );
  });

  it("survives a localStorage quota error during heartbeat write", async () => {
    // The user's localStorage is full (other apps / extensions).
    // `setItem` throws QuotaExceededError. The read itself succeeded,
    // so the user is signed in — degraded mode is "session works,
    // idle clock doesn't reset". Locking the user out on quota
    // failure would be the wrong call.
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "warm",
        expiresAt,
        profile: { name: "X", email: "x@x" },
        lastUsedAt: oneDayAgo,
      }),
    );

    // Patch setItem to throw on the auth key. The pre-population
    // above ran fine because we patched after.
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key: string, value: string) => {
      if (key === "sutrapad-google-auth-session") {
        throw new Error("QuotaExceededError");
      }
      originalSetItem(key, value);
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const auth = new GoogleAuthService();
    const profile = await auth.restorePersistedSession();
    expect(profile).not.toBeNull();
    expect(auth.getAccessToken()).toBe("warm");
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to bump lastUsedAt on persisted session:",
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it("bumps lastUsedAt on each successful read", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "warm",
        expiresAt,
        profile: { name: "X", email: "x@x" },
        lastUsedAt: oneDayAgo,
      }),
    );

    const auth = new GoogleAuthService();
    await auth.restorePersistedSession();

    const stored = JSON.parse(
      localStorage.getItem("sutrapad-google-auth-session") as string,
    );
    // Heartbeat must have moved forward — the bumped value lives
    // within the last few seconds, not still 24h old.
    const bumpedAgeMs = Date.now() - new Date(stored.lastUsedAt).getTime();
    expect(bumpedAgeMs).toBeLessThan(5_000);
  });
});

describe("GoogleAuthService.subscribeToCrossTabSignOut", () => {
  function createWindowWithStorage(): {
    eventListeners: Map<string, Array<EventListener>>;
    fireStorageEvent: (key: string | null, newValue: string | null) => void;
  } {
    const listeners = new Map<string, Array<EventListener>>();
    vi.stubGlobal("window", {
      localStorage: createStorageMock(),
      addEventListener: (type: string, listener: EventListener) => {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        const list = listeners.get(type) ?? [];
        listeners.set(
          type,
          list.filter((l) => l !== listener),
        );
      },
    });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();

    return {
      eventListeners: listeners,
      fireStorageEvent: (key, newValue) => {
        const event = { key, newValue, oldValue: null } as StorageEvent;
        for (const l of listeners.get("storage") ?? []) {
          l(event);
        }
      },
    };
  }

  it("clears in-memory token and invokes the handler when peer tab removes the session key", () => {
    const harness = createWindowWithStorage();
    const service = new GoogleAuthService();
    // Pre-populate restored session so there's an in-memory token
    // to invalidate.
    localStorage.setItem(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "live-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        profile: { name: "X", email: "x@x" },
      }),
    );
    return service.restorePersistedSession().then(() => {
      expect(service.getAccessToken()).toBe("live-token");

      const handler = vi.fn();
      service.subscribeToCrossTabSignOut(handler);

      // Peer tab removes the session key — storage event fires with
      // newValue === null.
      harness.fireStorageEvent("sutrapad-google-auth-session", null);

      expect(service.getAccessToken()).toBeNull();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores storage events for unrelated keys", () => {
    const harness = createWindowWithStorage();
    const service = new GoogleAuthService();
    const handler = vi.fn();
    service.subscribeToCrossTabSignOut(handler);

    harness.fireStorageEvent("sutrapad-local-workspace", null);
    harness.fireStorageEvent("sutrapad-og-image-cache-v1", null);

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores localStorage.clear() (event.key === null)", () => {
    // The storage event spec dictates that `localStorage.clear()`
    // fires an event with `key === null`. A devtools panic-clear,
    // a misbehaving extension, or another app on the origin
    // wiping their own slot shouldn't be treated as a SutraPad
    // sign-out — the existing `event.key !== GOOGLE_AUTH_SESSION_KEY`
    // filter already protects this, but pin it explicitly so a
    // future "react to clear too" change has to remove this guard
    // intentionally.
    const harness = createWindowWithStorage();
    const service = new GoogleAuthService();
    const handler = vi.fn();
    service.subscribeToCrossTabSignOut(handler);

    harness.fireStorageEvent(null, null);

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores storage events that set a non-null value (peer sign-in)", () => {
    // Sign-in propagation deliberately not implemented — see method
    // doc. A peer tab updating our key with a fresh session payload
    // should NOT silently sign-in this tab.
    const harness = createWindowWithStorage();
    const service = new GoogleAuthService();
    const handler = vi.fn();
    service.subscribeToCrossTabSignOut(handler);

    harness.fireStorageEvent(
      "sutrapad-google-auth-session",
      JSON.stringify({
        accessToken: "peer-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        profile: { name: "Peer", email: "p@p" },
      }),
    );

    expect(handler).not.toHaveBeenCalled();
  });

  it("removes the listener via the returned dispose function", () => {
    const harness = createWindowWithStorage();
    const service = new GoogleAuthService();
    const handler = vi.fn();
    const dispose = service.subscribeToCrossTabSignOut(handler);

    dispose();
    harness.fireStorageEvent("sutrapad-google-auth-session", null);
    expect(handler).not.toHaveBeenCalled();
  });

  it("replaces an existing subscription when subscribed twice (idempotent dispose)", () => {
    // HMR or accidentally double-wiring `createApp` could call
    // subscribe twice. The second call should replace the first
    // listener — otherwise we'd stack handlers and fire duplicate
    // sign-out callbacks per peer event.
    const harness = createWindowWithStorage();
    const service = new GoogleAuthService();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    service.subscribeToCrossTabSignOut(firstHandler);
    service.subscribeToCrossTabSignOut(secondHandler);

    harness.fireStorageEvent("sutrapad-google-auth-session", null);

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });
});

describe("parseUserInfoResponse", () => {
  it("accepts a well-formed response with all fields", () => {
    const result = parseUserInfoResponse({
      name: "Filda",
      email: "filda@example.com",
      picture: "https://example.com/avatar.png",
      sub: "google-uid-ignored",
    });
    expect(result).toEqual({
      name: "Filda",
      email: "filda@example.com",
      picture: "https://example.com/avatar.png",
    });
    // Unknown fields (like `sub`) must NOT leak into the persisted profile.
    expect("sub" in result).toBe(false);
  });

  it("treats picture as optional", () => {
    const result = parseUserInfoResponse({
      name: "Filda",
      email: "filda@example.com",
    });
    expect(result.picture).toBeUndefined();
  });

  it("ignores a non-string picture", () => {
    const result = parseUserInfoResponse({
      name: "Filda",
      email: "filda@example.com",
      picture: 42,
    });
    expect(result.picture).toBeUndefined();
  });

  it("rejects responses missing name", () => {
    expect(() => parseUserInfoResponse({ email: "x@x" })).toThrow(
      /missing required fields/,
    );
  });

  it("rejects responses missing email", () => {
    expect(() => parseUserInfoResponse({ name: "Filda" })).toThrow(
      /missing required fields/,
    );
  });

  it("rejects responses with a blank name", () => {
    expect(() =>
      parseUserInfoResponse({ name: "   ", email: "x@x" }),
    ).toThrow(/missing required fields/);
  });

  it("rejects responses with a blank email", () => {
    expect(() =>
      parseUserInfoResponse({ name: "Filda", email: "   " }),
    ).toThrow(/missing required fields/);
  });

  it("rejects non-object inputs", () => {
    expect(() => parseUserInfoResponse(null)).toThrow();
    expect(() => parseUserInfoResponse("not json")).toThrow();
    expect(() => parseUserInfoResponse(42)).toThrow();
  });
});
