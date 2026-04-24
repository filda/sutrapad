/**
 * Inline icon library. Every glyph in the topbar / nav-tabs / editor toolbar
 * goes through `buildIcon` so the handoff's single source-of-truth paths stay
 * in one place instead of being scattered as `innerHTML` strings.
 *
 * Paths are lifted verbatim from `docs/design_handoff_sutrapad2/src/icons.jsx`
 * so the silhouettes match the handoff 1:1. The CSS (`.i`, `.i-14`, …) lives
 * in `src/styles.css` — this module stays layout-agnostic.
 *
 * Design choices:
 *   - SVG via `createElementNS` rather than `innerHTML`: no HTML-parser
 *     round-trip, no escaping gotchas, and it returns a typed `SVGElement`
 *     that the caller can append directly.
 *   - `stroke="currentColor"` + `fill="none"` defaults: every icon inherits
 *     its colour from the surrounding button, which keeps the hover / active
 *     colour transitions in CSS rather than TS.
 *   - Multi-path icons (note, link, tag, task, cog, …) ship as an array of
 *     path `d` strings; single-path icons (home, check) ship as one string.
 *     The builder flattens both shapes into the same `<path>` children.
 */

export type IconName =
  | "home"
  | "plus"
  | "note"
  | "link"
  | "tag"
  | "task"
  | "cog"
  | "today"
  | "search"
  | "check"
  | "close"
  | "menu"
  | "list";

type IconShape =
  | { kind: "paths"; paths: readonly string[] }
  | { kind: "mixed"; children: readonly IconChild[] };

type IconChild =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number };

/**
 * Path data keyed by icon name. "mixed" icons (tag, today) carry `<circle>`
 * children alongside `<path>` elements; they're kept as structured child
 * entries so the renderer doesn't need to parse SVG snippets.
 */
const ICON_SHAPES: Readonly<Record<IconName, IconShape>> = {
  home: {
    kind: "paths",
    paths: ["M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6H10v6H4a1 1 0 0 1-1-1Z"],
  },
  plus: { kind: "paths", paths: ["M12 5v14", "M5 12h14"] },
  note: {
    kind: "paths",
    paths: ["M5 4h11l3 3v13a1 1 0 0 1-1 1H5Z", "M8 10h8M8 14h8M8 18h5"],
  },
  link: {
    kind: "paths",
    paths: [
      "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1",
      "M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
    ],
  },
  tag: {
    kind: "mixed",
    children: [
      { tag: "path", d: "M20 12 12 20l-8-8V4h8z" },
      { tag: "circle", cx: 8, cy: 8, r: 1.5 },
    ],
  },
  task: {
    kind: "paths",
    paths: ["M4 6h14M4 12h14M4 18h9", "m17 17 2 2 4-4"],
  },
  cog: {
    kind: "mixed",
    children: [
      { tag: "circle", cx: 12, cy: 12, r: 3 },
      {
        tag: "path",
        d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
      },
    ],
  },
  today: {
    kind: "mixed",
    children: [
      { tag: "path", d: "M3 4h18v18H3z" },
      { tag: "path", d: "M3 10h18M8 2v4M16 2v4" },
      { tag: "circle", cx: 12, cy: 15, r: 1.5 },
    ],
  },
  search: {
    kind: "mixed",
    children: [
      { tag: "circle", cx: 11, cy: 11, r: 7 },
      { tag: "path", d: "m20 20-3-3" },
    ],
  },
  check: { kind: "paths", paths: ["m5 12 5 5L20 7"] },
  close: { kind: "paths", paths: ["M6 6l12 12M18 6 6 18"] },
  // The handoff names this `menu` (3 full-width horizontal lines) and uses
  // it for the *grid* / *cards* toggle button — semantic naming carried
  // verbatim from `docs/design_handoff_sutrapad2/src/icons.jsx`. It reads
  // as "stacked content blocks" in context, even though the name evokes
  // a hamburger.
  menu: { kind: "paths", paths: ["M4 6h16M4 12h16M4 18h16"] },
  // Bulleted-list silhouette: three lines indented past leading dot
  // markers. Used for the *list* toggle button. Lifted from the handoff
  // verbatim.
  list: {
    kind: "mixed",
    children: [
      { tag: "path", d: "M8 6h13M8 12h13M8 18h13" },
      { tag: "circle", cx: 4, cy: 6, r: 1 },
      { tag: "circle", cx: 4, cy: 12, r: 1 },
      { tag: "circle", cx: 4, cy: 18, r: 1 },
    ],
  },
};

export type IconSize = 12 | 14 | 16 | 20;

/**
 * Classes applied to the root `<svg>`. Size 16 is the baseline `.i`, the
 * other sizes piggyback on `.i` and add their own modifier. The size ramp
 * mirrors the handoff's `.i-12`/`.i-14`/`.i-20` helpers — `.i` on its own
 * covers the 16px default.
 */
function classNameForSize(size: IconSize): string {
  if (size === 16) return "i";
  return `i i-${size}`;
}

/**
 * Returns an `<svg>` element for the named icon. Default size 16 matches the
 * handoff's `.i` baseline; pass 14 for nav-tabs / pill icons, 12 for inline
 * glyphs in dense chips, 20 for hero-scale decoration.
 *
 * Colour is inherited (`currentColor` on `stroke`), so a single `color:` on
 * the parent button drives both text and icon. Fill stays `none` by default
 * because nearly every handoff icon is stroked outline — the few that aren't
 * (e.g. the battery charge fill) aren't used in the topbar and can be added
 * with a per-child `fill="currentColor"` later if we ever ship them.
 */
export function buildIcon(name: IconName, size: IconSize = 16): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", classNameForSize(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const shape = ICON_SHAPES[name];
  if (shape.kind === "paths") {
    for (const d of shape.paths) svg.append(buildPathChild(d));
  } else {
    for (const child of shape.children) svg.append(buildMixedChild(child));
  }
  return svg;
}

function buildPathChild(d: string): SVGPathElement {
  const el = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  el.setAttribute("d", d);
  return el;
}

function buildMixedChild(child: IconChild): SVGElement {
  if (child.tag === "path") return buildPathChild(child.d);
  const circle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  circle.setAttribute("cx", String(child.cx));
  circle.setAttribute("cy", String(child.cy));
  circle.setAttribute("r", String(child.r));
  return circle;
}
