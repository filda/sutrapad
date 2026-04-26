/**
 * Backwards-compat facade. The original `drive-store.ts` lived as a
 * single 800-line module with two concerns mixed together: a
 * low-level Drive REST client (HTTP, auth, query escaping, multipart
 * upload) and a workspace-aware store (index snapshots, head pointer,
 * per-note files, legacy fallback). Those are now separated:
 *
 *   - `./drive/client.ts`         — `GoogleDriveClient`,
 *     `GoogleDriveApiError`, `isAuthExpiredError`,
 *     `escapeDriveQueryValue`.
 *   - `./drive/workspace-store.ts` — `GoogleDriveStore`.
 *
 * Existing call sites (`import { GoogleDriveStore, … } from
 * "./services/drive-store"`) keep working unchanged through these
 * re-exports — no consumer had to learn a new import path.
 */
export {
  escapeDriveQueryValue,
  GoogleDriveApiError,
  GoogleDriveClient,
  isAuthExpiredError,
} from "./drive/client";
export { GoogleDriveStore } from "./drive/workspace-store";
