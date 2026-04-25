import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthService, parseUserInfoResponse } from "../src/services/google-auth";

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

  it("logs but does not throw when revoke fails synchronously", () => {
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
    return auth.restorePersistedSession().then(() => {
      expect(() => auth.signOut()).not.toThrow();
      expect(auth.getAccessToken()).toBeNull();
      expect(localStorage.getItem("sutrapad-google-auth-session")).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "Google token revoke failed:",
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
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
