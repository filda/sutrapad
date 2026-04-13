import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import type { SutraPadDocument, UserProfile } from "./types";

type SyncState = "idle" | "loading" | "saving" | "error";
const LOCAL_DRAFT_KEY = "sutrapad-local-draft";

function createLocalDraft(): SutraPadDocument {
  return {
    id: crypto.randomUUID(),
    title: "Untitled note",
    body: "",
    updatedAt: new Date().toISOString(),
  };
}

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function loadLocalDraft(): SutraPadDocument {
  const saved = window.localStorage.getItem(LOCAL_DRAFT_KEY);
  if (!saved) {
    return createLocalDraft();
  }

  try {
    return JSON.parse(saved) as SutraPadDocument;
  } catch {
    return createLocalDraft();
  }
}

function persistLocalDraft(documentState: SutraPadDocument): void {
  window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(documentState));
}

export function createApp(root: HTMLElement): void {
  const auth = new GoogleAuthService();

  let profile: UserProfile | null = null;
  let documentState: SutraPadDocument = loadLocalDraft();
  let syncState: SyncState = "idle";
  let lastError = "";

  const render = (): void => {
    root.innerHTML = "";

    const page = document.createElement("main");
    page.className = "page";

    const hero = document.createElement("section");
    hero.className = "hero";
    hero.innerHTML = `
      <div>
        <p class="eyebrow">SutraPad</p>
        <h1>notes & links</h1>
        <p class="lede">Store and manage your <em>Gerümpel</em> on <a href="https://drive.google.com/drive/home">Google Drive</a> — powered entirely by browser magic, questionable decisions, and multiple JSON files.</p>
      </div>
    `;

    const heroCard = document.createElement("div");
    heroCard.className = "hero-card";

    if (!profile) {
      const info = document.createElement("p");
      info.textContent =
        "You can write immediately in a local draft. Sign in only when you want to sync with Google Drive.";

      const signInButton = document.createElement("button");
      signInButton.className = "button button-primary";
      signInButton.textContent = "Sign in with Google";
      signInButton.onclick = async () => {
        try {
          syncState = "loading";
          lastError = "";
          render();
          profile = await auth.signIn();
          await loadDocument();
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
      reloadButton.textContent = "Load from Drive";
      reloadButton.onclick = () => void loadDocument();

      const saveButton = document.createElement("button");
      saveButton.className = "button button-primary";
      saveButton.textContent = "Save to Drive";
      saveButton.onclick = () => void saveDocument();

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
              ? `Last change: ${formatDate(documentState.updatedAt)}`
              : `Editing local draft. Last change: ${formatDate(documentState.updatedAt)}`;

    const titleInput = document.createElement("input");
    titleInput.className = "title-input";
    titleInput.placeholder = "Note title";
    titleInput.value = documentState.title;
    titleInput.oninput = () => {
      documentState = {
        ...documentState,
        title: titleInput.value,
        updatedAt: new Date().toISOString(),
      };
      persistLocalDraft(documentState);
      syncState = "idle";
    };

    const bodyInput = document.createElement("textarea");
    bodyInput.className = "body-input";
    bodyInput.placeholder = "Start writing...";
    bodyInput.value = documentState.body;
    bodyInput.oninput = () => {
      documentState = {
        ...documentState,
        body: bodyInput.value,
        updatedAt: new Date().toISOString(),
      };
      persistLocalDraft(documentState);
      syncState = "idle";
    };

    editor.append(status, titleInput, bodyInput);
    page.append(editor);

    const footer = document.createElement("footer");
    footer.className = "footer";
    footer.innerHTML = `
      <p>The offline shell is powered by the service worker. Local drafting works immediately, while Google Drive sync still requires sign-in and a network connection.</p>
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

  const loadDocument = async (): Promise<void> => {
    try {
      syncState = "loading";
      lastError = "";
      render();
      documentState = await getStore().load();
      persistLocalDraft(documentState);
      syncState = "idle";
      render();
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "Loading from Google Drive failed.";
      render();
    }
  };

  const saveDocument = async (): Promise<void> => {
    try {
      syncState = "saving";
      lastError = "";
      documentState = {
        ...documentState,
        updatedAt: new Date().toISOString(),
      };
      persistLocalDraft(documentState);
      render();
      await getStore().save(documentState);
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
