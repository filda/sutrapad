// @vitest-environment happy-dom
//
// First focused test for `src/app/view/shared/editor-sidebar.ts` — the right
// rail beside the detail editor. Thin by design (it composes `tag-input` and
// `tag-pill`, both of which have their own suites), so this file only asserts
// what the sidebar itself decides:
//
//   - **the Auto-detected card is conditional.** `buildAutoDetectedCard`
//     returns `null` for a note with no derivable metadata, and the sidebar
//     drops it rather than rendering an eyebrow over an empty grid. That is a
//     branch a smoke test never flips: any note it visits has a `createdAt`,
//     and `date:*` alone is enough to make the card appear — so the *absent*
//     case needs a note whose timestamp is unparseable.
//   - **auto-tags are read-only.** They're derived, not stored, so the pills
//     must not carry a remove ×. A user "removing" one would see it return on
//     the next render, because nothing in `note.tags` changed.
//   - **each pill gets its own facet's confidence.** The card passes
//     `confidenceForAutoTag(tag)` per tag rather than one score for the
//     group, which is what puts the `NN%` badge on `location:*` /
//     `weather:*` and leaves `date:*` clean.
//   - **the card order.** Tags first, Auto-detected second: the editable
//     surface is the one the user came for.
//
// Everything the tag combobox does — filtering, keyboard, the chips — belongs
// to `tests/tag-input.test.ts`; here it is enough to prove the note and the
// two callbacks were handed through unchanged.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEditorSidebar } from "../src/app/view/shared/editor-sidebar";
import { deriveAutoTags } from "../src/lib/auto-tags";
import type { SutraPadDocument, SutraPadTagEntry } from "../src/types";

const SUGGESTIONS: readonly SutraPadTagEntry[] = [
  { tag: "praha", count: 6, noteIds: ["n-9"] },
];

const note = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "tělo",
  urls: [],
  createdAt: "2026-04-21T08:00:00.000Z",
  updatedAt: "2026-04-21T08:00:00.000Z",
  tags: [],
  ...overrides,
});

/**
 * A note whose `createdAt` cannot be parsed, so every date facet bails out.
 * That is the only shape with genuinely zero auto-tags — a valid timestamp
 * always yields at least `date:*` plus `source:*`.
 */
const bareNote = (): SutraPadDocument =>
  note({ createdAt: "not a date", updatedAt: "not a date" });

function mount(currentNote: SutraPadDocument = note()) {
  const onAddTag = vi.fn();
  const onRemoveTag = vi.fn();
  const aside = buildEditorSidebar({
    currentNote,
    availableTagSuggestions: SUGGESTIONS,
    onAddTag,
    onRemoveTag,
  });
  document.body.append(aside);
  return { aside, onAddTag, onRemoveTag };
}

const childClasses = (parent: Element): string[] =>
  [...parent.children].map((child) => child.className);

const autoPills = (aside: HTMLElement): HTMLElement[] => [
  ...aside.querySelectorAll<HTMLElement>(".editor-sidebar-auto-grid .tag-pill"),
];

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildEditorSidebar structure", () => {
  it("renders the two cards as an aside, editable surface first", () => {
    const { aside } = mount();

    expect(aside.tagName.toLowerCase()).toBe("aside");
    expect(aside.className).toBe("editor-sidebar");
    expect([...aside.children].map((child) => child.className)).toEqual([
      "editor-sidebar-card editor-sidebar-tags-card",
      "editor-sidebar-card editor-sidebar-auto-card",
    ]);
    expect([...aside.children].every((child) => child.tagName.toLowerCase() === "section")).toBe(
      true,
    );
  });

  it("labels each card with its own eyebrow", () => {
    const { aside } = mount();

    expect(
      [...aside.querySelectorAll(".editor-sidebar-eyebrow")].map((node) => node.textContent),
    ).toEqual(["Tags", "Auto-detected"]);
  });

  it("puts the eyebrow above its content in both cards", () => {
    const { aside } = mount();

    expect(
      [...aside.querySelectorAll<HTMLElement>(".editor-sidebar-card")].map((card) =>
        childClasses(card),
      ),
    ).toEqual([
        ["editor-sidebar-eyebrow", "tags-field"],
        ["editor-sidebar-eyebrow", "editor-sidebar-auto-grid"],
      ]);
  });
});

describe("buildEditorSidebar tags card", () => {
  it("mounts the tag combobox with the caller's callbacks", () => {
    const { aside, onAddTag } = mount();
    const input = aside.querySelector<HTMLInputElement>(".tag-text-input");

    expect(input?.getAttribute("role")).toBe("combobox");
    expect(input?.getAttribute("aria-label")).toBe("Add tag");

    if (input) input.value = "cesty";
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onAddTag).toHaveBeenCalledWith("cesty");
  });

  it("shows the note's own tags as removable chips", () => {
    // The × belongs to user tags only, and it has to reach the caller's
    // handler — the sidebar has no state of its own to update.
    const { aside, onRemoveTag } = mount(note({ tags: ["praha"] }));
    const chip = aside.querySelector<HTMLElement>(".tags-row .tag-pill");

    expect(chip?.textContent).toContain("praha");
    chip?.querySelector<HTMLButtonElement>(".tag-x")?.click();

    expect(onRemoveTag).toHaveBeenCalledExactlyOnceWith("praha");
  });

  it("keeps the tags card even for a note with nothing on it", () => {
    // Unlike the auto card, this one is unconditional: it is the only way to
    // add the first tag.
    const { aside } = mount(bareNote());

    expect(aside.querySelector(".editor-sidebar-tags-card")).not.toBeNull();
    expect(aside.querySelector(".tag-text-input")).not.toBeNull();
  });
});

describe("buildEditorSidebar auto-detected card", () => {
  it("renders one pill per derived tag, in derivation order", () => {
    const currentNote = note();
    const { aside } = mount(currentNote);

    expect(autoPills(aside).map((pill) => pill.querySelector(".tag-name")?.textContent)).toEqual(
      deriveAutoTags(currentNote).map((tag) => tag.split(":")[1]),
    );
    expect(autoPills(aside).length > 0).toBe(true);
  });

  it("still renders for a note with no metadata at all", () => {
    // The `autoTags.length === 0 → null` guard in the card is unreachable
    // today, and this is why: `deriveAutoTags` emits the `tasks:*` facet
    // unconditionally, so a note with an unparseable timestamp, no capture
    // context and no location still comes back with `tasks:none`. Asserting
    // the invariant here rather than the guard keeps the reason visible — if
    // the tasks facet ever becomes conditional, this test fails and the guard
    // wakes up.
    const { aside } = mount(bareNote());

    expect(deriveAutoTags(bareNote())).toEqual(["tasks:none"]);
    expect(aside.querySelector(".editor-sidebar-auto-card")).not.toBeNull();
    expect(autoPills(aside).map((pill) => pill.querySelector(".tag-name")?.textContent)).toEqual(
      ["none"],
    );
  });

  it("marks the pills as auto rather than user tags", () => {
    const { aside } = mount();

    expect(autoPills(aside).every((pill) => pill.classList.contains("auto"))).toBe(true);
  });

  it("gives auto pills no remove affordance", () => {
    // Auto-tags are derived on every render; a × would appear to work and
    // then the pill would be back a moment later.
    const { aside } = mount();

    expect(aside.querySelectorAll(".editor-sidebar-auto-grid .tag-x")).toHaveLength(0);
  });

  it("badges a low-confidence facet and leaves an authoritative one clean", () => {
    // `confidenceForAutoTag` is looked up per tag, so the two facets in one
    // grid must disagree — a single group-wide score would badge both or
    // neither. `weather:*` sits at 0.6, below the 0.7 display threshold;
    // `date:*` is authoritative at 1.0. (`location:*` is exactly 0.7 and the
    // comparison is strict, so it would badge neither and prove nothing.)
    const { aside } = mount(
      note({
        captureContext: {
          source: "new-note",
          weather: { temperatureC: 22, source: "open-meteo" },
        },
      }),
    );
    const badged = autoPills(aside).map(
      (pill) =>
        `${pill.querySelector(".tag-name")?.textContent}: ${
          pill.querySelector(".tag-conf")?.textContent ?? "—"
        }`,
    );

    expect(badged).toEqual([
      "2026: —",
      "2026-04: —",
      "fresh: —",
      "new-note: —",
      "warm: 60%",
      "none: —",
    ]);
  });

  it("keeps every pill inside the grid, not loose in the card", () => {
    // The grid is what gives the pills their wrap behaviour; loose children
    // of the section stack vertically instead.
    const { aside } = mount();
    const grid = aside.querySelector(".editor-sidebar-auto-grid");

    expect(grid?.tagName.toLowerCase()).toBe("div");
    expect(aside.querySelectorAll(".editor-sidebar-auto-card > .tag-pill")).toHaveLength(0);
    expect((grid?.children.length ?? 0) > 0).toBe(true);
  });
});
