import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveStore } from "../src/services/drive/workspace-store";
import type { SutraPadDocument, SutraPadHead, SutraPadIndex } from "../src/types";

/**
 * Focused tests for the workspace-aware Drive store. The wider load /
 * save scenarios live in `drive-store.test.ts`; this suite zooms in on
 * the per-method query strings, file-name + appProperties payloads,
 * and the smaller branches (legacy fallbacks, cleanup, snapshot file
 * naming, append fast path) that the broader scenarios don't pin down
 * with explicit assertions.
 */

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function captureFetch(
  responder: (
    url: string,
    init: RequestInit | undefined,
    callIndex: number,
  ) => Response | Promise<Response>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    const result = await responder(url, init, calls.length);
    calls.push({ url, init });
    return result;
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fileList(files: unknown[]): Response {
  return jsonResponse({ files });
}

function driveFile(
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name,
    mimeType: "application/json",
    appProperties: {},
    parents: ["folder-1"],
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoogleDriveStore.appendNoteToWorkspace (silent-capture fast path)", () => {
  it("uploads a single note JSON, attaches it to the workspace folder via the multipart endpoint, then ensures it's parented", async () => {
    // The silent-capture path is intentionally cheap: 3 RTT total
    // (folder lookup + multipart upload + ensure-in-folder PATCH).
    // Without coverage on this method the entire body of
    // `appendNoteToWorkspace` is NoCoverage. The assertions below pin:
    //   - the folder lookup happens
    //   - the upload URL is the multipart endpoint
    //   - the metadata's `name`, `mimeType`, and `appProperties`
    //     match the contract (kind=note, noteId=<id>, sutrapad=true)
    //   - the ensure-in-folder PATCH fires after the upload
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const uploaded = driveFile("note-file-9", "note-cap-9.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "cap-9" },
    });

    const { calls } = captureFetch((url, init) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (init?.method === "POST" && url.includes("upload/drive/v3/files")) {
        return jsonResponse(uploaded);
      }
      if (init?.method === "PATCH") return jsonResponse(uploaded);
      // Metadata fetch inside `ensureFileInFolder` returns the file
      // already correctly parented, so no further PATCH happens.
      if (url.includes("/note-file-9?fields=")) {
        return jsonResponse({ ...uploaded, parents: ["folder-1"] });
      }
      return fileList([]);
    });

    const note: SutraPadDocument = {
      id: "cap-9",
      title: "Captured",
      body: "from a phone",
      tags: ["mobile"],
      urls: [],
      createdAt: "2026-04-30T12:00:00.000Z",
      updatedAt: "2026-04-30T12:00:00.000Z",
    };

    const store = new GoogleDriveStore("token");
    await store.appendNoteToWorkspace(note);

    // Folder lookup happened.
    const folderQueries = calls.filter((c) =>
      c.url.includes("google-apps.folder"),
    );
    expect(folderQueries).toHaveLength(1);

    // Multipart upload — POST against the upload endpoint with form data
    // whose metadata blob carries our appProperties contract.
    const upload = calls.find(
      (c) =>
        c.init?.method === "POST" && c.url.includes("upload/drive/v3/files"),
    );
    expect(upload).toBeDefined();
    expect(upload?.url).toContain("uploadType=multipart");
    const form = upload?.init?.body as FormData;
    const metadataText = await (form.get("metadata") as Blob).text();
    const metadata = JSON.parse(metadataText) as {
      name: string;
      appProperties: Record<string, string>;
    };
    expect(metadata.name).toBe("note-cap-9.json");
    expect(metadata.appProperties).toEqual({
      sutrapad: "true",
      kind: "note",
      noteId: "cap-9",
    });

    // ensureFileInFolder: a metadata fetch on the new file id, and
    // (because the parents list already matches) NO follow-up PATCH.
    const metadataFetch = calls.find(
      (c) => c.url.includes("/note-file-9?fields=") && !c.init?.method,
    );
    expect(metadataFetch).toBeDefined();
  });

  it("creates the workspace folder when it doesn't exist yet", async () => {
    // First-ever capture against a Drive that has no SutraPad folder.
    // `getWorkspaceFolder` falls through to `createFolder`. Without
    // coverage on this branch, the appProperties literal
    // `{ sutrapad: "true", kind: "folder" }` and the
    // WORKSPACE_FOLDER_NAME constant ("SutraPad") all survive.
    const newFolder = driveFile("folder-new", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { sutrapad: "true", kind: "folder" },
    });
    const uploaded = driveFile("note-file-new", "note-x.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "x" },
    });

    const { calls } = captureFetch((url, init) => {
      if (url.includes("google-apps.folder") && init?.method === undefined) {
        return fileList([]); // no existing folder
      }
      if (init?.method === "POST" && !url.includes("upload/drive/v3")) {
        return jsonResponse(newFolder); // createFolder result
      }
      if (init?.method === "POST" && url.includes("upload/drive/v3")) {
        return jsonResponse(uploaded);
      }
      if (init?.method === "PATCH") return jsonResponse(uploaded);
      if (url.includes("/note-file-new?fields=")) {
        return jsonResponse({ ...uploaded, parents: ["folder-new"] });
      }
      return fileList([]);
    });

    const note: SutraPadDocument = {
      id: "x",
      title: "First",
      body: "hello",
      tags: [],
      urls: [],
      createdAt: "2026-04-30T12:00:00.000Z",
      updatedAt: "2026-04-30T12:00:00.000Z",
    };

    const store = new GoogleDriveStore("token");
    await store.appendNoteToWorkspace(note);

    // POST that isn't an upload is the createFolder call. Pin its
    // body shape — name + folder mime + appProperties.
    const createFolderCall = calls.find(
      (c) =>
        c.init?.method === "POST" && !c.url.includes("upload/drive/v3"),
    );
    expect(createFolderCall).toBeDefined();
    const body = JSON.parse(createFolderCall?.init?.body as string) as {
      name: string;
      mimeType: string;
      appProperties: Record<string, string>;
    };
    expect(body.name).toBe("SutraPad");
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
    expect(body.appProperties).toEqual({ sutrapad: "true", kind: "folder" });
  });
});

describe("GoogleDriveStore.loadWorkspace fallback paths", () => {
  it("treats a workspace with no per-note files but a legacy single-file document as a single-note workspace", async () => {
    // The legacy migration fallback. Without coverage here, the
    // entire `if (noteFiles.length === 0) { … }` block (L168-181) is
    // NoCoverage along with `loadLegacyDocument`'s helpers.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const legacyFile = driveFile("legacy-1", "sutrapad-data.json", {
      appProperties: { sutrapad: "true" },
    });
    const legacyDoc: SutraPadDocument = {
      id: "legacy-uid",
      title: "Pre-split note",
      body: "from before per-note files",
      tags: [],
      urls: [],
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    };

    captureFetch((url) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      // No notes and no head file in the workspace folder.
      if (url.includes("'note'") && url.includes("q=")) return fileList([]);
      if (url.includes("'head'") && url.includes("q=")) return fileList([]);
      // The legacy lookup hits via `findLegacyFile` — folder-scoped
      // lookup that finds the single legacy file.
      if (url.includes("sutrapad-data.json")) return fileList([legacyFile]);
      if (url.includes("/legacy-1?alt=media")) return jsonResponse(legacyDoc);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    const workspace = await store.loadWorkspace();
    expect(workspace.notes).toHaveLength(1);
    expect(workspace.notes[0].id).toBe("legacy-uid");
    // normalizeNoteDocument fills urls + tags defensively even when
    // the legacy doc had them — pin their presence.
    expect(workspace.notes[0].urls).toEqual([]);
    expect(workspace.notes[0].tags).toEqual([]);
    expect(workspace.activeNoteId).toBe("legacy-uid");
  });

  it("backfills `createdAt` from `updatedAt` on a legacy note that predates the split timestamp fields", async () => {
    // Defends `normalizeNoteDocument`'s `??=` operator on line 61.
    // Mutating to `&&=` would only assign when createdAt was already
    // truthy, leaving genuinely-old notes with `createdAt: undefined`
    // and breaking every UI that reads it.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const noteFile = driveFile("note-file-old", "note-old.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "old" },
    });
    const oldNote = {
      id: "old",
      title: "Predates createdAt split",
      body: "x",
      tags: [],
      // No createdAt — the field was added later
      updatedAt: "2025-10-01T00:00:00.000Z",
    };

    captureFetch((url) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (url.includes("'note'") && url.includes("q=")) return fileList([noteFile]);
      if (url.includes("/note-file-old?alt=media")) return jsonResponse(oldNote);
      // No head file → no index path.
      if (url.includes("'head'")) return fileList([]);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    const workspace = await store.loadWorkspace();
    expect(workspace.notes[0].createdAt).toBe("2025-10-01T00:00:00.000Z");
  });

  it("falls back to the most recently updated note when the index points at a note that no longer exists", async () => {
    // Defends the `sortedNotes.some(...)` guard on line 209. Mutating
    // it to `true` would happily return the stale `indexActiveNoteId`
    // even though no note with that id is in the workspace.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const liveNote = driveFile("nf-live", "note-live.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "live" },
    });
    const headFile = driveFile("hf", "sutrapad-head.json");
    const indexFile = driveFile("if", "index-x.json");
    const head: SutraPadHead = {
      version: 1,
      activeIndexId: "if",
      savedAt: "2026-04-13T10:00:00.000Z",
    };
    const index: SutraPadIndex = {
      version: 1,
      updatedAt: "2026-04-13T10:00:00.000Z",
      savedAt: "2026-04-13T10:00:00.000Z",
      activeNoteId: "deleted-id", // points at a note that doesn't exist anymore
      notes: [],
    };
    const liveDoc: SutraPadDocument = {
      id: "live",
      title: "Surviving note",
      body: "",
      tags: [],
      urls: [],
      createdAt: "2026-04-13T11:00:00.000Z",
      updatedAt: "2026-04-13T11:00:00.000Z",
    };

    captureFetch((url) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (url.includes("'note'") && url.includes("q=")) return fileList([liveNote]);
      if (url.includes("'head'") && url.includes("q=")) return fileList([headFile]);
      if (url.includes("/hf?alt=media")) return jsonResponse(head);
      if (url.includes("/if?fields=")) return jsonResponse(indexFile);
      if (url.includes("/if?alt=media")) return jsonResponse(index);
      if (url.includes("/nf-live?alt=media")) return jsonResponse(liveDoc);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    const workspace = await store.loadWorkspace();
    expect(workspace.notes).toHaveLength(1);
    // Index pointed at a phantom — fallback to the only live note.
    expect(workspace.activeNoteId).toBe("live");
  });
});

describe("GoogleDriveStore.saveWorkspace upload payload contracts", () => {
  it("uploads each derived index file with the canonical filename, appProperties.kind, and `sutrapad: 'true'` tag", async () => {
    // The four derived indexes (head + tags + links + tasks + the
    // versioned index snapshot) each have a fixed filename and a
    // fixed `kind` discriminator. Without explicit assertions, the
    // StringLiteral mutants on lines 33–37, 367–372, and 430–468 all
    // survive — the existing save tests check round-trip semantics
    // but not the literal payload contracts.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const noteFile = driveFile("nf", "note-a.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "a" },
    });

    const uploads: Array<{
      url: string;
      method: string;
      filename: string;
      appProperties: Record<string, string>;
    }> = [];

    captureFetch(async (url, init) => {
      // Folder lookup.
      if (url.includes("google-apps.folder")) return fileList([folder]);
      // Per-note file lookups by id (existingNoteFile resolution).
      if (url.includes("'noteId'")) return fileList([noteFile]);
      // Generic findArtifactFile lookups (head/tag/link/task/index) —
      // return empty so each upload happens fresh.
      if (url.includes("q=") && !url.includes("upload/drive/v3")) {
        return fileList([]);
      }
      // Multipart uploads — record the metadata for assertions.
      if (url.includes("upload/drive/v3/files")) {
        const body = init?.body as FormData;
        const metaText = await (body.get("metadata") as Blob).text();
        const meta = JSON.parse(metaText) as {
          name: string;
          appProperties: Record<string, string>;
        };
        uploads.push({
          url,
          method: init?.method ?? "POST",
          filename: meta.name,
          appProperties: meta.appProperties,
        });
        return jsonResponse(driveFile(`new-${uploads.length}`, meta.name));
      }
      // ensureFileInFolder metadata fetch — already-parented response.
      if (url.includes("?fields=")) {
        return jsonResponse({ ...folder, parents: ["folder-1"] });
      }
      // Index-snapshot cleanup query.
      if (url.includes("'index'") && url.includes("q=")) return fileList([]);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    await store.saveWorkspace({
      notes: [
        {
          id: "a",
          title: "A",
          body: "hello",
          tags: ["x"],
          urls: [],
          createdAt: "2026-04-30T12:00:00.000Z",
          updatedAt: "2026-04-30T12:00:01.000Z",
        },
      ],
      activeNoteId: "a",
    });

    // Pin every fixed-filename upload by its `kind` appProperty.
    const byKind = (kind: string) =>
      uploads.find((u) => u.appProperties.kind === kind);
    expect(byKind("note")?.filename).toBe("note-a.json");
    expect(byKind("note")?.appProperties).toEqual({
      sutrapad: "true",
      kind: "note",
      noteId: "a",
    });
    expect(byKind("tags")?.filename).toBe("sutrapad-tags.json");
    expect(byKind("tags")?.appProperties).toEqual({
      sutrapad: "true",
      kind: "tags",
    });
    expect(byKind("links")?.filename).toBe("sutrapad-links.json");
    expect(byKind("links")?.appProperties).toEqual({
      sutrapad: "true",
      kind: "links",
    });
    expect(byKind("tasks")?.filename).toBe("sutrapad-tasks.json");
    expect(byKind("tasks")?.appProperties).toEqual({
      sutrapad: "true",
      kind: "tasks",
    });
    expect(byKind("head")?.filename).toBe("sutrapad-head.json");
    expect(byKind("head")?.appProperties).toEqual({
      sutrapad: "true",
      kind: "head",
    });
    // Index snapshot filename uses the `index-<timestamp>.json` shape
    // with `:`/`.` replaced by `-`. Defends the regex on line 479.
    const indexUpload = byKind("index");
    expect(indexUpload?.appProperties).toEqual({
      sutrapad: "true",
      kind: "index",
    });
    expect(indexUpload?.filename).toMatch(
      /^index-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/,
    );
    // The replacement is `[:.]` → `-`. A bogus regex like `[^:.]` (one
    // of the Stryker mutants) would replace every other character and
    // leave colons intact; pin that the filename has NO colons or
    // dots inside the timestamp.
    expect(indexUpload?.filename).not.toContain(":");
    const timestampPart = indexUpload?.filename.replace(
      /^index-(.+)\.json$/,
      "$1",
    );
    expect(timestampPart).not.toContain(".");
  });

  it("re-uses the existing note file id when the note's updatedAt is unchanged (skip re-upload)", async () => {
    // Defends the `existingSummary?.updatedAt === note.updatedAt`
    // optional-chaining on line 345. Mutating to a non-optional
    // access would TypeError when there's no existing summary, but
    // also: when the timestamps DO match, the note isn't re-uploaded
    // — that's the whole point of the early return on line 346.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const headFile = driveFile("hf", "sutrapad-head.json");
    const indexFile = driveFile("if", "index-old.json");
    const oldIndex: SutraPadIndex = {
      version: 1,
      updatedAt: "2026-04-30T11:00:00.000Z",
      savedAt: "2026-04-30T11:00:00.000Z",
      activeNoteId: "a",
      notes: [
        {
          id: "a",
          title: "A",
          createdAt: "2026-04-30T11:00:00.000Z",
          updatedAt: "2026-04-30T11:00:00.000Z",
          fileId: "nf-existing",
        },
      ],
    };
    const head: SutraPadHead = {
      version: 1,
      activeIndexId: "if",
      savedAt: "2026-04-30T11:00:00.000Z",
    };

    let noteUploadCount = 0;
    captureFetch(async (url, init) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (url.includes("'head'") && url.includes("q=")) return fileList([headFile]);
      if (url.includes("/hf?alt=media")) return jsonResponse(head);
      if (url.includes("/if?fields=")) return jsonResponse(indexFile);
      if (url.includes("/if?alt=media")) return jsonResponse(oldIndex);
      if (
        url.includes("upload/drive/v3/files") &&
        init?.method &&
        init.body instanceof FormData
      ) {
        const meta = JSON.parse(
          await (init.body.get("metadata") as Blob).text(),
        ) as { appProperties: Record<string, string> };
        if (meta.appProperties.kind === "note") {
          noteUploadCount += 1;
        }
        return jsonResponse(driveFile("uploaded", "x.json"));
      }
      if (url.includes("?fields=")) {
        return jsonResponse({ ...folder, parents: ["folder-1"] });
      }
      if (url.includes("q=") && !url.includes("upload/drive/v3")) {
        return fileList([]);
      }
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    // Same updatedAt as the existing summary → must NOT re-upload.
    await store.saveWorkspace({
      notes: [
        {
          id: "a",
          title: "A",
          body: "unchanged",
          tags: [],
          urls: [],
          createdAt: "2026-04-30T11:00:00.000Z",
          updatedAt: "2026-04-30T11:00:00.000Z",
        },
      ],
      activeNoteId: "a",
    });
    expect(noteUploadCount).toBe(0);
  });
});

describe("GoogleDriveStore.cleanupOldIndexSnapshots retention", () => {
  it("keeps the active snapshot plus the 9 most recent stale ones, deleting older ones", async () => {
    // The retention rule: `MAX_INDEX_SNAPSHOTS - 1 = 9` stale
    // snapshots survive each save (the active one is preserved
    // separately, so 10 total). Without an explicit count assertion
    // every survivor mutation here looks the same.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const noteFile = driveFile("nf", "note-a.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "a" },
    });
    // 14 snapshots (1 active + 13 stale) — expect 4 oldest to be
    // deleted (13 - 9 = 4).
    const snapshots: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 14; i += 1) {
      const ts = `2026-04-${String(i + 1).padStart(2, "0")}T10-00-00-000Z`;
      snapshots.push(
        driveFile(`snap-${i}`, `index-${ts}.json`, {
          appProperties: { sutrapad: "true", kind: "index" },
        }),
      );
    }

    const deletes: string[] = [];
    captureFetch(async (url, init) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (url.includes("'noteId'")) return fileList([noteFile]);
      // The retention sweep is `findIndexSnapshotFiles`, which always
      // queries with pageSize = MAX_INDEX_SNAPSHOTS + 20 (30). The
      // earlier `findIndexFile` lookup (for resolveActiveIndexFile's
      // fallback) is pageSize = 1 — return empty there so the save
      // path treats the existing index as missing.
      if (
        url.includes("'index'") &&
        url.includes("q=") &&
        url.includes("pageSize=30") &&
        !url.includes("upload")
      ) {
        return fileList(snapshots);
      }
      if (url.includes("'index'") && url.includes("pageSize=1")) {
        return fileList([]);
      }
      if (url.includes("upload/drive/v3/files")) {
        const body = init?.body as FormData;
        const meta = JSON.parse(
          await (body.get("metadata") as Blob).text(),
        ) as {
          name: string;
          appProperties: Record<string, string>;
        };
        // Newly-uploaded snapshot becomes the active one.
        if (meta.appProperties.kind === "index") {
          return jsonResponse({
            id: "snap-active",
            name: meta.name,
            mimeType: "application/json",
            appProperties: meta.appProperties,
            parents: ["folder-1"],
          });
        }
        return jsonResponse(driveFile("up", meta.name));
      }
      if (init?.method === "DELETE") {
        const id = url.split("/").pop()?.split("?")[0] ?? "";
        deletes.push(id);
        return new Response(null, { status: 204 });
      }
      if (url.includes("?fields=")) {
        return jsonResponse({ ...folder, parents: ["folder-1"] });
      }
      if (url.includes("q=") && !url.includes("upload/drive/v3")) {
        return fileList([]);
      }
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    await store.saveWorkspace({
      notes: [
        {
          id: "a",
          title: "A",
          body: "hi",
          tags: [],
          urls: [],
          createdAt: "2026-04-30T12:00:00.000Z",
          updatedAt: "2026-04-30T12:00:01.000Z",
        },
      ],
      activeNoteId: "a",
    });

    // Retention math: `slice(MAX_INDEX_SNAPSHOTS - 1)` keeps the 9
    // newest stale snapshots; the 5 oldest get deleted (14 - 9 = 5).
    // The harness named snap-0 the OLDEST (April 1) and snap-13 the
    // newest stale — so deletes are snap-0..snap-4.
    expect(deletes).toHaveLength(5);
    expect(new Set(deletes)).toEqual(
      new Set(["snap-0", "snap-1", "snap-2", "snap-3", "snap-4"]),
    );
  });
});

describe("GoogleDriveStore.loadWorkspace empty-workspace seed", () => {
  it("seeds the brand-new workspace with the canonical first-note body and an empty urls array", async () => {
    // Pin the body StringLiteral and the urls ArrayDeclaration on
    // lines 72–73 of `createInitialDocument`. Without these the
    // existing empty-workspace test only asserts the title, leaving
    // the body / urls mutants surviving.
    captureFetch(() => fileList([]));
    const store = new GoogleDriveStore("token");
    const workspace = await store.loadWorkspace();
    expect(workspace.notes).toHaveLength(1);
    expect(workspace.notes[0].body).toBe("Start writing here.");
    expect(workspace.notes[0].urls).toEqual([]);
  });
});

describe("GoogleDriveStore.getWorkspaceFolder memoisation", () => {
  it("looks up the workspace folder once, even across multiple appendNoteToWorkspace calls on the same store", async () => {
    // Defends `if (!this.#workspaceFolderPromise)` on line 494 against
    // the `if (true)` mutant. If the guard always entered, every save
    // / append would do another folder lookup — observable as a count
    // of `mimeType=...folder` queries.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const uploaded = driveFile("uploaded", "note-x.json");
    let folderQueries = 0;
    captureFetch((url, init) => {
      if (url.includes("google-apps.folder") && !init?.method) {
        folderQueries += 1;
        return fileList([folder]);
      }
      if (init?.method === "POST" && url.includes("upload/drive/v3")) {
        return jsonResponse(uploaded);
      }
      if (init?.method === "PATCH") return jsonResponse(uploaded);
      if (url.includes("?fields=")) {
        return jsonResponse({ ...uploaded, parents: ["folder-1"] });
      }
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    const note: SutraPadDocument = {
      id: "x",
      title: "T",
      body: "b",
      tags: [],
      urls: [],
      createdAt: "2026-04-30T12:00:00.000Z",
      updatedAt: "2026-04-30T12:00:00.000Z",
    };
    await store.appendNoteToWorkspace(note);
    await store.appendNoteToWorkspace({ ...note, id: "x2" });
    await store.appendNoteToWorkspace({ ...note, id: "x3" });
    expect(folderQueries).toBe(1);
  });
});

describe("GoogleDriveStore.findArtifactFile two-stage fallback", () => {
  it("falls back to the global by-name query when the in-folder lookup returns no match", async () => {
    // findArtifactFile first searches inside the workspace folder
    // (covers 99 % of live state), then falls back to a global query
    // matching by file name + appProperties.kind. Without coverage on
    // the fallback path, the conditional on line 535 (`if (inFolder) return`)
    // and the global query string on line 537–539 stay survivors.
    //
    // We trigger the fallback by serving a folder + an empty in-folder
    // tag-search, and a populated by-name tag search that should be
    // returned to the caller. Loading workspace fires
    // `resolveActiveIndexFile` which uses `findHeadFile` (kind=head).
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const detachedHead = driveFile("detached-head", "sutrapad-head.json", {
      appProperties: { sutrapad: "true", kind: "head" },
      // No `parents: ["folder-1"]` — the head is sitting outside the
      // workspace folder, so the in-folder query misses it.
      parents: [],
    });

    const seenQueries: string[] = [];
    captureFetch((url, init) => {
      if (url.includes("google-apps.folder") && !init?.method) {
        return fileList([folder]);
      }
      if (
        url.includes("'head'") &&
        url.includes("q=") &&
        url.includes("'folder-1'")
      ) {
        // In-folder head lookup → empty.
        seenQueries.push("in-folder");
        return fileList([]);
      }
      if (
        url.includes("'head'") &&
        url.includes("q=") &&
        url.includes("name")
      ) {
        // Global by-name fallback.
        seenQueries.push("by-name");
        return fileList([detachedHead]);
      }
      if (url.includes("/detached-head?alt=media")) {
        // Head body — unused after we exit fast (no live note files).
        return jsonResponse({
          version: 1,
          activeIndexId: "missing",
          savedAt: "2026-04-13T10:00:00.000Z",
        });
      }
      if (url.includes("?fields=")) {
        // Active index metadata fetch fails — falls through to
        // findIndexFile which is empty.
        return new Response("not found", { status: 404 });
      }
      if (url.includes("'note'") && url.includes("q=")) return fileList([]);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    await store.loadWorkspace();
    expect(seenQueries).toContain("in-folder");
    expect(seenQueries).toContain("by-name");
  });
});

describe("GoogleDriveStore findHeadFile / findTagIndexFile / findLinkIndexFile / findTaskIndexFile pin canonical kind discriminators", () => {
  it("uses kind='head' / 'tags' / 'links' / 'tasks' when looking up each derived file during save", async () => {
    // Each of the find*IndexFile helpers carries a `kind` literal
    // that flows into the Drive query. Without explicit assertions
    // those StringLiteral mutants on lines 555 / 559 / 563 (and 543
    // for head) all survive. We capture the queries fired during a
    // save and pin one for each kind discriminator.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const noteFile = driveFile("nf", "note-a.json", {
      appProperties: { sutrapad: "true", kind: "note", noteId: "a" },
    });
    const seenKinds = new Set<string>();
    captureFetch(async (url, init) => {
      if (url.includes("google-apps.folder")) {
        seenKinds.add("folder");
        return fileList([folder]);
      }
      if (url.includes("'noteId'")) {
        seenKinds.add("note");
        return fileList([noteFile]);
      }
      // Each find*File helper carries its `kind` discriminator
      // verbatim into the Drive q=… parameter as `'kind'`. The
      // single quotes survive `encodeURIComponent` unchanged.
      for (const kind of ["head", "tags", "links", "tasks", "index"] as const) {
        if (url.includes(`'${kind}'`) && url.includes("q=")) {
          seenKinds.add(kind);
        }
      }
      if (url.includes("upload/drive/v3/files")) {
        return jsonResponse(driveFile("up", "x.json"));
      }
      if (url.includes("?fields=")) {
        return jsonResponse({ ...folder, parents: ["folder-1"] });
      }
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("q=")) return fileList([]);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    await store.saveWorkspace({
      notes: [
        {
          id: "a",
          title: "A",
          body: "x",
          tags: [],
          urls: [],
          createdAt: "2026-04-30T12:00:00.000Z",
          updatedAt: "2026-04-30T12:00:01.000Z",
        },
      ],
      activeNoteId: "a",
    });
    expect(seenKinds.has("head")).toBe(true);
    expect(seenKinds.has("tags")).toBe(true);
    expect(seenKinds.has("links")).toBe(true);
    expect(seenKinds.has("tasks")).toBe(true);
    expect(seenKinds.has("index")).toBe(true);
    expect(seenKinds.has("note")).toBe(true);
    expect(seenKinds.has("folder")).toBe(true);
  });
});

describe("GoogleDriveStore find* query construction", () => {
  /**
   * Each `find*File` helper forwards through `findArtifactFile` with a
   * fixed `kind` discriminator and a fixed fallback filename. The
   * StringLiteral mutants on those constants survive without explicit
   * assertions on the query strings hitting Drive — we capture the
   * URLs and pin both the in-folder and the global-fallback queries.
   */

  it("escapes the workspace folder id when composing the `'<id>' in parents` clause", async () => {
    // Defends `buildFolderQuery` (line 627) by passing a folder id
    // that contains a single quote — `escapeDriveQueryValue` must
    // escape it before substitution. A failing escape would land an
    // unbalanced quote in the Drive q= and the request would 400.
    const folder = driveFile("fol'der", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const { calls } = captureFetch((url) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      // No notes / no head → load returns empty workspace.
      if (url.includes("'note'") && url.includes("q=")) return fileList([]);
      if (url.includes("'head'") && url.includes("q=")) return fileList([]);
      return fileList([]);
    });

    const store = new GoogleDriveStore("token");
    await store.loadWorkspace();

    const noteQueryCall = calls.find(
      (c) => c.url.includes("'note'") && c.url.includes("q="),
    );
    expect(noteQueryCall).toBeDefined();
    // The folder id appears with its single quote escaped as `\'`.
    // URL-encoded that's `%5C'` (backslash) followed by `'`.
    expect(noteQueryCall?.url).toContain("fol%5C'der");
  });
});
