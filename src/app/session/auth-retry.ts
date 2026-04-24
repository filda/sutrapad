import type { UserProfile } from "../../types";
import { isAuthExpiredError } from "../../services/drive-store";

/**
 * Who kicked off the Drive operation. The distinction matters because a
 * silent Google token refresh inserts a hidden iframe — which on mobile
 * browsers yanks focus from the active `<textarea>` and drops the soft
 * keyboard mid-word. We only pay that cost when the user is actively
 * waiting for the operation (manual Save / Load, initial load), never
 * from a background autosave that fires while they are typing.
 *
 *   - "interactive" — user initiated, can tolerate a focus hiccup, default.
 *   - "background"  — autosave / passive sync. 401 is propagated unchanged
 *                     so the caller can surface a "reconnect" affordance
 *                     and retry on the next interactive action.
 */
export type AuthRetryMode = "interactive" | "background";

export interface AuthRetryContext {
  /**
   * Attempts a silent Google token refresh. Must return the refreshed profile
   * on success (also updates any in-memory auth state as a side effect) or
   * `null` when silent refresh is not possible and the user must re-consent.
   */
  refreshSession: () => Promise<UserProfile | null>;
  /** Notified when a fresh profile has been obtained from a silent refresh. */
  onProfileRefreshed?: (profile: UserProfile) => void;
  /**
   * Governs whether a 401 triggers a silent refresh (`interactive`) or
   * propagates unchanged (`background`). Defaults to `interactive` to keep
   * existing manual-save / load call sites behaving as before.
   */
  mode?: AuthRetryMode;
}

/**
 * Wraps a Google Drive operation with a single-shot recovery step: when the
 * operation rejects with a 401 `GoogleDriveApiError` AND the caller is in
 * `interactive` mode, we attempt a silent token refresh and retry the
 * operation once. All other errors — and 401s in `background` mode or where
 * silent refresh cannot succeed — propagate unchanged.
 *
 * The retry is intentionally bounded to one attempt so a pathological 401
 * loop cannot hammer Google or hang the UI.
 */
export async function withAuthRetry<T>(
  operation: () => Promise<T>,
  { refreshSession, onProfileRefreshed, mode = "interactive" }: AuthRetryContext,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isAuthExpiredError(error)) {
      throw error;
    }

    // Background autosave must not fire the GIS silent-refresh iframe while
    // the user is typing — it would steal focus on mobile. Propagate the 401
    // unchanged; `workspace-sync` surfaces it as `syncState = "error"` and
    // the user's next interactive save / load will drive the refresh.
    if (mode === "background") {
      throw error;
    }

    const refreshedProfile = await refreshSession();
    if (!refreshedProfile) {
      throw error;
    }

    onProfileRefreshed?.(refreshedProfile);
    return operation();
  }
}
