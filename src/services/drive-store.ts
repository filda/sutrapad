import type {DriveFileRecord, SutraPadDocument, SutraPadIndex, SutraPadNoteSummary, SutraPadWorkspace,} from "../types";

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

const INDEX_FILE_NAME = import.meta.env.VITE_SUTRAPAD_FILE_NAME || "sutrapad-index.json";
const LEGACY_FILE_NAME = "sutrapad-data.json";

function createInitialDocument(): SutraPadDocument {
  return {
    id: crypto.randomUUID(),
    title: "My first note",
    body: "Start writing here.",
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyWorkspace(): SutraPadWorkspace {
  const note = createInitialDocument();
  return {
    notes: [note],
    activeNoteId: note.id,
  };
}

function createIndex(workspace: SutraPadWorkspace, existingIndex?: SutraPadIndex | null): SutraPadIndex {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    activeNoteId: workspace.activeNoteId,
    notes: workspace.notes.map((note) => {
      const previous = existingIndex?.notes.find((entry) => entry.id === note.id);
      return {
        id: note.id,
        title: note.title,
        updatedAt: note.updatedAt,
        fileId: previous?.fileId,
      };
    }),
  };
}

export class GoogleDriveStore {
  readonly #token: string;

  constructor(accessToken: string) {
    this.#token = accessToken;
  }

  async loadWorkspace(): Promise<SutraPadWorkspace> {
    const indexFile = await this.findIndexFile();

    if (!indexFile) {
      const legacyDocument = await this.loadLegacyDocument();
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
        const fileId = entry.fileId ?? (await this.findNoteFileById(entry.id))?.id;
        if (!fileId) {
          return null;
        }

        return await this.fetchJsonFile<SutraPadDocument>(fileId);
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
    const existingIndexFile = await this.findIndexFile();
    const existingIndex = existingIndexFile
      ? await this.fetchJsonFile<SutraPadIndex>(existingIndexFile.id)
      : null;

    const nextIndex = createIndex(workspace, existingIndex);
    const savedNotes = await Promise.all(
      workspace.notes.map(async (note) => {
        const existingSummary = existingIndex?.notes.find((entry) => entry.id === note.id);
        const existingNoteFile = existingSummary?.fileId
          ? { id: existingSummary.fileId }
          : await this.findNoteFileById(note.id);

        const file = await this.uploadJsonFile({
          fileId: existingNoteFile?.id,
          fileName: `note-${note.id}.json`,
          data: note,
          appProperties: {
            sutrapad: "true",
            kind: "note",
            noteId: note.id,
          },
        });

        return {
          id: note.id,
          title: note.title,
          updatedAt: note.updatedAt,
          fileId: file.id,
        } satisfies SutraPadNoteSummary;
      }),
    );

    const finalIndex: SutraPadIndex = {
      ...nextIndex,
      notes: savedNotes,
    };

    await this.uploadJsonFile({
      fileId: existingIndexFile?.id,
      fileName: INDEX_FILE_NAME,
      data: finalIndex,
      appProperties: {
        sutrapad: "true",
        kind: "index",
      },
    });
  }

  private async loadLegacyDocument(): Promise<SutraPadDocument | null> {
    const legacyFile = await this.findLegacyFile();
    if (!legacyFile) {
      return null;
    }

    return this.fetchJsonFile<SutraPadDocument>(legacyFile.id);
  }

  private async findIndexFile(): Promise<DriveFileRecord | null> {
    return this.findSingleFile("trashed = false and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='index' }");
  }

  private async findNoteFileById(noteId: string): Promise<DriveFileRecord | null> {
    return this.findSingleFile(
      `trashed = false and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' } and appProperties has { key='noteId' and value='${noteId}' }`,
    );
  }

  private async findLegacyFile(): Promise<DriveFileRecord | null> {
    const byLegacyName = await this.findSingleFile(
      `trashed = false and name = '${LEGACY_FILE_NAME}' and appProperties has { key='sutrapad' and value='true' }`,
    );
    if (byLegacyName) {
      return byLegacyName;
    }

    return this.findSingleFile("trashed = false and appProperties has { key='sutrapad' and value='true' }");
  }

  private async findSingleFile(query: string): Promise<DriveFileRecord | null> {
    const response = await fetch(
      `${GOOGLE_DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,appProperties)&pageSize=1`,
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
    return payload.files?.[0] ?? null;
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

  private async uploadJsonFile<T>({
    fileId,
    fileName,
    data,
    appProperties,
  }: {
    fileId?: string;
    fileName: string;
    data: T;
    appProperties: Record<string, string>;
  }): Promise<DriveFileRecord> {
    const metadata = {
      name: fileName,
      mimeType: "application/json",
      appProperties,
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
