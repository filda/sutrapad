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

/**
 * Snapshot of which editor input was focused before a render and what
 * caret / IME state it carried. The companion `restore` function
 * re-applies that state to the freshly rendered DOM. Split into a
 * capture/restore pair (rather than wrapping the render call itself)
 * so `render()` in `app.ts` can hold the snapshot across its own try
 * / finally — focus restoration runs after the rebuild even when an
 * exception unwinds the render mid-flight.
 */
export interface ActiveEditorFocusSnapshot {
  restore(): void;
}

/**
 * Captures focus + caret on the title / body / tag-input the user is
 * currently editing (if any) so a subsequent render can put them back
 * exactly where they were. Returning a `restore` closure keeps the
 * captured values out of any module-level state — multiple renders in
 * flight (re-entrant or HMR-overlapped) each get their own snapshot.
 *
 * `restore` is a no-op when focus was anywhere outside the editor
 * card, which means it's safe to call unconditionally — every
 * `render()` pass takes a snapshot, runs the rebuild, and restores
 * without having to reason about whether the user was actually in an
 * editor input.
 */
export function captureActiveEditorFocus(): ActiveEditorFocusSnapshot {
  const active = document.activeElement;
  const isTitle =
    active instanceof HTMLInputElement && active.classList.contains("title-input");
  const isBody =
    active instanceof HTMLTextAreaElement && active.classList.contains("body-input");
  const isTag =
    active instanceof HTMLInputElement && active.classList.contains("tag-text-input");

  // Reading selectionStart on a non-text input throws in some engines,
  // so we gate it on the matched type rather than a broad union.
  const savedStart = isTitle || isBody ? active.selectionStart : 0;
  const savedEnd = isTitle || isBody ? active.selectionEnd : 0;
  const savedTagValue = isTag ? active.value : "";

  return {
    restore: () => {
      if (isTitle) {
        const nextTitle = document.querySelector<HTMLInputElement>(
          ".editor-card .title-input",
        );
        if (nextTitle && document.activeElement !== nextTitle) {
          nextTitle.focus();
          nextTitle.setSelectionRange(savedStart, savedEnd);
        }
        return;
      }
      if (isBody) {
        const nextBody = document.querySelector<HTMLTextAreaElement>(
          ".editor-card .body-input",
        );
        if (nextBody && document.activeElement !== nextBody) {
          nextBody.focus();
          nextBody.setSelectionRange(savedStart, savedEnd);
        }
        return;
      }
      if (isTag) {
        const nextTag = document.querySelector<HTMLInputElement>(
          ".editor-card .tag-text-input",
        );
        if (nextTag && document.activeElement !== nextTag) {
          nextTag.focus();
          // The tag typeahead value is pure text-as-you-type —
          // restoring it (in case render rebuilt it from workspace
          // state and wiped the in-flight token) keeps the user's
          // draft tag visible.
          if (savedTagValue && nextTag.value !== savedTagValue) {
            nextTag.value = savedTagValue;
          }
        }
      }
    },
  };
}

/**
 * Generalised focus preserver for any of the three editor-card inputs
 * — title, body, or the tag typeahead. Kept as a thin
 * capture/render/restore wrapper for call sites that drive the render
 * synchronously themselves (e.g. `handleNewNoteCreation`'s post-
 * geolocation backfill). The shared focus snapshot lives in
 * `captureActiveEditorFocus`; the global `render()` pass uses the same
 * primitive so every render is implicitly focus-safe.
 *
 * The render is driven synchronously here rather than letting the
 * atom subscriber fire its own microtask render: doing the rebuild
 * + focus restore in one synchronous turn means the microtask sees
 * `renderScheduled === false` (set in `render()`'s `finally`) and
 * skips, so we don't pay for a second render pass.
 */
export function renderPreservingActiveEditorFocus(render: () => void): void {
  const snapshot = captureActiveEditorFocus();
  render();
  snapshot.restore();
}
