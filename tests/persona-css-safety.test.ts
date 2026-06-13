// @vitest-environment happy-dom
//
// Security regression guard for item 8 of the hardening plan (CSS injection
// sinks). The notebook persona is the only place note-derived data drives
// inline CSS — via the `--nc-*` custom properties in `applyPersonaStyles`.
// Today every CSS-bound persona field comes from a closed-set palette /
// font-stack constant (selected by hashing/bucketing metadata) or a numeric
// primitive, so no attacker-controlled string can reach a CSS value.
//
// This test pins that invariant: a note whose free-text fields are all
// CSS-injection attempts must still produce safe `--nc-*` values. If a future
// change interpolates note text into a CSS custom property (e.g.
// `--nc-accent: ${tag}`), these assertions fail loudly.

import { describe, expect, it } from "vitest";

import type { SutraPadDocument } from "../src/types";
import { deriveNotebookPersona } from "../src/lib/notebook-persona";
import { applyPersonaStyles } from "../src/app/view/shared/persona-decor";

const HOSTILE = 'red;}body{background:url(//evil)}//"';

function hostileNote(): SutraPadDocument {
  return {
    id: "h",
    title: HOSTILE,
    body: `- [ ] ${HOSTILE}`,
    tags: [HOSTILE, "manifesto"],
    urls: [],
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
  };
}

const NC_PROPS = [
  "--nc-bg",
  "--nc-ink",
  "--nc-accent",
  "--nc-title-font",
  "--nc-body-font",
  "--nc-rotation",
  "--nc-wear",
] as const;

describe("persona CSS custom properties never carry note text", () => {
  it("emits only closed-set / numeric values for every --nc-* sink", () => {
    const note = hostileNote();
    const el = document.createElement("div");
    applyPersonaStyles(el, deriveNotebookPersona(note, { allNotes: [note] }));

    for (const prop of NC_PROPS) {
      const value = el.style.getPropertyValue(prop);
      // None of the hostile payload — nor any CSS-breaking character that
      // would let a value escape its declaration — survives.
      expect(value).not.toContain("evil");
      expect(value).not.toContain("url(");
      expect(value).not.toContain("}");
      expect(value).not.toContain(";");
      expect(value).not.toContain('"');
    }

    // Spot-check the shapes: colours are hex, fonts are CSS vars, the
    // numeric props are plain numbers (with a `deg` unit for rotation).
    expect(el.style.getPropertyValue("--nc-bg")).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(el.style.getPropertyValue("--nc-ink")).toMatch(/^#[0-9a-f]{6}$/iu);
    expect(el.style.getPropertyValue("--nc-accent")).toMatch(/^(#[0-9a-f]{6})?$/iu);
    expect(el.style.getPropertyValue("--nc-title-font")).toMatch(/^var\(--[a-z]+\)$/u);
    expect(el.style.getPropertyValue("--nc-body-font")).toMatch(/^var\(--[a-z]+\)$/u);
    expect(el.style.getPropertyValue("--nc-rotation")).toMatch(/^-?\d+(\.\d+)?deg$/u);
    expect(el.style.getPropertyValue("--nc-wear")).toMatch(/^\d+(\.\d+)?$/u);
  });
});
