import { DEFAULT_NOTE_TITLE } from "../../../lib/notebook";
import { formatDate } from "../../logic/formatting";
import { buildIcon } from "./icons";

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

/**
 * Builds the shared tags-row wrapper used by Notes / Links cards (a
 * flat `<div>` of `.tag-chip` spans). Returns `null` when `tags` is
 * empty so callers can drop the row entirely instead of leaving an
 * empty `<div>` in the DOM — pre-helper Notes used a `tags.length > 0`
 * guard, Links the same guard plus a `primaryNote` null-check; both
 * funnel through this return value now.
 *
 * The wrapper className is per-surface (`note-list-tags` /
 * `link-card-tags`) because the row's margin + layout slot differs
 * between Notes' card body grid and Links' link-body column. Tag chip
 * element class is the shared `.tag-chip` — see
 * `styles.css` → "Step 5 of cards-unification". `textContent` (not
 * `innerHTML`) keeps the helper safe from `<script>`-tag XSS via
 * malicious tag strings; the same property the original copy-paste
 * relied on.
 *
 * Tasks doesn't call this — the cards there don't carry tags per the
 * #6 decision (1=b: Links only). The notebook-row in Notes' list view
 * also doesn't use this because it caps at 4 (`.slice(0, 4)`) and
 * has its own row class; widening the helper's signature for one
 * extra caller wasn't worth the contract surface.
 */
export function buildTagChipsRow(
  tags: readonly string[],
  wrapperClass: string,
): HTMLDivElement | null {
  if (tags.length === 0) return null;
  const row = document.createElement("div");
  row.className = wrapperClass;
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    row.append(chip);
  }
  return row;
}

/**
 * Shared "open source note" affordance — a small icon button with a
 * right-pointing arrow that lives in the head row of every entity-card
 * surface (Notes / Links / Tasks). Pre-share, Tasks had its own inline
 * `<button class="task-card-open">` built off `ICON_ARROW` in
 * `tasks-page.ts`, and Links had a text-chip in the meta row
 * (`.link-card-source`) that doubled as the open affordance. Both are
 * funnelled through this helper now so the visual + a11y contract
 * (focus ring, hover tint, aria-label) lives in one place.
 *
 * Click `stopPropagation` is intentional: every card that hosts this
 * button also carries a `closest("button, a")` guard on its
 * card-level click listener, but a defensive `stopPropagation` keeps
 * any future card-level handler from double-firing if it ever forgets
 * the guard. Click handlers (not anchor href) suit our routing —
 * navigating to the source note is an in-app state change driven
 * through the page-router, not a real navigation.
 */
export function buildCardOpenButton(
  ariaLabel: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "entity-card-open";
  btn.setAttribute("aria-label", ariaLabel);
  btn.title = ariaLabel;
  btn.append(buildIcon("arrow", 12));
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

/**
 * Wraps the card's title heading in a shared `.entity-card-head` flex
 * row so Notes / Links / Tasks all carry the same `[title …………… [→]]`
 * layout. The title block sits on the left (the caller can pass a
 * single `<h3>` or a `<div>` that contains both the title and a
 * sub-line — see Tasks, which packs `task-card-sub` underneath the
 * heading); the open-button sits on the right.
 */
export function buildCardHead(
  titleBlock: HTMLElement,
  openButton: HTMLButtonElement,
): HTMLDivElement {
  const head = document.createElement("div");
  head.className = "entity-card-head";
  head.append(titleBlock, openButton);
  return head;
}
