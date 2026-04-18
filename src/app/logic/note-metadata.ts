import type { SutraPadDocument } from "../../types";
import { formatDate } from "./formatting";

export function buildNoteMetadata(note: SutraPadDocument): string {
  const location = note.location?.trim();
  const updated = `Updated ${formatDate(note.updatedAt)}`;

  if (location) {
    return `${location} · ${updated}`;
  }

  return updated;
}
