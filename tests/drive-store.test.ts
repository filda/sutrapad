import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveStore } from "../src/services/drive-store";
import type { SutraPadDocument, SutraPadIndex } from "../src/types";

// --- fetch mock helpers ---

function mockFetch(handler: (url: string, options?: RequestInit) => Response): void {
  vi.stubGlobal("fetch", vi.fn(handler));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fileList(files: unknown[]): Response {
  return json({ files });
}

function driveFile(id: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name, mimeType: "application/json", appProperties: {}, parents: ["root"], ...extra };
}

// URL patterns – Drive API encodes query params with encodeURIComponent:
// value='folder' → value%3D%27folder%27, value='index' → value%3D%27index%27
const isFolderSearch = (url: string): boolean => url.includes("google-apps.folder");
const isIndexSearch = (url: string): boolean => url.includes("'index'") && url.includes("q=");
const isContent = (url: string, id: string): boolean => url.includes(`/${id}?alt=media`);
const isMetadata = (url: string, id: string): boolean => url.includes(`/${id}?fields=`);
const isUpload = (_url: string, options?: RequestInit): boolean =>
  options?.method === "POST" || options?.method === "PATCH";

// --- tests ---

describe("GoogleDriveStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("loadWorkspace", () => {
    it("returns an empty workspace when Drive has no SutraPad files", async () => {
      mockFetch(() => fileList([]));

      const store = new GoogleDriveStore("test-token");
      const workspace = await store.loadWorkspace();

      expect(workspace.notes).toHaveLength(1);
      expect(workspace.notes[0].title).toBe("My first note");
      expect(workspace.notes[0].tags).toEqual([]);
    });

    it("loads notes from Drive into the workspace", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const indexFile = driveFile("index-1", "sutrapad-index.json");

      const index: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{ id: "note-abc", title: "My note", updatedAt: "2026-04-13T10:00:00.000Z", fileId: "note-file-1" }],
      };

      const note: SutraPadDocument = {
        id: "note-abc",
        title: "My note",
        body: "Hello world",
        tags: ["work"],
        updatedAt: "2026-04-13T10:00:00.000Z",
      };

      mockFetch((url) => {
        if (isFolderSearch(url)) return fileList([folder]);
        if (isIndexSearch(url)) return fileList([indexFile]);
        if (isContent(url, "index-1")) return json(index);
        if (isContent(url, "note-file-1")) return json(note);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      const workspace = await store.loadWorkspace();

      expect(workspace.notes).toHaveLength(1);
      expect(workspace.notes[0].id).toBe("note-abc");
      expect(workspace.notes[0].body).toBe("Hello world");
      expect(workspace.notes[0].tags).toEqual(["work"]);
      expect(workspace.activeNoteId).toBe("note-abc");
    });

    it("defaults tags to [] when loading a note saved before tags were introduced", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const indexFile = driveFile("index-1", "sutrapad-index.json");

      const index: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "old-note",
        notes: [{ id: "old-note", title: "Old", updatedAt: "2026-04-13T10:00:00.000Z", fileId: "note-file-1" }],
      };

      // Note without the tags field – simulates data saved before this feature
      const legacyNote = { id: "old-note", title: "Old", body: "Legacy", updatedAt: "2026-04-13T10:00:00.000Z" };

      mockFetch((url) => {
        if (isFolderSearch(url)) return fileList([folder]);
        if (isIndexSearch(url)) return fileList([indexFile]);
        if (isContent(url, "index-1")) return json(index);
        if (isContent(url, "note-file-1")) return json(legacyNote);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      const workspace = await store.loadWorkspace();

      expect(workspace.notes[0].tags).toEqual([]);
    });
  });

  describe("saveWorkspace", () => {
    it("skips uploading a note that has not changed since the last save", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const indexFile = driveFile("index-1", "sutrapad-index.json");

      const existingIndex: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{ id: "note-abc", title: "My note", updatedAt: "2026-04-13T10:00:00.000Z", fileId: "note-file-1" }],
      };

      const uploadedUrls: string[] = [];

      mockFetch((url, options) => {
        if (isUpload(url, options)) {
          uploadedUrls.push(url);
          return json(driveFile("new-file", "file.json"));
        }
        if (isFolderSearch(url)) return fileList([folder]);
        if (isIndexSearch(url)) return fileList([indexFile]);
        if (isContent(url, "index-1")) return json(existingIndex);
        if (isMetadata(url, "index-1")) return json(indexFile);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      await store.saveWorkspace({
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          body: "No changes",
          tags: [],
          updatedAt: "2026-04-13T10:00:00.000Z", // stejné updatedAt jako v indexu → skip
        }],
      });

      // Note nesmí být uploadnutá, jen index
      const noteUploads = uploadedUrls.filter((url) => url.includes("note-file-1"));
      expect(noteUploads).toHaveLength(0);
    });

    it("uploads a note that has been modified since the last save", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const indexFile = driveFile("index-1", "sutrapad-index.json");
      const noteFile = driveFile("note-file-1", "note-abc.json", { parents: ["folder-1"] });

      const existingIndex: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{ id: "note-abc", title: "My note", updatedAt: "2026-04-13T10:00:00.000Z", fileId: "note-file-1" }],
      };

      const noteUploadedUrls: string[] = [];

      mockFetch((url, options) => {
        if (isUpload(url, options) && url.includes("note-file-1")) {
          noteUploadedUrls.push(url);
          return json(noteFile);
        }
        if (isUpload(url, options)) return json(driveFile("new-file", "file.json"));
        if (isFolderSearch(url)) return fileList([folder]);
        if (isIndexSearch(url)) return fileList([indexFile]);
        if (isContent(url, "index-1")) return json(existingIndex);
        if (isMetadata(url, "note-file-1")) return json(noteFile);
        if (isMetadata(url, "index-1")) return json(indexFile);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      await store.saveWorkspace({
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          body: "Updated body",
          tags: ["work"],
          updatedAt: "2026-04-13T12:00:00.000Z", // novější updatedAt → upload
        }],
      });

      expect(noteUploadedUrls).toHaveLength(1);
    });
  });
});
