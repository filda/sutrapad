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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLinksPage } from "../src/app/view/pages/links-page";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

// happy-dom auto-fetches `<img src=…>` URLs and the og-image resolver
// pings the public proxy on every render. Without this stub the
// link-favicon images and the og-resolver round-trip surface as real
// network attempts to `s2/favicons` / `api.allorigins.win`; the
// requests can't resolve and happy-dom prints `AbortError` noise on
// `teardownWindow`. Returning an empty Response lets each promise
// settle quickly so teardown has nothing pending to abort.
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

describe("buildLinksPage eyebrow / toolbar / page-header / persona class", () => {
  it("uses the bare `Links · N` eyebrow when no filter is active", () => {
    const a = makeNote({
      id: "a",
      tags: [],
      urls: ["https://example.com/x"],
    });
    const b = makeNote({
      id: "b",
      tags: [],
      urls: ["https://example.com/y"],
    });
    const page = buildPage(makeWorkspace([a, b]), []);
    const eyebrow = page.querySelector(".page-eyebrow")?.textContent ?? "";
    expect(eyebrow).toBe("Links · 2");
    // Without an active filter the eyebrow MUST NOT carry the "filtered
    // by …" suffix — the StringLiteral mutant on line 117 ("" → marker)
    // would still leave nothing visible without an explicit assertion.
    expect(eyebrow).not.toContain("filtered");
    expect(eyebrow).not.toContain("of");
  });

  it("uses singular 'tag' (no plural s) when exactly one filter is active", () => {
    // Pin the `${filterCount === 1 ? "" : "s"}` ternary branch.
    const note = makeNote({
      id: "a",
      tags: ["work"],
      urls: ["https://example.com/x"],
    });
    const page = buildPage(makeWorkspace([note]), ["work"]);
    expect(page.querySelector(".page-eyebrow")?.textContent).toContain(
      "filtered by 1 tag",
    );
    expect(page.querySelector(".page-eyebrow")?.textContent).not.toContain(
      "1 tags",
    );
  });

  it("renders the page header with the canonical title fragment", () => {
    const note = makeNote({
      id: "a",
      tags: [],
      urls: ["https://example.com/x"],
    });
    const page = buildPage(makeWorkspace([note]));
    // The titleHtml on line 124 uses an `<em>` for the word `library`.
    // Pin both that the heading exists and that the emphasis carries the
    // expected word — kills the StringLiteral mutants on lines 124/126.
    const heading = page.querySelector(".page-header h1, .page-header h2");
    expect(heading?.textContent).toContain("library");
    expect(heading?.querySelector("em")?.textContent).toBe("library");
  });

  it("stamps `links-page--persona` on the wrapper only when personaOptions is provided", () => {
    const note = makeNote({
      id: "a",
      tags: [],
      urls: ["https://example.com/x"],
    });
    const without = buildPage(makeWorkspace([note]));
    expect(without.classList.contains("links-page--persona")).toBe(false);

    const withPersona = buildPage(makeWorkspace([note]), [], {
      personaOptions: { allNotes: [note], dark: false },
    });
    expect(withPersona.classList.contains("links-page--persona")).toBe(true);
  });

  it("stamps `links-toolbar` and the view-toggle role/label on the toolbar", () => {
    const note = makeNote({
      id: "a",
      tags: [],
      urls: ["https://example.com/x"],
    });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".links-toolbar")).not.toBeNull();
    const toggle = page.querySelector(".view-toggle");
    expect(toggle?.getAttribute("role")).toBe("group");
    expect(toggle?.getAttribute("aria-label")).toBe("Links view");
  });
});

describe("buildLinksPage cards layout", () => {
  // The list mode is exhaustively tested above; the cards mode (the
  // default linksViewMode in production) needs its own structural
  // coverage so the .link-card / .link-card-title / .link-card-desc /
  // .link-card-url / .link-card-saved / .link-card-source classNames
  // stay pinned.

  it("renders one .link-card per indexed URL with a title, URL anchor, save date, and source-note chip", () => {
    const note = makeNote({
      id: "n1",
      title: "Why I saved it",
      body: "Some context paragraph.\nhttps://example.com/a",
      tags: ["work"],
      urls: ["https://example.com/a"],
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    const cards = page.querySelectorAll(".link-card");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.querySelector(".link-card-title")?.textContent).toBe(
      "Why I saved it",
    );
    expect(card.querySelector(".link-card-url")?.textContent).toBe(
      "https://example.com/a",
    );
    expect(card.querySelector(".link-card-saved")).not.toBeNull();
    const sourceChip = card.querySelector<HTMLButtonElement>(".link-card-source");
    expect(sourceChip?.textContent).toBe("Why I saved it");
  });

  it("falls back to 'Untitled note' on the source chip when the note has a blank title", () => {
    const note = makeNote({
      id: "n1",
      title: "   ",
      body: "context",
      tags: [],
      urls: ["https://example.com/a"],
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    expect(page.querySelector(".link-card-source")?.textContent).toBe(
      "Untitled note",
    );
  });

  it("appends ` · +N` to the source chip text when the URL is captured in multiple notebooks", () => {
    // The chip text uses `${title} · +${count - 1}` for count > 1.
    // Mutating the StringLiteral or the count math would either drop
    // the suffix or land a wrong number.
    const a = makeNote({
      id: "a",
      title: "Most recent",
      tags: [],
      urls: ["https://example.com/x"],
      updatedAt: "2026-04-30T12:00:00.000Z",
    });
    const b = makeNote({
      id: "b",
      title: "Older",
      tags: [],
      urls: ["https://example.com/x"],
      updatedAt: "2026-04-29T12:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([a, b]), [], {
      linksViewMode: "cards",
    });
    const chip = page.querySelector(".link-card-source");
    expect(chip?.textContent).toBe("Most recent · +1");
    expect(chip?.getAttribute("aria-label")).toBe(
      "Open Most recent, saved in 2 notebooks",
    );
  });

  it("invokes onOpenNote with the primary note id when the source chip is clicked", () => {
    const note = makeNote({
      id: "primary",
      title: "T",
      urls: ["https://example.com/a"],
    });
    const onOpenNote = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
      onOpenNote,
    });
    page.querySelector<HTMLButtonElement>(".link-card-source")?.click();
    expect(onOpenNote).toHaveBeenCalledWith("primary");
  });
});

describe("buildLinksPage view-toggle", () => {
  it("renders Cards + List buttons with their labels, aria-pressed, and is-active reflecting the current mode", () => {
    const note = makeNote({
      id: "a",
      tags: [],
      urls: ["https://example.com/a"],
    });

    const cardsView = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    const cardsButtons = Array.from(
      cardsView.querySelectorAll<HTMLButtonElement>(".view-toggle-button"),
    );
    expect(cardsButtons).toHaveLength(2);
    expect(cardsButtons.map((b) => b.title)).toEqual(["Cards", "List"]);
    expect(cardsButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Cards",
      "List",
    ]);
    // aria-pressed flips on the active mode.
    expect(cardsButtons[0].getAttribute("aria-pressed")).toBe("true");
    expect(cardsButtons[1].getAttribute("aria-pressed")).toBe("false");
    expect(cardsButtons[0].classList.contains("is-active")).toBe(true);
    expect(cardsButtons[1].classList.contains("is-active")).toBe(false);

    const listView = buildPage(makeWorkspace([note]), []);
    const listButtons = Array.from(
      listView.querySelectorAll<HTMLButtonElement>(".view-toggle-button"),
    );
    expect(listButtons[0].getAttribute("aria-pressed")).toBe("false");
    expect(listButtons[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("invokes onChangeLinksView only when the clicked button represents a different mode", () => {
    // Pin the `option.mode !== active` guard inside the click handler.
    // Mutants that flip it to `true` would fire onChangeLinksView with
    // the SAME mode the user already had — wasted re-render.
    const note = makeNote({
      id: "a",
      tags: [],
      urls: ["https://example.com/a"],
    });
    const onChangeLinksView = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
      onChangeLinksView,
    });
    const buttons = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".view-toggle-button"),
    );

    // Click the already-active "Cards" button — must NOT fire.
    buttons[0].click();
    expect(onChangeLinksView).not.toHaveBeenCalled();

    // Click the "List" button — fires once with "list".
    buttons[1].click();
    expect(onChangeLinksView).toHaveBeenCalledTimes(1);
    expect(onChangeLinksView).toHaveBeenCalledWith("list");
  });
});

describe("buildLinksPage list layout", () => {
  it("renders a favicon, a notebooks chip per source note, and a 'Found in N notebooks' label", () => {
    const a = makeNote({
      id: "a",
      title: "First",
      tags: [],
      urls: ["https://example.com/x"],
      updatedAt: "2026-04-30T12:00:00.000Z",
    });
    const b = makeNote({
      id: "b",
      title: "Second",
      tags: [],
      urls: ["https://example.com/x"],
      updatedAt: "2026-04-29T12:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([a, b]), [], {
      linksViewMode: "list",
    });
    const item = page.querySelector(".link-item");
    expect(item).not.toBeNull();
    expect(item?.querySelector(".link-favicon")).not.toBeNull();
    const label = item?.querySelector(".link-notebooks-label");
    expect(label?.textContent).toBe("Found in 2 notebooks");
    const chips = Array.from(item?.querySelectorAll(".link-notebook-chip") ?? []);
    expect(chips.map((c) => c.textContent)).toEqual(["First", "Second"]);
  });

  it("clicking a notebook chip routes onOpenNote to that source note's id", () => {
    const a = makeNote({
      id: "a",
      title: "First",
      tags: [],
      urls: ["https://example.com/x"],
    });
    const onOpenNote = vi.fn();
    const page = buildPage(makeWorkspace([a]), [], {
      linksViewMode: "list",
      onOpenNote,
    });
    page.querySelector<HTMLButtonElement>(".link-notebook-chip")?.click();
    expect(onOpenNote).toHaveBeenCalledWith("a");
  });

  it("renders a single 'Found in' label (no plural / count) when only one notebook captured the URL", () => {
    const a = makeNote({
      id: "a",
      title: "Only",
      tags: [],
      urls: ["https://example.com/once"],
    });
    const page = buildPage(makeWorkspace([a]), [], {
      linksViewMode: "list",
    });
    expect(
      page.querySelector(".link-notebooks-label")?.textContent,
    ).toBe("Found in");
  });
});
