/**
 * Drive store for the Topic Lexicon Builder workbench.
 *
 * The builder lives inside the same Drive workspace folder (`SutraPad/`)
 * as the user's notes, distinguished by the `kind=lexicon-state` /
 * `kind=lexicon-runtime` appProperties. The two artifacts are kept
 * deliberately separate from the notebook flow:
 *
 *   - `sutrapad-topic-lexicon-builder-state.json` holds the editable
 *     working state — candidate queue, form-to-target map, rejected list.
 *     Hand-editable; autosaved after every decision.
 *   - `sutrapad-topic-lexicon.json` holds the regenerated runtime lookup
 *     used by future auto-tagging. Production code will eventually copy
 *     this file out of Drive into the repo; the builder itself never
 *     reads it back.
 *
 * Design note: we resolve the SutraPad folder via the same name +
 * appProperties query the workspace store uses, so both stores converge
 * on a single folder. We do NOT touch `workspace-store.ts` — that file
 * owns the notebook concern and shouldn't grow lexicon-shaped concepts.
 */
import type { BuilderState, RuntimeLexicon } from "../../app/logic/lexicon/types";
import type { DriveFileRecord } from "../../types";
import {
  escapeDriveQueryValue,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  GoogleDriveClient,
} from "./client";

const WORKSPACE_FOLDER_NAME = "SutraPad";
const STATE_FILE_NAME = "sutrapad-topic-lexicon-builder-state.json";
const RUNTIME_FILE_NAME = "sutrapad-topic-lexicon.json";

const STATE_KIND = "lexicon-state";
const RUNTIME_KIND = "lexicon-runtime";

export class GoogleDriveLexiconStore {
  readonly #client: GoogleDriveClient;
  #workspaceFolderPromise: Promise<DriveFileRecord> | null = null;

  constructor(accessToken: string) {
    this.#client = new GoogleDriveClient(accessToken);
  }

  /**
   * Returns the working state stored on Drive, or `null` when no file
   * exists yet (first-time use). The runtime file is intentionally not
   * touched — the builder regenerates it from working state, never reads
   * it back.
   */
  async loadState(): Promise<BuilderState | null> {
    const folder = await this.findWorkspaceFolder();
    const file = await this.findArtifactFile({
      kind: STATE_KIND,
      fileName: STATE_FILE_NAME,
      folderId: folder?.id,
    });
    if (!file) return null;
    return this.#client.fetchJsonFile<BuilderState>(file.id);
  }

  /**
   * Writes both files in one round-trip. Called after every state-changing
   * action (Accept / Map / Reject) — the spec accepts last-write-wins for
   * multi-device conflicts in V1, so a simple "always upload both" is
   * enough.
   *
   * The two uploads are independent and run in parallel.
   */
  async saveStateAndRuntime(
    state: BuilderState,
    runtime: RuntimeLexicon,
  ): Promise<void> {
    const folder = await this.getWorkspaceFolder();
    const [existingState, existingRuntime] = await Promise.all([
      this.findArtifactFile({
        kind: STATE_KIND,
        fileName: STATE_FILE_NAME,
        folderId: folder.id,
      }),
      this.findArtifactFile({
        kind: RUNTIME_KIND,
        fileName: RUNTIME_FILE_NAME,
        folderId: folder.id,
      }),
    ]);

    await Promise.all([
      this.uploadAndEnsure({
        existing: existingState,
        fileName: STATE_FILE_NAME,
        data: state,
        folderId: folder.id,
        appProperties: { sutrapad: "true", kind: STATE_KIND },
      }),
      this.uploadAndEnsure({
        existing: existingRuntime,
        fileName: RUNTIME_FILE_NAME,
        data: runtime,
        folderId: folder.id,
        appProperties: { sutrapad: "true", kind: RUNTIME_KIND },
      }),
    ]);
  }

  private async uploadAndEnsure(options: {
    existing: DriveFileRecord | null;
    fileName: string;
    data: unknown;
    folderId: string;
    appProperties: Record<string, string>;
  }): Promise<void> {
    const file = await this.#client.uploadJsonFile({
      fileId: options.existing?.id,
      fileName: options.fileName,
      data: options.data,
      folderId: options.folderId,
      appProperties: options.appProperties,
    });
    await this.#client.ensureFileInFolder(file.id, options.folderId);
  }

  private async getWorkspaceFolder(): Promise<DriveFileRecord> {
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

  private async findWorkspaceFolder(): Promise<DriveFileRecord | null> {
    return this.#client.findSingleFile(
      `trashed = false and mimeType = '${escapeDriveQueryValue(GOOGLE_DRIVE_FOLDER_MIME_TYPE)}' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='folder' } and name = '${escapeDriveQueryValue(WORKSPACE_FOLDER_NAME)}'`,
    );
  }

  private async findArtifactFile(options: {
    kind: string;
    fileName: string;
    folderId?: string;
  }): Promise<DriveFileRecord | null> {
    const kindClause = `appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='${escapeDriveQueryValue(options.kind)}' }`;
    if (options.folderId) {
      const inFolder = await this.#client.findSingleFile(
        `trashed = false and '${escapeDriveQueryValue(options.folderId)}' in parents and ${kindClause}`,
      );
      if (inFolder) return inFolder;
    }
    return this.#client.findSingleFile(
      `trashed = false and name = '${escapeDriveQueryValue(options.fileName)}' and ${kindClause}`,
    );
  }
}
