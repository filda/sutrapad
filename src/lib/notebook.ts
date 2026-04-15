import type { SutraPadDocument, SutraPadWorkspace } from "../types";

const DEFAULT_NOTE_TITLE = "Untitled note";

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

export function isPristineWorkspace(workspace: SutraPadWorkspace): boolean {
  if (workspace.notes.length !== 1) {
    return false;
  }

  const [note] = workspace.notes;
  return (
    workspace.activeNoteId === note.id &&
    note.title === DEFAULT_NOTE_TITLE &&
    note.body === ""
  );
}

export function mergeWorkspaces(
  localWorkspace: SutraPadWorkspace,
  remoteWorkspace: SutraPadWorkspace,
): SutraPadWorkspace {
  const localIsPristine = isPristineWorkspace(localWorkspace);
  const remoteIsPristine = isPristineWorkspace(remoteWorkspace);

  if (localIsPristine && !remoteIsPristine) {
    return remoteWorkspace;
  }

  if (remoteIsPristine && !localIsPristine) {
    return localWorkspace;
  }

  const notesById = new Map<string, SutraPadDocument>();

  for (const note of [...remoteWorkspace.notes, ...localWorkspace.notes]) {
    const existing = notesById.get(note.id);
    if (!existing || note.updatedAt > existing.updatedAt) {
      notesById.set(note.id, note);
    }
  }

  const notes = sortNotes([...notesById.values()]);
  const preferredActiveNoteId =
    (localWorkspace.activeNoteId && notesById.has(localWorkspace.activeNoteId)
      ? localWorkspace.activeNoteId
      : null) ??
    (remoteWorkspace.activeNoteId && notesById.has(remoteWorkspace.activeNoteId)
      ? remoteWorkspace.activeNoteId
      : null) ??
    notes[0]?.id ??
    null;

  return {
    notes,
    activeNoteId: preferredActiveNoteId,
  };
}

export function areWorkspacesEqual(
  leftWorkspace: SutraPadWorkspace,
  rightWorkspace: SutraPadWorkspace,
): boolean {
  if (leftWorkspace.activeNoteId !== rightWorkspace.activeNoteId) {
    return false;
  }

  if (leftWorkspace.notes.length !== rightWorkspace.notes.length) {
    return false;
  }

  const leftNotes = [...leftWorkspace.notes].sort((left, right) => left.id.localeCompare(right.id));
  const rightNotes = [...rightWorkspace.notes].sort((left, right) => left.id.localeCompare(right.id));

  return leftNotes.every((note, index) => {
    const other = rightNotes[index];
    return (
      note.id === other.id &&
      note.title === other.title &&
      note.body === other.body &&
      note.updatedAt === other.updatedAt
    );
  });
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

export function createTextNoteWorkspace(
  workspace: SutraPadWorkspace,
  capture: { title: string; body: string },
): SutraPadWorkspace {
  const note = createNote(capture.title);
  note.body = capture.body;

  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}
