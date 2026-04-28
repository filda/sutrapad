import type { SutraPadWorkspace, UserProfile } from "../../types";
import { clearCaptureParamsFromLocation } from "../../lib/url-capture";
import type { SyncState } from "./workspace-sync";

/**
 * Probes the GIS silent-refresh path against `accounts.google.com`'s
 * first-party session cookie. On success the auth service holds the
 * fresh access token in memory and the workspace is loaded from
 * Drive; on failure (no Google session, ITP-blocked iframe, network)
 * the caller renders the signed-out UI and the user can drive an
 * interactive sign-in.
 *
 * The earlier `restoreSessionOnStartup` performed a synchronous
 * localStorage read against a persisted session record. The new
 * shape is async and incurs a network round-trip, but eliminates the
 * "stale token on disk" exposure window and removes the 7-day
 * idle-cap UX cliff (sessions now live as long as the Google session
 * cookie, which is refreshed daily by the user's normal Google use).
 */
export async function bootstrapSessionOnStartup(
  auth: { bootstrap: () => Promise<UserProfile | null> },
  applyRestoredProfile: (profile: UserProfile) => void,
  restoreWorkspaceAfterSignIn: () => Promise<void>,
): Promise<UserProfile | null> {
  const restoredProfile = await auth.bootstrap();
  if (!restoredProfile) {
    return null;
  }

  applyRestoredProfile(restoredProfile);
  await restoreWorkspaceAfterSignIn();
  return restoredProfile;
}

/**
 * Startup orchestration: capture any workspace handed off via URL params,
 * initialise auth, and either bootstrap an existing Google session (which
 * triggers its own render) or fall through to a single initial render.
 * Extracted out of `createApp` to keep that function focused on wiring
 * rather than sequencing.
 */
export async function runAppBootstrap(effects: {
  auth: {
    initialize: () => Promise<void>;
    bootstrap: () => Promise<UserProfile | null>;
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

    const restoredProfile = await bootstrapSessionOnStartup(
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
