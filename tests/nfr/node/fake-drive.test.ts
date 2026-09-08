import { describe, expect, it } from "vitest";
import { GoogleDriveStore } from "../../../src/services/drive/workspace-store";
import { GoogleDriveApiError } from "../../../src/services/drive/client";
import { FakeDrive } from "../fake-drive";

describe("FakeDrive", () => {
  it("lets a real GoogleDriveStore create, save, and reload a workspace", async () => {
    const drive = new FakeDrive();
    const store = new GoogleDriveStore("token", { client: drive });
    await store.saveWorkspace({
      notes: [
        {
          id: "a",
          title: "A",
          body: "hello",
          tags: ["t"],
          urls: [],
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      activeNoteId: "a",
    });
    expect(drive.stats.noteUploads).toBe(1);
    expect(drive.query("trashed = false and appProperties has { key='kind' and value='head' }")).toHaveLength(1);

    const loaded = await new GoogleDriveStore("token", { client: drive }).loadWorkspace();
    expect(loaded.notes.map((n) => [n.id, n.hydrated])).toEqual([["a", false]]);
  });

  it("counts calls, tracks peak concurrency, and injects faults", async () => {
    const drive = new FakeDrive({ latencyMs: 1 });
    drive.seed({ name: "x.json", mimeType: "application/json", appProperties: {}, parents: ["p"], content: { v: 1 } , id: "x" });
    await Promise.all([drive.fetchJsonFile("x"), drive.fetchJsonFile("x"), drive.fetchJsonFile("x")]);
    expect(drive.stats.calls.fetchJsonFile).toBe(3);
    expect(drive.stats.peakInFlight).toBe(3);

    drive.fail({ match: (kind) => (kind === "fetchJsonFile" ? 429 : null), times: 1 });
    await expect(drive.fetchJsonFile("x")).rejects.toMatchObject({ status: 429 });
    await expect(drive.fetchJsonFile("x")).resolves.toEqual({ v: 1 });
    await expect(drive.fetchJsonFile("missing")).rejects.toBeInstanceOf(GoogleDriveApiError);
  });
});
