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
  /** Page title rendered as `<h1>`. */
  title: string;
  /**
   * Pre-built prose content (one or more elements that go inside the
   * `<article class="prose">` container). The caller decides on
   * heading levels and list shapes; the shell only owns the wrapping
   * landmarks.
   */
  content: readonly Node[];
  /**
   * Where the "Back" link sends the user. Defaults to `"home"` so a
   * direct deep-link visit to `/privacy` from outside the app still
   * has a sensible up-route.
   */
  backTo?: MenuItemId;
  /**
   * Label shown next to the back arrow, e.g. `"Home"`. Falls back to
   * `"Home"` if omitted.
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
  content,
  backTo = "home",
  backLabel = "Home",
  onSelectMenuItem,
}: StaticPageShellOptions): HTMLElement {
  const page = document.createElement("section");
  page.className = "static-page";

  const header = document.createElement("header");
  header.className = "static-page-header";

  const backLink = document.createElement("button");
  backLink.type = "button";
  backLink.className = "static-page-back is-link";
  // Plain-text arrow keeps the markup readable even if the icon font
  // hasn't loaded yet (FOIT avoidance for a navigation control).
  backLink.textContent = `← Back to ${backLabel}`;
  backLink.addEventListener("click", () => onSelectMenuItem(backTo));
  header.append(backLink);

  const heading = document.createElement("h1");
  heading.className = "static-page-title";
  heading.textContent = title;
  header.append(heading);

  page.append(header);

  const article = document.createElement("article");
  article.className = "prose";
  article.append(...content);
  page.append(article);

  return page;
}
