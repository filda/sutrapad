import { describe, expect, it } from "vitest";
import {
  applyTaskFilter,
  computeDaysOld,
  computeTaskCounts,
  detectWaitingFor,
  enrichTasks,
  findEnrichedTaskByKey,
  formatRelativeDays,
  groupEnrichedTasksByNote,
  pickStalestOpenTask,
  taskKey,
  WAITING_PERSON_REGEX,
  type EnrichedTask,
} from "../src/app/logic/tasks-filter";
import type {
  SutraPadDocument,
  SutraPadTaskEntry,
  SutraPadWorkspace,
} from "../src/types";

const NOW = new Date("2026-04-23T12:00:00Z");

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function note(
  id: string,
  daysOld: number,
  overrides: Partial<SutraPadDocument> = {},
): SutraPadDocument {
  return {
    id,
    title: `Note ${id}`,
    body: "",
    urls: [],
    tags: [],
    createdAt: iso(daysOld),
    updatedAt: iso(daysOld),
    ...overrides,
  };
}

function task(
  noteId: string,
  lineIndex: number,
  text: string,
  done = false,
): SutraPadTaskEntry {
  return { noteId, lineIndex, text, done, noteUpdatedAt: iso(0) };
}

function workspace(notes: SutraPadDocument[]): SutraPadWorkspace {
  return { notes, activeNoteId: null };
}

describe("detectWaitingFor", () => {
  it("matches the handoff's regex constant", () => {
    // Guard against accidental regex drift: the detectWaitingFor contract is
    // "the exact regex the handoff uses", not "some test cases".
    expect(WAITING_PERSON_REGEX.source).toBe(
      "\\b(?:call|ask|email|text|write to)\\s+\\w|@\\w",
    );
  });

  it.each([
    ["call Mia about the proofs", true],
    ["ask  Lu for the key", true],
    ["email the landlord", true],
    ["text Dad a photo", true],
    ["write to the planner", true],
    ["Ping @lu about design review", true],
    ["Finish the tax forms", false],
    ["ship it", false],
    ["call", false], // no following word
    ["email@example.com", true], // @w is loose on purpose — regex parity with handoff
  ])("%s → %s", (text, expected) => {
    expect(detectWaitingFor(text)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(detectWaitingFor("CALL Mia")).toBe(true);
    expect(detectWaitingFor("Ask Someone")).toBe(true);
  });
});

describe("computeDaysOld", () => {
  it("returns 0 for a missing date", () => {
    expect(computeDaysOld(NOW, undefined)).toBe(0);
  });

  it("returns 0 for an unparseable date", () => {
    expect(computeDaysOld(NOW, "not a date")).toBe(0);
  });

  it("clamps future dates to 0 so tomorrow is not 'negative' days old", () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(computeDaysOld(NOW, tomorrow)).toBe(0);
  });

  it("floors to whole days", () => {
    expect(computeDaysOld(NOW, iso(0))).toBe(0);
    expect(computeDaysOld(NOW, iso(1))).toBe(1);
    expect(computeDaysOld(NOW, iso(2))).toBe(2);
    expect(computeDaysOld(NOW, iso(7))).toBe(7);
  });

  it("treats a same-instant timestamp as 0 days old", () => {
    expect(computeDaysOld(NOW, NOW.toISOString())).toBe(0);
  });
});

describe("enrichTasks", () => {
  it("joins tasks with their source note, computes daysOld + hasPerson", () => {
    const notes = [note("n1", 4), note("n2", 0)];
    const tasks = [
      task("n1", 0, "call Mia"),
      task("n2", 0, "Write tests"),
    ];
    const enriched = enrichTasks(tasks, workspace(notes), NOW);

    expect(enriched).toHaveLength(2);
    expect(enriched[0]).toMatchObject({
      note: notes[0],
      daysOld: 4,
      hasPerson: true,
    });
    expect(enriched[1]).toMatchObject({
      note: notes[1],
      daysOld: 0,
      hasPerson: false,
    });
  });

  it("drops tasks whose note is missing from the workspace", () => {
    // Shouldn't happen in practice (task index is derived from notes) but an
    // orphan task must not crash the page — it's just silently skipped.
    const enriched = enrichTasks(
      [task("ghost", 0, "untethered")],
      workspace([]),
      NOW,
    );
    expect(enriched).toEqual([]);
  });
});

describe("computeTaskCounts", () => {
  const notes = [
    note("recent-open", 1),
    note("stale-open", 5),
    note("stale-done", 6),
    note("recent-done", 0),
    note("waiting-open", 2),
  ];
  const tasks = [
    task("recent-open", 0, "write intro"),
    task("stale-open", 0, "finish draft"),
    task("stale-done", 0, "send invite", true),
    task("recent-done", 0, "order coffee", true),
    task("waiting-open", 0, "call Mia"),
  ];
  const enriched = enrichTasks(tasks, workspace(notes), NOW);

  it("all-count reflects the current show-done stance", () => {
    expect(computeTaskCounts(enriched, false).all).toBe(3);
    expect(computeTaskCounts(enriched, true).all).toBe(5);
  });

  it("recent-count includes done items when show-done is on", () => {
    // recent = daysOld ≤ 2 → recent-open (1), recent-done (0), waiting-open (2)
    // With showDone=false, recent-done disappears.
    expect(computeTaskCounts(enriched, false).recent).toBe(2);
    expect(computeTaskCounts(enriched, true).recent).toBe(3);
  });

  it("stale- and waiting-counts ignore the show-done stance", () => {
    expect(computeTaskCounts(enriched, false).stale).toBe(1);
    expect(computeTaskCounts(enriched, true).stale).toBe(1);
    expect(computeTaskCounts(enriched, false).waiting).toBe(1);
    expect(computeTaskCounts(enriched, true).waiting).toBe(1);
  });
});

describe("applyTaskFilter", () => {
  const notes = [note("a", 1), note("b", 5), note("c", 2)];
  const tasks = [
    task("a", 0, "write intro"),
    task("a", 1, "done thing", true),
    task("b", 0, "stale draft"),
    task("c", 0, "call Mia"),
  ];
  const enriched = enrichTasks(tasks, workspace(notes), NOW);

  it("hides done by default on 'all'", () => {
    const result = applyTaskFilter(enriched, "all", false);
    expect(result).toHaveLength(3);
    expect(result.every((entry) => !entry.task.done)).toBe(true);
  });

  it("shows done on 'all' when showDone is on", () => {
    expect(applyTaskFilter(enriched, "all", true)).toHaveLength(4);
  });

  it("'recent' keeps daysOld ≤ 2", () => {
    const result = applyTaskFilter(enriched, "recent", true);
    expect(result.map((entry) => entry.note.id)).toEqual(["a", "a", "c"]);
  });

  it("'stale' hard-excludes done items regardless of the toggle", () => {
    const result = applyTaskFilter(enriched, "stale", true);
    expect(result).toHaveLength(1);
    expect(result[0]?.note.id).toBe("b");
  });

  it("'waiting' surfaces person-mentioning open tasks", () => {
    const result = applyTaskFilter(enriched, "waiting", false);
    expect(result).toHaveLength(1);
    expect(result[0]?.task.text).toBe("call Mia");
  });
});

describe("pickStalestOpenTask", () => {
  it("returns null when there are no open tasks", () => {
    expect(pickStalestOpenTask([])).toBeNull();
    const allDone = enrichTasks(
      [task("n", 0, "done", true)],
      workspace([note("n", 0)]),
      NOW,
    );
    expect(pickStalestOpenTask(allDone)).toBeNull();
  });

  it("prefers the oldest stale task", () => {
    const notes = [note("a", 3), note("b", 10), note("c", 4)];
    const enriched = enrichTasks(
      [
        task("a", 0, "a"),
        task("b", 0, "b"),
        task("c", 0, "c"),
      ],
      workspace(notes),
      NOW,
    );
    expect(pickStalestOpenTask(enriched)?.note.id).toBe("b");
  });

  it("falls back to the first open task when nothing is stale", () => {
    const notes = [note("a", 0), note("b", 1)];
    const enriched = enrichTasks(
      [task("a", 0, "fresh"), task("b", 0, "newish")],
      workspace(notes),
      NOW,
    );
    // Input order is preserved in enrichTasks — so the first open task wins.
    expect(pickStalestOpenTask(enriched)?.note.id).toBe("a");
  });
});

describe("formatRelativeDays", () => {
  it.each([
    [0, "today"],
    [1, "yesterday"],
    [2, "2 days ago"],
    [6, "6 days ago"],
    [7, "a week ago"],
    [13, "a week ago"],
    [14, "2 weeks ago"],
    [29, "4 weeks ago"],
    [30, "1 months ago"],
    [90, "3 months ago"],
  ])("formats %i days as %s", (days, expected) => {
    expect(formatRelativeDays(days)).toBe(expected);
  });
});

describe("taskKey + findEnrichedTaskByKey", () => {
  it("makes a stable noteId::lineIndex identity", () => {
    expect(taskKey({ noteId: "a", lineIndex: 3 } as SutraPadTaskEntry)).toBe(
      "a::3",
    );
  });

  it("returns null when the key is null", () => {
    expect(findEnrichedTaskByKey([], null)).toBeNull();
  });

  it("returns null when the key no longer resolves (line index shifted)", () => {
    const enriched = [
      { task: { noteId: "a", lineIndex: 0 } } as EnrichedTask,
    ];
    expect(findEnrichedTaskByKey(enriched, "a::7")).toBeNull();
  });

  it("finds the matching enriched task", () => {
    const match = { task: { noteId: "a", lineIndex: 5 } } as EnrichedTask;
    expect(findEnrichedTaskByKey([match], "a::5")).toBe(match);
  });
});

describe("groupEnrichedTasksByNote", () => {
  it("preserves source order across notes and authoring order within a note", () => {
    const notes = [note("x", 1), note("y", 2)];
    const enriched = enrichTasks(
      [
        task("y", 2, "second y"),
        task("x", 0, "first x"),
        task("y", 0, "first y"),
        task("x", 1, "second x"),
      ],
      workspace(notes),
      NOW,
    );
    const groups = groupEnrichedTasksByNote(enriched);
    expect(groups.map((group) => group.note.id)).toEqual(["y", "x"]);
    expect(groups[0]?.tasks.map((entry) => entry.task.lineIndex)).toEqual([
      0, 2,
    ]);
    expect(groups[1]?.tasks.map((entry) => entry.task.lineIndex)).toEqual([
      0, 1,
    ]);
  });

  it("computes openCount / totalCount / hasStaleOpen per group", () => {
    const notes = [note("fresh", 1), note("old", 7)];
    const enriched = enrichTasks(
      [
        task("fresh", 0, "a"),
        task("fresh", 1, "b", true),
        task("old", 0, "c"),
        task("old", 1, "d", true),
      ],
      workspace(notes),
      NOW,
    );
    const groups = groupEnrichedTasksByNote(enriched);

    const fresh = groups.find((g) => g.note.id === "fresh");
    expect(fresh).toMatchObject({
      openCount: 1,
      totalCount: 2,
      hasStaleOpen: false,
    });

    const old = groups.find((g) => g.note.id === "old");
    expect(old).toMatchObject({
      openCount: 1,
      totalCount: 2,
      hasStaleOpen: true,
    });
  });

  it("returns an empty array when there are no enriched tasks", () => {
    expect(groupEnrichedTasksByNote([])).toEqual([]);
  });
});
