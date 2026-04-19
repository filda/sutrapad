import { describe, expect, it, vi } from "vitest";
import {
  buildNoteMetadata,
  DEFAULT_NOTES_VIEW,
  generateFreshNoteDetails,
  isNotesViewMode,
  loadStoredNotesView,
  readActivePageFromLocation,
  readNoteDetailIdFromLocation,
  readNotesViewFromLocation,
  readTagFiltersFromLocation,
  resolveDisplayedNote,
  resolveInitialNotesView,
  restoreSessionOnStartup,
  runWorkspaceSave,
  writeActivePageToLocation,
  writeNoteDetailIdToLocation,
  writeNotesViewToLocation,
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

describe("active page location helpers", () => {
  describe("with root base (/)", () => {
    it("returns the default page when the pathname is just the base", () => {
      expect(readActivePageFromLocation("https://example.com/", "/")).toBe("notes");
    });

    it("reads a valid page id from the pathname", () => {
      expect(readActivePageFromLocation("https://example.com/home", "/")).toBe("home");
      expect(readActivePageFromLocation("https://example.com/links", "/")).toBe("links");
      expect(readActivePageFromLocation("https://example.com/settings", "/")).toBe("settings");
    });

    it("writes non-default pages as a slug and strips the slug for the default page", () => {
      expect(writeActivePageToLocation("https://example.com/", "home", "/")).toBe(
        "https://example.com/home",
      );
      expect(
        writeActivePageToLocation("https://example.com/links", "notes", "/"),
      ).toBe("https://example.com/");
    });
  });

  describe("with a sub-path base (/sutrapad/)", () => {
    it("treats the bare base as the default page (with or without trailing slash)", () => {
      expect(
        readActivePageFromLocation("https://example.com/sutrapad/", "/sutrapad/"),
      ).toBe("notes");
      expect(
        readActivePageFromLocation("https://example.com/sutrapad", "/sutrapad/"),
      ).toBe("notes");
    });

    it("reads a valid slug under the base path", () => {
      expect(
        readActivePageFromLocation("https://example.com/sutrapad/home", "/sutrapad/"),
      ).toBe("home");
      expect(
        readActivePageFromLocation("https://example.com/sutrapad/links", "/sutrapad/"),
      ).toBe("links");
    });

    it("normalizes case and URL-encoded slugs before matching", () => {
      expect(
        readActivePageFromLocation("https://example.com/sutrapad/%48OME", "/sutrapad/"),
      ).toBe("home");
      expect(
        readActivePageFromLocation("https://example.com/sutrapad/HOME", "/sutrapad/"),
      ).toBe("home");
    });

    it("falls back to the default page for unknown slugs", () => {
      expect(
        readActivePageFromLocation(
          "https://example.com/sutrapad/something-removed",
          "/sutrapad/",
        ),
      ).toBe("notes");
    });

    it("falls back to the default page when the URL is outside the base", () => {
      expect(
        readActivePageFromLocation("https://example.com/other/links", "/sutrapad/"),
      ).toBe("notes");
    });

    it("writes a non-default slug under the base and preserves query + hash", () => {
      expect(
        writeActivePageToLocation(
          "https://example.com/sutrapad/?tags=work#anchor",
          "links",
          "/sutrapad/",
        ),
      ).toBe("https://example.com/sutrapad/links?tags=work#anchor");
    });

    it("collapses the default page back to the bare base", () => {
      expect(
        writeActivePageToLocation(
          "https://example.com/sutrapad/links?tags=work",
          "notes",
          "/sutrapad/",
        ),
      ).toBe("https://example.com/sutrapad/?tags=work");
    });

    it("round-trips through read + write without drifting", () => {
      const written = writeActivePageToLocation(
        "https://example.com/sutrapad/",
        "home",
        "/sutrapad/",
      );
      expect(written).toBe("https://example.com/sutrapad/home");
      expect(readActivePageFromLocation(written, "/sutrapad/")).toBe("home");
    });
  });

  it("accepts bases written without a trailing slash", () => {
    expect(
      readActivePageFromLocation("https://example.com/sutrapad/tags", "/sutrapad"),
    ).toBe("tags");
    expect(
      writeActivePageToLocation("https://example.com/sutrapad/", "tags", "/sutrapad"),
    ).toBe("https://example.com/sutrapad/tags");
  });

  it("still resolves the notes page when a detail id trails the slug", () => {
    // /notes/<id> remains a notes-page URL; the detail id is read separately.
    expect(
      readActivePageFromLocation(
        "https://example.com/sutrapad/notes/abc-123",
        "/sutrapad/",
      ),
    ).toBe("notes");
  });

  it("falls back to the default page for action-only menu ids like /add", () => {
    // "add" is a menu action (shortcut for New note), not a navigable page,
    // so a deep link to it must land on the default page instead of leaving
    // the user on an empty placeholder.
    expect(
      readActivePageFromLocation("https://example.com/sutrapad/add", "/sutrapad/"),
    ).toBe("notes");
    expect(readActivePageFromLocation("https://example.com/add", "/")).toBe("notes");
  });
});

describe("note detail location helpers", () => {
  describe("readNoteDetailIdFromLocation", () => {
    it("returns null when the URL has no detail segment", () => {
      expect(
        readNoteDetailIdFromLocation("https://example.com/sutrapad/", "/sutrapad/"),
      ).toBeNull();
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/notes",
          "/sutrapad/",
        ),
      ).toBeNull();
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/notes/",
          "/sutrapad/",
        ),
      ).toBeNull();
    });

    it("returns null for URLs outside the base", () => {
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/other/notes/abc",
          "/sutrapad/",
        ),
      ).toBeNull();
    });

    it("returns null when the first segment is not 'notes'", () => {
      // Detail routes only live under the notes page, not under tags/links/etc.
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/tags/abc",
          "/sutrapad/",
        ),
      ).toBeNull();
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/links/abc",
          "/sutrapad/",
        ),
      ).toBeNull();
    });

    it("reads and decodes the note id from /notes/<id>", () => {
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/notes/abc-123",
          "/sutrapad/",
        ),
      ).toBe("abc-123");

      // URL-encoded characters must be decoded — the id survives encode/decode
      // even when it contains spaces or unusual characters.
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/notes/hello%20world",
          "/sutrapad/",
        ),
      ).toBe("hello world");
    });

    it("ignores deeper path segments after the id", () => {
      // Future sub-routes under a note (e.g. /edit) should not break parsing.
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/notes/abc/edit",
          "/sutrapad/",
        ),
      ).toBe("abc");
    });

    it("returns null for malformed percent-encoding instead of throwing", () => {
      expect(
        readNoteDetailIdFromLocation(
          "https://example.com/sutrapad/notes/%E0%A4%A",
          "/sutrapad/",
        ),
      ).toBeNull();
    });

    it("works with the root base", () => {
      expect(
        readNoteDetailIdFromLocation("https://example.com/notes/abc", "/"),
      ).toBe("abc");
      expect(
        readNoteDetailIdFromLocation("https://example.com/notes", "/"),
      ).toBeNull();
    });
  });

  describe("writeNoteDetailIdToLocation", () => {
    it("writes the id under /<base>notes/<id> and preserves query + hash", () => {
      expect(
        writeNoteDetailIdToLocation(
          "https://example.com/sutrapad/?tags=work#anchor",
          "abc-123",
          "/sutrapad/",
        ),
      ).toBe("https://example.com/sutrapad/notes/abc-123?tags=work#anchor");
    });

    it("URL-encodes ids that contain unsafe characters", () => {
      expect(
        writeNoteDetailIdToLocation(
          "https://example.com/sutrapad/",
          "hello world",
          "/sutrapad/",
        ),
      ).toBe("https://example.com/sutrapad/notes/hello%20world");
    });

    it("replaces any pre-existing pathname segments", () => {
      // Going from the tags page to a note detail must overwrite /tags.
      expect(
        writeNoteDetailIdToLocation(
          "https://example.com/sutrapad/tags?tags=work",
          "abc",
          "/sutrapad/",
        ),
      ).toBe("https://example.com/sutrapad/notes/abc?tags=work");
    });

    it("accepts bases without a trailing slash", () => {
      expect(
        writeNoteDetailIdToLocation(
          "https://example.com/sutrapad/",
          "abc",
          "/sutrapad",
        ),
      ).toBe("https://example.com/sutrapad/notes/abc");
    });

    it("round-trips through write + read without drifting", () => {
      const written = writeNoteDetailIdToLocation(
        "https://example.com/sutrapad/",
        "note id with space",
        "/sutrapad/",
      );
      expect(readNoteDetailIdFromLocation(written, "/sutrapad/")).toBe(
        "note id with space",
      );
    });
  });
});

describe("notes view mode location helpers", () => {
  describe("isNotesViewMode", () => {
    it("accepts the supported modes", () => {
      expect(isNotesViewMode("list")).toBe(true);
      expect(isNotesViewMode("cards")).toBe(true);
    });

    it("rejects unknown values, case variations, and non-strings", () => {
      expect(isNotesViewMode("grid")).toBe(false);
      expect(isNotesViewMode("LIST")).toBe(false);
      expect(isNotesViewMode("")).toBe(false);
      expect(isNotesViewMode(null)).toBe(false);
      expect(isNotesViewMode(undefined)).toBe(false);
      expect(isNotesViewMode(42)).toBe(false);
    });
  });

  describe("readNotesViewFromLocation", () => {
    it("returns the parsed mode when ?view= is set", () => {
      expect(readNotesViewFromLocation("https://example.com/?view=list")).toBe("list");
      expect(readNotesViewFromLocation("https://example.com/?view=cards")).toBe("cards");
    });

    it("ignores casing and surrounding whitespace", () => {
      expect(readNotesViewFromLocation("https://example.com/?view=%20LIST%20")).toBe(
        "list",
      );
    });

    it("returns null when the param is missing or unrecognised", () => {
      expect(readNotesViewFromLocation("https://example.com/")).toBeNull();
      expect(readNotesViewFromLocation("https://example.com/?view=grid")).toBeNull();
      expect(readNotesViewFromLocation("https://example.com/?view=")).toBeNull();
    });
  });

  describe("writeNotesViewToLocation", () => {
    it("writes the non-default mode into ?view=", () => {
      expect(writeNotesViewToLocation("https://example.com/", "list")).toBe(
        "https://example.com/?view=list",
      );
    });

    it("strips the param when writing the default mode", () => {
      expect(
        writeNotesViewToLocation("https://example.com/?view=list", DEFAULT_NOTES_VIEW),
      ).toBe("https://example.com/");
    });

    it("preserves other query params and the hash", () => {
      expect(
        writeNotesViewToLocation(
          "https://example.com/notes?tags=a%2Cb#focus",
          "list",
        ),
      ).toBe("https://example.com/notes?tags=a%2Cb&view=list#focus");
    });

    it("round-trips through write + read", () => {
      const written = writeNotesViewToLocation("https://example.com/", "list");
      expect(readNotesViewFromLocation(written)).toBe("list");
    });
  });

  describe("resolveInitialNotesView", () => {
    it("prefers the URL when both URL and storage are populated", () => {
      const storage = { getItem: vi.fn().mockReturnValue("cards") };
      expect(
        resolveInitialNotesView("https://example.com/?view=list", storage),
      ).toBe("list");
      // URL wins so storage need not even be consulted, but the contract is
      // "URL first, then storage" — we just want to confirm URL takes priority.
    });

    it("falls back to storage when the URL has no view param", () => {
      const storage = { getItem: vi.fn().mockReturnValue("list") };
      expect(resolveInitialNotesView("https://example.com/", storage)).toBe("list");
    });

    it("falls back to the default when neither URL nor storage have a value", () => {
      const storage = { getItem: vi.fn().mockReturnValue(null) };
      expect(resolveInitialNotesView("https://example.com/", storage)).toBe(
        DEFAULT_NOTES_VIEW,
      );
    });

    it("ignores garbage values stored in localStorage", () => {
      const storage = { getItem: vi.fn().mockReturnValue("waffle") };
      expect(resolveInitialNotesView("https://example.com/", storage)).toBe(
        DEFAULT_NOTES_VIEW,
      );
    });
  });

  describe("loadStoredNotesView", () => {
    it("returns the stored mode when valid", () => {
      const storage = { getItem: vi.fn().mockReturnValue("list") };
      expect(loadStoredNotesView(storage)).toBe("list");
    });

    it("returns null when no value is stored", () => {
      const storage = { getItem: vi.fn().mockReturnValue(null) };
      expect(loadStoredNotesView(storage)).toBeNull();
    });

    it("returns null when the stored value isn't a recognised mode", () => {
      const storage = { getItem: vi.fn().mockReturnValue("cosmic-grid") };
      expect(loadStoredNotesView(storage)).toBeNull();
    });
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
