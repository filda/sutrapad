import { describe, expect, it } from "vitest";
import type { DriveFileRecord } from "../src/types";
import type { DriveClient } from "../src/services/drive/workspace-store";
import {
  addDriveCounts,
  createDriveMeter,
  DRIVE_CALL_KINDS,
  emptyDriveCounts,
} from "../src/services/drive/drive-meter";

function record(id: string): DriveFileRecord {
  return { id, name: `${id}.json` };
}

/** A client whose every call resolves on the next macrotask, so calls overlap. */
function slowClient(): DriveClient & { fail: Set<string> } {
  const fail = new Set<string>();
  const settle = <T>(kind: string, value: T): Promise<T> =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (fail.has(kind)) reject(new Error(`${kind} failed`));
        else resolve(value);
      }, 0);
    });
  return {
    fail,
    findFiles: () => settle("findFiles", [record("a")]),
    findSingleFile: () => settle("findSingleFile", record("a")),
    fetchJsonFile: <T>() => settle("fetchJsonFile", { v: 1 } as T),
    fetchFileMetadata: () => settle("fetchFileMetadata", record("a")),
    ensureFileInFolder: () => settle("ensureFileInFolder", undefined),
    deleteFile: () => settle("deleteFile", undefined),
    createFolder: () => settle("createFolder", record("folder")),
    uploadJsonFile: () => settle("uploadJsonFile", record("up")),
  };
}

describe("createDriveMeter", () => {
  it("starts empty and counts every call kind, forwarding arguments and results", async () => {
    const meter = createDriveMeter();
    expect(meter.snapshot()).toEqual(emptyDriveCounts());

    const client = meter.wrap(slowClient());
    await expect(client.findFiles("q", 5)).resolves.toEqual([record("a")]);
    await expect(client.fetchJsonFile("a")).resolves.toEqual({ v: 1 });
    await client.fetchFileMetadata("a");
    await client.ensureFileInFolder("a", "f");
    await client.deleteFile("a");
    await client.createFolder({ name: "x", appProperties: {} });
    await client.uploadJsonFile({ fileName: "x", data: {}, folderId: "f", appProperties: { kind: "tags" } });

    const counts = meter.snapshot();
    for (const kind of DRIVE_CALL_KINDS) expect(counts.calls[kind]).toBe(1);
    expect(counts.total).toBe(7);
    expect(counts.noteUploads).toBe(0);
    expect(counts.failures).toBe(0);
  });

  it("counts findSingleFile as a findFiles request — it is one on the wire", async () => {
    const meter = createDriveMeter();
    const client = meter.wrap(slowClient());
    await client.findSingleFile("q");
    expect(meter.snapshot().calls.findFiles).toBe(1);
    expect(meter.snapshot().total).toBe(1);
  });

  it("singles out note-file uploads by appProperties.kind", async () => {
    const meter = createDriveMeter();
    const client = meter.wrap(slowClient());
    await client.uploadJsonFile({ fileName: "n", data: {}, folderId: "f", appProperties: { kind: "note" } });
    await client.uploadJsonFile({ fileName: "i", data: {}, folderId: "f", appProperties: { kind: "index" } });
    expect(meter.snapshot()).toMatchObject({ noteUploads: 1, calls: { uploadJsonFile: 2 } });
  });

  it("tracks peak in-flight and counts failures without swallowing them", async () => {
    const meter = createDriveMeter();
    const raw = slowClient();
    const client = meter.wrap(raw);
    await Promise.all([client.fetchJsonFile("a"), client.fetchJsonFile("b"), client.fetchJsonFile("c")]);
    expect(meter.snapshot().peakInFlight).toBe(3);

    raw.fail.add("deleteFile");
    await expect(client.deleteFile("a")).rejects.toThrow("deleteFile failed");
    expect(meter.snapshot().failures).toBe(1);
    expect(meter.snapshot().calls.deleteFile).toBe(1);
  });

  it("reset clears counts, uploads, failures and the peak", async () => {
    const meter = createDriveMeter();
    const raw = slowClient();
    const client = meter.wrap(raw);
    await client.uploadJsonFile({ fileName: "n", data: {}, folderId: "f", appProperties: { kind: "note" } });
    raw.fail.add("deleteFile");
    await client.deleteFile("a").catch(() => {});
    meter.reset();
    expect(meter.snapshot()).toEqual(emptyDriveCounts());
  });
});

describe("addDriveCounts", () => {
  it("adds every field and takes the max of the peaks", () => {
    const a = { ...emptyDriveCounts(), calls: { ...emptyDriveCounts().calls, findFiles: 2 }, total: 2, noteUploads: 1, peakInFlight: 3, failures: 1 };
    const b = { ...emptyDriveCounts(), calls: { ...emptyDriveCounts().calls, findFiles: 1, uploadJsonFile: 4 }, total: 5, noteUploads: 4, peakInFlight: 8, failures: 0 };
    const sum = addDriveCounts(a, b);
    expect(sum.calls.findFiles).toBe(3);
    expect(sum.calls.uploadJsonFile).toBe(4);
    expect(sum).toMatchObject({ total: 7, noteUploads: 5, peakInFlight: 8, failures: 1 });
  });
});
