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

  return {
    version: 1,
    updatedAt: savedAt,
    savedAt,
    previousIndexId,
    activeNoteId: workspace.activeNoteId,
    notes: workspace.notes.map((note) => {
      const previous = existingIndex?.notes.find((entry) => entry.id === note.id);
      return {
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        fileId: previous?.fileId,
      };
    }),
  };
}

export class GoogleDriveStore {
  readonly #client: GoogleDriveClient;
  #workspaceFolderPromise: Promise<DriveFileRecord> | null = null;

  constructor(accessToken: string) {
    this.#client = new GoogleDriveClient(accessToken);
  }

  async loadWorkspace(): Promise<SutraPadWorkspace> {
    const workspaceFolder = await this.findWorkspaceFolder();
    const indexFile = await this.resolveActiveIndexFile(workspaceFolder?.id);

    if (!indexFile) {
      const legacyDocument = await this.loadLegacyDocument(workspaceFolder?.id);
      if (legacyDocument) {
        return {
          notes: [legacyDocument],
          activeNoteId: legacyDocument.id,
        };
      }

      return createEmptyWorkspace();
    }

    const index = await this.#client.fetchJsonFile<SutraPadIndex>(indexFile.id);
    const notes = await Promise.all(
      index.notes.map(async (entry) => {
        const fileId =
          entry.fileId ?? (await this.findNoteFileById(entry.id, workspaceFolder?.id))?.id;
        if (!fileId) {
          return null;
        }

        const document = await this.#client.fetchJsonFile<SutraPadDocument>(fileId);
        return {
          ...document,
          createdAt: document.createdAt ?? document.updatedAt,
          urls: document.urls ?? extractUrlsFromText(document.body),
          tags: document.tags ?? [],
        };
      }),
    );

    const hydratedNotes = notes.filter((note): note is SutraPadDocument => note !== null);
    if (hydratedNotes.length === 0) {
      return createEmptyWorkspace();
    }

    const activeNoteId = hydratedNotes.some((note) => note.id === index.activeNoteId)
      ? index.activeNoteId
      : hydratedNotes[0].id;

    return {
      notes: hydratedNotes.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      activeNoteId,
    };
  }

  /**
   * Fast path used by the silent-capture flow: appends a single new
   * note to the user's workspace without re-uploading every other
   * note file or rebuilding the derived tag / link / task indexes.
   *
   * The full `saveWorkspace` is overkill for this path — it (a) reads
   * every note's full body via `loadWorkspace` first (so the runner
   * can pass the merged workspace back down) and (b) re-uploads four
   * derived index files. None of that work is necessary when adding
   * one note: the tag/link/task indexes on Drive are write-only
   * caches (nothing in the app reads them — `buildTagIndex` and
   * friends rebuild from `workspace.notes` in memory on every load),
   * so leaving them slightly stale between captures is harmless. The
   * next main-app save refreshes them.
   *
   * Round-trip cost: 4-6 (workspace folder, parallel index lookup +
   * head lookup + note upload, fetch existing index, index snapshot
   * upload + ensure, head + cleanup in parallel) — versus 30+ for
   * the load+save pair on a workspace with even a handful of notes.
   */
  async appendNoteToWorkspace(note: SutraPadDocument): Promise<void> {
    const workspaceFolder = await this.getWorkspaceFolder();

    // Three independent batches in parallel: upload the new note
    // file, find the active index file, and find the head pointer.
    // None reads from another so we save ~2×RTT here.
    const [noteFile, existingIndexFile, existingHeadFile] = await Promise.all([
      (async () => {
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
        await this.#client.ensureFileInFolder(file.id, workspaceFolder.id);
        return file;
      })(),
      this.resolveActiveIndexFile(workspaceFolder.id),
      this.findHeadFile(workspaceFolder.id),
    ]);

    // Load existing index after we know which file holds it. If
    // there's no active index file (first-ever save?), start fresh
    // with a minimal one.
    const existingIndex = existingIndexFile
      ? await this.#client.fetchJsonFile<SutraPadIndex>(existingIndexFile.id)
      : null;

    const noteSummary: SutraPadNoteSummary = {
      id: note.id,
      title: note.title,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      fileId: noteFile.id,
    };
    // Replace any stale summary for the same note id (defensive — a
    // re-save of the same note id should overwrite, not duplicate).
    const otherSummaries = (existingIndex?.notes ?? []).filter(
      (entry) => entry.id !== note.id,
    );
    const savedAt = new Date().toISOString();
    const finalIndex: SutraPadIndex = {
      version: 1,
      savedAt,
      // `updatedAt` on the index tracks workspace-level last-touched
      // — same value as `savedAt` for an append, since the act of
      // saving counts as the last update. Keeps the index shape
      // consistent with what `createIndex` produces in the full
      // `saveWorkspace` path.
      updatedAt: savedAt,
      activeNoteId: note.id,
      notes: [noteSummary, ...otherSummaries],
      previousIndexId: existingIndexFile?.id,
    };

    // Snapshot upload + ensure (sequential within the chain because
    // ensure needs the file id from upload).
    const indexSnapshotFile = await this.#client.uploadJsonFile({
      fileName: this.buildIndexSnapshotFileName(savedAt),
      data: finalIndex,
      folderId: workspaceFolder.id,
      appProperties: { sutrapad: "true", kind: "index" },
    });
    await this.#client.ensureFileInFolder(indexSnapshotFile.id, workspaceFolder.id);

    // Head update + cleanup of stale snapshots in parallel — both
    // depend on `indexSnapshotFile.id` and are independent of each
    // other.
    const head: SutraPadHead = {
      version: 1,
      activeIndexId: indexSnapshotFile.id,
      savedAt,
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

  async saveWorkspace(workspace: SutraPadWorkspace): Promise<void> {
    const workspaceFolder = await this.getWorkspaceFolder();
    const existingIndexFile = await this.resolveActiveIndexFile(workspaceFolder.id);
    const existingIndex = existingIndexFile
      ? await this.#client.fetchJsonFile<SutraPadIndex>(existingIndexFile.id)
      : null;

    const nextIndex = createIndex(workspace, existingIndex, existingIndexFile?.id);

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
          const existingSummary = existingIndex?.notes.find((entry) => entry.id === note.id);
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
    return {
      ...document,
      createdAt: document.createdAt ?? document.updatedAt,
      urls: document.urls ?? extractUrlsFromText(document.body),
      tags: document.tags ?? [],
    };
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
