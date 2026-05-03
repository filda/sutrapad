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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTasksPage } from "../src/app/view/pages/tasks-page";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

// happy-dom triggers a real fetch the moment a `<link-thumb>` resolver
// is constructed (and again per favicon-bearing image). Without this
// stub the proxy round-trips surface as `AbortError` noise on the
// `teardownWindow` step — tests still pass, but the stderr is loud
// and obscures real failures. Returning an empty Response lets every
// pending fetch settle before teardown.
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

describe("buildTasksPage structural / chip / one-thing", () => {
  it("stamps `tasks-page` on the section root and renders the canonical page title with an `<em>` emphasis", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] Email Mia",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(page.tagName).toBe("SECTION");
    expect(page.classList.contains("tasks-page")).toBe(true);
    const heading = page.querySelector(".page-header h1, .page-header h2");
    expect(heading?.textContent).toContain("threads");
    expect(heading?.querySelector("em")?.textContent).toBe("threads");
  });

  it("renders the bare `Tasks · N open · M done` eyebrow without 'of' when no filter is active", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] open\n- [x] done",
    });
    const page = buildPage(makeWorkspace([note]));
    const eyebrow = page.querySelector(".page-eyebrow")?.textContent ?? "";
    expect(eyebrow).toBe("Tasks · 1 open · 1 done");
    expect(eyebrow).not.toContain("filtered");
  });

  it("renders the four canonical filter chips when each bucket has at least one task", () => {
    // Pin the FILTER_DEFS labels. Chips for non-`all` buckets only
    // render when their count is > 0 (or when they're the active
    // filter), so this fixture must populate Recent (added today),
    // Stale (>= 3 days old), and Waiting (mentions a person).
    const today = "2026-05-03T08:00:00.000Z";
    const longAgo = "2026-04-25T08:00:00.000Z";
    const fresh = makeNote({
      id: "fresh",
      tags: [],
      body: "- [ ] Email Mia",
      createdAt: today,
      updatedAt: today,
    });
    const old = makeNote({
      id: "old",
      tags: [],
      body: "- [ ] Stale work",
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    const waitingNote = makeNote({
      id: "wait",
      tags: [],
      body: "- [ ] @Mia owes us a draft",
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    const page = buildPage(makeWorkspace([fresh, old, waitingNote]));
    const chips = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    );
    const labels = chips.map((c) =>
      (c.firstElementChild as HTMLSpanElement)?.textContent,
    );
    expect(labels).toEqual(["All", "Recent", "Stale", "Waiting for"]);
  });

  it("flips `is-active` on the active filter chip and fires onChangeTasksFilter on click", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hello",
    });
    const onChangeTasksFilter = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "all",
      onChangeTasksFilter,
    });
    const chips = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    );
    const all = chips.find(
      (c) => (c.firstElementChild as HTMLSpanElement)?.textContent === "All",
    );
    expect(all?.classList.contains("is-active")).toBe(true);
    expect(all?.getAttribute("aria-pressed")).toBe("true");
    // Click the same chip — the guard skips onChangeTasksFilter.
    all?.click();
    expect(onChangeTasksFilter).not.toHaveBeenCalled();
  });

  it("renders the one-thing pick CTA in its empty state and toggles to a filled card when a key is supplied", () => {
    const note = makeNote({
      id: "n",
      title: "T",
      tags: [],
      body: "- [ ] Email Mia",
    });
    // Empty state — no key → pick CTA is rendered, not the filled card.
    const empty = buildPage(makeWorkspace([note]));
    expect(empty.querySelector(".one-thing.empty")).not.toBeNull();
    expect(
      empty.querySelector(".one-thing-pick-label")?.textContent,
    ).toBe("Pick one thing for today");

    // Filled state — pass the matching task key.
    const filled = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    expect(filled.querySelector(".one-thing-text")?.textContent).toBe(
      "Email Mia",
    );
    expect(filled.querySelector(".one-thing.empty")).toBeNull();
    expect(filled.querySelector(".one-thing-clear")).not.toBeNull();
  });

  it("disables the pick CTA and shows the 'Nothing to pick' copy when there are no open tasks", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [x] all done",
    });
    const page = buildPage(makeWorkspace([note]));
    const pick = page.querySelector<HTMLButtonElement>(".one-thing.empty");
    expect(pick?.disabled).toBe(true);
    expect(
      page.querySelector(".one-thing-pick-label")?.textContent,
    ).toBe("Nothing to pick");
  });

  it("clicking the empty pick CTA fires onSetOneThing with the stalest open task's key", () => {
    // The pick action delegates to `pickStalestOpenTask`. We only care
    // that the click wires through with a non-null key argument here —
    // the staleness logic is unit-tested separately.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] only one",
    });
    const onSetOneThing = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      onSetOneThing,
    });
    page.querySelector<HTMLButtonElement>(".one-thing.empty")?.click();
    expect(onSetOneThing).toHaveBeenCalledTimes(1);
    expect(onSetOneThing.mock.calls[0][0]).toBe("n::0");
  });

  it("clicking the clear `×` on the filled one-thing card calls onSetOneThing(null)", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
    });
    const onSetOneThing = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
      onSetOneThing,
    });
    page.querySelector<HTMLButtonElement>(".one-thing-clear")?.click();
    expect(onSetOneThing).toHaveBeenCalledWith(null);
  });

  it("clicking the one-thing checkbox routes onToggleTask with the task's noteId + lineIndex", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "skip\n- [ ] task on line 1",
    });
    const onToggleTask = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::1",
      onToggleTask,
    });
    page.querySelector<HTMLButtonElement>(".one-thing .task-check")?.click();
    expect(onToggleTask).toHaveBeenCalledWith("n", 1);
  });

  it("the filled one-thing's source-note link routes onOpenNote and prevents default", () => {
    const note = makeNote({
      id: "open-me",
      title: "Source",
      tags: [],
      body: "- [ ] do it",
    });
    const onOpenNote = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "open-me::0",
      onOpenNote,
    });
    const link = page.querySelector<HTMLAnchorElement>(".one-thing-meta a");
    expect(link?.textContent).toBe("Source");
    link?.click();
    expect(onOpenNote).toHaveBeenCalledWith("open-me");
  });

  it("renders one `.task-card` per source note with its task list inside `.task-list`", () => {
    const note = makeNote({
      id: "n",
      title: "Workspace",
      tags: [],
      body: "- [ ] one\n- [ ] two",
    });
    const page = buildPage(makeWorkspace([note]));
    const card = page.querySelector(".task-card");
    expect(card).not.toBeNull();
    expect(card?.querySelector(".task-card-head h3")?.textContent).toBe(
      "Workspace",
    );
    const list = card?.querySelector(".task-list");
    expect(list).not.toBeNull();
    const items = list?.querySelectorAll(".task-item");
    expect(items?.length).toBe(2);
    expect(items?.[0].querySelector(".t")?.textContent).toBe("one");
    expect(items?.[1].querySelector(".t")?.textContent).toBe("two");
  });

  it("falls back to 'Untitled' on a card head when the source note has a blank title", () => {
    const note = makeNote({
      id: "n",
      title: "",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(
      page.querySelector(".task-card-head h3")?.textContent,
    ).toBe("Untitled");
  });

  it("clicking a task checkbox routes onToggleTask with the note id and line index", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "skip me\n- [ ] line 1\n- [ ] line 2",
    });
    const onToggleTask = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], { onToggleTask });
    const checks = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-list .task-check"),
    );
    expect(checks).toHaveLength(2);
    checks[1].click();
    expect(onToggleTask).toHaveBeenCalledWith("n", 2);
  });

  it("done tasks render as `.task-item.done` with a checked checkbox", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [x] finished",
    });
    const page = buildPage(makeWorkspace([note]), [], { tasksShowDone: true });
    const item = page.querySelector(".task-list .task-item");
    expect(item?.classList.contains("done")).toBe(true);
    const check = item?.querySelector(".task-check");
    expect(check?.classList.contains("checked")).toBe(true);
    expect(check?.getAttribute("aria-label")).toBe("Mark open");
  });

  it("renders a 'waiting for' mini-tag on tasks that mention a person and are still open", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] @Mia please review",
    });
    const page = buildPage(makeWorkspace([note]));
    const tag = page.querySelector(".task-list .mini-tag");
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe("waiting for");
    expect(tag?.classList.contains("waiting")).toBe(true);
  });

  it("clicking the open-note arrow on a task card head routes onOpenNote with the source note id", () => {
    const note = makeNote({
      id: "src",
      title: "Source",
      tags: [],
      body: "- [ ] hi",
    });
    const onOpenNote = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], { onOpenNote });
    page
      .querySelector<HTMLButtonElement>(".task-card-head .task-card-open")
      ?.click();
    expect(onOpenNote).toHaveBeenCalledWith("src");
  });

  it("clicking the per-task promote sparkle routes onSetOneThing with the matching key", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] only one",
    });
    const onSetOneThing = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], { onSetOneThing });
    page
      .querySelector<HTMLButtonElement>(".task-list .task-promote")
      ?.click();
    expect(onSetOneThing).toHaveBeenCalledWith("n::0");
  });

  it("renders the per-card open/total footer count in 'N of M open' shape", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] open one\n- [x] done one",
    });
    const page = buildPage(makeWorkspace([note]), [], { tasksShowDone: true });
    expect(
      page.querySelector(".task-card-foot .task-card-count")?.textContent,
    ).toBe("1 of 2 open");
  });

  it("show-done checkbox change wires through onToggleTasksShowDone with the new value", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [x] done",
    });
    const onToggleTasksShowDone = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      onToggleTasksShowDone,
    });
    const input = page.querySelector<HTMLInputElement>(
      ".done-toggle input[type='checkbox']",
    );
    if (!input) throw new Error("expected the show-done checkbox");
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(onToggleTasksShowDone).toHaveBeenCalledWith(true);
  });
});

// Split out from the structural describe above to keep each `describe`
// body under the `max-lines-per-function` (350) lint cap. These are the
// finer-grained DOM contracts pinned by the 2026-05-03 mutation pass —
// eyebrow exact text, chip hint titles, one-thing meta details, task
// card head/foot, location stripping, filter-miss copy variants.
describe("buildTasksPage prose contracts and branch coverage", () => {
  it("renders the eyebrow exactly as 'Tasks · N of M open · X of Y done · filtered by 1 tag' (singular tag, not tags)", () => {
    // Pin three literals that survive substring assertions:
    //   - the singular/plural ternary on line 155 (`tag` vs `tags`)
    //   - the eyebrow prefix "Tasks · " StringLiteral on line 159
    //   - the "of" connective in `filterCount > 0 → "${linkCount} of ${total}"`
    const note = makeNote({
      id: "n",
      tags: ["work"],
      body: "- [ ] Email",
    });
    const eyebrow =
      buildPage(makeWorkspace([note]), ["work"]).querySelector(".page-eyebrow")
        ?.textContent ?? "";
    expect(eyebrow).toBe(
      "Tasks · 1 of 1 open · 0 of 0 done · filtered by 1 tag",
    );
    expect(eyebrow).not.toContain("1 tags");
  });

  it("uses plural `tags` (not `tag`) when more than one filter is active", () => {
    const note = makeNote({
      id: "n",
      tags: ["work", "urgent"],
      body: "- [ ] Email",
    });
    const eyebrow =
      buildPage(makeWorkspace([note]), ["work", "urgent"]).querySelector(
        ".page-eyebrow",
      )?.textContent ?? "";
    expect(eyebrow).toContain("filtered by 2 tags");
    expect(eyebrow).not.toContain("2 tag · ");
  });

  it("renders 'N of M' open/done counts in the eyebrow when a tag filter narrows the set", () => {
    // Pins L143–146: each `enriched.filter(...)` and `allEnriched.filter(...)`
    // contributes to the eyebrow's "filtered N of M open · X of Y done"
    // shape. Without per-bucket count assertions, mutants that swap the
    // arrays or the predicates all collapse to similar-looking eyebrows.
    const work = makeNote({
      id: "w",
      tags: ["work"],
      body: "- [ ] open work\n- [x] done work",
    });
    const home = makeNote({
      id: "h",
      tags: ["home"],
      body: "- [ ] open home\n- [x] done home",
    });
    const eyebrow =
      buildPage(makeWorkspace([work, home]), ["work"]).querySelector(
        ".page-eyebrow",
      )?.textContent ?? "";
    expect(eyebrow).toBe(
      "Tasks · 1 of 2 open · 1 of 2 done · filtered by 1 tag",
    );
  });

  it("renders each filter chip's `title` attribute with the canonical hint copy", () => {
    // Pin FILTER_DEFS hint strings (lines 57–59).
    const today = "2026-05-03T08:00:00.000Z";
    const longAgo = "2026-04-25T08:00:00.000Z";
    const fresh = makeNote({
      id: "fresh",
      tags: [],
      body: "- [ ] Email Mia",
      createdAt: today,
      updatedAt: today,
    });
    const old = makeNote({
      id: "old",
      tags: [],
      body: "- [ ] Stale work",
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    const waitingNote = makeNote({
      id: "wait",
      tags: [],
      body: "- [ ] @Mia owes us a draft",
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    const page = buildPage(makeWorkspace([fresh, old, waitingNote]));
    const chips = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    );
    const titleByLabel = Object.fromEntries(
      chips.map((c) => [
        (c.firstElementChild as HTMLSpanElement)?.textContent,
        c.getAttribute("title"),
      ]),
    );
    expect(titleByLabel.Recent).toBe("added last 2 days");
    expect(titleByLabel.Stale).toBe("open 3+ days");
    expect(titleByLabel["Waiting for"]).toBe("mentions a person");
    // The `All` chip carries no hint (null in FILTER_DEFS) — it must
    // therefore have NO title attribute set at all.
    expect(titleByLabel.All ?? null).toBeNull();
  });

  it("renders the chip count badge with the `c mono` className and the bucket size as text", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] one\n- [ ] two\n- [ ] three",
    });
    const page = buildPage(makeWorkspace([note]));
    const all = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).find(
      (c) => (c.firstElementChild as HTMLSpanElement)?.textContent === "All",
    );
    const count = all?.querySelector(".c");
    expect(count?.classList.contains("c")).toBe(true);
    expect(count?.classList.contains("mono")).toBe(true);
    expect(count?.textContent).toBe("3");
  });

  it("stamps `role=group` and a screen-reader label on the task-filter row, plus a spacer between chips and Show done", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]));
    const row = page.querySelector(".task-filters");
    expect(row?.getAttribute("role")).toBe("group");
    expect(row?.getAttribute("aria-label")).toBe("Filter tasks");
    expect(row?.querySelector(".task-filters-spacer")).not.toBeNull();
    expect(row?.querySelector(".done-toggle")?.textContent).toContain(
      "Show done",
    );
  });

  it("renders the one-thing label `One thing for today` with the `one-thing-label` className", () => {
    const note = makeNote({
      id: "n",
      title: "T",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const label = page.querySelector(".one-thing-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain("One thing for today");
  });

  it("renders the one-thing 'from <noteTitle> · <relativeDays>' meta line on the filled card", () => {
    // Pins the "from " span (line 302), the dim relative-days span
    // (lines 313–314), and the `oneThing.note.title.trim() || "Untitled note"`
    // fallback (line 306).
    const note = makeNote({
      id: "n",
      title: "Source note",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const meta = page.querySelector(".one-thing-meta");
    expect(meta).not.toBeNull();
    const fromSpan = meta?.firstElementChild;
    expect(fromSpan?.textContent).toBe("from ");
    const dim = meta?.querySelector(".dim");
    expect(dim?.textContent?.startsWith(" · ")).toBe(true);
    // formatRelativeDays produces a non-empty descriptor (e.g. "today",
    // "1 day ago", etc). Ensure the dim span isn't the bare " · ".
    expect((dim?.textContent ?? "").length).toBeGreaterThan(3);
  });

  it("falls back to 'Untitled note' on the one-thing source link when the note has a blank title", () => {
    const note = makeNote({
      id: "n",
      title: "   ",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    expect(
      page.querySelector(".one-thing-meta a")?.textContent,
    ).toBe("Untitled note");
  });

  it("stamps title='Clear' and the `Clear one thing` aria-label on the filled card's `×` button", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const clear = page.querySelector<HTMLButtonElement>(".one-thing-clear");
    expect(clear?.getAttribute("aria-label")).toBe("Clear one thing");
    expect(clear?.title).toBe("Clear");
  });

  it("renders the task-check in its OPEN state without the `checked` class and with `Mark done` aria-label", () => {
    // Pins the `${entry.task.done ? " checked" : ""}` ternary on
    // line 593 and the open-state aria-label literal on line 596.
    // The done-state assertion already exists; the open-state was
    // missing.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] still open",
    });
    const page = buildPage(makeWorkspace([note]));
    const check = page.querySelector(".task-list .task-check");
    expect(check?.classList.contains("checked")).toBe(false);
    expect(check?.getAttribute("aria-label")).toBe("Mark done");
    // Open-state checks have no inner SVG — only done-state injects the
    // ICON_CHECK markup.
    expect(check?.innerHTML).toBe("");
  });

  it("renders the one-thing pick sub-line with the open count and the 'we'll suggest the stalest' suffix", () => {
    // Pin line 357 — `${totalOpen} open — we'll suggest the stalest`.
    const a = makeNote({
      id: "a",
      tags: [],
      body: "- [ ] one",
    });
    const b = makeNote({
      id: "b",
      tags: [],
      body: "- [ ] two\n- [ ] three",
    });
    const page = buildPage(makeWorkspace([a, b]));
    expect(
      page.querySelector(".one-thing-pick-sub")?.textContent,
    ).toBe("3 open — we'll suggest the stalest");
  });

  it("renders the empty pick sub-line with the 'all caught up' copy when there are no open tasks", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [x] all done",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(
      page.querySelector(".one-thing-pick-sub")?.textContent,
    ).toBe("All caught up — enjoy the silence.");
  });
});

// Second half of the prose-contracts split: task-card head/foot,
// location stripping, stale badge, filter-miss copy variants. Split
// out from the previous describe to stay under the 350-line lint cap.
describe("buildTasksPage task-card and filter-miss contracts", () => {
  it("renders the task-card-open arrow with `Open note` aria-label and matching title", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]));
    const open = page.querySelector<HTMLButtonElement>(".task-card-open");
    expect(open?.getAttribute("aria-label")).toBe("Open note");
    expect(open?.title).toBe("Open note");
  });

  it("stamps `mono dim task-card-count` on the per-card footer count and uses 'N of M open' shape", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] one\n- [ ] two\n- [x] three",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksShowDone: true,
    });
    const count = page.querySelector(".task-card-foot .task-card-count");
    expect(count?.classList.contains("mono")).toBe(true);
    expect(count?.classList.contains("dim")).toBe(true);
    expect(count?.textContent).toBe("2 of 3 open");
  });

  it("renders an 'Open & add' button in the task-card footer that routes onOpenNote", () => {
    const note = makeNote({
      id: "src",
      tags: [],
      body: "- [ ] hi",
    });
    const onOpenNote = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], { onOpenNote });
    const add = page.querySelector<HTMLButtonElement>(
      ".task-card-foot .task-card-add",
    );
    expect(add?.textContent).toBe("Open & add");
    add?.click();
    expect(onOpenNote).toHaveBeenCalledWith("src");
  });

  it("renders a `stale` badge inside the task-card head when at least one of the card's open tasks crossed the staleness threshold", () => {
    const old = makeNote({
      id: "old",
      tags: [],
      body: "- [ ] forgotten",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([old]));
    const badge = page.querySelector(".task-card-head .stale-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("stale");
  });

  it("strips a leading `City — ` prefix from the source note location and renders only the venue", () => {
    // Pins the `rawLocation.replace(/^.*?—\s*/, "")` regex on line 554
    // and the `rawLocation && rawLocation !== "—"` guard on line 544.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "Praha — Karlin office",
    });
    const page = buildPage(makeWorkspace([note]));
    const sub = page.querySelector(".task-card-sub");
    expect(sub?.textContent).toContain("Karlin office");
    expect(sub?.textContent).not.toContain("Praha");
  });

  it("omits the location chip entirely when the note's location is the placeholder `—`", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "—",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".task-card-sub .task-card-pin")).toBeNull();
  });

  it("renders the chip-driven filter-miss empty state with a Show done CTA when there are unrevealed done tasks", () => {
    // tasksFilter = "stale" + tasksShowDone = false on a workspace
    // whose only task is fresh-and-done. Then:
    //   - allEnriched contains 1 entry (done)
    //   - the active "stale" filter narrows to 0
    //   - canShowDone branch fires (`!tasksShowDone && totalDone > 0`)
    //     and the empty-state offers "Show 1 done"
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [x] done today",
    });
    const onToggleTasksShowDone = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "stale",
      tasksShowDone: false,
      onToggleTasksShowDone,
    });
    const miss = page.querySelector(".task-empty");
    expect(miss).not.toBeNull();
    expect(miss?.querySelector("h3")?.textContent).toBe(
      "Nothing matches this filter.",
    );
    const cta = miss?.querySelector<HTMLButtonElement>("button");
    expect(cta?.textContent).toBe("Show 1 done");
    cta?.click();
    expect(onToggleTasksShowDone).toHaveBeenCalledWith(true);
  });

  it("renders the chip-driven filter-miss with a Show all CTA when only the chip narrows the view (no done tasks to reveal)", () => {
    // tasksFilter = "stale" with showDone already true and no done
    // tasks AND no stale tasks. canShowDone is false → falls to the
    // "Show all" branch. The note's createdAt is fresh (today, not the
    // 2026-04-21 default) so it doesn't qualify as stale (>= 3 days).
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] open today",
      createdAt: today,
      updatedAt: today,
    });
    const onChangeTasksFilter = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "stale",
      tasksShowDone: true,
      onChangeTasksFilter,
    });
    const miss = page.querySelector(".task-empty");
    const cta = miss?.querySelector<HTMLButtonElement>("button");
    expect(cta?.textContent).toBe("Show all");
    cta?.click();
    expect(onChangeTasksFilter).toHaveBeenCalledWith("all");
  });

  it("stamps `task-grid--persona` on the grid only when personaOptions is provided", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
    });
    const without = buildPage(makeWorkspace([note]));
    expect(
      without.querySelector(".task-grid")?.classList.contains("task-grid--persona"),
    ).toBe(false);
    const withPersona = buildPage(makeWorkspace([note]), [], {
      personaOptions: { allNotes: [note], dark: false },
    });
    expect(
      withPersona.querySelector(".task-grid")?.classList.contains("task-grid--persona"),
    ).toBe(true);
  });
});

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
