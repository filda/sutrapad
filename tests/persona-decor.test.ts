// @vitest-environment happy-dom
//
// `persona-decor` is the shared decorator every persona surface funnels
// through — notes list, home timeline, detail stage. It only had transitive
// coverage via `persona-css-safety.test.ts`, which pins CSS-injection safety
// rather than the decorator's own contract: which custom properties land, which
// data-attributes are conditional, and how the sticker row is capped.

import { describe, expect, it } from "vitest";
import {
  appendPersonaStickers,
  applyPersonaStyles,
} from "../src/app/view/shared/persona-decor";
import type {
  NotebookPersona,
  NotebookPersonaPatina,
  NotebookPersonaSticker,
} from "../src/lib/notebook-persona";

function makePersona(overrides: Partial<NotebookPersona> = {}): NotebookPersona {
  return {
    paper: { bg: "#f4efe6", ink: "#2b2a26" },
    paperName: "Morning paper",
    notebookName: "Morning paper",
    accent: null,
    fonts: { title: "Newsreader, serif", body: "Inter Tight, sans-serif" },
    fontTier: "default",
    density: { titlePx: 18, bodyPx: 14, lineHeight: 1.5, padding: 12 },
    rotation: 0.4,
    wear: 0.5,
    stickers: [],
    patina: [],
    ...overrides,
  };
}

const STICKERS: readonly NotebookPersonaSticker[] = [
  { kind: "reading", label: "Reading" },
  { kind: "to-go", label: "To go" },
];

describe("applyPersonaStyles", () => {
  it("writes the paper, font, rotation and wear custom properties", () => {
    const el = document.createElement("div");
    applyPersonaStyles(el, makePersona());

    expect(el.style.getPropertyValue("--nc-bg")).toBe("#f4efe6");
    expect(el.style.getPropertyValue("--nc-ink")).toBe("#2b2a26");
    expect(el.style.getPropertyValue("--nc-title-font")).toBe("Newsreader, serif");
    expect(el.style.getPropertyValue("--nc-body-font")).toBe("Inter Tight, sans-serif");
    // Full tilt by default, three decimals of wear.
    expect(el.style.getPropertyValue("--nc-rotation")).toBe("0.4deg");
    expect(el.style.getPropertyValue("--nc-wear")).toBe("0.500");
    expect(el.dataset.fontTier).toBe("default");
  });

  it("scales the rotation by the caller's factor", () => {
    // The home timeline stacks cards in one column and passes 0.5 so the tilt
    // reads as calm rather than scattered.
    const el = document.createElement("div");
    applyPersonaStyles(el, makePersona({ rotation: 0.8 }), { rotationFactor: 0.5 });
    expect(el.style.getPropertyValue("--nc-rotation")).toBe("0.4deg");
  });

  it("sets `--nc-accent` only when the persona has an accent", () => {
    const withAccent = document.createElement("div");
    applyPersonaStyles(withAccent, makePersona({ accent: "#b4552d" }));
    expect(withAccent.style.getPropertyValue("--nc-accent")).toBe("#b4552d");

    const withoutAccent = document.createElement("div");
    applyPersonaStyles(withoutAccent, makePersona({ accent: null }));
    // Absent, not empty: CSS falls back to its own default when the property
    // was never written, but an empty string would override that fallback.
    expect(withoutAccent.style.getPropertyValue("--nc-accent")).toBe("");
    expect(withoutAccent.getAttribute("style")).not.toContain("--nc-accent");
  });

  it("mirrors a non-empty patina list as a space-separated data attribute", () => {
    const patina: readonly NotebookPersonaPatina[] = ["coffee-ring", "folded-corner"];
    const el = document.createElement("div");
    applyPersonaStyles(el, makePersona({ patina }));
    expect(el.dataset.patina).toBe("coffee-ring folded-corner");
  });

  it("omits the patina attribute entirely for an empty patina list", () => {
    // `data-patina=""` would match CSS attribute selectors like [data-patina],
    // painting decorations on a card the persona said should have none.
    const el = document.createElement("div");
    applyPersonaStyles(el, makePersona({ patina: [] }));
    expect(el.dataset.patina).toBeUndefined();
    expect(Object.hasOwn(el.dataset, "patina")).toBe(false);
  });
});

describe("appendPersonaStickers", () => {
  it("appends one chip per sticker with the notes-list default classes", () => {
    const el = document.createElement("div");
    appendPersonaStickers(el, makePersona({ stickers: STICKERS }));

    const row = el.querySelector("div");
    expect(row?.className).toBe("note-list-stickers");
    // Decorative: the labels duplicate information already in the card text.
    expect(row?.getAttribute("aria-hidden")).toBe("true");

    const chips = Array.from(el.querySelectorAll("span"));
    expect(chips.map((chip) => chip.className)).toEqual([
      "note-list-sticker",
      "note-list-sticker",
    ]);
    expect(chips.map((chip) => chip.dataset.sticker)).toEqual(["reading", "to-go"]);
    expect(chips.map((chip) => chip.textContent)).toEqual(["Reading", "To go"]);
  });

  it("honours caller-supplied class names", () => {
    const el = document.createElement("div");
    appendPersonaStickers(el, makePersona({ stickers: STICKERS }), {
      rowClassName: "home-stickers",
      chipClassName: "home-sticker",
    });
    expect(el.querySelector("div")?.className).toBe("home-stickers");
    expect(el.querySelector("span")?.className).toBe("home-sticker");
  });

  it("caps the row at the caller's limit", () => {
    // The home timeline passes 1 so a stacked column doesn't turn into a
    // sticker wall.
    const el = document.createElement("div");
    appendPersonaStickers(el, makePersona({ stickers: STICKERS }), { limit: 1 });
    const chips = el.querySelectorAll("span");
    expect(chips).toHaveLength(1);
    expect(chips[0].dataset.sticker).toBe("reading");
  });

  it("appends nothing when the limit is zero", () => {
    const el = document.createElement("div");
    appendPersonaStickers(el, makePersona({ stickers: STICKERS }), { limit: 0 });
    expect(el.children).toHaveLength(0);
  });

  it("appends nothing when the persona produced no stickers", () => {
    const el = document.createElement("div");
    appendPersonaStickers(el, makePersona({ stickers: [] }));
    expect(el.children).toHaveLength(0);
  });
});
