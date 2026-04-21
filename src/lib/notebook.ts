import type {
  SutraPadDocument,
  SutraPadLinkIndex,
  SutraPadTagEntry,
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

/**
 * Query parameters stripped from URLs before they are indexed in `note.urls[]`.
 * The list is deliberately conservative — only parameters that are purely
 * promotional or analytics, never parameters that can identify the resource
 * itself. Names like `ref`, `source`, `id`, or `q` are NOT included because on
 * many sites they carry real meaning (a GitHub ref, a search query, a product
 * id), and a quiet strip would change which page the link actually points to.
 *
 * In addition to this exact-match set, every parameter whose name starts with
 * `utm_` is stripped — Google Analytics reserves the whole prefix, so a
 * prefix rule here is safer than trying to enumerate every `utm_*` variant.
 *
 * Storage model this list serves:
 *   - The note **body** is never rewritten. Whatever the user pasted or
 *     captured stays verbatim, so clicking the link in the editor always
 *     opens the exact page they saved (including A/B variant, source zone,
 *     referral credit, etc.).
 *   - `note.urls[]` — which feeds the link index on the Links page — stores
 *     the **canonical form** produced by `canonicalizeUrl`. This is what
 *     lets the index dedupe two pastes of the same article that differ only
 *     by UTM/source tracking.
 *   - `captureContext.page.canonicalUrl` is captured from `<link rel="canonical">`
 *     when available, but is deliberately NOT applied automatically here.
 *     Publishers set it wrong often enough (AMP pages pointing to desktop,
 *     product variants pointing to parent, misconfigured homes-as-canonical)
 *     that silently redirecting saved links would surprise users. Any
 *     "promote to publisher canonical" UI should be an explicit, assisted
 *     action, not a silent transform.
 */
export const TRACKING_QUERY_PARAMS: ReadonlySet<string> = new Set([
  // Google / DoubleClick click identifiers
  "gclid",
  "gclsrc",
  "dclid",
  // Facebook
  "fbclid",
  // Microsoft / Bing
  "msclkid",
  // Yandex
  "yclid",
  // Mailchimp campaign / recipient ids
  "mc_cid",
  "mc_eid",
  // HubSpot tracking cookies/ids surfaced in URLs
  "_hsenc",
  "_hsmi",
  "__hstc",
  "__hssc",
  "__hsfp",
  // Instagram share id
  "igshid",
  // Spotify / YouTube share id (only appears on share-link variants)
  "si",
  // Seznam Sklik — recommended-placement A/B tracking (Czech ad network)
  "dop_ab_variant",
  "dop_source_zone_name",
  "dop_source_id",
  "dop_req_id",
]);

/**
 * Returns the URL with known tracking parameters stripped. Preserves path,
 * fragment, and every non-tracking query parameter in its original order.
 * Invalid URL strings are returned unchanged — the caller is responsible for
 * validating upstream if it needs to reject junk.
 */
export function canonicalizeUrl(urlString: string): string {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return urlString;
  }

  // `searchParams.keys()` yields duplicates when the same name appears more
  // than once; collect uniques first so the `delete` pass runs each name once.
  const uniqueNames = new Set(url.searchParams.keys());
  for (const name of uniqueNames) {
    if (name.startsWith("utm_") || TRACKING_QUERY_PARAMS.has(name)) {
      url.searchParams.delete(name);
    }
  }

  return url.toString();
}

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const normalizedUrls: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const trimmedCandidate = match.replace(/[),.!?:;]+$/g, "");

    // Validate before canonicalizing so URL-like fragments (e.g. `https://:::`)
    // don't slip into the index — `canonicalizeUrl` echoes unparseable input
    // back verbatim by design, which is the wrong behaviour for this path.
    try {
      new URL(trimmedCandidate);
    } catch {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(trimmedCandidate);
    if (!seen.has(canonicalUrl)) {
      seen.add(canonicalUrl);
      normalizedUrls.push(canonicalUrl);
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

/**
 * Counts open and completed tasks in a single note. Used by the notebook list
 * to show a "has-tasks" chip next to each note card. Kept here (next to the
 * parser it reuses) so the UI code stays DOM-free and testable.
 */
export function countTasksInNote(note: SutraPadDocument): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const task of parseTasksFromNote(note)) {
    if (task.done) done += 1;
    else open += 1;
  }
  return { open, done };
}

/**
 * Comparator used to order the task index. Extracted from `buildTaskIndex`
 * as an exported pure function so every branch (open/done, recency,
 * noteId, lineIndex) can be unit-tested with crafted pairs; the integration
 * path through `parseTasksFromNote` only ever produces lineIndex-ascending
 * input so the tie-breakers are otherwise unobservable.
 *
 * Ordering, in order of precedence:
 *   1. Open tasks before completed ones.
 *   2. Most recently touched note first (by `noteUpdatedAt` descending).
 *   3. Alphabetical by `noteId` to make ordering deterministic for ties.
 *   4. Ascending `lineIndex` so tasks inside a note mirror the note body.
 */
export function compareTaskEntries(
  left: SutraPadTaskEntry,
  right: SutraPadTaskEntry,
): number {
  if (left.done !== right.done) return left.done ? 1 : -1;
  const updatedAtDelta = right.noteUpdatedAt.localeCompare(left.noteUpdatedAt);
  if (updatedAtDelta !== 0) return updatedAtDelta;
  if (left.noteId !== right.noteId) return left.noteId.localeCompare(right.noteId);
  return left.lineIndex - right.lineIndex;
}

export function buildTaskIndex(
  workspace: SutraPadWorkspace,
  savedAt = new Date().toISOString(),
): SutraPadTaskIndex {
  const tasks: SutraPadTaskEntry[] = [];
  for (const note of workspace.notes) {
    tasks.push(...parseTasksFromNote(note));
  }

  return {
    version: 1,
    savedAt,
    tasks: tasks.toSorted(compareTaskEntries),
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

/**
 * Filters a pre-built tag index down to suggestion candidates for the tag
 * input. Pure and DOM-free so the UI can render without any logic of its own:
 *
 *   - case-insensitive substring match against the user's query
 *   - blank/whitespace-only queries return every available tag
 *   - tags already on the current note are excluded (no-op to add them)
 *   - input ordering from `buildTagIndex` (count desc, then alpha) is preserved
 *   - `limit` caps the dropdown size so a workspace with hundreds of tags
 *     doesn't render a scrollable wall on focus
 */
export function filterTagSuggestions(
  availableTags: readonly SutraPadTagEntry[],
  query: string,
  excludedTags: readonly string[],
  limit = 8,
): SutraPadTagEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const excluded = new Set(excludedTags);
  const matches: SutraPadTagEntry[] = [];

  for (const entry of availableTags) {
    if (excluded.has(entry.tag)) continue;
    if (normalizedQuery && !entry.tag.toLowerCase().includes(normalizedQuery)) continue;
    matches.push(entry);
    if (matches.length >= limit) break;
  }

  return matches;
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
