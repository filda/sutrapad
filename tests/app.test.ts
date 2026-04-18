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
    // Ensure the last-error slot is cleared (not left on a previous message and not
    // replaced with a non-empty string, which would be the effect of the StringLiteral mutant).
    expect(effects.setLastError).toHaveBeenCalledWith("");
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

  it("surfaces a thrown Error's message when the remote save rejects", async () => {
    const effects = {
      persistLocalWorkspace: vi.fn(),
      saveRemoteWorkspace: vi.fn().mockRejectedValue(new Error("drive quota exceeded")),
      setSyncState: vi.fn(),
      setLastError: vi.fn(),
      render: vi.fn(),
      refreshStatus: vi.fn(),
    };

    await runWorkspaceSave("interactive", effects);

    expect(effects.setSyncState).toHaveBeenLastCalledWith("error");
    expect(effects.setLastError).toHaveBeenLastCalledWith("drive quota exceeded");
    expect(effects.render).toHaveBeenCalledTimes(2);
  });

  it("falls back to a friendly message when the thrown value is not an Error", async () => {
    // Kills the StringLiteral mutant that replaces "Saving to Google Drive failed." with "".
    const effects = {
      persistLocalWorkspace: vi.fn(),
      saveRemoteWorkspace: vi.fn().mockRejectedValue("something weird"),
      setSyncState: vi.fn(),
      setLastError: vi.fn(),
      render: vi.fn(),
      refreshStatus: vi.fn(),
    };

    await runWorkspaceSave("background", effects);

    expect(effects.setSyncState).toHaveBeenLastCalledWith("error");
    expect(effects.setLastError).toHaveBeenLastCalledWith("Saving to Google Drive failed.");
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

  it("returns the active note even when it is not the first in the filtered list", () => {
    // Kills ConditionalExpression (true/false) and EqualityOperator (=== -> !==)
    // mutants on the `note.id === workspace.activeNoteId` predicate. If the predicate
    // were ignored, the first element ("2") would be returned instead of the active
    // note ("3").
    const workspace: SutraPadWorkspace = {
      activeNoteId: "3",
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
        {
          id: "3",
          title: "Gamma",
          body: "",
          createdAt: "2026-04-13T12:00:00.000Z",
          updatedAt: "2026-04-13T12:00:00.000Z",
          urls: [],
          tags: ["idea"],
        },
      ],
    };

    expect(resolveDisplayedNote(workspace, ["idea"])?.id).toBe("3");
  });

  it("falls back to the first matching note when there is no active note id", () => {
    const workspace: SutraPadWorkspace = {
      activeNoteId: null,
      notes: [
        {
          id: "1",
          title: "Alpha",
          body: "",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          urls: [],
          tags: ["idea"],
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

    expect(resolveDisplayedNote(workspace, ["idea"])?.id).toBe("1");
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
    const buildCaptureContext = vi.fn().mockResolvedValue({
      source: "new-note",
      timezone: "Europe/Prague",
      locale: "en-US",
    });

    await expect(
      generateFreshNoteDetails(
        localNoon,
        resolveCoordinates,
        reverseGeocode,
        buildCaptureContext,
      ),
    ).resolves.toEqual({
      title: "13/04/2026 · high noon · Prague",
      location: "Prague",
      coordinates: {
        latitude: 50.0755,
        longitude: 14.4378,
      },
      captureContext: {
        source: "new-note",
        timezone: "Europe/Prague",
        locale: "en-US",
      },
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
