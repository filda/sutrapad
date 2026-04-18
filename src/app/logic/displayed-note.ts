import { filterNotesByAllTags } from "../../lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace } from "../../types";

export function resolveDisplayedNote(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
): SutraPadDocument | null {
  const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
  if (filteredNotes.length === 0) {
    return null;
  }

  return filteredNotes.find((note) => note.id === workspace.activeNoteId) ?? filteredNotes[0];
}
