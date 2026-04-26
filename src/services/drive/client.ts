/**
 * Low-level Google Drive REST client.
 *
 * Owns the wire protocol — Bearer-token auth, the `/drive/v3/files` +
 * `/upload/drive/v3/files` endpoint URLs, multipart upload encoding,
 * the Drive query escape rule, and the typed error class. Does NOT
 * know about workspaces, notes, indexes, or any SutraPad-specific
 * shape; it operates on `DriveFileRecord` values and arbitrary
 * JSON-serialisable payloads.
 *
 * Lifted out of `drive-store.ts` so the workspace-aware logic can
 * compose against this thin client without re-entering the same file
 * for low-level Drive concerns.
 */
import type { DriveFileRecord } from "../../types";

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
export const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/**
 * Escapes a value for inclusion inside single-quoted Google Drive query
 * strings. Drive's query language treats `'` as a string terminator and
 * `\` as the escape character, so any user- or environment-controlled
 * value substituted into `name='…'`, `value='…'`, or `'…' in parents`
 * has to escape both characters before reaching the wire.
 *
 * Today every input we substitute (note ids from `crypto.randomUUID()`,
 * Drive file ids from API responses, hard-coded file-name constants)
 * is either UUID-shaped or developer-controlled, so the practical risk
 * is low. The helper exists because:
 *
 *   - `LEGACY_INDEX_FILE_NAME` reads from
 *     `import.meta.env.VITE_SUTRAPAD_FILE_NAME` — a deploy-time env
 *     variable. A misconfigured value containing `'` would silently
 *     produce malformed queries.
 *   - Future code paths (e.g. user-supplied workspace folder names,
 *     a planned import flow) may want to substitute attacker- or
 *     user-controlled strings; routing every interpolation through
 *     the same helper is cheaper than adding the guard one site at
 *     a time and easier to audit.
 *
 * Order of replacements matters: backslashes first, then quotes —
 * otherwise the second pass would double-escape the backslashes
 * the first pass introduced.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Typed error for Google Drive REST failures. Surfaces the HTTP status so the
 * app layer can react to authorization errors (401) by attempting a silent
 * token refresh before propagating the failure to the user.
 */
export class GoogleDriveApiError extends Error {
  readonly status: number;
  readonly googleMessage?: string;

  constructor(message: string, status: number, googleMessage?: string) {
    super(googleMessage ? `${message} (${status}): ${googleMessage}` : `${message} (${status})`);
    this.name = "GoogleDriveApiError";
    this.status = status;
    this.googleMessage = googleMessage;
  }
}

export function isAuthExpiredError(error: unknown): error is GoogleDriveApiError {
  return error instanceof GoogleDriveApiError && error.status === 401;
}

async function ensureDriveOk(response: Response, fallbackMessage: string): Promise<Response> {
  if (response.ok) return response;

  let googleMessage: string | undefined;
  try {
    const body = (await response.clone().json()) as { error?: { message?: string } };
    googleMessage = body?.error?.message;
  } catch {
    // Non-JSON body — leave googleMessage undefined.
  }

  throw new GoogleDriveApiError(fallbackMessage, response.status, googleMessage);
}

/**
 * Thin REST client for Google Drive's `files` endpoints. Holds an
 * access token, surfaces typed `GoogleDriveApiError` failures, and
 * exposes just the operations the workspace store actually needs.
 *
 * Every method is `async` and either returns a `DriveFileRecord` /
 * parsed JSON / void, or throws `GoogleDriveApiError`. The token is
 * stored as a private field; rotate by constructing a new client.
 */
export class GoogleDriveClient {
  readonly #token: string;

  constructor(accessToken: string) {
    this.#token = accessToken;
  }

  /**
   * Fires a `files.list` query against Drive. `query` is passed
   * through verbatim — the caller is responsible for escaping
   * substituted values via `escapeDriveQueryValue`. `pageSize`
   * caps the result count; we don't paginate beyond the first
   * page anywhere, so this is also the practical hard cap.
   */
  async findFiles(query: string, pageSize: number): Promise<DriveFileRecord[]> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,appProperties,parents)&pageSize=${pageSize}`,
      {
        headers: {
          Authorization: `Bearer ${this.#token}`,
        },
      },
    );

    await ensureDriveOk(response, "Failed to query Google Drive.");
    const payload = (await response.json()) as { files?: DriveFileRecord[] };
    return payload.files ?? [];
  }

  async findSingleFile(query: string): Promise<DriveFileRecord | null> {
    const files = await this.findFiles(query, 1);
    return files[0] ?? null;
  }

  /**
   * Fetches a Drive file's body and parses it as JSON. Used for the
   * workspace head, indexes, and per-note JSON files — every
   * SutraPad-shaped artifact ends up here.
   */
  async fetchJsonFile<T>(fileId: string): Promise<T> {
    const response = await fetch(`${GOOGLE_DRIVE_API}/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    await ensureDriveOk(response, "Failed to load data from Google Drive.");
    return (await response.json()) as T;
  }

  async fetchFileMetadata(fileId: string): Promise<DriveFileRecord> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}/${fileId}?fields=id,name,mimeType,appProperties,parents`,
      {
        headers: {
          Authorization: `Bearer ${this.#token}`,
        },
      },
    );

    await ensureDriveOk(response, "Failed to inspect Google Drive file metadata.");
    return (await response.json()) as DriveFileRecord;
  }

  /**
   * Re-parents a file under `folderId`, removing every other parent.
   * Drive's REST API can detach parents on multipart updates (a
   * known historical quirk); this is the defensive sweep that
   * guarantees an artifact lives exactly under the workspace folder.
   * No-op when the file is already correctly parented.
   */
  async ensureFileInFolder(fileId: string, folderId: string): Promise<void> {
    const metadata = await this.fetchFileMetadata(fileId);
    const currentParents: string[] = metadata.parents ?? [];
    const otherParents = currentParents.filter((parentId: string) => parentId !== folderId);

    if (currentParents.includes(folderId) && otherParents.length === 0) {
      return;
    }

    const params = new URLSearchParams({
      addParents: folderId,
      fields: "id,name,mimeType,appProperties,parents",
    });

    if (otherParents.length > 0) {
      params.set("removeParents", otherParents.join(","));
    }

    const response = await fetch(`${GOOGLE_DRIVE_API}/${fileId}?${params.toString()}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    await ensureDriveOk(response, "Failed to move SutraPad files into the Google Drive folder.");
  }

  async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(`${GOOGLE_DRIVE_API}/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    await ensureDriveOk(
      response,
      "Failed to delete an old SutraPad index snapshot from Google Drive.",
    );
  }

  /**
   * Creates a folder. The caller passes the desired name, mime type
   * (always `application/vnd.google-apps.folder` in our use), and
   * appProperties to tag it as ours so future queries can match.
   */
  async createFolder(options: {
    name: string;
    appProperties: Record<string, string>;
  }): Promise<DriveFileRecord> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}?fields=id,name,mimeType,appProperties,parents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: options.name,
          mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
          appProperties: options.appProperties,
        }),
      },
    );

    await ensureDriveOk(response, "Failed to create the SutraPad folder in Google Drive.");
    return (await response.json()) as DriveFileRecord;
  }

  /**
   * Multipart upload: metadata + JSON body in one round-trip.
   * `fileId` toggles between create (POST) and update (PATCH); the
   * caller handles "do I have a previous file id?" branching at
   * its layer rather than here.
   */
  async uploadJsonFile<T>(options: {
    fileId?: string;
    fileName: string;
    data: T;
    folderId: string;
    appProperties: Record<string, string>;
  }): Promise<DriveFileRecord> {
    const metadata = {
      name: options.fileName,
      mimeType: "application/json",
      appProperties: options.appProperties,
      ...(options.fileId ? {} : { parents: [options.folderId] }),
    };

    const formData = new FormData();
    formData.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    formData.append(
      "file",
      new Blob([JSON.stringify(options.data, null, 2)], { type: "application/json" }),
    );

    const url = options.fileId
      ? `${GOOGLE_DRIVE_UPLOAD_API}/${options.fileId}?uploadType=multipart`
      : `${GOOGLE_DRIVE_UPLOAD_API}?uploadType=multipart`;

    const response = await fetch(url, {
      method: options.fileId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
      body: formData,
    });

    await ensureDriveOk(response, "Failed to save data to Google Drive.");
    return (await response.json()) as DriveFileRecord;
  }
}
