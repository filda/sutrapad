/**
 * Shared page-header lockup used on the Notes, Links and Tasks screens.
 *
 * Follows the handoff's three-line pattern: an uppercase accent eyebrow
 * (kept-terse, counts + context), a serif title with one italicised
 * emphasis word (passed in as a pre-sanitised HTML string), and a muted
 * subtitle clamped at ~60ch. An optional actions slot sits opposite the
 * text block on wide screens and wraps beneath it on small viewports.
 *
 * The eyebrow doubles as a collapse toggle: clicking it folds the title +
 * subtitle (and the actions slot) away, leaving only the eyebrow chip. The
 * intro state is persisted per `pageId` via `src/app/logic/page-intro.ts`,
 * so a returning user keeps their dismiss preference. After ten visits the
 * intro auto-fades unless the page passes `noAutoFade` (Today / Home,
 * where the eyebrow + title carry day-to-day context).
 *
 * The builder returns a `<div class="page-header">`; placement and
 * spacing are owned by the parent page container.
 */
import {
  getIntroEntry,
  isIntroCollapsed,
  loadIntroStore,
  persistIntroStore,
  recordVisit,
  toggleIntroCollapse,
} from "../../logic/page-intro";

export interface PageHeaderOptions {
  /**
   * Stable identifier for this page's intro state. Drives both the
   * visit counter and the dismiss memory in `localStorage`. Use a short
   * lowercase word that matches the route — `"home"`, `"notes"`,
   * `"tags"`, `"tasks"`, `"links"`, `"capture"`. Pages that share a
   * conceptual surface should share the id; distinct pages must not.
   */
  pageId: string;
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
  /**
   * Skip the auto-fade-after-N-visits rule for this page. The eyebrow
   * still toggles manually; the title + subtitle just don't disappear on
   * their own. Used on pages whose copy genuinely changes over time
   * (Home greetings, daily counts) rather than the static onboarding
   * blurbs that fade is designed for.
   */
  noAutoFade?: boolean;
}

export function buildPageHeader({
  pageId,
  eyebrow,
  titleHtml,
  subtitle,
  actions,
  noAutoFade,
}: PageHeaderOptions): HTMLElement {
  // Bump the visit counter for this page-id and persist immediately. We
  // evaluate the collapsed state against the freshly-incremented count so
  // the threshold check stays consistent across page builds — the alternative
  // (read, render, then bump on next tick) would render the 11th visit
  // expanded once before fading on the 12th.
  const initialStore = recordVisit(loadIntroStore(), pageId);
  persistIntroStore(initialStore);

  const header = document.createElement("div");
  header.className = "page-header";

  const block = document.createElement("div");
  block.className = "page-header-text";

  const eyebrowButton = document.createElement("button");
  eyebrowButton.type = "button";
  eyebrowButton.className = "page-eyebrow page-eyebrow-toggle";
  // Eyebrow text + chevron live inside the toggle so the whole strip is
  // one click target. The chevron is decorative — its rotation telegraphs
  // expand/collapse alongside the aria-expanded attribute.
  const eyebrowLabel = document.createElement("span");
  eyebrowLabel.className = "page-eyebrow-label";
  eyebrowLabel.textContent = eyebrow;
  eyebrowButton.append(eyebrowLabel);
  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("class", "page-eyebrow-chev");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("width", "10");
  chevron.setAttribute("height", "10");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "2.5");
  chevron.setAttribute("stroke-linecap", "round");
  chevron.setAttribute("stroke-linejoin", "round");
  chevron.setAttribute("aria-hidden", "true");
  const chevronPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  chevronPath.setAttribute("d", "M6 9l6 6 6-6");
  chevron.append(chevronPath);
  eyebrowButton.append(chevron);
  block.append(eyebrowButton);

  const title = document.createElement("h1");
  title.className = "page-title";
  title.innerHTML = titleHtml;
  block.append(title);

  let subtitleEl: HTMLParagraphElement | null = null;
  if (subtitle) {
    subtitleEl = document.createElement("p");
    subtitleEl.className = "page-subtitle";
    subtitleEl.textContent = subtitle;
    block.append(subtitleEl);
  }

  header.append(block);

  const actionsList = Array.isArray(actions) ? actions : actions ? [actions] : [];
  let actionsEl: HTMLElement | null = null;
  if (actionsList.length > 0) {
    actionsEl = document.createElement("div");
    actionsEl.className = "page-header-actions";
    for (const action of actionsList) actionsEl.append(action);
    header.append(actionsEl);
  }

  // Apply the initial collapsed state. We mutate the same DOM the toggle
  // handler will mutate later, so first paint matches whatever the user
  // had pinned/dismissed in storage — no flash of expanded content on the
  // 11th visit, no flash of collapsed content if they re-expanded earlier.
  const applyCollapsedState = (collapsed: boolean): void => {
    header.classList.toggle("is-collapsed", collapsed);
    eyebrowButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
    eyebrowButton.title = collapsed ? "Expand intro" : "Collapse intro";
    title.hidden = collapsed;
    if (subtitleEl) subtitleEl.hidden = collapsed;
    if (actionsEl) actionsEl.hidden = collapsed;
  };

  const initialEntry = getIntroEntry(initialStore, pageId);
  let collapsed = isIntroCollapsed(initialEntry, { noAutoFade });
  applyCollapsedState(collapsed);

  eyebrowButton.addEventListener("click", () => {
    // Re-load so we don't trample concurrent updates from another tab —
    // the toggle is rare enough that the extra read is invisible, and it
    // keeps the per-page state consistent across windows.
    const current = loadIntroStore();
    const next = toggleIntroCollapse(current, pageId, collapsed);
    persistIntroStore(next);
    collapsed = isIntroCollapsed(getIntroEntry(next, pageId), { noAutoFade });
    applyCollapsedState(collapsed);
  });

  return header;
}
