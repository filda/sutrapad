import { describe, expect, it, vi } from "vitest";
import { restoreSessionOnStartup, runWorkspaceSave } from "../src/app";
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

describe("workspace save behavior", () => {
  it("uses a lightweight status refresh during background autosave", async () => {
    const effects = {
      persistLocalWorkspace: vi.fn(),
      saveRemoteWorkspace: vi.fn().mockResolvedValue(undefined),
      setSyncState: vi.fn(),
      setLastError: vi.fn(),
      render: vi.fn(),
      refreshStatus: vi.fn(),
    };

    await runWorkspaceSave("background", effects);

    expect(effects.persistLocalWorkspace).toHaveBeenCalledTimes(1);
    expect(effects.saveRemoteWorkspace).toHaveBeenCalledTimes(1);
    expect(effects.setSyncState).toHaveBeenNthCalledWith(1, "saving");
    expect(effects.setSyncState).toHaveBeenNthCalledWith(2, "idle");
    expect(effects.refreshStatus).toHaveBeenCalledTimes(2);
    expect(effects.render).not.toHaveBeenCalled();
  });

  it("still performs a full render for interactive saves", async () => {
    const effects = {
      persistLocalWorkspace: vi.fn(),
      saveRemoteWorkspace: vi.fn().mockResolvedValue(undefined),
      setSyncState: vi.fn(),
      setLastError: vi.fn(),
      render: vi.fn(),
      refreshStatus: vi.fn(),
    };

    await runWorkspaceSave("interactive", effects);

    expect(effects.render).toHaveBeenCalledTimes(2);
    expect(effects.refreshStatus).not.toHaveBeenCalled();
  });
});
