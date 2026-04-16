import type {
  DriveFileRecord,
  SutraPadDocument,
  SutraPadHead,
  SutraPadIndex,
  SutraPadNoteSummary,
  SutraPadWorkspace,
} from "../types";
import { buildLinkIndex, buildTagIndex, extractUrlsFromText } from "../lib/notebook";

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const LEGACY_INDEX_FILE_NAME = import.meta.env.VITE_SUTRAPAD_FILE_NAME || "sutrapad-index.json";
const LEGACY_FILE_NAME = "sutrapad-data.json";
const HEAD_FILE_NAME = "sutrapad-head.json";
const TAG_INDEX_FILE_NAME = "sutrapad-tags.json";
const LINK_INDEX_FILE_NAME = "sutrapad-links.json";
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
  readonly #token: string;
  #workspaceFolderPromise: Promise<DriveFileRecord> | null = null;

  constructor(accessToken: string) {
    this.#token = accessToken;
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

    const index = await this.fetchJsonFile<SutraPadIndex>(indexFile.id);
    const notes = await Promise.all(
      index.notes.map(async (entry) => {
        const fileId =
          entry.fileId ?? (await this.findNoteFileById(entry.id, workspaceFolder?.id))?.id;
        if (!fileId) {
          return null;
        }

        const document = await this.fetchJsonFile<SutraPadDocument>(fileId);
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
      notes: hydratedNotes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      activeNoteId,
    };
  }

  async saveWorkspace(workspace: SutraPadWorkspace): Promise<void> {
    const workspaceFolder = await this.getWorkspaceFolder();
    const existingIndexFile = await this.resolveActiveIndexFile(workspaceFolder.id);
    const existingIndex = existingIndexFile
      ? await this.fetchJsonFile<SutraPadIndex>(existingIndexFile.id)
      : null;

    const nextIndex = createIndex(workspace, existingIndex, existingIndexFile?.id);
    const savedNotes = await Promise.all(
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
          ? await this.fetchFileMetadata(existingFileId).catch(
              () =>
                ({
                  id: existingFileId,
                  name: `note-${note.id}.json`,
                }) as DriveFileRecord,
            )
          : await this.findNoteFileById(note.id, workspaceFolder.id);

        const file = await this.uploadJsonFile({
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

        await this.ensureFileInFolder(file.id, workspaceFolder.id);

        return {
          id: note.id,
          title: note.title,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          fileId: file.id,
        } satisfies SutraPadNoteSummary;
      }),
    );

    const finalIndex: SutraPadIndex = {
      ...nextIndex,
      notes: savedNotes,
    };
    const tagIndex = buildTagIndex(workspace, finalIndex.savedAt);
    const linkIndex = buildLinkIndex(workspace, finalIndex.savedAt);

    const indexSnapshotFile = await this.uploadJsonFile({
      fileName: this.buildIndexSnapshotFileName(finalIndex.savedAt),
      data: finalIndex,
      folderId: workspaceFolder.id,
      appProperties: {
        sutrapad: "true",
        kind: "index",
      },
    });

    await this.ensureFileInFolder(indexSnapshotFile.id, workspaceFolder.id);

    const existingTagIndexFile = await this.findTagIndexFile(workspaceFolder.id);
    const tagIndexFile = await this.uploadJsonFile({
      fileId: existingTagIndexFile?.id,
      fileName: TAG_INDEX_FILE_NAME,
      data: tagIndex,
      folderId: workspaceFolder.id,
      appProperties: {
        sutrapad: "true",
        kind: "tags",
      },
    });

    await this.ensureFileInFolder(tagIndexFile.id, workspaceFolder.id);

    const existingLinkIndexFile = await this.findLinkIndexFile(workspaceFolder.id);
    const linkIndexFile = await this.uploadJsonFile({
      fileId: existingLinkIndexFile?.id,
      fileName: LINK_INDEX_FILE_NAME,
      data: linkIndex,
      folderId: workspaceFolder.id,
      appProperties: {
        sutrapad: "true",
        kind: "links",
      },
    });

    await this.ensureFileInFolder(linkIndexFile.id, workspaceFolder.id);

    const existingHeadFile = await this.findHeadFile(workspaceFolder.id);
    const head: SutraPadHead = {
      version: 1,
      activeIndexId: indexSnapshotFile.id,
      savedAt: finalIndex.savedAt,
    };

    await this.uploadJsonFile({
      fileId: existingHeadFile?.id,
      fileName: HEAD_FILE_NAME,
      data: head,
      folderId: workspaceFolder.id,
      appProperties: {
        sutrapad: "true",
        kind: "head",
      },
    });

    if (existingHeadFile) {
      await this.ensureFileInFolder(existingHeadFile.id, workspaceFolder.id);
    }

    await this.cleanupOldIndexSnapshots(workspaceFolder.id, indexSnapshotFile.id);
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

    const document = await this.fetchJsonFile<SutraPadDocument>(legacyFile.id);
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
        return existingFolder ?? (await this.createWorkspaceFolder());
      })();
    }

    return this.#workspaceFolderPromise;
  }

  private async findWorkspaceFolder(): Promise<DriveFileRecord | null> {
    return this.findSingleFile(
      `trashed = false and mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='folder' } and name = '${WORKSPACE_FOLDER_NAME}'`,
    );
  }

  private async createWorkspaceFolder(): Promise<DriveFileRecord> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}?fields=id,name,mimeType,appProperties,parents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: WORKSPACE_FOLDER_NAME,
          mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
          appProperties: {
            sutrapad: "true",
            kind: "folder",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to create the SutraPad folder in Google Drive.");
    }

    return (await response.json()) as DriveFileRecord;
  }

  private async findHeadFile(folderId?: string): Promise<DriveFileRecord | null> {
    const inFolder = folderId
      ? await this.findSingleFile(
          `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='head' }`,
        )
      : null;

    if (inFolder) {
      return inFolder;
    }

    return this.findSingleFile(
      `trashed = false and name = '${HEAD_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='head' }`,
    );
  }

  private async findIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    const inFolder = folderId
      ? await this.findSingleFile(
          `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='index' }`,
        )
      : null;

    if (inFolder) {
      return inFolder;
    }

    return this.findSingleFile(
      `trashed = false and name = '${LEGACY_INDEX_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='index' }`,
    );
  }

  private async findTagIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    const inFolder = folderId
      ? await this.findSingleFile(
          `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='tags' }`,
        )
      : null;

    if (inFolder) {
      return inFolder;
    }

    return this.findSingleFile(
      `trashed = false and name = '${TAG_INDEX_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='tags' }`,
    );
  }

  private async findLinkIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    const inFolder = folderId
      ? await this.findSingleFile(
          `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='links' }`,
        )
      : null;

    if (inFolder) {
      return inFolder;
    }

    return this.findSingleFile(
      `trashed = false and name = '${LINK_INDEX_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='links' }`,
    );
  }

  private async findIndexSnapshotFiles(folderId: string): Promise<DriveFileRecord[]> {
    return this.findFiles(
      `${this.buildFolderQuery(folderId)} and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='index' }`,
      MAX_INDEX_SNAPSHOTS + 20,
    );
  }

  private async resolveActiveIndexFile(folderId?: string): Promise<DriveFileRecord | null> {
    const headFile = await this.findHeadFile(folderId);
    if (headFile) {
      const head = await this.fetchJsonFile<SutraPadHead>(headFile.id);
      const activeIndex = await this.fetchFileMetadata(head.activeIndexId).catch(() => null);
      if (activeIndex) {
        return activeIndex;
      }
    }

    return this.findIndexFile(folderId);
  }

  private async findNoteFileById(noteId: string, folderId?: string): Promise<DriveFileRecord | null> {
    const query = `appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' } and appProperties has { key='noteId' and value='${noteId}' }`;
    const inFolder = folderId
      ? await this.findSingleFile(`${this.buildFolderQuery(folderId)} and ${query}`)
      : null;

    if (inFolder) {
      return inFolder;
    }

    return this.findSingleFile(`trashed = false and ${query}`);
  }

  private async findLegacyFile(folderId?: string): Promise<DriveFileRecord | null> {
    const folderLegacy = folderId
      ? await this.findSingleFile(
          `${this.buildFolderQuery(folderId)} and name = '${LEGACY_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' }`,
        )
      : null;

    if (folderLegacy) {
      return folderLegacy;
    }

    const byLegacyName = await this.findSingleFile(
      `trashed = false and name = '${LEGACY_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' }`,
    );
    if (byLegacyName) {
      return byLegacyName;
    }

    return this.findSingleFile(
      "trashed = false and appProperties has { key='sutrapad' and value='true' }",
    );
  }

  private buildFolderQuery(folderId: string): string {
    return `trashed = false and '${folderId}' in parents`;
  }

  private async findSingleFile(query: string): Promise<DriveFileRecord | null> {
    const files = await this.findFiles(query, 1);
    return files[0] ?? null;
  }

  private async findFiles(query: string, pageSize: number): Promise<DriveFileRecord[]> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,appProperties,parents)&pageSize=${pageSize}`,
      {
        headers: {
          Authorization: `Bearer ${this.#token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Failed to query Google Drive.");
    }

    const payload = (await response.json()) as { files?: DriveFileRecord[] };
    return payload.files ?? [];
  }

  private async fetchJsonFile<T>(fileId: string): Promise<T> {
    const response = await fetch(`${GOOGLE_DRIVE_API}/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to load data from Google Drive.");
    }

    return (await response.json()) as T;
  }

  private async ensureFileInFolder(fileId: string, folderId: string): Promise<void> {
    const metadata = await this.fetchFileMetadata(fileId);
    const currentParents: string[] = metadata.parents ?? [];
    const otherParents = currentParents.filter((parentId: string) => parentId !== folderId);

    if (currentParents.includes(folderId) && otherParents.length === 0) {
      return;
    }

    const params = new URLSearchParams({
      addParents: folderId,
      fields: "id,name,mimeType,appProperties,parents",
    });

    if (otherParents.length > 0) {
      params.set("removeParents", otherParents.join(","));
    }

    const response = await fetch(`${GOOGLE_DRIVE_API}/${fileId}?${params.toString()}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to move SutraPad files into the Google Drive folder.");
    }
  }

  private async fetchFileMetadata(fileId: string): Promise<DriveFileRecord> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}/${fileId}?fields=id,name,mimeType,appProperties,parents`,
      {
        headers: {
          Authorization: `Bearer ${this.#token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Failed to inspect Google Drive file metadata.");
    }

    return (await response.json()) as DriveFileRecord;
  }

  private async deleteFile(fileId: string): Promise<void> {
    const response = await fetch(`${GOOGLE_DRIVE_API}/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to delete an old SutraPad index snapshot from Google Drive.");
    }
  }

  private async cleanupOldIndexSnapshots(folderId: string, activeIndexId: string): Promise<void> {
    const snapshotFiles = await this.findIndexSnapshotFiles(folderId);
    const staleSnapshots = snapshotFiles
      .filter((file) => file.id !== activeIndexId)
      .sort((left, right) => right.name.localeCompare(left.name))
      .slice(MAX_INDEX_SNAPSHOTS - 1);

    await Promise.all(staleSnapshots.map(async (file) => this.deleteFile(file.id)));
  }

  private async uploadJsonFile<T>({
    fileId,
    fileName,
    data,
    folderId,
    appProperties,
  }: {
    fileId?: string;
    fileName: string;
    data: T;
    folderId: string;
    appProperties: Record<string, string>;
  }): Promise<DriveFileRecord> {
    const metadata = {
      name: fileName,
      mimeType: "application/json",
      appProperties,
      ...(fileId ? {} : { parents: [folderId] }),
    };

    const formData = new FormData();
    formData.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    formData.append(
      "file",
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );

    const url = fileId
      ? `${GOOGLE_DRIVE_UPLOAD_API}/${fileId}?uploadType=multipart`
      : `${GOOGLE_DRIVE_UPLOAD_API}?uploadType=multipart`;

    const response = await fetch(url, {
      method: fileId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Failed to save data to Google Drive.");
    }

    return (await response.json()) as DriveFileRecord;
  }
}
