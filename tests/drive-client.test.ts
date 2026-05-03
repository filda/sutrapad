import { afterEach, describe, expect, it, vi } from "vitest";
import {
  escapeDriveQueryValue,
  GoogleDriveApiError,
  GoogleDriveClient,
  isAuthExpiredError,
} from "../src/services/drive/client";

/**
 * Tests for the low-level Google Drive REST client. The workspace-level
 * tests in `drive-store.test.ts` exercise this via the higher-level
 * `GoogleDriveStore`, which leaves URL strings, header shapes, and the
 * less-trodden methods (`createFolder`, `deleteFile`, `ensureFileInFolder`)
 * with unobserved mutants. This suite calls the client directly so each
 * wire-level concern can be pinned with targeted assertions.
 */

const GOOGLE_DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_FILES =
  "https://www.googleapis.com/upload/drive/v3/files";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function captureFetch(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { calls: FetchCall[]; spy: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Pulls the Authorization header off a captured fetch call. The
 * `init?.headers` cast-after-optional-chain pattern trips
 * `no-unsafe-optional-chaining` (the assertion drops the optionality);
 * extracting via `?? {}` keeps the lint quiet and the assertion still
 * fails meaningfully when the header is missing (returns undefined).
 */
function authHeader(call: FetchCall): string | undefined {
  const headers = (call.init?.headers ?? {}) as Record<string, string>;
  return headers.Authorization;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("escapeDriveQueryValue", () => {
  // The base cases live in `drive-store.test.ts`; this case adds the
  // backslash-then-quote ordering invariant. Without it, swapping the
  // two replace calls produces double-escaped backslashes — a subtle
  // bug class the existing escape-payload test doesn't quite cover.
  it("preserves replacement order: backslashes before quotes", () => {
    // Input has both a backslash and a quote. If the order were
    // reversed, the quote-pass would leave an unescaped `\\` followed
    // by `\\'`, producing `\\\\'` — three escapes instead of two.
    expect(escapeDriveQueryValue("a\\'b")).toBe("a\\\\\\'b");
  });
});

describe("GoogleDriveApiError", () => {
  it("includes the status code in the message and exposes it as a property", () => {
    const error = new GoogleDriveApiError("Failed to query Google Drive.", 500);
    expect(error.status).toBe(500);
    expect(error.name).toBe("GoogleDriveApiError");
    expect(error.message).toBe("Failed to query Google Drive. (500)");
    expect(error.googleMessage).toBeUndefined();
  });

  it("appends the Google-supplied message when one was extracted from the response body", () => {
    // The colon-space separator is part of the contract — the
    // bootstrap-error pulse formats this verbatim, so a mutant that
    // empties the literal would show up as a malformed user-facing
    // string.
    const error = new GoogleDriveApiError(
      "Failed to query Google Drive.",
      403,
      "User does not have permission",
    );
    expect(error.message).toBe(
      "Failed to query Google Drive. (403): User does not have permission",
    );
    expect(error.googleMessage).toBe("User does not have permission");
  });
});

describe("isAuthExpiredError", () => {
  it("is true for a GoogleDriveApiError with status 401", () => {
    expect(isAuthExpiredError(new GoogleDriveApiError("nope", 401))).toBe(true);
  });

  it("is false for a GoogleDriveApiError with any other status", () => {
    expect(isAuthExpiredError(new GoogleDriveApiError("nope", 403))).toBe(false);
    expect(isAuthExpiredError(new GoogleDriveApiError("nope", 500))).toBe(false);
  });

  it("is false for plain Error / non-Error values", () => {
    expect(isAuthExpiredError(new Error("plain"))).toBe(false);
    expect(isAuthExpiredError(null)).toBe(false);
    expect(isAuthExpiredError("string")).toBe(false);
    expect(isAuthExpiredError({ status: 401 })).toBe(false);
  });
});

describe("GoogleDriveClient.findFiles", () => {
  it("hits the files endpoint with q, fields, pageSize, and a Bearer token", async () => {
    const { calls } = captureFetch(() => jsonResponse({ files: [] }));
    const client = new GoogleDriveClient("tok-1");

    await client.findFiles("name = 'index'", 5);

    expect(calls).toHaveLength(1);
    const url = calls[0].url;
    expect(url.startsWith(GOOGLE_DRIVE_FILES)).toBe(true);
    // `q=` is URL-encoded; pin the encoded form so the
    // `encodeURIComponent` wrapper doesn't get silently dropped.
    expect(url).toContain("q=name%20%3D%20'index'");
    expect(url).toContain(
      "fields=files(id,name,mimeType,appProperties,parents)",
    );
    expect(url).toContain("pageSize=5");
    expect(authHeader(calls[0])).toBe("Bearer tok-1");
  });

  it("returns the parsed `files` array, defaulting to [] when missing", async () => {
    captureFetch(() => jsonResponse({}));
    const client = new GoogleDriveClient("tok");
    expect(await client.findFiles("q", 1)).toEqual([]);
  });

  it("throws GoogleDriveApiError with the Google error message on non-OK", async () => {
    captureFetch(() =>
      jsonResponse({ error: { message: "rate limited" } }, 429),
    );
    const client = new GoogleDriveClient("tok");

    const promise = client.findFiles("q", 1);
    await expect(promise).rejects.toBeInstanceOf(GoogleDriveApiError);
    await expect(promise).rejects.toMatchObject({
      status: 429,
      googleMessage: "rate limited",
    });
  });

  it("throws GoogleDriveApiError without googleMessage when the body is non-JSON", async () => {
    // Some Drive errors (proxied 5xx, gateway timeouts) come back as
    // plain HTML or text. The catch in `ensureDriveOk` must swallow
    // the JSON parse failure and still surface a typed error. Without
    // this case the catch BlockStatement on line 79 is uncovered.
    captureFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const client = new GoogleDriveClient("tok");

    const promise = client.findFiles("q", 1);
    await expect(promise).rejects.toBeInstanceOf(GoogleDriveApiError);
    await expect(promise).rejects.toMatchObject({
      status: 502,
      googleMessage: undefined,
    });
  });

  it("threads the optional chain through `body` when JSON.parse returns null", async () => {
    // `JSON.parse("null")` is a legitimate non-throw that yields null.
    // Without the leading `body?` optional chain, `body.error` would
    // TypeError. Drive itself doesn't currently respond with a literal
    // `null` body, but a misconfigured proxy could.
    captureFetch(() => new Response("null", { status: 500 }));
    const client = new GoogleDriveClient("tok");
    const promise = client.findFiles("q", 1);
    await expect(promise).rejects.toBeInstanceOf(GoogleDriveApiError);
    await expect(promise).rejects.toMatchObject({
      status: 500,
      googleMessage: undefined,
    });
  });

  it("formats the full error message including the findFiles label, status, and Google message", async () => {
    // Pin the default-message StringLiteral on line 119. Without an
    // explicit `error.message` assertion, mutating the label to `""`
    // still satisfies "is a GoogleDriveApiError with status 429".
    captureFetch(() =>
      jsonResponse({ error: { message: "rate limited" } }, 429),
    );
    const client = new GoogleDriveClient("tok");
    await expect(client.findFiles("q", 1)).rejects.toThrow(
      "Failed to query Google Drive. (429): rate limited",
    );
  });
});

describe("GoogleDriveClient.findSingleFile", () => {
  it("requests pageSize=1 and returns the first match (or null)", async () => {
    let nthCall = 0;
    const { spy } = captureFetch(() => {
      nthCall += 1;
      if (nthCall === 1) {
        return jsonResponse({
          files: [
            {
              id: "a",
              name: "n",
              mimeType: "x",
              appProperties: {},
              parents: ["root"],
            },
          ],
        });
      }
      return jsonResponse({ files: [] });
    });
    const client = new GoogleDriveClient("tok");
    const first = await client.findSingleFile("q1");
    expect(first?.id).toBe("a");
    const second = await client.findSingleFile("q2");
    expect(second).toBeNull();
    // Both calls had pageSize=1.
    for (const call of spy.mock.calls) {
      expect(call[0]).toContain("pageSize=1");
    }
  });
});

describe("GoogleDriveClient.fetchJsonFile", () => {
  it("hits /drive/v3/files/<id>?alt=media with a Bearer token", async () => {
    const { calls } = captureFetch(() => jsonResponse({ ok: true }));
    const client = new GoogleDriveClient("tok-2");
    const data = await client.fetchJsonFile<{ ok: boolean }>("file-9");
    expect(data).toEqual({ ok: true });
    expect(calls[0].url).toBe(`${GOOGLE_DRIVE_FILES}/file-9?alt=media`);
    expect(authHeader(calls[0])).toBe("Bearer tok-2");
  });

  it("uses a load-specific error label on non-OK", async () => {
    captureFetch(() => new Response("nope", { status: 404 }));
    const client = new GoogleDriveClient("tok");
    await expect(client.fetchJsonFile("missing")).rejects.toThrow(
      /Failed to load data from Google Drive\./,
    );
  });
});

describe("GoogleDriveClient.fetchFileMetadata", () => {
  it("requests the `id,name,mimeType,appProperties,parents` field set", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({
        id: "id1",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-1"],
      }),
    );
    const client = new GoogleDriveClient("tok-3");
    await client.fetchFileMetadata("id1");
    expect(calls[0].url).toBe(
      `${GOOGLE_DRIVE_FILES}/id1?fields=id,name,mimeType,appProperties,parents`,
    );
    expect(authHeader(calls[0])).toBe("Bearer tok-3");
  });

  it("uses a metadata-specific error label on non-OK", async () => {
    captureFetch(() => new Response("nope", { status: 500 }));
    const client = new GoogleDriveClient("tok");
    await expect(client.fetchFileMetadata("x")).rejects.toThrow(
      /Failed to inspect Google Drive file metadata\./,
    );
  });
});

describe("GoogleDriveClient.ensureFileInFolder", () => {
  it("is a no-op when the file is already parented exactly under the target folder", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({
        id: "f1",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-A"],
      }),
    );
    const client = new GoogleDriveClient("tok");
    await client.ensureFileInFolder("f1", "folder-A");
    // Only the metadata fetch — no PATCH was issued.
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBeUndefined();
  });

  it("treats missing `metadata.parents` as an empty array (not the legacy `[\"root\"]`)", async () => {
    // metadata.parents can be `undefined` for newly created files
    // before the first PATCH lands. The default `?? []` keeps the
    // re-parent path correct; mutating to a non-empty default
    // (`["Stryker was here"]`) would cause `removeParents` to be
    // populated with bogus ids and Drive would reject the PATCH.
    const responses = [
      jsonResponse({
        id: "f-undef",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        // parents intentionally absent
      }),
      jsonResponse({
        id: "f-undef",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-Z"],
      }),
    ];
    let i = 0;
    const { calls } = captureFetch(() => responses[i++]);
    const client = new GoogleDriveClient("tok");
    await client.ensureFileInFolder("f-undef", "folder-Z");
    expect(calls).toHaveLength(2);
    // The PATCH must NOT carry a `removeParents` token — there are no
    // strays to remove when we treated the missing list as empty.
    expect(calls[1].url).toContain("addParents=folder-Z");
    expect(calls[1].url).not.toContain("removeParents");
  });

  it("still PATCHes (to remove strays) when the file is parented under the target folder AND has other parents", async () => {
    // Defends the EqualityOperator mutant on line 171:
    // `otherParents.length === 0` → `true`. The mutant version would
    // collapse the conjunction to "is the file under the target
    // folder?" alone, skipping the cleanup PATCH that strips stray
    // parents. The early-return path must require BOTH conditions.
    const responses = [
      jsonResponse({
        id: "f-stray",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-D", "stray-1"],
      }),
      jsonResponse({
        id: "f-stray",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-D"],
      }),
    ];
    let i = 0;
    const { calls } = captureFetch(() => responses[i++]);
    const client = new GoogleDriveClient("tok");
    await client.ensureFileInFolder("f-stray", "folder-D");
    expect(calls).toHaveLength(2); // metadata fetch + PATCH (not just the metadata)
    expect(calls[1].init?.method).toBe("PATCH");
    expect(calls[1].url).toContain("addParents=folder-D");
    expect(calls[1].url).toContain("removeParents=stray-1");
  });

  it("PATCHes addParents only when the file has no other parents", async () => {
    const responses = [
      // First call: metadata fetch — file has zero parents.
      jsonResponse({
        id: "f2",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: [],
      }),
      // Second call: PATCH response.
      jsonResponse({
        id: "f2",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-B"],
      }),
    ];
    let i = 0;
    const { calls } = captureFetch(() => responses[i++]);
    const client = new GoogleDriveClient("tok");
    await client.ensureFileInFolder("f2", "folder-B");

    expect(calls).toHaveLength(2);
    const patch = calls[1];
    expect(patch.init?.method).toBe("PATCH");
    expect(patch.url).toContain("addParents=folder-B");
    // No `removeParents` in the URL — there's nothing to remove.
    expect(patch.url).not.toContain("removeParents");
    expect(patch.url).toContain(
      "fields=id%2Cname%2CmimeType%2CappProperties%2Cparents",
    );
    // PATCH carries the Bearer header — pins the headers ObjectLiteral
    // and template-literal mutants (lines 186–187).
    expect(authHeader(patch)).toBe("Bearer tok");
  });

  it("PATCHes both addParents and removeParents (joined by comma) when the file has stray parents", async () => {
    const responses = [
      jsonResponse({
        id: "f3",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["stray-1", "stray-2"],
      }),
      jsonResponse({
        id: "f3",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-C"],
      }),
    ];
    let i = 0;
    const { calls } = captureFetch(() => responses[i++]);
    const client = new GoogleDriveClient("tok");
    await client.ensureFileInFolder("f3", "folder-C");

    const patch = calls[1];
    expect(patch.url).toContain("addParents=folder-C");
    expect(patch.url).toContain("removeParents=stray-1%2Cstray-2");
  });

  it("uses a folder-move-specific error label on non-OK", async () => {
    let i = 0;
    captureFetch(() => {
      if (i === 0) {
        i += 1;
        return jsonResponse({
          id: "f",
          name: "n",
          mimeType: "x",
          appProperties: {},
          parents: [],
        });
      }
      return new Response("nope", { status: 500 });
    });
    const client = new GoogleDriveClient("tok");
    await expect(client.ensureFileInFolder("f", "folder-X")).rejects.toThrow(
      /Failed to move SutraPad files into the Google Drive folder\./,
    );
  });
});

describe("GoogleDriveClient.deleteFile", () => {
  it("issues DELETE /drive/v3/files/<id>", async () => {
    const { calls } = captureFetch(() => new Response(null, { status: 204 }));
    const client = new GoogleDriveClient("tok");
    await client.deleteFile("doomed-id");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GOOGLE_DRIVE_FILES}/doomed-id`);
    expect(calls[0].init?.method).toBe("DELETE");
    expect(authHeader(calls[0])).toBe("Bearer tok");
  });

  it("throws with the snapshot-deletion error label on non-OK", async () => {
    captureFetch(() => new Response("nope", { status: 500 }));
    const client = new GoogleDriveClient("tok");
    await expect(client.deleteFile("x")).rejects.toThrow(
      /Failed to delete an old SutraPad index snapshot from Google Drive\./,
    );
  });
});

describe("GoogleDriveClient.createFolder", () => {
  it("POSTs JSON with the folder mime type and forwards appProperties", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({
        id: "folder-new",
        name: "SutraPad",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { sutrapad: "true" },
        parents: [],
      }),
    );
    const client = new GoogleDriveClient("tok");
    const folder = await client.createFolder({
      name: "SutraPad",
      appProperties: { sutrapad: "true" },
    });

    expect(folder.id).toBe("folder-new");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].url).toBe(
      `${GOOGLE_DRIVE_FILES}?fields=id,name,mimeType,appProperties,parents`,
    );
    const body = JSON.parse(calls[0].init?.body as string) as {
      name: string;
      mimeType: string;
      appProperties: Record<string, string>;
    };
    expect(body.name).toBe("SutraPad");
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
    expect(body.appProperties).toEqual({ sutrapad: "true" });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws with the folder-create error label on non-OK", async () => {
    captureFetch(() => new Response("nope", { status: 500 }));
    const client = new GoogleDriveClient("tok");
    await expect(
      client.createFolder({ name: "x", appProperties: {} }),
    ).rejects.toThrow(/Failed to create the SutraPad folder in Google Drive\./);
  });
});

describe("GoogleDriveClient.uploadJsonFile", () => {
  it("POSTs to the upload endpoint with parents=[folderId] when no fileId is provided", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({
        id: "new-id",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-A"],
      }),
    );
    const client = new GoogleDriveClient("tok");
    await client.uploadJsonFile({
      fileName: "data.json",
      data: { hello: 1 },
      folderId: "folder-A",
      appProperties: { kind: "head" },
    });

    expect(calls[0].url).toBe(`${GOOGLE_DRIVE_UPLOAD_FILES}?uploadType=multipart`);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    const form = calls[0].init?.body as FormData;
    // Metadata blob carries the parents array on create.
    const metadataBlob = form.get("metadata") as Blob;
    const metadataText = await metadataBlob.text();
    const metadata = JSON.parse(metadataText) as {
      name: string;
      mimeType: string;
      appProperties: Record<string, string>;
      parents?: string[];
    };
    expect(metadata.name).toBe("data.json");
    expect(metadata.mimeType).toBe("application/json");
    expect(metadata.appProperties).toEqual({ kind: "head" });
    expect(metadata.parents).toEqual(["folder-A"]);
    // Both blob parts carry the application/json content type — Drive
    // rejects multipart bodies whose part headers don't match. Pinning
    // each Blob's `type` kills the ObjectLiteral / StringLiteral mutants
    // on lines 260 and 264.
    expect(metadataBlob.type).toBe("application/json");
    const fileBlob = form.get("file") as Blob;
    expect(fileBlob.type).toBe("application/json");
    // Auth header.
    expect(authHeader(calls[0])).toBe("Bearer tok");
  });

  it("PATCHes the existing file's upload URL and omits parents on update", async () => {
    const { calls } = captureFetch(() =>
      jsonResponse({
        id: "existing-id",
        name: "n",
        mimeType: "application/json",
        appProperties: {},
        parents: ["folder-A"],
      }),
    );
    const client = new GoogleDriveClient("tok");
    await client.uploadJsonFile({
      fileId: "existing-id",
      fileName: "data.json",
      data: { ok: true },
      folderId: "folder-A",
      appProperties: {},
    });

    expect(calls[0].url).toBe(
      `${GOOGLE_DRIVE_UPLOAD_FILES}/existing-id?uploadType=multipart`,
    );
    expect(calls[0].init?.method).toBe("PATCH");
    const form = calls[0].init?.body as FormData;
    const metadataBlob = form.get("metadata") as Blob;
    const metadataText = await metadataBlob.text();
    const metadata = JSON.parse(metadataText) as { parents?: unknown };
    // Update path must NOT carry parents — Drive treats a parents array
    // on PATCH as a re-parent request and would detach the file.
    expect(metadata.parents).toBeUndefined();
  });

  it("throws with the save error label on non-OK", async () => {
    captureFetch(() => new Response("nope", { status: 500 }));
    const client = new GoogleDriveClient("tok");
    await expect(
      client.uploadJsonFile({
        fileName: "data.json",
        data: { x: 1 },
        folderId: "folder-A",
        appProperties: {},
      }),
    ).rejects.toThrow(/Failed to save data to Google Drive\./);
  });
});
