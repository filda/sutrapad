// @vitest-environment happy-dom
//
// First focused test for `src/app/view/shared/empty-state.ts`. Two builders
// (`buildEmptyScene` full-bleed first-run, `buildEmptyState` inline
// filter-miss) share one illustration set and one copy table, and all three
// were unmeasured — the smoke test renders whichever empty state its fixture
// happens to hit and asserts nothing about it.
//
// What is worth pinning:
//   - the **copy table**. `EMPTY_COPY` is the reason these screens feel warm
//     rather than like an error message, and its `_filtered` / `_done`
//     variants have to keep pointing at the same illustration as their base
//     key (a filter miss on Links must not suddenly show the quill).
//   - the **optional slots**. `sub`, `cta` and `secondary` are each optional,
//     and a handler is optional per button — five independent branches per
//     builder, none of which the smoke test varies.
//   - the **kind → illustration map**, including the two kinds that
//     deliberately share a glyph (`add` and `notes`) and the `default` arm.
//
// The ink path tables themselves are hand-tuned SVG data ported from the
// design handoff. Their string literals are excluded from mutation via a
// `Stryker disable` comment in the source (same treatment `lexicon/stoplist.ts`
// gets from the config): mutating a `d` attribute produces a mutant no
// behavioural test can distinguish from the original without pasting the path
// data into the assertion, which would make the test a copy of the source.
// What *is* asserted here is the structure each kind produces — how many
// primitives and of which element types — so a table that gets truncated,
// re-pointed or emptied still fails.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_COPY,
  buildEmptyInk,
  buildEmptyScene,
  buildEmptyState,
  type EmptyStateKind,
} from "../src/app/view/shared/empty-state";

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Element tag names of the primitives one illustration renders, in order. */
const inkShapes = (kind: EmptyStateKind): string[] =>
  [...buildEmptyInk(kind).children].map((child) => child.tagName.toLowerCase());

describe("buildEmptyScene", () => {
  it("renders the illustration, title and sub-copy", () => {
    const scene = buildEmptyScene({
      kind: "tasks",
      title: "Nothing to do.",
      sub: "Enjoy the silence.",
    });

    expect(scene.tagName.toLowerCase()).toBe("section");
    expect(scene.className).toBe("empty-scene");
    expect(scene.querySelector(".empty-scene-title")?.tagName.toLowerCase()).toBe("h2");
    expect(scene.querySelector(".empty-scene-title")?.textContent).toBe("Nothing to do.");
    expect(scene.querySelector(".empty-scene-sub")?.textContent).toBe("Enjoy the silence.");
    // The large variant gets the 130px glyph.
    const svg = scene.querySelector(".empty-scene-ink svg");
    expect(svg?.getAttribute("width")).toBe("130");
    expect(svg?.getAttribute("height")).toBe("130");
  });

  it("omits the sub paragraph when there is no sub-copy", () => {
    const scene = buildEmptyScene({ kind: "generic", title: "Nothing." });

    expect(scene.querySelector(".empty-scene-sub")).toBeNull();
  });

  it("omits the actions row when neither button is asked for", () => {
    const scene = buildEmptyScene({ kind: "generic", title: "Nothing." });

    expect(scene.querySelector(".empty-scene-actions")).toBeNull();
  });

  it("renders the primary button as the accent one and wires it", () => {
    const onCta = vi.fn();
    const scene = buildEmptyScene({
      kind: "notes",
      title: "No notebooks yet.",
      cta: "Write your first note",
      onCta,
    });
    const button = scene.querySelector<HTMLButtonElement>(".empty-scene-actions button");

    expect(button?.className).toBe("button button-accent");
    expect(button?.textContent).toBe("Write your first note");
    button?.click();
    expect(onCta).toHaveBeenCalledOnce();
  });

  it("renders the secondary button as the ghost one and wires it", () => {
    const onSecondary = vi.fn();
    const scene = buildEmptyScene({
      kind: "notes",
      title: "Nothing here under this filter.",
      secondary: "Clear filter",
      onSecondary,
    });
    const button = scene.querySelector<HTMLButtonElement>(".empty-scene-actions button");

    expect(button?.className).toBe("button button-ghost");
    expect(button?.textContent).toBe("Clear filter");
    button?.click();
    expect(onSecondary).toHaveBeenCalledOnce();
  });

  it("puts the primary button before the secondary one", () => {
    const scene = buildEmptyScene({
      kind: "today",
      title: "A blank morning.",
      cta: "Write something",
      secondary: "Browse captures",
    });

    expect(
      [...scene.querySelectorAll(".empty-scene-actions button")].map(
        (button) => button.className,
      ),
    ).toEqual(["button button-accent", "button button-ghost"]);
  });

  it("still renders a button with no handler attached", () => {
    // Callers are allowed to render a label-only CTA (a page that has not
    // wired its action yet); it must not throw on click.
    const scene = buildEmptyScene({ kind: "today", title: "A blank morning.", cta: "Soon" });
    const button = scene.querySelector<HTMLButtonElement>(".empty-scene-actions button");

    expect(() => button?.click()).not.toThrow();
  });
});

describe("buildEmptyState", () => {
  it("renders the compact inline card with the small glyph", () => {
    const wrapper = buildEmptyState({
      kind: "links",
      title: "No links match.",
      sub: "The filter's too tight.",
    });

    expect(wrapper.tagName.toLowerCase()).toBe("div");
    expect(wrapper.className).toBe("empty-state");
    // An h3, not the scene's h2 — this one sits inside a list.
    expect(wrapper.querySelector("h3")?.textContent).toBe("No links match.");
    expect(wrapper.querySelector("p")?.textContent).toBe("The filter's too tight.");
    const svg = wrapper.querySelector(".empty-glyph svg");
    expect(svg?.getAttribute("width")).toBe("28");
  });

  it("omits the paragraph without sub-copy", () => {
    const wrapper = buildEmptyState({ kind: "generic", title: "Nothing." });

    expect(wrapper.querySelector("p")).toBeNull();
  });

  it("omits the actions row when neither button is asked for", () => {
    const wrapper = buildEmptyState({ kind: "generic", title: "Nothing." });

    expect(wrapper.querySelector(".empty-state-actions")).toBeNull();
  });

  it("wires both buttons, accent before ghost", () => {
    const onCta = vi.fn();
    const onSecondary = vi.fn();
    const wrapper = buildEmptyState({
      kind: "links",
      title: "No links match.",
      cta: "Set up bookmarklet",
      secondary: "Clear filter",
      onCta,
      onSecondary,
    });
    const buttons = [
      ...wrapper.querySelectorAll<HTMLButtonElement>(".empty-state-actions button"),
    ];

    expect(buttons.map((button) => button.className)).toEqual([
      "button button-accent",
      "button button-ghost",
    ]);
    buttons[0].click();
    buttons[1].click();
    expect(onCta).toHaveBeenCalledOnce();
    expect(onSecondary).toHaveBeenCalledOnce();
  });
});

describe("buildEmptyInk", () => {
  it("renders a decorative, unfocusable square SVG", () => {
    const svg = buildEmptyInk("today");

    expect(svg.getAttribute("viewBox")).toBe("0 0 120 120");
    expect(svg.getAttribute("fill")).toBe("none");
    // Decorative: screen readers and the tab order both skip it.
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.classList.contains("empty-ink-svg")).toBe(true);
    expect(svg.classList.contains("empty-ink-today")).toBe(true);
  });

  it("defaults to 120px and honours an explicit size", () => {
    expect(buildEmptyInk("today").getAttribute("width")).toBe("120");
    expect(buildEmptyInk("today", 64).getAttribute("height")).toBe("64");
  });

  it("tags the SVG with the kind so CSS can target one illustration", () => {
    for (const kind of ["today", "links", "tasks", "tags", "capture"] as const) {
      expect(buildEmptyInk(kind).classList.contains(`empty-ink-${kind}`)).toBe(true);
    }
  });

  it("gives every kind its own primitive set", () => {
    // Structure, not path data: a table that gets emptied, truncated or
    // re-pointed at another kind changes these shapes.
    expect(inkShapes("today")).toEqual(["path", "path", "path", "circle", "path"]);
    expect(inkShapes("links")).toEqual(["ellipse", "ellipse", "path", "path"]);
    expect(inkShapes("tasks")).toEqual(["rect", "path", "rect", "rect", "rect", "path"]);
    expect(inkShapes("tags")).toEqual([
      "circle",
      "circle",
      "circle",
      "circle",
      "circle",
      "circle",
      "circle",
      "path",
    ]);
    expect(inkShapes("capture")).toEqual(["path", "path", "path", "path", "path"]);
    expect(inkShapes("generic")).toEqual(["path", "circle"]);
  });

  it("shares the quill-on-page glyph between the add and notes kinds", () => {
    // Two copy variants, one illustration — deliberate, and easy to break by
    // adding a kind to the switch.
    expect(inkShapes("add")).toEqual(inkShapes("notes"));
    expect(inkShapes("notes")).toEqual(["path", "path", "path", "path", "path", "path"]);
  });

  it("falls back to the generic glyph for an unknown kind", () => {
    // The `default` arm; reachable in practice through persisted copy keys
    // from an older build.
    const svg = buildEmptyInk("nonsense" as EmptyStateKind);

    expect([...svg.children].map((child) => child.tagName.toLowerCase())).toEqual([
      "path",
      "circle",
    ]);
  });

  it("draws with the ink palette rather than currentColor", () => {
    // The handoff hard-codes these so the ink-on-paper look reads the same in
    // every theme, including the dark ones.
    const strokes = [...buildEmptyInk("today").children].map((child) =>
      child.getAttribute("stroke"),
    );

    expect(strokes).toContain("#1b1714");
    // The muted grey carries the secondary strokes in every illustration.
    expect(strokes).toContain("#8a7c6c");
    expect([...buildEmptyInk("tags").children].map((c) => c.getAttribute("fill"))).toContain(
      "#c46a3a",
    );
  });
});

describe("EMPTY_COPY", () => {
  it("offers the ten handoff presets", () => {
    expect(Object.keys(EMPTY_COPY)).toEqual([
      "today",
      "add_intro",
      "notes",
      "notes_filtered",
      "links",
      "links_filtered",
      "tasks",
      "tasks_done",
      "tags",
      "capture",
    ]);
  });

  it("keeps each filter-miss variant on its base key's illustration", () => {
    // `notes_filtered` showing the links glyph would read as a different
    // feature failing.
    expect(EMPTY_COPY.notes_filtered.kind).toBe(EMPTY_COPY.notes.kind);
    expect(EMPTY_COPY.links_filtered.kind).toBe(EMPTY_COPY.links.kind);
    expect(EMPTY_COPY.tasks_done.kind).toBe(EMPTY_COPY.tasks.kind);
  });

  it("offers a way out of a filter miss, and nothing to do on a first run without one", () => {
    // The filter-miss variants carry a secondary "Clear filter" and no CTA;
    // the passive first-run states carry neither.
    expect(EMPTY_COPY.notes_filtered.secondary).toBe("Clear filter");
    expect(EMPTY_COPY.links_filtered.secondary).toBe("Clear filter");
    expect(EMPTY_COPY.notes_filtered).not.toHaveProperty("cta");
    expect(EMPTY_COPY.tags).not.toHaveProperty("cta");
    expect(EMPTY_COPY.tasks_done).not.toHaveProperty("cta");
  });

  it("asks for the one action that actually helps, where there is one", () => {
    expect(EMPTY_COPY.notes.cta).toBe("Write your first note");
    expect(EMPTY_COPY.links.cta).toBe("Set up bookmarklet");
    expect(EMPTY_COPY.capture.cta).toBe("Browse sources");
    expect(EMPTY_COPY.today.cta).toBe("Write something");
    expect(EMPTY_COPY.today.secondary).toBe("Browse captures");
  });

  it("gives every preset a title and a kind that has an illustration", () => {
    // Reported as a pair of maps so a failure names the offending key without
    // needing a per-assertion message (which this lint config disallows).
    // Every title is a full sentence — that period is what keeps these
    // screens reading as prose rather than as UI labels.
    expect(
      Object.entries(EMPTY_COPY)
        .filter(([, copy]) => !copy.title.trim().endsWith("."))
        .map(([key]) => key),
    ).toEqual([]);
    expect(
      Object.entries(EMPTY_COPY)
        .filter(([, copy]) => buildEmptyInk(copy.kind).children.length === 0)
        .map(([key]) => key),
    ).toEqual([]);
  });

  it("explains the task syntax in the tasks copy", () => {
    // The only place in the app that tells the user how a task is written.
    expect(EMPTY_COPY.tasks.sub).toContain("[ ]");
  });
});
