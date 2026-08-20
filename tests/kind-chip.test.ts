// @vitest-environment happy-dom
//
// First focused test for `src/app/view/shared/kind-chip.ts` — the live kind
// indicator at the top of the detail editor. Small, but with an unusual
// contract that nothing else asserted: it deliberately does **not** rebuild
// itself. The outer render pipeline skips re-rendering the editor while the
// user types (to preserve caret and IME state), so the chip hands back a
// `setKind` updater that mutates its own text in place, and it no-ops when the
// kind has not changed so a keystroke does not thrash the DOM.
//
// That makes three things worth pinning: the initial render, the in-place
// update across a threshold crossing, and the no-op on an unchanged kind —
// plus `data-kind`, which is the only thing the per-kind accent CSS reads.

import { beforeEach, describe, expect, it } from "vitest";
import { buildKindChip, buildKindChipForNote } from "../src/app/view/shared/kind-chip";
import { KIND_CHIP_COPY } from "../src/lib/detect-kind";

const parts = (chip: HTMLElement) => ({
  icon: chip.querySelector(".kind-chip-icon")?.textContent,
  label: chip.querySelector(".kind-chip-label")?.textContent,
  subtitle: chip.querySelector(".kind-chip-subtitle")?.textContent,
  kind: chip.dataset.kind,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildKindChip", () => {
  it("renders icon, label, separator and subtitle for the initial kind", () => {
    const { element } = buildKindChip("link");

    // A div, not a span: CSS styles it as a block-level flex container.
    expect(element.tagName.toLowerCase()).toBe("div");
    expect(element.className).toBe("kind-chip");
    expect(parts(element)).toEqual({
      icon: KIND_CHIP_COPY.link.icon,
      label: "Link",
      subtitle: "Saved URL",
      kind: "link",
    });
  });

  it("keeps the four children in a fixed order", () => {
    const { element } = buildKindChip("note");

    expect([...element.children].map((child) => child.className)).toEqual([
      "kind-chip-icon",
      "kind-chip-label",
      "kind-chip-sep",
      "kind-chip-subtitle",
    ]);
    expect(element.querySelector(".kind-chip-sep")?.textContent).toBe("·");
  });

  it("hides the icon and the separator from screen readers", () => {
    // The label carries the meaning; an announced emoji and middle dot are
    // noise between "Link" and "Saved URL".
    const { element } = buildKindChip("note");

    expect(element.querySelector(".kind-chip-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(element.querySelector(".kind-chip-sep")?.getAttribute("aria-hidden")).toBe("true");
    expect(element.querySelector(".kind-chip-label")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("carries every kind's own copy", () => {
    const rendered = (["note", "link", "links", "tasks", "quote", "longform", "fleeting"] as const).map(
      (kind) => {
        const { element } = buildKindChip(kind);
        const { label, subtitle } = parts(element);
        return `${kind}: ${label} · ${subtitle}`;
      },
    );

    expect(rendered).toEqual([
      "note: Note · Plain text note",
      "link: Link · Saved URL",
      "links: Links · Several URLs",
      "tasks: Tasks · Checklist",
      "quote: Quote · Excerpt",
      "longform: Longform · Reading piece",
      "fleeting: Fleeting · Quick jot",
    ]);
  });
});

describe("buildKindChip setKind", () => {
  it("rewrites the chip in place rather than replacing it", () => {
    // The element identity matters: the editor holds this node across
    // keystrokes precisely so the textarea beside it is never detached.
    const { element, setKind } = buildKindChip("note");
    const icon = element.querySelector(".kind-chip-icon");

    setKind("tasks");

    expect(parts(element)).toEqual({
      icon: KIND_CHIP_COPY.tasks.icon,
      label: "Tasks",
      subtitle: "Checklist",
      kind: "tasks",
    });
    expect(element.querySelector(".kind-chip-icon")).toBe(icon);
  });

  it("does nothing when the kind has not changed", () => {
    // Called on every keystroke; rewriting identical text would thrash the DOM
    // for the 99 % of keystrokes that stay inside one kind. Asserting the text
    // is unchanged would pass either way (the rewrite writes the same string),
    // so the probe is a marker the updater would overwrite if it ran.
    const { element, setKind } = buildKindChip("note");
    const label = element.querySelector(".kind-chip-label");
    if (label) label.textContent = "TOUCHED";

    setKind("note");

    expect(label?.textContent).toBe("TOUCHED");
    expect(element.dataset.kind).toBe("note");
  });

  it("tracks a sequence of threshold crossings", () => {
    const { element, setKind } = buildKindChip("note");
    const seen: Array<string | undefined> = [];

    for (const kind of ["fleeting", "fleeting", "tasks", "note"] as const) {
      setKind(kind);
      seen.push(element.dataset.kind);
    }

    expect(seen).toEqual(["fleeting", "fleeting", "tasks", "note"]);
    expect(parts(element).label).toBe("Note");
  });
});

describe("buildKindChipForNote", () => {
  it("seeds the chip from the note's own text", () => {
    expect(parts(buildKindChipForNote("", "").element).kind).toBe("note");
    expect(parts(buildKindChipForNote("", "https://example.com/a").element).kind).toBe("link");
    expect(
      parts(buildKindChipForNote("", "- [ ] koupit mléko\n- [x] zavolat").element).kind,
    ).toBe("tasks");
  });

  it("returns a chip whose updater still works", () => {
    const { element, setKind } = buildKindChipForNote("", "https://example.com/a");

    setKind("quote");

    expect(parts(element)).toMatchObject({ kind: "quote", label: "Quote" });
  });
});
