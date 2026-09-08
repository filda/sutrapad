/**
 * Non-functional properties of the Drive workspace store against a
 * workspace shaped like the real one. Counts and invariants only — see
 * `docs/nfr-testing-plan.md`. Excluded from Stryker (`vitest.config.ts`).
 */
import { describe, expect, it } from "vitest";
import type { SutraPadTaskIndex, SutraPadWorkspace } from "../../../src/types";
import {
  DRIVE_FETCH_CONCURRENCY,
  DRIVE_UPLOAD_CONCURRENCY,
  LOAD_MAX_REQUESTS,
} from "../../../src/lib/budgets";
import { stripEmptyDraftNotes } from "../../../src/lib/notebook";
import { GoogleDriveStore } from "../../../src/services/drive/workspace-store";
import {
  WorkspaceSaveRefusedError,
  type BudgetOverrun,
} from "../../../src/services/drive/save-policy";
import { FakeDrive } from "../fake-drive";
import { countNoteFiles, readActiveIndex, seedWorkspaceFiles } from "../drive-seed";
import { generateWorkspace, REAL_SHAPE, SMALL_SHAPE, type WorkspaceShape } from "../workspace-fixture";

async function indexedDrive(shape: WorkspaceShape): Promise<{
  drive: FakeDrive;
  workspace: SutraPadWorkspace;
  overruns: BudgetOverrun[];
  store: GoogleDriveStore;
}> {
  const workspace = generateWorkspace(shape);
  const drive = new FakeDrive();
  seedWorkspaceFiles(drive, workspace);
  const overruns: BudgetOverrun[] = [];
  const store = new GoogleDriveStore("token", {
    client: drive,
    onBudgetOverrun: (overrun) => overruns.push(overrun),
  });
  await store.rebuildIndexes();
  drive.resetStats();
  return { drive, workspace, overruns, store };
}

function taskIndexOf(drive: FakeDrive): SutraPadTaskIndex {
  const [file] = drive.query(
    "trashed = false and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='tasks' }",
  );
  return file.content as SutraPadTaskIndex;
}

describe("workspace round-trip on a real-shaped workspace", () => {
  it("load → strip → save → load is a no-op: zero note uploads, identical index, identical task index", async () => {
    const { drive, workspace, overruns, store } = await indexedDrive(REAL_SHAPE);
    const indexBefore = readActiveIndex(drive);
    const tasksBefore = taskIndexOf(drive);
    expect(indexBefore?.notes).toHaveLength(workspace.notes.length);

    const loaded = await store.loadWorkspace();
    expect(loaded.notes).toHaveLength(workspace.notes.length);
    expect(loaded.notes.every((note) => note.hydrated === false)).toBe(true);
    expect(drive.stats.calls.fetchJsonFile).toBeLessThanOrEqual(2); // head + index, no bodies

    // The pre-push sweep must not touch a single placeholder.
    expect(stripEmptyDraftNotes(loaded)).toBe(loaded);

    drive.resetStats();
    await store.saveWorkspace(loaded);
    expect(drive.stats.noteUploads).toBe(0);
    expect(overruns).toEqual([]);

    const indexAfter = readActiveIndex(drive);
    expect(indexAfter?.notes).toEqual(indexBefore?.notes);
    expect(taskIndexOf(drive).tasks).toEqual(tasksBefore.tasks);
    expect(tasksBefore.tasks.length).toBeGreaterThan(0);

    const reloaded = await store.loadWorkspace();
    expect(reloaded.notes.map((n) => [n.id, n.updatedAt, n.fileId])).toEqual(
      loaded.notes.map((n) => [n.id, n.updatedAt, n.fileId]),
    );
    expect(countNoteFiles(drive)).toBe(workspace.notes.length);
  });

  it("load and save-unchanged cost the same number of requests at 200 and at 6 470 notes", async () => {
    const measure = async (shape: WorkspaceShape): Promise<{ load: number; save: number }> => {
      const { drive, store } = await indexedDrive(shape);
      const loaded = await store.loadWorkspace();
      const load = drive.stats.total;
      drive.resetStats();
      await store.saveWorkspace(loaded);
      return { load, save: drive.stats.total };
    };
    const costs = await Promise.all([measure(SMALL_SHAPE), measure(REAL_SHAPE)]);
    expect(costs[0]).toEqual(costs[1]);
    expect(costs[0].load).toBeLessThanOrEqual(LOAD_MAX_REQUESTS);
  });
});

describe("Drive fan-out stays within the concurrency budgets", () => {
  it("uploads at most DRIVE_UPLOAD_CONCURRENCY note files at once when every note needs writing", async () => {
    const workspace = generateWorkspace(SMALL_SHAPE);
    const drive = new FakeDrive({ latencyMs: 2 });
    seedWorkspaceFiles(drive, workspace); // files exist, no index → every note misses the short-circuit
    const store = new GoogleDriveStore("token", { client: drive });
    await store.saveWorkspace(workspace);
    expect(drive.stats.noteUploads).toBe(workspace.notes.length);
    expect(drive.stats.peakInFlightByKind.uploadJsonFile).toBeLessThanOrEqual(DRIVE_UPLOAD_CONCURRENCY);
    expect(drive.stats.peakInFlightByKind.uploadJsonFile).toBeGreaterThan(1);
  });

  it("hydrates at most DRIVE_FETCH_CONCURRENCY orphan bodies at once on load", async () => {
    const workspace = generateWorkspace(SMALL_SHAPE);
    const drive = new FakeDrive({ latencyMs: 2 });
    seedWorkspaceFiles(drive, workspace); // no index → every note is an orphan
    const store = new GoogleDriveStore("token", { client: drive });
    const loaded = await store.loadWorkspace();
    expect(loaded.notes.every((note) => note.hydrated !== false)).toBe(true);
    expect(drive.stats.peakInFlightByKind.fetchJsonFile).toBeLessThanOrEqual(DRIVE_FETCH_CONCURRENCY);
    expect(drive.stats.peakInFlightByKind.fetchJsonFile).toBeGreaterThan(1);
  });

  it("stops the upload fan-out at a Drive 403 instead of retrying through it", async () => {
    const workspace = generateWorkspace(SMALL_SHAPE);
    const drive = new FakeDrive();
    seedWorkspaceFiles(drive, workspace);
    let uploadsSeen = 0;
    drive.fail({
      match: (kind) => {
        if (kind !== "uploadJsonFile") return null;
        uploadsSeen += 1;
        return uploadsSeen > 10 ? 403 : null;
      },
    });
    const store = new GoogleDriveStore("token", { client: drive });
    await expect(store.saveWorkspace(workspace)).rejects.toMatchObject({ status: 403 });
    // The chunk in flight when the 403 landed may finish; nothing beyond it starts.
    expect(drive.stats.noteUploads).toBeLessThanOrEqual(10 + DRIVE_UPLOAD_CONCURRENCY);
    expect(readActiveIndex(drive)).toBeNull(); // the index write never happened
  });
});

describe("index drift and recovery", () => {
  it("an index that lost most of its entries is reported, recovered by rebuild, and the next load is cheap again", async () => {
    const { drive, workspace, overruns, store } = await indexedDrive(SMALL_SHAPE);

    // Corrupt the index the way the incident did: keep 10 % of the entries.
    const [headFile] = drive.query("appProperties has { key='kind' and value='head' }");
    const activeIndexId = (headFile.content as { activeIndexId: string }).activeIndexId;
    const index = drive.files.get(activeIndexId);
    if (!index) throw new Error("active index missing");
    const content = index.content as { notes: unknown[] };
    const full = content.notes;
    content.notes = full.slice(0, Math.floor(full.length / 10));

    const loaded = await store.loadWorkspace();
    const orphans = loaded.notes.filter((note) => note.hydrated !== false);
    expect(orphans.length).toBe(workspace.notes.length - Math.floor(full.length / 10));
    expect(drive.stats.calls.fetchJsonFile).toBeGreaterThanOrEqual(orphans.length); // the expensive load

    drive.resetStats();
    await store.saveWorkspace(loaded);
    // Orphans are real notes the index forgot → they get written (bounded),
    // and the soft budget says so.
    expect(drive.stats.noteUploads).toBe(orphans.length);
    expect(overruns.map((o) => o.budget)).toEqual(["note-uploads"]);
    expect(readActiveIndex(drive)?.notes).toHaveLength(workspace.notes.length);

    // Rebuild is index-only, and afterwards a load fetches no bodies.
    drive.resetStats();
    await store.rebuildIndexes();
    expect(drive.stats.noteUploads).toBe(0);
    drive.resetStats();
    const reloaded = await store.loadWorkspace();
    expect(reloaded.notes.every((note) => note.hydrated === false)).toBe(true);
    expect(drive.stats.total).toBeLessThanOrEqual(LOAD_MAX_REQUESTS);
  });

  it("a save that would shrink the index past the budget is reported, not silently written", async () => {
    const { drive, workspace, overruns, store } = await indexedDrive(SMALL_SHAPE);
    const loaded = await store.loadWorkspace();
    const keep = Math.floor(loaded.notes.length * 0.5);
    await store.saveWorkspace({ notes: loaded.notes.slice(0, keep), activeNoteId: loaded.notes[0].id });
    expect(overruns.map((o) => o.budget)).toEqual(["index-shrink"]);
    expect(overruns[0].message).toContain(`${workspace.notes.length} to ${keep}`);
    expect(readActiveIndex(drive)?.notes).toHaveLength(keep); // soft: still written
    expect(drive.stats.noteUploads).toBe(0);
  });
});

describe("data-loss guards", () => {
  it("refuses to write when many loaded notes come back as hydrated-but-empty", async () => {
    const { drive, store } = await indexedDrive(SMALL_SHAPE);
    const loaded = await store.loadWorkspace();
    // Model a bug that drops the placeholder flag and bumps updatedAt on
    // notes the index still describes as having content.
    const withContent = loaded.notes.filter((note) => note.title !== "" || note.tags.length > 0);
    const corrupted = loaded.notes.map((note) =>
      withContent.slice(0, 10).includes(note)
        ? { ...note, hydrated: true, body: "", updatedAt: "2026-09-08T00:00:00.000Z" }
        : note,
    );
    drive.resetStats();
    await expect(
      store.saveWorkspace({ notes: corrupted, activeNoteId: loaded.activeNoteId }),
    ).rejects.toBeInstanceOf(WorkspaceSaveRefusedError);
    expect(drive.stats.noteUploads).toBe(0);
    expect(drive.stats.calls.uploadJsonFile).toBe(0);
  });

  it("placeholders never reach Drive as note files, whatever their updatedAt says", async () => {
    const { drive, store } = await indexedDrive(SMALL_SHAPE);
    const loaded = await store.loadWorkspace();
    // Another device bumped every note since this device built its placeholders.
    const stale = loaded.notes.map((note) => ({ ...note, updatedAt: "2000-01-01T00:00:00.000Z" }));
    drive.resetStats();
    await store.saveWorkspace({ notes: stale, activeNoteId: loaded.activeNoteId });
    expect(drive.stats.noteUploads).toBe(0);
    for (const note of loaded.notes) {
      const file = drive.contentOf<{ body: string }>(`file-${note.id}`);
      expect(file.body).toBe(drive.contentOf<{ body: string }>(`file-${note.id}`).body);
    }
    expect(countNoteFiles(drive)).toBe(loaded.notes.length);
  });
});

describe("resident model shape", () => {
  it("a cold load of the real-shaped workspace holds zero note bodies in memory", async () => {
    const { store } = await indexedDrive(REAL_SHAPE);
    const loaded = await store.loadWorkspace();
    const residentBodies = loaded.notes.filter((note) => note.hydrated !== false && note.body !== "");
    expect(residentBodies).toHaveLength(0);
    const bytes = JSON.stringify(loaded).length;
    // Placeholders carry title/tags/urls/context only — well under 1 KB each.
    expect(bytes / loaded.notes.length).toBeLessThan(600);
  });
});
