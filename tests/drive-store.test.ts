import { afterEach, describe, expect, it, vi } from "vitest";
import {
  escapeDriveQueryValue,
  GoogleDriveApiError,
  GoogleDriveStore,
  isAuthExpiredError,
} from "../src/services/drive-store";
import type { SutraPadHead, SutraPadIndex } from "../src/types";

type FetchHandler = (url: string, options?: RequestInit) => Response | Promise<Response>;

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
const isTaskSearch = (url: string): boolean => url.includes("'tasks'") && url.includes("q=");
const isContent = (url: string, id: string): boolean => url.includes(`/${id}?alt=media`);
const isMetadata = (url: string, id: string): boolean => url.includes(`/${id}?fields=`);
const isUpload = (_url: string, options?: RequestInit): boolean =>
  options?.method === "POST" || options?.method === "PATCH";

async function captureError<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (caught) {
    return caught;
  }
}

function cloneResponse(response: Response): Response {
  return response.clone();
}

function createEmptyListHandler(): Response {
  return fileList([]);
}

function createLoadWorkspaceHandler(
  responses: Record<string, Response>,
): FetchHandler {
  return (url) => {
    if (isFolderSearch(url) && responses.folder) return cloneResponse(responses.folder);
    if (isHeadSearch(url) && responses.headSearch) return cloneResponse(responses.headSearch);
    if (isIndexSearch(url) && responses.indexSearch) return cloneResponse(responses.indexSearch);

    for (const [key, response] of Object.entries(responses)) {
      if (key.startsWith("content:") && isContent(url, key.slice("content:".length))) {
        return cloneResponse(response);
      }
      if (key.startsWith("metadata:") && isMetadata(url, key.slice("metadata:".length))) {
        return cloneResponse(response);
      }
    }

    return fileList([]);
  };
}

function createSaveUploadResponse(
  url: string,
  options: RequestInit | undefined,
  responses: {
    createdIndexFile: Response;
    tagIndexFile: Response;
    taskIndexFile: Response;
    headFile: Response;
  },
): Response {
  if (options?.method === "POST") return cloneResponse(responses.createdIndexFile);
  if (url.includes("/tags-1?uploadType=multipart")) return cloneResponse(responses.tagIndexFile);
  if (url.includes("/sutrapad-tasks.json?uploadType=multipart")) return cloneResponse(responses.taskIndexFile);
  if (url.includes("/sutrapad-links.json?uploadType=multipart")) {
    return json(driveFile("links-1", "sutrapad-links.json", { parents: ["folder-1"] }));
  }
  return cloneResponse(responses.headFile);
}

function createStaticResponseHandler(response: Response): FetchHandler {
  return () => cloneResponse(response);
}

function includesDeletedSnapshot(deletedUrls: string[], fragment: string): boolean {
  for (const deletedUrl of deletedUrls) {
    if (deletedUrl.includes(fragment)) {
      return true;
    }
  }
  return false;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoogleDriveStore loadWorkspace", () => {
  it("returns an empty workspace when Drive has no SutraPad files", async () => {
    mockFetch(createEmptyListHandler);

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

    mockFetch(
      createLoadWorkspaceHandler({
        folder: fileList([folder]),
        headSearch: fileList([headFile]),
        "content:head-1": json(head),
        "metadata:index-1": json(indexFile),
        "content:index-1": json(index),
        "content:note-file-1": json(note),
      }),
    );

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

    mockFetch(
      createLoadWorkspaceHandler({
        folder: fileList([folder]),
        headSearch: fileList([]),
        indexSearch: fileList([indexFile]),
        "content:index-1": json(index),
        "content:note-file-1": json(legacyNote),
      }),
    );

    const store = new GoogleDriveStore("test-token");
    const workspace = await store.loadWorkspace();

    expect(workspace.notes[0].tags).toEqual([]);
    expect(workspace.notes[0].urls).toEqual(["https://example.com/legacy"]);
  });
});

describe("GoogleDriveStore error handling", () => {
  it("throws a typed GoogleDriveApiError with status 401 when the access token is rejected", async () => {
    const authRejectedResponse = new Response(
      JSON.stringify({ error: { message: "Request had invalid authentication credentials." } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
    mockFetch(createStaticResponseHandler(authRejectedResponse));

    const store = new GoogleDriveStore("expired-token");
    const error = await captureError(store.loadWorkspace());

    expect(error).toBeInstanceOf(GoogleDriveApiError);
    expect(isAuthExpiredError(error)).toBe(true);
    if (error instanceof GoogleDriveApiError) {
      expect(error.status).toBe(401);
      expect(error.googleMessage).toBe("Request had invalid authentication credentials.");
    }
  });

  it("throws a GoogleDriveApiError with the HTTP status for non-auth failures", async () => {
    const serverErrorResponse = new Response("boom", { status: 500 });
    mockFetch(createStaticResponseHandler(serverErrorResponse));

    const store = new GoogleDriveStore("token");
    const error = await captureError(store.loadWorkspace());

    expect(error).toBeInstanceOf(GoogleDriveApiError);
    expect(isAuthExpiredError(error)).toBe(false);
    if (error instanceof GoogleDriveApiError) {
      expect(error.status).toBe(500);
    }
  });
});

describe("GoogleDriveStore saveWorkspace", () => {
  it("creates a new immutable index snapshot and updates the head pointer", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const legacyIndexFile = driveFile("index-1", "sutrapad-index.json");
      const tagIndexFile = driveFile("tags-1", "sutrapad-tags.json", { parents: ["folder-1"] });
      const taskIndexFile = driveFile("tasks-1", "sutrapad-tasks.json", { parents: ["folder-1"] });
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

      const saveHandler: FetchHandler = async (url, options) => {
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

          return createSaveUploadResponse(url, options, {
            createdIndexFile: json(newIndexFile),
            tagIndexFile: json(tagIndexFile),
            taskIndexFile: json(taskIndexFile),
            headFile: json(headFile),
          });
        }

        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([legacyIndexFile]);
        if (isTagSearch(url)) return fileList([tagIndexFile]);
        if (isTaskSearch(url)) return fileList([]);
        if (isContent(url, "index-1")) return json(existingIndex);
        if (isMetadata(url, "index-2")) return json(newIndexFile);
        if (isMetadata(url, "tags-1")) return json(tagIndexFile);
        if (isMetadata(url, "tasks-1")) return json(taskIndexFile);
        if (isMetadata(url, "head-1")) return json(headFile);
        return fileList([]);
      };
      mockFetch(saveHandler);

      const store = new GoogleDriveStore("test-token");
      await store.saveWorkspace({
        activeNoteId: "note-abc",
        notes: [{
          id: "note-abc",
          title: "My note",
          body: "[ ] buy milk\n[x] ship it",
          urls: [],
          tags: ["work"],
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
        }],
      });

      expect(uploadMetadata).toHaveLength(5);
      expect(uploadFiles).toHaveLength(5);
      expect(uploadMetadata[0]).toContain('"kind":"index"');
      expect(uploadMetadata[1]).toContain('"kind":"tags"');
      expect(uploadFiles[1]).toContain('"tag": "work"');
      expect(uploadFiles[1]).toContain('"noteIds": [');
      expect(uploadMetadata[2]).toContain('"kind":"links"');
      expect(uploadFiles[2]).toContain('"links": []');
      expect(uploadMetadata[3]).toContain('"kind":"tasks"');
      expect(uploadFiles[3]).toContain('"text": "buy milk"');
      expect(uploadFiles[3]).toContain('"text": "ship it"');
      expect(uploadFiles[3]).toContain('"done": false');
      expect(uploadFiles[3]).toContain('"done": true');
      expect(uploadMetadata[4]).toContain('"kind":"head"');
  });

  it("uploads a modified note before writing the new snapshot and head", async () => {
      const folder = driveFile("folder-1", "SutraPad", { mimeType: "application/vnd.google-apps.folder" });
      const legacyIndexFile = driveFile("index-1", "sutrapad-index.json");
      const noteFile = driveFile("note-file-1", "note-abc.json", { parents: ["folder-1"] });
      const tagIndexFile = driveFile("tags-1", "sutrapad-tags.json", { parents: ["folder-1"] });
      const taskIndexFile = driveFile("tasks-1", "sutrapad-tasks.json", { parents: ["folder-1"] });
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

      const saveModifiedNoteHandler: FetchHandler = (url, options) => {
        if (isUpload(url, options) && url.includes("note-file-1")) {
          noteUploadUrls.push(url);
          return json(noteFile);
        }
        if (isUpload(url, options)) {
          return createSaveUploadResponse(url, options, {
            createdIndexFile: json(newIndexFile),
            tagIndexFile: json(tagIndexFile),
            taskIndexFile: json(taskIndexFile),
            headFile: json(headFile),
          });
        }

        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([legacyIndexFile]);
        if (isTagSearch(url)) return fileList([tagIndexFile]);
        if (isTaskSearch(url)) return fileList([]);
        if (isContent(url, "index-1")) return json(existingIndex);
        if (isMetadata(url, "note-file-1")) return json(noteFile);
        if (isMetadata(url, "index-2")) return json(newIndexFile);
        if (isMetadata(url, "tags-1")) return json(tagIndexFile);
        if (isMetadata(url, "tasks-1")) return json(taskIndexFile);
        if (isMetadata(url, "head-1")) return json(headFile);
        return fileList([]);
      };
      mockFetch(saveModifiedNoteHandler);

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
      const taskIndexFile = driveFile("tasks-1", "sutrapad-tasks.json", { parents: ["folder-1"] });
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
      const snapshotFiles: Array<Record<string, unknown>> = [];
      for (let index = 0; index < 12; index += 1) {
        snapshotFiles.push(
          driveFile(
            `index-old-${index + 1}`,
            `index-2026-04-13T${String(index).padStart(2, "0")}-00-00-000Z.json`,
            { parents: ["folder-1"] },
          ),
        );
      }
      const deletedUrls: string[] = [];

      const pruneSnapshotsHandler: FetchHandler = (url, options) => {
        if (options?.method === "DELETE") {
          deletedUrls.push(url);
          return new Response(null, { status: 204 });
        }

        if (isUpload(url, options)) {
          return createSaveUploadResponse(url, options, {
            createdIndexFile: json(createdIndexFile),
            tagIndexFile: json(tagIndexFile),
            taskIndexFile: json(taskIndexFile),
            headFile: json(headFile),
          });
        }

        if (url.includes("pageSize=30") && isIndexSearch(url)) {
          return fileList([...snapshotFiles, createdIndexFile]);
        }
        if (isFolderSearch(url)) return fileList([folder]);
        if (isHeadSearch(url)) return fileList([]);
        if (isIndexSearch(url)) return fileList([currentIndexFile]);
        if (isTagSearch(url)) return fileList([tagIndexFile]);
        if (isTaskSearch(url)) return fileList([]);
        if (isContent(url, "index-current")) return json(existingIndex);
        if (isMetadata(url, "index-new")) return json(createdIndexFile);
        if (isMetadata(url, "tags-1")) return json(tagIndexFile);
        if (isMetadata(url, "tasks-1")) return json(taskIndexFile);
        if (isMetadata(url, "head-1")) return json(headFile);
        return fileList([]);
      };
      mockFetch(pruneSnapshotsHandler);

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
    expect(includesDeletedSnapshot(deletedUrls, "/index-new")).toBe(false);
  });
});

describe("escapeDriveQueryValue", () => {
  it("passes plain alphanumerics through unchanged", () => {
    expect(escapeDriveQueryValue("sutrapad-index.json")).toBe(
      "sutrapad-index.json",
    );
    expect(escapeDriveQueryValue("01H8XYZ-uuid-like")).toBe("01H8XYZ-uuid-like");
  });

  it("escapes single quotes that would otherwise terminate the string", () => {
    // The Drive query language uses single quotes as string delimiters.
    // Without escaping, a value of `O'Brien` would close the string and
    // turn the rest of the query into syntactic garbage at best —
    // injection at worst.
    expect(escapeDriveQueryValue("O'Brien")).toBe("O\\'Brien");
  });

  it("escapes backslashes before processing quotes", () => {
    // Double-replacement order matters: if we escaped quotes first,
    // the second pass would turn `\\` → `\\\\`, doubling every
    // legitimate backslash. The code does backslashes first.
    expect(escapeDriveQueryValue("a\\b")).toBe("a\\\\b");
    expect(escapeDriveQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });

  it("handles empty strings as a no-op", () => {
    expect(escapeDriveQueryValue("")).toBe("");
  });

  it("escapes a classic injection payload", () => {
    // Pin the failure mode the helper exists to defeat: a value
    // containing `' or '1'='1` would otherwise turn a `value='${x}'`
    // clause into `value='' or '1'='1'` and bypass the appProperties
    // filter. Escaped, the apostrophes become literal payload.
    expect(escapeDriveQueryValue("' or '1'='1")).toBe(
      "\\' or \\'1\\'=\\'1",
    );
  });
});
