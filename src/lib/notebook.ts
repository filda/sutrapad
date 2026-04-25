import type {
  SutraPadDocument,
  SutraPadLinkIndex,
  SutraPadTagEntry,
  SutraPadTagFilterMode,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../types";
import { deriveAutoTags } from "./auto-tags";

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
        kind: "user" as const,
      }))
      .toSorted((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
  };
}

/**
 * Builds a unified index of both user-curated tags (from `note.tags`) and
 * auto-tags derived from each note's metadata via `deriveAutoTags`. Every
 * entry is marked with `kind` so callers can style the two groups distinctly
 * without re-running the derivation. Ordering is stable: user tags first
 * (most-used wins, alpha breaks ties), then auto tags under the same rule —
 * the split keeps the hand-curated tags visually prominent even in
 * workspaces where auto-derived tags vastly outnumber them.
 *
 * Tag collisions across kinds are resolved by kind: a user tag `mobile` and
 * the auto-tag `device:mobile` are distinct chips (different tag values),
 * so no collision is possible by construction — this is exactly why auto
 * tags are namespaced.
 */
export function buildCombinedTagIndex(
  workspace: SutraPadWorkspace,
  now: Date = new Date(),
  savedAt = new Date().toISOString(),
): SutraPadTagIndex {
  const userEntries = buildTagIndex(workspace, savedAt).tags;

  const autoNoteIdsByTag = new Map<string, string[]>();
  for (const note of workspace.notes) {
    for (const tag of deriveAutoTags(note, now)) {
      const existingNoteIds = autoNoteIdsByTag.get(tag) ?? [];
      autoNoteIdsByTag.set(tag, [...existingNoteIds, note.id]);
    }
  }

  const autoEntries: SutraPadTagEntry[] = [...autoNoteIdsByTag.entries()]
    .map(([tag, noteIds]) => ({
      tag,
      noteIds,
      count: noteIds.length,
      kind: "auto" as const,
    }))
    .toSorted(
      (left, right) =>
        right.count - left.count || left.tag.localeCompare(right.tag),
    );

  return {
    version: 1,
    savedAt,
    tags: [...userEntries, ...autoEntries],
  };
}

export function buildAvailableTagIndex(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  savedAt = new Date().toISOString(),
): SutraPadTagIndex {
  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    "all",
  );
  return buildTagIndex({ ...workspace, notes: filteredNotes }, savedAt);
}

/**
 * Combined-index companion to `buildAvailableTagIndex`: narrows the workspace
 * to notes matching the active filter (respecting `mode` so auto and user
 * tags combine the same way the filtered list does), then rebuilds the
 * user + auto index over that narrower set. The Tags page uses it to hide
 * chips that would produce an empty list after the next click.
 */
export function buildAvailableCombinedTagIndex(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
  mode: SutraPadTagFilterMode = "all",
  now: Date = new Date(),
  savedAt = new Date().toISOString(),
): SutraPadTagIndex {
  const filteredNotes = filterNotesByTags(
    workspace.notes,
    selectedTagFilters,
    mode,
    now,
  );
  return buildCombinedTagIndex(
    { ...workspace, notes: filteredNotes },
    now,
    savedAt,
  );
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
    if (!URL.canParse(trimmedCandidate)) continue;

    const canonicalUrl = canonicalizeUrl(trimmedCandidate);
    if (!seen.has(canonicalUrl)) {
      seen.add(canonicalUrl);
      normalizedUrls.push(canonicalUrl);
    }
  }

  return normalizedUrls;
}

/**
 * Matches `#tag` occurrences to be lifted out of a note body. Rules:
 *
 *   - Must start at the beginning of the string or after whitespace, so URL
 *     fragments like `https://example.com#section` are ignored (the `#`
 *     there is preceded by a letter, not whitespace).
 *   - Tag body accepts Unicode letters and numbers plus `_` and `-`, so
 *     Czech diacritics (`#nápad`) and CJK (`#日本語`) are preserved.
 *   - Must be followed by whitespace or punctuation. End-of-string is
 *     deliberately NOT a valid terminator — see `extractHashtagsFromText`
 *     for why.
 *
 * Lookbehind is safe here: the codebase already ships ES2023-only features
 * (e.g. `Array#toSorted`), so the minimum browser set supports it.
 */
const HASHTAG_PATTERN = /(?<=^|\s)#([\p{L}\p{N}_-]+)(?=[\s\p{P}])/gu;

/**
 * Extracts every distinct `#tag` from `text`. Tags are lowercased so they
 * match the canonical form the app already uses everywhere else (tag filter
 * URL, tag index, chip input). Order follows first-appearance in the body —
 * stable and predictable for the merge step that appends them.
 *
 * Only hashtags that are already "closed" by a trailing space or punctuation
 * are returned. A trailing `#idea` at the very end of the body is NOT
 * extracted — committing it on every keystroke would walk the tag list
 * through `i`, `id`, `ide`, `idea` as the user types, and the additive merge
 * (by design) would never prune the stale prefixes. The user signals "done
 * with this tag" by typing the next character, at which point the tag
 * commits naturally.
 */
export function extractHashtagsFromText(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1].toLowerCase();
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * Returns the union of `existingTags` and any hashtags found in `body`,
 * preserving the existing order and appending newly-discovered tags at the
 * end. Deliberately additive — a tag the user deleted from the body is
 * **not** removed from the note, because hand-curated tags (added via the
 * tag chip input) should outlive edits to the prose. If the user wants a
 * tag gone, they remove it explicitly via the chip's × button.
 */
export function mergeHashtagsIntoTags(
  existingTags: readonly string[],
  body: string,
): string[] {
  const seen = new Set(existingTags);
  const merged = [...existingTags];
  for (const tag of extractHashtagsFromText(body)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    merged.push(tag);
  }
  return merged;
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

// Task-related parsing/indexing lives in `./tasks` (separated so auto-tag
// derivation can import it without creating a cycle through this module).
// Re-exported here to keep every existing `import … from "./notebook"`
// call-site working unchanged.
export {
  buildTaskIndex,
  compareTaskEntries,
  countTasksInNote,
  toggleTaskInBody,
} from "./tasks";

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

/**
 * Collects every tag that can match a filter for this note — the union of
 * hand-curated `note.tags` and every auto-tag derived from its metadata.
 * Used by `filterNotesByTags`; kept DOM-free and exported so tests can
 * assert the exact set without indirection.
 */
export function collectAllTagsForNote(
  note: SutraPadDocument,
  now: Date = new Date(),
): Set<string> {
  const set = new Set<string>(note.tags);
  for (const tag of deriveAutoTags(note, now)) {
    set.add(tag);
  }
  return set;
}

/**
 * Filters `notes` by `selectedTags`, combining user and auto-derived tags
 * (namespaced, see `deriveAutoTags`) before the test. `mode` picks the
 * combination rule:
 *
 *   - `"all"` (default): a note must carry every selected tag — the historical
 *     behaviour, and what a shared URL with a single `tags=` param has always
 *     meant.
 *   - `"any"`: a note matches if it carries at least one of the selected tags.
 *
 * An empty selection returns the input unchanged under both modes.
 */
export function filterNotesByTags(
  notes: SutraPadDocument[],
  selectedTags: string[],
  mode: SutraPadTagFilterMode = "all",
  now: Date = new Date(),
): SutraPadDocument[] {
  if (selectedTags.length === 0) {
    return notes;
  }

  return notes.filter((note) => {
    const tagsForNote = collectAllTagsForNote(note, now);
    if (mode === "any") {
      return selectedTags.some((tag) => tagsForNote.has(tag));
    }
    return selectedTags.every((tag) => tagsForNote.has(tag));
  });
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

  // Merge remote first, then local. The order matters for tie-breaks:
  // when two versions of the same note share an `updatedAt` (real
  // collision is rare but possible — `applyFreshNoteDetails` can bump
  // metadata in the same ISO millisecond as a user keystroke, and
  // multi-device flows have wider clock skew), the strict-greater-than
  // check keeps whichever version we wrote *last* into the map. Local
  // wins ties because the user's most recent unsynced edit is the more
  // valuable side of the collision; a remote workspace that's about to
  // be re-saved will have its own revision incremented next time
  // anyway.
  for (const note of [...remoteWorkspace.notes, ...localWorkspace.notes]) {
    const existing = notesById.get(note.id);
    if (!existing || note.updatedAt >= existing.updatedAt) {
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

/**
 * Applies `updater` to the note identified by `noteId` and returns a workspace
 * with that note replaced. If the workspace does not contain a note with the
 * given id the workspace is returned unchanged — we deliberately do NOT fall
 * back to `notes[0]`, because a stale `noteId` from a debounced edit handler
 * would otherwise silently clobber an unrelated note's body (see the autosave
 * "jumps to a different note and overwrites it" bug report). Dropping the
 * edit is recoverable; overwriting a different note is not.
 */
export function upsertNote(
  workspace: SutraPadWorkspace,
  noteId: string,
  updater: (note: SutraPadDocument) => SutraPadDocument,
): SutraPadWorkspace {
  const current = workspace.notes.find((entry) => entry.id === noteId);
  if (!current) {
    return workspace;
  }

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

/**
 * Returns true when `note` has no user-authored content — empty body and
 * no user-added tags. Called by the empty-draft purge so the user's
 * "hit N, changed my mind" path doesn't leave orphan notes cluttering
 * the timeline, filling Drive, or inflating the tag index.
 *
 * The title is *deliberately* not part of the check. Two reasons:
 *
 *   1. Async `applyFreshNoteDetails` backfills the title from
 *      location + time-of-day (e.g. "Tuesday afternoon in Prague")
 *      without bumping user-content signals. Including the title in
 *      the emptiness check would force us to either skip that nice
 *      cosmetic backfill or track an "auto-titled" side-set — both
 *      heavier than the problem warrants.
 *   2. A title alone, with no body and no tags, isn't actually useful
 *      as a note — there's nothing to come back to. Treating a
 *      title-only stub as savable would just leak a second variety
 *      of empty note into Drive.
 *
 * Auto-populated metadata (location, coordinates, captureContext) is
 * similarly ignored — those resolve async from browser APIs and say
 * nothing about whether the user typed anything.
 */
export function isEmptyDraftNote(note: SutraPadDocument): boolean {
  if (note.body.trim() !== "") return false;
  if (note.tags.length > 0) return false;
  return true;
}

/**
 * Returns the workspace with every empty-draft note removed. If the
 * active note pointed at a removed draft, `activeNoteId` is cleared so
 * downstream code doesn't try to resolve a dangling reference.
 *
 * Pure — the caller owns persistence (localStorage + Drive) and re-selecting
 * a new active note if needed. Used in two places in app.ts:
 *
 *   - On navigation away from a detail route: so the user's "hit N, nav
 *     away" flow doesn't leave the draft in the notebook.
 *   - Before pushing to Drive: so an empty draft that briefly existed
 *     in-memory never becomes a permanent cloud artefact.
 */
export function stripEmptyDraftNotes(
  workspace: SutraPadWorkspace,
): SutraPadWorkspace {
  const kept = workspace.notes.filter((note) => !isEmptyDraftNote(note));
  if (kept.length === workspace.notes.length) return workspace;
  const activeStillLives =
    workspace.activeNoteId !== null &&
    kept.some((note) => note.id === workspace.activeNoteId);
  return {
    notes: kept,
    activeNoteId: activeStillLives ? workspace.activeNoteId : null,
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
