import type { UserProfile } from "../../types";

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
