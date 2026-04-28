import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GoogleAuthService,
  hasLoggedInHint,
  parseUserInfoResponse,
  readEmailHint,
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

type TokenCallback = (response: {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}) => void;
type ErrorCallback = () => void;

interface PendingTokenRequest {
  callback: TokenCallback;
  errorCallback: ErrorCallback | undefined;
  prompt: string;
  /**
   * `hint` arrives in two places — on `initTokenClient`'s top-level
   * config and on `requestAccessToken({ hint })`. The harness records
   * both because both sites must be populated with the persisted
   * email hint for GIS to actually thread the value through to the
   * silent-refresh flow. Tests assert against this to pin the
   * round-trip.
   */
  hintAtInit: string | undefined;
  hintAtRequest: string | undefined;
}

function setupGoogleIdentityHarness(): {
  pendingRequests: Array<PendingTokenRequest>;
  initCalls: { current: number };
} {
  const pendingRequests: Array<PendingTokenRequest> = [];
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
              hint?: string;
            }) => {
              initCalls.current += 1;
              return {
                requestAccessToken: vi.fn(
                  (opts: { prompt?: string; hint?: string } = {}) => {
                    pendingRequests.push({
                      callback: config.callback,
                      errorCallback: config.error_callback,
                      prompt: opts.prompt ?? "",
                      hintAtInit: config.hint,
                      hintAtRequest: opts.hint,
                    });
                  },
                ),
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

describe("GoogleAuthService.bootstrap", () => {
  it("returns the profile and holds an in-memory token when silent refresh succeeds", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();

    const bootstrapPromise = service.bootstrap();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "fresh",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });

    const profile = await bootstrapPromise;
    expect(profile).toEqual({ name: "Test", email: "t@t", picture: "p" });
    expect(service.getAccessToken()).toBe("fresh");
  });

  it("uses prompt: 'none' for the silent refresh — never surfaces an auto-confirm popup", async () => {
    // GIS treats `prompt: ''` as "may show a brief FedCM auto-select
    // popup" and `prompt: 'none'` as "strictly silent, fail if any UI
    // would be needed". Cold-load bootstrap must use the strict mode
    // — flickering a popup on every page reload feels off for a
    // returning user. Pin this against accidental regression to ''.
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();

    void service.bootstrap();
    await Promise.resolve();

    expect(pendingRequests).toHaveLength(1);
    expect(pendingRequests[0].prompt).toBe("none");
  });

  it("returns null and leaves no token when silent refresh fails", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();

    const bootstrapPromise = service.bootstrap();
    await Promise.resolve();
    pendingRequests[0].errorCallback?.();

    expect(await bootstrapPromise).toBeNull();
    expect(service.getAccessToken()).toBeNull();
  });

  it("does NOT clear the is-logged-in hint when silent refresh fails", async () => {
    // Failed silent refresh on iOS Safari with strict ITP is a normal
    // state, not a sign-out. The is-logged-in flag exists to remember
    // that the user has interactively authorised on this origin and
    // should be presented with the sign-in button (not a "first
    // visit" experience). Wiping it on every ITP-driven failure
    // would make the PWA fast-path useless.
    const { pendingRequests } = setupGoogleIdentityHarness();
    localStorage.setItem("sutrapad-is-logged-in", "true");
    localStorage.setItem("sutrapad-user-email-hint", "x@x");

    const service = new GoogleAuthService();
    await service.initialize();
    const bootstrapPromise = service.bootstrap();
    await Promise.resolve();
    pendingRequests[0].errorCallback?.();
    await bootstrapPromise;

    expect(localStorage.getItem("sutrapad-is-logged-in")).toBe("true");
    expect(localStorage.getItem("sutrapad-user-email-hint")).toBe("x@x");
  });
});

describe("GoogleAuthService.refreshSession coalescing", () => {
  /**
   * Drive returns 401 → `withAuthRetry` calls `refreshSession`.
   * When three calls fly in parallel (workspace load + autosave +
   * tag index fetch all hitting the stale token in the same tick),
   * we want a single GIS silent-refresh round-trip, not three
   * racing each other.
   */

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

  it("eagerly clears in-memory state when signIn's userinfo fetch fails", async () => {
    // Token grant succeeded but the follow-up userinfo fetch
    // returned an error shape (or threw). Without the catch in
    // signIn, `#accessToken` would sit set to a working Drive token
    // while `profile === null`, leaving the app in a broken
    // pseudo-signed-in state. Eager invalidate must wipe the
    // in-memory token AND the persisted hints (so the failed account
    // doesn't auto-prefill the next sign-in attempt).
    const { pendingRequests } = setupGoogleIdentityHarness();
    // Override the fetch stub so userinfo throws.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("internal", { status: 500 })),
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
    expect(localStorage.getItem("sutrapad-user-email-hint")).toBeNull();
    expect(localStorage.getItem("sutrapad-is-logged-in")).toBeNull();
  });
});

describe("GoogleAuthService login_hint round-trip", () => {
  it("does not pass a hint when localStorage has none", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    void service.refreshSession();
    await Promise.resolve();

    expect(pendingRequests[0].hintAtInit).toBeUndefined();
    expect(pendingRequests[0].hintAtRequest).toBeUndefined();
  });

  it("passes the persisted email hint on both initTokenClient and requestAccessToken", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    localStorage.setItem("sutrapad-user-email-hint", "filda@example.com");
    const service = new GoogleAuthService();
    await service.initialize();
    void service.refreshSession();
    await Promise.resolve();

    expect(pendingRequests[0].hintAtInit).toBe("filda@example.com");
    expect(pendingRequests[0].hintAtRequest).toBe("filda@example.com");
  });

  it("writes the email hint and is-logged-in flag on signIn success", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();

    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "fresh",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await signInPromise;

    expect(localStorage.getItem("sutrapad-user-email-hint")).toBe("t@t");
    expect(localStorage.getItem("sutrapad-is-logged-in")).toBe("true");
  });

  it("refreshes the email hint on each successful silent refresh", async () => {
    // Google may have rotated which account is "primary" on the
    // `accounts.google.com` session between sign-in and refresh. A
    // stale hint there could nudge subsequent silent refresh toward
    // the wrong account; refreshing the hint on every successful
    // round-trip keeps it tracking reality.
    const { pendingRequests } = setupGoogleIdentityHarness();
    localStorage.setItem("sutrapad-user-email-hint", "old@x");
    // Userinfo will return `t@t` per the harness default.
    const service = new GoogleAuthService();
    await service.initialize();
    const refreshPromise = service.refreshSession();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "fresh",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await refreshPromise;

    expect(localStorage.getItem("sutrapad-user-email-hint")).toBe("t@t");
  });
});

describe("GoogleAuthService.signOut", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();
  });

  it("clears both persisted hints (email + logged-in flag)", () => {
    localStorage.setItem("sutrapad-user-email-hint", "x@x");
    localStorage.setItem("sutrapad-is-logged-in", "true");
    const service = new GoogleAuthService();
    service.signOut();

    expect(localStorage.getItem("sutrapad-user-email-hint")).toBeNull();
    expect(localStorage.getItem("sutrapad-is-logged-in")).toBeNull();
  });

  it("logs but does not throw when revoke fails synchronously", async () => {
    // The Google revoke call can throw synchronously when the GIS
    // script has been monkey-patched (e.g. an old version stuck in
    // the cache). The user-visible signed-out state must still hold.
    const { pendingRequests } = setupGoogleIdentityHarness();
    // Replace the harness's revoke with a throwing one; everything
    // else (initTokenClient, fetch) stays.
    const win = window as unknown as {
      google: { accounts: { oauth2: { revoke: (token: string, done: () => void) => void } } };
    };
    win.google.accounts.oauth2.revoke = () => {
      throw new Error("revoke broken");
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const service = new GoogleAuthService();
    await service.initialize();
    // Drive a successful signIn so there's a token in memory to
    // revoke. Without it, signOut returns early before reaching
    // revoke. Microtask flush gives signIn a chance to register the
    // pending request before we resolve it.
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "live",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await signInPromise;

    expect(() => service.signOut()).not.toThrow();
    expect(service.getAccessToken()).toBeNull();
    expect(localStorage.getItem("sutrapad-user-email-hint")).toBeNull();
    expect(localStorage.getItem("sutrapad-is-logged-in")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "Google token revoke failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("readEmailHint / hasLoggedInHint", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();
  });

  it("readEmailHint returns null when nothing persisted", () => {
    expect(readEmailHint()).toBeNull();
  });

  it("readEmailHint returns the persisted value verbatim", () => {
    localStorage.setItem("sutrapad-user-email-hint", "filda@example.com");
    expect(readEmailHint()).toBe("filda@example.com");
  });

  it("hasLoggedInHint is false when flag missing or non-true", () => {
    expect(hasLoggedInHint()).toBe(false);
    localStorage.setItem("sutrapad-is-logged-in", "false");
    expect(hasLoggedInHint()).toBe(false);
    localStorage.setItem("sutrapad-is-logged-in", "");
    expect(hasLoggedInHint()).toBe(false);
  });

  it("hasLoggedInHint is true only for the literal string 'true'", () => {
    localStorage.setItem("sutrapad-is-logged-in", "true");
    expect(hasLoggedInHint()).toBe(true);
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
