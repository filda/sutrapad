import {
  detectKind,
  KIND_CHIP_COPY,
  type KindId,
} from "../../../lib/detect-kind";

/**
 * Live-updating kind chip rendered at the top of the detail editor.
 *
 * The chip shows `<icon> <Kind> · <subtitle>` — the kind is derived
 * from the current body+title via `detectKind`, and re-classified on
 * every keystroke by the caller (see editor-card.ts).
 *
 * We do *not* re-build the chip element on each keystroke: the outer
 * render pipeline deliberately skips re-rendering the editor while the
 * user is typing (to preserve textarea caret / IME state). So this
 * module exposes an in-place `setKind` updater that mutates the chip's
 * text content on demand, and callers wire it to the same `input`
 * events that already drive `onTitleInput` / `onBodyInput`.
 *
 * The chip also dual-purposes as a kind-classifier status indicator:
 * the `data-kind` attribute lets CSS tint the chip per-kind (each kind
 * has its own accent hue in the handoff). Callers only touch `setKind`;
 * CSS reads `[data-kind="link"]` etc. directly.
 */

export interface KindChipHandle {
  /** The root chip element — append to the editor DOM. */
  element: HTMLElement;
  /**
   * Re-renders the chip for a new kind value. No-op when the kind
   * hasn't changed since the last call, so the DOM isn't thrashed on
   * every keystroke (only when the user actually crosses a threshold).
   */
  setKind: (kind: KindId) => void;
}

export function buildKindChip(initialKind: KindId): KindChipHandle {
  // Root is a `<div>` (not `<span>`) because CSS styles it as a
  // block-level flex container — using `<span>` would be semantically
  // off and upsets some HTML validators when the chip contains nested
  // inline children styled with flex.
  const chip = document.createElement("div");
  chip.className = "kind-chip";

  const iconEl = document.createElement("span");
  iconEl.className = "kind-chip-icon";
  // Decorative — the label carries the semantic information ("Note",
  // "Link", etc.), so a screen reader announcing the emoji would be
  // pure noise.
  iconEl.setAttribute("aria-hidden", "true");

  const labelEl = document.createElement("span");
  labelEl.className = "kind-chip-label";

  const separator = document.createElement("span");
  separator.className = "kind-chip-sep";
  separator.setAttribute("aria-hidden", "true");
  separator.textContent = "\u00B7"; // middle dot

  const subtitleEl = document.createElement("span");
  subtitleEl.className = "kind-chip-subtitle";

  chip.append(iconEl, labelEl, separator, subtitleEl);

  let lastKind: KindId | null = null;
  const setKind = (kind: KindId): void => {
    if (kind === lastKind) return;
    lastKind = kind;
    const copy = KIND_CHIP_COPY[kind];
    chip.dataset.kind = kind;
    iconEl.textContent = copy.icon;
    labelEl.textContent = copy.label;
    subtitleEl.textContent = copy.subtitle;
  };
  setKind(initialKind);

  return { element: chip, setKind };
}

/**
 * Convenience helper: builds a chip seeded with whatever kind falls out
 * of the current title+body pair. Used by editor-card to avoid the
 * noisy `detectKind(...)` on both the create line and the first
 * live-update line.
 */
export function buildKindChipForNote(
  title: string,
  body: string,
): KindChipHandle {
  return buildKindChip(detectKind({ title, body }));
}
