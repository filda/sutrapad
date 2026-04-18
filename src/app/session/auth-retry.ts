import type { UserProfile } from "../../types";
import { isAuthExpiredError } from "../../services/drive-store";

export interface AuthRetryContext {
  /**
   * Attempts a silent Google token refresh. Must return the refreshed profile
   * on success (also updates any in-memory auth state as a side effect) or
   * `null` when silent refresh is not possible and the user must re-consent.
   */
  refreshSession: () => Promise<UserProfile | null>;
  /** Notified when a fresh profile has been obtained from a silent refresh. */
  onProfileRefreshed?: (profile: UserProfile) => void;
}

/**
 * Wraps a Google Drive operation with a single-shot recovery step: when the
 * operation rejects with a 401 `GoogleDriveApiError`, we attempt a silent
 * token refresh and retry the operation once. All other errors — and 401s
 * where the silent refresh cannot succeed — propagate unchanged.
 *
 * The retry is intentionally bounded to one attempt so a pathological 401
 * loop cannot hammer Google or hang the UI.
 */
export async function withAuthRetry<T>(
  operation: () => Promise<T>,
  { refreshSession, onProfileRefreshed }: AuthRetryContext,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isAuthExpiredError(error)) {
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
