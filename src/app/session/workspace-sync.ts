export type SyncState = "idle" | "loading" | "saving" | "error";
export type SaveMode = "interactive" | "background";

export async function runWorkspaceSave(
  mode: SaveMode,
  effects: {
    persistLocalWorkspace: () => void;
    saveRemoteWorkspace: () => Promise<void>;
    setSyncState: (state: SyncState) => void;
    setLastError: (message: string) => void;
    render: () => void;
    refreshStatus: () => void;
  },
): Promise<void> {
  const refreshUi = mode === "interactive" ? effects.render : effects.refreshStatus;

  try {
    effects.setSyncState("saving");
    effects.setLastError("");
    effects.persistLocalWorkspace();
    refreshUi();
    await effects.saveRemoteWorkspace();
    effects.setSyncState("idle");
    refreshUi();
  } catch (error) {
    effects.setSyncState("error");
    effects.setLastError(error instanceof Error ? error.message : "Saving to Google Drive failed.");
    refreshUi();
  }
}
