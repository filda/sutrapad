import type { NotebookPersona } from "../../../lib/notebook-persona";

export interface PersonaDecorationOptions {
  /**
   * Scales `persona.rotation` before it lands on `--nc-rotation`. The notes
   * list uses the full 1.0 tilt so cards on a grid feel like scattered paper;
   * the home timeline passes `0.5` because the handoff calls for a "calmer"
   * tilt when cards are stacked in a single column.
   */
  rotationFactor?: number;
}

/**
 * Writes the persona's paper palette, fonts, rotation and wear onto an
 * element as CSS custom properties, and mirrors the font tier / patina keys
 * as data-attributes for CSS selector rules. Kept as a pure decorator so a
 * caller can attach persona to any container — a notes-list button, a
 * timeline card — without forking the logic.
 */
export function applyPersonaStyles(
  element: HTMLElement,
  persona: NotebookPersona,
  options: PersonaDecorationOptions = {},
): void {
  const { rotationFactor = 1 } = options;

  element.style.setProperty("--nc-bg", persona.paper.bg);
  element.style.setProperty("--nc-ink", persona.paper.ink);
  if (persona.accent !== null) {
    element.style.setProperty("--nc-accent", persona.accent);
  }
  element.style.setProperty("--nc-title-font", persona.fonts.title);
  element.style.setProperty("--nc-body-font", persona.fonts.body);
  element.style.setProperty(
    "--nc-rotation",
    `${persona.rotation * rotationFactor}deg`,
  );
  element.style.setProperty("--nc-wear", persona.wear.toFixed(3));

  element.dataset.fontTier = persona.fontTier;
  if (persona.patina.length > 0) {
    element.dataset.patina = persona.patina.join(" ");
  }
}

export interface PersonaStickerOptions {
  /**
   * CSS class for the sticker row container. Defaults to the notes-list
   * convention so existing call sites don't have to pass it explicitly.
   */
  rowClassName?: string;
  /**
   * CSS class for each sticker chip. Defaults to the notes-list convention.
   */
  chipClassName?: string;
  /**
   * Cap on how many stickers to render. Matches the notes-list default of
   * showing every sticker the persona produced (itself capped at 3). The home
   * timeline passes `1` so stacked cards stay calm.
   */
  limit?: number;
}

/**
 * Appends a sticker row to the given element. Returns without mutating when
 * the persona has no stickers, so callers don't need to guard beforehand.
 */
export function appendPersonaStickers(
  element: HTMLElement,
  persona: NotebookPersona,
  options: PersonaStickerOptions = {},
): void {
  if (persona.stickers.length === 0) return;

  const {
    rowClassName = "note-list-stickers",
    chipClassName = "note-list-sticker",
    limit = persona.stickers.length,
  } = options;

  const stickers = persona.stickers.slice(0, limit);
  if (stickers.length === 0) return;

  const stickerRow = document.createElement("div");
  stickerRow.className = rowClassName;
  stickerRow.setAttribute("aria-hidden", "true");

  for (const sticker of stickers) {
    const chip = document.createElement("span");
    chip.className = chipClassName;
    chip.dataset.sticker = sticker.kind;
    chip.textContent = sticker.label;
    stickerRow.append(chip);
  }

  element.append(stickerRow);
}
