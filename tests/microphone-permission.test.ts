import { describe, expect, it, vi } from "vitest";
import {
  queryMicrophonePermission,
  requestMicrophoneAccess,
} from "../src/app/logic/microphone-permission";

describe("queryMicrophonePermission", () => {
  it("returns unsupported when the Permissions API is absent", async () => {
    await expect(queryMicrophonePermission({})).resolves.toBe("unsupported");
    await expect(queryMicrophonePermission({ permissions: {} })).resolves.toBe("unsupported");
  });

  it("returns unsupported when the query rejects", async () => {
    await expect(
      queryMicrophonePermission({
        permissions: { query: () => Promise.reject(new Error("no such name")) },
      }),
    ).resolves.toBe("unsupported");
  });

  it.each(["granted", "denied", "prompt"] as const)(
    "passes through the %s permission state",
    async (state) => {
      await expect(
        queryMicrophonePermission({ permissions: { query: () => Promise.resolve({ state }) } }),
      ).resolves.toBe(state);
    },
  );

  it("collapses an unknown state string to unsupported", async () => {
    await expect(
      queryMicrophonePermission({ permissions: { query: () => Promise.resolve({ state: "weird" }) } }),
    ).resolves.toBe("unsupported");
  });

  it("queries with the microphone descriptor", async () => {
    const query = vi.fn().mockResolvedValue({ state: "granted" });
    await queryMicrophonePermission({ permissions: { query } });
    expect(query).toHaveBeenCalledWith({ name: "microphone" });
  });
});

describe("requestMicrophoneAccess", () => {
  it("returns unsupported when getUserMedia is absent", async () => {
    await expect(requestMicrophoneAccess({})).resolves.toBe("unsupported");
    await expect(requestMicrophoneAccess({ mediaDevices: {} })).resolves.toBe("unsupported");
  });

  it("grants and releases the stream on success", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }, { stop }] });
    await expect(
      requestMicrophoneAccess({ mediaDevices: { getUserMedia } }),
    ).resolves.toBe("granted");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    // Both tracks stopped — we only wanted the permission, not a live recording.
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("reports denied when the prompt is rejected and the query confirms it", async () => {
    await expect(
      requestMicrophoneAccess({
        mediaDevices: { getUserMedia: () => Promise.reject(new Error("NotAllowedError")) },
        permissions: { query: () => Promise.resolve({ state: "denied" }) },
      }),
    ).resolves.toBe("denied");
  });

  it("reports prompt when the rejection was a dismissal (query still prompt)", async () => {
    await expect(
      requestMicrophoneAccess({
        mediaDevices: { getUserMedia: () => Promise.reject(new Error("dismissed")) },
        permissions: { query: () => Promise.resolve({ state: "prompt" }) },
      }),
    ).resolves.toBe("prompt");
  });

  it("falls back to denied when the rejection can't be classified via the Permissions API", async () => {
    await expect(
      requestMicrophoneAccess({
        mediaDevices: { getUserMedia: () => Promise.reject(new Error("denied")) },
      }),
    ).resolves.toBe("denied");
  });
});
