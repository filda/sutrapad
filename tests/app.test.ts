import { describe, expect, it, vi } from "vitest";
import { restoreSessionOnStartup } from "../src/app";
import type { UserProfile } from "../src/types";

describe("app startup session restore", () => {
  it("restores the workspace when Google session refresh succeeds", async () => {
    const profile: UserProfile = {
      name: "Filda",
      email: "panfilda@gmail.com",
      picture: "https://example.com/avatar.png",
    };
    const auth = {
      restorePersistedSession: vi.fn().mockResolvedValue(profile),
    };
    const applyRestoredProfile = vi.fn();
    const restoreWorkspaceAfterSignIn = vi.fn().mockResolvedValue(undefined);

    await expect(
      restoreSessionOnStartup(auth, applyRestoredProfile, restoreWorkspaceAfterSignIn),
    ).resolves.toEqual(profile);

    expect(auth.restorePersistedSession).toHaveBeenCalledTimes(1);
    expect(applyRestoredProfile).toHaveBeenCalledWith(profile);
    expect(applyRestoredProfile).toHaveBeenCalledBefore(restoreWorkspaceAfterSignIn);
    expect(restoreWorkspaceAfterSignIn).toHaveBeenCalledTimes(1);
  });

  it("does not restore the workspace when there is no persisted Google session", async () => {
    const auth = {
      restorePersistedSession: vi.fn().mockResolvedValue(null),
    };
    const applyRestoredProfile = vi.fn();
    const restoreWorkspaceAfterSignIn = vi.fn().mockResolvedValue(undefined);

    await expect(
      restoreSessionOnStartup(auth, applyRestoredProfile, restoreWorkspaceAfterSignIn),
    ).resolves.toBeNull();

    expect(auth.restorePersistedSession).toHaveBeenCalledTimes(1);
    expect(applyRestoredProfile).not.toHaveBeenCalled();
    expect(restoreWorkspaceAfterSignIn).not.toHaveBeenCalled();
  });
});
