/**
 * No-op guards for note editor input handlers.
 *
 * Background — the bug class these protect against
 * -----------------------------------------------
 * The body textarea wires both `input` and `blur` to the same
 * `onBodyInput` callback. The blur path is intentional: when the user
 * leaves the textarea, any `#tag` they were mid-typing (held back by
 * the caret-aware extractor while the caret sat at its end) commits
 * naturally. The downside is that `blur` *also* fires whenever the
 * focused textarea is detached from the DOM — which happens on every
 * full `render()` pass, because `renderAppPage` empties
 * `root.innerHTML` before rebuilding.
 *
 * Without a guard, every render-during-focus produces a blur event
 * whose value is identical to the note's current body. The handler
 * then stamps a fresh `updatedAt`, persists the workspace, and
 * schedules a 2s Drive autosave — all for a phantom edit. Beyond the
 * wasted Drive round-trip, the bumped `updatedAt` corrupts the
 * cross-device merge tie-breaker (`applyDriveRefresh` /
 * `mergeWorkspaces` pick the side with the larger `updatedAt`),
 * which can silently mask a real edit made on another device.
 *
 * These helpers detect the no-op case from a pure-data perspective so
 * the render-callbacks wiring can bail before touching state.
 */

import { mergeHashtagsIntoTags } from "../../lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";

/**
 * Resolves the note an editor input/blur handler should target.
 *
 * When the caller supplies `noteId`, the resolver looks up that
 * specific note in the workspace and returns it (or `null` when the
 * id no longer matches — e.g. a refresh dropped the note before the
 * trailing event landed). This is the "pinned target" path used by
 * `editor-card.ts` and the hero title in `render-app.ts`: the input
 * captures the id of the note it was mounted for at build time, then
 * passes it through every emission so the write doesn't follow
 * `activeNoteId` if that has since shifted.
 *
 * When `noteId` is `undefined`, the resolver falls back to the active
 * note (with the same `notes[0]` fallback `getCurrentWorkspaceNote`
 * uses, so callers that haven't been migrated to the pinned-id flow
 * keep their previous behaviour). Returns `null` only for a truly
 * empty workspace — the no-op guard in the callbacks expects that.
 *
 * Pure / DOM-free so the no-op detection on either side stays
 * unit-testable without a DOM setup.
 */
export function resolveEditTargetNote(
  workspace: SutraPadWorkspace,
  noteId: string | undefined,
): SutraPadDocument | null {
  if (noteId !== undefined) {
    return workspace.notes.find((entry) => entry.id === noteId) ?? null;
  }
  const active = workspace.notes.find(
    (entry) => entry.id === workspace.activeNoteId,
  );
  return active ?? workspace.notes[0] ?? null;
}

/**
 * `true` when the candidate title matches the note's current title
 * exactly. Whitespace is intentionally not trimmed: the user might
 * have added a trailing space and that *is* a real edit (the title
 * input renders the value verbatim, so the difference is user-visible
 * if they later place their caret there). Same-string identity is the
 * only safe "nothing changed" signal at this layer.
 */
export function isTitleEditNoOp(note: SutraPadDocument, value: string): boolean {
  return value === note.title;
}

/**
 * Result of evaluating a candidate body edit against the note's
 * current body + tags. `mergedTags` is returned alongside the verdict
 * so the caller can hand it to `replaceCurrentNote` without re-running
 * `mergeHashtagsIntoTags` — the merge has caret-position semantics and
 * the cost of running it twice would mean either a redundant scan or
 * subtle drift if the two runs disagreed.
 */
export interface BodyEditEvaluation {
  /**
   * `true` when applying `value` would not change body OR tags. URLs
   * are derived deterministically from body, so a same-body verdict
   * implies same-urls without a separate check.
   */
  isNoOp: boolean;
  /**
   * The tags array that would result from committing this edit.
   * Always returned (even on `isNoOp: true`) so callers don't have to
   * special-case the lookup; on a no-op it equals `note.tags`
   * element-for-element.
   */
  mergedTags: readonly string[];
  /**
   * `true` when `mergedTags` is longer than `note.tags` — i.e. a
   * hashtag from the body was just promoted to the tag list. Used by
   * the editor to decide between a full re-render (new tag chip) and
   * an inline notes-panel refresh.
   */
  tagsChanged: boolean;
}

/**
 * Evaluates a candidate body input against the note's current state.
 * Two layers of decision live here:
 *
 *   1. Tag promotion — `mergeHashtagsIntoTags` walks the body and
 *      appends any `#tag` not already on the note. `caretPosition`
 *      forwards the caret semantics so a tag-being-typed (`#auto`
 *      while the caret sits at its end) is held back until the user
 *      moves past it or blurs the textarea (caretPosition: undefined).
 *
 *   2. No-op detection — if the value matches the current body *and*
 *      no new tag was promoted, the edit is a phantom and should be
 *      dropped before any state mutation. This is the guard that
 *      kills the render-detach blur cascade.
 *
 * `mergeHashtagsIntoTags` is documented to only *append* (it never
 * removes or reorders), so a length comparison is sufficient — a
 * shorter result is impossible by construction. Deep equality would
 * be a more conservative check, but it would also pay a per-keystroke
 * walk for a property the producer already guarantees.
 */
export function evaluateBodyEdit(
  note: SutraPadDocument,
  value: string,
  caretPosition: number | undefined,
): BodyEditEvaluation {
  const mergedTags = mergeHashtagsIntoTags(note.tags, value, { caretPosition });
  const tagsChanged = mergedTags.length !== note.tags.length;
  const isNoOp = value === note.body && !tagsChanged;
  return { isNoOp, mergedTags, tagsChanged };
}
