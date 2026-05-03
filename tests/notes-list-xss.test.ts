// @vitest-environment happy-dom
//
// Regression tests for the cards-view rendering in `buildNotesList`. The
// rest of the suite runs in the default `node` environment because logic is
// extracted DOM-free; this file is the deliberate exception — the bug we
// guard against (XSS via innerHTML interpolation of `note.title` /
// `note.body`) only manifests when an HTML parser actually runs over the
// produced markup. The per-file `@vitest-environment happy-dom` directive
// keeps that DOM scoped to this single test file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNotesList } from "../src/app/view/shared/notes-list";
import type { SutraPadDocument } from "../src/types";

// happy-dom auto-fetches og-image proxy URLs the moment `buildLinkThumb`
// kicks off its resolver (cards mode and the default no-mode call site
// both go through the resolver). Stub fetch to a fast-settling Response
// so the AsyncTaskManager has nothing pending when the test window
// tears down — keeps stderr quiet around real test failures.
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
  const now = "2026-04-25T10:00:00.000Z";
  return {
    id: "note-1",
    title: "Plain title",
    body: "Plain body",
    urls: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildNotesList — XSS guards", () => {
  it("renders a malicious title as text, never as HTML", () => {
    const malicious = '<img src=x onerror="window.__pwned = true">';
    const note = makeNote({ title: malicious });

    const list = buildNotesList("note-1", [note], () => undefined);
    document.body.append(list);

    // Any HTML interpretation would produce an <img>; textContent must be the literal string.
    expect(list.querySelectorAll("img")).toHaveLength(0);
    const item = list.querySelector(".note-list-item");
    if (item === null) throw new Error("expected .note-list-item");
    const strong = item.querySelector("strong");
    expect(strong?.textContent).toBe(malicious);

    // Belt-and-braces — the global side-effect of the onerror payload must not have fired.
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();

    list.remove();
  });

  it("renders a malicious body excerpt as text, never as HTML", () => {
    const malicious = '<svg/onload="window.__pwned_body = true"></svg>more text';
    const note = makeNote({ body: malicious });

    const list = buildNotesList("note-1", [note], () => undefined);
    document.body.append(list);

    expect(list.querySelectorAll("svg")).toHaveLength(0);
    const excerpt = list.querySelector(".note-list-item p");
    expect(excerpt?.textContent).toBe(malicious.slice(0, 72));

    expect((window as unknown as { __pwned_body?: boolean }).__pwned_body).toBeUndefined();

    list.remove();
  });

  it("renders the task chip aria-label and tone class without HTML interpretation", () => {
    // The legacy template literal also interpolated taskChip.text + ariaLabel into innerHTML.
    // Today's source values are static strings, but a regression that lifted user-controllable
    // counts into the chip would re-introduce the same bug — keep the structural assertion.
    const note = makeNote({ body: "[x] one\n[x] two" });

    const list = buildNotesList("note-1", [note], () => undefined);
    document.body.append(list);

    const chip = list.querySelector(".note-list-tasks");
    if (chip === null) throw new Error("expected .note-list-tasks");
    expect(chip.classList.contains("is-all-done")).toBe(true);
    // Chip is a single text-bearing span with no nested elements.
    expect(chip.children).toHaveLength(0);

    list.remove();
  });

  it("falls back to 'Untitled note' when the title is empty", () => {
    const note = makeNote({ title: "" });

    const list = buildNotesList("note-1", [note], () => undefined);
    document.body.append(list);

    const strong = list.querySelector(".note-list-item strong");
    expect(strong?.textContent).toBe("Untitled note");

    list.remove();
  });
});

describe("buildNotesList — structural rendering", () => {
  // The XSS suite focuses on bytes-as-text; this suite pins the
  // observable className / aria / DOM structure that's not directly
  // about escaping. Every assertion here corresponds to a Stryker
  // mutant that would otherwise survive the `notes-list-xss` tests.

  it("stamps `notes-list` (no view-mode suffix) when viewMode is undefined", () => {
    // Pin the ConditionalExpression on line 48 — `viewMode === undefined`
    // is the toggle between bare `.notes-list` and the suffixed
    // `.notes-list--cards` / `.notes-list--list` variants.
    const list = buildNotesList("a", [makeNote({ id: "a" })], () => undefined);
    expect(list.className).toBe("notes-list");
  });

  it("stamps `notes-list notes-list--cards` when viewMode is 'cards'", () => {
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
      "cards",
    );
    expect(list.className).toBe("notes-list notes-list--cards");
  });

  it("stamps `notes-list notes-list--list` when viewMode is 'list'", () => {
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
      "list",
    );
    expect(list.className).toBe("notes-list notes-list--list");
  });

  it("appends ` notes-list--persona` to the wrapper class only when personaOptions is provided", () => {
    const without = buildNotesList("a", [makeNote({ id: "a" })], () => undefined);
    expect(without.className).not.toContain("notes-list--persona");

    const withPersona = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
      undefined,
      { allNotes: [makeNote({ id: "a" })], dark: false },
    );
    expect(withPersona.className).toContain("notes-list--persona");
  });

  it("renders the empty filter-miss state when notes is empty", () => {
    // Pin the `if (notes.length === 0)` branch (line 52) and the
    // EMPTY_COPY.notes_filtered key. Without coverage the entire
    // BlockStatement on line 52 is uncovered.
    const list = buildNotesList("none", [], () => undefined);
    expect(list.querySelector(".note-list-item")).toBeNull();
    // The empty state's helper text always lives in the rendered DOM —
    // exact text comes from `EMPTY_COPY.notes_filtered`, so any node
    // is enough to prove the empty branch ran.
    expect(list.children.length).toBeGreaterThan(0);
  });

  it("flips `is-active` only on the card whose id matches currentNoteId", () => {
    // Defends the equality check on line 98 — `note.id === currentNoteId`.
    // Mutating to `!==` would invert which card carries `is-active`;
    // mutating the empty-string suffix to "Stryker was here!" would
    // produce nonsense classes on the inactive cards.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" }), makeNote({ id: "b" })],
      () => undefined,
    );
    const items = Array.from(list.querySelectorAll(".note-list-item"));
    expect(items[0].classList.contains("is-active")).toBe(true);
    expect(items[1].classList.contains("is-active")).toBe(false);
  });

  it("delegates click events to the supplied onSelectNote with the clicked note's id", () => {
    // Defends the addEventListener wiring on line 84. `() => undefined`
    // mutant would fire the listener but pass nothing through.
    const onSelect = vi.fn();
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" }), makeNote({ id: "b" })],
      onSelect,
    );
    const items = Array.from(list.querySelectorAll(".note-list-item"));
    (items[1] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("falls back to 'Empty note' for the body excerpt when the note body is whitespace-only", () => {
    // Pin the `||` short-circuit on line 115. Both replacement
    // mutants (`note.body` alone, `""` for the fallback) flow
    // through the same observable: the rendered excerpt text.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a", body: "   \n\t  " })],
      () => undefined,
    );
    const excerpt = list.querySelector(".note-list-item p");
    expect(excerpt?.textContent).toBe("Empty note");
  });

  it("stamps `note-list-meta` on the meta wrapper and `note-list-date` on the date span", () => {
    // Lines 130 / 133 carry the className StringLiterals.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
    );
    expect(list.querySelector(".note-list-meta")).not.toBeNull();
    expect(list.querySelector(".note-list-date")).not.toBeNull();
  });

  it("renders one `.note-list-tag` per non-empty tag in the cards layout", () => {
    // Pin the tags-row branch (line 150-onwards). A workspace with
    // empty tags must NOT render `.note-list-tags`; a workspace with
    // tags must render exactly one chip per tag.
    const empty = buildNotesList(
      "a",
      [makeNote({ id: "a", tags: [] })],
      () => undefined,
    );
    expect(empty.querySelector(".note-list-tags")).toBeNull();

    const tagged = buildNotesList(
      "a",
      [makeNote({ id: "a", tags: ["x", "y", "z"] })],
      () => undefined,
    );
    const chips = Array.from(tagged.querySelectorAll(".note-list-tag"));
    expect(chips.map((c) => c.textContent)).toEqual(["x", "y", "z"]);
  });

  it("renders the row layout (with .nr-swatch / .nr-title / .nr-date) when viewMode is 'list'", () => {
    // The buildRowItem helper is otherwise entirely uncovered.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a", title: "Hello", body: "first line\nsecond line" })],
      () => undefined,
      "list",
    );
    const row = list.querySelector(".notebook-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".nr-swatch")).not.toBeNull();
    expect(row?.querySelector(".nr-title")?.textContent).toBe("Hello");
    expect(row?.querySelector(".nr-sub")?.textContent).toBe(
      "first line second line",
    );
    expect(row?.querySelector(".nr-date")).not.toBeNull();
  });

  it("flips `is-active` only on the matching row in list view, the same way cards do", () => {
    const list = buildNotesList(
      "b",
      [makeNote({ id: "a" }), makeNote({ id: "b" })],
      () => undefined,
      "list",
    );
    const rows = Array.from(list.querySelectorAll(".notebook-row"));
    expect(rows[0].classList.contains("is-active")).toBe(false);
    expect(rows[1].classList.contains("is-active")).toBe(true);
  });

  it("caps row tag chips at four to keep the date visible on narrow rows", () => {
    // The slice(0, 4) on line 213 — one of the ArrayDeclaration
    // survivors. Mutating to `[]` would render no chips at all.
    const list = buildNotesList(
      "a",
      [
        makeNote({
          id: "a",
          tags: ["one", "two", "three", "four", "five", "six"],
        }),
      ],
      () => undefined,
      "list",
    );
    const chips = Array.from(list.querySelectorAll(".nr-tags .note-list-tag"));
    expect(chips.map((c) => c.textContent)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });

  it("omits the row sub-text when the body is whitespace-only (empty excerpt)", () => {
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a", body: "" })],
      () => undefined,
      "list",
    );
    expect(list.querySelector(".nr-sub")).toBeNull();
  });

  it("renders an `is-all-done` task chip with text and aria-label populated from describeTaskChip", () => {
    // Pins the chip's tone-suffix StringLiteral and the textContent
    // assignment. A note with all checkboxes ticked produces the
    // all-done chip.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a", body: "[x] done\n[x] also done" })],
      () => undefined,
    );
    const chip = list.querySelector(".note-list-tasks");
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains("is-all-done")).toBe(true);
    expect(chip?.textContent).not.toBe("");
    expect(chip?.getAttribute("aria-label")).not.toBe("");
  });
});
