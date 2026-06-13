/**
 * Structured title model for page lockups (in-app `page-header` and the
 * long-form `static-page-shell`).
 *
 * Replaces the old `titleHtml: string` slots that rendered through
 * `innerHTML`. A title is always "lead text · one italic emphasis ·
 * trailing text". Every part is rendered as a text node (or a single
 * `<em>` whose text is set via `textContent`), so the HTML parser is never
 * invoked while building a title — a hostile profile name or a future
 * dynamic part can't smuggle markup onto the SutraPad origin. The XSS-safe
 * invariant is now enforced by the API shape rather than by caller
 * discipline (the old "callers must escape everything" contract).
 *
 * Pages that don't need an emphasis word pass a plain `string`, rendered as
 * `textContent`.
 */

export interface PageTitle {
  /** Text before the emphasis. Rendered as a text node. Optional. */
  before?: string;
  /** The single italicised word/phrase. Rendered inside one `<em>`. */
  emphasis: string;
  /** Text after the emphasis. Rendered as a text node. Optional. */
  after?: string;
}

/** Either a plain-text title or a structured one-emphasis title. */
export type TitleContent = string | PageTitle;

/**
 * Render `title` into `heading` using DOM nodes only. A plain string becomes
 * `textContent`; a {@link PageTitle} becomes `before` + `<em>emphasis</em>` +
 * `after`, each part assigned as text. No part is ever parsed as HTML.
 */
export function appendPageTitle(
  heading: HTMLElement,
  title: TitleContent,
): void {
  if (typeof title === "string") {
    heading.textContent = title;
    return;
  }
  if (title.before) heading.append(document.createTextNode(title.before));
  const em = document.createElement("em");
  em.textContent = title.emphasis;
  heading.append(em);
  if (title.after) heading.append(document.createTextNode(title.after));
}
