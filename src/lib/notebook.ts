import type { SutraPadDocument, SutraPadLinkIndex, SutraPadTagIndex, SutraPadWorkspace } from "../types";

const DEFAULT_NOTE_TITLE = "Untitled note";

export function createNote(
  title = "Untitled note",
  location?: string,
  coordinates?: SutraPadDocument["coordinates"],
): SutraPadDocument {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    body: "",
    urls: [],
    location,
    coordinates,
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: [],
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

export function buildTagIndex(
  workspace: SutraPadWorkspace,
  savedAt = new Date().toISOString(),
): SutraPadTagIndex {
  const noteIdsByTag = new Map<string, string[]>();

  for (const note of workspace.notes) {
    for (const tag of note.tags) {
      const existingNoteIds = noteIdsByTag.get(tag) ?? [];
      noteIdsByTag.set(tag, [...existingNoteIds, note.id]);
    }
  }

  return {
    version: 1,
    savedAt,
    tags: [...noteIdsByTag.entries()]
      .map(([tag, noteIds]) => ({
        tag,
        noteIds,
        count: noteIds.length,
      }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
  };
}

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const normalizedUrls: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const trimmedCandidate = match.replace(/[),.!?:;]+$/g, "");

    try {
      const normalizedUrl = new URL(trimmedCandidate).toString();
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        normalizedUrls.push(normalizedUrl);
      }
    } catch {
      // Ignore invalid URL-like fragments and keep scanning the text.
    }
  }

  return normalizedUrls;
}

export function buildLinkIndex(
  workspace: SutraPadWorkspace,
  savedAt = new Date().toISOString(),
): SutraPadLinkIndex {
  const noteIdsByUrl = new Map<string, string[]>();

  for (const note of workspace.notes) {
    for (const url of note.urls) {
      const existingNoteIds = noteIdsByUrl.get(url) ?? [];
      noteIdsByUrl.set(url, [...existingNoteIds, note.id]);
    }
  }

  return {
    version: 1,
    savedAt,
    links: [...noteIdsByUrl.entries()]
      .map(([url, noteIds]) => ({
        url,
        noteIds,
        count: noteIds.length,
      }))
      .sort((left, right) => right.count - left.count || left.url.localeCompare(right.url)),
  };
}

export function filterNotesByAllTags(
  notes: SutraPadDocument[],
  selectedTags: string[],
): SutraPadDocument[] {
  if (selectedTags.length === 0) {
    return notes;
  }

  return notes.filter((note) => selectedTags.every((tag) => note.tags.includes(tag)));
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
    const tagsEqual =
      note.tags.length === other.tags.length &&
      note.tags.every((tag, i) => tag === other.tags[i]);
    return (
      note.id === other.id &&
      note.title === other.title &&
      note.body === other.body &&
      note.urls.length === other.urls.length &&
      note.urls.every((url, i) => url === other.urls[i]) &&
      note.location === other.location &&
      note.coordinates?.latitude === other.coordinates?.latitude &&
      note.coordinates?.longitude === other.coordinates?.longitude &&
      note.createdAt === other.createdAt &&
      note.updatedAt === other.updatedAt &&
      tagsEqual
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

export function createNewNoteWorkspace(
  workspace: SutraPadWorkspace,
  title = DEFAULT_NOTE_TITLE,
  location?: string,
  coordinates?: SutraPadDocument["coordinates"],
): SutraPadWorkspace {
  const note = createNote(title, location, coordinates);
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
  note.urls = extractUrlsFromText(capture.url);

  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}

export function createTextNoteWorkspace(
  workspace: SutraPadWorkspace,
  capture: { title: string; body: string; location?: string; coordinates?: SutraPadDocument["coordinates"] },
): SutraPadWorkspace {
  const note = createNote(capture.title, capture.location, capture.coordinates);
  note.body = capture.body;
  note.urls = extractUrlsFromText(capture.body);

  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}
