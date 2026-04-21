import { describe, expect, it, vi } from "vitest";
import {
  buildAvailableTagIndex,
  buildLinkIndex,
  buildTagIndex,
  areWorkspacesEqual,
  canonicalizeUrl,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  createWorkspace,
  extractUrlsFromText,
  filterNotesByAllTags,
  isPristineWorkspace,
  mergeWorkspaces,
  sortNotes,
  upsertNote,
} from "../src/lib/notebook";
import type { SutraPadDocument } from "../src/types";

function makeNote(
  overrides: Partial<SutraPadDocument> & Pick<SutraPadDocument, "id" | "updatedAt">,
): SutraPadDocument {
  return {
    title: "Test note",
    body: "",
    createdAt: overrides.createdAt ?? overrides.updatedAt,
    urls: overrides.urls ?? [],
    tags: [],
    ...overrides,
  };
}

describe("notebook helpers: indexes and filtering", () => {
    it("creates a workspace with one active note", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"));

      const workspace = createWorkspace();

      expect(workspace.notes).toHaveLength(1);
      expect(workspace.activeNoteId).toBe(workspace.notes[0].id);
      expect(workspace.notes[0].title).toBe("Untitled note");
      expect(workspace.notes[0].body).toBe("");
      expect(workspace.notes[0].tags).toEqual([]);
      expect(workspace.notes[0].createdAt).toBe("2026-04-13T10:00:00.000Z");

      vi.useRealTimers();
    });

    it("sorts notes by updatedAt descending", () => {
      const notes: SutraPadDocument[] = [
        makeNote({ id: "1", title: "Older", updatedAt: "2026-04-13T10:00:00.000Z" }),
        makeNote({ id: "2", title: "Newest", updatedAt: "2026-04-13T12:00:00.000Z" }),
        makeNote({ id: "3", title: "Middle", updatedAt: "2026-04-13T11:00:00.000Z" }),
      ];

      expect(sortNotes(notes).map((note) => note.id)).toEqual(["2", "3", "1"]);
    });

    it("builds a tag index with note links and counts", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
          makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea"] }),
          makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work"] }),
        ],
      };

      expect(buildTagIndex(workspace, "2026-04-13T12:30:00.000Z")).toEqual({
        version: 1,
        savedAt: "2026-04-13T12:30:00.000Z",
        tags: [
          { tag: "idea", noteIds: ["1", "2"], count: 2 },
          { tag: "work", noteIds: ["1", "3"], count: 2 },
        ],
      });
    });

    it("returns the full tag index when no filter is selected", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
          makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea"] }),
          makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work"] }),
        ],
      };

      expect(buildAvailableTagIndex(workspace, [], "2026-04-13T12:30:00.000Z")).toEqual(
        buildTagIndex(workspace, "2026-04-13T12:30:00.000Z"),
      );
    });

    it("narrows the cloud to tags that co-occur with the selected filter", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
          makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea", "weekend"] }),
          makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work", "urgent"] }),
        ],
      };

      const index = buildAvailableTagIndex(workspace, ["work"], "2026-04-13T12:30:00.000Z");
      const visibleTags = index.tags.map((entry) => entry.tag);

      expect(visibleTags).not.toContain("weekend");
      expect(visibleTags).toEqual(expect.arrayContaining(["work", "idea", "urgent"]));
    });

    it("reports counts against the filtered subset, not the global workspace", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
          makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea", "weekend"] }),
          makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work", "urgent"] }),
        ],
      };

      const index = buildAvailableTagIndex(workspace, ["work"], "2026-04-13T12:30:00.000Z");

      expect(index.tags.find((entry) => entry.tag === "idea")?.count).toBe(1);
      expect(index.tags.find((entry) => entry.tag === "work")?.count).toBe(2);
    });

    it("requires notes to have every selected tag when multiple filters are active", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
          makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea", "weekend"] }),
          makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work", "urgent"] }),
        ],
      };

      const index = buildAvailableTagIndex(workspace, ["work", "idea"], "2026-04-13T12:30:00.000Z");

      expect(index.tags.map((entry) => entry.tag).toSorted()).toEqual(["idea", "work"]);
      expect(index.tags.every((entry) => entry.count === 1)).toBe(true);
    });

    it("returns an empty index when no notes match the selected filters", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work"] })],
      };

      expect(buildAvailableTagIndex(workspace, ["missing"], "2026-04-13T12:30:00.000Z")).toEqual({
        version: 1,
        savedAt: "2026-04-13T12:30:00.000Z",
        tags: [],
      });
    });

    it("extracts normalized unique urls from free text", () => {
      expect(
        extractUrlsFromText(
          "See https://example.com/one, https://example.com/two. Also https://example.com/one again.",
        ),
      ).toEqual(["https://example.com/one", "https://example.com/two"]);
    });

    it("builds a link index sorted by the most recent note that contains each url", () => {
      const workspace = {
        activeNoteId: "3",
        notes: [
          makeNote({
            id: "1",
            updatedAt: "2026-04-13T10:00:00.000Z",
            urls: ["https://example.com/older"],
          }),
          makeNote({
            id: "2",
            updatedAt: "2026-04-13T11:00:00.000Z",
            urls: ["https://example.com/middle", "https://example.com/older"],
          }),
          makeNote({
            id: "3",
            updatedAt: "2026-04-13T12:00:00.000Z",
            urls: ["https://example.com/newest"],
          }),
        ],
      };

      expect(buildLinkIndex(workspace, "2026-04-13T12:30:00.000Z")).toEqual({
        version: 1,
        savedAt: "2026-04-13T12:30:00.000Z",
        links: [
          {
            url: "https://example.com/newest",
            noteIds: ["3"],
            count: 1,
            latestUpdatedAt: "2026-04-13T12:00:00.000Z",
          },
          {
            url: "https://example.com/middle",
            noteIds: ["2"],
            count: 1,
            latestUpdatedAt: "2026-04-13T11:00:00.000Z",
          },
          {
            url: "https://example.com/older",
            noteIds: ["2", "1"],
            count: 2,
            latestUpdatedAt: "2026-04-13T11:00:00.000Z",
          },
        ],
      });
    });

    it("moves a re-added link to the top of the link index", () => {
      const workspace = {
        activeNoteId: "fresh",
        notes: [
          makeNote({
            id: "old",
            updatedAt: "2026-04-13T09:00:00.000Z",
            urls: ["https://example.com/repeat"],
          }),
          makeNote({
            id: "other",
            updatedAt: "2026-04-13T10:00:00.000Z",
            urls: ["https://example.com/other"],
          }),
          makeNote({
            id: "fresh",
            updatedAt: "2026-04-13T11:00:00.000Z",
            urls: ["https://example.com/repeat"],
          }),
        ],
      };

      const linkIndex = buildLinkIndex(workspace, "2026-04-13T11:30:00.000Z");

      expect(linkIndex.links.map((entry) => entry.url)).toEqual([
        "https://example.com/repeat",
        "https://example.com/other",
      ]);
      expect(linkIndex.links[0]).toEqual({
        url: "https://example.com/repeat",
        noteIds: ["fresh", "old"],
        count: 2,
        latestUpdatedAt: "2026-04-13T11:00:00.000Z",
      });
    });

    it("filters notes by requiring every selected tag", () => {
      const notes: SutraPadDocument[] = [
        makeNote({ id: "1", updatedAt: "2026-04-13T12:00:00.000Z", tags: ["work", "idea"] }),
        makeNote({ id: "2", updatedAt: "2026-04-13T11:00:00.000Z", tags: ["idea"] }),
        makeNote({ id: "3", updatedAt: "2026-04-13T10:00:00.000Z", tags: ["work", "draft"] }),
      ];

      expect(filterNotesByAllTags(notes, ["work"]).map((note) => note.id)).toEqual(["1", "3"]);
      expect(filterNotesByAllTags(notes, ["work", "idea"]).map((note) => note.id)).toEqual(["1"]);
      expect(filterNotesByAllTags(notes, ["missing"])).toEqual([]);
      expect(filterNotesByAllTags(notes, [])).toEqual(notes);
    });
});

describe("notebook helpers: note updates and creation", () => {
    it("updates a note and keeps it active", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [
          makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" }),
          makeNote({ id: "2", title: "Beta", updatedAt: "2026-04-13T11:00:00.000Z" }),
        ],
      };

      const updated = upsertNote(workspace, "1", (note) => ({
        ...note,
        title: "Alpha revised",
        updatedAt: "2026-04-13T12:00:00.000Z",
      }));

      expect(updated.activeNoteId).toBe("1");
      expect(updated.notes[0].id).toBe("1");
      expect(updated.notes[0].title).toBe("Alpha revised");
    });

    it("updates only the targeted note when upserting", () => {
      const workspace = {
        activeNoteId: "2",
        notes: [
          makeNote({ id: "1", title: "Alpha", body: "Keep me", updatedAt: "2026-04-13T10:00:00.000Z" }),
          makeNote({ id: "2", title: "Beta", body: "Change me", updatedAt: "2026-04-13T11:00:00.000Z" }),
        ],
      };

      const updated = upsertNote(workspace, "2", (note) => ({
        ...note,
        body: "Changed",
        updatedAt: "2026-04-13T12:00:00.000Z",
      }));

      expect(updated.notes.find((note) => note.id === "1")?.body).toBe("Keep me");
      expect(updated.notes.find((note) => note.id === "2")?.body).toBe("Changed");
      expect(updated.notes).toHaveLength(2);
    });

    it("creates a new note and makes it active", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };

      const updated = createNewNoteWorkspace(workspace);

      expect(updated.notes).toHaveLength(2);
      expect(updated.activeNoteId).toBe(updated.notes[0].id);
      expect(updated.notes[0].title).toBe("Untitled note");

      vi.useRealTimers();
    });

    it("creates a new note with a provided generated title", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };

      const updated = createNewNoteWorkspace(workspace, "14/04/2026 Â· high noon Â· LibeÅˆ");

      expect(updated.notes[0].title).toBe("14/04/2026 Â· high noon Â· LibeÅˆ");
      expect(updated.activeNoteId).toBe(updated.notes[0].id);

      vi.useRealTimers();
    });

    it("creates a captured link note and makes it active", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-13T14:00:00.000Z"));

      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };

      const updated = createCapturedNoteWorkspace(workspace, {
        title: "Example page",
        url: "https://example.com/post",
      });

      expect(updated.activeNoteId).toBe(updated.notes[0].id);
      expect(updated.notes[0].title).toBe("Example page");
      expect(updated.notes[0].body).toBe("https://example.com/post");
      expect(updated.notes[0].urls).toEqual(["https://example.com/post"]);

      vi.useRealTimers();
    });

    it("creates a text note from captured text and makes it active", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-13T15:00:00.000Z"));

      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };

      const updated = createTextNoteWorkspace(workspace, {
        title: "14/4/2026 Ã‚Â· midnight",
        body: "A quick note with https://example.com/article",
        location: "Prague",
        coordinates: {
          latitude: 50.0755,
          longitude: 14.4378,
        },
      });

      expect(updated.activeNoteId).toBe(updated.notes[0].id);
      expect(updated.notes[0].title).toBe("14/4/2026 Ã‚Â· midnight");
      expect(updated.notes[0].body).toBe("A quick note with https://example.com/article");
      expect(updated.notes[0].location).toBe("Prague");
      expect(updated.notes[0].coordinates).toEqual({
        latitude: 50.0755,
        longitude: 14.4378,
      });
      expect(updated.notes[0].urls).toEqual(["https://example.com/article"]);
      expect(updated.notes[0].createdAt).toBe("2026-04-13T15:00:00.000Z");

      vi.useRealTimers();
    });

    it("stores the generated location on newly created notes", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-13T13:00:00.000Z"));

      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };

      const updated = createNewNoteWorkspace(
        workspace,
        "14/04/2026 Â· high noon Â· Prague",
        "Prague",
        {
          latitude: 50.0755,
          longitude: 14.4378,
        },
      );

      expect(updated.notes[0].title).toBe("14/04/2026 Â· high noon Â· Prague");
      expect(updated.notes[0].location).toBe("Prague");
      expect(updated.notes[0].coordinates).toEqual({
        latitude: 50.0755,
        longitude: 14.4378,
      });
      expect(updated.notes[0].createdAt).toBe("2026-04-13T13:00:00.000Z");

      vi.useRealTimers();
    });
});

describe("notebook helpers: workspace merging and equality", () => {
    it("treats the default local workspace as pristine", () => {
      const workspace = {
        activeNoteId: "1",
        notes: [makeNote({ id: "1", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };

      expect(isPristineWorkspace(workspace)).toBe(true);
    });

    it("does not treat edited or multi-note workspaces as pristine", () => {
      expect(
        isPristineWorkspace({
          activeNoteId: "1",
          notes: [makeNote({ id: "1", title: "Untitled note", body: "Draft", updatedAt: "2026-04-13T10:00:00.000Z" })],
        }),
      ).toBe(false);

      expect(
        isPristineWorkspace({
          activeNoteId: "2",
          notes: [makeNote({ id: "1", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" })],
        }),
      ).toBe(false);

      expect(
        isPristineWorkspace({
          activeNoteId: "1",
          notes: [
            makeNote({ id: "1", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" }),
            makeNote({ id: "2", title: "Second", updatedAt: "2026-04-13T11:00:00.000Z" }),
          ],
        }),
      ).toBe(false);
    });

    it("merges local notes into an otherwise empty remote workspace", () => {
      const localWorkspace = {
        activeNoteId: "local-1",
        notes: [
          makeNote({ id: "local-1", title: "Draft", body: "Write first, sign in later.", updatedAt: "2026-04-13T10:00:00.000Z" }),
        ],
      };
      const remoteWorkspace = {
        activeNoteId: "remote-1",
        notes: [
          makeNote({ id: "remote-1", title: "Untitled note", updatedAt: "2026-04-13T09:00:00.000Z" }),
        ],
      };

      expect(mergeWorkspaces(localWorkspace, remoteWorkspace)).toEqual(localWorkspace);
    });

    it("keeps the remote notebook when the local workspace is still pristine", () => {
      const localWorkspace = {
        activeNoteId: "local-1",
        notes: [
          makeNote({ id: "local-1", title: "Untitled note", updatedAt: "2026-04-13T09:00:00.000Z" }),
        ],
      };
      const remoteWorkspace = {
        activeNoteId: "remote-1",
        notes: [
          makeNote({ id: "remote-1", title: "Saved note", body: "Already in Drive.", updatedAt: "2026-04-13T10:00:00.000Z" }),
        ],
      };

      expect(mergeWorkspaces(localWorkspace, remoteWorkspace)).toEqual(remoteWorkspace);
    });

    it("prefers the newer version when the same note exists locally and remotely", () => {
      const merged = mergeWorkspaces(
        {
          activeNoteId: "shared",
          notes: [
            makeNote({ id: "shared", title: "Local draft", body: "Local body", updatedAt: "2026-04-13T12:00:00.000Z" }),
          ],
        },
        {
          activeNoteId: "shared",
          notes: [
            makeNote({ id: "shared", title: "Remote draft", body: "Remote body", updatedAt: "2026-04-13T10:00:00.000Z" }),
          ],
        },
      );

      expect(merged.notes).toHaveLength(1);
      expect(merged.notes[0]).toMatchObject({
        id: "shared",
        title: "Local draft",
        body: "Local body",
        updatedAt: "2026-04-13T12:00:00.000Z",
      });
      expect(merged.activeNoteId).toBe("shared");
    });

    it("keeps the remote copy when both sides share an identical updatedAt timestamp", () => {
      const merged = mergeWorkspaces(
        {
          activeNoteId: "shared",
          notes: [
            makeNote({ id: "shared", title: "Local at tie", body: "local", updatedAt: "2026-04-13T12:00:00.000Z" }),
          ],
        },
        {
          activeNoteId: "shared",
          notes: [
            makeNote({ id: "shared", title: "Remote at tie", body: "remote", updatedAt: "2026-04-13T12:00:00.000Z" }),
          ],
        },
      );

      expect(merged.notes[0]).toMatchObject({
        title: "Remote at tie",
        body: "remote",
      });
    });

    it("merges disjoint notes from both sides and prefers the local active note id", () => {
      const merged = mergeWorkspaces(
        {
          activeNoteId: "local-1",
          notes: [
            makeNote({ id: "local-1", title: "Local", body: "local", updatedAt: "2026-04-13T12:00:00.000Z" }),
          ],
        },
        {
          activeNoteId: "remote-1",
          notes: [
            makeNote({ id: "remote-1", title: "Remote", body: "remote", updatedAt: "2026-04-13T11:00:00.000Z" }),
          ],
        },
      );

      expect(merged.notes.map((note) => note.id).toSorted()).toEqual(["local-1", "remote-1"]);
      expect(merged.activeNoteId).toBe("local-1");
    });

    it("falls back to the remote active note id when the local one is not in the merged set", () => {
      const merged = mergeWorkspaces(
        {
          activeNoteId: "removed-locally",
          notes: [
            makeNote({ id: "kept", title: "Kept", body: "kept", updatedAt: "2026-04-13T12:00:00.000Z" }),
          ],
        },
        {
          activeNoteId: "kept",
          notes: [
            makeNote({ id: "kept", title: "Remote kept", body: "r", updatedAt: "2026-04-13T10:00:00.000Z" }),
          ],
        },
      );

      expect(merged.activeNoteId).toBe("kept");
    });

    it("falls back to the newest note id when neither side's active id survives the merge", () => {
      const merged = mergeWorkspaces(
        {
          activeNoteId: "gone-local",
          notes: [makeNote({ id: "alpha", title: "Alpha", updatedAt: "2026-04-13T10:00:00.000Z" })],
        },
        {
          activeNoteId: "gone-remote",
          notes: [makeNote({ id: "beta", title: "Beta", updatedAt: "2026-04-13T12:00:00.000Z" })],
        },
      );

      expect(merged.activeNoteId).toBe("beta");
    });

    it("treats two pristine workspaces by keeping local as the merged result", () => {
      const localPristine = {
        activeNoteId: "local-pristine",
        notes: [makeNote({ id: "local-pristine", title: "Untitled note", updatedAt: "2026-04-13T10:00:00.000Z" })],
      };
      const remotePristine = {
        activeNoteId: "remote-pristine",
        notes: [makeNote({ id: "remote-pristine", title: "Untitled note", updatedAt: "2026-04-13T09:00:00.000Z" })],
      };

      const merged = mergeWorkspaces(localPristine, remotePristine);
      expect(merged.notes).toHaveLength(2);
      expect(merged.activeNoteId).toBe("local-pristine");
    });

    it("extracts urls but strips only trailing punctuation from them", () => {
      expect(
        extractUrlsFromText("See https://example.com/one!!! and https://example.com/two.,);"),
      ).toEqual(["https://example.com/one", "https://example.com/two"]);
    });

    it("ignores strings that look like urls but are not actually parseable", () => {
      expect(extractUrlsFromText("Visit https://:::broken:::")).toEqual([]);
    });

    it("strips utm_* parameters when canonicalising", () => {
      expect(
        canonicalizeUrl(
          "https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=spring",
        ),
      ).toBe("https://example.com/article");
    });

    it("strips named tracking parameters including Seznam Sklik dop_* variants", () => {
      expect(
        canonicalizeUrl(
          "https://example.com/post?fbclid=abc&gclid=xyz&dop_ab_variant=B&dop_source_zone_name=feed",
        ),
      ).toBe("https://example.com/post");
    });

    it("preserves non-tracking query parameters and their order", () => {
      expect(
        canonicalizeUrl("https://example.com/search?q=typescript&page=2&utm_source=twitter"),
      ).toBe("https://example.com/search?q=typescript&page=2");
    });

    it("preserves path and fragment during canonicalisation", () => {
      expect(
        canonicalizeUrl("https://example.com/docs/guide?utm_campaign=x#section-3"),
      ).toBe("https://example.com/docs/guide#section-3");
    });

    it("returns the input unchanged when it cannot be parsed as a URL", () => {
      expect(canonicalizeUrl("not-a-url")).toBe("not-a-url");
    });

    it("removes every occurrence when a tracking parameter appears more than once", () => {
      expect(
        canonicalizeUrl("https://example.com/?utm_source=a&utm_source=b&id=42"),
      ).toBe("https://example.com/?id=42");
    });

    it("dedupes urls that differ only by tracking parameters when extracting from text", () => {
      expect(
        extractUrlsFromText(
          "Compare https://example.com/post?utm_source=twitter with https://example.com/post?utm_source=newsletter and https://example.com/post?fbclid=xyz",
        ),
      ).toEqual(["https://example.com/post"]);
    });

    it("detects when two workspaces are equivalent", () => {
      const leftWorkspace = {
        activeNoteId: "1",
        notes: [
          makeNote({
            id: "2",
            title: "Beta",
            updatedAt: "2026-04-13T11:00:00.000Z",
            urls: ["https://example.com/beta"],
            location: "Brno",
            coordinates: { latitude: 49.1951, longitude: 16.6068 },
            captureContext: { source: "url-capture" },
          }),
          makeNote({
            id: "1",
            title: "Alpha",
            body: "Hello",
            tags: ["draft"],
            updatedAt: "2026-04-13T10:00:00.000Z",
            urls: ["https://example.com/alpha"],
            location: "Prague",
            coordinates: { latitude: 50.0755, longitude: 14.4378 },
            captureContext: { source: "new-note", timezone: "Europe/Prague" },
            createdAt: "2026-04-13T09:55:00.000Z",
          }),
        ],
      };
      const rightWorkspace = {
        activeNoteId: "1",
        notes: [
          makeNote({
            id: "1",
            title: "Alpha",
            body: "Hello",
            tags: ["draft"],
            updatedAt: "2026-04-13T10:00:00.000Z",
            urls: ["https://example.com/alpha"],
            location: "Prague",
            coordinates: { latitude: 50.0755, longitude: 14.4378 },
            captureContext: { source: "new-note", timezone: "Europe/Prague" },
            createdAt: "2026-04-13T09:55:00.000Z",
          }),
          makeNote({
            id: "2",
            title: "Beta",
            updatedAt: "2026-04-13T11:00:00.000Z",
            urls: ["https://example.com/beta"],
            location: "Brno",
            coordinates: { latitude: 49.1951, longitude: 16.6068 },
            captureContext: { source: "url-capture" },
          }),
        ],
      };

      expect(areWorkspacesEqual(leftWorkspace, rightWorkspace)).toBe(true);
    });

    it("detects when two workspaces differ", () => {
      expect(
        areWorkspacesEqual(
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", body: "Hello", updatedAt: "2026-04-13T10:00:00.000Z" })] },
          { activeNoteId: "2", notes: [makeNote({ id: "1", title: "Alpha", body: "Hello", updatedAt: "2026-04-13T10:00:00.000Z" })] },
        ),
      ).toBe(false);

      expect(
        areWorkspacesEqual(
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", body: "Hello", updatedAt: "2026-04-13T10:00:00.000Z" })] },
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", body: "Changed", updatedAt: "2026-04-13T10:00:00.000Z" })] },
        ),
      ).toBe(false);
    });

    it("detects tag differences between otherwise identical workspaces", () => {
      expect(
        areWorkspacesEqual(
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: [], updatedAt: "2026-04-13T10:00:00.000Z" })] },
        ),
      ).toBe(false);

      expect(
        areWorkspacesEqual(
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work", "personal"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["personal", "work"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
        ),
      ).toBe(false);
    });

    it("considers workspaces equal when tags match", () => {
      expect(
        areWorkspacesEqual(
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work", "draft"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
          { activeNoteId: "1", notes: [makeNote({ id: "1", title: "Alpha", tags: ["work", "draft"], updatedAt: "2026-04-13T10:00:00.000Z" })] },
        ),
      ).toBe(true);
    });

    it("detects metadata differences between otherwise identical workspaces", () => {
      const base = {
        activeNoteId: "1",
        notes: [
          makeNote({
            id: "1",
            title: "Alpha",
            updatedAt: "2026-04-13T10:00:00.000Z",
            createdAt: "2026-04-13T09:00:00.000Z",
            urls: ["https://example.com/alpha"],
            location: "Prague",
            coordinates: { latitude: 50.0755, longitude: 14.4378 },
            captureContext: { source: "new-note", timezone: "Europe/Prague" },
          }),
        ],
      };

      expect(
        areWorkspacesEqual(base, {
          ...base,
          notes: [makeNote({ ...base.notes[0], urls: ["https://example.com/other"] })],
        }),
      ).toBe(false);
      expect(
        areWorkspacesEqual(base, {
          ...base,
          notes: [makeNote({ ...base.notes[0], captureContext: { source: "url-capture" } })],
        }),
      ).toBe(false);
      expect(
        areWorkspacesEqual(base, {
          ...base,
          notes: [makeNote({ ...base.notes[0], location: "Brno" })],
        }),
      ).toBe(false);
      expect(
        areWorkspacesEqual(base, {
          ...base,
          notes: [
            makeNote({
              ...base.notes[0],
              coordinates: { latitude: 49.1951, longitude: 16.6068 },
            }),
          ],
        }),
      ).toBe(false);
      expect(
        areWorkspacesEqual(base, {
          ...base,
          notes: [makeNote({ ...base.notes[0], createdAt: "2026-04-13T08:59:00.000Z" })],
        }),
      ).toBe(false);
      expect(
        areWorkspacesEqual(base, {
          ...base,
          notes: [makeNote({ ...base.notes[0], updatedAt: "2026-04-13T10:01:00.000Z" })],
        }),
      ).toBe(false);
    });
});
