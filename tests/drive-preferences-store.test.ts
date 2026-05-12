import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDrivePreferencesStore } from "../src/services/drive-store";
import type { SutraPadPreferences } from "../src/types";

/**
 * Tests for the preferences-shaped Drive store — the
 * `sutrapad-preferences.json` artifact that backs cross-device
 * dismissed tag-alias sync. Companion to `drive-workspace-store` and
 * `drive-store`; the fetch-mocking helpers below mirror the shape
 * used in `drive-workspace-store.test.ts` so a contributor reading
 * either file recognises the second one immediately.
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

describe("GoogleDrivePreferencesStore.loadPreferences", () => {
  it("returns null when no preferences file exists in Drive yet", async () => {
    // First-time use on this account. Folder may or may not exist;
    // either way, the find query returns no matching file and the
    // caller must keep the local (localStorage) set in place rather
    // than treat an empty Drive as an authoritative empty set.
    const { calls } = captureFetch((url) => {
      if (url.includes("google-apps.folder")) {
        return fileList([
          driveFile("folder-1", "SutraPad", {
            mimeType: "application/vnd.google-apps.folder",
          }),
        ]);
      }
      return fileList([]);
    });

    const store = new GoogleDrivePreferencesStore("token");
    expect(await store.loadPreferences()).toBeNull();

    // Pin the folder lookup name. Without this the folder-name constant
    // can be mutated to "" and the test still passes because the
    // mimeType clause alone matches our captureFetch responder.
    const folderQuery = calls.find((c) => c.url.includes("google-apps.folder"));
    expect(folderQuery?.url).toContain("name%20%3D%20'SutraPad'");
  });

  it("fetches the preferences JSON when the file exists via the in-folder query", async () => {
    // Existing artifact path. The query must:
    //   - find the SutraPad folder (kind=folder appProperty)
    //   - find a file with kind=preferences inside it (in-folder
    //     query — `'folder-1' in parents`)
    //   - then fetch that file's body via alt=media
    // We deliberately make the GLOBAL fallback query return a
    // distractor file so the test fails if the store falls through
    // past the in-folder query. This pins the branching order
    // (in-folder first, global only when the folder lookup misses).
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const prefsFile = driveFile("prefs-1", "sutrapad-preferences.json", {
      appProperties: { sutrapad: "true", kind: "preferences" },
    });
    const distractor = driveFile("prefs-elsewhere", "sutrapad-preferences.json", {
      appProperties: { sutrapad: "true", kind: "preferences" },
    });
    const payload: SutraPadPreferences = {
      version: 1,
      savedAt: "2026-05-01T00:00:00.000Z",
      dismissedTagAliases: ["a|b", "cafe|coffee"],
    };
    const distractorPayload: SutraPadPreferences = {
      version: 1,
      savedAt: "2026-01-01T00:00:00.000Z",
      dismissedTagAliases: ["wrong|file"],
    };

    const { calls } = captureFetch((url) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      // In-folder query carries `'folder-1' in parents`.
      if (
        url.includes("value%3D'preferences'") &&
        url.includes("'folder-1'%20in%20parents")
      ) {
        return fileList([prefsFile]);
      }
      // Global fallback query carries `name = '<file>'` (no `in parents`).
      if (
        url.includes("value%3D'preferences'") &&
        url.includes("sutrapad-preferences.json")
      ) {
        return fileList([distractor]);
      }
      if (url.includes("/prefs-1?alt=media")) return jsonResponse(payload);
      if (url.includes("/prefs-elsewhere?alt=media")) {
        return jsonResponse(distractorPayload);
      }
      return fileList([]);
    });

    const store = new GoogleDrivePreferencesStore("token");
    const loaded = await store.loadPreferences();
    expect(loaded).toEqual(payload);

    // The body fetch is `alt=media` against the discovered in-folder
    // file id — not the distractor. Pinning this guards against
    // accidentally falling through past the in-folder query.
    const bodyFetch = calls.find((c) => c.url.includes("/prefs-1?alt=media"));
    expect(bodyFetch).toBeDefined();
    const distractorFetch = calls.find((c) =>
      c.url.includes("/prefs-elsewhere?alt=media"),
    );
    expect(distractorFetch).toBeUndefined();
  });

  it("falls back to the global file-name query when the folder lookup misses", async () => {
    // Some accounts end up with the file at the Drive root rather than
    // inside the SutraPad folder — typical when an earlier session
    // failed mid-flight. The fallback query (`name = '<file>'`) finds
    // it anyway so a load doesn't return null on legitimate data.
    const prefsFile = driveFile("prefs-orphan", "sutrapad-preferences.json", {
      appProperties: { sutrapad: "true", kind: "preferences" },
    });
    const payload: SutraPadPreferences = {
      version: 1,
      savedAt: "2026-05-02T00:00:00.000Z",
      dismissedTagAliases: ["x|y"],
    };

    let folderQueryCount = 0;
    captureFetch((url) => {
      if (url.includes("google-apps.folder")) {
        folderQueryCount += 1;
        return fileList([]); // no folder
      }
      // Find without folder scope — the fallback `name = '…'` path.
      if (url.includes("sutrapad-preferences.json")) {
        return fileList([prefsFile]);
      }
      if (url.includes("/prefs-orphan?alt=media")) {
        return jsonResponse(payload);
      }
      return fileList([]);
    });

    const store = new GoogleDrivePreferencesStore("token");
    expect(await store.loadPreferences()).toEqual(payload);
    // We only ever look up the folder once per store instance, even
    // when the lookup misses — the in-flight promise is cached.
    expect(folderQueryCount).toBe(1);
  });
});

describe("GoogleDrivePreferencesStore.savePreferences", () => {
  it("uploads a fresh preferences file and ensures it's parented under the SutraPad folder", async () => {
    // First-ever save: the find returns no existing file, so upload
    // posts (not patches) and the metadata payload carries the
    // appProperties contract.
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const uploaded = driveFile("prefs-new", "sutrapad-preferences.json", {
      appProperties: { sutrapad: "true", kind: "preferences" },
    });

    const { calls } = captureFetch((url, init) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (init?.method === "POST" && url.includes("upload/drive/v3/files")) {
        return jsonResponse(uploaded);
      }
      if (url.includes("/prefs-new?fields=")) {
        return jsonResponse({ ...uploaded, parents: ["folder-1"] });
      }
      return fileList([]);
    });

    const payload: SutraPadPreferences = {
      version: 1,
      savedAt: "2026-05-03T00:00:00.000Z",
      dismissedTagAliases: ["a|b"],
    };

    const store = new GoogleDrivePreferencesStore("token");
    await store.savePreferences(payload);

    // Multipart POST against the upload endpoint with our metadata.
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
    expect(metadata.name).toBe("sutrapad-preferences.json");
    expect(metadata.appProperties).toEqual({
      sutrapad: "true",
      kind: "preferences",
    });

    // The metadata blob also carries the payload version + savedAt
    // and the sorted dismissed-pair list. Pinning these guards against
    // a regression where the upload body's shape gets reshuffled.
    const dataText = await (form.get("file") as Blob).text();
    const data = JSON.parse(dataText) as SutraPadPreferences;
    expect(data.version).toBe(1);
    expect(data.savedAt).toBe("2026-05-03T00:00:00.000Z");
    expect(data.dismissedTagAliases).toEqual(["a|b"]);

    // ensureFileInFolder follow-up — a metadata fetch to confirm
    // parenting. We mocked the response with parents already correct,
    // so no PATCH should fire.
    const metadataFetch = calls.find(
      (c) => c.url.includes("/prefs-new?fields=") && !c.init?.method,
    );
    expect(metadataFetch).toBeDefined();
  });

  it("patches the existing preferences file rather than creating a duplicate", async () => {
    // Second save: the find returns the existing file id, so the
    // upload toggles to PATCH against that file id (no extra `parents`
    // in the metadata — `uploadJsonFile` strips it on update so we
    // don't accidentally reparent the file).
    const folder = driveFile("folder-1", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
    });
    const existing = driveFile("prefs-1", "sutrapad-preferences.json", {
      appProperties: { sutrapad: "true", kind: "preferences" },
    });

    const { calls } = captureFetch((url, init) => {
      if (url.includes("google-apps.folder")) return fileList([folder]);
      if (url.includes("value%3D'preferences'")) {
        return fileList([existing]);
      }
      if (init?.method === "PATCH" && url.includes("upload/drive/v3/files/prefs-1")) {
        return jsonResponse(existing);
      }
      if (url.includes("/prefs-1?fields=")) {
        return jsonResponse({ ...existing, parents: ["folder-1"] });
      }
      return fileList([]);
    });

    const store = new GoogleDrivePreferencesStore("token");
    await store.savePreferences({
      version: 1,
      savedAt: "2026-05-04T00:00:00.000Z",
      dismissedTagAliases: ["a|b", "c|d"],
    });

    const patch = calls.find(
      (c) =>
        c.init?.method === "PATCH" &&
        c.url.includes("upload/drive/v3/files/prefs-1"),
    );
    expect(patch).toBeDefined();
    expect(patch?.url).toContain("uploadType=multipart");

    // No POST against the upload endpoint — that would have created
    // a second preferences file.
    const post = calls.find(
      (c) =>
        c.init?.method === "POST" && c.url.includes("upload/drive/v3/files"),
    );
    expect(post).toBeUndefined();
  });

  it("creates the SutraPad folder on demand when one doesn't exist yet", async () => {
    // First save against a fresh account that hasn't materialised the
    // SutraPad folder yet. `getWorkspaceFolder` falls through to
    // `createFolder` with the folder appProperties contract.
    const newFolder = driveFile("folder-new", "SutraPad", {
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { sutrapad: "true", kind: "folder" },
    });
    const uploaded = driveFile("prefs-x", "sutrapad-preferences.json", {
      appProperties: { sutrapad: "true", kind: "preferences" },
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
      if (url.includes("/prefs-x?fields=")) {
        return jsonResponse({ ...uploaded, parents: ["folder-new"] });
      }
      return fileList([]);
    });

    const store = new GoogleDrivePreferencesStore("token");
    await store.savePreferences({
      version: 1,
      savedAt: "2026-05-05T00:00:00.000Z",
      dismissedTagAliases: [],
    });

    // The createFolder POST is the non-upload POST — pinning that
    // the appProperties payload includes the folder kind so future
    // lookups can find this folder again.
    const createFolder = calls.find(
      (c) => c.init?.method === "POST" && !c.url.includes("upload/drive/v3"),
    );
    expect(createFolder).toBeDefined();
    const folderBody = JSON.parse(createFolder?.init?.body as string) as {
      name: string;
      mimeType: string;
      appProperties: Record<string, string>;
    };
    // Pin the folder name + mimeType. Without this the constants
    // `WORKSPACE_FOLDER_NAME` and the folder mime type can be mutated
    // to empty / different values and the test still passes.
    expect(folderBody.name).toBe("SutraPad");
    expect(folderBody.mimeType).toBe("application/vnd.google-apps.folder");
    expect(folderBody.appProperties).toEqual({
      sutrapad: "true",
      kind: "folder",
    });
  });
});
