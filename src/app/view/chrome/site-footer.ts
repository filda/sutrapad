/**
 * Site footer — replaces the previous one-liner with a 4-column layout
 * modelled after the v3 design handoff
 * (`extracted/13_footer_static_pages.jsx`, `Footer`).
 *
 * Layout:
 *
 *   ┌────────────┬──────────┬──────┬─────────┬───────┐
 *   │ Brand      │ Sutrapad │ Use  │ Sources │ Legal │
 *   │ + tagline  │          │      │         │       │
 *   ├────────────┴──────────┴──────┴─────────┴───────┤
 *   │ © year · MIT license · build stamp             │
 *   └────────────────────────────────────────────────┘
 *
 * Internal links go through `onSelectMenuItem`; external links open a
 * new tab with `rel="noopener"`. The build stamp is appended to the
 * base row rather than hanging off on its own — `formatBuildStamp` in
 * `app.ts` already produces a self-contained `version • commit •
 * timestamp` string we can drop in next to the copyright.
 *
 * **No innerHTML** anywhere in this module — every text node is set via
 * `textContent`. Filip's earlier audit removed the last
 * interpolated-innerHTML site from the codebase and the convention
 * stays: a single grep over `innerHTML` should keep showing zero hits.
 */

import type { MenuItemId } from "../../logic/menu";

export interface SiteFooterOptions {
  /**
   * `version • commit • timestamp` line produced by `formatBuildStamp`
   * in `app.ts`. Threaded straight through so this module doesn't need
   * to know about Vite injection or the timestamp format.
   */
  buildStamp: string;
  /**
   * Internal-route navigation. Same shape topbar / mobile-nav use, so
   * the footer doesn't invent a separate routing primitive.
   */
  onSelectMenuItem: (id: MenuItemId) => void;
}

interface InternalLink {
  kind: "internal";
  label: string;
  page: MenuItemId;
}

interface ExternalLink {
  kind: "external";
  label: string;
  href: string;
}

type FooterLink = InternalLink | ExternalLink;

interface FooterColumn {
  head: string;
  links: readonly FooterLink[];
}

const COLUMNS: readonly FooterColumn[] = [
  {
    head: "Sutrapad",
    links: [{ kind: "internal", label: "About", page: "about" }],
  },
  {
    head: "Use",
    links: [
      { kind: "internal", label: "Capture setup", page: "capture" },
      { kind: "internal", label: "Shortcuts", page: "shortcuts" },
    ],
  },
  {
    head: "Sources",
    links: [
      {
        kind: "external",
        label: "GitHub repository",
        href: "https://github.com/filda/sutrapad",
      },
      {
        kind: "external",
        label: "OpenStreetMap",
        href: "https://www.openstreetmap.org/",
      },
      {
        kind: "external",
        label: "Nominatim",
        href: "https://nominatim.openstreetmap.org/",
      },
    ],
  },
  {
    head: "Legal",
    links: [
      { kind: "internal", label: "Privacy", page: "privacy" },
      { kind: "internal", label: "Terms", page: "terms" },
    ],
  },
];

export function buildSiteFooter({
  buildStamp,
  onSelectMenuItem,
}: SiteFooterOptions): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "site-footer";

  const inner = document.createElement("div");
  inner.className = "site-footer-inner";

  inner.append(buildBrandBlock());
  for (const column of COLUMNS) {
    inner.append(buildColumn(column, onSelectMenuItem));
  }

  footer.append(inner);

  const rule = document.createElement("hr");
  rule.className = "site-footer-rule";
  rule.setAttribute("aria-hidden", "true");
  footer.append(rule);

  footer.append(buildBaseRow(buildStamp));

  return footer;
}

function buildBrandBlock(): HTMLElement {
  const block = document.createElement("div");
  block.className = "site-footer-brand";

  const wordmark = document.createElement("p");
  wordmark.className = "site-footer-wordmark";
  wordmark.textContent = "Sutrapad";
  block.append(wordmark);

  const tagline = document.createElement("p");
  tagline.className = "site-footer-tagline";
  tagline.textContent =
    "A notebook for the way you already think — by hand, by place, by mood. Save everything to your own drive. Never the system of record.";
  block.append(tagline);

  return block;
}

function buildColumn(
  column: FooterColumn,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "site-footer-col";

  const head = document.createElement("p");
  head.className = "site-footer-col-head";
  head.textContent = column.head;
  wrapper.append(head);

  const list = document.createElement("ul");
  list.className = "site-footer-col-list";
  for (const link of column.links) {
    const li = document.createElement("li");
    li.append(buildLink(link, onSelectMenuItem));
    list.append(li);
  }
  wrapper.append(list);

  return wrapper;
}

function buildLink(
  link: FooterLink,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  if (link.kind === "internal") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "is-link site-footer-link";
    button.textContent = link.label;
    button.addEventListener("click", () => onSelectMenuItem(link.page));
    return button;
  }
  const anchor = document.createElement("a");
  anchor.className = "site-footer-link";
  anchor.href = link.href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = link.label;
  return anchor;
}

function buildBaseRow(buildStamp: string): HTMLElement {
  const base = document.createElement("div");
  base.className = "site-footer-base";

  const copyright = document.createElement("p");
  copyright.className = "site-footer-copy";
  // Year resolves at render time so a session that survives midnight on
  // New Year's Eve flips automatically. The cost is a single Date()
  // construction per render, which is negligible alongside the rest of
  // the page rebuild.
  const year = new Date().getFullYear();
  copyright.textContent = `© ${year} Sutrapad · MIT license`;
  base.append(copyright);

  const stamp = document.createElement("p");
  stamp.className = "site-footer-stamp";
  stamp.textContent = buildStamp;
  base.append(stamp);

  return base;
}
