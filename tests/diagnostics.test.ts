import { describe, expect, it } from "vitest";
import {
  createEmptyDiagnostics,
  describeDiagnostics,
  describeOperationForConsole,
  DRIVE_OPERATION_KINDS,
  formatDuration,
  formatMegabytes,
  INTERACTION_WARN_MS,
  LONG_TASK_WARN_MS,
  MAX_OVERRUNS_KEPT,
  recordHeapSample,
  recordInteraction,
  recordLongTask,
  recordOperation,
  recordOverrun,
  recordPhase,
  type DriveOperationRecord,
} from "../src/app/logic/diagnostics";
import { emptyDriveCounts } from "../src/services/drive/drive-meter";
import type { BudgetOverrun } from "../src/services/drive/save-policy";

function op(overrides: Partial<DriveOperationRecord> = {}): DriveOperationRecord {
  const counts = emptyDriveCounts();
  return {
    kind: "save",
    at: "2026-09-08T10:00:00.000Z",
    durationMs: 1234,
    ok: true,
    counts: { ...counts, calls: { ...counts.calls, findFiles: 3, uploadJsonFile: 2 }, total: 5, noteUploads: 1, peakInFlight: 2, networkMs: 900 },
    ...overrides,
  };
}

const overrun = (n: number): BudgetOverrun => ({
  budget: "note-uploads",
  observed: n,
  limit: 50,
  message: `overrun ${n}`,
});

describe("diagnostics reducers", () => {
  it("starts with no operations, no overruns, zeroed main-thread stats and an unknown heap", () => {
    const empty = createEmptyDiagnostics();
    for (const kind of DRIVE_OPERATION_KINDS) expect(empty.lastOperation[kind]).toBeNull();
    expect(empty.operationCount).toBe(0);
    expect(empty.overruns).toEqual([]);
    expect(empty.mainThread).toEqual({
      longTasks: { count: 0, maxMs: 0 },
      interactions: { count: 0, maxMs: 0 },
      heapUsedBytes: null,
      phases: {
        render: { count: 0, maxMs: 0, totalMs: 0 },
        persist: { count: 0, maxMs: 0, totalMs: 0 },
      },
    });
  });

  it("recordOperation keeps the latest record per kind and accumulates session totals", () => {
    let snapshot = createEmptyDiagnostics();
    snapshot = recordOperation(snapshot, op({ kind: "load", durationMs: 100 }));
    snapshot = recordOperation(snapshot, op({ kind: "save", durationMs: 200 }));
    snapshot = recordOperation(snapshot, op({ kind: "save", durationMs: 300, ok: false }));
    expect(snapshot.lastOperation.load?.durationMs).toBe(100);
    expect(snapshot.lastOperation.save).toMatchObject({ durationMs: 300, ok: false });
    expect(snapshot.lastOperation.refresh).toBeNull();
    expect(snapshot.operationCount).toBe(3);
    expect(snapshot.sessionCounts).toMatchObject({ total: 15, noteUploads: 3, peakInFlight: 2 });
    expect(snapshot.sessionCounts.calls.findFiles).toBe(9);
  });

  it("recordOperation does not mutate its input", () => {
    const before = createEmptyDiagnostics();
    const after = recordOperation(before, op());
    expect(before.operationCount).toBe(0);
    expect(after).not.toBe(before);
  });

  it("recordOverrun prepends and caps the list", () => {
    let snapshot = createEmptyDiagnostics();
    for (let i = 1; i <= MAX_OVERRUNS_KEPT + 3; i += 1) snapshot = recordOverrun(snapshot, overrun(i));
    expect(snapshot.overruns).toHaveLength(MAX_OVERRUNS_KEPT);
    expect(snapshot.overruns[0].observed).toBe(MAX_OVERRUNS_KEPT + 3);
    expect(snapshot.overruns.at(-1)?.observed).toBe(4);
  });

  it("recordLongTask / recordInteraction count and keep the worst case", () => {
    let snapshot = createEmptyDiagnostics();
    snapshot = recordLongTask(snapshot, 80);
    snapshot = recordLongTask(snapshot, 320);
    snapshot = recordLongTask(snapshot, 60);
    snapshot = recordInteraction(snapshot, 24);
    snapshot = recordInteraction(snapshot, 410);
    expect(snapshot.mainThread.longTasks).toEqual({ count: 3, maxMs: 320 });
    expect(snapshot.mainThread.interactions).toEqual({ count: 2, maxMs: 410 });
    // Untouched fields survive.
    expect(snapshot.mainThread.heapUsedBytes).toBeNull();
    expect(snapshot.operationCount).toBe(0);
  });

  it("recordPhase counts, keeps the worst case and sums per phase", () => {
    let snapshot = recordPhase(createEmptyDiagnostics(), "render", 120);
    snapshot = recordPhase(snapshot, "render", 30);
    snapshot = recordPhase(snapshot, "persist", 450);
    expect(snapshot.mainThread.phases.render).toEqual({ count: 2, maxMs: 120, totalMs: 150 });
    expect(snapshot.mainThread.phases.persist).toEqual({ count: 1, maxMs: 450, totalMs: 450 });
    expect(snapshot.mainThread.longTasks.count).toBe(0);
  });

  it("recordHeapSample replaces the sample", () => {
    let snapshot = recordHeapSample(createEmptyDiagnostics(), 10);
    snapshot = recordHeapSample(snapshot, 20);
    expect(snapshot.mainThread.heapUsedBytes).toBe(20);
  });

  it("pins the console warn thresholds", () => {
    expect(INTERACTION_WARN_MS).toBe(200);
    expect(LONG_TASK_WARN_MS).toBe(200);
  });
});

describe("diagnostics formatting", () => {
  it("formatDuration switches to seconds at 1000 ms and rounds milliseconds", () => {
    expect(formatDuration(87.4)).toBe("87 ms");
    expect(formatDuration(999.6)).toBe("1000 ms");
    expect(formatDuration(1000)).toBe("1.0 s");
    expect(formatDuration(12_345)).toBe("12.3 s");
  });

  it("formatMegabytes uses binary megabytes with one decimal", () => {
    expect(formatMegabytes(0)).toBe("0.0 MB");
    expect(formatMegabytes(12.3 * 1024 * 1024)).toBe("12.3 MB");
  });

  it("describeOperationForConsole names the kind, counts, peak, duration and a failure flag", () => {
    expect(describeOperationForConsole(op())).toBe(
      "[drive] save · 5 requests · 1 note uploads · peak 2 · 1.2 s · network 900 ms",
    );
    expect(describeOperationForConsole(op({ ok: false }))).toMatch(/ · FAILED$/u);
    expect(describeOperationForConsole(op())).not.toContain("FAILED");
  });
});

describe("describeDiagnostics", () => {
  it("renders every row as a placeholder on an empty snapshot", () => {
    const rows = describeDiagnostics(createEmptyDiagnostics(), "en");
    expect(rows.map((row) => row.id)).toEqual([
      "lastLoad",
      "lastRestore",
      "lastSave",
      "lastRefresh",
      "lastRebuild",
      "lastHydrate",
      "lastReseed",
      "session",
      "overruns",
      "mainThread",
      "render",
      "persist",
      "memory",
    ]);
    const byId = new Map(rows.map((row) => [row.id, row.value]));
    for (const id of [
      "lastLoad",
      "lastRestore",
      "lastSave",
      "lastRefresh",
      "lastRebuild",
      "lastHydrate",
      "lastReseed",
      "session",
      "mainThread",
      "render",
      "persist",
    ] as const) {
      expect(byId.get(id)).toBe("—");
    }
    expect(byId.get("overruns")).toBe("None");
    expect(byId.get("memory")).toBe("Not available in this browser");
  });

  it("describes an operation with requests, uploads (only when non-zero), duration and failure", () => {
    let snapshot = recordOperation(createEmptyDiagnostics(), op({ kind: "load", durationMs: 480, counts: { ...emptyDriveCounts(), total: 6, networkMs: 310 } }));
    snapshot = recordOperation(snapshot, op({ kind: "save", ok: false }));
    snapshot = recordPhase(snapshot, "render", 1500);
    snapshot = recordPhase(snapshot, "render", 500);
    const byId = new Map(describeDiagnostics(snapshot, "en").map((row) => [row.id, row.value]));
    expect(byId.get("lastLoad")).toBe("6 requests · 480 ms · network 310 ms");
    expect(byId.get("lastSave")).toBe("5 requests · 1 note uploaded · 1.2 s · network 900 ms · failed");
    expect(byId.get("render")).toBe("2 × · longest 1.5 s · total 2.0 s");
    expect(byId.get("session")).toBe("2 operations · 11 requests · 1 note uploaded");
  });

  it("summarises overruns, main-thread stats and heap", () => {
    let snapshot = recordOverrun(createEmptyDiagnostics(), overrun(7));
    snapshot = recordOverrun(snapshot, overrun(9));
    snapshot = recordLongTask(snapshot, 320);
    snapshot = recordInteraction(snapshot, 1500);
    snapshot = recordHeapSample(snapshot, 12.3 * 1024 * 1024);
    const byId = new Map(describeDiagnostics(snapshot, "en").map((row) => [row.id, row.value]));
    expect(byId.get("overruns")).toBe("2 overruns · overrun 9");
    expect(byId.get("mainThread")).toBe("1 long tasks (longest 320 ms) · 1 interactions (slowest 1.5 s)");
    expect(byId.get("memory")).toBe("12.3 MB");
  });

  it("uses Czech plural forms and labels for the cs locale", () => {
    const counts = { ...emptyDriveCounts(), total: 3, noteUploads: 2, networkMs: 40 };
    const snapshot = recordOperation(createEmptyDiagnostics(), op({ kind: "save", counts, durationMs: 90 }));
    const rows = describeDiagnostics(snapshot, "cs");
    expect(rows.find((row) => row.id === "lastSave")).toEqual({
      id: "lastSave",
      label: "Poslední uložení",
      value: "3 požadavky · 2 poznámky nahrány · 90 ms · síť 40 ms",
    });
    expect(rows.find((row) => row.id === "session")?.value).toBe("1 operace · 3 požadavky · 2 poznámky nahrány");
    expect(rows.find((row) => row.id === "overruns")?.value).toBe("Žádná");
  });
});
