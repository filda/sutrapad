// @vitest-environment happy-dom
//
// DOM tests for `buildTagInput`'s commit contract — what happens to the
// typed token after Enter / comma / suggestion click. The widget is a
// thin DOM builder over the pure `filterTagSuggestions` helper (covered
// in `tag-suggestions.test.ts`); this suite focuses on the stateful
// commit path that broke once before:
//
//   - When a tag is committed, `input.value` MUST be cleared *before*
//     `onAddTag` runs. The render snapshot in `captureActiveEditorFocus`
//     reads the input value at re-render time and writes it back onto
//     the freshly-built input — so if `addTag` delegates with the typed
//     text still in `input.value`, the user sees their token re-appear
//     next to the just-added chip ("my text didn't get committed").
//
// Capturing the contract at this layer (rather than at the integration
// layer where capture/restore is exercised) keeps the regression test
// fast and DOM-light: any future refactor of the widget that delegates
// without clearing fails here, regardless of how the render pipeline
// reads / restores focus state.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTagInput } from "../src/app/view/shared/tag-input";
import type { SutraPadDocument, SutraPadTagEntry } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "n",
    title: "note",
    body: "",
    tags: [],
    urls: [],
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-01T09:00:00.000Z",
    ...overrides,
  };
}

const SUGGESTIONS: SutraPadTagEntry[] = [
  { tag: "work", noteIds: ["1", "3"], count: 2, kind: "user" },
  { tag: "weekend", noteIds: ["2"], count: 1, kind: "user" },
];

function mount(
  note: SutraPadDocument,
  suggestions: readonly SutraPadTagEntry[] = SUGGESTIONS,
): {
  wrapper: HTMLDivElement;
  input: HTMLInputElement;
  onAddTag: ReturnType<typeof vi.fn>;
  onRemoveTag: ReturnType<typeof vi.fn>;
} {
  const onAddTag = vi.fn();
  const onRemoveTag = vi.fn();
  const wrapper = buildTagInput(note, suggestions, onAddTag, onRemoveTag);
  document.body.append(wrapper);
  const input = wrapper.querySelector<HTMLInputElement>(".tag-text-input");
  if (!input) throw new Error("tag-text-input not rendered");
  return { wrapper, input, onAddTag, onRemoveTag };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildTagInput commit contract", () => {
  it("clears input.value before delegating to onAddTag on Enter with a free-typed value", () => {
    // Regression for the bug where pressing Enter inserted the tag chip
    // but the typed token stayed in the input next to it. The clear has
    // to happen *before* onAddTag so the render-time focus snapshot
    // captures an empty value and doesn't restore the stale token.
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    let valueAtAddCall: string | undefined;
    onAddTag.mockImplementation(() => {
      valueAtAddCall = input.value;
    });

    input.value = "fresh-tag";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onAddTag).toHaveBeenCalledWith("fresh-tag");
    expect(valueAtAddCall).toBe("");
    expect(input.value).toBe("");
  });

  it("clears input.value before delegating when committing a highlighted suggestion via Enter", () => {
    // The original bug surfaced specifically here: typing "wor", seeing
    // the "work" suggestion highlight, pressing Enter — the chip
    // appeared but "wor" stayed behind in the input.
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    let valueAtAddCall: string | undefined;
    onAddTag.mockImplementation(() => {
      valueAtAddCall = input.value;
    });

    input.value = "wor";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onAddTag).toHaveBeenCalledWith("work");
    expect(valueAtAddCall).toBe("");
    expect(input.value).toBe("");
  });

  it("clears input.value before delegating on a comma commit", () => {
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    let valueAtAddCall: string | undefined;
    onAddTag.mockImplementation(() => {
      valueAtAddCall = input.value;
    });

    input.value = "comma-tag";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: ",", bubbles: true }));

    expect(onAddTag).toHaveBeenCalledWith("comma-tag");
    expect(valueAtAddCall).toBe("");
    expect(input.value).toBe("");
  });

  it("clears input.value before delegating when a suggestion is picked via mousedown", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input, onAddTag } = mount(note);

    input.value = "wor";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const option = wrapper.querySelector<HTMLLIElement>(".tag-suggestion");
    if (!option) throw new Error("suggestion option not rendered");

    let valueAtAddCall: string | undefined;
    onAddTag.mockImplementation(() => {
      valueAtAddCall = input.value;
    });

    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(onAddTag).toHaveBeenCalledWith("work");
    expect(valueAtAddCall).toBe("");
    expect(input.value).toBe("");
  });

  it("clears input.value even when the typed tag is already on the note (no delegate fires)", () => {
    // Early-return path: addTag still owns the "I've handled the
    // commit" UX, so the typed text goes away even though no new
    // chip appears. Otherwise the user types an existing tag, hits
    // Enter, and sees nothing happen — they read that as "stuck".
    const note = makeNote({ tags: ["work"] });
    const { input, onAddTag } = mount(note);

    input.value = "work";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onAddTag).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("closes the suggestion list after a commit", () => {
    // Hidden state matters because the suggestions <ul> sits at the
    // wrapper level (not inside the row that renders chips), so a
    // re-render replaces the chip row but keeps the listbox under
    // some code paths. Ensuring the widget closes its own list on
    // commit means the keyboard path doesn't leave a stale dropdown
    // dangling for whatever frame the render takes to re-render us.
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "wor";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("suggestion list not rendered");
    expect(list.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(list.hidden).toBe(true);
  });
});

describe("buildTagInput structural shape", () => {
  // These tests pin the className / aria / element-type contract that the
  // CSS and screen-reader path both rely on. The values look obvious, but
  // the original mutation pass left every StringLiteral here as a survivor
  // because nothing was asserting the exact strings.

  it("wraps the widget in `tags-field` with a `tags-row` child and a `tag-suggestions` listbox sibling", () => {
    const note = makeNote({ tags: [] });
    const { wrapper } = mount(note);

    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toBe("tags-field");

    // Direct children, in order: row first, suggestions list second.
    const children = Array.from(wrapper.children);
    expect(children).toHaveLength(2);
    expect(children[0].tagName).toBe("DIV");
    expect(children[0].className).toBe("tags-row");
    expect(children[1].tagName).toBe("UL");
    expect(children[1].className).toBe("tag-suggestions");
  });

  it("stamps the input with combobox a11y attributes and the canonical placeholder when no tags exist", () => {
    const note = makeNote({ tags: [] });
    const { input } = mount(note);

    expect(input.tagName).toBe("INPUT");
    expect(input.className).toBe("tag-text-input");
    expect(input.type).toBe("text");
    expect(input.getAttribute("aria-label")).toBe("Add tag");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.placeholder).toBe("Add tags…");
  });

  it("clears the placeholder once the note has at least one tag", () => {
    // Pins the `note.tags.length === 0 ? "Add tags…" : ""` ternary. Both
    // branches matter: the empty-tag branch is asserted above, the
    // non-empty branch here. The empty-string survivor is killed by
    // asserting === "".
    const note = makeNote({ tags: ["work"] });
    const { input } = mount(note);
    expect(input.placeholder).toBe("");
  });

  it("starts the suggestions listbox `hidden` with role=listbox", () => {
    const note = makeNote({ tags: [] });
    const { wrapper } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("suggestion list not rendered");
    expect(list.tagName).toBe("UL");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.hidden).toBe(true);
  });

  it("renders a tag-pill chip per note tag in order with `Remove tag <tag>` aria labels", () => {
    const note = makeNote({ tags: ["work", "ideas", "weekend"] });
    const { wrapper } = mount(note);

    // The widget delegates to buildTagPill for each tag, so we just
    // assert the chip's identifying surface — the aria-label on the
    // inner `tag-x` button which we know is the verbatim
    // `Remove tag ${tag}` string.
    const removeButtons = Array.from(
      wrapper.querySelectorAll<HTMLButtonElement>(".tag-x"),
    );
    expect(removeButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove tag work",
      "Remove tag ideas",
      "Remove tag weekend",
    ]);
  });

  it("wires each chip's remove button to onRemoveTag with the chip's tag value", () => {
    const note = makeNote({ tags: ["work", "ideas"] });
    const { wrapper, onRemoveTag } = mount(note);
    const removeButtons = Array.from(
      wrapper.querySelectorAll<HTMLButtonElement>(".tag-x"),
    );
    expect(removeButtons).toHaveLength(2);

    removeButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRemoveTag).toHaveBeenCalledTimes(1);
    expect(onRemoveTag).toHaveBeenCalledWith("ideas");
  });
});

describe("buildTagInput suggestion list rendering", () => {
  it("shows the listbox and flips aria-expanded to `true` when typed input matches a suggestion", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("list not rendered");

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(list.hidden).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders a `tag-suggestion` <li> per match, each with role=option, label and count spans, and the first option carries `is-active` + aria-selected=true", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const options = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    expect(options.length).toBeGreaterThanOrEqual(2);

    options.forEach((option, index) => {
      expect(option.tagName).toBe("LI");
      expect(option.getAttribute("role")).toBe("option");
      const expectedActive = index === 0;
      expect(option.classList.contains("is-active")).toBe(expectedActive);
      // Active option = "tag-suggestion is-active"; inactive = "tag-suggestion".
      // Asserting the full className kills both the trailing-space and the
      // empty-string survivors on the conditional class string.
      expect(option.className).toBe(
        expectedActive ? "tag-suggestion is-active" : "tag-suggestion",
      );
      expect(option.getAttribute("aria-selected")).toBe(
        expectedActive ? "true" : "false",
      );
      const label = option.querySelector<HTMLSpanElement>(".tag-suggestion-label");
      const count = option.querySelector<HTMLSpanElement>(".tag-suggestion-count");
      expect(label?.tagName).toBe("SPAN");
      expect(count?.tagName).toBe("SPAN");
      expect(label?.className).toBe("tag-suggestion-label");
      expect(count?.className).toBe("tag-suggestion-count");
    });

    expect(options[0].querySelector(".tag-suggestion-label")?.textContent).toBe(
      "work",
    );
    expect(options[0].querySelector(".tag-suggestion-count")?.textContent).toBe(
      "2",
    );
    expect(options[1].querySelector(".tag-suggestion-label")?.textContent).toBe(
      "weekend",
    );
    expect(options[1].querySelector(".tag-suggestion-count")?.textContent).toBe(
      "1",
    );
  });

  it("keeps the listbox hidden and aria-expanded=false when the typed input matches nothing", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("list not rendered");

    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(list.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(wrapper.querySelectorAll(".tag-suggestion")).toHaveLength(0);
  });

  it("opens the listbox on focus when there are suggestions", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("list not rendered");

    input.dispatchEvent(new Event("focus", { bubbles: true }));
    // Empty input filters to all suggestions (or whatever
    // `filterTagSuggestions` returns for ""); the contract here is just
    // that focus triggers a render attempt — list ends up not-hidden.
    expect(list.hidden).toBe(false);
  });

  it("rebuilds the option list on every keystroke (no stale rows from earlier filters)", () => {
    // Pins the removeChild loop at L63: a second render must drop the
    // first render's options before appending new ones.
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(wrapper.querySelectorAll(".tag-suggestion").length).toBe(2);

    input.value = "wo";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(wrapper.querySelectorAll(".tag-suggestion").length).toBe(1);
    expect(
      wrapper.querySelector(".tag-suggestion .tag-suggestion-label")?.textContent,
    ).toBe("work");
  });

  it("commits the highlighted suggestion on `mousedown` and prevents default", () => {
    // Already covered in the commit suite, but the existing test doesn't
    // assert preventDefault — the comment on L94 names this explicitly:
    // "Use mousedown so the suggestion is picked before the input's
    // blur fires and closes the dropdown."
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const option = wrapper.querySelector<HTMLLIElement>(".tag-suggestion");
    if (!option) throw new Error("option not rendered");

    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    option.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("moves the highlight on `mouseenter` over a non-active option, syncing `is-active` + aria-selected on every option", () => {
    // Pins the updateHighlight loop body (L110–L117) plus the
    // mouseenter handler at L98. With two options and the first one
    // initially active, hovering the second flips both flags.
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const options = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    expect(options.length).toBeGreaterThanOrEqual(2);

    options[1].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(options[0].classList.contains("is-active")).toBe(false);
    expect(options[0].getAttribute("aria-selected")).toBe("false");
    expect(options[1].classList.contains("is-active")).toBe(true);
    expect(options[1].getAttribute("aria-selected")).toBe("true");
  });
});

describe("buildTagInput keyboard navigation", () => {
  it("ArrowDown opens the listbox when it's closed, without committing anything", () => {
    // Pins the `if (!hasOpenSuggestions) { renderSuggestions(); return; }`
    // branch on L141 — closed-state ArrowDown is a "show me what's
    // available" gesture, not a navigation step.
    const note = makeNote({ tags: [] });
    const { wrapper, input, onAddTag } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("list not rendered");

    expect(list.hidden).toBe(true);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(list.hidden).toBe(false);
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("ArrowDown wraps from the last suggestion back to the first and prevents default while open", () => {
    // Pins the `(highlightedIndex + 1) % currentSuggestions.length` math
    // on L146. With two suggestions the wrap is 0 -> 1 -> 0.
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const ev1 = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev1);
    expect(ev1.defaultPrevented).toBe(true);

    let options = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    expect(options[1].classList.contains("is-active")).toBe(true);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    options = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    expect(options[0].classList.contains("is-active")).toBe(true);
  });

  it("ArrowUp is a no-op when the listbox is closed (no preventDefault, no commit)", () => {
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    const ev = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("ArrowUp wraps from the first suggestion back to the last and prevents default while open", () => {
    // Pins the `(highlightedIndex - 1 + currentSuggestions.length) %
    // currentSuggestions.length` math on L155 — without the
    // `+ currentSuggestions.length` correction the modulo would
    // underflow to -1.
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const ev = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    const options = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    expect(options[options.length - 1].classList.contains("is-active")).toBe(true);
  });

  it("Escape closes the listbox and prevents default while it's open", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("list not rendered");

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(list.hidden).toBe(false);

    const ev = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(list.hidden).toBe(true);
  });

  it("Escape does NOT preventDefault when the listbox is already closed", () => {
    // Pins the `if (hasOpenSuggestions) { e.preventDefault(); ... }`
    // gate at L161 — closed-state Escape must fall through so a parent
    // dialog (or whatever mounts the input) can react to it.
    const note = makeNote({ tags: [] });
    const { input } = mount(note);

    const ev = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Tab with an open suggestion list commits the highlighted entry and prevents default", () => {
    // Pins the `(e.key === "Enter" || e.key === "Tab") &&
    // hasOpenSuggestions` clause at L168 — Tab is a commit only when
    // suggestions are open.
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onAddTag).toHaveBeenCalledWith("work");
  });

  it("Tab with the listbox closed does NOT commit and lets default fall through", () => {
    // Pins the `&& hasOpenSuggestions` half of the same gate — without
    // it, Tab would commit empty input or jump to the L176 "Enter || ,"
    // branch, neither of which we want.
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("ignores keys that aren't part of the contract (no commit, no removal, no preventDefault)", () => {
    // Kills the "every condition becomes true" mutants on L168 / L176 /
    // L182 by exercising a key that should be a complete no-op for
    // this widget — letter input. Real letter typing fires `input`
    // events; the keydown for "x" should not engage any branch.
    const note = makeNote({ tags: ["existing"] });
    const { input, onAddTag, onRemoveTag } = mount(note);
    input.value = "x";

    const ev = new KeyboardEvent("keydown", {
      key: "x",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onAddTag).not.toHaveBeenCalled();
    expect(onRemoveTag).not.toHaveBeenCalled();
  });
});

describe("buildTagInput Backspace removal", () => {
  it("Backspace on an empty input removes the last tag", () => {
    const note = makeNote({ tags: ["work", "ideas", "weekend"] });
    const { input, onRemoveTag } = mount(note);

    input.value = "";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(onRemoveTag).toHaveBeenCalledTimes(1);
    expect(onRemoveTag).toHaveBeenCalledWith("weekend");
  });

  it("Backspace with text in the input does NOT remove a tag", () => {
    // Pins the `input.value === ""` half of the L182 condition — when
    // the user is mid-typing "wee" they should be able to backspace
    // characters without nuking the previous chip.
    const note = makeNote({ tags: ["work"] });
    const { input, onRemoveTag } = mount(note);

    input.value = "we";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(onRemoveTag).not.toHaveBeenCalled();
  });

  it("Backspace on an empty input with no tags is a no-op", () => {
    // Pins the `if (tags.length === 0) return;` early-return at L184.
    const note = makeNote({ tags: [] });
    const { input, onRemoveTag } = mount(note);

    input.value = "";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(onRemoveTag).not.toHaveBeenCalled();
  });
});

describe("buildTagInput addTag normalization + dedup", () => {
  it("trims whitespace and lowercases before checking dedup, so `  WORK  ` matches existing `work`", () => {
    // Pins L121's `value.trim().toLowerCase()` chain — the
    // MethodExpression mutator otherwise survives because the original
    // value is what flows to onAddTag, and the early-return only cares
    // about the normalized form.
    const note = makeNote({ tags: ["work"] });
    const { input, onAddTag } = mount(note);

    input.value = "  WORK  ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onAddTag).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("does NOT delegate when the trimmed input is empty (no whitespace-only tags)", () => {
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onAddTag).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });
});

describe("buildTagInput row click focuses input", () => {
  it("clicking the empty area of the row focuses the input", () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note);
    const row = wrapper.querySelector<HTMLDivElement>(".tags-row");
    if (!row) throw new Error("row not rendered");

    // Synthesise a click whose `target` is the row itself — happy-dom
    // dispatches whatever element you call `dispatchEvent` on as the
    // target, so this matches the `e.target === row` guard at L218.
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).toBe(input);
  });

  it("clicking on a chip inside the row does NOT refocus the input", () => {
    // Pins the `e.target === row` gate — without it, clicking a chip's
    // remove button would steal focus away after the removal handler
    // runs.
    const note = makeNote({ tags: ["work"] });
    const { wrapper, input } = mount(note);
    input.blur();
    expect(document.activeElement).not.toBe(input);

    const removeBtn = wrapper.querySelector<HTMLButtonElement>(".tag-x");
    if (!removeBtn) throw new Error("remove button not rendered");
    removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.activeElement).not.toBe(input);
  });
});

describe("buildTagInput blur path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes addTag with the typed text after the 100ms grace timeout", async () => {
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    input.value = "fresh";
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(onAddTag).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(onAddTag).toHaveBeenCalledWith("fresh");
    expect(input.value).toBe("");
  });

  it("skips the flush when the input has been detached from the DOM before the timer fires", async () => {
    // Pins the `if (!input.isConnected) return;` guard — re-renders
    // detach the old input mid-flight; flushing on the orphan would
    // double-commit the typed text on top of the freshly-built input.
    const note = makeNote({ tags: [] });
    const { wrapper, input, onAddTag } = mount(note);

    input.value = "fresh";
    input.dispatchEvent(new Event("blur", { bubbles: true }));

    wrapper.remove();
    expect(input.isConnected).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("does NOT flush on blur when the input is empty — only closes the listbox", async () => {
    const note = makeNote({ tags: [] });
    const { wrapper, input, onAddTag } = mount(note);
    const list = wrapper.querySelector<HTMLUListElement>(".tag-suggestions");
    if (!list) throw new Error("list not rendered");

    // Open the listbox first.
    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(list.hidden).toBe(false);

    // Blur with an empty input — the trim-falsy branch.
    input.value = "";
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);

    expect(onAddTag).not.toHaveBeenCalled();
    expect(list.hidden).toBe(true);
  });

  it("does NOT flush on blur when the input has only whitespace", async () => {
    // Pins the `input.value.trim()` truthiness guard at L208. Without
    // the trim the whitespace string would commit through and onAddTag
    // would receive "   ".
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    input.value = "   ";
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);

    expect(onAddTag).not.toHaveBeenCalled();
  });
});

// Final cheap-wins describe targeting the four mutants memo singled out
// after the 2026-04-30 pass: scrollIntoView on the active option, the
// 3-suggestion ArrowUp wrap math, and the L168 / L182 conditional-true
// keydown guards. Each test below pairs an open-listbox or populated-
// tags fixture with a key/click event that exercises the negative
// branch — the side the existing 2-suggestion + Backspace-only tests
// don't reach.
describe("buildTagInput cheap-wins second pass", () => {
  it("ArrowUp from index 0 wraps to the LAST option in a 3-suggestion list (kills the `- 1` → `+ 1` Arithmetic mutant)", () => {
    // The existing wrap test uses the 2-item SUGGESTIONS fixture, where
    // `(0 - 1 + 2) % 2 === (0 + 1) % 2 === 1` so the wrap math is
    // symmetric and `- 1` ↔ `+ 1` is observationally identical. A
    // 3-item fixture breaks the symmetry: original lands on index 2,
    // mutant lands on index 1.
    const THREE: SutraPadTagEntry[] = [
      { tag: "alpha", noteIds: ["1"], count: 1, kind: "user" },
      { tag: "alphabet", noteIds: ["2"], count: 1, kind: "user" },
      { tag: "anchor", noteIds: ["3"], count: 1, kind: "user" },
    ];
    const note = makeNote({ tags: [] });
    const { wrapper, input } = mount(note, THREE);

    input.value = "a";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const options = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    expect(options.length).toBe(3);
    // ArrowUp from default highlightedIndex=0.
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    const after = Array.from(
      wrapper.querySelectorAll<HTMLLIElement>(".tag-suggestion"),
    );
    // Original: (0 - 1 + 3) % 3 = 2 → last option active.
    // Mutant:   (0 + 1 + 3) % 3 = 1 → middle option active.
    expect(after[2].classList.contains("is-active")).toBe(true);
    expect(after[1].classList.contains("is-active")).toBe(false);
  });

  it("highlighting a suggestion scrolls only the ACTIVE option into view with `{ block: 'nearest' }`", () => {
    // Pin three L116 mutants on `if (active) option.scrollIntoView({ block: "nearest" })`:
    //   - Conditional `true`: every option in the loop calls scrollIntoView
    //     (would see 2 calls for the 2-suggestion fixture).
    //   - Conditional `false`: no option scrolls.
    //   - ObjectLiteral `{}`: scrollIntoView called with `{}` instead of
    //     `{ block: "nearest" }`.
    const spy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    try {
      const note = makeNote({ tags: [] });
      const { input } = mount(note);

      // Open the listbox (both fixture entries match "w").
      input.value = "w";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // Drop any incidental calls from the initial render.
      spy.mockClear();

      // ArrowDown moves highlightedIndex 0 → 1; updateHighlight loops
      // over both options and only the now-active one scrolls.
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      spy.mockRestore();
    }
  });

  it("a non-Enter/Tab key with the listbox open does NOT commit the highlighted suggestion", () => {
    // Pin the `(e.key === "Enter" || e.key === "Tab") && hasOpenSuggestions`
    // conjunction at L168. Conditional `true` makes the block fire on
    // every key, so any keydown with an open listbox would commit the
    // current highlight via `addTag(currentSuggestions[highlightedIndex].tag)`.
    const note = makeNote({ tags: [] });
    const { input, onAddTag } = mount(note);

    // Open the listbox.
    input.value = "w";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "x",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("a non-Backspace key with a populated input does NOT remove the trailing tag", () => {
    // Pin the `e.key === "Backspace" && input.value === ""` conjunction
    // at L182. Conditional `true` makes the Backspace-removal block
    // fire on every key (and regardless of the typed input), so any
    // keydown would pop the most recent tag.
    const note = makeNote({ tags: ["existing"] });
    const { input, onRemoveTag } = mount(note);

    input.value = "typing";
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "x",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(onRemoveTag).not.toHaveBeenCalled();
  });

  it("a NON-Backspace key with an EMPTY input still leaves the trailing tag in place (kills the inner `e.key === \"Backspace\"` Conditional `true` mutant)", () => {
    // The existing Backspace tests pin the value-empty / value-typed
    // axis but always send Backspace. The sub-conditional Conditional
    // `true` mutant collapses the AND-clause to `if (input.value === "")`
    // — so any keypress with an empty input would trigger the remove.
    // Send a non-Backspace key with an empty input + a tag present.
    const note = makeNote({ tags: ["existing"] });
    const { input, onRemoveTag } = mount(note);
    input.value = "";
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "x",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onRemoveTag).not.toHaveBeenCalled();
  });

  it("blurring with whitespace-only input preserves `input.value` (kills the L208 trim-truthy gate mutants)", () => {
    // L208 `if (input.value.trim())` guards the blur flush — original
    // keeps the input untouched on a whitespace-only blur, addTag
    // never runs. Mutants forcing the guard to `true` (or dropping
    // `.trim()` so the raw truthy string passes) call `addTag("  ")`
    // which inside its own body sets `input.value = ""` *before* it
    // bails on the empty-tag guard. Observable side effect: the
    // whitespace gets cleared. The existing whitespace-blur test only
    // asserts that onAddTag wasn't called, so the input-clearing side
    // effect goes uncaught.
    vi.useFakeTimers();
    try {
      const note = makeNote({ tags: [] });
      const { input, onAddTag } = mount(note);

      input.value = "   ";
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      vi.advanceTimersByTime(100);

      expect(onAddTag).not.toHaveBeenCalled();
      expect(input.value).toBe("   ");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clicking on an existing tag chip (not the row background) does NOT focus the input", () => {
    // Pin `if (e.target === row) input.focus()` at L218. Conditional
    // `true` would focus the input on every click in the row,
    // including chip clicks, which interrupts the chip's `×` remove
    // flow and steals focus on hover / accidental taps.
    const note = makeNote({ tags: ["existing"] });
    const { wrapper, input } = mount(note);

    const focusSpy = vi.spyOn(input, "focus");
    try {
      const chip = wrapper.querySelector(".tag-pill");
      if (!chip) throw new Error("expected a rendered .tag-pill");
      chip.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      expect(focusSpy).not.toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
    }
  });
});
