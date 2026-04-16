import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthService } from "../src/services/google-auth";

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
