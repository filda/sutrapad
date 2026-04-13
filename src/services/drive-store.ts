import type { DriveFileRecord, SutraPadDocument } from "../types";

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

function createInitialDocument(): SutraPadDocument {
  return {
    id: crypto.randomUUID(),
    title: "My first note",
    body: "Start writing here.",
    updatedAt: new Date().toISOString(),
  };
}

export class GoogleDriveStore {
  readonly #token: string;
  readonly #fileName: string;

  constructor(accessToken: string, fileName = import.meta.env.VITE_SUTRAPAD_FILE_NAME || "sutrapad-data.json") {
    this.#token = accessToken;
    this.#fileName = fileName;
  }

  async load(): Promise<SutraPadDocument> {
    const file = await this.findAppFile();

    if (!file) {
      const initial = createInitialDocument();
      await this.save(initial);
      return initial;
    }

    const response = await fetch(`${GOOGLE_DRIVE_API}/${file.id}?alt=media`, {
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to load data from Google Drive.");
    }

    return (await response.json()) as SutraPadDocument;
  }

  async save(document: SutraPadDocument): Promise<void> {
    const existingFile = await this.findAppFile();
    const metadata = {
      name: this.#fileName,
      mimeType: "application/json",
      appProperties: {
        sutrapad: "true",
      },
    };

    const formData = new FormData();
    formData.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    formData.append(
      "file",
      new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }),
    );

    const url = existingFile
      ? `${GOOGLE_DRIVE_UPLOAD_API}/${existingFile.id}?uploadType=multipart`
      : `${GOOGLE_DRIVE_UPLOAD_API}?uploadType=multipart`;

    const method = existingFile ? "PATCH" : "POST";
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Failed to save data to Google Drive.");
    }
  }

  private async findAppFile(): Promise<DriveFileRecord | null> {
    const query = encodeURIComponent("trashed = false and appProperties has { key='sutrapad' and value='true' }");
    const response = await fetch(
      `${GOOGLE_DRIVE_API}?q=${query}&fields=files(id,name)&pageSize=1`,
      {
        headers: {
          Authorization: `Bearer ${this.#token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Failed to find application data in Google Drive.");
    }

    const payload = (await response.json()) as { files?: DriveFileRecord[] };
    return payload.files?.[0] ?? null;
  }
}
