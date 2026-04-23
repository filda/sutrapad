import { LOW_CONFIDENCE_THRESHOLD } from "../../logic/auto-tag-confidence";
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
  /**
   * Dashed border for low-confidence auto-tags. Off by default. Setting
   * `confidence` below `LOW_CONFIDENCE_THRESHOLD` implicitly turns this on,
   * so callers normally pass `confidence` and let the helper decide; pass
   * `lowConf: true` directly when you want the visual treatment without
   * committing to a numeric score (e.g. stand-in pills in the graveyard).
   */
  lowConf?: boolean;
  /**
   * Confidence score for an auto-derived tag (0..1). When the pill
   * classifies as an auto class and the score is below
   * `LOW_CONFIDENCE_THRESHOLD`, the pill renders a small `NN%` badge after
   * the name and auto-applies the `low-conf` treatment. Ignored on
   * user-authored (topic) pills — those are always 1.0 by definition.
   */
  confidence?: number;
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
 * Builds the small `NN%` badge rendered on low-confidence auto pills. Split
 * out so `buildTagPill` stays under the complexity budget; everything that
 * knows about percentage formatting and the aria label lives here.
 */
function buildConfidenceBadge(confidence: number): HTMLSpanElement {
  const percent = Math.round(confidence * 100);
  const badge = document.createElement("span");
  badge.className = "tag-conf mono";
  badge.textContent = `${percent}%`;
  badge.setAttribute("aria-label", `confidence ${percent} percent`);
  return badge;
}

/**
 * Builds the inner `×` remove affordance. Factored out (alongside the icon
 * SVG below) so the main pill builder reads as a straight-line sequence of
 * appends rather than nested branches.
 */
function buildRemoveButton(
  onRemove: () => void,
  ariaLabel: string,
): HTMLButtonElement {
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "tag-x";
  removeBtn.setAttribute("aria-label", ariaLabel);
  removeBtn.addEventListener("click", (event) => {
    // The remove button is nested inside chips that sometimes sit in
    // clickable contexts (palette row, toolbar). Stopping the bubble keeps
    // removal from accidentally double-firing a parent handler.
    event.stopPropagation();
    onRemove();
  });
  removeBtn.append(buildRemoveIcon());
  return removeBtn;
}

/**
 * Decides whether a pill should flip into the low-confidence display state —
 * dashed border plus a `NN%` badge. Only auto-role pills are eligible: user-
 * authored tags are authoritative by definition, so even if a caller passes
 * a numeric `confidence` for a topic tag it's ignored here.
 */
function shouldShowConfidenceBadge(
  role: "auto" | "user",
  confidence: number | undefined,
): boolean {
  if (role !== "auto") return false;
  if (typeof confidence !== "number") return false;
  return confidence < LOW_CONFIDENCE_THRESHOLD;
}

/**
 * Creates the right host element — `<button>` when the whole pill is the
 * interactive surface, `<span>` when it's either display-only or the outer
 * wrapper for a nested remove button. Wrapping the element+type-set in a
 * helper keeps the conditional out of `buildTagPill`'s top-level flow.
 */
function createPillHost(useButton: boolean): HTMLElement {
  if (useButton) {
    const btn = document.createElement("button");
    btn.type = "button";
    return btn;
  }
  return document.createElement("span");
}

/**
 * Assembles the pill's class list. All the modifier decisions (size, active,
 * low-conf, muted, removable) live here so `buildTagPill` can stay focused on
 * the DOM shape — pushing the branches down keeps the caller's cyclomatic
 * budget sane.
 */
function buildPillClassName(options: {
  classId: TagClassId;
  role: "auto" | "user";
  size: "sm" | "lg";
  active: boolean;
  lowConf: boolean;
  muted: boolean;
  removable: boolean;
}): string {
  const tokens = ["tag-pill", `tag-${options.classId}`, options.role];
  if (options.size === "lg") tokens.push("tag-lg");
  if (options.active) tokens.push("active");
  if (options.lowConf) tokens.push("low-conf");
  if (options.muted) tokens.push("muted");
  if (options.removable) tokens.push("removable");
  return tokens.join(" ");
}

/**
 * Renders the optional class-symbol prefix (`#`/`@`/`~`/…). Pulled out so the
 * main builder body is a flat sequence of `pill.append(...)` calls rather
 * than an inline createElement+setAttribute block.
 */
function buildSymbolSpan(symbol: string): HTMLSpanElement {
  const sym = document.createElement("span");
  sym.className = "tag-sym";
  sym.setAttribute("aria-hidden", "true");
  sym.textContent = symbol;
  return sym;
}

/**
 * Renders the "12" / "· 12" count tail. Accepts either a number (stringified
 * as-is) or a pre-formatted string from callers that want a separator glyph.
 */
function buildCountSpan(count: number | string): HTMLSpanElement {
  const countEl = document.createElement("span");
  countEl.className = "tag-count mono";
  countEl.textContent = typeof count === "number" ? String(count) : count;
  return countEl;
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
    confidence,
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

  // The threshold check gates both the dashed-border treatment and the
  // `NN%` badge so a pill never shows the badge without the border, or vice
  // versa. `effectiveLowConf` also respects an explicit `lowConf: true` from
  // callers that want the dashed border without committing to a score.
  const role: "auto" | "user" = meta.role === "auto" ? "auto" : "user";
  const showConfidenceBadge = shouldShowConfidenceBadge(role, confidence);
  const effectiveLowConf = lowConf || showConfidenceBadge;

  // `<button>` when the whole pill is clickable and has no inner button,
  // `<span>` otherwise (display-only or container-for-remove). The branching
  // keeps the HTML valid and native keyboard handling "just works" for the
  // common "click pill to toggle filter" case.
  const pill = createPillHost(Boolean(onClick) && !onRemove);

  pill.className = buildPillClassName({
    classId,
    role,
    size,
    active,
    lowConf: effectiveLowConf,
    muted,
    removable: Boolean(onRemove),
  });

  pill.style.setProperty("--h", String(meta.hue));
  if (ariaLabel !== undefined) pill.setAttribute("aria-label", ariaLabel);

  if (showSymbol) pill.append(buildSymbolSpan(meta.symbol));

  const name = document.createElement("span");
  name.className = "tag-name";
  name.textContent = displayValue;
  pill.append(name);

  // Confidence badge sits between the name and the optional count — count
  // is a "how many notes use this tag" affordance (filter contexts), conf is
  // a "how sure are we" affordance (editor contexts); they never both apply
  // in practice, but putting conf before count keeps the pill readable if
  // they do.
  if (showConfidenceBadge && typeof confidence === "number") {
    pill.append(buildConfidenceBadge(confidence));
  }

  if (count !== undefined) pill.append(buildCountSpan(count));

  if (onClick) pill.addEventListener("click", onClick);
  if (onRemove) pill.append(buildRemoveButton(onRemove, removeAriaLabel));

  return pill;
}
