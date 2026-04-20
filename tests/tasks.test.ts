import { describe, expect, it } from "vitest";
import {
  buildTaskIndex,
  compareTaskEntries,
  countTasksInNote,
  toggleTaskInBody,
} from "../src/lib/notebook";
import type { SutraPadDocument, SutraPadTaskEntry, SutraPadWorkspace } from "../src/types";

function makeNote(
  overrides: Partial<SutraPadDocument> & Pick<SutraPadDocument, "id" | "updatedAt" | "body">,
): SutraPadDocument {
  return {
    title: "Test note",
    createdAt: overrides.createdAt ?? overrides.updatedAt,
    urls: overrides.urls ?? [],
    tags: overrides.tags ?? [],
    ...overrides,
  };
}

function makeWorkspace(notes: SutraPadDocument[]): SutraPadWorkspace {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function makeTaskEntry(overrides: Partial<SutraPadTaskEntry> = {}): SutraPadTaskEntry {
  return {
    noteId: "note",
    lineIndex: 0,
    text: "task",
    done: false,
    noteUpdatedAt: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildTaskIndex", () => {
  it("parses the three bracket variants the user asked for", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: ["[ ] space variant", "[] empty variant", "[x] done variant"].join("\n"),
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]), "2026-04-20T10:00:00.000Z");

    // Open tasks come before done ones regardless of their order in the body.
    expect(tasks.map((task) => task.text)).toEqual([
      "space variant",
      "empty variant",
      "done variant",
    ]);
    expect(tasks.map((task) => task.done)).toEqual([false, false, true]);
    // Line index is preserved so the toggler can rewrite the right line later.
    const byText = Object.fromEntries(tasks.map((task) => [task.text, task.lineIndex]));
    expect(byText["space variant"]).toBe(0);
    expect(byText["empty variant"]).toBe(1);
    expect(byText["done variant"]).toBe(2);
  });

  it("treats uppercase [X] as done (case-insensitive)", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "[X] shout done",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].done).toBe(true);
  });

  it("accepts the GFM `- [ ]` bullet form", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: ["- [ ] bulleted open", "- [x] bulleted done"].join("\n"),
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks.map((task) => task.text)).toEqual(["bulleted open", "bulleted done"]);
  });

  it("accepts multiple spaces between the `-` bullet and the bracket", () => {
    // The GFM grammar only requires *some* whitespace after the bullet, and
    // editors will sometimes insert more than one. Regressing to a single
    // mandatory space would silently drop these tasks, so pin the behavior.
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "-  [ ] spaced bullet",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("spaced bullet");
  });

  it("accepts the compact `[ ]text` form with no space after the bracket", () => {
    // The separator between bracket and label is optional; compact variants
    // like `[x]done` and `[ ]open` should still be parsed as tasks.
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: ["[ ]no space", "[x]done compact"].join("\n"),
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks.map((task) => ({ text: task.text, done: task.done }))).toEqual([
      { text: "no space", done: false },
      { text: "done compact", done: true },
    ]);
  });

  it("strips trailing whitespace from the task label but preserves leading characters", () => {
    // Users drag trailing spaces all the time (esp. on mobile). We want the
    // label trimmed on the right so chips/listings read cleanly, but leading
    // characters of the label itself (after the required separator space) are
    // part of the user's text and must be preserved verbatim.
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "[ ] trim me   ",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("trim me");
  });

  it("allows leading whitespace before the bracket (nested/indented tasks)", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "    [ ] indented task",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toBe("indented task");
  });

  it("ignores checkboxes that are not at the start of a line (prevents false positives in prose)", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "mid-line [ ] should be ignored",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks).toEqual([]);
  });

  it("skips empty-checkbox lines that have no task text", () => {
    // Lone `[ ]` lines are almost always typos and would clutter the Tasks page.
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: ["[ ]", "[ ]   ", "[ ] real task"].join("\n"),
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks.map((task) => task.text)).toEqual(["real task"]);
  });

  it("sorts open tasks before completed ones, then by note recency, then by line", () => {
    const older = makeNote({
      id: "older",
      updatedAt: "2026-04-18T10:00:00.000Z",
      body: ["[ ] old open A", "[x] old done", "[ ] old open B"].join("\n"),
    });
    const newer = makeNote({
      id: "newer",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "[ ] new open",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([older, newer]));

    expect(
      tasks.map((task) => ({ note: task.noteId, text: task.text, done: task.done })),
    ).toEqual([
      { note: "newer", text: "new open", done: false },
      { note: "older", text: "old open A", done: false },
      { note: "older", text: "old open B", done: false },
      { note: "older", text: "old done", done: true },
    ]);
  });

  it("tie-breaks tasks from different notes with the same updatedAt by noteId", () => {
    // When two notes were edited at exactly the same second (common after an
    // import or a merge sync) neither wins on recency; we fall back to a
    // deterministic alphabetical ordering on noteId so the Tasks page doesn't
    // flicker between renders. Feed the notes in reverse alphabetical order so
    // the test would break if recency were the only signal.
    const noteB = makeNote({
      id: "b-note",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "[ ] from b",
    });
    const noteA = makeNote({
      id: "a-note",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "[ ] from a",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([noteB, noteA]));

    expect(tasks.map((task) => task.noteId)).toEqual(["a-note", "b-note"]);
  });

  it("stamps noteUpdatedAt so the Tasks page can show last-touched hints", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "[ ] when did I add this",
    });

    const { tasks } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks[0].noteUpdatedAt).toBe("2026-04-20T10:00:00.000Z");
  });

  it("returns an empty index when the workspace has no tasks", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "just some plain text\nwithout checkboxes",
    });

    const { tasks, version } = buildTaskIndex(makeWorkspace([note]));

    expect(tasks).toEqual([]);
    expect(version).toBe(1);
  });
});

describe("countTasksInNote", () => {
  it("counts open and completed tasks separately", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: ["[ ] open one", "[x] done one", "- [ ] open two", "[X] done two"].join("\n"),
    });

    expect(countTasksInNote(note)).toEqual({ open: 2, done: 2 });
  });

  it("returns zeros for a note without checkboxes", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: "prose only\nno checkboxes here",
    });

    expect(countTasksInNote(note)).toEqual({ open: 0, done: 0 });
  });

  it("ignores empty-checkbox lines the same way the index does", () => {
    const note = makeNote({
      id: "n1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      body: ["[ ]", "[ ]   ", "[ ] real task"].join("\n"),
    });

    expect(countTasksInNote(note)).toEqual({ open: 1, done: 0 });
  });
});

describe("toggleTaskInBody", () => {
  it("checks an open task by rewriting `[ ]` to `[x]` on the given line", () => {
    const body = ["[ ] first", "[ ] second"].join("\n");
    expect(toggleTaskInBody(body, 0)).toBe(["[x] first", "[ ] second"].join("\n"));
  });

  it("checks `[]` (no-space) the same way", () => {
    const body = "[] terse";
    expect(toggleTaskInBody(body, 0)).toBe("[x] terse");
  });

  it("unchecks a done task to `[ ]`", () => {
    expect(toggleTaskInBody("[x] done", 0)).toBe("[ ] done");
  });

  it("unchecks an uppercase `[X]` task (case-insensitive done detection)", () => {
    // The parser treats `[X]` as done, so the toggler must too — otherwise a
    // click on an uppercase task would double-mark it instead of unchecking.
    expect(toggleTaskInBody("[X] shout done", 0)).toBe("[ ] shout done");
  });

  it("preserves the bullet prefix when toggling GFM-style tasks", () => {
    expect(toggleTaskInBody("- [ ] bullet", 0)).toBe("- [x] bullet");
    expect(toggleTaskInBody("- [x] bullet", 0)).toBe("- [ ] bullet");
  });

  it("preserves leading whitespace on indented tasks", () => {
    expect(toggleTaskInBody("    [ ] nested", 0)).toBe("    [x] nested");
  });

  it("leaves the body unchanged when the targeted line is not a task (stale index)", () => {
    const body = ["not a task", "[ ] real task"].join("\n");
    expect(toggleTaskInBody(body, 0)).toBe(body);
  });

  it("leaves the body unchanged when the line index is out of range", () => {
    expect(toggleTaskInBody("[ ] only line", 42)).toBe("[ ] only line");
    expect(toggleTaskInBody("[ ] only line", -1)).toBe("[ ] only line");
  });

  it("does not touch other lines when toggling a single task", () => {
    const body = [
      "# Heading",
      "[ ] first",
      "some prose",
      "[x] second",
      "- [ ] third",
    ].join("\n");
    expect(toggleTaskInBody(body, 3)).toBe(
      ["# Heading", "[ ] first", "some prose", "[ ] second", "- [ ] third"].join("\n"),
    );
  });
});

describe("compareTaskEntries", () => {
  // The comparator is called directly (rather than through `buildTaskIndex`)
  // so these tests can set up pairs the parser would never emit — e.g. two
  // tasks with the same `lineIndex` from different notes, or a left-hand task
  // whose `lineIndex` is greater than the right-hand one within the same
  // note. That lets every tie-breaking branch be exercised in isolation.

  it("places an open task before a completed one regardless of other fields", () => {
    const open = makeTaskEntry({ noteId: "z", done: false, lineIndex: 99 });
    const done = makeTaskEntry({ noteId: "a", done: true, lineIndex: 0 });
    expect(Math.sign(compareTaskEntries(open, done))).toBe(-1);
    expect(Math.sign(compareTaskEntries(done, open))).toBe(1);
  });

  it("orders more recently edited notes first when done-state matches", () => {
    const recent = makeTaskEntry({ noteUpdatedAt: "2026-04-20T10:00:00.000Z" });
    const stale = makeTaskEntry({ noteUpdatedAt: "2026-04-10T10:00:00.000Z" });
    expect(Math.sign(compareTaskEntries(recent, stale))).toBe(-1);
    expect(Math.sign(compareTaskEntries(stale, recent))).toBe(1);
  });

  it("tie-breaks equal-done, equal-updatedAt tasks by noteId alphabetically", () => {
    // No integration path produces this: `parseTasksFromNote` only emits
    // tasks that share a noteId per invocation, so the noteId branch is
    // only observable when comparing tasks from different notes with equal
    // timestamps. Feed the left side as the lexicographically-later noteId
    // so a buggy `===` branch (or a removed noteId compare) would flip sign.
    const left = makeTaskEntry({ noteId: "b-note" });
    const right = makeTaskEntry({ noteId: "a-note" });
    expect(Math.sign(compareTaskEntries(left, right))).toBe(1);
    expect(Math.sign(compareTaskEntries(right, left))).toBe(-1);
  });

  it("returns 0 for tasks that only differ in text (fully equal on sort keys)", () => {
    // Locks in that `text` does not leak into sort order and that equal
    // tasks on every sort key genuinely compare as equal. Catches mutants
    // that replace a conditional with an unconditional return or a `0`
    // result with a sign.
    const left = makeTaskEntry({ text: "one" });
    const right = makeTaskEntry({ text: "two" });
    expect(compareTaskEntries(left, right)).toBe(0);
  });

  it("tie-breaks within the same note by ascending lineIndex", () => {
    // Same note, same updatedAt, same noteId → falls through to the
    // lineIndex subtraction. Using a non-trivial gap (and the exact delta)
    // pins down both the direction of subtraction and the fact that the
    // operands are not swapped.
    const first = makeTaskEntry({ lineIndex: 2 });
    const later = makeTaskEntry({ lineIndex: 7 });
    expect(compareTaskEntries(first, later)).toBe(-5);
    expect(compareTaskEntries(later, first)).toBe(5);
  });
});
