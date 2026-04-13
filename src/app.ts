import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  createNewNoteWorkspace,
  createWorkspace,
  upsertNote,
} from "./lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace, UserProfile } from "./types";

type SyncState = "idle" | "loading" | "saving" | "error";
const LOCAL_WORKSPACE_KEY = "sutrapad-local-workspace";

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function loadLocalWorkspace(): SutraPadWorkspace {
  const saved = window.localStorage.getItem(LOCAL_WORKSPACE_KEY);
  if (!saved) {
    return createWorkspace();
  }

  try {
    const parsed = JSON.parse(saved) as SutraPadWorkspace;
    if (!parsed.notes.length) {
      return createWorkspace();
    }

    return {
      notes: parsed.notes,
      activeNoteId: parsed.activeNoteId ?? parsed.notes[0].id,
    };
  } catch {
    return createWorkspace();
  }
}

function persistLocalWorkspace(workspace: SutraPadWorkspace): void {
  window.localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
}

export function createApp(root: HTMLElement): void {
  const auth = new GoogleAuthService();

  let profile: UserProfile | null = null;
  let workspace: SutraPadWorkspace = loadLocalWorkspace();
  let syncState: SyncState = "idle";
  let lastError = "";

  const getCurrentNote = (): SutraPadDocument => {
    const note = workspace.notes.find((entry) => entry.id === workspace.activeNoteId);
    return note ?? workspace.notes[0];
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    const current = getCurrentNote();
    workspace = upsertNote(workspace, current.id, updater);

    persistLocalWorkspace(workspace);
  };

  const render = (): void => {
    root.innerHTML = "";

    const currentNote = getCurrentNote();

    const page = document.createElement("main");
    page.className = "page";

    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div>
        <p class="eyebrow">SutraPad</p>
        <h1>notes & links</h1>
        <p class="lede">Store and manage your <em>Gerümpel</em> on <a href="https://drive.google.com/drive/home" target="_blank" rel="noreferrer">Google Drive</a> — powered entirely by browser magic, questionable decisions, and multiple JSON files.</p>
      </div>
    `;

    const heroCard = document.createElement("div");
    heroCard.className = "hero-card";

    if (!profile) {
      const info = document.createElement("p");
      info.textContent =
        "You can write immediately in a local notebook. Sign in only when you want to sync with Google Drive.";

      const signInButton = document.createElement("button");
      signInButton.className = "button button-primary";
      signInButton.textContent = "Sign in with Google";
      signInButton.onclick = async () => {
        try {
          syncState = "loading";
          lastError = "";
          render();
          profile = await auth.signIn();
          await loadWorkspace();
        } catch (error) {
          syncState = "error";
          lastError = error instanceof Error ? error.message : "Sign-in failed.";
          render();
        }
      };

      heroCard.append(info, signInButton);
    } else {
      const avatar = document.createElement("div");
      avatar.className = "profile";
      avatar.innerHTML = `
        ${profile.picture ? `<img src="${profile.picture}" alt="${profile.name}" />` : "<div class='avatar-fallback'></div>"}
        <div>
          <strong>${profile.name}</strong>
          <span>${profile.email}</span>
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "toolbar";

      const reloadButton = document.createElement("button");
      reloadButton.className = "button";
      reloadButton.textContent = "Load notebook";
      reloadButton.onclick = () => void loadWorkspace();

      const saveButton = document.createElement("button");
      saveButton.className = "button button-primary";
      saveButton.textContent = "Save notebook";
      saveButton.onclick = () => void saveWorkspace();

      const signOutButton = document.createElement("button");
      signOutButton.className = "button button-ghost";
      signOutButton.textContent = "Sign out";
      signOutButton.onclick = () => {
        auth.signOut();
        profile = null;
        syncState = "idle";
        lastError = "";
        render();
      };

      actions.append(reloadButton, saveButton, signOutButton);
      heroCard.append(avatar, actions);
    }

    hero.append(heroCard);
    page.append(hero);

    const workspaceSection = document.createElement("section");
    workspaceSection.className = "workspace";

    const notesPanel = document.createElement("aside");
    notesPanel.className = "notes-panel";

    const notesHeader = document.createElement("div");
    notesHeader.className = "notes-panel-header";
    notesHeader.innerHTML = `
      <div>
        <p class="panel-eyebrow">Notebook</p>
        <h2>${workspace.notes.length} note${workspace.notes.length === 1 ? "" : "s"}</h2>
      </div>
    `;

    const newNoteButton = document.createElement("button");
    newNoteButton.className = "button";
    newNoteButton.textContent = "New note";
    newNoteButton.onclick = () => {
      workspace = createNewNoteWorkspace(workspace);
      persistLocalWorkspace(workspace);
      syncState = "idle";
      render();
    };
    notesHeader.append(newNoteButton);

    const notesList = document.createElement("div");
    notesList.className = "notes-list";

    for (const note of workspace.notes) {
      const button = document.createElement("button");
      button.className = `note-list-item${note.id === currentNote.id ? " is-active" : ""}`;
      button.type = "button";
      button.onclick = () => {
        workspace = {
          ...workspace,
          activeNoteId: note.id,
        };
        persistLocalWorkspace(workspace);
        render();
      };

      const excerpt = note.body.trim() || "Empty note";
      button.innerHTML = `
        <strong>${note.title || "Untitled note"}</strong>
        <span>${formatDate(note.updatedAt)}</span>
        <p>${excerpt.slice(0, 72)}</p>
      `;

      notesList.append(button);
    }

    notesPanel.append(notesHeader, notesList);

    const editor = document.createElement("section");
    editor.className = "editor-card";

    const status = document.createElement("p");
    status.className = `status status-${syncState}`;
    status.textContent =
      syncState === "loading"
        ? "Loading…"
        : syncState === "saving"
          ? "Saving…"
          : syncState === "error"
            ? lastError || "A synchronization error occurred."
            : profile
              ? `Notebook synced from Drive. Last change: ${formatDate(currentNote.updatedAt)}`
              : `Editing local notebook. Last change: ${formatDate(currentNote.updatedAt)}`;

    const titleInput = document.createElement("input");
    titleInput.className = "title-input";
    titleInput.placeholder = "Note title";
    titleInput.value = currentNote.title;
    titleInput.oninput = () => {
      replaceCurrentNote((note) => ({
        ...note,
        title: titleInput.value,
        updatedAt: new Date().toISOString(),
      }));
      syncState = "idle";
    };

    const bodyInput = document.createElement("textarea");
    bodyInput.className = "body-input";
    bodyInput.placeholder = "Start writing...";
    bodyInput.value = currentNote.body;
    bodyInput.oninput = () => {
      replaceCurrentNote((note) => ({
        ...note,
        body: bodyInput.value,
        updatedAt: new Date().toISOString(),
      }));
    };

    editor.append(status, titleInput, bodyInput);
    workspaceSection.append(notesPanel, editor);
    page.append(workspaceSection);

    const footer = document.createElement("footer");
    footer.className = "footer";
    footer.innerHTML = `
      <p>Each note is stored as its own JSON file in Google Drive, with a notebook index file keeping the list and active selection together.</p>
    `;
    page.append(footer);

    root.append(page);
  };

  const getStore = (): GoogleDriveStore => {
    const token = auth.getAccessToken();
    if (!token) {
      throw new Error("The user is not signed in.");
    }

    return new GoogleDriveStore(token);
  };

  const loadWorkspace = async (): Promise<void> => {
    try {
      syncState = "loading";
      lastError = "";
      render();
      workspace = await getStore().loadWorkspace();
      persistLocalWorkspace(workspace);
      syncState = "idle";
      render();
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "Loading from Google Drive failed.";
      render();
    }
  };

  const saveWorkspace = async (): Promise<void> => {
    try {
      syncState = "saving";
      lastError = "";
      persistLocalWorkspace(workspace);
      render();
      await getStore().saveWorkspace(workspace);
      syncState = "idle";
      render();
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "Saving to Google Drive failed.";
      render();
    }
  };

  void (async () => {
    try {
      await auth.initialize();
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "App initialization failed.";
    }

    render();
  })();

  render();
}
