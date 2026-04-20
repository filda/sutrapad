import type {
  SutraPadDocument,
  SutraPadLinkIndex,
  SutraPadTagIndex,
  SutraPadTaskEntry,
  SutraPadTaskIndex,
  SutraPadWorkspace,
} from "../types";

export const DEFAULT_NOTE_TITLE = "Untitled note";

export function createNote(
  title = "Untitled note",
  location?: string,
  coordinates?: SutraPadDocument["coordinates"],
  captureContext?: SutraPadDocument["captureContext"],
): SutraPadDocument {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    body: "",
    urls: [],
    captureContext,
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
  return [...notes].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
      .toSorted((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
  };
}

export function buildAvailableTagIndex(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  savedAt = new Date().toISOString(),
): SutraPadTagIndex {
  const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
  return buildTagIndex({ ...workspace, notes: filteredNotes }, savedAt);
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
  const notesSortedByRecency = [...workspace.notes].toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  const noteIdsByUrl = new Map<string, string[]>();
  const latestUpdatedAtByUrl = new Map<string, string>();

  for (const note of notesSortedByRecency) {
    for (const url of note.urls) {
      const existingNoteIds = noteIdsByUrl.get(url) ?? [];
      noteIdsByUrl.set(url, [...existingNoteIds, note.id]);

      const previousLatest = latestUpdatedAtByUrl.get(url);
      if (!previousLatest || note.updatedAt.localeCompare(previousLatest) > 0) {
        latestUpdatedAtByUrl.set(url, note.updatedAt);
      }
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
        latestUpdatedAt: latestUpdatedAtByUrl.get(url) ?? "",
      }))
      .toSorted(
        (left, right) =>
          right.latestUpdatedAt.localeCompare(left.latestUpdatedAt) ||
          left.url.localeCompare(right.url),
      ),
  };
}

/**
 * Matches a checkbox at the start of a line (optional leading whitespace and
 * an optional `-` bullet). Accepted bracket variants are `[]`, `[ ]`, `[x]`
 * and `[X]`. Captured groups:
 *   1 — full prefix up to and including the closing bracket
 *   2 — bracket content (empty string, space, or `x`/`X`)
 *   3 — remaining text on the line (the task description)
 */
const TASK_LINE_REGEX = /^(\s*(?:-\s+)?\[([ xX]?)\])\s?(.*)$/;

function parseTasksFromNote(note: SutraPadDocument): SutraPadTaskEntry[] {
  const tasks: SutraPadTaskEntry[] = [];
  const lines = note.body.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = TASK_LINE_REGEX.exec(lines[lineIndex]);
    if (!match) continue;

    const bracketContent = match[2];
    const text = match[3].trimEnd();
    // Skip lines that are just a checkbox with nothing after it; they are
    // almost always a typo rather than an intentional empty task and would
    // otherwise clutter the Tasks page with ghost entries.
    if (text.length === 0) continue;

    tasks.push({
      noteId: note.id,
      lineIndex,
      text,
      done: bracketContent === "x" || bracketContent === "X",
      noteUpdatedAt: note.updatedAt,
    });
  }
  return tasks;
}

export function buildTaskIndex(
  workspace: SutraPadWorkspace,
  savedAt = new Date().toISOString(),
): SutraPadTaskIndex {
  const tasks: SutraPadTaskEntry[] = [];
  for (const note of workspace.notes) {
    tasks.push(...parseTasksFromNote(note));
  }

  // Primary sort: open tasks first, then completed.
  // Secondary sort: most recently touched note first.
  // Tertiary sort: stable by line order within a note.
  const sorted = tasks.toSorted((left, right) => {
    if (left.done !== right.done) return left.done ? 1 : -1;
    const updatedAtDelta = right.noteUpdatedAt.localeCompare(left.noteUpdatedAt);
    if (updatedAtDelta !== 0) return updatedAtDelta;
    if (left.noteId !== right.noteId) return left.noteId.localeCompare(right.noteId);
    return left.lineIndex - right.lineIndex;
  });

  return {
    version: 1,
    savedAt,
    tasks: sorted,
  };
}

/**
 * Flips the done-state of a single task at `lineIndex` within `body`. Unknown
 * or non-checkbox lines are returned unchanged so callers can safely invoke
 * this even if the index is momentarily stale (e.g. the user edited the note
 * between the render and the click). The bracket style is preserved for the
 * open state (`[]` stays `[]`, `[ ]` stays `[ ]`); marking a task done always
 * writes `[x]`.
 */
export function toggleTaskInBody(body: string, lineIndex: number): string {
  const lines = body.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return body;

  const line = lines[lineIndex];
  const match = TASK_LINE_REGEX.exec(line);
  if (!match) return body;

  const bracketContent = match[2];
  const isDone = bracketContent === "x" || bracketContent === "X";
  const prefix = match[1];
  const rest = line.slice(prefix.length);

  let nextPrefix: string;
  if (isDone) {
    // Preserve the original open style when we can infer it; default to `[ ]`.
    nextPrefix = prefix.replace(/\[[xX]\]$/, "[ ]");
  } else {
    // Collapse both `[]` and `[ ]` to `[x]` on completion.
    nextPrefix = prefix.replace(/\[[ ]?\]$/, "[x]");
  }

  lines[lineIndex] = `${nextPrefix}${rest}`;
  return lines.join("\n");
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

  const leftNotes = [...leftWorkspace.notes].toSorted((left, right) => left.id.localeCompare(right.id));
  const rightNotes = [...rightWorkspace.notes].toSorted((left, right) => left.id.localeCompare(right.id));

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
      JSON.stringify(note.captureContext ?? null) === JSON.stringify(other.captureContext ?? null) &&
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
  captureContext?: SutraPadDocument["captureContext"],
): SutraPadWorkspace {
  const note = createNote(title, location, coordinates, captureContext);
  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}

export function createCapturedNoteWorkspace(
  workspace: SutraPadWorkspace,
  capture: { title: string; url: string; captureContext?: SutraPadDocument["captureContext"] },
): SutraPadWorkspace {
  const note = createNote(capture.title, undefined, undefined, capture.captureContext);
  note.body = capture.url;
  note.urls = extractUrlsFromText(capture.url);

  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}

export function createTextNoteWorkspace(
  workspace: SutraPadWorkspace,
  capture: {
    title: string;
    body: string;
    location?: string;
    coordinates?: SutraPadDocument["coordinates"];
    captureContext?: SutraPadDocument["captureContext"];
  },
): SutraPadWorkspace {
  const note = createNote(
    capture.title,
    capture.location,
    capture.coordinates,
    capture.captureContext,
  );
  note.body = capture.body;
  note.urls = extractUrlsFromText(capture.body);

  return {
    notes: sortNotes([note, ...workspace.notes]),
    activeNoteId: note.id,
  };
}
