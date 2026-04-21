import type { SutraPadWorkspace, UserProfile } from "../../types";
import { clearCaptureParamsFromLocation } from "../../lib/url-capture";
import type { SyncState } from "./workspace-sync";

export async function restoreSessionOnStartup(
  auth: { restorePersistedSession: () => Promise<UserProfile | null> },
  applyRestoredProfile: (profile: UserProfile) => void,
  restoreWorkspaceAfterSignIn: () => Promise<void>,
): Promise<UserProfile | null> {
  const restoredProfile = await auth.restorePersistedSession();
  if (!restoredProfile) {
    return null;
  }

  applyRestoredProfile(restoredProfile);
  await restoreWorkspaceAfterSignIn();
  return restoredProfile;
}

/**
 * Startup orchestration: capture any workspace handed off via URL params,
 * initialise auth, and either restore a persisted session (which triggers its
 * own render) or fall through to a single initial render. Extracted out of
 * `createApp` to keep that function focused on wiring rather than sequencing.
 */
export async function runAppBootstrap(effects: {
  auth: {
    initialize: () => Promise<void>;
    restorePersistedSession: () => Promise<UserProfile | null>;
  };
  captureIncomingWorkspaceFromUrl: (workspace: SutraPadWorkspace) => Promise<SutraPadWorkspace>;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  setProfile: (profile: UserProfile | null) => void;
  setSyncState: (state: SyncState) => void;
  setLastError: (message: string) => void;
  persistLocalWorkspace: (workspace: SutraPadWorkspace) => void;
  restoreWorkspaceAfterSignIn: () => Promise<void>;
  render: () => void;
}): Promise<void> {
  try {
    const capturedWorkspace = await effects.captureIncomingWorkspaceFromUrl(
      effects.getWorkspace(),
    );
    effects.setWorkspace(capturedWorkspace);
    effects.persistLocalWorkspace(capturedWorkspace);
    window.history.replaceState(
      {},
      "",
      clearCaptureParamsFromLocation(window.location.href),
    );
    await effects.auth.initialize();

    const restoredProfile = await restoreSessionOnStartup(
      effects.auth,
      (profile) => {
        effects.setProfile(profile);
      },
      effects.restoreWorkspaceAfterSignIn,
    );
    if (restoredProfile) return;
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(
      error instanceof Error ? error.message : "App initialization failed.",
    );
  }

  effects.render();
}
