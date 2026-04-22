/**
 * Empty-state primitives ported from
 * `docs/design_handoff_sutrapad2/src/empty_states.jsx`.
 *
 * Two rendering variants, one illustration set:
 *
 * - `buildEmptyScene` — **full-bleed first-run**: large ink illustration
 *   (~130px), serif title, warm sub-copy, optional primary + secondary
 *   buttons. Used on pages that have no data at all (first-run Tasks,
 *   Tags, Links, etc.).
 *
 * - `buildEmptyState` — **inline filter-miss**: small dashed card on
 *   `--paper-1`, compact title + sub. Used where the underlying data
 *   exists but the current filter returned nothing (notes list, editor
 *   canvas under an over-narrow filter, etc.).
 *
 * The SVG illustrations share one visual language — 1px ink stroke on the
 * primary ink colour, terracotta accent, a subtle rotation for a
 * hand-placed feel. The handoff hard-codes the colours because the
 * ink-on-paper aesthetic reads identically across all supported themes;
 * we preserve that so the accent dot stays warm even in the dark Ink
 * theme.
 */

/**
 * Kinds correspond 1:1 to handoff `EMPTY_COPY` keys. Each is tied to a
 * specific SVG in {@link buildEmptyInk}; extra kinds should add both an
 * entry here and a branch in that function so the illustration set
 * stays exhaustive.
 */
export type EmptyStateKind =
  | "today"
  | "add"
  | "notes"
  | "links"
  | "tasks"
  | "tags"
  | "capture"
  | "generic";

export interface EmptyStateCopy {
  /**
   * Which illustration to pair with this copy. Separate from the caller-
   * facing copy key so two variants (e.g. first-run vs filter-miss) can
   * reuse the same glyph — `notes_filtered` and `notes` both pick the
   * quill-on-page.
   */
  kind: EmptyStateKind;
  title: string;
  sub?: string;
  cta?: string;
  secondary?: string;
}

export interface EmptyStateActions {
  onCta?: () => void;
  onSecondary?: () => void;
}

export type EmptyStateOptions = EmptyStateCopy & EmptyStateActions;

const INK_STROKE = "#1b1714";
const INK_ACCENT = "#c46a3a";
const INK_MUTED = "#8a7c6c";

/**
 * Canonical copy presets mirrored from the handoff. Callers should prefer
 * picking one of these keys and composing actions on top rather than
 * hand-rolling strings — the poetic tone is what makes the empty states
 * feel warm, and drifts easily when each caller writes its own.
 *
 * Keys with a `_filtered` / `_done` suffix are variants for the same
 * surface; `notes` is the first-run copy, `notes_filtered` is shown when
 * a tag filter kills the list. Callers pick by context.
 */
export const EMPTY_COPY = {
  today: {
    kind: "today",
    title: "A blank morning.",
    sub: "Nothing captured yet. The day is still yours to write on.",
    cta: "Write something",
    secondary: "Browse captures",
  },
  add_intro: {
    kind: "add",
    title: "Say something.",
    sub:
      "Paste a link, drop in a quote, jot a task list, or just start writing. The editor will adapt.",
  },
  notes: {
    kind: "notes",
    title: "No notebooks yet.",
    sub:
      "Notebooks are derived from tags and time — they'll appear on their own once you've captured a handful of notes.",
    cta: "Write your first note",
  },
  notes_filtered: {
    kind: "notes",
    title: "Nothing here under this filter.",
    sub: "Try another tag, or clear the filter to see everything.",
    secondary: "Clear filter",
  },
  links: {
    kind: "links",
    title: "No links saved.",
    sub:
      "Every URL you paste into Sutrapad becomes a link. Or install the bookmarklet to save from any page.",
    cta: "Set up bookmarklet",
  },
  links_filtered: {
    kind: "links",
    title: "No links match.",
    sub: "The filter's too tight. Loosen a tag, or browse all.",
    secondary: "Clear filter",
  },
  tasks: {
    kind: "tasks",
    title: "Nothing to do.",
    sub:
      "Write a note with [ ] in front of a line and it becomes a task. Or just enjoy the silence.",
  },
  tasks_done: {
    kind: "tasks",
    title: "All done.",
    sub: "Every task you've captured is checked off. Breathe.",
  },
  tags: {
    kind: "tags",
    title: "No tags yet.",
    sub:
      "Tags come from what you write — places, times, topics. They'll show up as you go.",
  },
  capture: {
    kind: "capture",
    title: "No sources configured.",
    sub:
      "Sutrapad can capture from the web, your phone, your voice, or your inbox. Pick one to start.",
    cta: "Browse sources",
  },
} as const satisfies Record<string, EmptyStateCopy>;

/**
 * Full-bleed empty scene with a large illustration, serif title, and
 * optional primary / secondary buttons. Renders the same kind of ceremony
 * the handoff screenshot shows for the "first-run" case — centered in the
 * page, plenty of air, warm copy.
 */
export function buildEmptyScene(options: EmptyStateOptions): HTMLElement {
  const { kind, title, sub, cta, secondary, onCta, onSecondary } = options;

  const scene = document.createElement("section");
  scene.className = "empty-scene";

  const ink = document.createElement("div");
  ink.className = "empty-scene-ink";
  ink.append(buildEmptyInk(kind, 130));
  scene.append(ink);

  const heading = document.createElement("h2");
  heading.className = "empty-scene-title";
  heading.textContent = title;
  scene.append(heading);

  if (sub) {
    const paragraph = document.createElement("p");
    paragraph.className = "empty-scene-sub";
    paragraph.textContent = sub;
    scene.append(paragraph);
  }

  if (cta || secondary) {
    const actions = document.createElement("div");
    actions.className = "empty-scene-actions";

    if (cta) {
      const ctaButton = document.createElement("button");
      ctaButton.type = "button";
      ctaButton.className = "button button-accent";
      ctaButton.textContent = cta;
      if (onCta) ctaButton.addEventListener("click", onCta);
      actions.append(ctaButton);
    }

    if (secondary) {
      const secondaryButton = document.createElement("button");
      secondaryButton.type = "button";
      secondaryButton.className = "button button-ghost";
      secondaryButton.textContent = secondary;
      if (onSecondary) secondaryButton.addEventListener("click", onSecondary);
      actions.append(secondaryButton);
    }

    scene.append(actions);
  }

  return scene;
}

/**
 * Inline empty state for filter-miss cases. Compact, sits inside a list
 * or editor canvas, dashed border on `--paper-1`. Does not show an
 * illustration by default — the context (a tag filter strip above it)
 * already signals what happened; adding a full glyph here would feel
 * excessive. A small glyph is included as a quiet visual anchor.
 */
export function buildEmptyState(options: EmptyStateOptions): HTMLElement {
  const { kind, title, sub, cta, secondary, onCta, onSecondary } = options;

  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";

  const glyph = document.createElement("div");
  glyph.className = "empty-glyph";
  glyph.append(buildEmptyInk(kind, 28));
  wrapper.append(glyph);

  const heading = document.createElement("h3");
  heading.textContent = title;
  wrapper.append(heading);

  if (sub) {
    const paragraph = document.createElement("p");
    paragraph.textContent = sub;
    wrapper.append(paragraph);
  }

  if (cta || secondary) {
    const actions = document.createElement("div");
    actions.className = "empty-state-actions";

    if (cta) {
      const ctaButton = document.createElement("button");
      ctaButton.type = "button";
      ctaButton.className = "button button-accent";
      ctaButton.textContent = cta;
      if (onCta) ctaButton.addEventListener("click", onCta);
      actions.append(ctaButton);
    }

    if (secondary) {
      const secondaryButton = document.createElement("button");
      secondaryButton.type = "button";
      secondaryButton.className = "button button-ghost";
      secondaryButton.textContent = secondary;
      if (onSecondary) secondaryButton.addEventListener("click", onSecondary);
      actions.append(secondaryButton);
    }

    wrapper.append(actions);
  }

  return wrapper;
}

/**
 * Builds one of the ink-on-paper illustrations that decorate the empty
 * states. Kept in-file (rather than an asset bundle) so the stroke
 * colours can read CSS custom properties at render time and the paths
 * stay visible in diffs during design iteration. Matches
 * `docs/design_handoff_sutrapad2/src/empty_states.jsx` path-for-path.
 */
export function buildEmptyInk(
  kind: EmptyStateKind,
  size = 120,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("empty-ink-svg", `empty-ink-${kind}`);

  for (const path of pathsForKind(kind)) {
    svg.append(buildInkPath(path));
  }

  return svg;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Shape of each ink primitive. Keeps the per-kind list flat and readable
 * while still letting us control stroke width, dash, opacity per path.
 */
interface InkPrimitive {
  readonly type: "path" | "circle" | "ellipse" | "rect";
  readonly attrs: Readonly<Record<string, string>>;
}

function buildInkPath({ type, attrs }: InkPrimitive): SVGElement {
  const el = document.createElementNS(SVG_NS, type);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

/**
 * Lookup of the eight handoff illustrations. Each entry is a flat list of
 * SVG primitives — no nested groups — so the SVGs stay small and the
 * output matches the hand-tuned paths from the handoff exactly.
 */
function pathsForKind(kind: EmptyStateKind): readonly InkPrimitive[] {
  switch (kind) {
    case "today":
      return TODAY_PATHS;
    case "add":
    case "notes":
      return PAGE_QUILL_PATHS;
    case "links":
      return LINKS_PATHS;
    case "tasks":
      return TASKS_PATHS;
    case "tags":
      return TAGS_PATHS;
    case "capture":
      return CAPTURE_PATHS;
    case "generic":
    default:
      return GENERIC_PATHS;
  }
}

// === Illustration primitives ================================================
//
// The following path tables are ported verbatim from
// `docs/design_handoff_sutrapad2/src/empty_states.jsx`. Stroke widths,
// dash patterns, and transforms are kept in sync with the handoff so a
// side-by-side against the prototype reads identically.

const TODAY_PATHS: readonly InkPrimitive[] = [
  {
    type: "path",
    attrs: {
      d: "M18 80 Q60 70 102 80 L100 38 Q60 28 20 38 Z",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      "stroke-linejoin": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M60 34 Q60 70 60 80",
      stroke: INK_STROKE,
      "stroke-width": "1",
      "stroke-linecap": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M28 44 L54 46 M30 52 L52 54 M66 46 L92 44 M68 54 L90 52",
      stroke: INK_MUTED,
      "stroke-width": "0.9",
      "stroke-linecap": "round",
    },
  },
  {
    type: "circle",
    attrs: {
      cx: "88",
      cy: "22",
      r: "6",
      stroke: INK_ACCENT,
      "stroke-width": "1.4",
      fill: "none",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M88 12 L88 8 M98 22 L102 22 M95 15 L97 13 M81 15 L79 13",
      stroke: INK_ACCENT,
      "stroke-width": "1.2",
      "stroke-linecap": "round",
    },
  },
];

const PAGE_QUILL_PATHS: readonly InkPrimitive[] = [
  {
    type: "path",
    attrs: {
      d: "M28 20 L28 100 L92 100 L92 30 L82 20 Z",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      "stroke-linejoin": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M82 20 L82 30 L92 30",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      fill: "none",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M38 44 L72 44 M38 54 L82 54 M38 64 L60 64",
      stroke: INK_MUTED,
      "stroke-width": "0.9",
      "stroke-linecap": "round",
      "stroke-dasharray": "1.5 2.5",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M66 72 L98 40",
      stroke: INK_STROKE,
      "stroke-width": "1.3",
      "stroke-linecap": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M92 34 Q102 38 106 48 Q98 50 88 44 Z",
      stroke: INK_ACCENT,
      "stroke-width": "1.2",
      fill: "none",
      "stroke-linejoin": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M64 78 Q60 82 60 86 Q60 90 64 90 Q68 90 68 86 Q68 82 64 78 Z",
      stroke: INK_ACCENT,
      "stroke-width": "1.2",
      fill: INK_ACCENT,
      "fill-opacity": "0.15",
    },
  },
];

const LINKS_PATHS: readonly InkPrimitive[] = [
  {
    type: "ellipse",
    attrs: {
      cx: "34",
      cy: "60",
      rx: "18",
      ry: "14",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      fill: "none",
      transform: "rotate(-15 34 60)",
    },
  },
  {
    type: "ellipse",
    attrs: {
      cx: "86",
      cy: "60",
      rx: "18",
      ry: "14",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      fill: "none",
      transform: "rotate(15 86 60)",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M48 60 L72 60",
      stroke: INK_ACCENT,
      "stroke-width": "1.4",
      "stroke-linecap": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M58 50 L62 70 M66 50 L66 70",
      stroke: INK_MUTED,
      "stroke-width": "0.8",
      "stroke-linecap": "round",
    },
  },
];

const TASKS_PATHS: readonly InkPrimitive[] = [
  {
    type: "rect",
    attrs: {
      x: "24",
      y: "30",
      width: "70",
      height: "60",
      rx: "6",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      fill: "none",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M36 50 L62 50 M36 62 L80 62 M36 74 L54 74",
      stroke: INK_MUTED,
      "stroke-width": "0.9",
      "stroke-linecap": "round",
    },
  },
  {
    type: "rect",
    attrs: {
      x: "30",
      y: "44",
      width: "10",
      height: "10",
      rx: "2",
      stroke: INK_ACCENT,
      "stroke-width": "1.3",
      fill: "none",
    },
  },
  {
    type: "rect",
    attrs: {
      x: "30",
      y: "56",
      width: "10",
      height: "10",
      rx: "2",
      stroke: INK_ACCENT,
      "stroke-width": "1.3",
      fill: "none",
    },
  },
  {
    type: "rect",
    attrs: {
      x: "30",
      y: "68",
      width: "10",
      height: "10",
      rx: "2",
      stroke: INK_ACCENT,
      "stroke-width": "1.3",
      fill: "none",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M80 24 L86 30 L98 18",
      stroke: INK_ACCENT,
      "stroke-width": "1.6",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
    },
  },
];

const TAGS_PATHS: readonly InkPrimitive[] = [
  { type: "circle", attrs: { cx: "30", cy: "32", r: "4", fill: INK_ACCENT } },
  { type: "circle", attrs: { cx: "74", cy: "24", r: "3", fill: INK_STROKE } },
  {
    type: "circle",
    attrs: {
      cx: "92",
      cy: "56",
      r: "4",
      fill: INK_ACCENT,
      "fill-opacity": "0.6",
    },
  },
  { type: "circle", attrs: { cx: "58", cy: "58", r: "3.5", fill: INK_STROKE } },
  { type: "circle", attrs: { cx: "28", cy: "82", r: "3", fill: INK_STROKE } },
  { type: "circle", attrs: { cx: "76", cy: "92", r: "4", fill: INK_ACCENT } },
  { type: "circle", attrs: { cx: "48", cy: "38", r: "2.5", fill: INK_MUTED } },
  {
    type: "path",
    attrs: {
      d:
        "M30 32 L58 58 M58 58 L92 56 M58 58 L28 82 M58 58 L74 24 M58 58 L76 92 M30 32 L48 38 L74 24",
      stroke: INK_MUTED,
      "stroke-width": "0.8",
      "stroke-dasharray": "2 2.5",
      "stroke-linecap": "round",
    },
  },
];

const CAPTURE_PATHS: readonly InkPrimitive[] = [
  {
    type: "path",
    attrs: {
      d: "M24 48 L96 48 L96 92 L24 92 Z",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      "stroke-linejoin": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M24 48 L60 72 L96 48",
      stroke: INK_STROKE,
      "stroke-width": "1.2",
      "stroke-linejoin": "round",
      fill: "none",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M44 30 Q60 20 76 30",
      stroke: INK_ACCENT,
      "stroke-width": "1.3",
      fill: "none",
      "stroke-linecap": "round",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M36 24 Q60 10 84 24",
      stroke: INK_ACCENT,
      "stroke-width": "1.1",
      fill: "none",
      "stroke-linecap": "round",
      opacity: "0.6",
    },
  },
  {
    type: "path",
    attrs: {
      d: "M28 18 Q60 0 92 18",
      stroke: INK_ACCENT,
      "stroke-width": "0.9",
      fill: "none",
      "stroke-linecap": "round",
      opacity: "0.35",
    },
  },
];

const GENERIC_PATHS: readonly InkPrimitive[] = [
  {
    type: "path",
    attrs: {
      d: "M20 60 L100 60",
      stroke: INK_MUTED,
      "stroke-width": "0.9",
      "stroke-linecap": "round",
      "stroke-dasharray": "2 3",
    },
  },
  {
    type: "circle",
    attrs: { cx: "60", cy: "60", r: "5", fill: INK_ACCENT },
  },
];
