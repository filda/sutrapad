import { describe, expect, it, vi } from "vitest";
import { withAuthRetry } from "../src/app/session/auth-retry";
import { GoogleDriveApiError } from "../src/services/drive-store";
import type { UserProfile } from "../src/types";

const sampleProfile: UserProfile = {
  name: "Filda",
  email: "filda@example.com",
  picture: "https://example.com/avatar.png",
};

describe("withAuthRetry", () => {
  it("returns the operation result without refreshing when no error is thrown", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>();
    const onProfileRefreshed = vi.fn();
    const operation = vi.fn().mockResolvedValue("ok");

    const result = await withAuthRetry(operation, { refreshSession, onProfileRefreshed });

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(onProfileRefreshed).not.toHaveBeenCalled();
  });

  it("rethrows non-401 errors without attempting a refresh", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>();
    const onProfileRefreshed = vi.fn();
    const unrelated = new Error("network down");
    const operation = vi.fn().mockRejectedValueOnce(unrelated);

    await expect(
      withAuthRetry(operation, { refreshSession, onProfileRefreshed }),
    ).rejects.toBe(unrelated);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(onProfileRefreshed).not.toHaveBeenCalled();
  });

  it("rethrows Drive errors with non-401 status without refreshing", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new GoogleDriveApiError("Failed to list", 500, "server error"));

    await expect(
      withAuthRetry(operation, { refreshSession }),
    ).rejects.toBeInstanceOf(GoogleDriveApiError);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes the session and retries once after a 401", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>().mockResolvedValue(sampleProfile);
    const onProfileRefreshed = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new GoogleDriveApiError("Failed to query Google Drive.", 401))
      .mockResolvedValueOnce("retry-ok");

    const result = await withAuthRetry(operation, { refreshSession, onProfileRefreshed });

    expect(result).toBe("retry-ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(onProfileRefreshed).toHaveBeenCalledWith(sampleProfile);
  });

  it("rethrows the original 401 when silent refresh cannot succeed", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>().mockResolvedValue(null);
    const onProfileRefreshed = vi.fn();
    const authError = new GoogleDriveApiError("Failed to query Google Drive.", 401);
    const operation = vi.fn().mockRejectedValueOnce(authError);

    await expect(
      withAuthRetry(operation, { refreshSession, onProfileRefreshed }),
    ).rejects.toBe(authError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(onProfileRefreshed).not.toHaveBeenCalled();
  });

  it("does not retry a second time when the retried operation also fails with a 401", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>().mockResolvedValue(sampleProfile);
    const onProfileRefreshed = vi.fn();
    const secondError = new GoogleDriveApiError("Still unauthorized.", 401);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new GoogleDriveApiError("Failed to query Google Drive.", 401))
      .mockRejectedValueOnce(secondError);

    await expect(
      withAuthRetry(operation, { refreshSession, onProfileRefreshed }),
    ).rejects.toBe(secondError);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(onProfileRefreshed).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing onProfileRefreshed callback", async () => {
    const refreshSession = vi.fn<[], Promise<UserProfile | null>>().mockResolvedValue(sampleProfile);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new GoogleDriveApiError("Failed to query Google Drive.", 401))
      .mockResolvedValueOnce("retry-ok");

    await expect(withAuthRetry(operation, { refreshSession })).resolves.toBe("retry-ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
