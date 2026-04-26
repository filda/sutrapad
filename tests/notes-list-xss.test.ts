// @vitest-environment happy-dom
//
// Regression tests for the cards-view rendering in `buildNotesList`. The
// rest of the suite runs in the default `node` environment because logic is
// extracted DOM-free; this file is the deliberate exception — the bug we
// guard against (XSS via innerHTML interpolation of `note.title` /
// `note.body`) only manifests when an HTML parser actually runs over the
// produced markup. The per-file `@vitest-environment happy-dom` directive
// keeps that DOM scoped to this single test file.

import { describe, expect, it } from "vitest";
import { buildNotesList } from "../src/app/view/shared/notes-list";
import type { SutraPadDocument } from "../src/types";

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
