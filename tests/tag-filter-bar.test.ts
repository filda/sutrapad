// @vitest-environment happy-dom
//
// First focused test for `src/app/view/chrome/tag-filter-bar.ts` — the topbar
// filter strip with its inline typeahead. 415 lines, and until now the only
// thing executing them was `create-app-smoke.test.ts`, which renders the bar
// once in its default (no filters, never focused) state. Everything
// interesting here is behind a gesture: the dropdown only exists after focus
// or typing, and the keyboard contract documented at the top of the module —
// arrows, Tab preview-then-commit, Backspace chip removal, the three-step
// Escape ladder — has no other coverage at all.
//
// The bar keeps its query and highlight in closure state (deliberately, so a
// re-render flushes them), which means the tests have to drive it exactly like
// a user: dispatch real `input` / `keydown` / `mousedown` / `mouseenter`
// events at the nodes the builder produced, then read the DOM back.
//
// `preventDefault` is asserted through `event.defaultPrevented` wherever the
// contract depends on it — Tab and the arrows have to *not* move focus or the
// caret, and a suggestion `mousedown` must not blur the input before the
// commit lands.
//
// The dead-code group the mutation report used to flag here is gone: the
// `.tfb-empty` / "No tag matches …" branch was **deleted on 2026-08-29**, with
// the `kind: "empty"` variant of `SuggestionRow` and the `.tfb-empty` CSS rule.
// It could never run — `computeRows` only ever produced `kind: "tag"` and
// `kind: "group-label"` rows, and a miss yields `[]`, which the
// `rows.length === 0` branch catches first, so nothing could make
// `rows.every(row => row.kind === "empty")` true with rows present. Ten
// unkillable mutants went with it, and "closes the dropdown when nothing
// matches" below is now the whole story rather than a consolation prize.
//
// One group of survivors that is still not a gap:
//
//   - **Unreachable clamp.** `if (activeIdx >= suggestions.length) activeIdx = 0`
//     (4 mutants). Every path that can raise `activeIdx` — arrows, hover — is
//     bounded by the current `suggestions.length`, and the two paths that
//     re-render with a *different* row count (`input`, Tab preview) both reset
//     `activeIdx = 0` first. `focus` re-renders without resetting, but with the
//     same query and props it produces the same rows. Cheap insurance against a
//     future caller; no fixture can reach it today.
//
// Also equivalent: `if (activeIdx !== hoveredIndex)` in the `mouseenter`
// handler — forcing it true just re-applies the highlight the row already has.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTagFilterBar } from "../src/app/view/chrome/tag-filter-bar";
import type { SutraPadTagEntry } from "../src/types";

const tagEntry = (tag: string, count = 1): SutraPadTagEntry => ({
  tag,
  noteIds: Array.from({ length: count }, (_, index) => `n-${index}`),
  count,
});

/** Count-desc order, the way `buildTagIndex` hands them over. */
const AVAILABLE: SutraPadTagEntry[] = [
  tagEntry("praha", 9),
  tagEntry("prace", 7),
  tagEntry("brno", 5),
  tagEntry("beton", 4),
  tagEntry("cesta", 3),
  tagEntry("dopis", 2),
  tagEntry("ekonomie", 2),
  tagEntry("fotky", 1),
];

interface BarOverrides {
  selectedTagFilters?: readonly string[];
  availableTagSuggestions?: readonly SutraPadTagEntry[];
  recentTagFilters?: readonly string[];
  autoTagLookup?: ReadonlySet<string>;
}

function mount(overrides: BarOverrides = {}) {
  const handlers = {
    onRemoveFilter: vi.fn(),
    onClearFilters: vi.fn(),
    onOpenPalette: vi.fn(),
    onApplyFilter: vi.fn(),
  };
  const bar = buildTagFilterBar({
    selectedTagFilters: overrides.selectedTagFilters ?? [],
    availableTagSuggestions: overrides.availableTagSuggestions ?? AVAILABLE,
    recentTagFilters: overrides.recentTagFilters ?? [],
    autoTagLookup: overrides.autoTagLookup ?? new Set<string>(),
    ...handlers,
  });
  document.body.append(bar);

  const input = bar.querySelector<HTMLInputElement>(".tfb-input");
  if (!input) throw new Error("the bar rendered no input");
  const dropdown = bar.querySelector<HTMLElement>(".tfb-dropdown");
  if (!dropdown) throw new Error("the bar rendered no dropdown");

  /** Types `value` and fires the `input` event the builder listens for. */
  const type = (value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };

  const press = (key: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    input.dispatchEvent(event);
    return event;
  };

  const options = () => [...dropdown.querySelectorAll<HTMLButtonElement>(".tfb-suggest")];
  const optionNames = () =>
    options().map((option) => option.querySelector(".tfb-name")?.textContent);
  const activeName = () =>
    dropdown
      .querySelector<HTMLElement>(".tfb-suggest.is-active")
      ?.querySelector(".tfb-name")?.textContent;
  const groups = () =>
    [...dropdown.querySelectorAll<HTMLElement>(".tfb-group")].map(
      (group) => group.textContent,
    );

  return { bar, input, dropdown, handlers, type, press, options, optionNames, activeName, groups };
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("buildTagFilterBar structure", () => {
  it("renders an inert strip with a placeholder when nothing is filtering", () => {
    const { bar, input, dropdown } = mount();

    expect(bar.className).toBe("tag-filter-bar");
    expect(bar.getAttribute("role")).toBe("group");
    expect(bar.getAttribute("aria-label")).toBe("Active tag filters");
    expect(bar.querySelector(".tfb-icon")?.textContent).toBe("#");
    expect(bar.querySelector(".tfb-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(input.placeholder).toBe("Filter by tag…");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-label")).toBe("Filter by tag");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("type")).toBe("text");
    expect(dropdown.getAttribute("role")).toBe("listbox");
    expect(dropdown.hidden).toBe(true);
    // No filters, no clear affordance.
    expect(bar.querySelector(".tfb-clear")).toBeNull();
  });

  it("marks itself active and drops the placeholder once a filter is on", () => {
    // The placeholder would collide with the chips, so it goes empty rather
    // than staying as ghost text behind them.
    const { bar, input } = mount({ selectedTagFilters: ["praha"] });

    expect(bar.className).toContain("is-active");
    expect(input.placeholder).toBe("");
  });

  it("renders one chip per active filter, in order", () => {
    const { bar } = mount({ selectedTagFilters: ["praha", "brno"] });

    const names = [...bar.querySelectorAll(".tfb-chips .tag-name")].map(
      (node) => node.textContent,
    );
    expect(names).toEqual(["praha", "brno"]);
    // Chips render in their "active" treatment — they *are* the live filters,
    // not suggestions.
    expect(
      [...bar.querySelectorAll(".tfb-chips .tag-pill")].every((pill) =>
        pill.classList.contains("active"),
      ),
    ).toBe(true);
  });

  it("labels each chip's remove button with the tag it drops", () => {
    const { bar, handlers } = mount({ selectedTagFilters: ["praha", "brno"] });
    const removes = [...bar.querySelectorAll<HTMLButtonElement>(".tfb-chips .tag-x")];

    expect(removes.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove filter praha",
      "Remove filter brno",
    ]);

    removes[1].click();
    expect(handlers.onRemoveFilter).toHaveBeenCalledExactlyOnceWith("brno");
  });

  it("marks an auto-derived filter chip differently from a typed one", () => {
    // The chip's class comes from `autoTagLookup`, which the caller passes in
    // rather than the bar re-deriving — crossing the two would show hand-typed
    // tags as machine-generated.
    const { bar } = mount({
      selectedTagFilters: ["place:praha", "vlastni"],
      availableTagSuggestions: [tagEntry("place:praha"), tagEntry("vlastni")],
      autoTagLookup: new Set(["place:praha"]),
    });

    const pills = [...bar.querySelectorAll(".tfb-chips .tag-pill")];
    expect(pills[0].className).not.toBe(pills[1].className);
  });

  it("offers a clear-all button only while something is filtering", () => {
    const { bar, handlers } = mount({ selectedTagFilters: ["praha"] });
    const clear = bar.querySelector<HTMLButtonElement>(".tfb-clear");

    expect(clear?.getAttribute("aria-label")).toBe("Clear all filters");
    expect(clear?.title).toBe("Clear all filters");
    expect(clear?.textContent).toBe("×");

    clear?.click();
    expect(handlers.onClearFilters).toHaveBeenCalledOnce();
  });

  it("exposes the palette hint as a keyboard-reachable button", () => {
    const { bar, handlers } = mount();
    const hint = bar.querySelector<HTMLElement>(".tfb-kbd");

    expect(hint?.textContent).toBe("/");
    expect(hint?.getAttribute("role")).toBe("button");
    expect(hint?.getAttribute("aria-label")).toBe("Open the command palette");
    expect(hint?.title).toBe("Press / to open the command palette");
    expect(hint?.tabIndex).toBe(0);

    hint?.click();
    expect(handlers.onOpenPalette).toHaveBeenCalledOnce();
  });

  it("opens the palette from the hint with Enter and Space", () => {
    const { bar, handlers } = mount();
    const hint = bar.querySelector<HTMLElement>(".tfb-kbd");

    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      hint?.dispatchEvent(event);
      // Space would scroll the page without this.
      expect(event.defaultPrevented).toBe(true);
    }
    expect(handlers.onOpenPalette).toHaveBeenCalledTimes(2);

    hint?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));
    expect(handlers.onOpenPalette).toHaveBeenCalledTimes(2);
  });
});

describe("buildTagFilterBar blank-query dropdown", () => {
  it("groups recents above popular tags on focus", () => {
    const { input, groups, optionNames } = mount({
      recentTagFilters: ["brno", "cesta"],
    });

    input.dispatchEvent(new Event("focus"));

    expect(groups()).toEqual(["Recently used", "Popular tags"]);
    // Recents keep their persisted (newest-first) order; popular follows the
    // index order minus anything already shown as a recent.
    expect(optionNames()).toEqual([
      "brno",
      "cesta",
      "praha",
      "prace",
      "beton",
      "dopis",
      "ekonomie",
      "fotky",
    ]);
  });

  it("commits a tag row, never the group label above it, on Enter", () => {
    // The dropdown mixes `group-label` rows in with the tags; the keyboard
    // handlers index into the *flattened tag* list. If a label leaked into it,
    // Enter would commit a row with no tag at all.
    const { input, press, handlers } = mount({ recentTagFilters: ["brno"] });
    input.dispatchEvent(new Event("focus"));

    press("Enter");

    expect(handlers.onApplyFilter).toHaveBeenCalledExactlyOnceWith("brno");
  });

  it("shows only the popular group when there are no recents", () => {
    const { input, groups } = mount();

    input.dispatchEvent(new Event("focus"));

    expect(groups()).toEqual(["Popular tags"]);
  });

  it("caps recents at five and popular at six", () => {
    // Both pools must exceed their own cap for the cap to be observable: 6
    // recents against a limit of 5, and 14 remaining tags against a limit of
    // 6. A pool that happens to equal the limit can't tell `>=` from `>`.
    const many = Array.from({ length: 20 }, (_, index) => tagEntry(`tag-${index}`, 20 - index));
    const { input, groups, options } = mount({
      availableTagSuggestions: many,
      recentTagFilters: many.slice(14).map((entry) => entry.tag),
    });

    input.dispatchEvent(new Event("focus"));

    expect(groups()).toEqual(["Recently used", "Popular tags"]);
    expect(options()).toHaveLength(11);
    expect(options().slice(0, 5).map((option) => option.querySelector(".tfb-name")?.textContent))
      .toEqual(["tag-14", "tag-15", "tag-16", "tag-17", "tag-18"]);
    expect(options().slice(5).map((option) => option.querySelector(".tfb-name")?.textContent))
      .toEqual(["tag-0", "tag-1", "tag-2", "tag-3", "tag-4", "tag-5"]);
  });

  it("hides tags that are already filtering from both groups", () => {
    const { input, optionNames } = mount({
      selectedTagFilters: ["praha", "brno"],
      recentTagFilters: ["brno", "cesta"],
    });

    input.dispatchEvent(new Event("focus"));

    expect(optionNames()).not.toContain("praha");
    expect(optionNames()).not.toContain("brno");
    expect(optionNames()).toContain("cesta");
  });

  it("skips a recent the tag index no longer knows", () => {
    // Recents are persisted across sessions, so a tag can outlive its notes.
    const { input, optionNames, groups } = mount({
      recentTagFilters: ["smazany"],
    });

    input.dispatchEvent(new Event("focus"));

    expect(optionNames()).not.toContain("smazany");
    expect(groups()).toEqual(["Popular tags"]);
  });

  it("stays shut when the workspace has no tags and no recents", () => {
    const { input, dropdown } = mount({ availableTagSuggestions: [] });

    input.dispatchEvent(new Event("focus"));

    expect(dropdown.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("buildTagFilterBar typed query", () => {
  it("ranks prefix matches ahead of substring matches", () => {
    const { type, optionNames, dropdown, input } = mount();

    type("ce");

    expect(dropdown.hidden).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    // `cesta` starts with the needle; `prace` only contains it, so it sorts
    // behind even though the index lists it first (count 7 vs 3).
    expect(optionNames()).toEqual(["cesta", "prace"]);
  });

  it("shows each suggestion's note count", () => {
    const { type, dropdown } = mount();

    type("praha");

    expect(dropdown.querySelector(".tfb-count")?.textContent).toBe("9");
  });

  it("highlights the first suggestion", () => {
    const { type, options, activeName } = mount();

    type("pra");

    expect(activeName()).toBe("praha");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(options()[1].getAttribute("aria-selected")).toBe("false");
    // Exactly one highlight, and every row is a listbox option.
    expect(options().filter((option) => option.classList.contains("is-active"))).toHaveLength(1);
    expect(options().every((option) => option.getAttribute("role") === "option")).toBe(true);
  });

  it("renders no group labels for a typed query", () => {
    const { type, groups } = mount({ recentTagFilters: ["brno"] });

    type("br");

    expect(groups()).toEqual([]);
  });

  it("closes the dropdown when nothing matches", () => {
    // A miss makes `computeRows` return `[]`, and an empty row set closes the
    // strip rather than announcing the miss. The prototype had a "No tag
    // matches …" row here; it was never reachable and was deleted, so this is
    // the whole behaviour. `aria-expanded` has to come back to "false" with
    // it — a combobox that stays expanded over an empty listbox is what a
    // screen reader would read as "suggestions available".
    const { type, dropdown, input, options } = mount();

    type("qqq");

    expect(dropdown.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(dropdown.childElementCount).toBe(0);
    expect(options()).toEqual([]);
  });

  it("falls back to the blank-query groups when the query is cleared", () => {
    const { type, groups } = mount({ recentTagFilters: ["brno"] });
    type("pra");
    expect(groups()).toEqual([]);

    type("");

    expect(groups()).toEqual(["Recently used", "Popular tags"]);
  });

  it("treats a whitespace-only query as blank", () => {
    // `input.value.trim()` decides which branch runs; without the trim a space
    // would go to the ranker and match every tag as a substring.
    const { type, groups } = mount({ recentTagFilters: ["brno"] });

    type("   ");

    expect(groups()).toEqual(["Recently used", "Popular tags"]);
  });
});

describe("buildTagFilterBar pointer commits", () => {
  it("commits on mousedown, before the blur can close the dropdown", () => {
    const { type, options, handlers } = mount();
    type("pra");

    const event = new MouseEvent("mousedown", { cancelable: true, bubbles: true });
    options()[1].dispatchEvent(event);

    expect(handlers.onApplyFilter).toHaveBeenCalledExactlyOnceWith("prace");
    // Without preventDefault the input blurs first and the click lands on a
    // dropdown that is already being torn down.
    expect(event.defaultPrevented).toBe(true);
  });

  it("moves the highlight to the hovered suggestion", () => {
    const { type, options, activeName } = mount();
    type("pra");

    options()[1].dispatchEvent(new MouseEvent("mouseenter"));

    expect(activeName()).toBe("prace");
    expect(options()[0].getAttribute("aria-selected")).toBe("false");
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("commits the hovered suggestion when Enter follows the hover", () => {
    const { type, options, press, handlers } = mount();
    type("pra");
    options()[1].dispatchEvent(new MouseEvent("mouseenter"));

    press("Enter");

    expect(handlers.onApplyFilter).toHaveBeenCalledExactlyOnceWith("prace");
  });

  it("leaves the highlight alone when the hover lands on it again", () => {
    const { type, options, activeName } = mount();
    type("pra");

    options()[0].dispatchEvent(new MouseEvent("mouseenter"));

    expect(activeName()).toBe("praha");
  });
});

describe("buildTagFilterBar keyboard contract", () => {
  it("cycles down through the suggestions and wraps", () => {
    const { type, press, activeName, optionNames } = mount();
    type("a"); // praha, prace, cesta — three rows, so a wrap is visible
    expect(optionNames()).toEqual(["praha", "prace", "cesta"]);

    press("ArrowDown");
    expect(activeName()).toBe("prace");
    press("ArrowDown");
    expect(activeName()).toBe("cesta");
    press("ArrowDown");
    expect(activeName()).toBe("praha");
  });

  it("cycles up from the first suggestion to the last", () => {
    const { type, press, activeName } = mount();
    type("a");

    press("ArrowUp");

    expect(activeName()).toBe("cesta");
  });

  it("swallows the arrow keys so the caret does not move", () => {
    const { type, press } = mount();
    type("pra");

    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(press("ArrowUp").defaultPrevented).toBe(true);
  });

  it("lets the arrows through when there is nothing to cycle", () => {
    const { type, press } = mount();
    type("qqq");

    expect(press("ArrowDown").defaultPrevented).toBe(false);
    expect(press("ArrowUp").defaultPrevented).toBe(false);
  });

  it("commits the highlighted suggestion on Enter", () => {
    const { type, press, handlers } = mount();
    type("pra");

    const event = press("Enter");

    expect(handlers.onApplyFilter).toHaveBeenCalledExactlyOnceWith("praha");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing on Enter with no suggestions", () => {
    const { type, press, handlers } = mount();
    type("qqq");

    const event = press("Enter");

    expect(handlers.onApplyFilter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("previews on the first Tab and commits on the second", () => {
    const { input, type, press, handlers, activeName } = mount();
    type("pra");

    const preview = press("Tab");
    expect(preview.defaultPrevented).toBe(true);
    expect(input.value).toBe("praha");
    expect(handlers.onApplyFilter).not.toHaveBeenCalled();
    // The preview re-ranks against the filled-in value and re-highlights row 0.
    expect(activeName()).toBe("praha");

    const commit = press("Tab");
    expect(commit.defaultPrevented).toBe(true);
    expect(handlers.onApplyFilter).toHaveBeenCalledExactlyOnceWith("praha");
  });

  it("re-ranks the dropdown against the filled-in value on preview", () => {
    // The preview writes the completion into the input, and the dropdown has to
    // follow: leave it showing the old, broader row set and the second Tab
    // commits against a stale `suggestions` array. "pr" matches both praha and
    // prace, so the narrowing is visible; the existing preview test can't see
    // it because praha is row 0 either way.
    const { type, press, optionNames } = mount();
    type("pr");
    expect(optionNames()).toEqual(["praha", "prace"]);

    press("Tab");

    expect(optionNames()).toEqual(["praha"]);
  });

  it("lets Tab move focus when the input is empty", () => {
    const { press, handlers } = mount();

    const event = press("Tab");

    expect(event.defaultPrevented).toBe(false);
    expect(handlers.onApplyFilter).not.toHaveBeenCalled();
  });

  it("lets Tab move focus when nothing matches", () => {
    const { type, press } = mount();
    type("qqq");

    expect(press("Tab").defaultPrevented).toBe(false);
  });

  it("drops the last chip on Backspace in an empty input", () => {
    // Three chips on purpose: with two, `at(-1)` and `at(1)` are the same
    // element, so an off-by-one in the index would pass.
    const { press, handlers } = mount({ selectedTagFilters: ["praha", "brno", "cesta"] });

    const event = press("Backspace");

    expect(handlers.onRemoveFilter).toHaveBeenCalledExactlyOnceWith("cesta");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the chips alone when Backspace has text to delete", () => {
    const { type, press, handlers } = mount({ selectedTagFilters: ["praha"] });
    type("br");

    const event = press("Backspace");

    expect(handlers.onRemoveFilter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing on Backspace with no chips to drop", () => {
    const { press, handlers } = mount();

    const event = press("Backspace");

    expect(handlers.onRemoveFilter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("walks the three Escape steps: close, clear query, clear filters", () => {
    const { input, type, press, dropdown, handlers } = mount({
      selectedTagFilters: ["praha"],
    });
    type("br");
    expect(dropdown.hidden).toBe(false);

    const close = press("Escape");
    expect(close.defaultPrevented).toBe(true);
    expect(dropdown.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.value).toBe("br");
    expect(handlers.onClearFilters).not.toHaveBeenCalled();

    const clearQuery = press("Escape");
    expect(clearQuery.defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(handlers.onClearFilters).not.toHaveBeenCalled();

    const clearFilters = press("Escape");
    expect(clearFilters.defaultPrevented).toBe(true);
    expect(handlers.onClearFilters).toHaveBeenCalledOnce();
  });

  it("stops after clearing the query when nothing is filtering", () => {
    const { input, type, press, handlers } = mount();
    type("br");
    press("Escape"); // closes the dropdown
    press("Escape"); // clears the query

    const spare = press("Escape");

    expect(input.value).toBe("");
    expect(handlers.onClearFilters).not.toHaveBeenCalled();
    expect(spare.defaultPrevented).toBe(false);
  });

  it("ignores keys it does not own", () => {
    const { type, press, handlers, activeName } = mount({ selectedTagFilters: ["brno"] });
    type("a");

    const event = press("F2");

    expect(event.defaultPrevented).toBe(false);
    expect(activeName()).toBe("praha");
    expect(handlers.onApplyFilter).not.toHaveBeenCalled();
    expect(handlers.onRemoveFilter).not.toHaveBeenCalled();
    expect(handlers.onClearFilters).not.toHaveBeenCalled();
  });
});

describe("buildTagFilterBar blur", () => {
  it("closes the dropdown after the mousedown grace period", () => {
    vi.useFakeTimers();
    const { input, dropdown, type } = mount();
    type("pra");
    expect(dropdown.hidden).toBe(false);

    input.dispatchEvent(new Event("blur"));
    // Still open: a mousedown on a suggestion has to land first.
    expect(dropdown.hidden).toBe(false);

    vi.advanceTimersByTime(100);

    expect(dropdown.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves a detached bar alone when the timer fires after a re-render", () => {
    // The app rebuilds the topbar on every render, so the timer can outlive
    // the node it captured. Touching it then would resurrect state on a bar
    // nobody can see.
    vi.useFakeTimers();
    const { bar, input, dropdown, type } = mount();
    type("pra");

    input.dispatchEvent(new Event("blur"));
    bar.remove();
    vi.advanceTimersByTime(100);

    expect(dropdown.hidden).toBe(false);
  });
});
