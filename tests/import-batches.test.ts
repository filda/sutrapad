import { describe, expect, it, vi } from "vitest";
import { runNoteImport } from "../src/app/logic/import-batches";
import type { SutraPadDocument } from "../src/types";

function note(id: string): SutraPadDocument {
  return {
    id,
    title: id,
    body: "b",
    urls: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    tags: [],
  };
}

const noSleep = () => Promise.resolve();

describe("runNoteImport", () => {
  it("uploads every note and reports done === total", async () => {
    const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`));
    const appendNote = vi.fn(() => Promise.resolve());
    const result = await runNoteImport({
      notes,
      appendNote,
      batchSize: 5,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(appendNote).toHaveBeenCalledTimes(12);
    expect(result).toEqual({ done: 12, failed: 0, total: 12 });
  });

  it("reports cumulative progress once per batch", async () => {
    const notes = Array.from({ length: 12 }, (_, i) => note(`n${i}`));
    const progress: Array<{ done: number; total: number }> = [];
    await runNoteImport({
      notes,
      appendNote: () => Promise.resolve(),
      batchSize: 5,
      delayMs: 0,
      sleep: noSleep,
      onProgress: (p) => progress.push({ done: p.done, total: p.total }),
    });
    // 12 notes / batch 5 => 3 batches => 3 progress callbacks, cumulative.
    expect(progress).toEqual([
      { done: 5, total: 12 },
      { done: 10, total: 12 },
      { done: 12, total: 12 },
    ]);
  });

  it("counts failed uploads without aborting the rest", async () => {
    const notes = [note("a"), note("b"), note("c")];
    const appendNote = vi.fn((n: SutraPadDocument) =>
      n.id === "b" ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    const result = await runNoteImport({
      notes,
      appendNote,
      batchSize: 1,
      delayMs: 0,
      sleep: noSleep,
    });
    expect(appendNote).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ done: 2, failed: 1, total: 3 });
  });

  it("sleeps between batches but not after the last one", async () => {
    const notes = Array.from({ length: 10 }, (_, i) => note(`n${i}`));
    const sleep = vi.fn(() => Promise.resolve());
    await runNoteImport({
      notes,
      appendNote: () => Promise.resolve(),
      batchSize: 5,
      delayMs: 50,
      sleep,
    });
    // 2 batches => exactly 1 inter-batch sleep.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("does not sleep when delayMs is 0", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await runNoteImport({
      notes: [note("a"), note("b")],
      appendNote: () => Promise.resolve(),
      batchSize: 1,
      delayMs: 0,
      sleep,
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("clamps a non-positive batch size to 1 (still uploads everything)", async () => {
    const notes = [note("a"), note("b"), note("c")];
    const appendNote = vi.fn(() => Promise.resolve());
    const sleep = vi.fn(() => Promise.resolve());
    const result = await runNoteImport({
      notes,
      appendNote,
      batchSize: 0,
      delayMs: 10,
      sleep,
    });
    expect(appendNote).toHaveBeenCalledTimes(3);
    // batch size 1 across 3 notes => 2 inter-batch sleeps.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.done).toBe(3);
  });

  it("is a no-op for an empty import", async () => {
    const appendNote = vi.fn(() => Promise.resolve());
    const onProgress = vi.fn();
    const result = await runNoteImport({
      notes: [],
      appendNote,
      sleep: noSleep,
      onProgress,
    });
    expect(appendNote).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(result).toEqual({ done: 0, failed: 0, total: 0 });
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------

describe("runNoteImport default sleep", () => {
  it("uses a real timer when the caller supplies no sleep", async () => {
    // Every test above injects `noSleep`, so the shipped `defaultSleep` — the
    // one that actually paces the Drive uploads in production — had no
    // coverage at all. Without its `setTimeout` the promise never settles and
    // an import hangs forever after the first batch.
    vi.useFakeTimers();
    try {
      const notes = [note("n0"), note("n1"), note("n2")];
      const appendNote = vi.fn(() => Promise.resolve());

      // No `sleep` override: the real one runs.
      const running = runNoteImport({ notes, appendNote, batchSize: 2, delayMs: 50 });

      // Flush microtasks by hand — `vi.waitFor` needs real time and does not
      // mix with fake timers. Ten turns is plenty for one batch of awaits.
      await Promise.all(Array.from({ length: 10 }, () => Promise.resolve()));

      // First batch lands, then the import parks on the real timer.
      expect(appendNote).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(50);
      const result = await running;

      expect(result.done).toBe(3);
      expect(appendNote).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
