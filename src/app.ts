import { GoogleAuthService } from "./services/google-auth";
import { GoogleDriveStore } from "./services/drive-store";
import {
  buildTagIndex,
  areWorkspacesEqual,
  createCapturedNoteWorkspace,
  createNewNoteWorkspace,
  createTextNoteWorkspace,
  createWorkspace,
  filterNotesByAllTags,
  mergeWorkspaces,
  upsertNote,
} from "./lib/notebook";
import {
  buildNoteCaptureTitle,
  clearCaptureParamsFromLocation,
  formatCoordinates,
  deriveTitleFromUrl,
  reverseGeocodeCoordinates,
  readNoteCapture,
  readUrlCapture,
  resolveCurrentCoordinates,
  resolveTitleFromUrl,
} from "./lib/url-capture";
import { buildBookmarklet } from "./lib/bookmarklet";
import type { SutraPadDocument, SutraPadWorkspace, UserProfile } from "./types";

type SyncState = "idle" | "loading" | "saving" | "error";
type SaveMode = "interactive" | "background";
const LOCAL_WORKSPACE_KEY = "sutrapad-local-workspace";
const BOOKMARKLET_HELPER_KEY = "sutrapad-bookmarklet-helper-expanded";

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function formatBuildStamp(): string {
  const builtAt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(__APP_BUILD_TIME__));

  return `v${__APP_VERSION__} · ${__APP_COMMIT_HASH__} · built ${builtAt}`;
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
      notes: parsed.notes.map((note) => ({ ...note, tags: note.tags ?? [] })),
      activeNoteId: parsed.activeNoteId ?? parsed.notes[0].id,
    };
  } catch {
    return createWorkspace();
  }
}

function persistLocalWorkspace(workspace: SutraPadWorkspace): void {
  window.localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspace));
}

export function readTagFiltersFromLocation(url: string): string[] {
  const filters = new URL(url).searchParams.get("tags");
  if (!filters) {
    return [];
  }

  return [...new Set(
    filters
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

export function writeTagFiltersToLocation(url: string, tags: string[]): string {
  const nextUrl = new URL(url);
  const canonicalTags = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (canonicalTags.length === 0) {
    nextUrl.searchParams.delete("tags");
  } else {
    nextUrl.searchParams.set("tags", canonicalTags.join(","));
  }

  return nextUrl.toString();
}

export function resolveDisplayedNote(
  workspace: SutraPadWorkspace,
  selectedTagFilters: string[],
): SutraPadDocument | null {
  const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
  if (filteredNotes.length === 0) {
    return null;
  }

  return filteredNotes.find((note) => note.id === workspace.activeNoteId) ?? filteredNotes[0];
}

export async function restoreSessionOnStartup(
  auth: Pick<GoogleAuthService, "restorePersistedSession">,
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

export function createApp(root: HTMLElement): void {
  const auth = new GoogleAuthService();
  const iosShortcutUrl = "https://www.icloud.com/shortcuts/969e1b627e4a46deae3c690ef0c9ca84";

  let profile: UserProfile | null = null;
  let workspace: SutraPadWorkspace = loadLocalWorkspace();
  let syncState: SyncState = "idle";
  let lastError = "";
  let bookmarkletMessage = "";
  let bookmarkletHelperExpanded =
    window.localStorage.getItem(BOOKMARKLET_HELPER_KEY) !== "collapsed";
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedTagFilters: string[] = readTagFiltersFromLocation(window.location.href);

  const getCurrentNote = (): SutraPadDocument => {
    const note = workspace.notes.find((entry) => entry.id === workspace.activeNoteId);
    return note ?? workspace.notes[0];
  };

  const scheduleAutoSave = (): void => {
    if (!profile) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void saveWorkspace("background");
    }, 2000);
  };

  const replaceCurrentNote = (updater: (note: SutraPadDocument) => SutraPadDocument): void => {
    const current = getCurrentNote();
    workspace = upsertNote(workspace, current.id, updater);

    persistLocalWorkspace(workspace);
    scheduleAutoSave();
  };

  const buildTagInput = (): HTMLDivElement => {
    const row = document.createElement("div");
    row.className = "tags-row";

    const input = document.createElement("input");
    input.className = "tag-text-input";
    input.type = "text";
    input.setAttribute("aria-label", "Add tag");

    const addTag = (value: string): void => {
      const tag = value.trim().toLowerCase();
      if (!tag || getCurrentNote().tags.includes(tag)) return;
      replaceCurrentNote((n) => ({ ...n, tags: [...n.tags, tag], updatedAt: new Date().toISOString() }));
      renderChips();
      refreshNotesPanel();
    };

    input.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        addTag(input.value);
        input.value = "";
        input.focus();
      } else if (e.key === "Backspace" && input.value === "") {
        const tags = getCurrentNote().tags;
        if (tags.length === 0) return;
        replaceCurrentNote((n) => ({ ...n, tags: n.tags.slice(0, -1), updatedAt: new Date().toISOString() }));
        renderChips();
        refreshNotesPanel();
        input.focus();
      }
    };

    input.onblur = () => {
      if (input.value.trim()) {
        addTag(input.value);
        input.value = "";
      }
    };

    row.onclick = (e) => {
      if (e.target === row) input.focus();
    };

    const renderChips = (): void => {
      while (row.firstChild) row.removeChild(row.firstChild);

      for (const tag of getCurrentNote().tags) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";

        const label = document.createElement("span");
        label.textContent = tag;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "tag-chip-remove";
        removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
        removeBtn.textContent = "×";
        removeBtn.onclick = () => {
          replaceCurrentNote((n) => ({ ...n, tags: n.tags.filter((t) => t !== tag), updatedAt: new Date().toISOString() }));
          renderChips();
          refreshNotesPanel();
          input.focus();
        };

        chip.append(label, removeBtn);
        row.append(chip);
      }

      input.placeholder = getCurrentNote().tags.length === 0 ? "Add tags…" : "";
      row.append(input);
    };

    renderChips();
    return row;
  };

  const buildNotesList = (currentNoteId: string, notes: SutraPadDocument[]): HTMLDivElement => {
    const notesList = document.createElement("div");
    notesList.className = "notes-list";

    if (notes.length === 0) {
      const emptyState = document.createElement("p");
      emptyState.className = "notes-list-empty";
      emptyState.textContent = "No notes match the current tag filter.";
      notesList.append(emptyState);
      return notesList;
    }

    for (const note of notes) {
      const button = document.createElement("button");
      button.className = `note-list-item${note.id === currentNoteId ? " is-active" : ""}`;
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

      if (note.tags.length > 0) {
        const tagsRow = document.createElement("div");
        tagsRow.className = "note-list-tags";
        for (const tag of note.tags) {
          const chip = document.createElement("span");
          chip.className = "note-list-tag";
          chip.textContent = tag;
          tagsRow.append(chip);
        }
        button.append(tagsRow);
      }

      notesList.append(button);
    }

    return notesList;
  };

  const syncSelectedTagFilters = (): void => {
    const availableTags = new Set(buildTagIndex(workspace).tags.map((entry) => entry.tag));
    selectedTagFilters = selectedTagFilters.filter((tag) => availableTags.has(tag));
  };

  const syncTagFiltersToLocation = (): void => {
    const nextUrl = writeTagFiltersToLocation(window.location.href, selectedTagFilters);
    if (nextUrl !== window.location.href) {
      window.history.replaceState({}, "", nextUrl);
    }
  };

  const ensureVisibleActiveNote = (): void => {
    const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
    if (
      filteredNotes.length > 0 &&
      workspace.activeNoteId &&
      !filteredNotes.some((note) => note.id === workspace.activeNoteId)
    ) {
      workspace = {
        ...workspace,
        activeNoteId: filteredNotes[0].id,
      };
      persistLocalWorkspace(workspace);
    }
  };

  const buildNotesPanel = (currentNoteId: string): HTMLElement => {
    const notesPanel = document.createElement("aside");
    notesPanel.className = "notes-panel";

    const filteredNotes = filterNotesByAllTags(workspace.notes, selectedTagFilters);
    const tagIndex = buildTagIndex(workspace);

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
    newNoteButton.onclick = async () => {
      try {
        syncState = "loading";
        lastError = "";
        render();

        const title = await generateFreshNoteTitle();
        workspace = createNewNoteWorkspace(workspace, title);
        persistLocalWorkspace(workspace);
        syncState = "idle";
        render();
      } catch {
        workspace = createNewNoteWorkspace(workspace);
        persistLocalWorkspace(workspace);
        syncState = "idle";
        render();
      }
    };
    notesHeader.append(newNoteButton);
    notesPanel.append(notesHeader);

    if (tagIndex.tags.length > 0) {
      const filterSection = document.createElement("section");
      filterSection.className = "tag-filter-card";

      const filterHeader = document.createElement("div");
      filterHeader.className = "tag-filter-header";

      const filterTitle = document.createElement("p");
      filterTitle.className = "panel-eyebrow";
      filterTitle.textContent =
        selectedTagFilters.length > 0 ? `Filter (${selectedTagFilters.length})` : "Filter";
      filterHeader.append(filterTitle);

      if (selectedTagFilters.length > 0) {
        const clearFiltersButton = document.createElement("button");
        clearFiltersButton.type = "button";
        clearFiltersButton.className = "tag-filter-clear";
        clearFiltersButton.textContent = "Clear";
        clearFiltersButton.onclick = () => {
          selectedTagFilters = [];
          syncTagFiltersToLocation();
          render();
        };
        filterHeader.append(clearFiltersButton);
      }

      const cloud = document.createElement("div");
      cloud.className = "tag-filter-cloud";

      for (const entry of tagIndex.tags) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `tag-filter-chip${selectedTagFilters.includes(entry.tag) ? " is-active" : ""}`;
        chip.textContent = `${entry.tag} · ${entry.count}`;
        chip.onclick = () => {
          selectedTagFilters = selectedTagFilters.includes(entry.tag)
            ? selectedTagFilters.filter((tag) => tag !== entry.tag)
            : [...selectedTagFilters, entry.tag];
          ensureVisibleActiveNote();
          syncTagFiltersToLocation();
          render();
        };
        cloud.append(chip);
      }

      filterSection.append(filterHeader, cloud);

      if (selectedTagFilters.length > 0) {
        const filterHint = document.createElement("p");
        filterHint.className = "tag-filter-hint";
        filterHint.textContent =
          filteredNotes.length === 0
            ? "No notes match all selected tags."
            : `Showing ${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"} that match every selected tag.`;
        filterSection.append(filterHint);
      }

      notesPanel.append(filterSection);
    }

    notesPanel.append(buildNotesList(currentNoteId, filteredNotes));
    return notesPanel;
  };

  const refreshNotesPanel = (): void => {
    syncSelectedTagFilters();
    ensureVisibleActiveNote();
    const currentPanel = root.querySelector(".notes-panel");
    if (!currentPanel) {
      return;
    }

    currentPanel.replaceWith(buildNotesPanel(resolveDisplayedNote(workspace, selectedTagFilters)?.id ?? ""));
  };

  const getStatusText = (): string =>
    syncState === "loading"
      ? "Loading…"
      : syncState === "saving"
        ? "Saving…"
        : syncState === "error"
          ? lastError || "A synchronization error occurred."
          : (() => {
              const displayedNote = resolveDisplayedNote(workspace, selectedTagFilters);
              if (!displayedNote && selectedTagFilters.length > 0) {
                return "No notes match all selected tags.";
              }

              const note = displayedNote ?? getCurrentNote();
              return profile
                ? `Notebook synced from Drive. Last change: ${formatDate(note.updatedAt)}`
                : `Editing local notebook. Last change: ${formatDate(note.updatedAt)}`;
            })();

  const refreshStatus = (): void => {
    const status = root.querySelector(".status");
    if (!(status instanceof HTMLParagraphElement)) {
      return;
    }

    status.className = `status status-${syncState}`;
    status.textContent = getStatusText();
  };

  const generateFreshNoteTitle = async (): Promise<string> => {
    const now = new Date();
    const coordinates = await resolveCurrentCoordinates();
    const place = coordinates
      ? (await reverseGeocodeCoordinates(coordinates)) ?? formatCoordinates(coordinates)
      : undefined;

    return buildNoteCaptureTitle(now, place);
  };

  const render = (): void => {
    root.innerHTML = "";
    syncSelectedTagFilters();
    ensureVisibleActiveNote();
    syncTagFiltersToLocation();

    const currentNote = getCurrentNote();
    const displayedNote = resolveDisplayedNote(workspace, selectedTagFilters);

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
          await restoreWorkspaceAfterSignIn();
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

    const bookmarkletSection = document.createElement("section");
    bookmarkletSection.className = "bookmarklet-card";
    const bookmarkletHeader = document.createElement("div");
    bookmarkletHeader.className = "bookmarklet-header";
    bookmarkletHeader.innerHTML = `
      <div>
        <p class="panel-eyebrow">Capture</p>
        <h2>Bookmark any page into SutraPad.</h2>
        <p>Drag the bookmarklet to your bookmarks bar. It sends the current page URL and title into a fresh note.</p>
      </div>
    `;

    const toggleBookmarkletHelper = document.createElement("button");
    toggleBookmarkletHelper.className = "button button-ghost bookmarklet-toggle";
    toggleBookmarkletHelper.type = "button";
    toggleBookmarkletHelper.textContent = bookmarkletHelperExpanded ? "Hide helper" : "Show helper";
    toggleBookmarkletHelper.onclick = () => {
      bookmarkletHelperExpanded = !bookmarkletHelperExpanded;
      window.localStorage.setItem(
        BOOKMARKLET_HELPER_KEY,
        bookmarkletHelperExpanded ? "expanded" : "collapsed",
      );
      render();
    };
    bookmarkletHeader.append(toggleBookmarkletHelper);
    bookmarkletSection.append(bookmarkletHeader);

    const bookmarkletActions = document.createElement("div");
    bookmarkletActions.className = "bookmarklet-actions";

    const bookmarkletLink = document.createElement("a");
    bookmarkletLink.className = "button button-primary bookmarklet-link";
    bookmarkletLink.href = buildBookmarklet(window.location.origin + window.location.pathname);
    bookmarkletLink.textContent = "Save to SutraPad";
    bookmarkletLink.setAttribute("draggable", "true");

    const copyBookmarkletButton = document.createElement("button");
    copyBookmarkletButton.className = "button button-ghost";
    copyBookmarkletButton.textContent = "Copy bookmarklet code";
    copyBookmarkletButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(bookmarkletLink.href);
        bookmarkletMessage =
          "Bookmarklet copied. In Safari, create any bookmark, edit it, and paste this code into its URL field.";
      } catch {
        bookmarkletMessage =
          "Copy failed. In Safari, you can still drag the bookmarklet or manually copy the link target.";
      }
      render();
    };

    const bookmarkletHint = document.createElement("p");
    bookmarkletHint.className = "bookmarklet-hint";
    bookmarkletHint.innerHTML =
      "We cannot detect whether a browser already has this bookmarklet saved. Browsers do not expose bookmark contents to normal web pages, so this helper stays manual by design. Desktop Safari usually works best if you create a normal bookmark first and then replace its URL with the copied bookmarklet code.";

    const iosShortcutHint = document.createElement("p");
    iosShortcutHint.className = "bookmarklet-hint";
    iosShortcutHint.innerHTML =
      `On iPhone and iPad, a Shortcut is usually the easiest option. <a href="${iosShortcutUrl}" download>Download the iOS Shortcut</a>, open it in Safari, add it to Shortcuts, and enable it in the Share Sheet.`;

    const bookmarkletSteps = document.createElement("ol");
    bookmarkletSteps.className = "bookmarklet-steps";
    bookmarkletSteps.innerHTML = `
      <li>Drag <strong>Save to SutraPad</strong> to your bookmarks bar in Chrome, Brave, or Opera.</li>
      <li>In Safari, create a regular bookmark, choose <strong>Edit Address</strong>, and paste the copied bookmarklet code.</li>
      <li>While browsing any page, click the bookmarklet to open SutraPad with a new captured note.</li>
      <li>On iOS, download the Shortcut file, add it in Apple Shortcuts, and use it from the Share menu as <strong>Send to SutraPad</strong>.</li>
    `;

    bookmarkletActions.append(bookmarkletLink, copyBookmarkletButton);

    if (bookmarkletMessage) {
      const bookmarkletStatus = document.createElement("p");
      bookmarkletStatus.className = "bookmarklet-status";
      bookmarkletStatus.textContent = bookmarkletMessage;
      bookmarkletActions.append(bookmarkletStatus);
    }

    if (bookmarkletHelperExpanded) {
      bookmarkletActions.append(bookmarkletHint, iosShortcutHint, bookmarkletSteps);
      bookmarkletSection.append(bookmarkletActions);
    }

    page.append(bookmarkletSection);

    const workspaceSection = document.createElement("section");
    workspaceSection.className = "workspace";

    const notesPanel = buildNotesPanel(displayedNote?.id ?? "");

    const editor = document.createElement("section");
    editor.className = "editor-card";

    const status = document.createElement("p");
    status.className = `status status-${syncState}`;
    status.textContent = getStatusText();

    const selectedFiltersBar = document.createElement("div");
    selectedFiltersBar.className = "selected-filters";
    selectedFiltersBar.hidden = selectedTagFilters.length === 0;

    if (selectedTagFilters.length > 0) {
      const label = document.createElement("span");
      label.className = "selected-filters-label";
      label.textContent = "Filtered by";
      selectedFiltersBar.append(label);

      for (const tag of selectedTagFilters) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "selected-filter-chip";
        chip.textContent = tag;
        chip.onclick = () => {
          selectedTagFilters = selectedTagFilters.filter((entry) => entry !== tag);
          ensureVisibleActiveNote();
          syncTagFiltersToLocation();
          render();
        };
        selectedFiltersBar.append(chip);
      }
    }

    if (!displayedNote && selectedTagFilters.length > 0) {
      const emptyEditor = document.createElement("div");
      emptyEditor.className = "empty-editor-state";
      emptyEditor.innerHTML = `
        <h2>No notebook matches this filter.</h2>
        <p>Try removing one of the selected tags or clear the filter to see all notes again.</p>
      `;
      editor.append(status, selectedFiltersBar, emptyEditor);
    } else {
      const note = displayedNote ?? currentNote;

      const titleInput = document.createElement("input");
      titleInput.className = "title-input";
      titleInput.placeholder = "Note title";
      titleInput.value = note.title;
      titleInput.oninput = () => {
        replaceCurrentNote((currentWorkspaceNote) => ({
          ...currentWorkspaceNote,
          title: titleInput.value,
          updatedAt: new Date().toISOString(),
        }));
        syncState = "idle";
        refreshNotesPanel();
      };

      const bodyInput = document.createElement("textarea");
      bodyInput.className = "body-input";
      bodyInput.placeholder = "Start writing...";
      bodyInput.value = note.body;
      bodyInput.oninput = () => {
        replaceCurrentNote((currentWorkspaceNote) => ({
          ...currentWorkspaceNote,
          body: bodyInput.value,
          updatedAt: new Date().toISOString(),
        }));
        refreshNotesPanel();
      };

      editor.append(status, selectedFiltersBar, titleInput, buildTagInput(), bodyInput);
    }
    workspaceSection.append(notesPanel, editor);
    page.append(workspaceSection);

    const footer = document.createElement("footer");
    footer.className = "footer";
    footer.innerHTML = `
      <p>Each note is stored as its own JSON file in Google Drive, with a notebook index file keeping the list and active selection together. Location labels are powered by <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> and <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim</a>.</p>
      <p class="build-stamp">${formatBuildStamp()}</p>
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

  const restoreWorkspaceAfterSignIn = async (): Promise<void> => {
    try {
      syncState = "loading";
      lastError = "";
      render();

      const remoteWorkspace = await getStore().loadWorkspace();
      const mergedWorkspace = mergeWorkspaces(workspace, remoteWorkspace);
      const needsRemoteSave = !areWorkspacesEqual(mergedWorkspace, remoteWorkspace);

      workspace = mergedWorkspace;
      persistLocalWorkspace(workspace);

      if (needsRemoteSave) {
        syncState = "saving";
        render();
        await getStore().saveWorkspace(workspace);
      }

      syncState = "idle";
      render();
    } catch (error) {
      syncState = "error";
      lastError =
        error instanceof Error ? error.message : "Loading from Google Drive failed.";
      render();
    }
  };

  const saveWorkspace = async (mode: SaveMode = "interactive"): Promise<void> =>
    runWorkspaceSave(mode, {
      persistLocalWorkspace: () => persistLocalWorkspace(workspace),
      saveRemoteWorkspace: () => getStore().saveWorkspace(workspace),
      setSyncState: (state) => {
        syncState = state;
      },
      setLastError: (message) => {
        lastError = message;
      },
      render,
      refreshStatus,
    });

  const captureIncomingUrl = async (): Promise<void> => {
    const notePayload = readNoteCapture(window.location.href);
    if (notePayload) {
      const title = await generateFreshNoteTitle();

      workspace = createTextNoteWorkspace(workspace, {
        title,
        body: notePayload.note,
      });
      persistLocalWorkspace(workspace);
      window.history.replaceState({}, "", clearCaptureParamsFromLocation(window.location.href));
      return;
    }

    const urlPayload = readUrlCapture(window.location.href);
    if (!urlPayload) {
      return;
    }

    const resolvedTitle =
      urlPayload.title ??
      (await resolveTitleFromUrl(urlPayload.url)) ??
      deriveTitleFromUrl(urlPayload.url);

    workspace = createCapturedNoteWorkspace(workspace, {
      title: resolvedTitle,
      url: urlPayload.url,
    });
    persistLocalWorkspace(workspace);

    window.history.replaceState({}, "", clearCaptureParamsFromLocation(window.location.href));
  };

  void (async () => {
    try {
      await captureIncomingUrl();
      await auth.initialize();

      profile = await restoreSessionOnStartup(
        auth,
        (restoredProfile) => {
          profile = restoredProfile;
        },
        restoreWorkspaceAfterSignIn,
      );
      if (profile) {
        return;
      }
    } catch (error) {
      syncState = "error";
      lastError = error instanceof Error ? error.message : "App initialization failed.";
    }

    render();
  })();

  render();
}
