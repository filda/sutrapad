import { describe, expect, it } from "vitest";
import { buildTaskIndex, toggleTaskInBody } from "../src/lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

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
