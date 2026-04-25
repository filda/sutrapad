/**
 * Focus / caret-preservation wrappers around the synchronous render
 * pass. The editor card is rebuilt wholesale on every render, so the
 * `<input>` and `<textarea>` references the user is typing into get
 * replaced; without these wrappers, focus and caret position drop on
 * every keystroke that triggers a full render.
 *
 * Each helper takes the render function as a parameter (rather than
 * importing it) so it can be reused by anything that needs a
 * focus-preserving render — render-callbacks today, possibly other
 * UI surfaces tomorrow.
 */

/**
 * `render()` rebuilds the editor card wholesale, so the tag <input>
 * gets replaced and its focus/caret are dropped. For tag add/remove
 * interactions the user expects to keep typing more tags, so we
 * detect whether focus (or a recent click) came from the tag row
 * and, if so, move focus to the freshly rendered input after the
 * DOM swap.
 */
export function renderPreservingTagInputFocus(render: () => void): void {
  const active = document.activeElement;
  // `.tag-x` now appears on the topbar filter bar too, so scope the
  // lookup to the editor card — otherwise removing a topbar filter
  // would yank focus into the editor every time.
  const shouldRefocus =
    active instanceof HTMLElement &&
    active.closest(".editor-card") !== null &&
    (active.classList.contains("tag-text-input") ||
      active.classList.contains("tag-x") ||
      active.classList.contains("tag-suggestion"));

  render();

  if (shouldRefocus) {
    const nextInput = document.querySelector<HTMLInputElement>(
      ".editor-card .tag-text-input",
    );
    nextInput?.focus();
  }
}

/**
 * Auto-parsing hashtags from the body forces a full render when a new
 * tag appears (so the tag chips update), and a full render rebuilds
 * the <textarea> — dropping focus and the caret position. We capture
 * selection before the swap and restore it on the freshly-rendered
 * node so the user's typing flow is not interrupted mid-word.
 */
export function renderPreservingBodyInputFocus(render: () => void): void {
  const active = document.activeElement;
  const wasBodyActive =
    active instanceof HTMLTextAreaElement && active.classList.contains("body-input");
  const savedStart = wasBodyActive ? active.selectionStart : 0;
  const savedEnd = wasBodyActive ? active.selectionEnd : 0;

  render();

  if (wasBodyActive) {
    const nextTextarea =
      document.querySelector<HTMLTextAreaElement>(".editor-card .body-input");
    if (nextTextarea) {
      nextTextarea.focus();
      nextTextarea.setSelectionRange(savedStart, savedEnd);
    }
  }
}
