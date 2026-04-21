import { filterNotesByTags } from "../../lib/notebook";
import type {
  SutraPadDocument,
  SutraPadTagFilterMode,
  SutraPadWorkspace,
} from "../../types";

export function resolveDisplayedNote(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  filterMode: SutraPadTagFilterMode = "all",
): SutraPadDocument | null {
  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    filterMode,
  );
  if (filteredNotes.length === 0) {
    return null;
  }

  return filteredNotes.find((note) => note.id === workspace.activeNoteId) ?? filteredNotes[0];
}
