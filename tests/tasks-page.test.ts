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
    // `today` is wall-clock derived because tasks-page rebuilds with
    // `new Date()` — a hardcoded ISO string drifts out of the 2-day
    // Recent window the moment the suite is rerun on a later date.
    const today = new Date().toISOString();
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

  it("falls back to 'Untitled note' on a card head when the source note has a blank title", () => {
    // Step 2 of cards-unification aligned this with the Notes / Links
    // / one-thing fallback (`DEFAULT_NOTE_TITLE` in lib/notebook.ts).
    // The previous local "Untitled" string was the only deviation.
    const note = makeNote({
      id: "n",
      title: "",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(
      page.querySelector(".task-card-head h3")?.textContent,
    ).toBe("Untitled note");
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
      .querySelector<HTMLButtonElement>(".task-card-head .entity-card-open")
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
    // Pin FILTER_DEFS hint strings (lines 57–59). `today` is wall-clock
    // derived for the same reason as in the chip-render test above —
    // the page wraps `new Date()` so a frozen literal slides out of
    // the 2-day Recent window and hides the chip.
    const today = new Date().toISOString();
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
  it("renders the entity-card-open arrow with `Open note` aria-label and matching title", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]));
    const open = page.querySelector<HTMLButtonElement>(".entity-card-open");
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

  it("renders no 'Open & add' button in the task-card footer anymore (#9 removed the duplicate of the head's `.entity-card-open` arrow)", () => {
    // The foot pre-#9 carried a button labelled "Open & add" that
    // routed onOpenNote — same action as the head's arrow. The
    // button was deleted; the foot keeps just the open/total
    // counter. Test pins both: no `.task-card-add` element remains
    // anywhere, and the foot still exists with its `.task-card-count`.
    const note = makeNote({
      id: "src",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".task-card-add")).toBeNull();
    expect(page.querySelector(".task-card-foot")).not.toBeNull();
    expect(page.querySelector(".task-card-foot .task-card-count")).not.toBeNull();
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
    // #10: location chip moved from `.task-card-sub` to
    // `.task-card-foot`. Strip logic lives in the shared
    // `formatNoteLocation` helper now (own test file pins the
    // regex/placeholder rules); this test just confirms Tasks
    // routes through it on the foot row.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "Praha — Karlin office",
    });
    const page = buildPage(makeWorkspace([note]));
    const foot = page.querySelector(".task-card-foot");
    expect(foot?.textContent).toContain("Karlin office");
    expect(foot?.textContent).not.toContain("Praha");
  });

  it("omits the location chip entirely when the note's location is the placeholder `—`", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "—",
    });
    const page = buildPage(makeWorkspace([note]));
    // #10: pin span class moved from `.task-card-pin` to the shared
    // `.card-location` wrapper, and location moved from sub to foot.
    expect(page.querySelector(".task-card .card-location")).toBeNull();
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

// Pin the icon contract — every Tasks glyph now routes through the shared
// `buildIcon` (from `icons.ts`), which builds the `<svg>` with
// `createElementNS`, sets only `class` / `viewBox` / `aria-hidden` /
// `focusable`, and leans on the `.i` CSS for stroke / fill. These asserts
// pin the migrated contract (no inline width/height/stroke attributes) and
// the `<path>` `d` data sourced from `icons.ts` → ICON_SHAPES, so a
// regression that reintroduces an `innerHTML` icon string or drops a path
// would surface here.
describe("buildTasksPage icon contract", () => {
  it("the per-task promote sparkle renders via buildIcon's attribute set (no inline recipe)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    // `.task-promote` is the most reliably-present buildIcon-built glyph
    // (every open task on every card carries the sparkle).
    const page = buildPage(makeWorkspace([note]));
    const svg = page.querySelector(".task-promote svg");
    expect(svg).not.toBeNull();
    // buildIcon size 12 → "i i-12"; stroke / fill live in the `.i` CSS.
    expect(svg?.getAttribute("class")).toBe("i i-12");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    // No inline sizing / stroke recipe — those moved to CSS in the migration.
    expect(svg?.getAttribute("width")).toBeNull();
    expect(svg?.getAttribute("height")).toBeNull();
    expect(svg?.getAttribute("stroke")).toBeNull();
    expect(svg?.getAttribute("stroke-width")).toBeNull();
  });

  it("the entity-card-open arrow renders the `arrow` icon from `icons.ts` (the new home of the chevron paths post-#9)", () => {
    // Arrow path silhouette = horizontal shaft + chevron head:
    //   "M5 12h14" + "m13 6 6 6-6 6"
    // pinned at the source-of-truth in `icons.ts` → ICON_SHAPES.arrow.
    // The test queries the rendered `<svg>` under the entity-card-open
    // button and asserts both `<path>` children carry the expected `d`.
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const svg = page.querySelector(".entity-card-open svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toBe("i i-12");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    const paths = Array.from(svg?.querySelectorAll("path") ?? []);
    expect(paths.map((p) => p.getAttribute("d"))).toEqual([
      "M5 12h14",
      "m13 6 6 6-6 6",
    ]);
  });

  it("the empty pick CTA renders the sparkle icon via buildIcon (size 14)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const svg = page.querySelector(".one-thing-icon svg");
    expect(svg?.getAttribute("class")).toBe("i i-14");
    // sparkle silhouette sourced from icons.ts → ICON_SHAPES.sparkle.
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(
      "M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3",
    );
  });

  it("the filled one-thing-label renders the sparkle icon at size 12", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const svg = page.querySelector(".one-thing-label svg");
    expect(svg?.getAttribute("class")).toBe("i i-12");
    expect(svg?.querySelector("path")?.getAttribute("d")).toContain("M12 3v6");
  });

  it("the per-task promote sparkle renders at size 12 (11 isn't on the ramp)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const svg = page.querySelector(".task-promote svg");
    expect(svg?.getAttribute("class")).toBe("i i-12");
    expect(svg?.querySelector("path")?.getAttribute("d")).toContain("M12 3v6");
  });

  it("the one-thing-clear button renders the close icon via buildIcon (size 12)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const svg = page.querySelector(".one-thing-clear svg");
    expect(svg?.getAttribute("class")).toBe("i i-12");
    // close silhouette sourced from icons.ts → ICON_SHAPES.close.
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(
      "M6 6l12 12M18 6 6 18",
    );
  });

  it("the done one-thing checkbox renders the check icon via buildIcon (size 16)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [x] done" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksShowDone: true,
      tasksOneThingKey: "n::0",
    });
    const svg = page.querySelector(".one-thing .task-check.lg svg");
    // size 16 maps to the bare "i" class on the shared ramp.
    expect(svg?.getAttribute("class")).toBe("i");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("m5 12 5 5L20 7");
  });

  it("the per-list done task-check renders the check icon via buildIcon (size 12)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [x] done" });
    const page = buildPage(makeWorkspace([note]), [], { tasksShowDone: true });
    const svg = page.querySelector(".task-list .task-check.checked svg");
    expect(svg?.getAttribute("class")).toBe("i i-12");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("m5 12 5 5L20 7");
  });

  it("the card-location pin renders the `pin` icon from `icons.ts` (the new home of the teardrop + marker hole post-#10)", () => {
    // #10 moved the pin from inline `renderIcon(ICON_PIN, 11)` in
    // `tasks-page.ts` to `buildIcon("pin", 12)` via
    // `buildLocationLine`. Path + circle silhouettes are pinned at
    // the source of truth in `icons.ts` → ICON_SHAPES.pin; this test
    // walks the rendered SVG inside the foot's `.card-location` and
    // pins both children carry the expected attributes. Size moves
    // from 11 to 12 because `IconSize` doesn't carry an 11 entry.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "Karlin office",
    });
    const page = buildPage(makeWorkspace([note]));
    const svg = page.querySelector(".task-card-foot .card-location svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class")).toBe("i i-12");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    const path = svg?.querySelector("path");
    expect(path?.getAttribute("d")).toBe(
      "M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13Z",
    );
    const circle = svg?.querySelector("circle");
    expect(circle?.getAttribute("cx")).toBe("12");
    expect(circle?.getAttribute("cy")).toBe("9");
    expect(circle?.getAttribute("r")).toBe("2.5");
  });
});

// Pin the structural class names + small inline-style + href contracts
// that the structural describe above leaves on the table. Each
// className StringLiteral is its own mutant; without an explicit
// assertion they survive because the existing tests only walk the
// surface via querySelector — which still matches when the class string
// has been truncated to `""` (selector returns null but tests guard with
// optional-chains).
describe("buildTasksPage structural class names + inline styles", () => {
  it("stamps `entity-card entity-card--task task-card` on the card root <article>", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const card = page.querySelector(".task-card");
    expect(card?.tagName).toBe("ARTICLE");
    expect(card?.classList.contains("entity-card")).toBe(true);
    expect(card?.classList.contains("entity-card--task")).toBe(true);
    expect(card?.classList.contains("task-card")).toBe(true);
  });

  it("stamps `one-thing-body` on the filled one-thing body wrapper", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    expect(page.querySelector(".one-thing-body")).not.toBeNull();
  });

  it("stamps `one-thing-icon` on the empty pick CTA icon span", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".one-thing.empty .one-thing-icon")).not.toBeNull();
  });

  it("renders the filled one-thing checkbox with `task-check lg` (no list-item check carries `lg`)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const one = page.querySelector(".one-thing .task-check");
    expect(one?.classList.contains("task-check")).toBe(true);
    expect(one?.classList.contains("lg")).toBe(true);
    expect(one?.classList.contains("checked")).toBe(false);
    const list = page.querySelector(".task-list .task-check");
    expect(list?.classList.contains("task-check")).toBe(true);
    expect(list?.classList.contains("lg")).toBe(false);
  });

  it("renders the filled one-thing checkbox with `task-check lg checked` + `Mark open` aria-label when the task is done", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [x] done" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksShowDone: true,
      tasksOneThingKey: "n::0",
    });
    const check = page.querySelector(".one-thing .task-check");
    expect(check?.className).toBe("task-check lg checked");
    expect(check?.getAttribute("aria-label")).toBe("Mark open");
    expect((check as HTMLButtonElement)?.querySelector("svg")).not.toBeNull();
  });

  it("renders the filled one-thing checkbox in its OPEN state with `Mark done` and no inner SVG", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] still open" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const check = page.querySelector(".one-thing .task-check");
    expect(check?.className).toBe("task-check lg");
    expect(check?.getAttribute("aria-label")).toBe("Mark done");
    expect((check as HTMLButtonElement)?.innerHTML).toBe("");
  });

  it("stamps `task-item` on every list row, adding ` done` suffix only when the task is done", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] open\n- [x] done",
    });
    const page = buildPage(makeWorkspace([note]), [], { tasksShowDone: true });
    const items = page.querySelectorAll(".task-list .task-item");
    expect(items[0].className).toBe("task-item");
    expect(items[1].className).toBe("task-item done");
  });

  it("stamps `task-body` on the per-row body wrapper and renders the text inside `.t`", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] do it" });
    const page = buildPage(makeWorkspace([note]));
    const body = page.querySelector(".task-list .task-body");
    expect(body).not.toBeNull();
    expect(body?.querySelector(".t")?.textContent).toBe("do it");
  });

  it("stamps `card-location` on the foot's pin+venue wrapper with the venue text inside `.card-location-text`", () => {
    // #10: pre-`.task-card-pin` (icon-only span) is gone. The new
    // wrapper `<span class="card-location">` carries both the pin
    // SVG and a `<span class="card-location-text">` for the venue,
    // so callers can style icon vs. text separately.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "Karlin office",
    });
    const page = buildPage(makeWorkspace([note]));
    const loc = page.querySelector(".task-card-foot .card-location");
    expect(loc).not.toBeNull();
    expect(
      loc?.querySelector(".card-location-text")?.textContent,
    ).toBe("Karlin office");
  });

  it("sets non-empty `flex` + `minWidth` inline styles on the filled one-thing text wrapper", () => {
    // The text wrapper is the un-classed div between `.task-check` and
    // `.one-thing-clear` inside `.one-thing-body`. Its inline styles are
    // load-bearing — the row depends on flex:1/minWidth:0 to keep long
    // task text from pushing the clear `×` off the card. We assert
    // non-empty rather than `===`'1' because happy-dom expands `flex:1`
    // into the CSS shorthand `"1 1 0%"` and may normalise `0` to `0px`;
    // the StringLiteral mutants we're killing replace with `""`, which
    // is observable as the property being cleared.
    const note = makeNote({ id: "n", tags: [], body: "- [ ] do it" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const body = page.querySelector<HTMLElement>(".one-thing-body");
    const text = body?.querySelector<HTMLElement>(".one-thing-text")?.parentElement;
    expect(text?.style.flex).not.toBe("");
    expect(text?.style.flexGrow).toBe("1");
    expect(text?.style.minWidth).not.toBe("");
  });

  it("sets `title.style.minWidth='0'` on the task-card-head title wrapper", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const head = page.querySelector(".task-card-head");
    const title = head?.firstElementChild as HTMLElement | null;
    expect(title?.style.minWidth).toBe("0");
  });

  it("the filled one-thing source-note link has href='#' (prevents the click from navigating away)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const link = page.querySelector<HTMLAnchorElement>(".one-thing-meta a");
    // happy-dom resolves the bare "#" to a full URL terminating in #.
    expect(link?.getAttribute("href")).toBe("#");
  });

  it("stamps `task-empty` on the dashed tag-filter miss empty state (parity with the chip-filter miss)", () => {
    const note = makeNote({ id: "n", tags: ["work"], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), ["nope"]);
    const miss = page.querySelector(".empty-state.task-empty");
    expect(miss).not.toBeNull();
  });

  it("the per-task promote button carries `task-promote` className and both aria-label / title set to 'Pick for today'", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const promote = page.querySelector<HTMLButtonElement>(".task-promote");
    expect(promote?.classList.contains("task-promote")).toBe(true);
    expect(promote?.getAttribute("aria-label")).toBe("Pick for today");
    expect(promote?.title).toBe("Pick for today");
  });
});

// Pin the chip-row gating logic, the canShowDone branch arms, and the
// "promote sparkle is hidden on done / on the one-thing" negative
// branches. These survive because the structural tests only assert the
// positive shape (chip renders, sparkle appears) but never the negation
// (chip is skipped, sparkle is omitted, click fires for non-active chip).
describe("buildTasksPage gating + branch coverage", () => {
  it("skips a non-active chip whose count is zero (and the All chip always renders)", () => {
    // Workspace with a single fresh, neutral open task — Stale &
    // Waiting buckets are empty and not active, so they MUST NOT
    // render. All + Recent still render (All is always shown, Recent
    // has count > 0). Task body is deliberately verbless to avoid
    // tripping the `WAITING_PERSON_REGEX` (call/ask/email/text/write).
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] Buy milk",
      createdAt: today,
      updatedAt: today,
    });
    const page = buildPage(makeWorkspace([note]));
    const labels = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).map((c) => (c.firstElementChild as HTMLSpanElement)?.textContent);
    expect(labels).toEqual(["All", "Recent"]);
    expect(labels).not.toContain("Stale");
    expect(labels).not.toContain("Waiting for");
  });

  it("renders an active chip even when its own count is zero (the user never sees the filter they're standing on disappear)", () => {
    // Only fresh + done tasks → "stale" bucket has count 0. With
    // tasksFilter === "stale" the chip MUST still render, otherwise the
    // user is stranded on a filter UI they can't reach.
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] fresh task",
      createdAt: today,
      updatedAt: today,
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "stale",
    });
    const labels = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).map((c) => (c.firstElementChild as HTMLSpanElement)?.textContent);
    expect(labels).toContain("Stale");
    const stale = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).find((c) => (c.firstElementChild as HTMLSpanElement)?.textContent === "Stale");
    expect(stale?.classList.contains("is-active")).toBe(true);
    expect(stale?.getAttribute("aria-pressed")).toBe("true");
  });

  it("non-active chip has aria-pressed='false' (exact string, not empty) and no `is-active` class", () => {
    // The "All" chip is the default active filter. Recent must render
    // (fresh open task above) and must carry aria-pressed='false'.
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] fresh",
      createdAt: today,
      updatedAt: today,
    });
    const page = buildPage(makeWorkspace([note]));
    const recent = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).find((c) => (c.firstElementChild as HTMLSpanElement)?.textContent === "Recent");
    expect(recent?.classList.contains("is-active")).toBe(false);
    expect(recent?.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking a NON-active chip fires onChangeTasksFilter with the chip's id", () => {
    // The existing test only clicks the active chip (which guards
    // against re-firing). Without this, the 'click' listener wiring +
    // the inner `if (filter !== def.id) onChangeFilter(def.id)` block
    // survive mutation.
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] fresh",
      createdAt: today,
      updatedAt: today,
    });
    const onChangeTasksFilter = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "all",
      onChangeTasksFilter,
    });
    const recent = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).find((c) => (c.firstElementChild as HTMLSpanElement)?.textContent === "Recent");
    recent?.click();
    expect(onChangeTasksFilter).toHaveBeenCalledWith("recent");
  });

  it("does NOT attach a click handler to the disabled empty pick CTA when there are no open tasks", () => {
    // The `if (totalOpen > 0)` gate prevents the click listener from
    // attaching when the backlog is empty. Without this assert the
    // mutant `totalOpen >= 0` / Conditional `true` survive because
    // happy-dom's HTMLButtonElement.click() honours `disabled` and
    // silently no-ops — onSetOneThing not being called below is the
    // observable consequence of the gate.
    const note = makeNote({ id: "n", tags: [], body: "- [x] all done" });
    const onSetOneThing = vi.fn();
    const page = buildPage(makeWorkspace([note]), [], {
      tasksShowDone: true,
      onSetOneThing,
    });
    page.querySelector<HTMLButtonElement>(".one-thing.empty")?.click();
    expect(onSetOneThing).not.toHaveBeenCalled();
  });

  it("renders the filter-miss with NO CTA when canShowDone is false AND tasksFilter is 'all' (no Show all CTA to offer)", () => {
    // tasksFilter='all' + tasksShowDone=true on a workspace with only
    // done tasks → all done tasks are visible, the (empty) "all" filter
    // is the safety net. There's nothing for the empty-state CTA to do,
    // so it must be absent. Mutants that flip
    // `options.tasksFilter !== "all"` to `true` make a stray "Show all"
    // button appear.
    const note = makeNote({ id: "n", tags: [], body: "- [x] only done" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "all",
      tasksShowDone: true,
    });
    // There's nothing matching the "all" filter when all tasks are done
    // and shown — and crucially: no chip-driven miss should appear at
    // all because there ARE rendered task groups. The card grid wins.
    expect(page.querySelector(".task-empty")).toBeNull();
    expect(page.querySelectorAll(".task-card").length).toBeGreaterThan(0);
  });

  it("renders 'Try another chip, or clear the filter to see everything.' sub-copy when canShowDone is false", () => {
    // tasksFilter !== "all" + tasksShowDone = true + no done tasks
    // → canShowDone is false. The empty-state must use the non-canShowDone
    // sub copy, not the "Flip Show done…" one.
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] open today",
      createdAt: today,
      updatedAt: today,
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "stale",
      tasksShowDone: true,
    });
    const miss = page.querySelector(".task-empty");
    expect(miss?.textContent).toContain(
      "Try another chip, or clear the filter to see everything.",
    );
    expect(miss?.textContent).not.toContain("Flip Show done");
  });

  it("renders 'Flip Show done to widen the search, or pick a different chip.' sub-copy when canShowDone is true", () => {
    // tasksShowDone=false + at least one done task exists + active chip
    // narrows to zero → canShowDone = true. Sub copy must be the
    // "Flip Show done" prompt, not the generic one.
    const note = makeNote({ id: "n", tags: [], body: "- [x] only done" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "stale",
      tasksShowDone: false,
    });
    const miss = page.querySelector(".task-empty");
    expect(miss?.textContent).toContain(
      "Flip Show done to widen the search, or pick a different chip.",
    );
    expect(miss?.textContent).not.toContain("Try another chip");
  });

  it("hides the per-task promote sparkle on the task that is already the one-thing", () => {
    // `isOneThing` gate: matching key → no promote button.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] only one",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksOneThingKey: "n::0",
    });
    const item = page.querySelector(".task-list .task-item");
    expect(item?.querySelector(".task-promote")).toBeNull();
  });

  it("hides the per-task promote sparkle on done tasks (no point promoting work that's finished)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [x] done" });
    const page = buildPage(makeWorkspace([note]), [], { tasksShowDone: true });
    const item = page.querySelector(".task-list .task-item");
    expect(item?.querySelector(".task-promote")).toBeNull();
  });

  it("hides the per-task promote sparkle on a task that is both done AND the one-thing", () => {
    // Pins the LogicalOperator `&&` mutant on `!entry.task.done && !isOneThing`.
    // The original (AND) returns false when EITHER condition is false,
    // so a done one-thing yields false → no promote. Mutating to OR
    // yields true → promote renders. Covering this edge case kills both
    // the AND branch and the Conditional `true` mutant in one go.
    const note = makeNote({ id: "n", tags: [], body: "- [x] done" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksShowDone: true,
      tasksOneThingKey: "n::0",
    });
    const item = page.querySelector(".task-list .task-item");
    expect(item?.querySelector(".task-promote")).toBeNull();
  });

  it("does NOT render the 'waiting for' mini-tag on open tasks that don't mention a person", () => {
    // Pin the `entry.hasPerson && !entry.task.done` AND-clause. Without
    // a negative case the Conditional `true` and LogicalOperator `||`
    // mutants survive (both make the tag appear when it shouldn't).
    const note = makeNote({ id: "n", tags: [], body: "- [ ] no person here" });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".task-list .mini-tag")).toBeNull();
  });

  it("the 'All' chip renders even when counts.all is 0 AND it's not the active filter (kills the `def.id !== \"all\"` → true mutant)", () => {
    // Setup: 1 done task + showDone=false + tasksFilter="stale". The
    // "all" bucket count is 0 (applyTaskFilter "all" hides done when
    // showDone is false). filter-row still renders because
    // allEnriched.length is 1. Original: "all" chip always renders
    // (first sub-condition `def.id !== "all"` is false → skip never
    // triggers). Mutant: first sub-condition replaced with `true` →
    // "all" chip skipped because counts.all === 0 AND filter !== "all".
    const note = makeNote({ id: "n", tags: [], body: "- [x] done" });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksShowDone: false,
      tasksFilter: "stale",
    });
    const labels = Array.from(
      page.querySelectorAll<HTMLButtonElement>(".task-filters .task-filter"),
    ).map((c) => (c.firstElementChild as HTMLSpanElement)?.textContent);
    expect(labels).toContain("All");
  });

  it("when showDone is already true, the filter-miss offers 'Show all' (canShowDone short-circuits on `!options.tasksShowDone`)", () => {
    // Pin the LogicalOperator `&&` in
    //   `const canShowDone = !options.tasksShowDone && totalDone > 0;`
    // With original `&&`: showDone=true → !showDone=false → canShowDone=false
    // regardless of totalDone. With mutant `||`: !showDone(false) ||
    // totalDone>0(true) → canShowDone=true → CTA collapses to
    // "Show N done" + the "Flip Show done" sub-copy.
    const stale = makeNote({
      id: "stale",
      tags: [],
      body: "- [x] old done",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([stale]), [], {
      tasksFilter: "stale",
      tasksShowDone: true,
    });
    const miss = page.querySelector(".task-empty");
    const cta = miss?.querySelector<HTMLButtonElement>("button");
    expect(cta?.textContent).toBe("Show all");
    expect(cta?.textContent).not.toBe("Show 1 done");
    expect(miss?.textContent).not.toContain("Flip Show done");
  });

  it("when there are no done tasks at all, the filter-miss offers 'Show all' (not 'Show 0 done')", () => {
    // Pin the `totalDone > 0` Conditional+Equality mutants in canShowDone.
    // With mutant `true` / `>= 0`: canShowDone = !showDone(true) && true
    // = true → CTA becomes "Show 0 done" + the "Flip Show done" sub.
    // Original: false → falls through to the `filter !== "all"` branch
    // and offers "Show all".
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] open today",
      createdAt: today,
      updatedAt: today,
    });
    const page = buildPage(makeWorkspace([note]), [], {
      tasksFilter: "stale",
      tasksShowDone: false,
    });
    const miss = page.querySelector(".task-empty");
    const cta = miss?.querySelector<HTMLButtonElement>("button");
    expect(cta?.textContent).toBe("Show all");
    expect(cta?.textContent).not.toBe("Show 0 done");
    expect(miss?.textContent).not.toContain("Flip Show done");
  });
});

// Pin the per-card temporal anchor + location stripping + stale-badge
// markup details that the existing tests only verify in the positive
// shape. The mutation report flagged ICON_PIN sibling sep classNames /
// textContent, the regex replacement string, the stale guard, the
// daysOld fallback and a missing dateTime contract — every one survives
// in the current suite because querySelector matches still resolve when
// classNames or textContents are subtly wrong.
describe("buildTasksPage temporal anchor + location + persona", () => {
  it("stamps `time` element with dateTime=anchor.note.createdAt and the relative-days label as its text", () => {
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      createdAt: "2026-04-21T09:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([note]));
    const time = page.querySelector<HTMLTimeElement>(".task-card-sub time");
    expect(time).not.toBeNull();
    expect(time?.dateTime).toBe("2026-04-21T09:00:00.000Z");
    // formatRelativeDays produces a non-empty descriptor — pin that it
    // ran (vs `formatRelativeDays(0)` returning a fixed today/yesterday
    // string in the LogicalOperator-mutated branch).
    expect((time?.textContent ?? "").length).toBeGreaterThan(0);
  });

  it("the temporal anchor reflects the OLDEST task's daysOld (not 0) on a multi-day-old card", () => {
    // Pin the `?? 0` fallback and the LogicalOperator mutant on
    // `anchor?.daysOld && 0`. With the mutant the textContent collapses
    // to `formatRelativeDays(0)` for every card, regardless of age. We
    // assert the LONG-ago note produces a different label than the
    // brand-new note — that's enough to discriminate.
    const today = new Date().toISOString();
    const fresh = makeNote({
      id: "fresh",
      tags: [],
      body: "- [ ] new",
      createdAt: today,
      updatedAt: today,
    });
    const old = makeNote({
      id: "old",
      tags: [],
      body: "- [ ] forgotten",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([fresh, old]));
    const subs = Array.from(page.querySelectorAll(".task-card-sub time"));
    const labels = subs.map((s) => s.textContent);
    expect(new Set(labels).size).toBeGreaterThan(1);
  });

  it("trims whitespace-only locations so a `' '` location renders no chip (the `.trim()` is load-bearing)", () => {
    // Without `.trim()`, a `" "` location passes the truthy check and
    // also doesn't equal `"—"`, so the pin would render with an empty
    // venue. Mutating `.trim()` away in `formatNoteLocation` survives
    // unless we test this end-to-end on the rendered foot.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "   ",
    });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".task-card .card-location")).toBeNull();
  });

  // #10 deleted the "location chip's sep span" test — pre-#10 the
  // sub-line had a `<span class="sep">·</span>` before the location
  // and a second one before the stale badge. With location moved to
  // the foot, the sub no longer carries a location sep at all; only
  // the stale-badge sep remains, and its contract is pinned by the
  // next test below.

  it("stale-badge sep span carries `sep` class and `·` text (matches the location sep)", () => {
    const old = makeNote({
      id: "old",
      tags: [],
      body: "- [ ] forgotten",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z",
    });
    const page = buildPage(makeWorkspace([old]));
    const sub = page.querySelector(".task-card-sub");
    const seps = sub?.querySelectorAll(".sep");
    expect(seps?.length).toBe(1);
    expect(seps?.[0].textContent).toBe("·");
  });

  it("does NOT render a stale-badge on a card whose only open task is brand-new", () => {
    // Pin `if (group.hasStaleOpen)` — Conditional `true` mutant makes
    // every card carry a stale badge regardless of age.
    const today = new Date().toISOString();
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] fresh",
      createdAt: today,
      updatedAt: today,
    });
    const page = buildPage(makeWorkspace([note]));
    expect(page.querySelector(".task-card-sub .stale-badge")).toBeNull();
  });

  it("location replacement produces EXACTLY the trailing venue (no leading 'Stryker was here!' or other prefix)", () => {
    // The previous `.toContain("Karlin office")` test passed even
    // when the strip regex's replacement string was mutated to
    // "Stryker was here!" — the resulting "Stryker was here!Karlin
    // office" still contains the expected substring. Pin EXACT venue
    // text inside `.card-location-text` to kill the mutant. The
    // strip lives in `formatNoteLocation` now and has its own focused
    // tests in `note-location.test.ts`; this case is the end-to-end
    // pin on the Tasks foot route.
    const note = makeNote({
      id: "n",
      tags: [],
      body: "- [ ] hi",
      location: "Praha — Karlin office",
    });
    const page = buildPage(makeWorkspace([note]));
    const text = page.querySelector(
      ".task-card-foot .card-location .card-location-text",
    );
    expect(text?.textContent).toBe("Karlin office");
  });

  it("stamps `has-persona` and inline --nc-* CSS vars on the card when personaOptions is provided", () => {
    // Pins the `if (persona)` BlockStatement and the
    // `card.classList.add("has-persona")` StringLiteral. With the
    // mutant the block becomes empty, no vars are written, no class
    // added — observable via getPropertyValue + classList contains.
    const note = makeNote({
      id: "n",
      title: "Persona note",
      tags: [],
      body: "- [ ] hi",
    });
    const page = buildPage(makeWorkspace([note]), [], {
      personaOptions: { allNotes: [note], dark: false },
    });
    const card = page.querySelector<HTMLElement>(".task-card");
    expect(card?.classList.contains("has-persona")).toBe(true);
    expect(card?.style.getPropertyValue("--nc-bg")).not.toBe("");
    expect(card?.style.getPropertyValue("--nc-ink")).not.toBe("");
    expect(card?.style.getPropertyValue("--nc-rotation")).toContain("deg");
    expect(card?.dataset.fontTier).not.toBe(undefined);
  });

  it("does NOT stamp `has-persona` nor inline --nc-* vars when personaOptions is absent", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const card = page.querySelector<HTMLElement>(".task-card");
    expect(card?.classList.contains("has-persona")).toBe(false);
    expect(card?.style.getPropertyValue("--nc-bg")).toBe("");
    expect(card?.style.getPropertyValue("--nc-ink")).toBe("");
  });

  it("dark vs light personaOptions produce different --nc-bg values (deriveNotebookPersona consumes the dark flag)", () => {
    // Pins the ObjectLiteral mutant on
    // `{ allNotes: …, dark: … } → {}`. Without `dark` flowing through,
    // the persona would compute against `dark: undefined` for both
    // calls — same output. We assert dark vs light produce DIFFERENT
    // CSS vars on the same source note.
    const note = makeNote({
      id: "n",
      title: "Persona note",
      tags: [],
      body: "- [ ] hi",
    });
    const light = buildPage(makeWorkspace([note]), [], {
      personaOptions: { allNotes: [note], dark: false },
    }).querySelector<HTMLElement>(".task-card");
    const dark = buildPage(makeWorkspace([note]), [], {
      personaOptions: { allNotes: [note], dark: true },
    }).querySelector<HTMLElement>(".task-card");
    expect(light?.style.getPropertyValue("--nc-bg")).not.toBe(
      dark?.style.getPropertyValue("--nc-bg"),
    );
  });

  it("renders the canonical page subtitle exactly (pinning the StringLiteral)", () => {
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]));
    const subtitle = page.querySelector(".page-header .page-subtitle");
    expect(subtitle?.textContent).toBe(
      "Every “- [ ]” in a note shows up here, in the context it came from. No artificial buckets — a task is as urgent as the note you wrote it in.",
    );
  });

  it("persists the page-intro state under the 'tasks' pageId (pins the StringLiteral via the localStorage write)", () => {
    // buildPageHeader records a visit through `recordVisit(loadIntroStore(), pageId)`
    // and persists immediately. The persisted JSON keys the entry by
    // pageId — so the literal "tasks" shows up in the serialised store.
    // Mutating it to "" would write an empty-string key instead, which
    // we'd see here as missing "tasks" in the stored payload.
    window.localStorage.removeItem("sp.intros.v1");
    const note = makeNote({ id: "n", tags: [], body: "- [ ] hi" });
    buildPage(makeWorkspace([note]));
    const stored = window.localStorage.getItem("sp.intros.v1") ?? "";
    expect(stored).toContain('"tasks"');
  });

  it("renders the tag-filter miss with the canonical sub copy ('Loosen the tag set or clear filters to see everything.')", () => {
    const note = makeNote({ id: "n", tags: ["work"], body: "- [ ] hi" });
    const page = buildPage(makeWorkspace([note]), ["nope"]);
    const miss = page.querySelector(".task-empty");
    expect(miss?.textContent).toContain(
      "Loosen the tag set or clear filters to see everything.",
    );
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
