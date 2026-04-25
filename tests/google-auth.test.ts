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

  it("rejects non-object inputs", () => {
    expect(() => parseUserInfoResponse(null)).toThrow();
    expect(() => parseUserInfoResponse("not json")).toThrow();
    expect(() => parseUserInfoResponse(42)).toThrow();
  });
});
