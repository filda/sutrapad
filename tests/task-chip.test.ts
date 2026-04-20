import { describe, expect, it } from "vitest";
import { describeTaskChip } from "../src/app/logic/task-chip";

describe("describeTaskChip", () => {
  it("returns null when the note has no tasks", () => {
    // Notes without tasks should render no chip at all; keeps the notebook
    // list visually clean for note-takers who do not use checkboxes.
    expect(describeTaskChip({ open: 0, done: 0 })).toBeNull();
  });

  it("describes an open-tasks chip when at least one task is still open", () => {
    const chip = describeTaskChip({ open: 2, done: 3 });

    expect(chip).toEqual({
      tone: "has-open",
      text: "☐ 2/5",
      ariaLabel: "2 of 5 tasks open",
    });
  });

  it("describes an all-done chip when every task is completed", () => {
    // Completed notebooks use a muted ✓ variant so they read as "finished",
    // not as a pending to-do.
    const chip = describeTaskChip({ open: 0, done: 4 });

    expect(chip).toEqual({
      tone: "all-done",
      text: "✓ 4/4",
      ariaLabel: "4 tasks, all completed",
    });
  });

  it("uses singular wording for a single task", () => {
    expect(describeTaskChip({ open: 1, done: 0 })?.ariaLabel).toBe("1 of 1 task open");
    expect(describeTaskChip({ open: 0, done: 1 })?.ariaLabel).toBe("1 task, all completed");
  });

  it("uses plural wording for counts other than 1", () => {
    expect(describeTaskChip({ open: 3, done: 0 })?.ariaLabel).toBe("3 of 3 tasks open");
    expect(describeTaskChip({ open: 0, done: 7 })?.ariaLabel).toBe("7 tasks, all completed");
  });
});
