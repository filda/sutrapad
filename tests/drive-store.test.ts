import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleDriveApiError,
  GoogleDriveStore,
  isAuthExpiredError,
} from "../src/services/drive-store";
import type { SutraPadHead, SutraPadIndex } from "../src/types";

function mockFetch(handler: (url: string, options?: RequestInit) => Response | Promise<Response>): void {
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

const isFolderSearch = (url: string): boolean => url.includes("google-apps.folder");
const isHeadSearch = (url: string): boolean => url.includes("'head'") && url.includes("q=");
const isIndexSearch = (url: string): boolean => url.includes("'index'") && url.includes("q=");
const isTagSearch = (url: string): boolean => url.includes("'tags'") && url.includes("q=");
const isContent = (url: string, id: string): boolean => url.includes(`/${id}?alt=media`);
const isMetadata = (url: string, id: string): boolean => url.includes(`/${id}?fields=`);
const isUpload = (_url: string, options?: RequestInit): boolean =>
  options?.method === "POST" || options?.method === "PATCH";

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

    it("loads notes from the active index referenced by the head file", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const headFile = driveFile("head-1", "sutrapad-head.json");
      const indexFile = driveFile("index-1", "index-2026-04-13T10-00-00-000Z.json");
      const head: SutraPadHead = {
        version: 1,
        activeIndexId: "index-1",
        savedAt: "2026-04-13T10:00:00.000Z",
      };
      const index: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        savedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          fileId: "note-file-1",
        }],
      };
      const note = {
        id: "note-abc",
        title: "My note",
        body: "Hello world https://example.com/hello",
        tags: ["work"],
        createdAt: "2026-04-13T10:00:00.000Z",
        updatedAt: "2026-04-13T10:00:00.000Z",
      };

      mockFetch((url) => {
        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([headFile]);
        if (isContent(url, "head-1")) return json(head);
        if (isMetadata(url, "index-1")) return json(indexFile);
        if (isContent(url, "index-1")) return json(index);
        if (isContent(url, "note-file-1")) return json(note);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      const workspace = await store.loadWorkspace();

      expect(workspace.notes).toHaveLength(1);
      expect(workspace.notes[0].id).toBe("note-abc");
      expect(workspace.notes[0].body).toBe("Hello world https://example.com/hello");
      expect(workspace.notes[0].tags).toEqual(["work"]);
      expect(workspace.notes[0].urls).toEqual(["https://example.com/hello"]);
      expect(workspace.activeNoteId).toBe("note-abc");
    });

    it("falls back to the legacy index search when the head file is missing", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const indexFile = driveFile("index-1", "sutrapad-index.json");
      const index: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        savedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "old-note",
        notes: [{
          id: "old-note",
          title: "Old",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          fileId: "note-file-1",
        }],
      };
      const legacyNote = {
        id: "old-note",
        title: "Old",
        body: "Legacy https://example.com/legacy",
        createdAt: "2026-04-13T10:00:00.000Z",
        updatedAt: "2026-04-13T10:00:00.000Z",
      };

      mockFetch((url) => {
        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([indexFile]);
        if (isContent(url, "index-1")) return json(index);
        if (isContent(url, "note-file-1")) return json(legacyNote);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      const workspace = await store.loadWorkspace();

      expect(workspace.notes[0].tags).toEqual([]);
      expect(workspace.notes[0].urls).toEqual(["https://example.com/legacy"]);
    });
  });

  describe("error handling", () => {
    it("throws a typed GoogleDriveApiError with status 401 when the access token is rejected", async () => {
      mockFetch(() =>
        new Response(
          JSON.stringify({ error: { message: "Request had invalid authentication credentials." } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );

      const store = new GoogleDriveStore("expired-token");
      const error = await store.loadWorkspace().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GoogleDriveApiError);
      expect(isAuthExpiredError(error)).toBe(true);
      if (error instanceof GoogleDriveApiError) {
        expect(error.status).toBe(401);
        expect(error.googleMessage).toBe("Request had invalid authentication credentials.");
      }
    });

    it("throws a GoogleDriveApiError with the HTTP status for non-auth failures", async () => {
      mockFetch(() => new Response("boom", { status: 500 }));

      const store = new GoogleDriveStore("token");
      const error = await store.loadWorkspace().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GoogleDriveApiError);
      expect(isAuthExpiredError(error)).toBe(false);
      if (error instanceof GoogleDriveApiError) {
        expect(error.status).toBe(500);
      }
    });
  });

  describe("saveWorkspace", () => {
    it("creates a new immutable index snapshot and updates the head pointer", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const legacyIndexFile = driveFile("index-1", "sutrapad-index.json");
      const tagIndexFile = driveFile("tags-1", "sutrapad-tags.json", { parents: ["folder-1"] });
      const newIndexFile = driveFile("index-2", "index-2026-04-13T12-00-00-000Z.json", { parents: ["folder-1"] });
      const headFile = driveFile("head-1", "sutrapad-head.json", { parents: ["folder-1"] });
      const existingIndex: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        savedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          fileId: "note-file-1",
        }],
      };
      const uploadMetadata: string[] = [];
      const uploadFiles: string[] = [];

      mockFetch(async (url, options) => {
        if (isUpload(url, options)) {
          if (options?.body instanceof FormData) {
            const metadataBlob = options.body.get("metadata");
            const fileBlob = options.body.get("file");
            if (metadataBlob instanceof Blob) {
              uploadMetadata.push(await metadataBlob.text());
            }
            if (fileBlob instanceof Blob) {
              uploadFiles.push(await fileBlob.text());
            }
          }

          if (options?.method === "POST") return json(newIndexFile);
          if (url.includes("/tags-1?uploadType=multipart")) return json(tagIndexFile);
          if (url.includes("/sutrapad-links.json?uploadType=multipart")) return json(driveFile("links-1", "sutrapad-links.json", { parents: ["folder-1"] }));
          return json(headFile);
        }

        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([legacyIndexFile]);
        if (isTagSearch(url)) return fileList([tagIndexFile]);
        if (isContent(url, "index-1")) return json(existingIndex);
        if (isMetadata(url, "index-2")) return json(newIndexFile);
        if (isMetadata(url, "tags-1")) return json(tagIndexFile);
        if (isMetadata(url, "head-1")) return json(headFile);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      await store.saveWorkspace({
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          body: "No changes",
          urls: [],
          tags: ["work"],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
        }],
      });

      expect(uploadMetadata).toHaveLength(4);
      expect(uploadFiles).toHaveLength(4);
      expect(uploadMetadata[0]).toContain('"kind":"index"');
      expect(uploadMetadata[1]).toContain('"kind":"tags"');
      expect(uploadFiles[1]).toContain('"tag": "work"');
      expect(uploadFiles[1]).toContain('"noteIds": [');
      expect(uploadMetadata[2]).toContain('"kind":"links"');
      expect(uploadFiles[2]).toContain('"links": []');
      expect(uploadMetadata[3]).toContain('"kind":"head"');
    });

    it("uploads a modified note before writing the new snapshot and head", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const legacyIndexFile = driveFile("index-1", "sutrapad-index.json");
      const noteFile = driveFile("note-file-1", "note-abc.json", { parents: ["folder-1"] });
      const tagIndexFile = driveFile("tags-1", "sutrapad-tags.json", { parents: ["folder-1"] });
      const newIndexFile = driveFile("index-2", "index-2026-04-13T12-00-00-000Z.json", { parents: ["folder-1"] });
      const headFile = driveFile("head-1", "sutrapad-head.json", { parents: ["folder-1"] });
      const existingIndex: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        savedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          fileId: "note-file-1",
        }],
      };
      const noteUploadUrls: string[] = [];

      mockFetch((url, options) => {
        if (isUpload(url, options) && url.includes("note-file-1")) {
          noteUploadUrls.push(url);
          return json(noteFile);
        }
        if (isUpload(url, options)) {
          if (options?.method === "POST") return json(newIndexFile);
          if (url.includes("/tags-1?uploadType=multipart")) return json(tagIndexFile);
          if (url.includes("/sutrapad-links.json?uploadType=multipart")) return json(driveFile("links-1", "sutrapad-links.json", { parents: ["folder-1"] }));
          return json(headFile);
        }

        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([legacyIndexFile]);
        if (isTagSearch(url)) return fileList([tagIndexFile]);
        if (isContent(url, "index-1")) return json(existingIndex);
        if (isMetadata(url, "note-file-1")) return json(noteFile);
        if (isMetadata(url, "index-2")) return json(newIndexFile);
        if (isMetadata(url, "tags-1")) return json(tagIndexFile);
        if (isMetadata(url, "head-1")) return json(headFile);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      await store.saveWorkspace({
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          body: "Updated body https://example.com/updated",
          urls: ["https://example.com/updated"],
          tags: ["work"],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T12:00:00.000Z",
        }],
      });

      expect(noteUploadUrls).toHaveLength(1);
    });

    it("keeps only the 10 newest index snapshots after a successful save", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const currentIndexFile = driveFile("index-current", "index-2026-04-13T10-00-00-000Z.json", {
        parents: ["folder-1"],
      });
      const tagIndexFile = driveFile("tags-1", "sutrapad-tags.json", { parents: ["folder-1"] });
      const createdIndexFile = driveFile("index-new", "index-2026-04-13T12-00-00-000Z.json", {
        parents: ["folder-1"],
      });
      const headFile = driveFile("head-1", "sutrapad-head.json", { parents: ["folder-1"] });
      const existingIndex: SutraPadIndex = {
        version: 1,
        updatedAt: "2026-04-13T10:00:00.000Z",
        savedAt: "2026-04-13T10:00:00.000Z",
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
          fileId: "note-file-1",
        }],
      };
      const snapshotFiles = Array.from({ length: 12 }, (_, index) =>
        driveFile(
          `index-old-${index + 1}`,
          `index-2026-04-13T${String(index).padStart(2, "0")}-00-00-000Z.json`,
          { parents: ["folder-1"] },
        ),
      );
      const deletedUrls: string[] = [];

      mockFetch((url, options) => {
        if (options?.method === "DELETE") {
          deletedUrls.push(url);
          return new Response(null, { status: 204 });
        }

        if (isUpload(url, options)) {
          if (options?.method === "POST") return json(createdIndexFile);
          if (url.includes("/tags-1?uploadType=multipart")) return json(tagIndexFile);
          if (url.includes("/sutrapad-links.json?uploadType=multipart")) return json(driveFile("links-1", "sutrapad-links.json", { parents: ["folder-1"] }));
          return json(headFile);
        }

        if (url.includes("pageSize=30") && isIndexSearch(url)) {
          return fileList([...snapshotFiles, createdIndexFile]);
        }
        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([currentIndexFile]);
        if (isTagSearch(url)) return fileList([tagIndexFile]);
        if (isContent(url, "index-current")) return json(existingIndex);
        if (isMetadata(url, "index-new")) return json(createdIndexFile);
        if (isMetadata(url, "tags-1")) return json(tagIndexFile);
        if (isMetadata(url, "head-1")) return json(headFile);
        return fileList([]);
      });

      const store = new GoogleDriveStore("test-token");
      await store.saveWorkspace({
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          body: "No changes",
          urls: [],
          tags: [],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
        }],
      });

      expect(deletedUrls).toHaveLength(3);
      expect(deletedUrls.some((url) => url.includes("/index-new"))).toBe(false);
    });
  });
});
