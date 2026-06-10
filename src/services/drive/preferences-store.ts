/**
 * Drive store for cross-device user preferences.
 *
 * Owns the `sutrapad-preferences.json` artifact inside the SutraPad
 * workspace folder. Today the only field is the dismissed tag-alias
 * set; the file shape is open so future preferences (synced theme,
 * synced persona stance, etc.) can slot in without changing the
 * surrounding wiring.
 *
 * Kept in its own store (rather than baked into
 * `workspace-store.ts`) for the same reason `lexicon-store.ts` is
 * separate: the workspace store owns the notebook concern — notes,
 * head pointer, derived indexes — and shouldn't grow preference-
 * shaped concepts. Both stores share the workspace folder and
 * converge on it via the same `name` + `appProperties` query.
 *
 * Conflict policy is last-write-wins: load always trusts Drive, save
 * always writes the local set. Mirrors the rest of SutraPad's sync
 * model and keeps the code free of merge logic — Filip is N=1 today,
 * and concurrent-edit races across devices are vanishingly rare for
 * preferences (you don't sit on two devices clicking "Keep separate"
 * on the same pair in the same second).
 */
import type { DriveFileRecord, SutraPadPreferences } from "../../types";
import {
  escapeDriveQueryValue,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GoogleDriveClient,
} from "./client";

const WORKSPACE_FOLDER_NAME = "SutraPad";
const PREFERENCES_FILE_NAME = "sutrapad-preferences.json";
const PREFERENCES_KIND = "preferences";

export class GoogleDrivePreferencesStore {
  readonly #client: GoogleDriveClient;
  #workspaceFolderPromise: Promise<DriveFileRecord> | null = null;

  constructor(accessToken: string) {
    this.#client = new GoogleDriveClient(accessToken);
  }

  /**
   * Returns the preferences blob stored on Drive, or `null` when no
   * file exists yet (first-time use on this account, or a fresh
   * install before the first save). Callers treat `null` as "keep
   * whatever was in localStorage" — overwriting the local copy with
   * an empty set would silently throw away a session's dismissals
   * the moment the user signed in.
   */
  async loadPreferences(): Promise<SutraPadPreferences | null> {
    const folder = await this.findWorkspaceFolder();
    const file = await this.findPreferencesFile(folder?.id);
    if (!file) return null;
    return this.#client.fetchJsonFile<SutraPadPreferences>(file.id);
  }

  /**
   * Writes the preferences blob to Drive. Creates the SutraPad folder
   * on demand if it doesn't exist yet (e.g. user signed in for the
   * first time and dismissed a tag pair before saving any notes).
   * After upload, an `ensureFileInFolder` PATCH guarantees the file
   * is parented under the workspace folder, mirroring the workspace
   * and lexicon stores.
   */
  async savePreferences(preferences: SutraPadPreferences): Promise<void> {
    const folder = await this.getWorkspaceFolder();
    const existing = await this.findPreferencesFile(folder.id);
    const file = await this.#client.uploadJsonFile({
      fileId: existing?.id,
      fileName: PREFERENCES_FILE_NAME,
      data: preferences,
      folderId: folder.id,
      appProperties: { sutrapad: "true", kind: PREFERENCES_KIND },
    });
    await this.#client.ensureFileInFolder(file.id, folder.id);
  }

  private getWorkspaceFolder(): Promise<DriveFileRecord> {
    if (!this.#workspaceFolderPromise) {
      this.#workspaceFolderPromise = (async () => {
        const existing = await this.findWorkspaceFolder();
        return (
          existing ??
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

  private async findPreferencesFile(
    folderId?: string,
  ): Promise<DriveFileRecord | null> {
    const kindClause = `appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='${PREFERENCES_KIND}' }`;
    if (folderId) {
      const inFolder = await this.#client.findSingleFile(
        `trashed = false and '${escapeDriveQueryValue(folderId)}' in parents and ${kindClause}`,
      );
      if (inFolder) return inFolder;
    }
    return this.#client.findSingleFile(
      `trashed = false and name = '${escapeDriveQueryValue(PREFERENCES_FILE_NAME)}' and ${kindClause}`,
    );
  }
}
