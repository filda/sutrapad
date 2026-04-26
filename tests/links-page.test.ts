// @vitest-environment happy-dom
//
// DOM tests for the Links page filter integration. The page already has
// indirect coverage via `link-card.test.ts` and `links-view.test.ts`; this
// suite focuses on the new tag-filter pathway:
//
//   - the unfiltered grid renders every URL across the workspace
//   - a single active tag narrows the grid to URLs from notes carrying
//     that tag (AND semantics — match every selected tag)
//   - the eyebrow surfaces "filtered N of M · filtered by K tag(s)"
//   - the toolbar hint switches to the "Showing links from notes that
//     match every selected tag." line when a filter is active
//   - a filter that kills every link renders the dashed filter-miss
//     empty state with a "Clear filter" secondary that calls back

import { describe, expect, it, vi } from "vitest";
import { buildLinksPage } from "../src/app/view/pages/links-page";
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
  overrides: Partial<Parameters<typeof buildLinksPage>[0]> = {},
): HTMLElement {
  return buildLinksPage({
    workspace,
    selectedTagFilters,
    linksViewMode: "list",
    onOpenNote: vi.fn(),
    onOpenCapture: vi.fn(),
    onChangeLinksView: vi.fn(),
    onClearTagFilters: vi.fn(),
    ...overrides,
  });
}

describe("buildLinksPage tag filter", () => {
  it("renders every URL when no filter is active", () => {
    const work = makeNote({
      id: "w",
      title: "Work",
      tags: ["work"],
      urls: ["https://example.com/a"],
    });
    const home = makeNote({
      id: "h",
      title: "Home",
      tags: ["home"],
      urls: ["https://example.com/b"],
    });
    const page = buildPage(makeWorkspace([work, home]));

    const items = page.querySelectorAll(".link-url");
    const urls = [...items].map((node) => node.textContent);
    expect(urls).toEqual(
      expect.arrayContaining(["https://example.com/a", "https://example.com/b"]),
    );
    expect(urls).toHaveLength(2);
  });

  it("narrows the grid to URLs from notes with every selected tag", () => {
    const work = makeNote({
      id: "w",
      title: "Work",
      tags: ["work"],
      urls: ["https://example.com/a"],
    });
    const home = makeNote({
      id: "h",
      title: "Home",
      tags: ["home"],
      urls: ["https://example.com/b"],
    });
    const page = buildPage(makeWorkspace([work, home]), ["work"]);

    const urls = [...page.querySelectorAll(".link-url")].map((n) => n.textContent);
    expect(urls).toEqual(["https://example.com/a"]);
  });

  it("uses AND semantics — a note must carry every selected tag", () => {
    const both = makeNote({
      id: "both",
      title: "Both",
      tags: ["work", "urgent"],
      urls: ["https://example.com/both"],
    });
    const partial = makeNote({
      id: "partial",
      title: "Partial",
      tags: ["work"],
      urls: ["https://example.com/partial"],
    });
    const page = buildPage(
      makeWorkspace([both, partial]),
      ["work", "urgent"],
    );

    const urls = [...page.querySelectorAll(".link-url")].map((n) => n.textContent);
    expect(urls).toEqual(["https://example.com/both"]);
  });

  it("surfaces the filtered-N-of-M count and tag count in the eyebrow", () => {
    const a = makeNote({
      id: "a",
      tags: ["work"],
      urls: ["https://example.com/a"],
    });
    const b = makeNote({
      id: "b",
      tags: ["home"],
      urls: ["https://example.com/b"],
    });
    const c = makeNote({
      id: "c",
      tags: ["home"],
      urls: ["https://example.com/c"],
    });
    const page = buildPage(makeWorkspace([a, b, c]), ["home"]);

    const eyebrow = page.querySelector(".page-eyebrow")?.textContent ?? "";
    expect(eyebrow).toContain("Links · 2 of 3");
    expect(eyebrow).toContain("filtered by 1 tag");
  });

  it("pluralises the tag count when more than one filter is active", () => {
    const a = makeNote({
      id: "a",
      tags: ["work", "urgent"],
      urls: ["https://example.com/a"],
    });
    const page = buildPage(makeWorkspace([a]), ["work", "urgent"]);

    const eyebrow = page.querySelector(".page-eyebrow")?.textContent ?? "";
    expect(eyebrow).toContain("filtered by 2 tags");
  });

  it("swaps the toolbar hint to the active-filter copy when filtering", () => {
    const a = makeNote({
      id: "a",
      tags: ["work"],
      urls: ["https://example.com/a"],
    });
    const unfiltered = buildPage(makeWorkspace([a]));
    expect(unfiltered.querySelector(".links-toolbar-hint")?.textContent).toContain(
      "Filter by tag from the bar above",
    );

    const filtered = buildPage(makeWorkspace([a]), ["work"]);
    expect(filtered.querySelector(".links-toolbar-hint")?.textContent).toBe(
      "Showing links from notes that match every selected tag.",
    );
  });

  it("shows the dashed filter-miss state with a Clear filter button when nothing matches", () => {
    const work = makeNote({
      id: "w",
      tags: ["work"],
      urls: ["https://example.com/a"],
    });
    const onClearTagFilters = vi.fn();
    const page = buildPage(
      makeWorkspace([work]),
      ["nonexistent"],
      { onClearTagFilters },
    );

    const miss = page.querySelector(".empty-state");
    expect(miss).not.toBeNull();
    expect(miss?.querySelector("h3")?.textContent).toBe("No links match.");

    const clear = miss?.querySelector<HTMLButtonElement>(".button-ghost");
    expect(clear?.textContent).toBe("Clear filter");
    clear?.click();
    expect(onClearTagFilters).toHaveBeenCalledTimes(1);
  });

  it("still shows the first-run empty scene when the workspace has no links at all", () => {
    const empty = makeNote({ id: "e", tags: [], urls: [] });
    const page = buildPage(makeWorkspace([empty]));

    // Full-bleed scene rather than the dashed inline miss — the user has
    // no links to filter, so the bookmarklet pitch is still the right CTA.
    expect(page.querySelector(".empty-scene")).not.toBeNull();
    expect(page.querySelector(".empty-state")).toBeNull();
  });
});
