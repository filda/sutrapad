// @vitest-environment happy-dom
//
// Endless-scroll slicing for the Notes panel: a large list renders only the
// initial batch of cards, while the header still reports the full total. The
// growth trigger + limit state are unit-tested in `endless-scroll.test.ts`;
// this pins the page-level wiring (the `.slice(0, limit)` in `buildNotesPanel`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNotesPanel } from "../src/app/view/pages/notes-page";
import {
  GROW_BATCH,
  INITIAL_LIMIT,
  currentLimit,
  growVisible,
  resetListState,
} from "../src/app/logic/endless-scroll";
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

describe("buildNotesPanel shell + header copy", () => {
  it("renders an <aside class='notes-panel'>", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(3)));
    expect(panel.tagName).toBe("ASIDE");
    expect(panel.className).toBe("notes-panel");
  });

  it("reads `Notebook · 1 note` in the singular for a one-note workspace", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(1)));
    expect(panel.querySelector(".page-eyebrow")?.textContent).toBe("Notebook · 1 note");
  });

  it("pluralizes the unfiltered count", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(4)));
    expect(panel.querySelector(".page-eyebrow")?.textContent).toBe("Notebook · 4 notes");
  });

  it("switches to `N of M` plus a singular tag suffix when one filter is active", () => {
    // Filtered counts answer a different question than the total, so the
    // eyebrow swaps form entirely rather than appending.
    const workspace = makeWorkspace(4);
    workspace.notes[0].tags = ["work"];
    const panel = buildNotesPanel({
      ...panelOptions(workspace),
      selectedTagFilters: ["work"],
    });
    expect(panel.querySelector(".page-eyebrow")?.textContent).toBe(
      "Notebook · 1 of 4 · filtered by 1 tag",
    );
  });

  it("pluralizes the tag suffix for two filters", () => {
    const workspace = makeWorkspace(4);
    workspace.notes[0].tags = ["work", "urgent"];
    const panel = buildNotesPanel({
      ...panelOptions(workspace),
      selectedTagFilters: ["work", "urgent"],
    });
    expect(panel.querySelector(".page-eyebrow")?.textContent).toBe(
      "Notebook · 1 of 4 · filtered by 2 tags",
    );
  });

  it("keeps the title and subtitle copy", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(2)));
    expect(panel.querySelector(".page-title")?.textContent).toBe("Your notebook.");
    expect(panel.querySelector(".page-title em")?.textContent).toBe("notebook");
    expect(panel.querySelector(".page-subtitle")?.textContent).toBe(
      "Every note is a page. Pick one up — it opens full-width so you have room to read, edit and see its context.",
    );
  });
  it("persists the page-intro state under the `notes` pageId", () => {
    // `buildPageHeader` records the visit through `recordVisit(loadIntroStore(),
    // pageId)` and persists immediately, so the literal shows up as a key in
    // the serialised store — an empty pageId would silently share one intro
    // state across every page.
    window.localStorage.removeItem("sp.intros.v1");
    buildNotesPanel(panelOptions(makeWorkspace(2)));
    expect(window.localStorage.getItem("sp.intros.v1") ?? "").toContain('"notes"');
  });
});

describe("buildNotesPanel toolbar hint", () => {
  it("points at the tag bar with a `/` kbd chip when nothing is filtered", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(3)));
    const toolbar = panel.querySelector(".notes-toolbar");
    expect(toolbar).not.toBeNull();

    const hint = toolbar?.querySelector(".notes-toolbar-hint");
    expect(hint?.className).toBe("notes-toolbar-hint muted");
    expect(hint?.textContent).toBe(
      "Filter by tag from the bar above, or type / to focus it.",
    );
    // The shortcut is a real <kbd> so it renders as a key chip, not a slash
    // floating in prose.
    const kbd = hint?.querySelector("kbd");
    expect(kbd?.className).toBe("mono");
    expect(kbd?.textContent).toBe("/");
  });

  it("explains the `any` filter mode once a filter is active", () => {
    const workspace = makeWorkspace(3);
    workspace.notes[0].tags = ["work"];
    const panel = buildNotesPanel({
      ...panelOptions(workspace),
      selectedTagFilters: ["work"],
      filterMode: "any",
    });
    const hint = panel.querySelector(".notes-toolbar-hint");
    expect(hint?.textContent).toBe("Showing notes that match any selected tag.");
    expect(hint?.querySelector("kbd")).toBeNull();
  });

  it("explains the `all` filter mode with the other phrasing", () => {
    const workspace = makeWorkspace(3);
    workspace.notes[0].tags = ["work"];
    const panel = buildNotesPanel({
      ...panelOptions(workspace),
      selectedTagFilters: ["work"],
      filterMode: "all",
    });
    expect(panel.querySelector(".notes-toolbar-hint")?.textContent).toBe(
      "Showing notes that match every selected tag.",
    );
  });
});

function toggleButtons(panel: HTMLElement): HTMLButtonElement[] {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>(".view-toggle-button"));
}

describe("buildNotesPanel view toggle", () => {
  it("renders a labelled group of Cards + List, in that order", () => {
    const panel = buildNotesPanel(panelOptions(makeWorkspace(3)));
    const group = panel.querySelector(".view-toggle");
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.getAttribute("aria-label")).toBe("Notebook view");

    const buttons = toggleButtons(panel);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Cards", "List"]);
    expect(buttons.map((b) => b.title)).toEqual(["Cards", "List"]);
    expect(buttons.every((b) => b.type === "button")).toBe(true);
  });

  it("marks only the active mode with `is-active` and aria-pressed", () => {
    const cards = toggleButtons(buildNotesPanel(panelOptions(makeWorkspace(3))));
    expect(cards[0].className).toBe("view-toggle-button is-active");
    expect(cards[0].getAttribute("aria-pressed")).toBe("true");
    expect(cards[1].className).toBe("view-toggle-button");
    expect(cards[1].getAttribute("aria-pressed")).toBe("false");

    const list = toggleButtons(
      buildNotesPanel({ ...panelOptions(makeWorkspace(3)), notesViewMode: "list" }),
    );
    expect(list[1].className).toBe("view-toggle-button is-active");
    expect(list[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("reports the other mode when the inactive button is clicked", () => {
    const onChangeNotesView = vi.fn();
    const panel = buildNotesPanel({
      ...panelOptions(makeWorkspace(3)),
      onChangeNotesView,
    });
    toggleButtons(panel)[1].click();
    expect(onChangeNotesView).toHaveBeenCalledWith("list");
  });

  it("stays silent when the already-active button is clicked", () => {
    // Re-reporting the current mode would push a redundant history entry and
    // re-render the whole list for nothing.
    const onChangeNotesView = vi.fn();
    const panel = buildNotesPanel({
      ...panelOptions(makeWorkspace(3)),
      onChangeNotesView,
    });
    toggleButtons(panel)[0].click();
    expect(onChangeNotesView).not.toHaveBeenCalled();
  });
});

describe("buildNotesPanel empty workspace", () => {
  it("shows the first-run scene and skips the toolbar entirely", () => {
    // With nothing to filter, the toolbar's hint and view-toggle would be
    // moot — the panel goes straight to the CTA scene.
    const panel = buildNotesPanel(panelOptions(makeWorkspace(0)));
    expect(panel.textContent).toContain("No notebooks yet.");
    expect(panel.querySelector(".notes-toolbar")).toBeNull();
    expect(panel.querySelector(".view-toggle")).toBeNull();
    expect(panel.querySelector(".note-list-item")).toBeNull();
  });

  it("wires the scene's CTA to onNewNote", () => {
    const onNewNote = vi.fn();
    const panel = buildNotesPanel({ ...panelOptions(makeWorkspace(0)), onNewNote });
    const cta = Array.from(panel.querySelectorAll("button")).find(
      (button) => button.textContent === "Write your first note",
    );
    expect(cta).toBeDefined();
    cta?.click();
    expect(onNewNote).toHaveBeenCalledTimes(1);
  });
});

describe("buildNotesPanel endless-scroll key", () => {
  it("resets the rendered batch when the view mode changes", () => {
    // The list key folds filter mode, tags and view mode together so a
    // grown limit doesn't leak across a re-render into a different list.
    const workspace = makeWorkspace(200);
    buildNotesPanel(panelOptions(workspace));
    growVisible();
    expect(currentLimit()).toBe(INITIAL_LIMIT + GROW_BATCH);

    const switched = buildNotesPanel({
      ...panelOptions(workspace),
      notesViewMode: "list",
    });
    expect(switched.querySelectorAll(".notebook-row")).toHaveLength(INITIAL_LIMIT);
  });

  it("resets the rendered batch when the tag filter changes", () => {
    const workspace = makeWorkspace(200);
    for (const note of workspace.notes) note.tags = ["work"];
    buildNotesPanel(panelOptions(workspace));
    growVisible();

    const filtered = buildNotesPanel({
      ...panelOptions(workspace),
      selectedTagFilters: ["work"],
    });
    expect(filtered.querySelectorAll(".note-list-item")).toHaveLength(INITIAL_LIMIT);
  });
});
