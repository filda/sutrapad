/**
 * Shared shell for static "long-form" pages — Privacy today, future
 * candidates being Help / About / Terms / Changelog. Each consumer just
 * builds its prose content tree (as plain DOM elements: `<h2>`, `<p>`,
 * `<ul>`, …) and hands it in via `content`. The shell takes care of:
 *
 *   - the wrapping `<section class="static-page">` element,
 *   - a header row with the page title (`<h1>`) and a "Back to {label}"
 *     link that re-uses the existing `onSelectMenuItem` plumbing — so a
 *     static page never invents its own routing primitive,
 *   - an `<article class="prose">` container around the content so CSS
 *     can target prose-y typography (max-width, headings, lists)
 *     without bleeding into the topbar / footer.
 *
 * The shell is intentionally render-time only — it doesn't know about
 * markdown, doesn't fetch anything, and doesn't subscribe to state.
 * That lets each page owner keep its own typed content tree (typically
 * a single `buildXPage()` factory) and stay easy to unit-test
 * DOM-free style.
 */

import type { MenuItemId } from "../../logic/menu";

export interface StaticPageShellOptions {
  /**
   * Page title rendered as `<h1>`. Plain text — set via `textContent`
   * so user-controlled strings can't smuggle markup. For pages that
   * want an italic emphasis word (the v3 handoff style), use
   * {@link titleHtml} instead; the two are mutually exclusive at the
   * call site.
   */
  title?: string;
  /**
   * Title markup. Rendered via `innerHTML` so callers can wrap the
   * emphasis word in `<em>`. Caller is responsible for escaping any
   * user-controlled content; the live call sites all hand in
   * static strings, mirroring the contract on `page-header.ts`.
   */
  titleHtml?: string;
  /**
   * Optional small-caps accent label above the title (`"About ·
   * Sutrapad"`, `"Keyboard shortcuts"`, `"Terms of use"`). Mirrors the
   * page-header eyebrow pattern but lives inside the static-page
   * shell because long-form pages benefit from a stronger header
   * hierarchy than the in-app pages do.
   */
  eyebrow?: string;
  /**
   * Optional subtitle below the title, ~60ch clamped. Plain text.
   */
  subtitle?: string;
  /**
   * Optional `Last updated · April 2026`-style stamp under the
   * subtitle. Free-form so the caller can render whatever date format
   * matches its source markdown.
   */
  lastUpdated?: string;
  /**
   * Pre-built prose content (one or more elements that go inside the
   * `<article class="prose">` container). The caller decides on
   * heading levels and list shapes; the shell only owns the wrapping
   * landmarks.
   */
  content: readonly Node[];
  /**
   * Where the "Back" link sends the user. Optional — when omitted
   * (the default for About / Terms / Shortcuts), the shell renders
   * no back link at all and users return via the topbar / footer
   * like on any other page. Privacy keeps the link because it's
   * reached as a sub-page of Settings.
   */
  backTo?: MenuItemId;
  /**
   * Label shown next to the back arrow, e.g. `"Settings"`. Required
   * when `backTo` is set; ignored otherwise.
   */
  backLabel?: string;
  /**
   * Navigation callback wired by the render layer. Same shape as
   * the `onSelectMenuItem` prop threaded through topbar / footer —
   * the shell calls it with `backTo` when the back link fires.
   */
  onSelectMenuItem: (id: MenuItemId) => void;
}

export function buildStaticPageShell({
  title,
  titleHtml,
  eyebrow,
  subtitle,
  lastUpdated,
  content,
  backTo,
  backLabel,
  onSelectMenuItem,
}: StaticPageShellOptions): HTMLElement {
  const page = document.createElement("section");
  page.className = "static-page";

  const header = document.createElement("header");
  header.className = "static-page-header";

  if (backTo !== undefined && backLabel !== undefined) {
    const backLink = document.createElement("button");
    backLink.type = "button";
    backLink.className = "static-page-back is-link";
    // Plain-text arrow keeps the markup readable even if the icon font
    // hasn't loaded yet (FOIT avoidance for a navigation control).
    backLink.textContent = `← Back to ${backLabel}`;
    backLink.addEventListener("click", () => onSelectMenuItem(backTo));
    header.append(backLink);
  }

  if (eyebrow !== undefined) {
    const eyebrowEl = document.createElement("p");
    eyebrowEl.className = "static-page-eyebrow";
    eyebrowEl.textContent = eyebrow;
    header.append(eyebrowEl);
  }

  const heading = document.createElement("h1");
  heading.className = "static-page-title";
  if (titleHtml !== undefined) {
    heading.innerHTML = titleHtml;
  } else if (title !== undefined) {
    heading.textContent = title;
  }
  header.append(heading);

  if (subtitle !== undefined) {
    const subtitleEl = document.createElement("p");
    subtitleEl.className = "static-page-subtitle";
    subtitleEl.textContent = subtitle;
    header.append(subtitleEl);
  }

  if (lastUpdated !== undefined) {
    const meta = document.createElement("p");
    meta.className = "static-page-meta";
    meta.textContent = `Last updated · ${lastUpdated}`;
    header.append(meta);
  }

  page.append(header);

  const article = document.createElement("article");
  article.className = "prose";
  article.append(...content);
  page.append(article);

  return page;
}
