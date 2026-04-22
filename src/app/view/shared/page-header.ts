/**
 * Shared page-header lockup used on the Notes, Links and Tasks screens.
 *
 * Follows the handoff's three-line pattern: an uppercase accent eyebrow
 * (kept-terse, counts + context), a serif title with one italicised
 * emphasis word (passed in as a pre-sanitised HTML string), and a muted
 * subtitle clamped at ~60ch. An optional actions slot sits opposite the
 * text block on wide screens and wraps beneath it on small viewports.
 *
 * The builder returns a `<div class="page-header">`; placement and
 * spacing are owned by the parent page container.
 */
export interface PageHeaderOptions {
  /**
   * Eyebrow text above the title. Kept short — usually a category label
   * plus a count (e.g. "Notebook · 42 notes").
   */
  eyebrow: string;
  /**
   * Title markup. Rendered via innerHTML so callers can wrap the emphasis
   * word in `<em>`. Callers are responsible for escaping user-controlled
   * content; none of the live call sites embed user strings here.
   */
  titleHtml: string;
  /**
   * Muted subtitle sentence. Optional — omit on screens where the title +
   * eyebrow already carry the full meaning.
   */
  subtitle?: string;
  /**
   * Optional actions — one or more buttons/toggles rendered opposite the
   * text block. An array lets callers stack a segmented control next to a
   * secondary button without wrapping them in an extra container.
   */
  actions?: HTMLElement | HTMLElement[];
}

export function buildPageHeader({
  eyebrow,
  titleHtml,
  subtitle,
  actions,
}: PageHeaderOptions): HTMLElement {
  const header = document.createElement("div");
  header.className = "page-header";

  const block = document.createElement("div");
  block.className = "page-header-text";

  const eyebrowEl = document.createElement("p");
  eyebrowEl.className = "page-eyebrow";
  eyebrowEl.textContent = eyebrow;
  block.append(eyebrowEl);

  const title = document.createElement("h1");
  title.className = "page-title";
  title.innerHTML = titleHtml;
  block.append(title);

  if (subtitle) {
    const subtitleEl = document.createElement("p");
    subtitleEl.className = "page-subtitle";
    subtitleEl.textContent = subtitle;
    block.append(subtitleEl);
  }

  header.append(block);

  const actionsList = Array.isArray(actions) ? actions : actions ? [actions] : [];
  if (actionsList.length > 0) {
    const actionsEl = document.createElement("div");
    actionsEl.className = "page-header-actions";
    for (const action of actionsList) actionsEl.append(action);
    header.append(actionsEl);
  }

  return header;
}
