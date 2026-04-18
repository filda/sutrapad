import { buildTagIndex, filterNotesByAllTags } from "../../lib/notebook";
import { buildBookmarklet } from "../../lib/bookmarklet";
import { formatDate } from "../logic/formatting";
import { buildNoteMetadata } from "../logic/note-metadata";
import type { SutraPadDocument, SutraPadWorkspace, UserProfile } from "../../types";
import type { SyncState } from "../session/workspace-sync";

interface NotesPanelOptions {
  workspace: SutraPadWorkspace;
  currentNoteId: string;
  selectedTagFilters: string[];
  onSelectNote: (noteId: string) => void;
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  onNewNote: () => void;
}

interface EditorCardOptions {
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  selectedTagFilters: string[];
  syncState: SyncState;
  statusText: string;
  onRemoveSelectedFilter: (tag: string) => void;
  onTitleInput: (value: string) => void;
  onBodyInput: (value: string) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
}

interface RenderAppOptions extends EditorCardOptions, NotesPanelOptions {
  root: HTMLElement;
  profile: UserProfile | null;
  bookmarkletHelperExpanded: boolean;
  bookmarkletMessage: string;
  iosShortcutUrl: string;
  buildStamp: string;
  onSignIn: () => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignOut: () => void;
  onToggleBookmarkletHelper: () => void;
  onCopyBookmarklet: () => void;
}

function buildSelectedFiltersBar(
  selectedTagFilters: string[],
  onRemoveSelectedFilter: (tag: string) => void,
): HTMLDivElement {
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
      chip.onclick = () => onRemoveSelectedFilter(tag);
      selectedFiltersBar.append(chip);
    }
  }

  return selectedFiltersBar;
}

function buildTagInput(
  note: SutraPadDocument,
  onAddTag: (value: string) => void,
  onRemoveTag: (tag: string) => void,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tags-row";

  const input = document.createElement("input");
  input.className = "tag-text-input";
  input.type = "text";
  input.setAttribute("aria-label", "Add tag");

  const addTag = (value: string): void => {
    const tag = value.trim().toLowerCase();
    if (!tag || note.tags.includes(tag)) return;
    onAddTag(value);
    renderChips();
  };

  input.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input.value);
      input.value = "";
      input.focus();
    } else if (e.key === "Backspace" && input.value === "") {
      const tags = note.tags;
      if (tags.length === 0) return;
      onRemoveTag(tags.at(-1) ?? "");
      renderChips();
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

    for (const tag of note.tags) {
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
        onRemoveTag(tag);
        renderChips();
        input.focus();
      };

      chip.append(label, removeBtn);
      row.append(chip);
    }

    input.placeholder = note.tags.length === 0 ? "Add tags…" : "";
    row.append(input);
  };

  renderChips();
  return row;
}

function buildNotesList(
  currentNoteId: string,
  notes: SutraPadDocument[],
  onSelectNote: (noteId: string) => void,
): HTMLDivElement {
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
    button.onclick = () => onSelectNote(note.id);

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
}

export function buildNotesPanel({
  workspace,
  currentNoteId,
  selectedTagFilters,
  onSelectNote,
  onToggleTagFilter,
  onClearTagFilters,
  onNewNote,
}: NotesPanelOptions): HTMLElement {
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
  newNoteButton.onclick = onNewNote;
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
      clearFiltersButton.onclick = onClearTagFilters;
      filterHeader.append(clearFiltersButton);
    }

    const cloud = document.createElement("div");
    cloud.className = "tag-filter-cloud";

    for (const entry of tagIndex.tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `tag-filter-chip${selectedTagFilters.includes(entry.tag) ? " is-active" : ""}`;
      chip.textContent = `${entry.tag} · ${entry.count}`;
      chip.onclick = () => onToggleTagFilter(entry.tag);
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

  notesPanel.append(buildNotesList(currentNoteId, filteredNotes, onSelectNote));
  return notesPanel;
}

function buildEditorCard({
  note,
  currentNote,
  selectedTagFilters,
  syncState,
  statusText,
  onRemoveSelectedFilter,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
}: EditorCardOptions): HTMLElement {
  const editor = document.createElement("section");
  editor.className = "editor-card";

  const status = document.createElement("p");
  status.className = `status status-${syncState}`;
  status.textContent = statusText;

  const selectedFiltersBar = buildSelectedFiltersBar(selectedTagFilters, onRemoveSelectedFilter);

  if (!note && selectedTagFilters.length > 0) {
    const emptyEditor = document.createElement("div");
    emptyEditor.className = "empty-editor-state";
    emptyEditor.innerHTML = `
      <h2>No notebook matches this filter.</h2>
      <p>Try removing one of the selected tags or clear the filter to see all notes again.</p>
    `;
    editor.append(status, selectedFiltersBar, emptyEditor);
    return editor;
  }

  const displayedNote = note ?? currentNote;

  const titleInput = document.createElement("input");
  titleInput.className = "title-input";
  titleInput.placeholder = "Note title";
  titleInput.value = displayedNote.title;
  titleInput.oninput = () => onTitleInput(titleInput.value);

  const bodyInput = document.createElement("textarea");
  bodyInput.className = "body-input";
  bodyInput.placeholder = "Start writing...";
  bodyInput.value = displayedNote.body;
  bodyInput.oninput = () => onBodyInput(bodyInput.value);

  const noteMetadata = document.createElement("p");
  noteMetadata.className = "note-metadata";
  noteMetadata.textContent = buildNoteMetadata(displayedNote);

  editor.append(
    status,
    selectedFiltersBar,
    titleInput,
    buildTagInput(displayedNote, onAddTag, onRemoveTag),
    bodyInput,
    noteMetadata,
  );

  return editor;
}

export function renderAppPage({
  root,
  workspace,
  currentNoteId,
  selectedTagFilters,
  note,
  currentNote,
  syncState,
  statusText,
  profile,
  bookmarkletHelperExpanded,
  bookmarkletMessage,
  iosShortcutUrl,
  buildStamp,
  onSignIn,
  onLoadNotebook,
  onSaveNotebook,
  onSignOut,
  onToggleBookmarkletHelper,
  onCopyBookmarklet,
  onSelectNote,
  onToggleTagFilter,
  onClearTagFilters,
  onNewNote,
  onRemoveSelectedFilter,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
}: RenderAppOptions): void {
  root.innerHTML = "";

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
    signInButton.onclick = onSignIn;

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
    reloadButton.onclick = onLoadNotebook;

    const saveButton = document.createElement("button");
    saveButton.className = "button button-primary";
    saveButton.textContent = "Save notebook";
    saveButton.onclick = onSaveNotebook;

    const signOutButton = document.createElement("button");
    signOutButton.className = "button button-ghost";
    signOutButton.textContent = "Sign out";
    signOutButton.onclick = onSignOut;

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
  toggleBookmarkletHelper.onclick = onToggleBookmarkletHelper;
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
  copyBookmarkletButton.onclick = onCopyBookmarklet;

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
  workspaceSection.append(
    buildNotesPanel({
      workspace,
      currentNoteId,
      selectedTagFilters,
      onSelectNote,
      onToggleTagFilter,
      onClearTagFilters,
      onNewNote,
    }),
    buildEditorCard({
      note,
      currentNote,
      selectedTagFilters,
      syncState,
      statusText,
      onRemoveSelectedFilter,
      onTitleInput,
      onBodyInput,
      onAddTag,
      onRemoveTag,
    }),
  );
  page.append(workspaceSection);

  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `
    <p>Each note is stored as its own JSON file in Google Drive, with a notebook index file keeping the list and active selection together. Location labels are powered by <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> and <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim</a>.</p>
    <p class="build-stamp">${buildStamp}</p>
  `;
  page.append(footer);

  root.append(page);
}
