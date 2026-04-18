import { createWorkspace, extractUrlsFromText } from "../../lib/notebook";
import type { SutraPadWorkspace } from "../../types";

export const LOCAL_WORKSPACE_KEY = "sutrapad-local-workspace";

export function normalizeWorkspace(workspace: SutraPadWorkspace): SutraPadWorkspace {
  if (!workspace.notes.length) {
    return createWorkspace();
  }

  return {
    notes: workspace.notes.map((note) => ({
      ...note,
      urls: Array.isArray(note.urls) ? note.urls : extractUrlsFromText(note.body),
      captureContext: note.captureContext,
      location: note.location?.trim() || undefined,
      coordinates:
        note.coordinates &&
        Number.isFinite(note.coordinates.latitude) &&
        Number.isFinite(note.coordinates.longitude)
          ? {
              latitude: note.coordinates.latitude,
              longitude: note.coordinates.longitude,
            }
          : undefined,
      createdAt: note.createdAt ?? note.updatedAt,
      tags: note.tags ?? [],
    })),
    activeNoteId: workspace.activeNoteId ?? workspace.notes[0].id,
  };
}

export function loadLocalWorkspace(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): SutraPadWorkspace {
  const saved = storage.getItem(LOCAL_WORKSPACE_KEY);
  if (!saved) {
    return createWorkspace();
  }

  try {
    return normalizeWorkspace(JSON.parse(saved) as SutraPadWorkspace);
  } catch {
    return createWorkspace();
  }
}

export function persistLocalWorkspace(
  workspace: SutraPadWorkspace,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
}
