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
import { buildLinkIndex, DEFAULT_NOTE_TITLE } from "../src/lib/notebook";
import { buildNoteSummary } from "../src/lib/note-card-meta";
import type {
  SutraPadDocument,
  SutraPadLinkIndex,
  SutraPadNoteSummary,
  SutraPadWorkspace,
} from "../src/types";

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
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
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
    linkIndex: buildLinkIndex(workspace),
    noteSummaries: workspace.notes.map((note) => buildNoteSummary(note)),
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

  it("renders a non-http(s) URL as inert text — no clickable href (defence in depth)", () => {
    // A Drive-loaded note's `urls` array is attacker-controllable; even if a
    // `javascript:` entry slipped past the load-time filter it must not
    // become a navigable link on the SutraPad origin.
    const note = makeNote({ id: "x", urls: ["javascript:alert(1)"] });
    const anchor = buildPage(makeWorkspace([note])).querySelector(".link-url");
    expect(anchor?.textContent).toBe("javascript:alert(1)");
    expect(anchor?.getAttribute("href")).toBeNull();
    expect(anchor?.getAttribute("target")).toBeNull();
  });

  it("makes an http(s) URL a real navigable link", () => {
    const note = makeNote({ id: "y", urls: ["https://example.com/a"] });
    const anchor = buildPage(makeWorkspace([note])).querySelector(".link-url");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noreferrer noopener");
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
  // coverage so the .link-card / .link-card-title / .card-excerpt /
  // .link-card-url / .link-card-saved / .entity-card-open /
  // .link-card-notebooks classNames stay pinned. The pre-#9
  // `.link-card-source` chip was deleted with the shared
  // `.entity-card-open` arrow + whole-card click pattern.

  it("renders one .link-card per indexed URL with a title, URL anchor, save date, and arrow open-button", () => {
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
    // Arrow open-button sits in the shared `.entity-card-head` next
    // to the title and carries the per-surface aria-label.
    const arrow = card.querySelector<HTMLButtonElement>(
      ".entity-card-head .entity-card-open",
    );
    expect(arrow?.getAttribute("aria-label")).toBe("Open source note");
    // No `.link-card-source` chip anywhere — pins the deletion so a
    // future regression that reintroduces the chip would fail.
    expect(card.querySelector(".link-card-source")).toBeNull();
  });

  it("renders a `.link-card-notebooks` indicator with the count when the URL is captured in multiple notebooks", () => {
    // Replaces the pre-#9 `.link-card-source` chip's `+N` suffix.
    // Single-source URLs stay implicit (title in head already names
    // the source note) — pinned below in the inverse test.
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
    const indicator = page.querySelector(".link-card-notebooks");
    expect(indicator?.textContent).toBe("Saved in 2 notebooks");
  });

  it("omits the `.link-card-notebooks` indicator entirely for single-source URLs", () => {
    // count === 1 means the title in head already names the source —
    // no need to repeat "Saved in 1 notebook" alongside the date.
    const note = makeNote({
      id: "n",
      title: "Only",
      tags: [],
      urls: ["https://example.com/once"],
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    expect(page.querySelector(".link-card-notebooks")).toBeNull();
  });

  it("invokes onOpenNote with the primary note id when the arrow open-button is clicked", () => {
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
    page
      .querySelector<HTMLButtonElement>(".link-card .entity-card-open")
      ?.click();
    expect(onOpenNote).toHaveBeenCalledWith("primary");
    // The arrow's own `stopPropagation` plus the card's
    // `closest("a, button")` guard keep onOpenNote from double-firing
    // through the whole-card shortcut.
    expect(onOpenNote).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenNote with the primary note id when the card body (dead space) is clicked", () => {
    // Whole-card click → open source note. Pre-#9 the card surface
    // was inert; only the (deleted) source chip was clickable.
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
    page.querySelector<HTMLElement>(".link-card")?.click();
    expect(onOpenNote).toHaveBeenCalledWith("primary");
  });

  it("renders a `.card-location` chip in the meta row when the primary source note has a location (#10)", () => {
    // Links meta order = `[date] · Saved in N notebooks · 📍 [venue]`;
    // location trails as the spatial context, mirroring Notes /
    // Tasks. Sourced from the primary note (the most recent source
    // note for the URL), so the chip ties the venue to the same
    // note that drives the head title.
    const note = makeNote({
      id: "n",
      title: "Why I saved it",
      tags: [],
      urls: ["https://example.com/a"],
      location: "Praha — Karlin office",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    const loc = page.querySelector(".link-card .card-meta .card-location");
    expect(loc).not.toBeNull();
    expect(
      loc?.querySelector(".card-location-text")?.textContent,
    ).toBe("Karlin office");
  });

  it("omits the `.card-location` chip from the link card when the primary source note has no location", () => {
    const note = makeNote({
      id: "n",
      title: "T",
      tags: [],
      urls: ["https://example.com/a"],
      location: undefined,
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    expect(page.querySelector(".link-card .card-location")).toBeNull();
  });

  it("clicking the URL anchor does NOT route through the card-level open-source-note shortcut", () => {
    // The `<a class="link-card-url">` is an external nav target; the
    // card-level click handler bails via `target.closest("a, button")`
    // so the user isn't yanked off to the source note while clicking
    // through to the external page.
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
    // happy-dom will follow the href as a real nav, which would crash
    // the test; prevent the default before dispatching. The click event
    // still bubbles and the closest() guard is what we're asserting.
    const url = page.querySelector<HTMLAnchorElement>(
      ".link-card .link-card-url",
    );
    url?.addEventListener("click", (event) => event.preventDefault());
    url?.click();
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it("renders a `.link-card-tags` row with the primary source note's tags in order", () => {
    const note = makeNote({
      id: "n1",
      title: "T",
      tags: ["work", "urgent", "today"],
      urls: ["https://example.com/a"],
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    const row = page.querySelector(".link-card-tags");
    expect(row).not.toBeNull();
    const chips = Array.from(row?.querySelectorAll(".tag-chip") ?? []);
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "work",
      "urgent",
      "today",
    ]);
  });

  it("omits the `.link-card-tags` row entirely when the primary source note has no tags", () => {
    // No empty wrapper should slip into the DOM — otherwise the bottom
    // margin still consumes vertical rhythm and the cards drift out of
    // alignment with Notes (which only renders the row when there are
    // tags to show).
    const note = makeNote({
      id: "n1",
      title: "T",
      tags: [],
      urls: ["https://example.com/a"],
    });
    const page = buildPage(makeWorkspace([note]), [], {
      linksViewMode: "cards",
    });
    expect(page.querySelector(".link-card-tags")).toBeNull();
  });

  it("uses the most-recently-updated source note's tags (not an aggregate across all notes)", () => {
    // Two notes share the same URL but carry different tag sets. The
    // card surfaces the primary note's slate — same note that drives
    // title/excerpt/persona — so the rendered tags should match `a`,
    // not the older `b`.
    const recent = makeNote({
      id: "a",
      title: "Most recent",
      tags: ["alpha"],
      urls: ["https://example.com/x"],
      updatedAt: "2026-04-30T12:00:00.000Z",
    });
    const older = makeNote({
      id: "b",
      title: "Older",
      tags: ["beta"],
      urls: ["https://example.com/x"],
      updatedAt: "2026-04-29T12:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([recent, older]), [], {
      linksViewMode: "cards",
    });
    const chips = Array.from(
      page.querySelectorAll(".link-card-tags .tag-chip"),
    );
    expect(chips.map((chip) => chip.textContent)).toEqual(["alpha"]);
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

/**
 * Builds the page from a hand-made link index + summaries instead of deriving
 * both from a workspace. Several branches only exist for data the deriver can't
 * produce — a link whose source note is missing, a duplicate note id, an entry
 * without `latestUpdatedAt`, a pre-Phase-2 summary with no `tags` field.
 */
function buildPageFromIndex(
  links: SutraPadLinkIndex["links"],
  summaries: SutraPadNoteSummary[],
  overrides: Partial<Parameters<typeof buildLinksPage>[0]> = {},
): HTMLElement {
  return buildLinksPage({
    linkIndex: { version: 1, savedAt: "2026-04-21T09:00:00.000Z", links },
    noteSummaries: summaries,
    selectedTagFilters: [],
    linksViewMode: "list",
    onOpenNote: vi.fn(),
    onOpenCapture: vi.fn(),
    onChangeLinksView: vi.fn(),
    onClearTagFilters: vi.fn(),
    ...overrides,
  });
}

function linkEntry(
  overrides: Partial<SutraPadLinkIndex["links"][number]> = {},
): SutraPadLinkIndex["links"][number] {
  return {
    url: "https://example.com/a",
    noteIds: ["n"],
    count: 1,
    latestUpdatedAt: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

function summary(overrides: Partial<SutraPadNoteSummary> = {}): SutraPadNoteSummary {
  return {
    id: "n",
    title: "Source note",
    createdAt: "2026-04-21T09:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

describe("buildLinksPage header copy", () => {
  const url = { urls: ["https://example.com/a"] };

  it("keeps the title and subtitle copy", () => {
    const page = buildPage(makeWorkspace([makeNote({ id: "n", ...url })]));
    expect(page.querySelector(".page-title")?.textContent).toBe(
      "A library of what caught your eye.",
    );
    expect(page.querySelector(".page-title em")?.textContent).toBe("library");
    expect(page.querySelector(".page-subtitle")?.textContent).toBe(
      "Every URL you've captured into a note, gathered here with the notebooks they first appeared in.",
    );
  });

  it("counts bare links when nothing is filtered", () => {
    const page = buildPage(makeWorkspace([makeNote({ id: "n", ...url })]));
    expect(page.querySelector(".page-eyebrow")?.textContent).toBe("Links · 1");
  });

  it("switches to `N of M` with a singular tag suffix for one filter", () => {
    const tagged = makeNote({ id: "t", tags: ["work"], urls: ["https://example.com/a"] });
    const other = makeNote({ id: "o", tags: ["home"], urls: ["https://example.com/b"] });
    const page = buildPage(makeWorkspace([tagged, other]), ["work"]);
    expect(page.querySelector(".page-eyebrow")?.textContent).toBe(
      "Links · 1 of 2 · filtered by 1 tag",
    );
  });

  it("pluralizes the tag suffix for two filters", () => {
    const tagged = makeNote({
      id: "t",
      tags: ["work", "urgent"],
      urls: ["https://example.com/a"],
    });
    const other = makeNote({ id: "o", tags: ["home"], urls: ["https://example.com/b"] });
    const page = buildPage(makeWorkspace([tagged, other]), ["work", "urgent"]);
    expect(page.querySelector(".page-eyebrow")?.textContent).toBe(
      "Links · 1 of 2 · filtered by 2 tags",
    );
  });

  it("persists the page-intro state under the `links` pageId", () => {
    window.localStorage.removeItem("sp.intros.v1");
    buildPage(makeWorkspace([makeNote({ id: "n", ...url })]));
    expect(window.localStorage.getItem("sp.intros.v1") ?? "").toContain('"links"');
  });
});

describe("buildLinksPage card body edges", () => {
  it("falls back to the bare URL and drops the arrow when the source note is gone", () => {
    // Data drift: the index still references a note id the summaries no longer
    // carry. "Open source note" isn't a meaningful action then, so no arrow.
    const page = buildPageFromIndex([linkEntry({ noteIds: ["missing"] })], [], {
      linksViewMode: "cards",
    });
    const card = page.querySelector(".link-card");
    expect(card?.querySelector(".link-card-title")?.textContent).toBe(
      "https://example.com/a",
    );
    expect(card?.querySelector(".entity-card-open")).toBeNull();
    expect(card?.querySelector(".entity-card-head")).toBeNull();
  });

  it("shows the source note's excerpt and omits it when the excerpt is empty", () => {
    const withExcerpt = buildPageFromIndex(
      [linkEntry()],
      [summary({ excerpt: "the first line of the note" })],
      { linksViewMode: "cards" },
    );
    expect(withExcerpt.querySelector(".link-card .card-excerpt")?.textContent).toBe(
      "the first line of the note",
    );

    const blank = buildPageFromIndex([linkEntry()], [summary({ excerpt: "" })], {
      linksViewMode: "cards",
    });
    expect(blank.querySelector(".link-card .card-excerpt")).toBeNull();
  });

  it("wraps the card body and grid in their layout classes", () => {
    const page = buildPageFromIndex([linkEntry()], [summary()], {
      linksViewMode: "cards",
    });
    expect(page.querySelector(".links-grid")).not.toBeNull();
    expect(page.querySelector(".link-card .link-body")).not.toBeNull();
  });

  it("omits the tag row for a pre-Phase-2 summary with no tags field", () => {
    const bare: SutraPadNoteSummary = {
      id: "n",
      title: "Source note",
      createdAt: "2026-04-21T09:00:00.000Z",
      updatedAt: "2026-04-21T09:00:00.000Z",
    };
    const page = buildPageFromIndex([linkEntry()], [bare], { linksViewMode: "cards" });
    expect(page.querySelector(".link-card-tags")).toBeNull();
  });

  it("omits the saved-date chip when the entry carries no timestamp", () => {
    const page = buildPageFromIndex(
      [linkEntry({ latestUpdatedAt: "" })],
      [summary()],
      { linksViewMode: "cards" },
    );
    expect(page.querySelector(".link-card .card-meta time")).toBeNull();
  });
});

/** Value of `--nc-bg` on the first link card, or "" when undecorated. */
function cardPaperBg(page: HTMLElement): string {
  return (
    page.querySelector<HTMLElement>(".link-card")?.style.getPropertyValue("--nc-bg") ?? ""
  );
}

describe("buildLinksPage persona layer", () => {
  const doc: SutraPadDocument = {
    id: "n",
    title: "Source note",
    body: "text",
    tags: [],
    urls: ["https://example.com/a"],
    createdAt: "2026-04-14T09:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
  };

  it("stamps the persona modifier on the page and decorates the card", () => {
    const plain = buildPageFromIndex([linkEntry()], [summary()], {
      linksViewMode: "cards",
    });
    expect(plain.className).toBe("links-page");
    expect(plain.querySelector(".link-card")?.classList.contains("has-persona")).toBe(
      false,
    );

    const persona = buildPageFromIndex([linkEntry()], [summary()], {
      linksViewMode: "cards",
      personaOptions: { allNotes: [doc], dark: false },
    });
    expect(persona.className).toBe("links-page links-page--persona");
    const card = persona.querySelector<HTMLElement>(".link-card");
    expect(card?.classList.contains("has-persona")).toBe(true);
    expect(card?.style.getPropertyValue("--nc-bg")).not.toBe("");
  });

  it("passes the dark flag into the persona derivation", () => {
    const light = cardPaperBg(
      buildPageFromIndex([linkEntry()], [summary()], {
        linksViewMode: "cards",
        personaOptions: { allNotes: [doc], dark: false },
      }),
    );
    const dark = cardPaperBg(
      buildPageFromIndex([linkEntry()], [summary()], {
        linksViewMode: "cards",
        personaOptions: { allNotes: [doc], dark: true },
      }),
    );
    expect(light).not.toBe("");
    expect(dark).not.toBe(light);
  });

  it("derives the to-go sticker from the primary summary's open-task count", () => {
    // The open-task cue comes from the stored counts, not a body scan — the
    // Links page never loads note bodies.
    const withOpen = buildPageFromIndex(
      [linkEntry()],
      [summary({ tasks: { open: 1, done: 0 } })],
      { linksViewMode: "cards", personaOptions: { allNotes: [doc], dark: false } },
    );
    expect(withOpen.querySelector('[data-sticker="to-go"]')).not.toBeNull();

    const allDone = buildPageFromIndex(
      [linkEntry()],
      [summary({ tasks: { open: 0, done: 2 } })],
      { linksViewMode: "cards", personaOptions: { allNotes: [doc], dark: false } },
    );
    expect(allDone.querySelector('[data-sticker="to-go"]')).toBeNull();
  });
});

describe("buildLinksPage list layout edges", () => {
  it("wraps rows in `.links-list` and marks the favicon decorative", () => {
    const page = buildPageFromIndex([linkEntry()], [summary()]);
    expect(page.querySelector("ul.links-list")).not.toBeNull();
    const favicon = page.querySelector<HTMLImageElement>(".link-favicon");
    // Empty alt: the URL right next to it already says where this goes.
    expect(favicon?.alt).toBe("");
    expect(favicon?.getAttribute("alt")).toBe("");
  });

  it("shows the last-added line with its machine-readable timestamp", () => {
    const page = buildPageFromIndex([linkEntry()], [summary()]);
    const lastAdded = page.querySelector<HTMLTimeElement>(".link-last-added");
    expect(lastAdded?.dateTime).toBe("2026-04-21T09:00:00.000Z");
    expect(lastAdded?.textContent?.startsWith("Last added ")).toBe(true);
  });

  it("omits the last-added line when the entry carries no timestamp", () => {
    const page = buildPageFromIndex([linkEntry({ latestUpdatedAt: "" })], [summary()]);
    expect(page.querySelector(".link-last-added")).toBeNull();
    expect(page.querySelector(".link-notebooks")).not.toBeNull();
  });

  it("renders one chip per distinct source note, deduplicating repeats", () => {
    // `noteIds` can legitimately repeat when the same note captured the URL
    // more than once; the chip row is a list of notebooks, not of captures.
    const page = buildPageFromIndex(
      [linkEntry({ noteIds: ["n", "n", "m"], count: 3 })],
      [summary({ id: "n" }), summary({ id: "m", title: "Other note" })],
    );
    const chips = [...page.querySelectorAll(".link-notebook-chip")];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Source note",
      "Other note",
    ]);
  });

  it("falls back to the default title for a chip whose note has none", () => {
    const page = buildPageFromIndex([linkEntry()], [summary({ title: "   " })]);
    expect(page.querySelector(".link-notebook-chip")?.textContent).toBe(
      DEFAULT_NOTE_TITLE,
    );
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------
//
// Four statement-deletion survivors, all of them an `append` whose *presence*
// nobody asserts — the suite reads the nodes it expects and never counts what
// the container actually holds.

describe("buildLinksPage: the appends nobody was counting", () => {
  it("keeps the view toolbar above the filter-miss empty state", () => {
    // When a filter kills every link the page still has to offer the view
    // toggle: the user's way out is either "Clear filter" or switching to a
    // view where something shows. Dropping the toolbar leaves the empty state
    // alone on the page with one escape instead of two.
    const work = makeNote({ id: "w", tags: ["work"], urls: ["https://a.example"] });
    const page = buildPage(makeWorkspace([work]), ["nic"]);

    const shape = [...page.children].map((el) => el.className.split(" ")[0]);
    expect(shape).toEqual(["page-header", "links-toolbar", "empty-state"]);
    expect(page.querySelector(".view-toggle")).not.toBeNull();
  });

  it("gives every view-toggle button its icon", () => {
    // The buttons carry no text — the icon *is* the label, with the accessible
    // name supplied by aria-label. An empty button is a blank square.
    const work = makeNote({ id: "w", tags: ["work"], urls: ["https://a.example"] });
    const page = buildPage(makeWorkspace([work]));
    const buttons = [...page.querySelectorAll<HTMLButtonElement>(".view-toggle-button")];

    expect(buttons.length).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("puts the thumbnail before the body in every link card", () => {
    // Two appends in a row build the card, and the order is the layout: the
    // thumb is the left rail, the body the right column. Losing the thumb
    // leaves a card whose grid column is empty.
    const work = makeNote({ id: "w", tags: ["work"], urls: ["https://a.example"] });
    const page = buildPage(makeWorkspace([work]), [], { linksViewMode: "cards" });
    const card = page.querySelector<HTMLElement>(".link-card");
    if (card === null) throw new Error("expected .link-card");

    const shape = [...card.children].map((el) => el.className.split(" ")[0]);
    expect(shape.slice(0, 2)).toEqual(["link-thumb", "link-body"]);
  });

  it("makes the URL line a real link, opening safely in a new tab", () => {
    // `applyLinkHref` is the one place that sets href + target + rel. Without
    // it the URL renders as text that looks clickable and is not — and, worse,
    // any future re-add without the rel would hand the opened page a live
    // `window.opener`.
    const work = makeNote({ id: "w", tags: ["work"], urls: ["https://a.example/x"] });
    const page = buildPage(makeWorkspace([work]), [], { linksViewMode: "cards" });
    const anchor = page.querySelector<HTMLAnchorElement>(".link-card-url");
    if (anchor === null) throw new Error("expected .link-card-url");

    expect(anchor.getAttribute("href")).toBe("https://a.example/x");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noreferrer noopener");
  });
});
