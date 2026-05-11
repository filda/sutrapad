import { buildNoteMetadata } from "../../logic/note-metadata";
import { detectKind } from "../../../lib/detect-kind";
import type { SutraPadDocument } from "../../../types";
import { EMPTY_COPY, buildEmptyState } from "./empty-state";
import { buildKindChipForNote } from "./kind-chip";

export interface EditorCardOptions {
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  /**
   * Active filters are only consulted to pick the right empty state copy:
   * when there's no match, we tell the user a filter is the reason rather
   * than falling through to the blank writing surface. The filter *chips*
   * themselves live in the topbar tag-filter strip now, so the editor card
   * no longer owns their presentation.
   */
  selectedTagFilters: string[];
  onTitleInput: (value: string) => void;
  /**
   * Fires on body input AND on body blur. `caretPosition` is the
   * textarea's `selectionStart` for keystroke events; `undefined`
   * means "no caret restriction" — used on blur so any in-flight
   * hashtag the user was typing commits when they leave the
   * textarea. Passing the caret through on keystrokes lets the
   * hashtag-merge step in `render-callbacks` tell "user is still
   * typing this tag" (caret sits at the matched `#tag` end) from
   * "user moved past it" (caret has left). Without it, inserting
   * `#auto` between two existing words commits `#a` / `#au` /
   * `#aut` / `#auto` progressively as each prefix passes the regex
   * lookahead against the downstream prose.
   */
  onBodyInput: (value: string, caretPosition: number | undefined) => void;
  /**
   * Called after every title/body keystroke with the current (not yet
   * persisted) values. The right-rail sidebar no longer owns live stats
   * (those moved to the detail-topbar breadcrumbs and only refresh on
   * the next render pass), so the remaining live consumer is the kind
   * chip — which lives inside this card. Kept as an optional callback
   * so future live-derived surfaces can attach without rewiring every
   * call site.
   */
  onInputsChange?: (title: string, body: string) => void;
}

/**
 * Pure writing-surface card: kind chip → title → body → metadata footer.
 * The status row, user-tag editor, and auto-detected tag strip all moved
 * out — the status row is folded into the detail-topbar's sync crumb,
 * and both tag UIs now live in the right-rail sidebar so vertical space
 * inside the card stays dedicated to the prose the user is writing.
 */
export function buildEditorCard({
  note,
  currentNote,
  selectedTagFilters,
  onTitleInput,
  onBodyInput,
  onInputsChange,
}: EditorCardOptions): HTMLElement {
  const editor = document.createElement("section");
  editor.className = "editor-card detail-editor";

  if (!note && selectedTagFilters.length > 0) {
    // Inline filter-miss in the editor column. We reuse the shared
    // `.empty-state` shell so the look matches the notes-list miss on
    // the same screen — two empty cards side-by-side would otherwise
    // feel inconsistent.
    const emptyEditor = buildEmptyState({ ...EMPTY_COPY.notes_filtered });
    emptyEditor.classList.add("empty-editor-state");
    editor.append(emptyEditor);
    return editor;
  }

  const displayedNote = note ?? currentNote;

  const kindChip = buildKindChipForNote(displayedNote.title, displayedNote.body);

  const titleInput = document.createElement("input");
  titleInput.className = "title-input editor-title";
  titleInput.placeholder = "Note title";
  titleInput.value = displayedNote.title;

  const bodyInput = document.createElement("textarea");
  bodyInput.className = "body-input editor-body";
  bodyInput.placeholder = "Start writing...";
  bodyInput.value = displayedNote.body;

  // After any keystroke we recompute the kind chip in place rather than
  // going through an outer render pass — the outer pass is skipped on
  // most keystrokes (it would thrash the textarea's caret / IME state).
  // `setKind` no-ops when the displayed kind hasn't changed, so the DOM
  // stays still unless something actually crossed a threshold. The
  // optional onInputsChange callback fires too so any future live-derived
  // surface (none today) can hook in without a second listener.
  const refreshLiveDerived = (): void => {
    const title = titleInput.value;
    const body = bodyInput.value;
    kindChip.setKind(detectKind({ title, body }));
    onInputsChange?.(title, body);
  };
  titleInput.addEventListener("input", () => {
    onTitleInput(titleInput.value);
    refreshLiveDerived();
  });
  bodyInput.addEventListener("input", () => {
    // `selectionStart` is the caret position immediately after the
    // input event; passing it lets `onBodyInput` decide which (if any)
    // hashtag the user is still mid-typing. Falls back to the value
    // length when the textarea reports `null` (very old engines /
    // detached state) so a missing caret never *looks* like position 0.
    const caret = bodyInput.selectionStart ?? bodyInput.value.length;
    onBodyInput(bodyInput.value, caret);
    refreshLiveDerived();
  });
  bodyInput.addEventListener("blur", () => {
    // Caret-aware extraction during typing intentionally holds back the
    // hashtag whose end sits exactly at the caret — the user is still
    // typing it. When focus leaves the textarea (clicked elsewhere,
    // tabbed away, navigated) the user is *done* with whatever they
    // were typing, so we re-run the merge with no caret restriction
    // so any in-flight tag commits naturally. Re-running for `value`
    // alone is safe because `mergeHashtagsIntoTags` is idempotent —
    // already-committed tags dedupe inside the merger.
    onBodyInput(bodyInput.value, undefined);
  });

  const noteMetadata = document.createElement("p");
  noteMetadata.className = "note-metadata";
  noteMetadata.textContent = buildNoteMetadata(displayedNote);

  editor.append(kindChip.element, titleInput, bodyInput, noteMetadata);

  return editor;
}
