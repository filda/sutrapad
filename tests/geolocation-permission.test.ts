import { describe, expect, it, vi } from "vitest";
import { resolveGeolocationPermissionState } from "../src/lib/geolocation-permission";

describe("resolveGeolocationPermissionState", () => {
  it("returns 'granted' when the browser already allowed location for this origin", async () => {
    const query = vi.fn().mockResolvedValue({ state: "granted" });
    await expect(
      resolveGeolocationPermissionState({ permissions: { query } }),
    ).resolves.toBe("granted");
    expect(query).toHaveBeenCalledWith({ name: "geolocation" });
  });

  it("returns 'denied' when the user previously blocked location for this origin", async () => {
    const query = vi.fn().mockResolvedValue({ state: "denied" });
    await expect(
      resolveGeolocationPermissionState({ permissions: { query } }),
    ).resolves.toBe("denied");
  });

  it("returns 'prompt' when the browser hasn't asked the user yet", async () => {
    const query = vi.fn().mockResolvedValue({ state: "prompt" });
    await expect(
      resolveGeolocationPermissionState({ permissions: { query } }),
    ).resolves.toBe("prompt");
  });

  it("returns null when the navigator has no Permissions API at all", async () => {
    await expect(resolveGeolocationPermissionState({})).resolves.toBeNull();
  });

  it("returns null when permissions.query is not a function", async () => {
    // Some embedded WebViews stub `navigator.permissions` as an empty
    // object. The probe must treat that the same as "API missing"
    // rather than blowing up at the call site.
    await expect(
      resolveGeolocationPermissionState({
        permissions: {} as unknown as { query: never },
      }),
    ).resolves.toBeNull();
  });

  it("returns null when permissions.query rejects (older Firefox shape)", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new TypeError("'geolocation' is not a supported permission name."));
    await expect(
      resolveGeolocationPermissionState({ permissions: { query } }),
    ).resolves.toBeNull();
  });

  it("passes through unexpected state values verbatim rather than guessing", async () => {
    // If the spec ever grows a fourth state, the probe shouldn't lie
    // by collapsing it into one of the three known shapes — the
    // caller can decide. We narrow via `unknown` so TS doesn't catch
    // this, but pin the runtime contract here.
    const query = vi.fn().mockResolvedValue({ state: "future-spec-value" });
    await expect(
      resolveGeolocationPermissionState({ permissions: { query } }),
    ).resolves.toBe("future-spec-value");
  });
});
