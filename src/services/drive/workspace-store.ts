/**
 * Workspace-aware Drive store.
 *
 * Sits on top of `GoogleDriveClient` (which only knows about
 * `DriveFileRecord` and JSON payloads) and translates SutraPad's
 * concrete shapes — workspace, head pointer, index snapshots, per-
 * note files, derived tag/link/task indexes, the legacy single-file
 * format — into REST round-trips. Anything specific to "how SutraPad
 * organises its Drive folder" lives here; anything specific to "how
 * Drive's REST API works" lives in the client.
 */
import type {
  DriveFileRecord,
  SutraPadDocument,
  SutraPadHead,
  SutraPadIndex,
  SutraPadLinkIndex,
  SutraPadNoteSummary,
  SutraPadTaskIndex,
  SutraPadWorkspace,
} from "../../types";
import {
  buildLinkIndex,
  buildTagIndex,
  buildTaskIndex,
  extractUrlsFromText,
} from "../../lib/notebook";
import { httpUrlOrNull } from "../../lib/safe-url";
import { buildNoteSummary, buildPlaceholderNote } from "../../lib/note-card-meta";
import {
  isNoteFileName,
  noteFileName,
  noteIdFromFileName,
} from "../../lib/note-file";
import {
  escapeDriveQueryValue,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GoogleDriveClient,
} from "./client";

const LEGACY_INDEX_FILE_NAME = import.meta.env.VITE_SUTRAPAD_FILE_NAME || "sutrapad-index.json";
const LEGACY_FILE_NAME = "sutrapad-data.json";
const HEAD_FILE_NAME = "sutrapad-head.json";
const TAG_INDEX_FILE_NAME = "sutrapad-tags.json";
const LINK_INDEX_FILE_NAME = "sutrapad-links.json";
const TASK_INDEX_FILE_NAME = "sutrapad-tasks.json";
const WORKSPACE_FOLDER_NAME = "SutraPad";
const MAX_INDEX_SNAPSHOTS = 10;
/**
 * Safety ceiling on the folder-scoped note-file query that drives
 * `loadWorkspace`'s inventory. `findFiles` now paginates (Drive caps a
 * single page at 1000), so this is no longer a silent one-page cut — it's
 * just an upper bound to stop a runaway query. Comfortably above any real
 * workspace (a ~6.5k-note import sits well under it).
 */
const MAX_WORKSPACE_NOTE_FILES = 50_000;

/**
 * Max concurrent note-body fetches during a full `loadWorkspace` hydration.
 * Firing one request per note at once (Promise.all over the whole folder)
 * exhausts the browser's socket/memory budget on large workspaces — thousands
 * of parallel fetches surface as `net::ERR_INSUFFICIENT_RESOURCES`. Chunking
 * keeps the in-flight count sane. (Phase 2 / lazy bodies removes the need to
 * hydrate everything up front at all.)
 */
const NOTE_HYDRATION_CONCURRENCY = 24;

/**
 * In-place backfills for fields that older note documents on Drive
 * may be missing — `createdAt` (added when we split a separate
 * created-vs-updated timestamp), `urls` (added when link extraction
 * moved from runtime into stored data), and `tags`. Mutates the input
 * because the document is always a freshly-deserialised JSON object
 * we own; spreading into a new object would allocate per-note inside
 * `loadWorkspace`'s parallel hydration and trip the `no-map-spread`
 * lint. Returns the same reference for ergonomic call-site shape.
 */
function normalizeNoteDocument(document: SutraPadDocument): SutraPadDocument {
  document.createdAt ??= document.updatedAt;
  // Treat a stored `urls` array as attacker-controlled — a note synced from
  // another device or a hand-edited Drive file could carry `javascript:` /
  // `data:` entries that would otherwise flow straight to the Links `href`
  // sink. Keep only http(s) URLs; when the field is missing or not an array,
  // re-derive it from the body (the http(s)-only extractor).
  document.urls = Array.isArray(document.urls)
    ? document.urls.filter((url) => httpUrlOrNull(url) !== null)
    : extractUrlsFromText(document.body);
  document.tags ??= [];
  return document;
}

/**
 * A Drive file counts as a note when it either carries the app's
 * appProperties markers or matches the canonical `note-<id>.json` filename.
 * The widened folder query (`… or name contains 'note-'`) can return
 * substring false positives (`footnote-1.json`) and unrelated artifacts, so
 * every candidate is re-checked here before its body is fetched.
 */
function isNoteFileRecord(file: DriveFileRecord): boolean {
  if (isNoteFileName(file.name)) return true;
  return (
    file.appProperties?.sutrapad === "true" &&
    file.appProperties?.kind === "note"
  );
}

/**
 * Minimum shape a deserialised note must have before normalisation: a
 * non-empty string `id` (drives routing + dedup) and a non-empty string
 * `updatedAt` (normalisation backfills `createdAt` from it, and load sorts on
 * it). A file that fails either check is skipped rather than rendered as a
 * broken note.
 */
function isValidNoteDocument(document: unknown): document is SutraPadDocument {
  if (typeof document !== "object" || document === null) return false;
  const candidate = document as Partial<SutraPadDocument>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.updatedAt === "string" &&
    candidate.updatedAt.length > 0
  );
}

/**
 * Collapses duplicate note ids, keeping the first occurrence. Callers sort
 * newest-first before calling, so the survivor is the most recently updated
 * copy — the sensible winner when the same note id exists as both an
 * app-written file and a plain dropped-in file.
 */
function dedupeNotesById(notes: SutraPadDocument[]): SutraPadDocument[] {
  const seen = new Set<string>();
  const unique: SutraPadDocument[] = [];
  for (const note of notes) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    unique.push(note);
  }
  return unique;
}

function createInitialDocument(): SutraPadDocument {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "My first note",
    body: "Start writing here.",
    urls: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    tags: [],
  };
}

function createEmptyWorkspace(): SutraPadWorkspace {
  const note = createInitialDocument();
  return {
    notes: [note],
    activeNoteId: note.id,
  };
}

function createIndex(
  workspace: SutraPadWorkspace,
  existingIndex?: SutraPadIndex | null,
  previousIndexId?: string,
): SutraPadIndex {
  const savedAt = new Date().toISOString();

  // Build an id → previous-summary lookup once instead of `.find()`-ing
  // through `existingIndex.notes` for every note in the new workspace.
  // The old shape was O(N×M) where both N (current notes) and M
  // (previous notes) grow without bound — once a workspace has a few
  // hundred notes the save path was visibly worse than the load path.
  const previousById = new Map<string, SutraPadNoteSummary>();
  if (existingIndex) {
    for (const entry of existingIndex.notes) {
      previousById.set(entry.id, entry);
    }
  }

  return {
    version: 1,
    updatedAt: savedAt,
    savedAt,
    previousIndexId,
    activeNoteId: workspace.activeNoteId,
    notes: workspace.notes.map((note) => ({
      id: note.id,
      title: note.title,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      fileId: previousById.get(note.id)?.fileId,
    })),
  };
}

/**
 * Drops task-index entries whose note no longer exists in the folder. Pure so
 * the folder-reconcile rule the Tasks page relies on is unit-testable without
 * Drive I/O.
 */
export function reconcileTaskIndex(
  index: SutraPadTaskIndex,
  liveNoteIds: ReadonlySet<string>,
): SutraPadTaskIndex {
  return {
    ...index,
    tasks: index.tasks.filter((task) => liveNoteIds.has(task.noteId)),
  };
}

/**
 * Drops dead note ids from each link and removes links left with no live
 * notes, recomputing `count`. Pure counterpart to `reconcileTaskIndex`.
 */
export function reconcileLinkIndex(
  index: SutraPadLinkIndex,
  liveNoteIds: ReadonlySet<string>,
): SutraPadLinkIndex {
  const links: SutraPadLinkIndex["links"] = [];
  for (const link of index.links) {
    const noteIds = link.noteIds.filter((id) => liveNoteIds.has(id));
    if (noteIds.length > 0) {
      links.push({ ...link, noteIds, count: noteIds.length });
    }
  }
  return { ...index, links };
}

export class GoogleDriveStore {
  readonly #client: GoogleDriveClient;
  #workspaceFolderPromise: Promise<DriveFileRecord> | null = null;

  constructor(accessToken: string) {
    this.#client = new GoogleDriveClient(accessToken);
  }

  /**
   * Loads the workspace from Drive.
   *
   * **Index-as-read-source with folder-query reconcile** (Phase 2 notes-
   * scaling). The folder query is still the source of truth for *which*
   * notes exist — same drift-tolerance `appendNoteToWorkspace` (silent
   * capture) relies on — but no note body is fetched for any note the
   * index already knows about. Each such note becomes a body-less
   * placeholder (`buildPlaceholderNote`, `hydrated: false`); the detail
   * view fetches the real body on open (`fetchNoteByFileId` + the resident
   * LRU cache, see `src/app/logic/note-hydration.ts`).
   *
   * **Orphan reconcile**: a note file with no matching index summary —
   * silent-capture drift between saves, or a plain import — gets its body
   * fetched right here, once, via the same bounded-concurrency path the
   * pre-Phase-2 loader used (`hydrateNoteFiles`). We're already paying a
   * Drive round trip for it either way, so there's no reason to throw the
   * body away and re-fetch it again the moment the note is opened; it
   * lands in `workspace.notes` fully hydrated. The next interactive save
   * folds it into the canonical index (self-healing, same as before).
   *
   * Critical-path round-trips (happy path, no orphans): folder lookup →
   * parallel(index lookup, notes-in-folder query). No note JSON fetches at
   * all — the whole point of the flip.
   */
  async loadWorkspace(): Promise<SutraPadWorkspace> {
    const workspaceFolder = await this.findWorkspaceFolder();

    // Two parallel inventories: the canonical "what notes exist in
    // the folder right now" query (source of truth for `notes`), and
    // the index file lookup (source of truth for card metadata +
    // `activeNoteId`). Either may be missing in legitimate workspaces
    // — first-ever load before any save, or migrated-from-legacy
    // users — and the fallback paths below handle each case.
    const [noteFiles, indexFile] = await Promise.all([
      workspaceFolder ? this.findNoteFilesInFolder(workspaceFolder.id) : Promise.resolve([]),
      this.resolveActiveIndexFile(workspaceFolder?.id),
    ]);

    if (noteFiles.length === 0) {
      // No per-note files found. Either this is a brand-new
      // workspace, or it's a legacy single-file workspace from before
      // the per-note split. Try the legacy loader; if that's empty
      // too, return the seeded empty workspace.
      const legacyDocument = await this.loadLegacyDocument(workspaceFolder?.id);
      if (legacyDocument) {
        return {
          notes: [legacyDocument],
          activeNoteId: legacyDocument.id,
        };
      }

      return createEmptyWorkspace();
    }

    const index = await this.fetchIndex(indexFile);
    const summariesById = new Map<string, SutraPadNoteSummary>();
    if (index) {
      for (const entry of index.notes) {
        summariesById.set(entry.id, entry);
      }
    }

    const orphanFiles: DriveFileRecord[] = [];
    const placeholders: SutraPadDocument[] = [];
    for (const file of noteFiles) {
      const noteId = file.appProperties?.noteId ?? noteIdFromFileName(file.name);
      if (!noteId) continue;
      const summary = summariesById.get(noteId);
      if (summary) {
        // Trust the folder for the live fileId — the index can lag a
        // re-upload (same reasoning as `loadNoteSummaries`).
        placeholders.push(buildPlaceholderNote({ ...summary, fileId: file.id }));
      } else {
        orphanFiles.push(file);
      }
    }

    const orphanNotes = await this.hydrateNoteFiles(orphanFiles);

    // Sort newest-first, then collapse duplicate ids keeping the first
    // (most recently updated) survivor — a note id can legitimately exist
    // as both an app-written file and a plain dropped-in `note-<id>.json`.
    const allNotes = dedupeNotesById(
      [...placeholders, ...orphanNotes].toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    );

    if (allNotes.length === 0) {
      return createEmptyWorkspace();
    }

    const indexActiveNoteId = index?.activeNoteId ?? null;
    const activeNoteId =
      indexActiveNoteId !== null && allNotes.some((note) => note.id === indexActiveNoteId)
        ? indexActiveNoteId
        : allNotes[0].id;

    return {
      notes: allNotes,
      activeNoteId,
    };
  }

  /**
   * Maintenance rebuild (Phase 2 notes-scaling): fetches every note's real
   * body from Drive once and rewrites the persisted index + tag/link/task
   * indexes from scratch by delegating to `saveWorkspace` — the same write
   * path an interactive save already uses, so there's no second index-
   * writing implementation to keep in sync. This is the one deliberate,
   * user-triggered escape hatch that reads every body; everything else
   * (`loadWorkspace`, filters, Links, Tasks) is built to avoid exactly this
   * cost. Call sparingly — for a multi-thousand-note workspace this is
   * thousands of Drive reads even at bounded concurrency.
   *
   * `activeNoteId` is set to the most recently updated note rather than
   * preserved from the current index — cheap and harmless: the next fresh
   * `loadWorkspace` already falls back to the same choice whenever the
   * index's `activeNoteId` is stale or missing (see above), and this
   * rebuild only touches Drive-side derived state, never the app's live
   * `workspace$`, so there's no in-session "active note" to disturb.
   *
   * Existing `updatedAt`s are unchanged (we're re-saving each note's
   * current content, not editing it), so `saveWorkspace`'s
   * unchanged-note skip means the bulk of the cost here is the body
   * reads, not re-uploading every note file.
   */
  async rebuildIndexes(): Promise<{ noteCount: number }> {
    const workspaceFolder = await this.findWorkspaceFolder();
    if (!workspaceFolder) return { noteCount: 0 };

    const noteFiles = await this.findNoteFilesInFolder(workspaceFolder.id);
    if (noteFiles.length === 0) return { noteCount: 0 };

    const hydrated = await this.hydrateNoteFiles(noteFiles);
    if (hydrated.length === 0) return { noteCount: 0 };

    // Same dedup rule as `loadWorkspace`: a note id can legitimately exist
    // as both an app-written file and a plain dropped-in re-import; keep
    // the most recently updated survivor rather than saving both under one
    // id.
    const notes = dedupeNotesById(
      hydrated.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );

    await this.saveWorkspace({ notes, activeNoteId: notes[0].id });
    return { noteCount: notes.length };
  }

  /**
   * Defensive index read shared by `loadWorkspace` and `loadNoteSummaries`.
   * Returns the parsed index if it's fetchable + parseable, `null`
   * otherwise. Failures here are not fatal — callers fall back to treating
   * every note as an orphan / picking the most recently updated note as
   * active, and the next interactive save rewrites the index.
   */
  private async fetchIndex(indexFile: DriveFileRecord | null): Promise<SutraPadIndex | null> {
    if (!indexFile) return null;
    try {
      return await this.#client.fetchJsonFile<SutraPadIndex>(indexFile.id);
    } catch {
      return null;
    }
  }

  /**
   * Returns every note file inside the workspace folder. This is what
   * makes `loadWorkspace` tolerant of "orphan" notes appended by the
   * silent-capture bookmarklet without an index update — they show up
   * here because they exist on Drive, regardless of whether the index
   * knows about them.
   *
   * A file qualifies as a note two ways: it carries the app's
   * appProperties markers (`sutrapad=true`, `kind=note`), or its name
   * matches the canonical `note-<id>.json` shape. The second arm lets a
   * plain note file dropped into the folder — an import, a sync from
   * another tool — render without the app ever having written it. Drive
   * has no prefix/regex match operator, so the query casts a slightly
   * wider `name contains 'note-'` net and `isNoteFileRecord` tightens it
   * back to the strict shape client-side.
   */
  private async findNoteFilesInFolder(
    folderId: string,
  ): Promise<DriveFileRecord[]> {
    const files = await this.#client.findFiles(
      `${this.buildFolderQuery(folderId)} and ((appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' }) or name contains 'note-')`,
      MAX_WORKSPACE_NOTE_FILES,
    );
    return files.filter((file) => isNoteFileRecord(file));
  }

  /**
   * Fetches and normalises every candidate note file, tolerating
   * individual failures. A plain `note-<id>.json` dropped into the folder
   * could be malformed JSON or missing required fields; one bad file must
   * not abort the whole load, so failures and invalid shapes are skipped
   * rather than propagated. Files the app itself wrote never trip these
   * guards.
   */
  private async hydrateNoteFiles(
    noteFiles: DriveFileRecord[],
  ): Promise<SutraPadDocument[]> {
    const hydrated: SutraPadDocument[] = [];
    // Fetch bodies in bounded-concurrency chunks rather than all at once —
    // see NOTE_HYDRATION_CONCURRENCY for why a full-folder Promise.all trips
    // net::ERR_INSUFFICIENT_RESOURCES on large workspaces.
    for (
      let start = 0;
      start < noteFiles.length;
      start += NOTE_HYDRATION_CONCURRENCY
    ) {
      const chunk = noteFiles.slice(start, start + NOTE_HYDRATION_CONCURRENCY);
      // oxlint-disable-next-line no-await-in-loop -- chunks are sequential on purpose to cap concurrent Drive fetches
      const settled = await Promise.all(
        chunk.map(async (file) => {
          try {
            const document =
              await this.#client.fetchJsonFile<SutraPadDocument>(file.id);
            return isValidNoteDocument(document)
              ? normalizeNoteDocument(document)
              : null;
          } catch {
            return null;
          }
        }),
      );
      for (const note of settled) {
        if (note !== null) hydrated.push(note);
      }
    }
    return hydrated;
  }

  /**
   * Silent-capture fast path: writes the new note's per-note JSON
   * file into the workspace folder and stops there. Critically does
   * NOT touch the index, head pointer, or derived tag/link/task
   * caches.
   *
   * This is safe because `loadWorkspace` is now folder-query-driven
   * (the folder is the source of truth for "what notes exist", and
   * the index is consulted only for the `activeNoteId` hint). An
   * orphan note file picked up by the next load gets folded into the
   * canonical index the moment the user makes any edit and autosave
   * fires `saveWorkspace`.
   *
   * Round-trip cost on the critical path: 3 — find workspace folder,
   * upload the note JSON, re-parent it into the folder defensively.
   * That's down from the previous 9-RTT chain (folder + parallel
   * index/head/upload + index fetch + snapshot upload+ensure + head
   * upload + cleanup) — and the latency drop is what users feel on
   * iOS Safari where every Drive RTT is paying for ITP-related
   * overhead.
   *
   * Trade-offs intentionally accepted here:
   *   - The index drifts behind the folder by N captures until the
   *     next interactive save. This is invisible in the UI because
   *     load doesn't read the index for inventory.
   *   - `activeNoteId` doesn't auto-switch to the captured note. The
   *     user still has to open the new note from the list — but the
   *     bookmarklet target is "save it", not "open it", and saving
   *     fast matters more than active-note tracking on a flow the
   *     user isn't watching.
   *   - The derived tag/link/task index files stay stale between
   *     captures. Same trade-off the previous version already
   *     accepted (those caches are write-only, see `SutraPadTagIndex`
   *     doc comment in `types.ts`).
   */
  /**
   * Folder-query inventory for the progressive cross-device refresh.
   *
   * Returns one record per `kind=note` file the workspace folder
   * holds, with the `noteId` lifted out of the file's appProperties
   * and `modifiedTime` carried through from the same `findFiles` call.
   * No JSON bodies are fetched here — this is the single 1-RTT
   * inventory probe that lets the focus-driven refresh learn the note
   * count (and drop locally-known notes deleted on another device)
   * before any per-note fetch starts.
   *
   * Defensive against malformed Drive state: entries missing either
   * `appProperties.noteId` or `modifiedTime` are skipped rather than
   * synthesised, because either omission would let the orchestrator
   * apply an inconsistent merge. In practice every note we write
   * carries both, so the filter is belt-and-braces.
   */
  async loadNoteInventory(): Promise<
    Array<{ noteId: string; fileId: string; modifiedTime: string }>
  > {
    const workspaceFolder = await this.findWorkspaceFolder();
    if (!workspaceFolder) return [];
    const noteFiles = await this.findNoteFilesInFolder(workspaceFolder.id);
    const entries: Array<{
      noteId: string;
      fileId: string;
      modifiedTime: string;
    }> = [];
    for (const file of noteFiles) {
      // Prefer the appProperties noteId the app stamps; fall back to the
      // id embedded in a plain `note-<id>.json` filename so dropped-in
      // files still take part in the cross-device refresh without a body
      // fetch. `modifiedTime` comes from the folder listing either way.
      const noteId =
        file.appProperties?.noteId ?? noteIdFromFileName(file.name);
      const modifiedTime = file.modifiedTime;
      if (!noteId || !modifiedTime) continue;
      entries.push({ noteId, fileId: file.id, modifiedTime });
    }
    return entries;
  }

  /**
   * Reads the note summaries for the Notes list without hydrating any bodies
   * (Phase 2, step 3). Each index summary carries the card metadata (headline,
   * excerpt, tags, location, tasks — see `createIndex` / `buildNoteCardMeta`),
   * so the list can render from these small records; the full body is fetched
   * only on open via `fetchNoteByFileId`.
   *
   * The folder query is the source of truth for *which* notes exist; index
   * summaries are matched onto it by id. A note file with no matching summary
   * (an orphan from silent-capture, or a plain import the index hasn't caught
   * up with) yields a minimal summary with no card meta — its card falls back
   * to the default title until a maintenance rebuild backfills the index. A
   * summary whose note file is gone (deleted elsewhere) is dropped.
   */
  async loadNoteSummaries(): Promise<SutraPadNoteSummary[]> {
    const workspaceFolder = await this.findWorkspaceFolder();
    if (!workspaceFolder) return [];

    const [noteFiles, indexFile] = await Promise.all([
      this.findNoteFilesInFolder(workspaceFolder.id),
      this.resolveActiveIndexFile(workspaceFolder.id),
    ]);

    const index = await this.fetchIndex(indexFile);
    const summariesById = new Map<string, SutraPadNoteSummary>();
    if (index) {
      for (const summary of index.notes) {
        summariesById.set(summary.id, summary);
      }
    }

    const summaries: SutraPadNoteSummary[] = [];
    for (const file of noteFiles) {
      const noteId = file.appProperties?.noteId ?? noteIdFromFileName(file.name);
      if (!noteId) continue;
      const existing = summariesById.get(noteId);
      if (existing) {
        // Keep the meta-bearing summary; trust the folder for the live fileId.
        summaries.push({ ...existing, fileId: file.id });
      } else {
        const timestamp = file.modifiedTime ?? new Date().toISOString();
        summaries.push({
          id: noteId,
          title: "",
          createdAt: timestamp,
          updatedAt: timestamp,
          fileId: file.id,
        });
      }
    }

    return summaries.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  /** Live note ids present in the workspace folder (drops deleted notes). */
  private collectLiveNoteIds(noteFiles: DriveFileRecord[]): Set<string> {
    const ids = new Set<string>();
    for (const file of noteFiles) {
      const noteId = file.appProperties?.noteId ?? noteIdFromFileName(file.name);
      if (noteId) ids.add(noteId);
    }
    return ids;
  }

  /**
   * Loads the persisted task index (`sutrapad-tasks.json`), reconciled against
   * the folder inventory so tasks belonging to deleted notes are dropped —
   * mirroring how `loadNoteSummaries` starts using the notes index. No note
   * bodies are fetched: the persisted index becomes the source of truth for the
   * Tasks page. Notes captured since the last interactive save (which rebuilds
   * the index) won't have their tasks here until that rebuild — the same
   * eventual-consistency drift the notes index carries.
   */
  async loadTaskIndex(): Promise<SutraPadTaskIndex> {
    const empty: SutraPadTaskIndex = { version: 1, savedAt: "", tasks: [] };
    const workspaceFolder = await this.findWorkspaceFolder();
    if (!workspaceFolder) return empty;

    const [noteFiles, indexFile] = await Promise.all([
      this.findNoteFilesInFolder(workspaceFolder.id),
      this.findTaskIndexFile(workspaceFolder.id),
    ]);
    if (!indexFile) return empty;

    const liveNoteIds = this.collectLiveNoteIds(noteFiles);
    try {
      const index = await this.#client.fetchJsonFile<SutraPadTaskIndex>(
        indexFile.id,
      );
      return reconcileTaskIndex(index, liveNoteIds);
    } catch {
      return empty;
    }
  }

  /**
   * Loads the persisted link index (`sutrapad-links.json`), reconciled against
   * the folder inventory: note ids that no longer exist are dropped from each
   * link, and links left with no live notes are removed. Same
   * index-is-the-source-of-truth model as `loadTaskIndex`.
   */
  async loadLinkIndex(): Promise<SutraPadLinkIndex> {
    const empty: SutraPadLinkIndex = { version: 1, savedAt: "", links: [] };
    const workspaceFolder = await this.findWorkspaceFolder();
    if (!workspaceFolder) return empty;

    const [noteFiles, indexFile] = await Promise.all([
      this.findNoteFilesInFolder(workspaceFolder.id),
      this.findLinkIndexFile(workspaceFolder.id),
    ]);
    if (!indexFile) return empty;

    const liveNoteIds = this.collectLiveNoteIds(noteFiles);
    try {
      const index = await this.#client.fetchJsonFile<SutraPadLinkIndex>(
        indexFile.id,
      );
      return reconcileLinkIndex(index, liveNoteIds);
    } catch {
      return empty;
    }
  }

  /**
   * Fetches a single note JSON by its Drive file id and normalises
   * the legacy-shape backfills (`createdAt`, `urls`, `tags`) the same
   * way `loadWorkspace` does. The progressive refresh fans this out
   * in `Promise.all` batches to fill in the JSONs phase-by-phase.
   */
  async fetchNoteByFileId(fileId: string): Promise<SutraPadDocument> {
    const document = await this.#client.fetchJsonFile<SutraPadDocument>(fileId);
    return normalizeNoteDocument(document);
  }

  async appendNoteToWorkspace(
    note: SutraPadDocument,
    existingFileId?: string,
  ): Promise<void> {
    const workspaceFolder = await this.getWorkspaceFolder();
    // With `existingFileId` the upload is a PATCH that overwrites that file in
    // place (upsert) — the import passes it so re-importing the same note
    // updates its file instead of creating a duplicate `note-<id>.json`.
    const file = await this.#client.uploadJsonFile({
      fileId: existingFileId,
      fileName: noteFileName(note.id),
      data: note,
      folderId: workspaceFolder.id,
      appProperties: {
        sutrapad: "true",
        kind: "note",
        noteId: note.id,
      },
    });
    // Re-parent defensively. Drive's multipart upload occasionally
    // detaches a file's folder when uploading a new revision; the
    // ensure call is a no-op when parents are already correct and
    // costs one extra RTT in the rare detach case. Cheap insurance
    // against an orphan-in-Drive-root that wouldn't show up in our
    // folder-scoped load query.
    await this.#client.ensureFileInFolder(file.id, workspaceFolder.id);
  }

  async saveWorkspace(workspace: SutraPadWorkspace): Promise<void> {
    const workspaceFolder = await this.getWorkspaceFolder();
    const existingIndexFile = await this.resolveActiveIndexFile(workspaceFolder.id);
    const existingIndex = existingIndexFile
      ? await this.#client.fetchJsonFile<SutraPadIndex>(existingIndexFile.id)
      : null;

    const nextIndex = createIndex(workspace, existingIndex, existingIndexFile?.id);

    // Same lookup table as `createIndex` builds internally — the
    // savedNotes loop below also needs id → existing summary
    // resolution, so we hoist it out of the per-note `.find()` and
    // share it with the upload path. Same O(N+M) → O(1) win as in
    // `createIndex`, just on the save half instead of the index half.
    const existingSummaryById = new Map<string, SutraPadNoteSummary>();
    if (existingIndex) {
      for (const entry of existingIndex.notes) {
        existingSummaryById.set(entry.id, entry);
      }
    }

    // Notes upload + the four `find*IndexFile` lookups all need only
    // `workspaceFolder.id` and `existingIndex` (already resolved
    // above), so they run in a single concurrent batch instead of
    // five sequential round-trips. On a typical capture this drops
    // ~4×RTT off the in-flight time before we even get to the
    // index uploads.
    const [
      savedNotes,
      existingTagIndexFile,
      existingLinkIndexFile,
      existingTaskIndexFile,
      existingHeadFile,
    ] = await Promise.all([
      Promise.all(
        workspace.notes.map(async (note) => {
          // Full card metadata (headline/excerpt/tags/location/tasks + urls/
          // captureContext/autoTags) written into the index summary so the
          // Notes / Links / Tasks surfaces can render + filter from the index
          // without hydrating bodies (Phase 2). `buildNoteSummary` is the one
          // projection, shared with the resident model, so the persisted index
          // and the in-memory summaries can never drift in shape.
          const existingSummary = existingSummaryById.get(note.id);
          const existingFileId = existingSummary?.fileId;

          if (existingFileId && existingSummary?.updatedAt === note.updatedAt) {
            return {
              ...buildNoteSummary(note),
              fileId: existingFileId,
            } satisfies SutraPadNoteSummary;
          }

          const existingNoteFile: DriveFileRecord | null = existingFileId
            ? await this.#client.fetchFileMetadata(existingFileId).catch(
                () =>
                  ({
                    id: existingFileId,
                    name: noteFileName(note.id),
                  }) as DriveFileRecord,
              )
            : await this.findNoteFileById(note.id, workspaceFolder.id);

          const file = await this.#client.uploadJsonFile({
            fileId: existingNoteFile?.id,
            fileName: noteFileName(note.id),
            data: note,
            folderId: workspaceFolder.id,
            appProperties: {
              sutrapad: "true",
              kind: "note",
              noteId: note.id,
            },
          });

          await this.#client.ensureFileInFolder(file.id, workspaceFolder.id);

          return {
            ...buildNoteSummary(note),
            fileId: file.id,
          } satisfies SutraPadNoteSummary;
        }),
      ),
      this.findTagIndexFile(workspaceFolder.id),
      this.findLinkIndexFile(workspaceFolder.id),
      this.findTaskIndexFile(workspaceFolder.id),
      this.findHeadFile(workspaceFolder.id),
    ]);

    const finalIndex: SutraPadIndex = {
      ...nextIndex,
      notes: savedNotes,
    };
    const tagIndex = buildTagIndex(workspace, finalIndex.savedAt);
    const linkIndex = buildLinkIndex(workspace, finalIndex.savedAt);
    const taskIndex = buildTaskIndex(workspace, finalIndex.savedAt);

    // Each of the four index uploads is followed by an
    // `ensureFileInFolder` to guarantee the new revision is parented
    // under the workspace folder (Drive's REST API can detach a
    // file's folder on multipart updates, so we re-parent
    // defensively). Both halves are intra-chain dependencies — the
    // ensure needs the upload's resulting file id — but the four
    // chains are independent of each other and run concurrently.
    const uploadAndEnsure = async (params: {
      fileId?: string;
      fileName: string;
      data: unknown;
      appProperties: Record<string, string>;
    }): Promise<DriveFileRecord> => {
      const file = await this.#client.uploadJsonFile({
        fileId: params.fileId,
        fileName: params.fileName,
        data: params.data,
        folderId: workspaceFolder.id,
        appProperties: params.appProperties,
      });
      await this.#client.ensureFileInFolder(file.id, workspaceFolder.id);
      return file;
    };

    const [indexSnapshotFile] = await Promise.all([
      uploadAndEnsure({
        fileName: this.buildIndexSnapshotFileName(finalIndex.savedAt),
        data: finalIndex,
        appProperties: { sutrapad: "true", kind: "index" },
      }),
      uploadAndEnsure({
        fileId: existingTagIndexFile?.id,
        fileName: TAG_INDEX_FILE_NAME,
        data: tagIndex,
        appProperties: { sutrapad: "true", kind: "tags" },
      }),
      uploadAndEnsure({
        fileId: existingLinkIndexFile?.id,
        fileName: LINK_INDEX_FILE_NAME,
        data: linkIndex,
        appProperties: { sutrapad: "true", kind: "links" },
      }),
      uploadAndEnsure({
        fileId: existingTaskIndexFile?.id,
        fileName: TASK_INDEX_FILE_NAME,
        data: taskIndex,
        appProperties: { sutrapad: "true", kind: "tasks" },
      }),
    ]);

    // Head update + cleanup of stale index snapshots both need
    // `indexSnapshotFile.id` and are otherwise independent — last
    // pair of operations runs in parallel.
    const head: SutraPadHead = {
      version: 1,
      activeIndexId: indexSnapshotFile.id,
      savedAt: finalIndex.savedAt,
    };

    await Promise.all([
      (async () => {
        await this.#client.uploadJsonFile({
          fileId: existingHeadFile?.id,
          fileName: HEAD_FILE_NAME,
          data: head,
          folderId: workspaceFolder.id,
          appProperties: { sutrapad: "true", kind: "head" },
        });
        if (existingHeadFile) {
          await this.#client.ensureFileInFolder(existingHeadFile.id, workspaceFolder.id);
        }
      })(),
      this.cleanupOldIndexSnapshots(workspaceFolder.id, indexSnapshotFile.id),
    ]);
  }

  private buildIndexSnapshotFileName(savedAt: string): string {
    const compactTimestamp = savedAt.replaceAll(/[:.]/gu, "-");
    return `index-${compactTimestamp}.json`;
  }

  private async loadLegacyDocument(folderId?: string): Promise<SutraPadDocument | null> {
    const legacyFile = await this.findLegacyFile(folderId);
    if (!legacyFile) {
      return null;
    }

    const document = await this.#client.fetchJsonFile<SutraPadDocument>(legacyFile.id);
    return normalizeNoteDocument(document);
  }

  private getWorkspaceFolder(): Promise<DriveFileRecord> {
    if (!this.#workspaceFolderPromise) {
      this.#workspaceFolderPromise = (async () => {
        const existingFolder = await this.findWorkspaceFolder();
        return (
          existingFolder ??
          (await this.#client.createFolder({
            name: WORKSPACE_FOLDER_NAME,
            appProperties: { sutrapad: "true", kind: "folder" },
          }))
        );
      })();
    }

    return this.#workspaceFolderPromise;
  }

  private findWorkspaceFolder(): Promise<DriveFileRecord | null> {
    return this.#client.findSingleFile(
      `trashed = false and mimeType = '${escapeDriveQueryValue(GOOGLE_DRIVE_FOLDER_MIME_TYPE)}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='folder' } and name = '${escapeDriveQueryValue(WORKSPACE_FOLDER_NAME)}'`,
    );
  }

  /**
   * Two-stage artifact lookup used by every `find*File` helper: try
   * inside the workspace folder first (fast, cheap, covers 99 % of
   * the live state), then fall back to the global by-name+kind
   * search to handle legacy or detached files left over from old
   * versions of the app. Returning the same kind of value either
   * way keeps the call sites short.
   */
  private async findArtifactFile(options: {
    kind: string;
    fileName: string;
    folderId?: string;
  }): Promise<DriveFileRecord | null> {
    const kindClause = `appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='${escapeDriveQueryValue(options.kind)}' }`;
    const inFolder = options.folderId
      ? await this.#client.findSingleFile(
          `${this.buildFolderQuery(options.folderId)} and ${kindClause}`,
        )
      : null;
    if (inFolder) return inFolder;

    return this.#client.findSingleFile(
      `trashed = false and name = '${escapeDriveQueryValue(options.fileName)}' and ${kindClause}`,
    );
  }

  private findHeadFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "head", fileName: HEAD_FILE_NAME, folderId });
  }

  private findIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({
      kind: "index",
      fileName: LEGACY_INDEX_FILE_NAME,
      folderId,
    });
  }

  private findTagIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "tags", fileName: TAG_INDEX_FILE_NAME, folderId });
  }

  private findLinkIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "links", fileName: LINK_INDEX_FILE_NAME, folderId });
  }

  private findTaskIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "tasks", fileName: TASK_INDEX_FILE_NAME, folderId });
  }

  private findIndexSnapshotFiles(folderId: string): Promise<DriveFileRecord[]> {
    return this.#client.findFiles(
      `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='index' }`,
      MAX_INDEX_SNAPSHOTS + 20,
    );
  }

  private async resolveActiveIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    const headFile = await this.findHeadFile(folderId);
    if (headFile) {
      const head = await this.#client.fetchJsonFile<SutraPadHead>(headFile.id);
      const activeIndex = await this.#client
        .fetchFileMetadata(head.activeIndexId)
        .catch(() => null);
      if (activeIndex) {
        return activeIndex;
      }
    }

    return this.findIndexFile(folderId);
  }

  private async findNoteFileById(
    noteId: string,
    folderId?: string,
  ): Promise<DriveFileRecord | null> {
    const query = `appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' } and appProperties has { key='noteId' and value='${escapeDriveQueryValue(noteId)}' }`;
    const inFolder = folderId
      ? await this.#client.findSingleFile(`${this.buildFolderQuery(folderId)} and ${query}`)
      : null;

    if (inFolder) {
      return inFolder;
    }

    return this.#client.findSingleFile(`trashed = false and ${query}`);
  }

  private async findLegacyFile(folderId?: string): Promise<DriveFileRecord | null> {
    const folderLegacy = folderId
      ? await this.#client.findSingleFile(
          `${this.buildFolderQuery(folderId)} and name = '${escapeDriveQueryValue(LEGACY_FILE_NAME)}' and appProperties has { key='sutrapad' and value='true' }`,
        )
      : null;

    if (folderLegacy) {
      return folderLegacy;
    }

    const byLegacyName = await this.#client.findSingleFile(
      `trashed = false and name = '${escapeDriveQueryValue(LEGACY_FILE_NAME)}' and appProperties has { key='sutrapad' and value='true' }`,
    );
    if (byLegacyName) {
      return byLegacyName;
    }

    return this.#client.findSingleFile(
      "trashed = false and appProperties has { key='sutrapad' and value='true' }",
    );
  }

  private buildFolderQuery(folderId: string): string {
    return `trashed = false and '${escapeDriveQueryValue(folderId)}' in parents`;
  }

  private async cleanupOldIndexSnapshots(folderId: string, activeIndexId: string): Promise<void> {
    const snapshotFiles = await this.findIndexSnapshotFiles(folderId);
    const staleSnapshots = snapshotFiles
      .filter((file) => file.id !== activeIndexId)
      .toSorted((left, right) => right.name.localeCompare(left.name))
      .slice(MAX_INDEX_SNAPSHOTS - 1);

    await Promise.all(staleSnapshots.map((file) => this.#client.deleteFile(file.id)));
  }
}
