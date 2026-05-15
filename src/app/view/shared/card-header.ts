import { DEFAULT_NOTE_TITLE } from "../../../lib/notebook";
import { formatDate } from "../../logic/formatting";

/**
 * The three primary entity surfaces ("kind"s) that share the
 * `.entity-card` shell — see `styles.css` → "Entity card (Notes / Links /
 * Tasks shared shell)" for the visual contract. Per-kind class hooks
 * (`.note-list-title`, `.link-card-title`, `.task-card-title`) keep the
 * existing per-page CSS resolving unchanged while the inner DOM
 * construction lives in one place here.
 */
export type CardKind = "note" | "link" | "task";

const TITLE_CLASS_BY_KIND: Readonly<Record<CardKind, string>> = {
  note: "note-list-title",
  link: "link-card-title",
  task: "task-card-title",
};

/**
 * `kind`s for which a `<time class>` date element is part of the card
 * header pattern. Tasks intentionally render *relative* time
 * (`formatRelativeDays`) and live in their own inline element inside
 * `.task-card-sub`, so they're not part of this map; callers there
 * build their `<time>` element directly.
 */
const DATE_CLASS_BY_KIND: Readonly<Record<"note" | "link", string>> = {
  note: "note-list-date",
  link: "link-card-saved",
};

export interface BuildCardTitleOptions {
  /**
   * Override for the empty-title fallback. Defaults to
   * `DEFAULT_NOTE_TITLE` ("Untitled note") so Notes / Links / Tasks all
   * land on the same string when a note has no title. The Links card
   * uses this slot to surface the bare URL when a link has no source
   * note at all (an edge case the helper otherwise can't represent).
   */
  fallback?: string;
}

/**
 * Renders the card's title as a real heading element so Notes / Links /
 * Tasks all carry the same a11y semantics and the empty-title fallback
 * funnels through one place. The class hook is per-kind so existing
 * per-page rules (font sizes, persona / data-font-tier overrides on
 * Notes) keep resolving unchanged.
 *
 * Whitespace-only titles fall back to the default — pre-helper Notes
 * used a bare `||` check, which let `"   "` slip through as the rendered
 * label; the trim happens here so the behaviour is uniform.
 */
export function buildCardTitle(
  rawTitle: string,
  kind: CardKind,
  options: BuildCardTitleOptions = {},
): HTMLHeadingElement {
  const trimmed = rawTitle.trim();
  const el = document.createElement("h3");
  el.className = TITLE_CLASS_BY_KIND[kind];
  el.textContent = trimmed === "" ? options.fallback ?? DEFAULT_NOTE_TITLE : trimmed;
  return el;
}

/**
 * Renders a `<time class dateTime>` element for Notes / Links card
 * dates. `dateTime` is the raw ISO string so screen readers and
 * date-pickers can read the absolute timestamp; the visible label
 * stays the human-friendly `formatDate` output. Tasks use a
 * different time semantic (relative days off the source note's
 * `createdAt`) and are not supported by this helper on purpose —
 * if Tasks ever adopts absolute dates, widen the union and add the
 * matching class to `DATE_CLASS_BY_KIND`.
 */
export function buildCardDate(
  iso: string,
  kind: "note" | "link",
): HTMLTimeElement {
  const el = document.createElement("time");
  el.className = DATE_CLASS_BY_KIND[kind];
  el.dateTime = iso;
  el.textContent = formatDate(iso);
  return el;
}
