/**
 * Request metering for the Drive client — the runtime half of the
 * non-functional budgets (`docs/nfr-testing-plan.md`, layer 2). Wraps a
 * `DriveClient` and counts every call by kind, tracks how many are in
 * flight at once, and singles out note-file uploads, which is the number
 * the 2026-09-07 incident was made of. Pure bookkeeping: no timing, no
 * logging — the caller decides what to do with a snapshot.
 *
 * `tests/nfr/fake-drive.ts` keeps its own counters for the test side, keyed
 * by the same `DriveCallKind`.
 */
import type { DriveClient } from "./workspace-store";

export type DriveCallKind =
  | "findFiles"
  | "fetchJsonFile"
  | "fetchFileMetadata"
  | "ensureFileInFolder"
  | "deleteFile"
  | "createFolder"
  | "uploadJsonFile";

export const DRIVE_CALL_KINDS: readonly DriveCallKind[] = [
  "findFiles",
  "fetchJsonFile",
  "fetchFileMetadata",
  "ensureFileInFolder",
  "deleteFile",
  "createFolder",
  "uploadJsonFile",
];

export interface DriveMeterCounts {
  readonly calls: Readonly<Record<DriveCallKind, number>>;
  /** Every call of every kind. */
  readonly total: number;
  /** Uploads whose `appProperties.kind` was `note` — real note-file writes. */
  readonly noteUploads: number;
  /** Highest number of calls simultaneously in flight. */
  readonly peakInFlight: number;
  /** Calls that rejected (after the client's own error mapping). */
  readonly failures: number;
}

export interface DriveMeter {
  /** Returns a `DriveClient` that forwards to `client` and counts. */
  wrap(client: DriveClient): DriveClient;
  snapshot(): DriveMeterCounts;
  reset(): void;
}

export function emptyDriveCounts(): DriveMeterCounts {
  return {
    calls: zeroByKind(),
    total: 0,
    noteUploads: 0,
    peakInFlight: 0,
    failures: 0,
  };
}

/** `a + b`, field by field; peak is the max of the two peaks. */
export function addDriveCounts(a: DriveMeterCounts, b: DriveMeterCounts): DriveMeterCounts {
  const calls = zeroByKind();
  for (const kind of DRIVE_CALL_KINDS) calls[kind] = a.calls[kind] + b.calls[kind];
  return {
    calls,
    total: a.total + b.total,
    noteUploads: a.noteUploads + b.noteUploads,
    peakInFlight: Math.max(a.peakInFlight, b.peakInFlight),
    failures: a.failures + b.failures,
  };
}

export function createDriveMeter(): DriveMeter {
  let calls = zeroByKind();
  let noteUploads = 0;
  let failures = 0;
  let inFlight = 0;
  let peakInFlight = 0;

  const measure = async <R>(kind: DriveCallKind, run: () => Promise<R>): Promise<R> => {
    calls[kind] += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      return await run();
    } catch (error) {
      failures += 1;
      throw error;
    } finally {
      inFlight -= 1;
    }
  };

  return {
    wrap(client) {
      return {
        findFiles: (query, maxResults) =>
          measure("findFiles", () => client.findFiles(query, maxResults)),
        findSingleFile: (query) =>
          // `findSingleFile` is one `findFiles` page on the wire; count it as such
          // so the meter reports requests, not helper invocations.
          measure("findFiles", () => client.findSingleFile(query)),
        fetchJsonFile: (fileId) => measure("fetchJsonFile", () => client.fetchJsonFile(fileId)),
        fetchFileMetadata: (fileId) =>
          measure("fetchFileMetadata", () => client.fetchFileMetadata(fileId)),
        ensureFileInFolder: (fileId, folderId) =>
          measure("ensureFileInFolder", () => client.ensureFileInFolder(fileId, folderId)),
        deleteFile: (fileId) => measure("deleteFile", () => client.deleteFile(fileId)),
        createFolder: (options) => measure("createFolder", () => client.createFolder(options)),
        uploadJsonFile: (options) => {
          if (options.appProperties.kind === "note") noteUploads += 1;
          return measure("uploadJsonFile", () => client.uploadJsonFile(options));
        },
      };
    },
    snapshot() {
      const total = DRIVE_CALL_KINDS.reduce((sum, kind) => sum + calls[kind], 0);
      return { calls: { ...calls }, total, noteUploads, peakInFlight, failures };
    },
    reset() {
      calls = zeroByKind();
      noteUploads = 0;
      failures = 0;
      peakInFlight = 0;
    },
  };
}

function zeroByKind(): Record<DriveCallKind, number> {
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
