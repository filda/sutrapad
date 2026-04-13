import type { SutraPadDocument, SutraPadWorkspace } from "../types";

export function createNote(title = "Untitled note"): SutraPadDocument {
  return {
    id: crypto.randomUUID(),
    title,
    body: "",
    updatedAt: new Date().toISOString(),
  };
}

export function createWorkspace(): SutraPadWorkspace {
  const note = createNote();
  return {
    notes: [note],
    activeNoteId: note.id,
  };
}

export function sortNotes(notes: SutraPadDocument[]): SutraPadDocument[] {
  return [...notes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function upsertNote(
  workspace: SutraPadWorkspace,
  noteId: string,
  updater: (note: SutraPadDocument) => SutraPadDocument,
): SutraPadWorkspace {
  const current = workspace.notes.find((entry) => entry.id === noteId) ?? workspace.notes[0];
  const next = updater(current);

  return {
    ...workspace,
    notes: sortNotes(workspace.notes.map((note) => (note.id === current.id ? next : note))),
    activeNoteId: next.id,
  };
}

export function createNewNoteWorkspace(workspace: SutraPadWorkspace): SutraPadWorkspace {
  const note = createNote();
  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}

export function createCapturedNoteWorkspace(
  workspace: SutraPadWorkspace,
  capture: { title: string; url: string },
): SutraPadWorkspace {
  const note = createNote(capture.title);
  note.body = capture.url;

  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}
