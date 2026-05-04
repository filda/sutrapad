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

import { afterEach, describe, expect, it, vi } from "vitest";
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
