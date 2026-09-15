import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_TASK_INDEX_KEY,
  emptyTaskIndex,
  loadLocalTaskIndex,
  persistLocalTaskIndex,
} from "../src/app/storage/local-task-index";
import { LOCAL_TASK_INDEX_MAX_BYTES } from "../src/lib/budgets";
import type { SutraPadTaskEntry, SutraPadTaskIndex } from "../src/types";

function entry(overrides: Partial<SutraPadTaskEntry> = {}): SutraPadTaskEntry {
  return {
    noteId: "n1",
    lineIndex: 2,
    text: "call the plumber",
    done: false,
    noteUpdatedAt: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

function index(tasks: SutraPadTaskEntry[]): SutraPadTaskIndex {
  return { version: 1, savedAt: "2026-09-15T08:00:00.000Z", tasks };
}

function readingStorage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: () => value };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emptyTaskIndex", () => {
  it("is the same seed the store used before there was a stored copy", () => {
    // `state-store.ts` hands this to `reconcileTaskIndexForWorkspace` as the
    // "nothing cached" case, so it has to stay byte-equal to the literal it
    // replaced — an index whose `savedAt` is a real-looking string would read
    // as a stale snapshot rather than as absence.
    expect(emptyTaskIndex()).toEqual({ version: 1, savedAt: "", tasks: [] });
  });
});

describe("loadLocalTaskIndex", () => {
  it("returns the empty index when nothing is stored", () => {
    expect(loadLocalTaskIndex(readingStorage(null))).toEqual(emptyTaskIndex());
  });

  it("round-trips a stored index", () => {
    const stored = index([entry(), entry({ noteId: "n2", done: true })]);

    const loaded = loadLocalTaskIndex(readingStorage(JSON.stringify(stored)));

    expect(loaded).toEqual(stored);
  });

  it("falls back to the empty index on unparseable JSON", () => {
    expect(loadLocalTaskIndex(readingStorage("{oh no"))).toEqual(emptyTaskIndex());
  });

  it("falls back to the empty index when the root is not an object", () => {
    expect(loadLocalTaskIndex(readingStorage('"a string"'))).toEqual(emptyTaskIndex());
    expect(loadLocalTaskIndex(readingStorage("null"))).toEqual(emptyTaskIndex());
  });

  it("falls back to the empty index when tasks is not an array", () => {
    const loaded = loadLocalTaskIndex(
      readingStorage(JSON.stringify({ version: 1, savedAt: "x", tasks: "nope" })),
    );

    expect(loaded).toEqual(emptyTaskIndex());
  });

  it("drops entries that fail the shape guard and keeps the rest", () => {
    // The slot survives deploys and is user-writable, so a wrong-shaped entry
    // reaching the Tasks page would crash a render — worse than the empty
    // list this whole module exists to avoid.
    const stored = {
      version: 1,
      savedAt: "2026-09-15T08:00:00.000Z",
      tasks: [
        entry(),
        { ...entry(), lineIndex: 1.5 },
        { ...entry(), done: "yes" },
        { ...entry(), noteId: 7 },
        { ...entry(), text: undefined },
        { ...entry(), noteUpdatedAt: null },
        null,
        "task",
        entry({ noteId: "n9" }),
      ],
    };

    const loaded = loadLocalTaskIndex(readingStorage(JSON.stringify(stored)));

    expect(loaded.tasks).toEqual([entry(), entry({ noteId: "n9" })]);
  });

  it("replaces a non-string savedAt rather than passing it through", () => {
    const loaded = loadLocalTaskIndex(
      readingStorage(JSON.stringify({ version: 1, savedAt: 17, tasks: [entry()] })),
    );

    expect(loaded.savedAt).toBe("");
    expect(loaded.tasks).toHaveLength(1);
  });

  it("survives a storage that throws on read", () => {
    // Safari private mode and blocked site data both throw from the accessor
    // itself, before any value comes back.
    const throwing: Pick<Storage, "getItem"> = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };

    expect(loadLocalTaskIndex(throwing)).toEqual(emptyTaskIndex());
  });
});

describe("persistLocalTaskIndex", () => {
  it("writes the serialized index under the shared key", () => {
    const setItem = vi.fn();
    const stored = index([entry()]);

    persistLocalTaskIndex(stored, { setItem });

    expect(setItem).toHaveBeenCalledWith(
      LOCAL_TASK_INDEX_KEY,
      JSON.stringify(stored),
    );
  });

  it("writes an index sitting exactly on the budget", () => {
    // The boundary is load-bearing in the cheap direction: refusing a write
    // that would have fit means the next cold boot shows no tasks for ~18 s
    // for nothing. Padded to land on the budget exactly.
    const setItem = vi.fn();
    const base = index([entry({ text: "" })]);
    const padding = LOCAL_TASK_INDEX_MAX_BYTES - JSON.stringify(base).length;
    const exact = index([entry({ text: "x".repeat(padding) })]);
    expect(JSON.stringify(exact).length).toBe(LOCAL_TASK_INDEX_MAX_BYTES);

    persistLocalTaskIndex(exact, { setItem });

    expect(setItem).toHaveBeenCalledOnce();
  });

  it("skips the write when the index is over budget", () => {
    // Filling the origin quota makes *every* later write throw, including the
    // workspace one — the copy that actually matters. So an oversized index
    // is dropped rather than attempted.
    const setItem = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const huge = index([
      entry({ text: "x".repeat(LOCAL_TASK_INDEX_MAX_BYTES + 1) }),
    ]);

    persistLocalTaskIndex(huge, { setItem });

    expect(setItem).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    // The warning is the only trace this left: nothing is painted, and the
    // symptom (no tasks on the next cold boot) looks exactly like the bug
    // this module fixed. An unlabelled console line would be no trace at all.
    expect(warn.mock.calls[0][0]).toContain("[storage]");
  });

  it("writes an index that sits just under the budget", () => {
    const setItem = vi.fn();
    const sized = index([entry({ text: "x".repeat(1000) })]);

    persistLocalTaskIndex(sized, { setItem });

    expect(setItem).toHaveBeenCalledOnce();
  });

  it("swallows a quota error from the write itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.fn(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    expect(() => persistLocalTaskIndex(index([entry()]), { setItem })).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("[storage]");
  });
});
