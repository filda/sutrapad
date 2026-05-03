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

  it("rejects a callable input even when it carries valid name/email own properties", () => {
    // The first guard is `!raw || typeof raw !== "object"`. Without a
    // truthy non-object, both `false` mutants on the second
    // sub-condition collapse to the original's observable behaviour
    // (the inner `typeof data.name !== "string"` guard catches them).
    // A function with valid string `name` and `email` properties slips
    // past the inner guard if the outer one misfires — so this input
    // proves the outer `typeof raw !== "object"` check actually runs.
    const fnLike = (() => {}) as unknown as Record<string, unknown> & (() => void);
    Object.defineProperty(fnLike, "name", {
      value: "Filda",
      writable: true,
      configurable: true,
    });
    fnLike.email = "filda@example.com";
    expect(() => parseUserInfoResponse(fnLike)).toThrow(
      "Google profile response missing required fields.",
    );
  });

  it("rejects non-object inputs with the missing-fields message", () => {
    // The exact message text is part of the contract — it's logged and
    // surfaced in the bootstrap-error pulse. Assert on the text rather
    // than just `toThrow()` so the StringLiteral mutant on line 99 is
    // pinned (an empty error message would otherwise pass `toThrow()`).
    expect(() => parseUserInfoResponse(null)).toThrow(
      "Google profile response missing required fields.",
    );
    expect(() => parseUserInfoResponse("not json")).toThrow(
      "Google profile response missing required fields.",
    );
    expect(() => parseUserInfoResponse(42)).toThrow(
      "Google profile response missing required fields.",
    );
    expect(() => parseUserInfoResponse(undefined)).toThrow(
      "Google profile response missing required fields.",
    );
  });
});

describe("GoogleAuthService.initialize", () => {
  it("throws a specific error when VITE_GOOGLE_CLIENT_ID is missing", async () => {
    setupGoogleIdentityHarness();
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    const service = new GoogleAuthService();
    await expect(service.initialize()).rejects.toThrow(
      "Missing VITE_GOOGLE_CLIENT_ID in .env.",
    );
  });

  it("clears the cached init promise on rejection so a later retry can succeed", async () => {
    // A failed init must NOT permanently poison the service — the user
    // can correct the env (in real life: a hot-reloaded vite config) and
    // a follow-up call should run a fresh attempt rather than re-rejecting
    // forever from the cached promise.
    setupGoogleIdentityHarness();
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    const service = new GoogleAuthService();
    await expect(service.initialize()).rejects.toThrow();

    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "stub-client-id");
    await expect(service.initialize()).resolves.toBeUndefined();
  });
});

describe("loadGoogleIdentityScript (via service.initialize)", () => {
  it("does not append a <script> when GIS is already loaded on the window", async () => {
    // Hot-reload + tab-restore can land with `window.google.accounts.oauth2`
    // already populated. Re-injecting the script on every initialize
    // would queue a duplicate fetch and stack a second `load` listener.
    setupGoogleIdentityHarness();
    // happy-dom isn't the env here — emulate document.head minimally
    // for the script-tag count assertion.
    const head = { children: [] as unknown[] };
    let appendCalls = 0;
    vi.stubGlobal("document", {
      createElement: () => ({
        addEventListener: () => undefined,
        set src(_: string) {},
        set async(_: boolean) {},
        set defer(_: boolean) {},
      }),
      head: {
        append: () => {
          appendCalls += 1;
        },
      },
      ...head,
    });
    const service = new GoogleAuthService();
    await service.initialize();
    expect(appendCalls).toBe(0);
  });
});

describe("GoogleAuthService GOOGLE_SCOPES round-trip", () => {
  it("forwards the full openid+profile+email+drive.file scope string to initTokenClient", async () => {
    // The four-part scope is the contract with Google: openid for the
    // sub claim, profile + email for userinfo, drive.file for the
    // notebook store. Pin the literal here so the array+join form can't
    // silently lose a scope (ArrayDeclaration `[]` mutant) or replace
    // a member with `""` (StringLiteral mutants).
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    void service.refreshSession();
    await Promise.resolve();

    const oauth = (window as unknown as {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: { mock: { calls: Array<[{ scope: string }]> } };
          };
        };
      };
    }).google.accounts.oauth2;
    const config = oauth.initTokenClient.mock.calls[0][0];
    expect(config.scope).toBe(
      "openid profile email https://www.googleapis.com/auth/drive.file",
    );
    expect(pendingRequests).toHaveLength(1);
  });
});

describe("requireGoogleOAuth error path", () => {
  it("throws a specific message when window.google is missing entirely", async () => {
    // The harness-less window has no `google` namespace. signIn drives
    // through requestToken → requireGoogleOAuth, which must throw the
    // user-visible "client is not available" message rather than a
    // generic TypeError on `.accounts`.
    setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    // Strip the google namespace so requireGoogleOAuth bails. We keep
    // localStorage so initialize doesn't trip over a missing one.
    const w = window as unknown as { google?: unknown };
    delete w.google;

    await expect(service.signIn()).rejects.toThrow(
      "Google OAuth client is not available.",
    );
  });

  it("throws when window.google exists but accounts is missing (partial GIS load)", async () => {
    // Defends the optional-chaining mutant on line 141: removing `?`
    // from `accounts?.oauth2` would TypeError instead of throwing the
    // intended message. Test the half-loaded shape (google present,
    // accounts undefined) to pin the chain.
    setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const w = window as unknown as { google: unknown };
    w.google = {};

    await expect(service.signIn()).rejects.toThrow(
      "Google OAuth client is not available.",
    );
  });
});

describe("requestToken error propagation", () => {
  it("rejects signIn with the GIS error_callback message label", async () => {
    // The error message string is the user-visible failure mode for
    // the sign-in button — pin it explicitly.
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].errorCallback?.();
    await expect(signInPromise).rejects.toThrow(
      "Google sign-in was cancelled or failed.",
    );
  });

  it("rejects refreshSession with the silent-refresh error label when surfaced (sanity probe)", async () => {
    // refreshSession swallows GIS error_callback into `null` rather
    // than a throw, but the inner `requestToken` rejects with the
    // refresh-specific label. Reach in via signIn-style assertion that
    // the label string isn't the cancellation one — protects the
    // StringLiteral mutant on line 346 by demonstrating the two flows
    // use different labels.
    setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    // Force the refresh through and capture its label by intercepting
    // requestToken via the private surface.
    const internalRequest = (
      service as unknown as {
        requestToken: (
          prompt: "consent" | "none",
          msg: string,
        ) => Promise<unknown>;
      }
    ).requestToken.bind(service);
    const promise = internalRequest("none", "Unable to refresh the Google session.");
    await Promise.resolve();
    // Trigger the error path via the most recent pending request.
    const oauth = (window as unknown as {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: {
              mock: {
                calls: Array<[{ error_callback?: () => void }]>;
              };
            };
          };
        };
      };
    }).google.accounts.oauth2;
    const lastConfig =
      oauth.initTokenClient.mock.calls[
        oauth.initTokenClient.mock.calls.length - 1
      ][0];
    lastConfig.error_callback?.();
    await expect(promise).rejects.toThrow(
      "Unable to refresh the Google session.",
    );
  });

  it("rejects when the GIS callback's tokenResponse carries an error code", async () => {
    // Google can land a tokenResponse with `error: "popup_closed_by_user"`
    // (the user dismissed the popup). The callback path must reject —
    // the conditional `if (tokenResponse.error)` mutating to `false`
    // would let the bad token through to access_token assignment.
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "",
      expires_in: 0,
      scope: "",
      token_type: "Bearer",
      error: "popup_closed_by_user",
    });
    await expect(signInPromise).rejects.toThrow("popup_closed_by_user");
    expect(service.getAccessToken()).toBeNull();
  });
});

describe("fetchUserProfile contract", () => {
  it("calls the Google userinfo endpoint with a Bearer Authorization header", async () => {
    // Pin the URL string, the Bearer prefix, and the Authorization
    // header shape — three StringLiteral mutants survive otherwise.
    const { pendingRequests } = setupGoogleIdentityHarness();
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ name: "Test", email: "t@t" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const service = new GoogleAuthService();
    await service.initialize();
    const promise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "live-token",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://www.googleapis.com/oauth2/v3/userinfo");
    const init = call[1];
    expect(init).toBeDefined();
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer live-token");
  });

  it("throws a specific message when userinfo returns non-OK", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );
    const service = new GoogleAuthService();
    await service.initialize();
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "doomed-token",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await expect(signInPromise).rejects.toThrow(
      "Failed to load the user profile from the Google account.",
    );
  });
});

describe("signOut early-return paths", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    localStorage.clear();
  });

  it("clears hints and skips revoke when no token is held in memory", () => {
    // No prior signIn → `#accessToken` is null → revoke isn't safe to
    // call. The hints still get wiped (a defensive sweep).
    localStorage.setItem("sutrapad-user-email-hint", "x@x");
    localStorage.setItem("sutrapad-is-logged-in", "true");
    const service = new GoogleAuthService();
    expect(() => service.signOut()).not.toThrow();
    expect(localStorage.getItem("sutrapad-user-email-hint")).toBeNull();
    expect(localStorage.getItem("sutrapad-is-logged-in")).toBeNull();
  });

  it("clears hints and skips revoke when GIS is not loaded on the window", async () => {
    // After a successful signIn but a subsequent loss of the google
    // namespace (e.g. an HMR shim that strips it), signOut must still
    // clean up rather than TypeError on `google.accounts.oauth2.revoke`.
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "live",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await signInPromise;

    const w = window as unknown as { google?: unknown };
    delete w.google;
    expect(() => service.signOut()).not.toThrow();
    expect(service.getAccessToken()).toBeNull();
    expect(localStorage.getItem("sutrapad-user-email-hint")).toBeNull();
  });

  it("clears hints and skips revoke when window.google exists but accounts is missing (partial GIS)", async () => {
    // The optional-chaining guard `window.google?.accounts?.oauth2`
    // tolerates a half-loaded GIS shape (google present, accounts not).
    // Removing the `?` after accounts would TypeError here; this test
    // pins the chain by replacing the namespace mid-flight with `{}`.
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    await service.initialize();
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "live",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await signInPromise;

    (window as unknown as { google: unknown }).google = {};
    expect(() => service.signOut()).not.toThrow();
    expect(service.getAccessToken()).toBeNull();
  });
});

describe("signIn / refreshSession auto-initialize when called first", () => {
  // The two public entry points each carry a defensive
  // `if (!this.#clientId) await this.initialize();` guard so callers
  // don't have to remember to call initialize() before signIn().
  // Without coverage on these paths, the BlockStatement and
  // ConditionalExpression mutants on lines 304 / 339 survive.

  it("signIn auto-initializes when no prior initialize() was awaited", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    // Skip the explicit initialize() — signIn must trigger it itself.
    // Several await boundaries separate the call from the GIS round-trip
    // (signIn → initialize IIFE → loadGoogleIdentityScript → requestToken),
    // so flush a handful of microtasks before checking for the request.
    const signInPromise = service.signIn();
    // Six microtask flushes — one per await boundary in the
    // auto-initialize chain. Unrolled rather than looped because
    // `no-await-in-loop` flags the natural `for` form, and the
    // serial flush is exactly the behaviour we want here.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(pendingRequests).toHaveLength(1);
    pendingRequests[0].callback({
      access_token: "fresh-from-auto-init",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await expect(signInPromise).resolves.toBeDefined();
    expect(service.getAccessToken()).toBe("fresh-from-auto-init");
  });

  it("refreshSession auto-initializes when no prior initialize() was awaited", async () => {
    const { pendingRequests } = setupGoogleIdentityHarness();
    const service = new GoogleAuthService();
    const refreshPromise = service.refreshSession();
    // Six microtask flushes — one per await boundary in the
    // auto-initialize chain. Unrolled rather than looped because
    // `no-await-in-loop` flags the natural `for` form, and the
    // serial flush is exactly the behaviour we want here.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(pendingRequests).toHaveLength(1);
    pendingRequests[0].callback({
      access_token: "auto-refresh-token",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await expect(refreshPromise).resolves.toBeDefined();
    expect(service.getAccessToken()).toBe("auto-refresh-token");
  });
});

describe("loadGoogleIdentityScript injects the GIS <script> when google is missing", () => {
  // This path is the cold-load case — first ever bootstrap on a
  // browser that hasn't loaded GIS yet. Module-level
  // `googleScriptPromise` persists across tests in the same file, so
  // we use vi.resetModules() to get a fresh load in this test only.
  // Without this coverage the entire `if (!googleScriptPromise) {…}`
  // block in `loadGoogleIdentityScript` surfaces as NoCoverage and
  // the URL constant on line 46 stays a survivor.

  it("rejects initialize() with the script-load-failure message when the <script> dispatches `error`", async () => {
    vi.resetModules();
    const { GoogleAuthService: FreshService } = await import(
      "../src/services/google-auth"
    );

    const handlers: { error: (() => void) | null } = { error: null };
    const scriptStub: Record<string, unknown> = {
      addEventListener: (event: string, handler: () => void) => {
        if (event === "error") handlers.error = handler;
      },
    };
    Object.defineProperty(scriptStub, "src", { set: () => undefined });
    Object.defineProperty(scriptStub, "async", { set: () => undefined });
    Object.defineProperty(scriptStub, "defer", { set: () => undefined });
    vi.stubGlobal("document", {
      createElement: () => scriptStub,
      head: { append: () => undefined },
    });
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "stub-client-id");

    const service = new FreshService();
    const initPromise = service.initialize();
    await Promise.resolve();
    await Promise.resolve();
    expect(handlers.error).not.toBeNull();
    handlers.error?.();
    await expect(initPromise).rejects.toThrow(
      "Failed to load Google Identity Services.",
    );
  });

  it("memoises the script-loading Promise across separate service instances so only one <script> is ever appended", async () => {
    // `googleScriptPromise` is module-scoped specifically so two
    // independent `GoogleAuthService` instances share one GIS script
    // load. Mutating `if (!googleScriptPromise)` to `if (true)` would
    // re-enter the body for the second service and stack a duplicate
    // <script> tag. (Two separate services, not two calls on one,
    // because each service memoises its own `#initPromise` — same
    // service called twice never re-enters loadGoogleIdentityScript
    // anyway, regardless of the inner guard.)
    vi.resetModules();
    const { GoogleAuthService: FreshService } = await import(
      "../src/services/google-auth"
    );

    const handlers: { load: (() => void) | null } = { load: null };
    let appendCount = 0;
    const scriptStub: Record<string, unknown> = {
      addEventListener: (event: string, handler: () => void) => {
        if (event === "load") handlers.load = handler;
      },
    };
    Object.defineProperty(scriptStub, "src", { set: () => undefined });
    Object.defineProperty(scriptStub, "async", { set: () => undefined });
    Object.defineProperty(scriptStub, "defer", { set: () => undefined });
    vi.stubGlobal("document", {
      createElement: () => scriptStub,
      head: {
        append: () => {
          appendCount += 1;
        },
      },
    });
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "stub-client-id");

    const a = new FreshService();
    const b = new FreshService();
    const firstInit = a.initialize();
    const secondInit = b.initialize();
    await Promise.resolve();
    await Promise.resolve();
    expect(appendCount).toBe(1);
    handlers.load?.();
    await expect(firstInit).resolves.toBeUndefined();
    await expect(secondInit).resolves.toBeUndefined();
  });

  it("threads the optional chain through `accounts` when window.google is half-loaded (truthy but missing accounts)", async () => {
    // Defends the optional-chaining mutant on line 148. With
    // `window.google = {}`, the original `window.google?.accounts?.oauth2`
    // resolves to undefined and the function falls through to script
    // injection; the mutant `window.google?.accounts.oauth2` would
    // TypeError on `undefined.oauth2`. Driving initialize from a fresh
    // module with this exact shape pins the chain.
    vi.resetModules();
    const { GoogleAuthService: FreshService } = await import(
      "../src/services/google-auth"
    );

    const handlers: { load: (() => void) | null } = { load: null };
    const scriptStub: Record<string, unknown> = {
      addEventListener: (event: string, handler: () => void) => {
        if (event === "load") handlers.load = handler;
      },
    };
    Object.defineProperty(scriptStub, "src", { set: () => undefined });
    Object.defineProperty(scriptStub, "async", { set: () => undefined });
    Object.defineProperty(scriptStub, "defer", { set: () => undefined });
    vi.stubGlobal("document", {
      createElement: () => scriptStub,
      head: { append: () => undefined },
    });
    vi.stubGlobal("window", {
      localStorage: createStorageMock(),
      google: {}, // truthy but no `.accounts`
    });
    vi.stubGlobal("localStorage", window.localStorage);
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "stub-client-id");

    const service = new FreshService();
    const initPromise = service.initialize();
    await Promise.resolve();
    await Promise.resolve();
    handlers.load?.();
    await expect(initPromise).resolves.toBeUndefined();
  });

  it("appends a single <script src=GIS_URL> with async/defer to <head> and resolves on load", async () => {
    vi.resetModules();
    const { GoogleAuthService: FreshService } = await import(
      "../src/services/google-auth"
    );

    const appendCalls: Array<unknown> = [];
    // Held inside a box so TS doesn't narrow the assigned-in-closure
    // value back to `null` after the closure escapes.
    const handlers: { load: (() => void) | null } = { load: null };
    const scriptStub: Record<string, unknown> = {
      addEventListener: (event: string, handler: () => void) => {
        if (event === "load") handlers.load = handler;
      },
    };
    const documentStub = {
      createElement: (tag: string) => {
        expect(tag).toBe("script");
        return scriptStub;
      },
      head: {
        append: (node: unknown) => {
          appendCalls.push(node);
        },
      },
    };
    // Track src/async/defer assignments via setters on the stub.
    let recordedSrc: string | undefined;
    let recordedAsync: boolean | undefined;
    let recordedDefer: boolean | undefined;
    Object.defineProperty(scriptStub, "src", {
      set: (v: string) => {
        recordedSrc = v;
      },
    });
    Object.defineProperty(scriptStub, "async", {
      set: (v: boolean) => {
        recordedAsync = v;
      },
    });
    Object.defineProperty(scriptStub, "defer", {
      set: (v: boolean) => {
        recordedDefer = v;
      },
    });
    vi.stubGlobal("document", documentStub);

    // Simulate a browser without GIS yet — initialize must trigger
    // the script-injection path. We populate `window.google` only
    // AFTER the script "loads" so requireGoogleOAuth can succeed in
    // any subsequent code, but for this test we only care about the
    // appended-script side-effect.
    vi.stubGlobal("window", { localStorage: createStorageMock() });
    vi.stubGlobal("localStorage", window.localStorage);
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "stub-client-id");

    const service = new FreshService();
    const initPromise = service.initialize();
    // The IIFE awaits loadGoogleIdentityScript — we need to fire the
    // script `load` event so the promise resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(appendCalls).toHaveLength(1);
    expect(recordedSrc).toBe("https://accounts.google.com/gsi/client");
    expect(recordedAsync).toBe(true);
    expect(recordedDefer).toBe(true);
    handlers.load?.();
    await expect(initPromise).resolves.toBeUndefined();
  });
});

describe("hint persistence catches localStorage failures", () => {
  it("logs a warning and keeps going when setItem throws on sign-in success", async () => {
    // Quota-exceeded / private-mode setItem throws are normal failure
    // modes. The sign-in result must still resolve (the hints are an
    // optimization, not a credential).
    const { pendingRequests } = setupGoogleIdentityHarness();
    // Re-stub localStorage with a setItem that throws.
    const w = window as { localStorage: Storage };
    const real = w.localStorage;
    w.localStorage = {
      ...real,
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    vi.stubGlobal("localStorage", w.localStorage);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const service = new GoogleAuthService();
    await service.initialize();
    const signInPromise = service.signIn();
    await Promise.resolve();
    pendingRequests[0].callback({
      access_token: "live",
      expires_in: 3600,
      scope: "x",
      token_type: "Bearer",
    });
    await expect(signInPromise).resolves.toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to persist sign-in hints:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("logs a warning and keeps going when removeItem throws on sign-out", () => {
    // Some private-mode contexts also throw on removeItem. signOut
    // must still wipe the in-memory token and not surface the storage
    // failure to the caller.
    setupGoogleIdentityHarness();
    const w = window as { localStorage: Storage };
    w.localStorage = {
      ...w.localStorage,
      removeItem: () => {
        throw new Error("StorageError");
      },
    };
    vi.stubGlobal("localStorage", w.localStorage);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const service = new GoogleAuthService();
    expect(() => service.signOut()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to clear sign-in hints:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
