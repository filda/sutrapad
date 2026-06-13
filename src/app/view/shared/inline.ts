/**
 * Inline text-fragment builders for prose that mixes plain copy with a few
 * `<kbd>` / `<strong>` accents (Capture install steps today).
 *
 * Replaces small `innerHTML` string templates: callers compose an array of
 * `Node`s instead of an HTML string, so dynamic values can only ever land
 * as text. `text()` wraps its argument in a text node, never the HTML
 * parser — the same no-parser invariant the icon and page-title builders
 * follow.
 */

/** A plain text node. Any dynamic value is rendered verbatim, never parsed. */
export function text(value: string): Text {
  return document.createTextNode(value);
}

/** A `<kbd class="kbd">` keycap whose label is set via `textContent`. */
export function kbd(label: string): HTMLElement {
  const el = document.createElement("kbd");
  el.className = "kbd";
  el.textContent = label;
  return el;
}

/** A `<strong>` emphasis whose text is set via `textContent`. */
export function strong(value: string): HTMLElement {
  const el = document.createElement("strong");
  el.textContent = value;
  return el;
}
