import { confidenceForAutoTag } from "../../logic/auto-tag-confidence";
import { buildNoteMetadata } from "../../logic/note-metadata";
import { deriveAutoTags } from "../../../lib/auto-tags";
import { detectKind } from "../../../lib/detect-kind";
import type { SutraPadDocument, SutraPadTagEntry } from "../../../types";
import type { SyncState } from "../../session/workspace-sync";
import { EMPTY_COPY, buildEmptyState } from "./empty-state";
import { buildKindChipForNote } from "./kind-chip";
import { buildTagInput } from "./tag-input";
import { buildTagPill } from "./tag-pill";

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
  availableTagSuggestions: readonly SutraPadTagEntry[];
  syncState: SyncState;
  statusText: string;
  onTitleInput: (value: string) => void;
  onBodyInput: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
  /**
   * Called after every title/body keystroke with the current (not yet
   * persisted) values. Used by the right-rail sidebar to update its
   * Stats card live without going through the outer render cycle —
   * which is intentionally skipped between keystrokes to preserve
   * textarea caret/IME state.
   */
  onInputsChange?: (title: string, body: string) => void;
}

export function buildEditorCard({
  note,
  currentNote,
  selectedTagFilters,
  availableTagSuggestions,
  syncState,
  statusText,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
  onInputsChange,
}: EditorCardOptions): HTMLElement {
  const editor = document.createElement("section");
  editor.className = "editor-card detail-editor";

  const status = document.createElement("p");
  status.className = `status status-${syncState}`;
  status.textContent = statusText;

  if (!note && selectedTagFilters.length > 0) {
    // Inline filter-miss in the editor column. We reuse the shared
    // `.empty-state` shell so the look matches the notes-list miss on
    // the same screen — two empty cards side-by-side would otherwise
    // feel inconsistent.
    const emptyEditor = buildEmptyState({ ...EMPTY_COPY.notes_filtered });
    emptyEditor.classList.add("empty-editor-state");
    editor.append(status, emptyEditor);
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

  // After any keystroke we need to (a) recompute the kind chip and
  // (b) let the sidebar's live-stats card re-read the numbers. Both
  // happen via in-place DOM mutation rather than an outer render pass,
  // because the outer pass is deliberately skipped on most keystrokes
  // (it would thrash the textarea's caret / IME state). `setKind` /
  // the sidebar's update handler both no-op when their displayed
  // values haven't changed, so the DOM stays still unless something
  // actually crossed a threshold.
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
    onBodyInput(bodyInput.value);
    refreshLiveDerived();
  });

  const noteMetadata = document.createElement("p");
  noteMetadata.className = "note-metadata";
  noteMetadata.textContent = buildNoteMetadata(displayedNote);

  editor.append(
    status,
    kindChip.element,
    titleInput,
    buildTagInput(displayedNote, availableTagSuggestions, onAddTag, onRemoveTag),
  );

  const autoStrip = buildAutoDetectedStrip(displayedNote);
  if (autoStrip) editor.append(autoStrip);

  editor.append(bodyInput, noteMetadata);

  return editor;
}

/**
 * "Auto-detected" strip — a read-only row of pills summarising the auto-tags
 * the current note picks up from its metadata (`captureContext`, `createdAt`,
 * `location`, …). Mirrors the handoff's `.suggested-strip` below the tag
 * input, with one deliberate simplification: the pills are derived, not
 * stored, so there's no accept/dismiss affordance — the user can't "commit"
 * an auto-tag into `note.tags` because it's already available anywhere
 * auto-tags are rendered (Tags page, topbar filter bar). The strip exists
 * purely to surface *which* auto-tags are attached and flag low-confidence
 * reads with a `NN%` badge.
 *
 * Returns `null` when the note has no auto-tags (empty notes on the Home
 * page, drafts without capture context). That keeps the editor quiet for
 * notes where the eyebrow would mean nothing.
 */
function buildAutoDetectedStrip(note: SutraPadDocument): HTMLElement | null {
  const autoTags = deriveAutoTags(note);
  if (autoTags.length === 0) return null;

  const strip = document.createElement("div");
  strip.className = "editor-auto-tags";

  const eyebrow = document.createElement("span");
  eyebrow.className = "editor-auto-tags-label";
  eyebrow.textContent = "Auto-detected";
  strip.append(eyebrow);

  for (const tag of autoTags) {
    strip.append(
      buildTagPill({
        tag,
        kind: "auto",
        confidence: confidenceForAutoTag(tag),
      }),
    );
  }

  return strip;
}
