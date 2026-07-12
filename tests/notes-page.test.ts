// @vitest-environment happy-dom
//
// Endless-scroll slicing for the Notes panel: a large list renders only the
// initial batch of cards, while the header still reports the full total. The
// growth trigger + limit state are unit-tested in `endless-scroll.test.ts`;
// this pins the page-level wiring (the `.slice(0, limit)` in `buildNotesPanel`).
import { afterEach, describe, expect, it } from "vitest";
import { buildNotesPanel } from "../src/app/view/pages/notes-page";
import { INITIAL_LIMIT, resetListState } from "../src/app/logic/endless-scroll";
import { buildNoteSummary } from "../src/lib/note-card-meta";
import type { SutraPadWorkspace } from "../src/types";

afterEach(() => {
  resetListState();
});

function makeWorkspace(count: number): SutraPadWorkspace {
  const notes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: "",
    body: `note number ${i}`,
    urls: [],
    tags: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: `2020-01-01T00:00:00.${String(i).padStart(3, "0")}Z`,
  }));
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function panelOptions(workspace: SutraPadWorkspace) {
  return {
    workspace,
    noteSummaries: workspace.notes.map((note) => buildNoteSummary(note)),
    currentNoteId: workspace.notes[0]?.id ?? "",
    selectedTagFilters: [] as string[],
    filterMode: "all" as const,
    notesViewMode: "cards" as const,
    onSelectNote: () => undefined,
    onNewNote: () => undefined,
    onChangeNotesView: () => undefined,
  };
}

describe("buildNotesPanel endless scroll", () => {
  it("renders only the initial batch of cards for a large list", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(500)));
    expect(panel.querySelectorAll(".note-list-item")).toHaveLength(INITIAL_LIMIT);
  });

  it("renders every card when the list is smaller than the initial batch", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(12)));
    expect(panel.querySelectorAll(".note-list-item")).toHaveLength(12);
  });

  it("keeps the header count at the full total, not the rendered slice", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(500)));
    expect(panel.textContent).toContain("500 notes");
  });
});
