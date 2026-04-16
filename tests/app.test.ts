import { describe, expect, it, vi } from "vitest";
import {
  buildNoteMetadata,
  generateFreshNoteDetails,
  readTagFiltersFromLocation,
  resolveDisplayedNote,
  restoreSessionOnStartup,
  runWorkspaceSave,
  writeTagFiltersToLocation,
} from "../src/app";
import type { SutraPadWorkspace, UserProfile } from "../src/types";

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

describe("tag filter location helpers", () => {
  it("reads normalized unique tag filters from the URL", () => {
    expect(
      readTagFiltersFromLocation("https://example.com/app?tags=Work,idea,work,,Draft"),
    ).toEqual(["draft", "idea", "work"]);
  });

  it("writes tag filters into the URL and removes the param when empty", () => {
    expect(
      writeTagFiltersToLocation("https://example.com/app?foo=1", ["work", "Idea", "work", " draft "]),
    ).toBe("https://example.com/app?foo=1&tags=draft%2Cidea%2Cwork");

    expect(
      writeTagFiltersToLocation("https://example.com/app?foo=1&tags=work", []),
    ).toBe("https://example.com/app?foo=1");
  });
});

describe("displayed note selection", () => {
  it("returns null when no note matches all selected tags", () => {
    const workspace: SutraPadWorkspace = {
      activeNoteId: "1",
        notes: [
        {
          id: "1",
          title: "Alpha",
          body: "",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          urls: [],
          tags: ["work"],
        },
        {
          id: "2",
          title: "Beta",
          body: "",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:00:00.000Z",
          urls: [],
          tags: ["idea"],
        },
      ],
    };

    expect(resolveDisplayedNote(workspace, ["work", "idea"])).toBeNull();
  });

  it("falls back to the first matching note when the active note is filtered out", () => {
    const workspace: SutraPadWorkspace = {
      activeNoteId: "1",
      notes: [
        {
          id: "1",
          title: "Alpha",
          body: "",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          urls: [],
          tags: ["work"],
        },
        {
          id: "2",
          title: "Beta",
          body: "",
          createdAt: "2026-04-13T11:00:00.000Z",
          updatedAt: "2026-04-13T11:00:00.000Z",
          urls: [],
          tags: ["idea"],
        },
      ],
    };

    expect(resolveDisplayedNote(workspace, ["idea"])?.id).toBe("2");
  });
});

describe("fresh note details", () => {
  it("returns both a generated title and a standalone location field", async () => {
    const localNoon = new Date(2026, 3, 13, 12, 0, 0);
    const resolveCoordinates = vi.fn().mockResolvedValue({
      latitude: 50.0755,
      longitude: 14.4378,
    });
    const reverseGeocode = vi.fn().mockResolvedValue("Prague");

    await expect(
      generateFreshNoteDetails(
        localNoon,
        resolveCoordinates,
        reverseGeocode,
      ),
    ).resolves.toEqual({
      title: "13/04/2026 · high noon · Prague",
      location: "Prague",
      coordinates: {
        latitude: 50.0755,
        longitude: 14.4378,
      },
      createdAt: undefined,
    });
  });
});

describe("note metadata", () => {
  it("combines location and update time into a quiet metadata line", () => {
    expect(
      buildNoteMetadata({
        id: "1",
        title: "Alpha",
        body: "",
        urls: [],
        location: "Prague",
        coordinates: {
          latitude: 50.0755,
          longitude: 14.4378,
        },
        createdAt: new Date(2026, 3, 13, 11, 45, 0).toISOString(),
        updatedAt: new Date(2026, 3, 13, 12, 0, 0).toISOString(),
        tags: [],
      }),
    ).toMatch(/^Prague · Updated .*2026/);
  });
});
