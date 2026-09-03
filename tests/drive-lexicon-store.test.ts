import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleDriveLexiconStore } from "../src/services/drive/lexicon-store";
import type {
  BuilderState,
  RuntimeLexicon,
} from "../src/app/logic/lexicon/types";

/**
 * Focused test for `src/services/drive/lexicon-store.ts` — the Drive store
 * behind the Topic Lexicon Builder workbench.
 *
 * This is the second of the two promises `DEFERRED_FROM_MUTATION` was
 * holding. Its entry read "lexicon-page.test.ts imports only its *type*, so
 * mutants would be coverage-free" — accurate, and the reason 172 lines of
 * Drive I/O sat outside the mutation scope entirely.
 *
 * The store builds its own `GoogleDriveClient` from an access token, so
 * there is no client seam to inject; the tests stub `fetch` and assert on the
 * wire, the same approach `tests/drive-client.test.ts` takes. That is a
 * feature here rather than a compromise — the Drive query strings and the
 * `kind` appProperties ARE this module's contract, and asserting them on the
 * wire is the only way to pin them.
 */

const FILES_API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** The names and kinds this store commits to. Written out literally — recipe #27. */
const STATE_FILE_NAME = "sutrapad-topic-lexicon-builder-state.json";
const RUNTIME_FILE_NAME = "sutrapad-topic-lexicon.json";
const STATE_KIND = "lexicon-state";
const RUNTIME_KIND = "lexicon-runtime";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

const fileRecord = (id: string, name: string, parents: string[] = ["folder-1"]) => ({
  id,
  name,
  mimeType: "application/json",
  parents,
  appProperties: { sutrapad: "true" },
});

const folderRecord = (id = "folder-1") => ({
  id,
  name: "SutraPad",
  mimeType: FOLDER_MIME,
  parents: [],
  appProperties: { sutrapad: "true", kind: "folder" },
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stubs `fetch` and routes by URL shape. `list` answers the `?q=` search
 * calls keyed by the query string; everything else falls through to a
 * sensible default so a test only has to describe the calls it cares about.
 */
function stubDrive(options: {
  /** Called for each `?q=` list request; return the records to report. */
  list: (query: string) => unknown[];
  /** Body returned by `GET /{id}?alt=media`. */
  media?: unknown;
  /** Record returned by an upload (POST/PATCH multipart). */
  uploaded?: (init: RequestInit | undefined) => unknown;
  /** Record returned by folder creation (POST with a JSON body). */
  created?: unknown;
  /** Metadata returned by `GET /{id}?fields=…` — drives ensureFileInFolder. */
  metadata?: unknown;
}): { calls: FetchCall[]; spy: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const spy = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });

    if (url.startsWith(UPLOAD_API)) {
      return Promise.resolve(
        jsonResponse(options.uploaded?.(init) ?? fileRecord("uploaded", "uploaded.json")),
      );
    }
    if (url.includes("?q=")) {
      const query = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      return Promise.resolve(jsonResponse({ files: options.list(query) }));
    }
    if (url.includes("alt=media")) {
      return Promise.resolve(jsonResponse(options.media ?? {}));
    }
    if (init?.method === "POST") {
      return Promise.resolve(jsonResponse(options.created ?? folderRecord()));
    }
    if (init?.method === "PATCH") {
      return Promise.resolve(jsonResponse(fileRecord("patched", "patched.json")));
    }
    // GET /{id}?fields=… — the metadata read inside ensureFileInFolder.
    return Promise.resolve(
      jsonResponse(options.metadata ?? fileRecord("meta", "meta.json")),
    );
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

const queriesOf = (calls: FetchCall[]): string[] =>
  calls
    .filter((call) => call.url.includes("?q="))
    .map((call) => decodeURIComponent(new URL(call.url).searchParams.get("q") ?? ""));

const uploadsOf = (calls: FetchCall[]): FetchCall[] =>
  calls.filter((call) => call.url.startsWith(UPLOAD_API));

// Built without a cast, so a change to either shape breaks this file rather
// than being papered over — the payloads are what actually reach Drive.
const STATE: BuilderState = {
  version: 1,
  forms: { praze: "praha" },
  rejectedForms: ["bagr"],
  candidates: { brne: { count: 3, contexts: ["v brne"] } },
};

const RUNTIME: RuntimeLexicon = {
  version: 1,
  locale: "cs-CZ",
  tags: ["praha"],
  forms: { praze: 0 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GoogleDriveLexiconStore.loadState", () => {
  it("returns null when no state file exists anywhere", async () => {
    const { calls } = stubDrive({ list: () => [] });

    expect(await new GoogleDriveLexiconStore("tok").loadState()).toBeNull();
    // No folder and no file — so no body fetch should have been attempted.
    expect(calls.some((call) => call.url.includes("alt=media"))).toBe(false);
  });

  it("loads the state body from the file found inside the workspace folder", async () => {
    const { calls } = stubDrive({
      list: (query) => {
        if (query.includes(FOLDER_MIME)) return [folderRecord()];
        if (query.includes("'folder-1' in parents")) return [fileRecord("state-1", STATE_FILE_NAME)];
        return [];
      },
      media: STATE,
    });

    expect(await new GoogleDriveLexiconStore("tok").loadState()).toEqual(STATE);
    expect(calls.some((call) => call.url === `${FILES_API}/state-1?alt=media`)).toBe(true);
  });

  it("never reads the runtime file back", async () => {
    // The module header is explicit: the builder regenerates the runtime
    // lookup from working state and never reads it. A query for the runtime
    // kind during a load would mean it had started to.
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok").loadState();

    expect(queriesOf(calls).some((q) => q.includes(RUNTIME_KIND))).toBe(false);
  });

  it("does not create the workspace folder just to look", async () => {
    // `loadState` uses `findWorkspaceFolder`, not `getWorkspaceFolder` — a
    // first-time visitor who only opens the workbench must not have a folder
    // provisioned as a side effect of the read.
    const { calls } = stubDrive({ list: () => [] });

    await new GoogleDriveLexiconStore("tok").loadState();

    expect(calls.some((call) => call.init?.method === "POST")).toBe(false);
  });
});

describe("GoogleDriveLexiconStore artifact lookup", () => {
  it("prefers the file inside the workspace folder over a same-kind file elsewhere", async () => {
    const seen: string[] = [];
    stubDrive({
      list: (query) => {
        seen.push(query);
        if (query.includes(FOLDER_MIME)) return [folderRecord()];
        if (query.includes("'folder-1' in parents")) return [fileRecord("in-folder", STATE_FILE_NAME)];
        return [fileRecord("stray", STATE_FILE_NAME, [])];
      },
      media: STATE,
    });

    await new GoogleDriveLexiconStore("tok").loadState();

    // The in-folder query answered, so the by-name fallback must not run.
    expect(seen.filter((q) => q.includes(`name = '${STATE_FILE_NAME}'`))).toHaveLength(0);
  });

  it("falls back to a by-name search when the folder holds no such file", async () => {
    const { calls } = stubDrive({
      list: (query) => {
        if (query.includes(FOLDER_MIME)) return [folderRecord()];
        if (query.includes("in parents")) return [];
        return [fileRecord("by-name", STATE_FILE_NAME, [])];
      },
      media: STATE,
    });

    expect(await new GoogleDriveLexiconStore("tok").loadState()).toEqual(STATE);

    const queries = queriesOf(calls);
    expect(queries.some((q) => q.includes("'folder-1' in parents"))).toBe(true);
    expect(queries.some((q) => q.includes(`name = '${STATE_FILE_NAME}'`))).toBe(true);
  });

  it("skips the in-folder query entirely when there is no folder", async () => {
    const { calls } = stubDrive({ list: () => [] });

    await new GoogleDriveLexiconStore("tok").loadState();

    // `if (options.folderId)` — with no folder resolved there is no parent to
    // scope by, so only the by-name query should go out.
    expect(queriesOf(calls).some((q) => q.includes("in parents"))).toBe(false);
  });

  it("scopes every artifact query to non-trashed files of the right kind", async () => {
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok").loadState();

    for (const query of queriesOf(calls).filter((q) => !q.includes(FOLDER_MIME))) {
      expect(query).toContain("trashed = false");
      expect(query).toContain("appProperties has { key='sutrapad' and value='true' }");
      expect(query).toContain(`key='kind' and value='${STATE_KIND}'`);
    }
  });

  it("looks the workspace folder up by name, mime type and kind", async () => {
    const { calls } = stubDrive({ list: () => [] });

    await new GoogleDriveLexiconStore("tok").loadState();

    const folderQuery = queriesOf(calls).find((q) => q.includes(FOLDER_MIME));
    expect(folderQuery).toContain("trashed = false");
    expect(folderQuery).toContain(`mimeType = '${FOLDER_MIME}'`);
    expect(folderQuery).toContain("appProperties has { key='kind' and value='folder' }");
    expect(folderQuery).toContain("name = 'SutraPad'");
  });
});

describe("GoogleDriveLexiconStore.saveStateAndRuntime", () => {
  it("uploads both artifacts with their documented names and kinds", async () => {
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const uploads = uploadsOf(calls);
    expect(uploads).toHaveLength(2);
    // No existing file for either, so both are creates rather than updates.
    expect(uploads.every((call) => call.init?.method === "POST")).toBe(true);
    expect(uploads.every((call) => call.url === `${UPLOAD_API}?uploadType=multipart`)).toBe(
      true,
    );
    expect(uploads.every((call) => call.init?.body instanceof FormData)).toBe(true);
  });

  it("queries for both kinds, not just the state one", async () => {
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const queries = queriesOf(calls);
    expect(queries.some((q) => q.includes(`value='${STATE_KIND}'`))).toBe(true);
    expect(queries.some((q) => q.includes(`value='${RUNTIME_KIND}'`))).toBe(true);
  });

  it("patches in place when both files already exist", async () => {
    const { calls } = stubDrive({
      list: (query) => {
        if (query.includes(FOLDER_MIME)) return [folderRecord()];
        if (query.includes(`value='${STATE_KIND}'`)) return [fileRecord("state-1", STATE_FILE_NAME)];
        if (query.includes(`value='${RUNTIME_KIND}'`)) return [fileRecord("runtime-1", RUNTIME_FILE_NAME)];
        return [];
      },
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const uploads = uploadsOf(calls);
    expect(uploads.map((call) => call.url).toSorted()).toEqual([
      `${UPLOAD_API}/runtime-1?uploadType=multipart`,
      `${UPLOAD_API}/state-1?uploadType=multipart`,
    ]);
    // `fileId` present ⇒ PATCH, so an autosave updates the file rather than
    // leaving a second copy in the folder on every decision.
    expect(uploads.every((call) => call.init?.method === "PATCH")).toBe(true);
  });

  it("creates the workspace folder when the user has none yet", async () => {
    const { calls } = stubDrive({
      list: () => [],
      created: folderRecord("fresh-folder"),
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const creates = calls.filter(
      (call) => call.init?.method === "POST" && !call.url.startsWith(UPLOAD_API),
    );
    expect(creates).toHaveLength(1);
    expect(JSON.parse(String(creates[0].init?.body))).toEqual({
      name: "SutraPad",
      mimeType: FOLDER_MIME,
      appProperties: { sutrapad: "true", kind: "folder" },
    });
  });

  it("re-parents each uploaded file into the workspace folder", async () => {
    // `ensureFileInFolder` after every upload — Drive's REST API can leave a
    // new revision detached from the folder.
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
      uploaded: () => fileRecord("uploaded-1", STATE_FILE_NAME, []),
      metadata: fileRecord("uploaded-1", STATE_FILE_NAME, []),
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const reparents = calls.filter((call) => call.url.includes("addParents=folder-1"));
    expect(reparents).toHaveLength(2);
  });

  it("resolves the workspace folder once across repeated saves", async () => {
    // `#workspaceFolderPromise` memoises. Autosave fires after every single
    // decision, so re-resolving the folder each time would triple the Drive
    // traffic of a normal editing session.
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });
    const store = new GoogleDriveLexiconStore("tok");

    await store.saveStateAndRuntime(STATE, RUNTIME);
    await store.saveStateAndRuntime(STATE, RUNTIME);
    await store.saveStateAndRuntime(STATE, RUNTIME);

    expect(queriesOf(calls).filter((q) => q.includes(FOLDER_MIME))).toHaveLength(1);
    // The artifact lookups are per-save, so the memoisation is specific to
    // the folder rather than caching the whole save path.
    expect(uploadsOf(calls)).toHaveLength(6);
  });

  it("does not create a second folder when three saves race for the first one", async () => {
    const { calls } = stubDrive({
      list: () => [],
      created: folderRecord("fresh-folder"),
    });
    const store = new GoogleDriveLexiconStore("tok");

    // The promise is memoised before it settles, which is what makes
    // concurrent saves share one creation instead of each making a folder.
    await Promise.all([
      store.saveStateAndRuntime(STATE, RUNTIME),
      store.saveStateAndRuntime(STATE, RUNTIME),
      store.saveStateAndRuntime(STATE, RUNTIME),
    ]);

    const creates = calls.filter(
      (call) => call.init?.method === "POST" && !call.url.startsWith(UPLOAD_API),
    );
    expect(creates).toHaveLength(1);
  });

  it("sends the bearer token on every call", async () => {
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok-42").saveStateAndRuntime(STATE, RUNTIME);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const headers = (call.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-42");
    }
  });

  it("propagates a Drive failure rather than reporting a silent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("?q=")
            ? jsonResponse({ files: [folderRecord()] })
            : jsonResponse({ error: { message: "Quota exceeded" } }, 403),
        ),
      ),
    );

    await expect(
      new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME),
    ).rejects.toThrow(/Quota exceeded|Failed to save/u);
  });
});

describe("GoogleDriveLexiconStore file-name contract", () => {
  // These two names and two kinds are the interface with Drive: the builder
  // state is hand-editable and the runtime file is what production eventually
  // copies out of the folder. Renaming either silently orphans the user's
  // existing artifact, so the strings are asserted literally.
  it("names the two artifacts exactly as documented", async () => {
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const names = await Promise.all(
      uploadsOf(calls).map(async (call) => {
        const form = call.init?.body as FormData;
        const metadata = JSON.parse(await (form.get("metadata") as Blob).text());
        return metadata as { name: string; appProperties: Record<string, string> };
      }),
    );

    expect(names.map((m) => m.name).toSorted()).toEqual(
      [STATE_FILE_NAME, RUNTIME_FILE_NAME].toSorted(),
    );
    expect(names.map((m) => m.appProperties.kind).toSorted()).toEqual(
      [STATE_KIND, RUNTIME_KIND].toSorted(),
    );
    expect(names.every((m) => m.appProperties.sutrapad === "true")).toBe(true);
  });

  it("parents a newly-created artifact into the workspace folder", async () => {
    const { calls } = stubDrive({
      list: (query) => (query.includes(FOLDER_MIME) ? [folderRecord()] : []),
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const form = uploadsOf(calls)[0].init?.body as FormData;
    const metadata = JSON.parse(await (form.get("metadata") as Blob).text());
    expect(metadata.parents).toEqual(["folder-1"]);
  });

  it("omits parents when updating an existing artifact", async () => {
    // Drive rejects `parents` on a PATCH; `ensureFileInFolder` is what keeps
    // the revision in the folder instead.
    const { calls } = stubDrive({
      list: (query) => {
        if (query.includes(FOLDER_MIME)) return [folderRecord()];
        return [fileRecord("existing-1", STATE_FILE_NAME)];
      },
    });

    await new GoogleDriveLexiconStore("tok").saveStateAndRuntime(STATE, RUNTIME);

    const form = uploadsOf(calls)[0].init?.body as FormData;
    const metadata = JSON.parse(await (form.get("metadata") as Blob).text());
    expect(metadata.parents).toBeUndefined();
  });
});
