/**
 * Drive-backed preferences IO.
 *
 * Loads `sutrapad-preferences.json` into the `dismissedTagAliases$`
 * atom after sign-in / manual Load, and pushes the atom's contents
 * back to Drive on change (debounced). Keeps the wiring out of
 * `app.ts` so `createApp` stays a wiring-only shell — the same shape
 * `workspace-io.ts` follows for the workspace concern.
 *
 * Conflict model is last-write-wins. On load, the Drive value
 * replaces whatever was in localStorage. On save, the in-memory set
 * is serialised verbatim. We never merge two sets — see
 * `preferences-store.ts` for the rationale.
 *
 * Load policy:
 *   - Drive returns the parsed `SutraPadPreferences` → replace the
 *     atom (atom subscriber re-persists to localStorage).
 *   - Drive returns `null` (no file yet) → keep whatever the atom
 *     already holds. The first save creates the file. This avoids
 *     clobbering session-local dismissals when the account is fresh.
 *   - Drive throws → log and leave the atom untouched. Same posture
 *     as the workspace IO's "error pulse without losing local state"
 *     contract.
 *
 * Save policy:
 *   - User-driven mutations to `dismissedTagAliases$` trigger a
 *     debounced Drive push. 2s timer, mirroring `scheduleAutoSave`
 *     so the two pulses settle on a similar cadence.
 *   - A load-driven mutation (i.e. the atom was just replaced by
 *     `loadPreferences`) does NOT trigger a save: we record the
 *     loaded set as the clean snapshot, and the save scheduler bails
 *     when the current set matches it.
 *   - Signed-out: the scheduler is a no-op. localStorage persistence
 *     keeps working via its own subscriber.
 */

import type { GoogleDrivePreferencesStore } from "../../services/drive-store";
import type { SutraPadPreferences, UserProfile } from "../../types";
import { withAuthRetry, type AuthRetryContext } from "./auth-retry";

const PREFERENCES_SAVE_DEBOUNCE_MS = 2000;

function setsEqual(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export interface PreferencesIODeps {
  /** Builds a fresh Drive client. Returns null when the user is signed out. */
  getPreferencesStore: () => GoogleDrivePreferencesStore | null;
  retryContext: AuthRetryContext;
  getDismissedTagAliases: () => ReadonlySet<string>;
  setDismissedTagAliases: (next: Set<string>) => void;
  getProfile: () => UserProfile | null;
}

export interface PreferencesIO {
  /**
   * Pulls preferences from Drive and replaces the local set. Safe to
   * call when signed out (returns immediately). A `null` response
   * from Drive (no file yet) leaves the local set in place; the
   * first dismiss after sign-in will materialise the file.
   */
  loadPreferences: () => Promise<void>;
  /**
   * Debounced push of the local set to Drive. No-op at schedule time
   * when signed out. The fire-time path (`flushSave`) additionally
   * short-circuits when the current set matches the last value we
   * either loaded from or saved to Drive — mirrors `workspace-io`'s
   * `areWorkspacesEqual` clean-snapshot guard.
   */
  schedulePreferencesSave: () => void;
  /** Cancels any pending debounced save — used by sign-out teardown. */
  cancelPreferencesSave: () => void;
}

export function createPreferencesIO(deps: PreferencesIODeps): PreferencesIO {
  const {
    getPreferencesStore,
    retryContext,
    getDismissedTagAliases,
    setDismissedTagAliases,
    getProfile,
  } = deps;

  // Snapshot of the dismissed set we last successfully synced with
  // Drive (loaded or saved). `flushSave` consults this before
  // pushing: a current-vs-snapshot equality means the bytes on Drive
  // already match local, so we skip the whole RTT. Kept independent
  // from the atom's Set instance via a defensive copy in
  // `loadPreferences` — otherwise a downstream in-place mutation
  // would silently drift the snapshot along with it.
  //
  // null until the first successful Drive interaction. Stays null
  // when the user is signed out — every save attempt short-circuits
  // on the signed-out gate before reaching this guard.
  let lastSyncedDismissed: ReadonlySet<string> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelPreferencesSave = (): void => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };

  const loadPreferences = async (): Promise<void> => {
    const store = getPreferencesStore();
    if (!store) return;
    let loaded: SutraPadPreferences | null;
    try {
      loaded = await withAuthRetry(() => store.loadPreferences(), retryContext);
    } catch (error) {
      // Best-effort: a Drive failure here must not block the
      // workspace load that just preceded it. Log for devtools
      // visibility and leave the atom untouched.
      console.warn("Failed to load preferences from Drive", error);
      return;
    }
    if (loaded === null) {
      // No file on Drive yet — keep whatever the atom already holds.
      // The next dismiss action will create the file via the save
      // path. We deliberately do NOT mark lastSyncedDismissed here:
      // if Drive doesn't have a file, there's nothing to be equal
      // to, and the first user action should push.
      return;
    }
    const nextSet = new Set(loaded.dismissedTagAliases);
    cancelPreferencesSave();
    // Defensive copy. We hand `nextSet` to the atom and keep an
    // independent snapshot — if anything (test code, or a future
    // mutation path) ever holds onto the atom's Set by reference and
    // edits it in place, the snapshot must not drift along with it.
    // Without this copy the clean-snapshot guard would silently swallow
    // legitimate save requests because `a === b` short-circuits to true.
    lastSyncedDismissed = new Set(nextSet);
    setDismissedTagAliases(nextSet);
  };

  const flushSave = async (): Promise<void> => {
    saveTimer = null;
    // Re-check the signed-in state at fire time. A sign-out between
    // schedule and fire would otherwise push to Drive with a
    // freshly-rejected token and surface as a console error for an
    // action the user never asked for. `getPreferencesStore` returns
    // null when signed out, so this single check covers both gates
    // (profile + access token) without a redundant `getProfile()`
    // call right above.
    const store = getPreferencesStore();
    if (!store) return;
    const current = getDismissedTagAliases();
    if (lastSyncedDismissed !== null && setsEqual(current, lastSyncedDismissed)) {
      return;
    }
    const payload: SutraPadPreferences = {
      version: 1,
      savedAt: new Date().toISOString(),
      // Sorted so the on-disk form is stable across toggles.
      dismissedTagAliases: [...current].toSorted(),
    };
    try {
      await withAuthRetry(
        () => store.savePreferences(payload),
        // Background mode: this fires from a debounce timer, not a
        // direct user click. If a 401 lands, we don't want a silent
        // refresh iframe to steal focus from whatever the user is
        // doing — mirrors the autosave posture.
        { ...retryContext, mode: "background" },
      );
      lastSyncedDismissed = new Set(current);
    } catch (error) {
      console.warn("Failed to save preferences to Drive", error);
    }
  };

  const schedulePreferencesSave = (): void => {
    if (!getProfile()) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    // The clean-snapshot check lives only at fire time (`flushSave`).
    // Mirroring it here would be a redundant defense — see the comment
    // there — and on the post-load path the duplicate guard would
    // arm a useless 2s timer anyway because `setDismissedTagAliases`
    // fires the atom subscriber synchronously after we set the
    // snapshot but before the user has any chance to act.
    saveTimer = setTimeout(() => {
      void flushSave();
    }, PREFERENCES_SAVE_DEBOUNCE_MS);
  };

  return {
    loadPreferences,
    schedulePreferencesSave,
    cancelPreferencesSave,
  };
}
