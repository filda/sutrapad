import { confidenceForAutoTag } from "../../logic/auto-tag-confidence";
import { deriveAutoTags } from "../../../lib/auto-tags";
import type { SutraPadDocument, SutraPadTagEntry } from "../../../types";
import { buildTagInput } from "./tag-input";
import { buildTagPill } from "./tag-pill";

/**
 * Right-rail sidebar rendered next to the detail editor on the note
 * detail route. Two cards: user-editable Tags (with the autocomplete
 * combobox) and a read-only Auto-detected strip. The previous Stats /
 * How-this-gets-saved / Other-ways-to-capture trio is gone — stats live
 * in the detail-topbar breadcrumbs now, and the two onboarding cards
 * were redundant for an established user.
 *
 * The sidebar rebuilds on every render pass (no live-update handle):
 * adding or removing a tag triggers a full re-render via the existing
 * `onAddTag` / `onRemoveTag` round-trip, and auto-tags only derive from
 * capture metadata (which doesn't mutate during editing), so there's
 * nothing keystroke-driven to refresh in place.
 */

export interface EditorSidebarOptions {
  /**
   * Source of truth for both surfaces: the tag list driving the chips
   * inside the combobox, and the capture-metadata that
   * `deriveAutoTags` reads for the auto-detected pills below.
   */
  currentNote: SutraPadDocument;
  availableTagSuggestions: readonly SutraPadTagEntry[];
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
}

export function buildEditorSidebar({
  currentNote,
  availableTagSuggestions,
  onAddTag,
  onRemoveTag,
}: EditorSidebarOptions): HTMLElement {
  const aside = document.createElement("aside");
  aside.className = "editor-sidebar";

  aside.append(buildTagsCard(currentNote, availableTagSuggestions, onAddTag, onRemoveTag));

  const autoCard = buildAutoDetectedCard(currentNote);
  if (autoCard) aside.append(autoCard);

  return aside;
}

function buildTagsCard(
  note: SutraPadDocument,
  availableTagSuggestions: readonly SutraPadTagEntry[],
  onAddTag: (value: string) => void,
  onRemoveTag: (tag: string) => void,
): HTMLElement {
  const card = document.createElement("section");
  card.className = "editor-sidebar-card editor-sidebar-tags-card";

  const eyebrow = document.createElement("p");
  eyebrow.className = "editor-sidebar-eyebrow";
  eyebrow.textContent = "Tags";

  card.append(eyebrow, buildTagInput(note, availableTagSuggestions, onAddTag, onRemoveTag));
  return card;
}

/**
 * Read-only "Auto-detected" card — a pill grid summarising the auto-tags
 * the current note picks up from its metadata (`captureContext`,
 * `createdAt`, `location`, …). The pills are derived, not stored, so
 * there's no accept/dismiss affordance: the user can't "commit" an
 * auto-tag into `note.tags` because it's already available anywhere
 * auto-tags are rendered (Tags page, topbar filter bar). The card
 * exists purely to surface *which* auto-tags are attached and flag
 * low-confidence reads with a `NN%` badge.
 *
 * Returns `null` when the note has no auto-tags (drafts without capture
 * context, empty home notes) so the sidebar doesn't carry an empty
 * card with just a "nothing to show" eyebrow.
 */
function buildAutoDetectedCard(note: SutraPadDocument): HTMLElement | null {
  const autoTags = deriveAutoTags(note);
  if (autoTags.length === 0) return null;

  const card = document.createElement("section");
  card.className = "editor-sidebar-card editor-sidebar-auto-card";

  const eyebrow = document.createElement("p");
  eyebrow.className = "editor-sidebar-eyebrow";
  eyebrow.textContent = "Auto-detected";

  const grid = document.createElement("div");
  grid.className = "editor-sidebar-auto-grid";

  for (const tag of autoTags) {
    grid.append(
      buildTagPill({
        tag,
        kind: "auto",
        confidence: confidenceForAutoTag(tag),
      }),
    );
  }

  card.append(eyebrow, grid);
  return card;
}
