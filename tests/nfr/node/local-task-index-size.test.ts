/**
 * Bytes the device-local task-index copy adds to localStorage at workspace
 * scale.
 *
 * The slot shares a 5–10 MiB origin quota with a local workspace that is
 * already ~1.2 MB at 6 470 notes, and the failure mode of filling that quota
 * is that *every* later write throws — including the workspace one, which is
 * the copy that matters. `persistLocalTaskIndex` refuses an oversized write
 * rather than attempting it; this pins that the real shape is nowhere near
 * the refusal line, so the guard stays a guard rather than becoming the
 * normal path. Bytes serialised, counted not timed — `docs/nfr-testing-plan.md`
 * principle 2.
 */
import { describe, expect, it, vi } from "vitest";
import {
  loadLocalTaskIndex,
  persistLocalTaskIndex,
} from "../../../src/app/storage/local-task-index";
import { LOCAL_TASK_INDEX_MAX_BYTES } from "../../../src/lib/budgets";
import { buildTaskIndex } from "../../../src/lib/tasks";
import { generateWorkspace, REAL_SHAPE } from "../workspace-fixture";

describe("local task index at workspace scale", () => {
  it("serializes well inside the storage budget", () => {
    const index = buildTaskIndex(generateWorkspace(REAL_SHAPE));
    const bytes = JSON.stringify(index).length;

    // A budget an empty index would also satisfy proves nothing.
    expect(index.tasks.length).toBeGreaterThan(0);
    expect(bytes, `${bytes} bytes`).toBeLessThan(LOCAL_TASK_INDEX_MAX_BYTES / 2);
  });

  it("round-trips the workspace-scale index through the storage shim", () => {
    // The shape guard runs per entry on every load, so it has to survive the
    // real population rather than the handful a unit test uses.
    const index = buildTaskIndex(generateWorkspace(REAL_SHAPE));
    let written = "";
    const storage = {
      setItem: (_key: string, value: string) => {
        written = value;
      },
      getItem: () => written,
    };

    persistLocalTaskIndex(index, storage);
    const loaded = loadLocalTaskIndex(storage);

    expect(loaded.tasks).toEqual(index.tasks);
  });

  it("refuses rather than throws when an index would blow the budget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.fn();
    const index = buildTaskIndex(generateWorkspace(REAL_SHAPE));
    const bloated = {
      ...index,
      tasks: index.tasks.map((task) =>
        Object.assign({}, task, { text: task.text.padEnd(4000, "x") }),
      ),
    };

    persistLocalTaskIndex(bloated, { setItem });

    expect(setItem).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
