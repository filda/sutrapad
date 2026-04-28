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
  SutraPadNoteSummary,
  SutraPadWorkspace,
} from "../../types";
import {
  buildLinkIndex,
  buildTagIndex,
  buildTaskIndex,
  extractUrlsFromText,
} from "../../lib/notebook";
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
 * Hard cap on the folder-scoped `kind=note` query that drives
 * `loadWorkspace`'s inventory. Drive's `pageSize` maxes at 1000;
 * SutraPad workspaces are nowhere near that today (typical: dozens),
 * so a single page covers every realistic user. If a workspace ever
 * grows past this we'd need pagination here — a load would silently
 * drop notes today, which we'd notice quickly.
 */
const MAX_WORKSPACE_NOTE_FILES = 1000;

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
  document.urls ??= extractUrlsFromText(document.body);
  document.tags ??= [];
  return document;
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

export class GoogleDriveStore {
  readonly #client: GoogleDriveClient;
  #workspaceFolderPromise: Promise<DriveFileRecord> | null = null;

  constructor(accessToken: string) {
    this.#client = new GoogleDriveClient(accessToken);
  }

  /**
   * Loads the workspace from Drive.
   *
   * **Folder-query-driven inventory**, not index-driven. The list of
   * notes is whatever `kind=note` files actually exist inside the
   * SutraPad workspace folder; the index file is only consulted for
   * the `activeNoteId` hint. This is the trade-off that lets the
   * silent-capture path (`appendNoteToWorkspace`) stay 3-RTT cheap by
   * not touching the index at all — the price is that the index can
   * drift behind the folder by N captures, and we have to be tolerant
   * of that drift here on the read side.
   *
   * Self-healing: the next interactive `saveWorkspace` rebuilds the
   * index from `workspace.notes`, so any orphan files captured by the
   * bookmarklet between two main-app sessions are folded into the
   * canonical index the moment the user makes any edit.
   *
   * Critical-path round-trips (happy path with both index + folder
   * present): folder lookup → parallel(index lookup, notes-in-folder
   * query) → parallel(head JSON fetch, all note JSON fetches). The
   * index fetch never extends critical path because it runs alongside
   * the always-required note JSON fetches.
   */
  async loadWorkspace(): Promise<SutraPadWorkspace> {
    const workspaceFolder = await this.findWorkspaceFolder();

    // Two parallel inventories: the canonical "what notes exist in
    // the folder right now" query (source of truth for `notes`), and
    // the index file lookup (source of truth for `activeNoteId`).
    // Either may be missing in legitimate workspaces — first-ever
    // load before any save, or migrated-from-legacy users — and the
    // fallback paths below handle each case.
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

    // Fetch every note file in parallel alongside the (optional)
    // index JSON. The index is only used to look up `activeNoteId`
    // — its `notes` array is ignored because the folder query is
    // authoritative. We tolerate index fetch failure (corrupt JSON,
    // 404 on stale head pointer) and fall back to "first note is
    // active".
    const [hydratedNotes, indexActiveNoteId] = await Promise.all([
      Promise.all(
        noteFiles.map(async (file) =>
          normalizeNoteDocument(
            await this.#client.fetchJsonFile<SutraPadDocument>(file.id),
          ),
        ),
      ),
      this.fetchIndexActiveNoteId(indexFile),
    ]);

    if (hydratedNotes.length === 0) {
      return createEmptyWorkspace();
    }

    const sortedNotes = hydratedNotes.toSorted(
      (left, right) => right.updatedAt.localeCompare(left.updatedAt),
    );
    const activeNoteId =
      indexActiveNoteId !== null && sortedNotes.some((note) => note.id === indexActiveNoteId)
        ? indexActiveNoteId
        : sortedNotes[0].id;

    return {
      notes: sortedNotes,
      activeNoteId,
    };
  }

  /**
   * Defensive index read used by `loadWorkspace`. Returns the
   * `activeNoteId` if the index is fetchable + parseable, `null`
   * otherwise. Failures here are not fatal — load picks the most
   * recently updated note as the active one and the next save
   * rewrites the index.
   */
  private async fetchIndexActiveNoteId(indexFile: DriveFileRecord | null): Promise<string | null> {
    if (!indexFile) return null;
    try {
      const index = await this.#client.fetchJsonFile<SutraPadIndex>(indexFile.id);
      return index.activeNoteId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Returns every `kind=note` file inside the workspace folder.
   * This is what makes `loadWorkspace` tolerant of "orphan" notes
   * appended by the silent-capture bookmarklet without an index
   * update — they show up here because they exist on Drive,
   * regardless of whether the index knows about them.
   */
  private async findNoteFilesInFolder(folderId: string): Promise<DriveFileRecord[]> {
    return this.#client.findFiles(
      `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' }`,
      MAX_WORKSPACE_NOTE_FILES,
    );
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
  async appendNoteToWorkspace(note: SutraPadDocument): Promise<void> {
    const workspaceFolder = await this.getWorkspaceFolder();
    const file = await this.#client.uploadJsonFile({
      fileName: `note-${note.id}.json`,
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
          const existingSummary = existingSummaryById.get(note.id);
          const existingFileId = existingSummary?.fileId;

          if (existingFileId && existingSummary?.updatedAt === note.updatedAt) {
            return {
              id: note.id,
              title: note.title,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              fileId: existingFileId,
            } satisfies SutraPadNoteSummary;
          }

          const existingNoteFile: DriveFileRecord | null = existingFileId
            ? await this.#client.fetchFileMetadata(existingFileId).catch(
                () =>
                  ({
                    id: existingFileId,
                    name: `note-${note.id}.json`,
                  }) as DriveFileRecord,
              )
            : await this.findNoteFileById(note.id, workspaceFolder.id);

          const file = await this.#client.uploadJsonFile({
            fileId: existingNoteFile?.id,
            fileName: `note-${note.id}.json`,
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
            id: note.id,
            title: note.title,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
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
    const compactTimestamp = savedAt.replace(/[:.]/g, "-");
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

  private async getWorkspaceFolder(): Promise<DriveFileRecord> {
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

  private async findWorkspaceFolder(): Promise<DriveFileRecord | null> {
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

  private async findHeadFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "head", fileName: HEAD_FILE_NAME, folderId });
  }

  private async findIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({
      kind: "index",
      fileName: LEGACY_INDEX_FILE_NAME,
      folderId,
    });
  }

  private async findTagIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "tags", fileName: TAG_INDEX_FILE_NAME, folderId });
  }

  private async findLinkIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "links", fileName: LINK_INDEX_FILE_NAME, folderId });
  }

  private async findTaskIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    return this.findArtifactFile({ kind: "tasks", fileName: TASK_INDEX_FILE_NAME, folderId });
  }

  private async findIndexSnapshotFiles(folderId: string): Promise<DriveFileRecord[]> {
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

    await Promise.all(staleSnapshots.map(async (file) => this.#client.deleteFile(file.id)));
  }
}
