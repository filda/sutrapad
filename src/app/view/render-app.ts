import type { MenuItemId } from "../logic/menu";
import type { UserProfile } from "../../types";
import { buildAppNav } from "./chrome/app-nav";
import { buildAccountBar } from "./chrome/account-bar";
import { buildHomePage } from "./pages/home-page";
import { buildTagsPage } from "./pages/tags-page";
import { buildLinksPage } from "./pages/links-page";
import {
  buildEditorCard,
  buildNotesPanel,
  type EditorCardOptions,
  type NotesPanelOptions,
} from "./pages/notes-page";
import { buildPagePlaceholder } from "./pages/placeholder-page";

interface RenderAppOptions extends EditorCardOptions, NotesPanelOptions {
  root: HTMLElement;
  profile: UserProfile | null;
  appRootUrl: string;
  bookmarkletHelperExpanded: boolean;
  bookmarkletMessage: string;
  iosShortcutUrl: string;
  buildStamp: string;
  activeMenuItem: MenuItemId;
  /**
   * When set and the active menu item is "notes", the detail editor for this
   * note is shown instead of the notes list. Callers are responsible for
   * validating that the id still exists in the workspace before passing it
   * through.
   */
  detailNoteId: string | null;
  onSelectMenuItem: (id: MenuItemId) => void;
  onSignIn: () => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignOut: () => void;
  onToggleBookmarkletHelper: () => void;
  onCopyBookmarklet: () => void;
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
  appRootUrl,
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
  onBackToNotes,
  activeMenuItem,
  detailNoteId,
  onSelectMenuItem,
}: RenderAppOptions): void {
  root.innerHTML = "";

  const page = document.createElement("main");
  page.className = "page";

  const hero = document.createElement("section");
  hero.className = "hero hero-top-only";

  const topRow = document.createElement("div");
  topRow.className = "hero-top-row";

  const eyebrow = document.createElement("button");
  eyebrow.type = "button";
  eyebrow.className = `eyebrow eyebrow-home${activeMenuItem === "home" ? " is-active" : ""}`;
  eyebrow.textContent = "SutraPad";
  eyebrow.setAttribute("aria-label", "Go to SutraPad home");
  eyebrow.setAttribute(
    "aria-current",
    activeMenuItem === "home" ? "page" : "false",
  );
  eyebrow.addEventListener("click", () => onSelectMenuItem("home"));
  topRow.append(eyebrow);
  topRow.append(buildAppNav(activeMenuItem, onSelectMenuItem));
  topRow.append(
    buildAccountBar({
      profile,
      onSignIn,
      onLoadNotebook,
      onSaveNotebook,
      onSignOut,
    }),
  );
  hero.append(topRow);

  page.append(hero);

  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `
    <p>Each note is stored as its own JSON file in Google Drive, with a notebook index file keeping the list and active selection together. Location labels are powered by <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> and <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim</a>.</p>
    <p class="build-stamp">${buildStamp}</p>
  `;

  if (activeMenuItem === "home") {
    page.append(
      buildHomePage({
        profile,
        appRootUrl,
        bookmarkletHelperExpanded,
        bookmarkletMessage,
        iosShortcutUrl,
        onToggleBookmarkletHelper,
        onCopyBookmarklet,
      }),
    );
    page.append(footer);
    root.append(page);
    return;
  }

  if (activeMenuItem !== "notes") {
    // onSelectNote already switches to the notes page and opens the detail
    // route for the chosen note, so nothing further is needed from here.
    const openNoteInEditor = (noteId: string): void => {
      onSelectNote(noteId);
    };

    if (activeMenuItem === "tags") {
      page.append(
        buildTagsPage({
          workspace,
          selectedTagFilters,
          currentNoteId,
          onToggleTagFilter,
          onClearTagFilters,
          onRemoveSelectedFilter,
          onOpenNote: openNoteInEditor,
        }),
      );
    } else if (activeMenuItem === "links") {
      page.append(
        buildLinksPage({
          workspace,
          onOpenNote: openNoteInEditor,
        }),
      );
    } else {
      page.append(buildPagePlaceholder(activeMenuItem));
    }
    page.append(footer);
    root.append(page);
    return;
  }

  if (detailNoteId === null) {
    page.append(
      buildNotesPanel({
        workspace,
        currentNoteId,
        selectedTagFilters,
        onSelectNote,
        onToggleTagFilter,
        onClearTagFilters,
        onNewNote,
      }),
    );
    page.append(footer);
    root.append(page);
    return;
  }

  page.append(
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
      onBackToNotes,
    }),
  );
  page.append(footer);

  root.append(page);
}
