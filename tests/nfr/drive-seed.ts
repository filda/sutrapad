/**
 * Puts a workspace onto a `FakeDrive` the way it sits on the real one: the
 * `SutraPad` folder plus one `note-<id>.json` per note, both carrying the
 * app's marker properties. Indexes are *not* written — call
 * `rebuildIndexes()` on a store for a fully indexed state, or leave them out
 * to model the drifted / pre-index workspace.
 */
import type { SutraPadHead, SutraPadIndex, SutraPadWorkspace } from "../../src/types";
import type { FakeDrive } from "./fake-drive";

export const SEEDED_FOLDER_ID = "seeded-folder";

export function seedWorkspaceFiles(drive: FakeDrive, workspace: SutraPadWorkspace): void {
  drive.seed({
    id: SEEDED_FOLDER_ID,
    name: "SutraPad",
    mimeType: "application/vnd.google-apps.folder",
    appProperties: { sutrapad: "true", kind: "folder" },
    parents: ["root"],
    content: undefined,
  });
  for (const note of workspace.notes) {
    drive.seed({
      id: `file-${note.id}`,
      name: `note-${note.id}.json`,
      mimeType: "application/json",
      appProperties: { sutrapad: "true", kind: "note", noteId: note.id },
      parents: [SEEDED_FOLDER_ID],
      content: structuredClone(note),
      modifiedTime: note.updatedAt,
    });
  }
}

/** The index the head currently points at, or null when there is none. */
export function readActiveIndex(drive: FakeDrive): SutraPadIndex | null {
  const [headFile] = drive.query(
    "trashed = false and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='head' }",
  );
  if (!headFile) return null;
  const head = headFile.content as SutraPadHead;
  return drive.files.has(head.activeIndexId) ? drive.contentOf<SutraPadIndex>(head.activeIndexId) : null;
}

export function countNoteFiles(drive: FakeDrive): number {
  return drive.query(
    "trashed = false and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' }",
  ).length;
}
