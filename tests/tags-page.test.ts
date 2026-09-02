// @vitest-environment happy-dom
//
// First focused test for `src/app/view/pages/tags-page.ts` — 713 lines, the
// biggest view module left unmeasured. The page has four distinct states the
// smoke test never reaches (first-run, no-selection, filtered-with-matches,
// filtered-with-nothing) and three independent narrowing mechanisms layered on
// top of each other: class visibility, the inline search query, and the
// committed filter set with its all/any mode.
//
// Two things shape every fixture here:
//
//   - **Auto tags are part of the data.** `buildCombinedTagIndex` derives
//     `date:*` (When) and `edit:*` / `tasks:*` (Source) tags from each note,
//     so a two-note workspace with two hand-typed tags renders ten. That is
//     the real input, so the tests assert against it rather than pretending
//     tags are only what the user typed — the unique-count in the eyebrow and
//     the per-class populations only make sense that way.
//   - **Time is frozen.** The derived When tags are relative to `now`, so
//     `vi.setSystemTime` is what makes "this-week", "today", "2026-04"
//     assertable at all.
//
// Where a fixture narrows `visibleTagClasses` to a single class, that is
// deliberate: it takes the auto-tag noise out of the assertion without
// mocking anything.
//
// Two survivors in the mutation report are equivalent: both mutants of
// `matchesSearch`'s `if (query === "") return true` early return. Falling
// through with an empty query leaves `needle === ""`, and every string
// `.includes("")`, so the fast path and the slow path agree.
//
// The copy bug this file used to pin is FIXED (2026-08-31): the match summary
// read "Showing 1 notebook that match …" — the plural `s` on "notebook" was
// conditional but the verb was not. The pin worked exactly as intended: the
// fix arrived as three failing expectations rather than as silent drift, so
// the singular and plural phrasings are both asserted below.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTagsPage, type TagsPageOptions } from "../src/app/view/pages/tags-page";
import { TAG_CLASS_IDS, type TagClassId } from "../src/app/logic/tag-class";
import type { SutraPadDocument, SutraPadTaskIndex } from "../src/types";

const NOW = "2026-04-21T10:00:00.000Z";
const TODAY = "2026-04-21T08:00:00.000Z";
/** Well past the 90-day graveyard threshold. */
const ANCIENT = "2025-06-01T08:00:00.000Z";

const EMPTY_TASK_INDEX: SutraPadTaskIndex = { version: 1, savedAt: "", tasks: [] };

const note = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "tělo",
  urls: [],
  createdAt: TODAY,
  updatedAt: TODAY,
  tags: [],
  ...overrides,
});

const DEFAULT_NOTES = [
  note({ id: "n-1", tags: ["praha", "kava"] }),
  note({ id: "n-2", tags: ["praha"], body: "- [ ] koupit mléko" }),
];

interface PageOverrides {
  notes?: SutraPadDocument[];
  selectedTagFilters?: string[];
  filterMode?: "all" | "any";
  visibleTagClasses?: ReadonlySet<TagClassId>;
  tagsSearchQuery?: string;
  taskIndex?: SutraPadTaskIndex;
}

function mount(overrides: PageOverrides = {}) {
  const handlers = {
    onToggleTagFilter: vi.fn(),
    onClearTagFilters: vi.fn(),
    onChangeFilterMode: vi.fn(),
    onToggleTagClass: vi.fn(),
    onChangeTagsSearchQuery: vi.fn(),
    onOpenNote: vi.fn(),
  };
  const options: TagsPageOptions = {
    workspace: { notes: overrides.notes ?? DEFAULT_NOTES, activeNoteId: "n-1" },
    taskIndex: overrides.taskIndex ?? EMPTY_TASK_INDEX,
    selectedTagFilters: overrides.selectedTagFilters ?? [],
    filterMode: overrides.filterMode ?? "all",
    currentNoteId: "n-1",
    visibleTagClasses: overrides.visibleTagClasses ?? new Set<TagClassId>(TAG_CLASS_IDS),
    tagsSearchQuery: overrides.tagsSearchQuery ?? "",
    ...handlers,
  };
  const page = buildTagsPage(options);
  document.body.append(page);

  const text = (selector: string) => page.querySelector(selector)?.textContent;
  const all = <T extends Element>(selector: string) => [...page.querySelectorAll<T>(selector)];
  /** `Label:count [pill,pill]` per rendered class group, in render order. */
  const groups = () =>
    all(".tags-list-group").map((group) => ({
      label: group.querySelector(".tags-list-label")?.textContent,
      count: group.querySelector(".tags-list-count")?.textContent,
      pills: [...group.querySelectorAll(".tag-name")].map((node) => node.textContent),
    }));
  const classRows = () => all<HTMLButtonElement>(".tag-class-row");
  const modeButtons = () => all<HTMLButtonElement>(".filter-mode-button");

  return { page, handlers, text, all, groups, classRows, modeButtons };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildTagsPage header", () => {
  it("counts unique tags and notes in the eyebrow", () => {
    // 2 hand-typed + 8 derived (5 When, 3 Source) = 10 unique.
    const { text } = mount();

    expect(text(".page-eyebrow-label")).toBe("Tags · 10 unique · 2 notes");
    expect(text(".page-title")).toBe("A constellation of what you think about.");
    expect(text(".page-subtitle")).toContain("Each class of tag has its own colour");
  });

  it("says '1 note' in the singular", () => {
    const { text } = mount({ notes: [note({ tags: ["praha"] })] });

    // Exact, not `toContain`: a mutant that appends to the singular branch
    // still "contains" the right prefix.
    expect(text(".page-eyebrow-label")).toBe("Tags · 8 unique · 1 note");
  });

  it("marks the active combine mode and labels both options", () => {
    const { page, modeButtons } = mount({ filterMode: "any" });

    const toggle = page.querySelector(".filter-mode-toggle");
    expect(toggle?.getAttribute("role")).toBe("group");
    expect(toggle?.getAttribute("aria-label")).toBe("Combine selected tags with");

    expect(modeButtons().map((button) => button.textContent)).toEqual(["All", "Any"]);
    expect(modeButtons().map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
    expect(modeButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Match every selected tag",
      "Match any selected tag",
    ]);
    expect(modeButtons()[1].className).toContain("is-active");
    expect(modeButtons()[0].className).not.toContain("is-active");
  });

  it("switches the mode on click, and ignores a click on the active one", () => {
    const { modeButtons, handlers } = mount({ filterMode: "all" });

    modeButtons()[1].click();
    expect(handlers.onChangeFilterMode).toHaveBeenCalledExactlyOnceWith("any");

    modeButtons()[0].click();
    expect(handlers.onChangeFilterMode).toHaveBeenCalledOnce();
  });

  it("offers a header clear button only while something is filtering", () => {
    expect(mount().page.querySelector(".page-header .button-ghost")).toBeNull();

    const { page, handlers } = mount({ selectedTagFilters: ["praha"] });
    const clear = page.querySelector<HTMLButtonElement>(".page-header .button-ghost");

    expect(clear?.textContent).toBe("Clear filters");
    clear?.click();
    expect(handlers.onClearTagFilters).toHaveBeenCalledOnce();
  });

  it("identifies itself to the intro store under its own page id", () => {
    mount();

    const store = JSON.parse(localStorage.getItem("sp.intros.v1") ?? "{}");
    expect(Object.keys(store)).toEqual(["tags"]);
  });
});

describe("buildTagsPage first run", () => {
  it("shows the full-bleed scene and nothing else when no tag exists anywhere", () => {
    // An empty workspace derives no auto tags either, so this is the only way
    // to reach a genuinely tag-less index.
    const { page, text } = mount({ notes: [] });

    expect(text(".empty-scene-title")).toBe("No tags yet.");
    expect(text(".empty-scene-sub")).toContain("Tags come from what you write");
    // No CTA: the copy promises tags appear on their own, so a button here
    // would contradict it.
    expect(page.querySelector(".empty-scene-actions")).toBeNull();
    // The early return means no layout, no hint, no graveyard.
    expect(page.querySelector(".tags-layout")).toBeNull();
    expect(page.querySelector(".tags-page-hint")).toBeNull();
  });
});

describe("buildTagsPage left panel", () => {
  it("invites a click when nothing is filtering", () => {
    const { page, text } = mount();

    expect(text(".tags-active-empty")).toBe("Click any tag to narrow.");
    expect(page.querySelector(".tags-clear-filters")).toBeNull();
  });

  it("renders a removable pill per active filter", () => {
    const { page, all, handlers } = mount({ selectedTagFilters: ["praha", "kava"] });

    expect(all(".tags-active .tag-name").map((node) => node.textContent)).toEqual([
      "praha",
      "kava",
    ]);
    const removes = all<HTMLButtonElement>(".tags-active .tag-x");
    expect(removes.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove filter praha",
      "Remove filter kava",
    ]);

    removes[1].click();
    expect(handlers.onToggleTagFilter).toHaveBeenCalledExactlyOnceWith("kava");
    expect(page.querySelector(".tags-active .tag-pill")?.className).toContain("active");
  });

  it("offers a clear-all button under the pill row", () => {
    const { page, handlers } = mount({ selectedTagFilters: ["praha"] });
    const clear = page.querySelector<HTMLButtonElement>(".tags-clear-filters");

    expect(clear?.textContent).toBe("Clear all");
    expect(clear?.getAttribute("aria-label")).toBe("Clear all active filters");
    clear?.click();
    expect(handlers.onClearTagFilters).toHaveBeenCalledOnce();
  });

  it("still renders a filter whose tag has vanished from the index", () => {
    // A filter committed in a previous session can outlive its tag; the pill
    // falls back to the user/topic hue rather than disappearing, so the user
    // can see what is narrowing their view and remove it.
    const { all } = mount({ selectedTagFilters: ["smazany"] });

    expect(all(".tags-active .tag-name").map((node) => node.textContent)).toEqual([
      "smazany",
    ]);
  });

  it("wires the search field to the caller", () => {
    const { page, text, handlers } = mount({ tagsSearchQuery: "pra" });
    const input = page.querySelector<HTMLInputElement>(".tags-search-input");

    expect(text(".tags-left-block h5")).toBe("Active filters");
    expect(input?.type).toBe("search");
    expect(input?.value).toBe("pra");
    expect(input?.placeholder).toBe("coffee, vinohrady, morning…");
    expect(input?.getAttribute("aria-label")).toBe("Filter tags by name");

    if (input) input.value = "kav";
    input?.dispatchEvent(new Event("input"));
    expect(handlers.onChangeTagsSearchQuery).toHaveBeenCalledExactlyOnceWith("kav");
  });

  it("labels the sidebar and its three blocks", () => {
    const { page, all } = mount();
    const panel = page.querySelector(".tags-left-panel");

    expect(panel?.getAttribute("aria-label")).toBe("Tag filters");
    expect(all(".tags-left-block").length).toBe(3);
    expect(all(".tags-left-block h5").map((node) => node.textContent)).toEqual([
      "Active filters",
      "Search",
      "Classes",
    ]);
  });

  it("hides the decorative parts of a class row from screen readers", () => {
    const { classRows } = mount();
    const row = classRows()[0];

    expect(row.querySelector(".tag-class-swatch")?.getAttribute("aria-hidden")).toBe("true");
    expect(row.querySelector(".tag-class-symbol")?.getAttribute("aria-hidden")).toBe("true");
    // The hue drives the swatch colour through a custom property.
    expect(row.style.getPropertyValue("--h")).not.toBe("");
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });

  it("lists all seven classes with their populations from the unfiltered index", () => {
    const { classRows } = mount();

    expect(
      classRows().map(
        (row) =>
          `${row.querySelector(".tag-class-label")?.textContent}=${row.querySelector(".tag-class-count")?.textContent}`,
      ),
    ).toEqual([
      "Topic=2",
      "Place=0",
      "When=5",
      "Source=3",
      "Device=0",
      "Weather=0",
      "People=0",
    ]);
    expect(
      classRows().map((row) => row.querySelector(".tag-class-symbol")?.textContent),
    ).toEqual(["#", "@", "~", "!", "%", "^", "*"]);
  });

  it("keeps the class populations stable while a filter narrows the list", () => {
    // The Classes panel is a visibility toggle, not a filter — its counts read
    // the full index so the population does not shift under the user.
    const { classRows } = mount({ selectedTagFilters: ["kava"] });

    expect(classRows()[0].querySelector(".tag-class-count")?.textContent).toBe("2");
  });

  it("flips a hidden class to its 'Show' affordance", () => {
    const { classRows, handlers } = mount({
      visibleTagClasses: new Set<TagClassId>(["place", "when", "source"]),
    });
    const topic = classRows()[0];

    expect(topic.className).toContain("off");
    expect(topic.getAttribute("aria-pressed")).toBe("false");
    expect(topic.getAttribute("aria-label")).toBe("Show topic tags");
    expect(classRows()[1].getAttribute("aria-label")).toBe("Hide place tags");
    expect(classRows()[1].className).not.toContain("off");

    topic.click();
    expect(handlers.onToggleTagClass).toHaveBeenCalledExactlyOnceWith("topic");
  });
});

describe("buildTagsPage list view", () => {
  it("groups tags by class in the canonical order with counts and descriptions", () => {
    const { groups, all } = mount();

    expect(groups()).toEqual([
      { label: "Topic", count: "2", pills: ["praha", "kava"] },
      {
        label: "When",
        count: "5",
        pills: ["this-month", "this-week", "today", "2026-04", "2026"],
      },
      { label: "Source", count: "3", pills: ["fresh", "none", "open"] },
    ]);
    expect(all(".tags-list-desc").map((node) => node.textContent)).toEqual([
      "· Concepts, projects, ideas — what it's about.",
      "· Time of day, day of week, season.",
      "· How the note was captured.",
    ]);
  });

  it("gives each group a hue-carrying heading with a decorative swatch", () => {
    const { page } = mount({ visibleTagClasses: new Set<TagClassId>(["topic"]) });
    const group = page.querySelector<HTMLElement>(".tags-list-view .tags-list-group");

    expect(group?.style.getPropertyValue("--h")).not.toBe("");
    expect(group?.querySelector(".tags-list-heading")?.tagName.toLowerCase()).toBe("h4");
    expect(group?.querySelector(".tags-list-swatch")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("lays the page out as sidebar plus main column", () => {
    const { page } = mount();

    expect(page.className).toBe("tags-page");
    expect(page.querySelector(".tags-layout .tags-left-panel")).not.toBeNull();
    expect(page.querySelector(".tags-layout .tags-main .tags-list-view")).not.toBeNull();
  });

  it("shows each tag's note count on its pill", () => {
    const { all } = mount({ visibleTagClasses: new Set<TagClassId>(["topic"]) });

    expect(all(".tags-list-row .tag-count").map((node) => node.textContent)).toEqual([
      "· 2",
      "· 1",
    ]);
  });

  it("shows no miss paragraph while any group rendered", () => {
    const { page } = mount();

    expect(page.querySelector(".tags-list-miss")).toBeNull();
  });

  it("omits a class the user has switched off", () => {
    const { groups } = mount({ visibleTagClasses: new Set<TagClassId>(["topic"]) });

    expect(groups().map((group) => group.label)).toEqual(["Topic"]);
  });

  it("commits a tag when its pill is clicked", () => {
    const { page, handlers } = mount({ visibleTagClasses: new Set<TagClassId>(["topic"]) });

    page.querySelector<HTMLElement>(".tags-list-row .tag-pill")?.click();

    expect(handlers.onToggleTagFilter).toHaveBeenCalledExactlyOnceWith("praha");
  });

  it("marks the pill of an already-active filter", () => {
    const { all } = mount({
      selectedTagFilters: ["kava"],
      visibleTagClasses: new Set<TagClassId>(["topic"]),
    });

    // Keyed by name rather than position: the available-index narrowing
    // reorders the cloud once a filter is on.
    expect(
      Object.fromEntries(
        all(".tags-list-row .tag-pill").map((pill) => [
          pill.querySelector(".tag-name")?.textContent,
          pill.classList.contains("active"),
        ]),
      ),
    ).toEqual({ kava: true, praha: false });
  });

  it("narrows the list to the search query", () => {
    const { groups } = mount({
      tagsSearchQuery: "kav",
      visibleTagClasses: new Set<TagClassId>(["topic"]),
    });

    expect(groups()).toEqual([{ label: "Topic", count: "1", pills: ["kava"] }]);
  });

  it("matches an auto tag on its display value, not its namespace", () => {
    // Typing "today" has to find `date:today` — the user never sees the
    // `date:` prefix, so matching the raw string would feel broken.
    const { groups } = mount({ tagsSearchQuery: "today" });

    expect(groups()).toEqual([{ label: "When", count: "1", pills: ["today"] }]);
  });

  it("corrects a placeholder note's task facet from the resident index", () => {
    // Phase 2 notes-scaling: a body-less placeholder has no `[ ]` lines to
    // parse, so `tasks:open` can only come from the resident task index being
    // threaded into the *available* index the list renders from.
    const { groups } = mount({
      notes: [note({ id: "n-p", body: "", hydrated: false, tags: ["praha"] })],
      taskIndex: {
        version: 1,
        savedAt: NOW,
        tasks: [
          { noteId: "n-p", lineIndex: 0, text: "koupit mléko", done: false, noteUpdatedAt: TODAY },
        ],
      },
      visibleTagClasses: new Set<TagClassId>(["source"]),
    });

    expect(groups()[0]?.pills).toContain("open");
  });

  it("does not match the auto-tag namespace itself", () => {
    // `date:today` is searchable as "today", not as "date" — the prefix is an
    // internal detail the user never sees, so matching it would surface a
    // whole class for a query that looks like a typo.
    const { groups, text } = mount({ tagsSearchQuery: "date" });

    expect(groups()).toEqual([]);
    expect(text(".tags-list-miss")).toContain('No tags match "date"');
  });

  it("ignores case in the search query", () => {
    const { groups } = mount({
      tagsSearchQuery: "KAV",
      visibleTagClasses: new Set<TagClassId>(["topic"]),
    });

    expect(groups().map((group) => group.pills)).toEqual([["kava"]]);
  });

  it("blames the query when a search matches nothing", () => {
    const { text, groups } = mount({ tagsSearchQuery: "qqq" });

    expect(groups()).toEqual([]);
    expect(text(".tags-list-miss")).toBe(
      'No tags match "qqq". Try a shorter query, or check whether a class is hidden.',
    );
  });

  it("blames the visibility toggles when every class is off", () => {
    // Different cause, different advice — pointing at the search box here
    // would send the user to a field they never touched.
    const { text } = mount({ visibleTagClasses: new Set<TagClassId>() });

    expect(text(".tags-list-miss")).toBe(
      "No tags match the current visibility. Toggle a class back on in the panel to the left.",
    );
  });
});

describe("buildTagsPage selection states", () => {
  it("hints how to use the page while nothing is selected", () => {
    const { page, text } = mount();

    expect(text(".tags-page-hint")).toBe(
      "Select one or more tags to see matching notebooks. Use All to require every tag, Any for a union.",
    );
    expect(page.querySelector(".tags-page-matches")).toBeNull();
  });

  it("swaps the hint for the matching notebooks once a tag is selected", () => {
    const { page, text } = mount({ selectedTagFilters: ["praha"] });

    expect(page.querySelector(".tags-page-hint")).toBeNull();
    expect(text(".tags-page-summary")).toBe(
      "Showing 2 notebooks that match every selected tag.",
    );
    expect(page.querySelector(".tags-page-matches .notes-list")).not.toBeNull();
  });

  it("names the any-mode union in the summary", () => {
    const { text } = mount({ selectedTagFilters: ["kava"], filterMode: "any" });

    // "notebook that match" is what ships: the plural `s` is conditional but
    // the verb is not, so the singular sentence is ungrammatical. Pinned as-is
    // and flagged rather than silently corrected — it is a copy decision.
    expect(text(".tags-page-summary")).toBe(
      "Showing 1 notebook that matches any selected tag.",
    );
  });

  it("requires every tag in all-mode", () => {
    // `kava` is on n-1 only, `praha` on both — the intersection is one note,
    // the union would be two.
    const { text } = mount({ selectedTagFilters: ["praha", "kava"], filterMode: "all" });

    expect(text(".tags-page-summary")).toBe(
      "Showing 1 notebook that matches every selected tag.",
    );
  });

  it("drops the summary when the selection matches nothing", () => {
    const { page } = mount({ selectedTagFilters: ["praha", "smazany"] });

    expect(page.querySelector(".tags-page-summary")).toBeNull();
    expect(page.querySelector(".tags-page-matches")).not.toBeNull();
  });
});

describe("buildTagsPage graveyard", () => {
  const withDormant = [
    ...DEFAULT_NOTES,
    note({
      id: "n-old",
      tags: ["zapomenuty"],
      createdAt: ANCIENT,
      updatedAt: ANCIENT,
    }),
  ];

  it("collects a used-once, long-untouched tag behind the Rare disclosure", () => {
    const { page, text } = mount({ notes: withDormant });
    const details = page.querySelector(".tags-graveyard");

    expect(details?.tagName.toLowerCase()).toBe("details");
    expect(text(".tags-graveyard-label")).toBe("Rare");
    expect(text(".tags-graveyard-hint")).toBe("· used once, not touched in 90+ days");
    expect(text(".tags-graveyard-copy")).toBe(
      "Collapsed here to reduce noise in the main cloud — still searchable.",
    );
    expect(
      [...(details?.querySelectorAll(".tags-graveyard-cloud .tag-name") ?? [])].map(
        (node) => node.textContent,
      ),
    ).toContain("zapomenuty");
    expect(details?.querySelector(".tags-graveyard-summary")?.tagName.toLowerCase()).toBe(
      "summary",
    );
    expect(details?.querySelector(".tags-graveyard-body")).not.toBeNull();
    // The count in the disclosure has to match the pills behind it.
    expect(text(".tags-graveyard-count")).toBe(
      String(details?.querySelectorAll(".tags-graveyard-cloud .tag-pill").length),
    );
  });

  it("draws rare pills muted, with their note count", () => {
    const { page } = mount({ notes: withDormant });
    const pill = page.querySelector(".tags-graveyard-cloud .tag-pill");

    expect(pill?.className).toContain("muted");
    expect(pill?.querySelector(".tag-count")?.textContent).toBe("· 1");
  });

  it("keeps a dormant tag out of the main cloud", () => {
    const { groups } = mount({
      notes: withDormant,
      visibleTagClasses: new Set<TagClassId>(["topic"]),
    });

    expect(groups()[0]?.pills).not.toContain("zapomenuty");
  });

  it("still commits a rare tag when its pill is clicked", () => {
    const { page, handlers } = mount({ notes: withDormant });
    const pill = page.querySelector<HTMLElement>(".tags-graveyard-cloud .tag-pill");

    pill?.click();

    expect(handlers.onToggleTagFilter).toHaveBeenCalledOnce();
  });

  it("hides the section while the user is exploring an overlap", () => {
    // With a selection active the page is about the intersection; a pile of
    // dormant tags underneath would interrupt that.
    const { page } = mount({ notes: withDormant, selectedTagFilters: ["praha"] });

    expect(page.querySelector(".tags-graveyard")).toBeNull();
  });

  it("shows no section when nothing has gone dormant", () => {
    const { page } = mount();

    expect(page.querySelector(".tags-graveyard")).toBeNull();
  });
});
