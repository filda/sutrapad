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
    // Title is an `<h3 class="note-list-title">` since Step 2 of
    // cards-unification (was `<strong>` before).
    const titleEl = item.querySelector(".note-list-title");
    expect(titleEl?.textContent).toBe(malicious);

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
    const excerpt = list.querySelector(".note-list-item .card-excerpt");
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

    const titleEl = list.querySelector(".note-list-item .note-list-title");
    expect(titleEl?.textContent).toBe("Untitled note");

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
    // Step 6: the helper returns null on a whitespace-only body and
    // `buildCardItem` uses `?? "Empty note"` so the card stays
    // visually balanced. Mutating the fallback or skipping it would
    // surface as either an empty `<p>` or the text "null".
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a", body: "   \n\t  " })],
      () => undefined,
    );
    const excerpt = list.querySelector(".note-list-item .card-excerpt");
    expect(excerpt?.textContent).toBe("Empty note");
  });

  it("stamps `card-meta` on the meta wrapper and `note-list-date` on the date element", () => {
    // The meta wrapper class is the Step 5 shared `.card-meta` (was
    // `.note-list-meta` before — see notes-list.ts buildCardItem).
    // The date element keeps its surface-specific class (Notes side
    // uses `.note-list-date`, Links side uses `.link-card-saved`).
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
    );
    expect(list.querySelector(".card-meta")).not.toBeNull();
    expect(list.querySelector(".note-list-date")).not.toBeNull();
  });

  it("renders one `.tag-chip` per non-empty tag in the cards layout", () => {
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
    const chips = Array.from(tagged.querySelectorAll(".tag-chip"));
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
    const chips = Array.from(list.querySelectorAll(".nr-tags .tag-chip"));
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

// Second structural pass — pins the survivors flagged by the 2026-05-16
// focused stryker run on notes-list.ts (76.42 % baseline): cards-only
// thumb/excerpt details, the role="button" + keydown polyfill on the
// `<article>` card, the non-all-done chip branch, the per-card persona
// ObjectLiteral, and the buildRowItem inline-style/className contract
// plus its body sub-text transformations.
describe("buildNotesList — second structural pass", () => {
  it("stamps `role='button'` on the card so AT reads the article as a single-action surface", () => {
    // Pins the StringLiteral on `setAttribute("role", "button")`.
    // Mutating "button" to "" drops the AT semantics.
    const list = buildNotesList("a", [makeNote({ id: "a" })], () => undefined);
    const card = list.querySelector(".note-list-item");
    expect(card?.getAttribute("role")).toBe("button");
  });

  it("pressing Enter on a card fires click + preventDefault", () => {
    // The card is `<article>`, not `<button>`, so the keydown handler
    // polyfills the button keyboard contract: Enter → click +
    // preventDefault (so the page doesn't scroll a stray newline).
    // Without this test the entire keydown BlockStatement, the
    // Enter/Space ConditionalExpression family, and both key
    // StringLiteral mutants stay uncovered.
    const onSelect = vi.fn();
    const list = buildNotesList("a", [makeNote({ id: "a" })], onSelect);
    const card = list.querySelector(".note-list-item") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
      bubbles: true,
    });
    card.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("pressing Space on a card fires click + preventDefault", () => {
    const onSelect = vi.fn();
    const list = buildNotesList("a", [makeNote({ id: "a" })], onSelect);
    const card = list.querySelector(".note-list-item") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: " ",
      cancelable: true,
      bubbles: true,
    });
    card.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("pressing an unrelated key on a card does NOT fire click and does NOT preventDefault", () => {
    // Pins the inner conditional: only Enter/Space trigger the
    // polyfill. Any other key must drop through.
    const onSelect = vi.fn();
    const list = buildNotesList("a", [makeNote({ id: "a" })], onSelect);
    const card = list.querySelector(".note-list-item") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "x",
      cancelable: true,
      bubbles: true,
    });
    card.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders a `.link-thumb` inside each card in cards/no-mode but NOT inside a list-mode row", () => {
    // Pin the `if (resolver !== null)` BlockStatement — cards mode
    // builds a resolver and appends a thumb to every card; list mode
    // passes null and skips the thumb entirely.
    const cardsList = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
    );
    expect(
      cardsList.querySelector(".note-list-item .link-thumb"),
    ).not.toBeNull();

    const listView = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
      "list",
    );
    expect(listView.querySelector(".link-thumb")).toBeNull();
  });

  it("caps the cards excerpt at 72 chars (kills the `{ maxChars: 72 }` → `{}` ObjectLiteral mutant)", () => {
    // buildCardExcerpt's DEFAULT_MAX_CHARS is 160. Notes' 72-char cap
    // is the difference between the single-line Notes ribbon and the
    // multi-line Links/Tasks excerpt. Mutating to `{}` falls back to
    // the default and lets the excerpt overrun the Notes budget.
    const longBody = "a".repeat(200);
    const note = makeNote({ id: "long", body: longBody });
    const list = buildNotesList("long", [note], () => undefined);
    const excerpt = list.querySelector(".note-list-item .card-excerpt");
    expect((excerpt?.textContent ?? "").length).toBeLessThanOrEqual(72);
  });

  it("the task chip does NOT carry `is-all-done` when at least one task is still open", () => {
    // Pin the tone ternary on the chip className. Original only tags
    // all-done chips; mutating the Conditional to `true` would stamp
    // every chip with `is-all-done`.
    const note = makeNote({ id: "mixed", body: "[ ] open\n[x] done" });
    const list = buildNotesList("mixed", [note], () => undefined);
    const chip = list.querySelector(".note-list-tasks");
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains("is-all-done")).toBe(false);
  });

  it("stamps `note-list-tags` className on the cards tags-row wrapper", () => {
    // The existing test only asserts the inner `.tag-chip` elements;
    // mutating the wrapper className to "" leaves the chips queryable
    // but breaks the row container that owns the layout.
    const note = makeNote({ id: "tagged", tags: ["x"] });
    const list = buildNotesList("tagged", [note], () => undefined);
    expect(list.querySelector(".note-list-item .note-list-tags")).not.toBeNull();
  });

  it("persona dark vs light yields different paper inline styles on the card (kills the ObjectLiteral `{}` mutant)", () => {
    // The card threads { allNotes, dark } into `deriveNotebookPersona`.
    // Mutating that ObjectLiteral to `{}` makes both calls derive the
    // same persona (dark=undefined → light fallback), so the cards
    // collide on identical `--nc-bg` values.
    const note = makeNote({ id: "p", title: "Persona note" });
    const lightCard = buildNotesList("p", [note], () => undefined, undefined, {
      allNotes: [note],
      dark: false,
    }).querySelector<HTMLElement>(".note-list-item");
    const darkCard = buildNotesList("p", [note], () => undefined, undefined, {
      allNotes: [note],
      dark: true,
    }).querySelector<HTMLElement>(".note-list-item");
    expect(lightCard?.style.getPropertyValue("--nc-bg")).not.toBe("");
    expect(lightCard?.style.getPropertyValue("--nc-bg")).not.toBe(
      darkCard?.style.getPropertyValue("--nc-bg"),
    );
  });

  it("the row's `has-persona` class is appended only when personaOptions is provided", () => {
    // Pin the empty-other-branch StringLiteral on
    // `${persona ? " has-persona" : ""}` inside buildRowItem.
    // Mutating the empty string to "Stryker was here!" would land
    // garbage class tokens on every non-persona row.
    const note = makeNote({ id: "a" });
    const withoutPersona = buildNotesList(
      "a",
      [note],
      () => undefined,
      "list",
    );
    const rowNoPersona = withoutPersona.querySelector(".notebook-row");
    expect(rowNoPersona?.classList.contains("has-persona")).toBe(false);

    const withPersona = buildNotesList("a", [note], () => undefined, "list", {
      allNotes: [note],
      dark: false,
    });
    const rowWithPersona = withPersona.querySelector(".notebook-row");
    expect(rowWithPersona?.classList.contains("has-persona")).toBe(true);
  });

  it("stamps `aria-hidden='true'` (exact value) on the row swatch", () => {
    // Pin the StringLiteral on `setAttribute("aria-hidden", "true")`.
    // Mutating "true" to "" leaves the attribute present but with
    // an empty value, which AT reads as opt-in (visible to screen
    // readers) — exactly the opposite of the intent.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
      "list",
    );
    const swatch = list.querySelector(".nr-swatch");
    expect(swatch?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stamps `nr-body` className on the row body wrapper", () => {
    // The wrapper carries the title + sub elements; without it the
    // CSS rail layout breaks. Mutating the StringLiteral to "" leaves
    // the inner span elements queryable but the parent un-classed.
    const list = buildNotesList(
      "a",
      [makeNote({ id: "a" })],
      () => undefined,
      "list",
    );
    expect(list.querySelector(".notebook-row .nr-body")).not.toBeNull();
  });

  it("trims leading + trailing whitespace from the row excerpt (`.trim()` is load-bearing)", () => {
    // Pin the `.trim()` call on `note.body.trim().replace(...)`. The
    // MethodExpression mutant drops `.trim()` and only runs the
    // newline-collapse regex, so whitespace at the edges leaks into
    // the rendered sub-text.
    const note = makeNote({
      id: "ws",
      body: "    hello world    ",
    });
    const list = buildNotesList("ws", [note], () => undefined, "list");
    const sub = list.querySelector(".nr-sub");
    expect(sub?.textContent).toBe("hello world");
  });

  it("collapses runs of newlines into a single space in the row excerpt", () => {
    // Pin the `/\n+/g` regex. Mutant `/\n/g` (no `+`) replaces each
    // newline individually, so a `\n\n` gap becomes two spaces, not
    // one. The collapsed-form keeps the sub-text dense.
    const note = makeNote({
      id: "multi-newlines",
      body: "line one\n\n\nline two",
    });
    const list = buildNotesList(
      "multi-newlines",
      [note],
      () => undefined,
      "list",
    );
    const sub = list.querySelector(".nr-sub");
    expect(sub?.textContent).toBe("line one line two");
  });

  it("caps the row sub-text at 140 chars even for long bodies (kills the `.slice(0, 140)` mutant)", () => {
    // Pin the slice on `excerpt.slice(0, 140)`. The MethodExpression
    // mutant drops the slice and lets the full body land on the row,
    // pushing the right-side date off the rail on narrow viewports.
    const longBody = "x".repeat(300);
    const note = makeNote({ id: "long", body: longBody });
    const list = buildNotesList("long", [note], () => undefined, "list");
    const sub = list.querySelector(".nr-sub");
    expect((sub?.textContent ?? "").length).toBeLessThanOrEqual(140);
    expect(sub?.textContent).toBe("x".repeat(140));
  });

  it("omits the `.nr-tags` wrapper entirely when the row note has zero tags", () => {
    // Pin the `if (note.tags.length > 0)` guard. Conditional `true`
    // or EqualityOperator `>= 0` mutants would render the tags-row
    // wrapper as an empty `<div>`, breaking spacing on the row.
    const note = makeNote({ id: "no-tags", tags: [] });
    const list = buildNotesList("no-tags", [note], () => undefined, "list");
    expect(list.querySelector(".notebook-row .nr-tags")).toBeNull();
  });
});
