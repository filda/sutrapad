// @vitest-environment happy-dom
//
// First focused test for `src/app/render-helpers.ts` — the focus / caret
// preservation layer around the synchronous render pass. Every render rebuilds
// the editor card wholesale, so the `<input>` / `<textarea>` the user is typing
// into is replaced mid-keystroke; these helpers are the only reason focus and
// caret survive that. Nothing measured them until now, and the failure mode is
// nasty precisely because it is invisible to a DOM-shape assertion: the app
// renders perfectly, it just spits the user out of the field they were typing
// in (or, worse, yanks focus into the editor from somewhere else entirely).
//
// The test shape throughout: build the "before" DOM, focus something, hand the
// helper a `render` fake that replaces the DOM the way a real render would,
// then assert where focus and the caret ended up. A fake that *doesn't* swap
// the nodes wouldn't exercise anything — the whole point is surviving the swap.
//
// Two survivors in the mutation report are equivalent: the `: ""` else-branch
// of `savedTagValue` (only ever read inside the `isTag` branch of `restore`,
// which that value can't reach), and the second half of
// `savedTagValue && nextTag.value !== savedTagValue` — with it forced true the
// assignment still writes the value the input already holds.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureActiveEditorFocus,
  renderPreservingActiveEditorFocus,
  renderPreservingBodyInputFocus,
  renderPreservingTagInputFocus,
} from "../src/app/render-helpers";

/** Markup close enough to the editor card for the `closest()` scoping. */
const EDITOR_CARD = `
  <div class="topbar">
    <button class="tag-x" id="topbar-tag-x">×</button>
  </div>
  <div class="editor-card">
    <input class="title-input" value="První">
    <textarea class="body-input">tělo</textarea>
    <div class="tag-row">
      <input class="tag-text-input" value="pra">
      <button class="tag-x" id="editor-tag-x">×</button>
      <button class="tag-suggestion">praha</button>
    </div>
  </div>
`;

/**
 * A render fake that rebuilds the DOM from scratch — the swap these helpers
 * exist to survive. Returns a spy so call counts stay assertable.
 */
function swappingRender(html: string = EDITOR_CARD) {
  return vi.fn(() => {
    document.body.innerHTML = html;
  });
}

const query = <T extends Element>(selector: string): T | null =>
  document.querySelector<T>(selector);

beforeEach(() => {
  document.body.innerHTML = EDITOR_CARD;
});

describe("renderPreservingTagInputFocus", () => {
  it("puts focus back on the freshly rendered tag input", () => {
    query<HTMLInputElement>(".editor-card .tag-text-input")?.focus();
    const before = query(".editor-card .tag-text-input");
    const render = swappingRender();

    renderPreservingTagInputFocus(render);

    expect(render).toHaveBeenCalledOnce();
    const after = query(".editor-card .tag-text-input");
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });

  it("refocuses after removing a tag chip inside the editor", () => {
    // The user is mid-flow adding tags; clicking the chip's × should leave
    // them able to keep typing.
    query<HTMLElement>("#editor-tag-x")?.focus();
    const render = swappingRender();

    renderPreservingTagInputFocus(render);

    expect(document.activeElement).toBe(query(".editor-card .tag-text-input"));
  });

  it("refocuses after clicking a tag suggestion", () => {
    query<HTMLElement>(".tag-suggestion")?.focus();

    renderPreservingTagInputFocus(swappingRender());

    expect(document.activeElement).toBe(query(".editor-card .tag-text-input"));
  });

  it("leaves focus alone when the × came from the topbar filter bar", () => {
    // `.tag-x` also appears on the topbar filter strip. Without the
    // `.editor-card` scoping, removing a topbar filter would yank the caret
    // into the editor on every click.
    query<HTMLElement>("#topbar-tag-x")?.focus();

    renderPreservingTagInputFocus(swappingRender());

    expect(document.activeElement).not.toBe(query(".editor-card .tag-text-input"));
  });

  it("leaves focus alone when the gesture came from outside the tag row", () => {
    query<HTMLElement>(".editor-card .title-input")?.focus();

    renderPreservingTagInputFocus(swappingRender());

    expect(document.activeElement).not.toBe(query(".editor-card .tag-text-input"));
  });

  it("still renders when the rebuild mounts no tag input", () => {
    query<HTMLInputElement>(".editor-card .tag-text-input")?.focus();
    const render = swappingRender('<div class="editor-card"></div>');

    expect(() => renderPreservingTagInputFocus(render)).not.toThrow();
    expect(render).toHaveBeenCalledOnce();
  });
});

describe("renderPreservingBodyInputFocus", () => {
  it("restores the caret position inside the rebuilt textarea", () => {
    const body = query<HTMLTextAreaElement>(".body-input");
    body?.focus();
    body?.setSelectionRange(2, 3);
    const render = swappingRender();

    renderPreservingBodyInputFocus(render);

    const after = query<HTMLTextAreaElement>(".editor-card .body-input");
    expect(after).not.toBe(body);
    expect(document.activeElement).toBe(after);
    expect(after?.selectionStart).toBe(2);
    expect(after?.selectionEnd).toBe(3);
  });

  it("does not steal focus when the body was not the active element", () => {
    query<HTMLInputElement>(".title-input")?.focus();

    renderPreservingBodyInputFocus(swappingRender());

    expect(document.activeElement).not.toBe(query(".editor-card .body-input"));
  });

  it("still renders when the rebuild mounts no textarea", () => {
    query<HTMLTextAreaElement>(".body-input")?.focus();
    const render = swappingRender('<div class="editor-card"></div>');

    expect(() => renderPreservingBodyInputFocus(render)).not.toThrow();
    expect(render).toHaveBeenCalledOnce();
  });
});

describe("captureActiveEditorFocus", () => {
  it("restores the title input and its caret", () => {
    const title = query<HTMLInputElement>(".title-input");
    title?.focus();
    title?.setSelectionRange(1, 4);
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = EDITOR_CARD;
    snapshot.restore();

    const after = query<HTMLInputElement>(".editor-card .title-input");
    expect(document.activeElement).toBe(after);
    expect(after?.selectionStart).toBe(1);
    expect(after?.selectionEnd).toBe(4);
  });

  it("restores the detail-route hero title, which is a textarea", () => {
    // The hero title wraps long titles, so it is a `<textarea>` rather than an
    // `<input>`; it lives outside the editor card and needs its own branch.
    document.body.innerHTML = '<textarea class="note-detail-hero-title">Dlouhý titul</textarea>';
    const hero = query<HTMLTextAreaElement>(".note-detail-hero-title");
    hero?.focus();
    hero?.setSelectionRange(3, 3);
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = '<textarea class="note-detail-hero-title">Dlouhý titul</textarea>';
    snapshot.restore();

    const after = query<HTMLTextAreaElement>(".note-detail-hero-title");
    expect(document.activeElement).toBe(after);
    expect(after?.selectionStart).toBe(3);
  });

  it("restores the body textarea and its caret", () => {
    const body = query<HTMLTextAreaElement>(".body-input");
    body?.focus();
    body?.setSelectionRange(4, 4);
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = EDITOR_CARD;
    snapshot.restore();

    const after = query<HTMLTextAreaElement>(".editor-card .body-input");
    expect(document.activeElement).toBe(after);
    expect(after?.selectionStart).toBe(4);
  });

  it("carries the in-flight tag text across the rebuild", () => {
    // The tag typeahead value is pure text-as-you-type and is not in the
    // workspace yet, so a render that rebuilds the input from state would
    // wipe the half-typed token.
    const tagInput = query<HTMLInputElement>(".tag-text-input");
    if (tagInput) tagInput.value = "prah";
    tagInput?.focus();
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = EDITOR_CARD;
    snapshot.restore();

    const after = query<HTMLInputElement>(".editor-card .tag-text-input");
    expect(document.activeElement).toBe(after);
    expect(after?.value).toBe("prah");
  });

  it("leaves a tag input whose value already survived alone", () => {
    const tagInput = query<HTMLInputElement>(".tag-text-input");
    tagInput?.focus();
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = EDITOR_CARD;
    snapshot.restore();

    // "pra" came back from the markup, so there is nothing to re-apply.
    expect(query<HTMLInputElement>(".editor-card .tag-text-input")?.value).toBe("pra");
  });

  it("is a no-op when focus was outside the editor inputs", () => {
    // Called unconditionally on every render pass, so the "nobody was typing"
    // path has to leave the document exactly as the rebuild left it.
    query<HTMLElement>("#topbar-tag-x")?.focus();
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = EDITOR_CARD;
    snapshot.restore();

    expect(document.activeElement).toBe(document.body);
  });

  it("does not re-focus an element that already has focus", () => {
    // The guard matters for the caret: re-focusing a field the user is in
    // would re-apply the saved range over one they have since moved.
    const title = query<HTMLInputElement>(".title-input");
    title?.focus();
    title?.setSelectionRange(0, 0);
    const snapshot = captureActiveEditorFocus();

    title?.setSelectionRange(3, 3);
    snapshot.restore();

    expect(title?.selectionStart).toBe(3);
  });

  it("does not re-focus the hero title that already has focus", () => {
    document.body.innerHTML = '<textarea class="note-detail-hero-title">Dlouhý titul</textarea>';
    const hero = query<HTMLTextAreaElement>(".note-detail-hero-title");
    hero?.focus();
    hero?.setSelectionRange(0, 0);
    const snapshot = captureActiveEditorFocus();

    hero?.setSelectionRange(4, 4);
    snapshot.restore();

    expect(hero?.selectionStart).toBe(4);
  });

  it("does not re-focus the body textarea that already has focus", () => {
    const body = query<HTMLTextAreaElement>(".body-input");
    body?.focus();
    body?.setSelectionRange(0, 0);
    const snapshot = captureActiveEditorFocus();

    body?.setSelectionRange(3, 3);
    snapshot.restore();

    expect(body?.selectionStart).toBe(3);
  });

  it("does not re-apply the tag text to an input that kept its focus", () => {
    // The user typed one more character after the snapshot; the restore must
    // not roll their input back to the captured value.
    const tagInput = query<HTMLInputElement>(".tag-text-input");
    if (tagInput) tagInput.value = "prah";
    tagInput?.focus();
    const snapshot = captureActiveEditorFocus();

    if (tagInput) tagInput.value = "praha";
    snapshot.restore();

    expect(tagInput?.value).toBe("praha");
  });

  it("does not blank a rebuilt tag input when nothing was in flight", () => {
    // Focus was in the empty tag field, so there is no draft token to carry.
    // Writing the captured empty string over the rebuilt value would wipe
    // whatever the render put there.
    const tagInput = query<HTMLInputElement>(".tag-text-input");
    if (tagInput) tagInput.value = "";
    tagInput?.focus();
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = EDITOR_CARD.replace('class="tag-text-input" value="pra"', 'class="tag-text-input" value="praha"');
    snapshot.restore();

    expect(query<HTMLInputElement>(".editor-card .tag-text-input")?.value).toBe("praha");
  });

  it("survives a rebuild that drops the captured input entirely", () => {
    query<HTMLInputElement>(".title-input")?.focus();
    const snapshot = captureActiveEditorFocus();

    document.body.innerHTML = "<div></div>";

    expect(() => snapshot.restore()).not.toThrow();
  });
});

describe("renderPreservingActiveEditorFocus", () => {
  it("captures before the render and restores after it", () => {
    const body = query<HTMLTextAreaElement>(".body-input");
    body?.focus();
    body?.setSelectionRange(1, 1);
    const render = swappingRender();

    renderPreservingActiveEditorFocus(render);

    expect(render).toHaveBeenCalledOnce();
    const after = query<HTMLTextAreaElement>(".editor-card .body-input");
    expect(document.activeElement).toBe(after);
    expect(after?.selectionStart).toBe(1);
  });

  it("renders without touching focus when no editor input was active", () => {
    const render = swappingRender();

    renderPreservingActiveEditorFocus(render);

    expect(render).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.body);
  });
});
