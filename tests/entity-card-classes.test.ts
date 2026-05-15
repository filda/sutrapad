// @vitest-environment happy-dom
//
// Regression marker for Step 1 of the cards-unification refactor (see
// `docs/conventions.md` → cross-page consistency and the entity-card
// section in `src/styles.css`).
//
// The Notes / Links / Tasks pages share one canonical card surface
// (`.entity-card`) plus a per-kind modifier (`--note` / `--link` /
// `--task`). This file pins the className contract so a mutant that
// drops "entity-card" or the kind suffix from any of the three
// renderers is caught with a single assertion per surface.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNotesList } from "../src/app/view/shared/notes-list";
import { buildLinksPage } from "../src/app/view/pages/links-page";
import { buildTasksPage } from "../src/app/view/pages/tasks-page";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

// Same fetch stub the other DOM tests use — the link-thumb resolver and
// favicon `<img>` tags fire real network requests under happy-dom.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  const now = "2026-04-25T10:00:00.000Z";
  return {
    id: "n1",
    title: "Title",
    body: "Body",
    urls: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeWorkspace(notes: SutraPadDocument[]): SutraPadWorkspace {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

describe("entity-card shared shell — Step 1 classnames", () => {
  it("Notes cards opt into `entity-card entity-card--note` alongside `.note-list-item`", () => {
    const list = buildNotesList(
      "n1",
      [makeNote()],
      () => undefined,
      "cards",
    );
    const card = list.querySelector<HTMLElement>(".note-list-item");
    if (card === null) throw new Error("expected a .note-list-item card");
    expect(card.classList.contains("entity-card")).toBe(true);
    expect(card.classList.contains("entity-card--note")).toBe(true);
  });

  it("Links cards opt into `entity-card entity-card--link` alongside `.link-card`", () => {
    const workspace = makeWorkspace([
      makeNote({ urls: ["https://example.com/path"] }),
    ]);
    const page = buildLinksPage({
      workspace,
      selectedTagFilters: [],
      linksViewMode: "cards",
      onOpenNote: vi.fn(),
      onOpenCapture: vi.fn(),
      onChangeLinksView: vi.fn(),
      onClearTagFilters: vi.fn(),
    });
    const card = page.querySelector<HTMLElement>(".link-card");
    if (card === null) throw new Error("expected a .link-card");
    expect(card.classList.contains("entity-card")).toBe(true);
    expect(card.classList.contains("entity-card--link")).toBe(true);
  });

  it("Tasks cards opt into `entity-card entity-card--task` alongside `.task-card`", () => {
    const workspace = makeWorkspace([
      makeNote({ body: "- [ ] do the thing" }),
    ]);
    const page = buildTasksPage({
      workspace,
      selectedTagFilters: [],
      tasksFilter: "all",
      tasksShowDone: false,
      tasksOneThingKey: null,
      onOpenNote: vi.fn(),
      onToggleTask: vi.fn(),
      onChangeTasksFilter: vi.fn(),
      onToggleTasksShowDone: vi.fn(),
      onSetOneThing: vi.fn(),
      onClearTagFilters: vi.fn(),
    });
    const card = page.querySelector<HTMLElement>(".task-card");
    if (card === null) throw new Error("expected a .task-card");
    expect(card.classList.contains("entity-card")).toBe(true);
    expect(card.classList.contains("entity-card--task")).toBe(true);
  });
});

describe("entity-card shared shell — Step 2 semantics", () => {
  // Pins the title / date semantic-element contracts so a mutant that
  // swaps `<h3>` back to `<strong>` / `<div>` or drops a `dateTime`
  // assignment is caught.

  it("Notes card title is rendered as <h3 class=\"note-list-title\">", () => {
    const list = buildNotesList(
      "n1",
      [makeNote()],
      () => undefined,
      "cards",
    );
    const title = list.querySelector(".note-list-item .note-list-title");
    expect(title).not.toBeNull();
    expect(title?.tagName).toBe("H3");
  });

  it("Notes card date is a <time> element with the note's updatedAt as dateTime", () => {
    const updatedAt = "2026-04-22T12:34:00.000Z";
    const list = buildNotesList(
      "n1",
      [makeNote({ updatedAt })],
      () => undefined,
      "cards",
    );
    const time = list.querySelector<HTMLTimeElement>(".note-list-date");
    expect(time?.tagName).toBe("TIME");
    expect(time?.dateTime).toBe(updatedAt);
  });

  it("Links card title is rendered as <h3 class=\"link-card-title\">", () => {
    const page = buildLinksPage({
      workspace: makeWorkspace([
        makeNote({ urls: ["https://example.com/page"] }),
      ]),
      selectedTagFilters: [],
      linksViewMode: "cards",
      onOpenNote: vi.fn(),
      onOpenCapture: vi.fn(),
      onChangeLinksView: vi.fn(),
      onClearTagFilters: vi.fn(),
    });
    const title = page.querySelector(".link-card .link-card-title");
    expect(title).not.toBeNull();
    expect(title?.tagName).toBe("H3");
  });

  it("Tasks card anchor is a <time> element with the source note's createdAt as dateTime", () => {
    const createdAt = "2026-04-20T08:00:00.000Z";
    const page = buildTasksPage({
      workspace: makeWorkspace([
        makeNote({ body: "- [ ] do it", createdAt }),
      ]),
      selectedTagFilters: [],
      tasksFilter: "all",
      tasksShowDone: false,
      tasksOneThingKey: null,
      onOpenNote: vi.fn(),
      onToggleTask: vi.fn(),
      onChangeTasksFilter: vi.fn(),
      onToggleTasksShowDone: vi.fn(),
      onSetOneThing: vi.fn(),
      onClearTagFilters: vi.fn(),
    });
    const time = page.querySelector<HTMLTimeElement>(".task-card-sub time");
    expect(time?.tagName).toBe("TIME");
    expect(time?.dateTime).toBe(createdAt);
  });
});

describe("entity-card shared shell — Step 4 persona symmetry", () => {
  // Pins the `has-persona` class contract on Notes cards. Pre-Step 4 the
  // class only sat on the list wrapper (`notes-list--persona`); after the
  // migration each card carries `has-persona` directly, matching the
  // Links / Tasks pattern (`.link-card.has-persona` / `.task-card.has-persona`).

  it("Notes card gets `has-persona` when personaOptions is provided", () => {
    const note = makeNote();
    const list = buildNotesList(
      "n1",
      [note],
      () => undefined,
      "cards",
      { allNotes: [note], dark: false },
    );
    const card = list.querySelector<HTMLElement>(".note-list-item");
    expect(card?.classList.contains("has-persona")).toBe(true);
  });

  it("Notes card omits `has-persona` when personaOptions is undefined", () => {
    const list = buildNotesList(
      "n1",
      [makeNote()],
      () => undefined,
      "cards",
    );
    const card = list.querySelector<HTMLElement>(".note-list-item");
    expect(card?.classList.contains("has-persona")).toBe(false);
  });
});
