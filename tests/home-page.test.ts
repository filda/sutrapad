// @vitest-environment happy-dom
//
// Home page stats + timeline, read from the resident summary/task/link
// models (Phase 2 notes-scaling) rather than `workspace.notes` bodies. Pins
// two regressions a naive body-scan would reintroduce for a placeholder
// note: open-task counts must come from `taskIndex`, and the timeline
// excerpt must come from the precomputed `summary.excerpt`, not the (empty)
// body.
import { describe, expect, it } from "vitest";
import { buildHomePage } from "../src/app/view/pages/home-page";
import type {
  SutraPadLinkIndex,
  SutraPadNoteSummary,
  SutraPadTaskIndex,
} from "../src/types";

const NOW = new Date();

function summary(overrides: Partial<SutraPadNoteSummary> = {}): SutraPadNoteSummary {
  return {
    id: "n1",
    title: "Untitled",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    tags: [],
    ...overrides,
  };
}

function emptyTaskIndex(): SutraPadTaskIndex {
  return { version: 1, savedAt: NOW.toISOString(), tasks: [] };
}

function emptyLinkIndex(): SutraPadLinkIndex {
  return { version: 1, savedAt: NOW.toISOString(), links: [] };
}

describe("buildHomePage", () => {
  it("counts open tasks from taskIndex, not from note bodies", () => {
    // The note itself has no body-derivable task info (it's a Phase 2
    // placeholder — body is ""), but taskIndex still carries one open task
    // for it. A body-scan would report 0; the index must report 1.
    const noteSummaries = [summary({ id: "n1" })];
    const taskIndex: SutraPadTaskIndex = {
      version: 1,
      savedAt: NOW.toISOString(),
      tasks: [
        { noteId: "n1", lineIndex: 0, text: "call back", done: false, noteUpdatedAt: NOW.toISOString() },
        { noteId: "n1", lineIndex: 1, text: "done already", done: true, noteUpdatedAt: NOW.toISOString() },
      ],
    };

    const page = buildHomePage({
      noteSummaries,
      taskIndex,
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    const openTasksStat = page.querySelector(".stat.is-accent .stat-value");
    expect(openTasksStat?.textContent).toBe("1");
  });

  it("counts distinct tags from both user tags and autoTags across summaries", () => {
    const noteSummaries = [
      summary({ id: "n1", tags: ["work"], autoTags: ["date:today"] }),
      summary({ id: "n2", tags: ["work", "personal"] }),
    ];

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    const stats = [...page.querySelectorAll(".stat")];
    const tagsStat = stats.find((s) => s.textContent?.includes("Tags"));
    expect(tagsStat?.querySelector(".stat-value")?.textContent).toBe("3");
  });

  it("reports the notes count and link count from the resident models", () => {
    const noteSummaries = [summary({ id: "n1" }), summary({ id: "n2" })];
    const linkIndex: SutraPadLinkIndex = {
      version: 1,
      savedAt: NOW.toISOString(),
      links: [{ url: "https://example.com", noteIds: ["n1"], count: 1, latestUpdatedAt: NOW.toISOString() }],
    };

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex,
      profile: null,
      onOpenNote: () => undefined,
    });

    const stats = [...page.querySelectorAll(".stat")];
    const notesStat = stats.find((s) => s.textContent?.includes("Notes"));
    const linksStat = stats.find((s) => s.textContent?.includes("Links"));
    expect(notesStat?.querySelector(".stat-value")?.textContent).toBe("2");
    expect(linksStat?.querySelector(".stat-value")?.textContent).toBe("1");
  });

  it("renders a timeline card using the summary's title, precomputed excerpt, and tags", () => {
    const noteSummaries = [
      summary({
        id: "n1",
        title: "Grocery list",
        excerpt: "milk, eggs, bread",
        tags: ["errands"],
        updatedAt: NOW.toISOString(),
      }),
    ];

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    expect(page.querySelector(".tl-title")?.textContent).toBe("Grocery list");
    expect(page.querySelector(".tl-excerpt")?.textContent).toBe("milk, eggs, bread");
    expect(page.textContent).toContain("errands");
  });

  it("falls back to no excerpt paragraph when the summary has none (unhydrated placeholder)", () => {
    const noteSummaries = [summary({ id: "n1", title: "Placeholder", excerpt: undefined })];

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    expect(page.querySelector(".tl-excerpt")).toBeNull();
  });

  it("invokes onOpenNote with the summary id when a timeline card is clicked", () => {
    const noteSummaries = [summary({ id: "n42", title: "Click me" })];
    let opened: string | null = null;

    const page = buildHomePage({
      noteSummaries,
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: (id) => {
        opened = id;
      },
    });

    (page.querySelector(".tl-card") as HTMLButtonElement).click();
    expect(opened).toBe("n42");
  });

  it("renders no timeline when there are no notes", () => {
    const page = buildHomePage({
      noteSummaries: [],
      taskIndex: emptyTaskIndex(),
      linkIndex: emptyLinkIndex(),
      profile: null,
      onOpenNote: () => undefined,
    });

    expect(page.querySelector(".timeline")).toBeNull();
  });
});
