// @vitest-environment happy-dom
//
// DOM tests for the Tasks page tag-filter integration. The page's chip /
// show-done / one-thing logic is already covered by `tasks-filter.test.ts`
// (pure-logic unit tests). This suite focuses on the new tag-filter
// pathway:
//
//   - the unfiltered page renders a card per source note
//   - a single active tag narrows the cards to tasks from notes carrying
//     that tag (AND semantics)
//   - the eyebrow surfaces "filtered N of M" counts + tag count
//   - a filter that kills every task renders the dashed "no tasks under
//     this tag filter" empty state with a "Clear tag filter" CTA
//   - the first-run empty scene still wins when the workspace has no
//     tasks at all (regardless of an active filter)

import { describe, expect, it, vi } from "vitest";
import { buildTasksPage } from "../src/app/view/pages/tasks-page";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "n",
    title: "note",
    body: "",
    tags: [],
    urls: [],
    createdAt: "2026-04-21T09:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

function makeWorkspace(notes: SutraPadDocument[]): SutraPadWorkspace {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function buildPage(
  workspace: SutraPadWorkspace,
  selectedTagFilters: readonly string[] = [],
  overrides: Partial<Parameters<typeof buildTasksPage>[0]> = {},
): HTMLElement {
  return buildTasksPage({
    workspace,
    selectedTagFilters,
    tasksFilter: "all",
    tasksShowDone: false,
    tasksOneThingKey: null,
    onOpenNote: vi.fn(),
    onToggleTask: vi.fn(),
    onChangeTasksFilter: vi.fn(),
    onToggleTasksShowDone: vi.fn(),
    onSetOneThing: vi.fn(),
    onClearTagFilters: vi.fn(),
    ...overrides,
  });
}

describe("buildTasksPage tag filter", () => {
  it("renders a card per source note when no filter is active", () => {
    const work = makeNote({
      id: "w",
      title: "Work",
      tags: ["work"],
      body: "- [ ] Email Mia",
    });
    const home = makeNote({
      id: "h",
      title: "Home",
      tags: ["home"],
      body: "- [ ] Buy milk",
    });
    const page = buildPage(makeWorkspace([work, home]));

    const cards = page.querySelectorAll(".task-card");
    expect(cards).toHaveLength(2);
  });

  it("narrows the cards to tasks from notes carrying every selected tag", () => {
    const work = makeNote({
      id: "w",
      title: "Work",
      tags: ["work"],
      body: "- [ ] Email Mia",
    });
    const home = makeNote({
      id: "h",
      title: "Home",
      tags: ["home"],
      body: "- [ ] Buy milk",
    });
    const page = buildPage(makeWorkspace([work, home]), ["work"]);

    const headings = [...page.querySelectorAll(".task-card h3")].map(
      (n) => n.textContent,
    );
    expect(headings).toEqual(["Work"]);
  });

  it("uses AND semantics across multiple selected tags", () => {
    const both = makeNote({
      id: "both",
      title: "Both",
      tags: ["work", "urgent"],
      body: "- [ ] Send PR",
    });
    const partial = makeNote({
      id: "partial",
      title: "Partial",
      tags: ["work"],
      body: "- [ ] Send PR",
    });
    const page = buildPage(makeWorkspace([both, partial]), ["work", "urgent"]);

    const headings = [...page.querySelectorAll(".task-card h3")].map(
      (n) => n.textContent,
    );
    expect(headings).toEqual(["Both"]);
  });

  it("surfaces the filtered-N-of-M counts and tag count in the eyebrow", () => {
    const work = makeNote({
      id: "w",
      tags: ["work"],
      body: "- [ ] One\n- [ ] Two",
    });
    const home = makeNote({
      id: "h",
      tags: ["home"],
      body: "- [ ] Three",
    });
    const page = buildPage(makeWorkspace([work, home]), ["work"]);

    const eyebrow = page.querySelector(".page-eyebrow")?.textContent ?? "";
    expect(eyebrow).toContain("2 of 3 open");
    expect(eyebrow).toContain("filtered by 1 tag");
  });

  it("renders the dashed tag-filter miss with a Clear tag filter CTA when nothing matches", () => {
    const work = makeNote({
      id: "w",
      tags: ["work"],
      body: "- [ ] Email Mia",
    });
    const onClearTagFilters = vi.fn();
    const page = buildPage(makeWorkspace([work]), ["nonexistent"], {
      onClearTagFilters,
    });

    const miss = page.querySelector(".empty-state");
    expect(miss).not.toBeNull();
    expect(miss?.querySelector("h3")?.textContent).toBe(
      "No tasks under this tag filter.",
    );

    const clear = miss?.querySelector<HTMLButtonElement>(".button-accent");
    expect(clear?.textContent).toBe("Clear tag filter");
    clear?.click();
    expect(onClearTagFilters).toHaveBeenCalledTimes(1);
  });

  it("still wins with the first-run empty scene when the workspace has no tasks at all", () => {
    const noTasks = makeNote({ id: "n", body: "Nothing actionable here" });
    const page = buildPage(makeWorkspace([noTasks]), ["whatever"]);

    // Full-bleed first-run scene wins over the tag-filter miss when the
    // workspace has zero tasks across all notes — there's nothing to
    // recover by clearing the filter, and the first-run copy explains
    // how to create a task in the first place.
    expect(page.querySelector(".empty-scene")).not.toBeNull();
    expect(page.querySelector(".empty-state")).toBeNull();
  });
});
