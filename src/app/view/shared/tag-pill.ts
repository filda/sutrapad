import {
  classifyTag,
  metaForClass,
  parseTagName,
  type TagClassId,
} from "../../logic/tag-class";

/**
 * Shared renderer for the handoff v2 `.tag-pill`. Every place the app shows
 * a tag — editor tag row, topbar filter strip, Tags-page cloud, Notes-page
 * cloud, Home timeline — goes through this helper so class hue, symbol and
 * interaction surface stay in lockstep.
 *
 * The pill encodes three things visually:
 *
 *   1. **Class hue** — lifted from `TAG_CLASSES[classId].hue` and fed into
 *      the `--h` CSS variable, so the whole pill (border / background / text)
 *      picks the right palette tint from a single number.
 *   2. **Class symbol** — a single-char sigil (`#`/`@`/`~`/…) rendered in a
 *      dedicated `.tag-sym` span. Deliberately replaces the emoji namespace
 *      icons we used in v1: the symbol conveys class membership at a glance,
 *      which was the point of the taxonomy in the first place.
 *   3. **Value** — the user-facing text. For namespaced auto-tags we render
 *      just the value (`today`, not `date:today`); the class symbol already
 *      signals "this is time-related" so reprinting the facet reads as noise.
 *
 * Element choice: when the pill is purely display (no interaction) we return
 * a `<span>`. When the pill itself is clickable — toggling a filter, picking
 * a chip from a cloud — we return a `<button>`. When the pill has an inner
 * `×` remove affordance (editor chip, topbar filter chip) we return a
 * `<span>` with an inner `<button class="tag-x">` so the nested button is
 * valid HTML. We never accept both `onClick` and `onRemove` in the same
 * call — no current surface needs it, and mixing the two would muddy the
 * a11y semantics (is clicking the body a filter toggle or a remove?).
 */

export interface TagPillOptions {
  /** Raw tag string. Namespaced auto-tags keep their `facet:` prefix. */
  tag: string;
  /**
   * Authorship. `"user"` always classifies as topic (even if the string
   * happens to contain a colon); `"auto"` routes through `AUTO_FACET_TO_CLASS`
   * in `tag-class.ts`. `undefined` is treated as `"user"` for backwards
   * compatibility with entries persisted before auto-tags existed.
   */
  kind: "user" | "auto" | undefined;
  /** Highlights the pill as selected (deeper hue + shadow). */
  active?: boolean;
  /** Greys the pill out without changing its class. Used by the palette "inactive" rows. */
  muted?: boolean;
  /** Dashed border for low-confidence auto-tags. Off by default. */
  lowConf?: boolean;
  /**
   * Optional counter rendered after the name (`· 12`). Accepts a number or a
   * pre-formatted string (`"· 12"`) — the callers pass the string form because
   * some chips want separator characters (`· `) and some don't.
   */
  count?: number | string;
  /** `lg` = 13.5px / more horizontal padding. Used on the Tags-page cloud. */
  size?: "sm" | "lg";
  /** Set `false` to drop the `.tag-sym` prefix (rarely needed — defaults to true). */
  showSymbol?: boolean;
  /** Whole-pill click handler. Mutually exclusive with `onRemove`. */
  onClick?: () => void;
  /** Inner `×` click handler. Mutually exclusive with `onClick`. */
  onRemove?: () => void;
  /** aria-label for the inner `×` button. Defaults to "Remove". */
  removeAriaLabel?: string;
  /** aria-label override for the whole pill (defaults to the tag string). */
  ariaLabel?: string;
}

/**
 * Small SVG matching the handoff × glyph. Kept inline (rather than a shared
 * icon import) so the helper has zero external dependencies and the markup
 * stays close to the CSS that styles it.
 */
function buildRemoveIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("width", "9");
  svg.setAttribute("height", "9");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 3l6 6M9 3l-6 6");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("fill", "none");
  svg.append(path);
  return svg;
}

export function buildTagPill(options: TagPillOptions): HTMLElement {
  const {
    tag,
    kind,
    active = false,
    muted = false,
    lowConf = false,
    count,
    size = "sm",
    showSymbol = true,
    onClick,
    onRemove,
    removeAriaLabel = "Remove",
    ariaLabel,
  } = options;

  if (onClick && onRemove) {
    // Keeping this honest: no caller needs both, and letting them through
    // would either nest a <button> in a <button> or leave the removal
    // affordance without its own keyboard focus.
    throw new Error("buildTagPill: pass either onClick or onRemove, not both.");
  }

  const classId: TagClassId = classifyTag(tag, kind);
  const meta = metaForClass(classId);
  const displayValue = parseTagName(tag).value || tag;

  // `<button>` when the whole pill is clickable and has no inner button,
  // `<span>` otherwise (display-only or container-for-remove). The branching
  // keeps the HTML valid and native keyboard handling "just works" for the
  // common "click pill to toggle filter" case.
  const usesButtonElement = Boolean(onClick) && !onRemove;
  const pill = document.createElement(usesButtonElement ? "button" : "span");
  if (pill instanceof HTMLButtonElement) pill.type = "button";

  const classTokens = [
    "tag-pill",
    `tag-${classId}`,
    meta.role === "auto" ? "auto" : "user",
  ];
  if (size === "lg") classTokens.push("tag-lg");
  if (active) classTokens.push("active");
  if (lowConf) classTokens.push("low-conf");
  if (muted) classTokens.push("muted");
  if (onRemove) classTokens.push("removable");
  pill.className = classTokens.join(" ");

  pill.style.setProperty("--h", String(meta.hue));
  if (ariaLabel !== undefined) pill.setAttribute("aria-label", ariaLabel);

  if (showSymbol) {
    const sym = document.createElement("span");
    sym.className = "tag-sym";
    sym.setAttribute("aria-hidden", "true");
    sym.textContent = meta.symbol;
    pill.append(sym);
  }

  const name = document.createElement("span");
  name.className = "tag-name";
  name.textContent = displayValue;
  pill.append(name);

  if (count !== undefined) {
    const countEl = document.createElement("span");
    countEl.className = "tag-count mono";
    countEl.textContent =
      typeof count === "number" ? String(count) : count;
    pill.append(countEl);
  }

  if (onClick) {
    pill.addEventListener("click", onClick);
  }

  if (onRemove) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "tag-x";
    removeBtn.setAttribute("aria-label", removeAriaLabel);
    removeBtn.addEventListener("click", (event) => {
      // The remove button is nested inside chips that sometimes sit in
      // clickable contexts (palette row, toolbar). Stopping the bubble keeps
      // removal from accidentally double-firing a parent handler.
      event.stopPropagation();
      onRemove();
    });
    removeBtn.append(buildRemoveIcon());
    pill.append(removeBtn);
  }

  return pill;
}
