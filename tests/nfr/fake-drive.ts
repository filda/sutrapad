/**
 * In-memory stand-in for `GoogleDriveClient`, implementing the `DriveClient`
 * slice `GoogleDriveStore` consumes. Real folder / appProperties / query
 * semantics (via `compileDriveQuery`), plus what the NFR layer is actually
 * after: request counters by kind, a peak-concurrency tracker, and fault
 * injection. Nothing here goes through `fetch`.
 *
 * Every call yields to a macrotask (`setTimeout`, `latencyMs` default 0), so
 * concurrency-bounded fan-outs interleave the way they do against a real
 * network — a `Promise.all` over N calls really has N in flight at once.
 */
import type { DriveFileRecord } from "../../src/types";
import type { DriveClient } from "../../src/services/drive/workspace-store";
import { GoogleDriveApiError } from "../../src/services/drive/client";
import { compileDriveQuery } from "./drive-query";

export type DriveCallKind =
  | "findFiles"
  | "fetchJsonFile"
  | "fetchFileMetadata"
  | "ensureFileInFolder"
  | "deleteFile"
  | "createFolder"
  | "uploadJsonFile";

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  appProperties: Record<string, string>;
  parents: string[];
  modifiedTime: string;
  /** Parsed JSON content (folders have none). */
  content: unknown;
  trashed: boolean;
}

export interface FakeDriveStats {
  /** Calls per kind since the last `resetStats()`. */
  readonly calls: Readonly<Record<DriveCallKind, number>>;
  /** Total calls of every kind. */
  readonly total: number;
  /** Note-file uploads (appProperties.kind === "note") — the incident's headline number. */
  readonly noteUploads: number;
  /** Highest number of simultaneously in-flight calls observed. */
  readonly peakInFlight: number;
  /** Same, per call kind — the number the concurrency budgets are about. */
  readonly peakInFlightByKind: Readonly<Record<DriveCallKind, number>>;
}

export interface FakeDriveFault {
  /** Which calls to fail. Return a status to fail with a `GoogleDriveApiError`, or null to let it through. */
  readonly match: (kind: DriveCallKind, detail: { fileId?: string; query?: string }) => number | null;
  /** How many matching calls to fail before the fault expires (default: unlimited). */
  times?: number;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class FakeDrive implements DriveClient {
  readonly files = new Map<string, FakeDriveFile>();
  #nextId = 1;
  #clock: () => number;
  #latencyMs: number;
  #calls: Record<DriveCallKind, number> = emptyCalls();
  #noteUploads = 0;
  #inFlight = 0;
  #peakInFlight = 0;
  #inFlightByKind: Record<DriveCallKind, number> = emptyCalls();
  #peakInFlightByKind: Record<DriveCallKind, number> = emptyCalls();
  #faults: FakeDriveFault[] = [];

  constructor(options: { clock?: () => number; latencyMs?: number } = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#latencyMs = options.latencyMs ?? 0;
  }

  // ---- observability -------------------------------------------------------

  get stats(): FakeDriveStats {
    const calls = { ...this.#calls };
    return {
      calls,
      total: Object.values(calls).reduce((sum, n) => sum + n, 0),
      noteUploads: this.#noteUploads,
      peakInFlight: this.#peakInFlight,
      peakInFlightByKind: { ...this.#peakInFlightByKind },
    };
  }

  resetStats(): void {
    this.#calls = emptyCalls();
    this.#noteUploads = 0;
    this.#peakInFlight = 0;
    this.#peakInFlightByKind = emptyCalls();
  }

  /** Registers a fault; faults are consulted in registration order. */
  fail(fault: FakeDriveFault): void {
    this.#faults.push({ ...fault });
  }

  clearFaults(): void {
    this.#faults = [];
  }

  // ---- direct seeding (bypasses counters) ---------------------------------

  /** Adds a file as if it had always been there. Returns its record. */
  seed(file: Omit<FakeDriveFile, "id" | "modifiedTime" | "trashed"> & Partial<Pick<FakeDriveFile, "id" | "modifiedTime" | "trashed">>): DriveFileRecord {
    const id = file.id ?? this.#allocateId();
    const stored: FakeDriveFile = {
      trashed: false,
      modifiedTime: new Date(this.#clock()).toISOString(),
      ...file,
      id,
    };
    this.files.set(id, stored);
    return toRecord(stored);
  }

  /** Files that match a query, in insertion order — for assertions. */
  query(query: string): FakeDriveFile[] {
    const predicate = compileDriveQuery(query);
    return [...this.files.values()].filter((file) => predicate(file));
  }

  contentOf<T>(fileId: string): T {
    const file = this.files.get(fileId);
    if (!file) throw new Error(`FakeDrive: no file ${fileId}`);
    return structuredClone(file.content) as T;
  }

  // ---- DriveClient ---------------------------------------------------------

  findFiles(query: string, maxResults: number): Promise<DriveFileRecord[]> {
    return this.#call("findFiles", { query }, () => {
      const predicate = compileDriveQuery(query);
      const matches: DriveFileRecord[] = [];
      for (const file of this.files.values()) {
        if (!predicate(file)) continue;
        matches.push(toRecord(file));
        if (matches.length >= maxResults) break;
      }
      return matches;
    });
  }

  async findSingleFile(query: string): Promise<DriveFileRecord | null> {
    const files = await this.findFiles(query, 1);
    return files[0] ?? null;
  }

  fetchJsonFile<T>(fileId: string): Promise<T> {
    return this.#call("fetchJsonFile", { fileId }, () => {
      const file = this.#require(fileId, "Failed to load data from Google Drive.");
      return structuredClone(file.content) as T;
    });
  }

  fetchFileMetadata(fileId: string): Promise<DriveFileRecord> {
    return this.#call("fetchFileMetadata", { fileId }, () =>
      toRecord(this.#require(fileId, "Failed to inspect Google Drive file metadata.")),
    );
  }

  async ensureFileInFolder(fileId: string, folderId: string): Promise<void> {
    await this.#call("ensureFileInFolder", { fileId }, () => {
      const file = this.#require(fileId, "Failed to move SutraPad files into the Google Drive folder.");
      file.parents = [folderId];
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.#call("deleteFile", { fileId }, () => {
      this.#require(fileId, "Failed to delete an old SutraPad index snapshot from Google Drive.");
      this.files.delete(fileId);
    });
  }

  createFolder(options: {
    name: string;
    appProperties: Record<string, string>;
  }): Promise<DriveFileRecord> {
    return this.#call("createFolder", {}, () =>
      this.seed({
        name: options.name,
        mimeType: FOLDER_MIME,
        appProperties: { ...options.appProperties },
        parents: ["root"],
        content: undefined,
      }),
    );
  }

  uploadJsonFile<T>(options: {
    fileId?: string;
    fileName: string;
    data: T;
    folderId: string;
    appProperties: Record<string, string>;
  }): Promise<DriveFileRecord> {
    return this.#call("uploadJsonFile", { fileId: options.fileId }, () => {
      if (options.appProperties.kind === "note") this.#noteUploads += 1;
      const content = structuredClone(options.data);
      const modifiedTime = new Date(this.#clock()).toISOString();
      if (options.fileId) {
        const existing = this.#require(options.fileId, "Failed to save data to Google Drive.");
        existing.name = options.fileName;
        existing.appProperties = { ...options.appProperties };
        existing.content = content;
        existing.modifiedTime = modifiedTime;
        // Drive keeps the existing parents on a PATCH — the store's
        // `ensureFileInFolder` follow-up is what re-parents.
        return toRecord(existing);
      }
      return this.seed({
        name: options.fileName,
        mimeType: "application/json",
        appProperties: { ...options.appProperties },
        parents: [options.folderId],
        content,
        modifiedTime,
      });
    });
  }

  // ---- internals -----------------------------------------------------------

  #allocateId(): string {
    const id = `fake-${this.#nextId}`;
    this.#nextId += 1;
    return id;
  }

  #require(fileId: string, message: string): FakeDriveFile {
    const file = this.files.get(fileId);
    if (!file || file.trashed) throw new GoogleDriveApiError(message, 404, "File not found");
    return file;
  }

  #takeFault(kind: DriveCallKind, detail: { fileId?: string; query?: string }): number | null {
    for (const fault of this.#faults) {
      const status = fault.match(kind, detail);
      if (status === null) continue;
      if (fault.times !== undefined) {
        fault.times -= 1;
        if (fault.times <= 0) this.#faults = this.#faults.filter((f) => f !== fault);
      }
      return status;
    }
    return null;
  }

  async #call<R>(
    kind: DriveCallKind,
    detail: { fileId?: string; query?: string },
    body: () => R,
  ): Promise<R> {
    this.#calls[kind] += 1;
    this.#inFlight += 1;
    this.#inFlightByKind[kind] += 1;
    this.#peakInFlight = Math.max(this.#peakInFlight, this.#inFlight);
    this.#peakInFlightByKind[kind] = Math.max(this.#peakInFlightByKind[kind], this.#inFlightByKind[kind]);
    try {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.#latencyMs);
      });
      const status = this.#takeFault(kind, detail);
      if (status !== null) {
        throw new GoogleDriveApiError(`FakeDrive injected ${status} on ${kind}`, status);
      }
      return body();
    } finally {
      this.#inFlight -= 1;
      this.#inFlightByKind[kind] -= 1;
    }
  }
}

function emptyCalls(): Record<DriveCallKind, number> {
  return {
    findFiles: 0,
    fetchJsonFile: 0,
    fetchFileMetadata: 0,
    ensureFileInFolder: 0,
    deleteFile: 0,
    createFolder: 0,
    uploadJsonFile: 0,
  };
}

function toRecord(file: FakeDriveFile): DriveFileRecord {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    appProperties: { ...file.appProperties },
    parents: [...file.parents],
  };
}
