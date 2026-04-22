import type { MenuItemId } from "../logic/menu";
import {
  isDarkThemeId,
  resolveThemeId,
  type ThemeChoice,
} from "../logic/theme";
import {
  isPersonaEnabled,
  type PersonaPreference,
} from "../logic/persona";
import type { SutraPadTagFilterMode, UserProfile } from "../../types";
import { buildCombinedTagIndex, buildTagIndex } from "../../lib/notebook";
import { buildTopbar } from "./chrome/topbar";
import { buildHomePage } from "./pages/home-page";
import { buildTagsPage } from "./pages/tags-page";
import { buildLinksPage } from "./pages/links-page";
import { buildTasksPage } from "./pages/tasks-page";
import { buildNotesPanel, type NotesPanelOptions } from "./pages/notes-page";
import { buildPagePlaceholder } from "./pages/placeholder-page";
import { buildSettingsPage } from "./pages/settings-page";
import { buildDetailTopbar } from "./shared/detail-topbar";
import { buildEditorCard, type EditorCardOptions } from "./shared/editor-card";

// The editor-card builder needs the list of available tag suggestions and the
// set of auto-tags for chip styling, but callers don't have to supply either
// — both are derived here from the workspace that NotesPanelOptions already
// requires.
interface RenderAppOptions
  extends Omit<EditorCardOptions, "availableTagSuggestions" | "autoTagLookup">,
    NotesPanelOptions {
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
  /**
   * Currently selected theme choice (device-local). Rendered on the Settings
   * page so the current selection is visible.
   */
  currentTheme: ThemeChoice;
  /**
   * Whether the notebook-card persona layer is active. Device-local, mirrors
   * the theme contract. When "on", the shared notes list draws paper colours,
   * rotation, stickers, and patina. When "off", the flat card style runs.
   */
  personaPreference: PersonaPreference;
  onSelectMenuItem: (id: MenuItemId) => void;
  onSignIn: () => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignOut: () => void;
  onToggleBookmarkletHelper: () => void;
  onCopyBookmarklet: () => void;
  onToggleTask: (noteId: string, lineIndex: number) => void;
  onChangeTheme: (choice: ThemeChoice) => void;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void;
  /**
   * "← Back to notes" click handler — consumed by the detail-topbar that sits
   * above the editor card on the note detail route. Kept here (rather than on
   * EditorCardOptions) because the editor card is now a pure writing surface
   * and shouldn't own route-level navigation affordances.
   */
  onBackToNotes: () => void;
}

export function renderAppPage({
  root,
  workspace,
  currentNoteId,
  selectedTagFilters,
  filterMode,
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
  onChangeFilterMode,
  onNewNote,
  notesViewMode,
  onChangeNotesView,
  onRemoveSelectedFilter,
  onTitleInput,
  onBodyInput,
  onAddTag,
  onRemoveTag,
  onBackToNotes,
  activeMenuItem,
  detailNoteId,
  currentTheme,
  personaPreference,
  onSelectMenuItem,
  onToggleTask,
  onChangeTheme,
  onChangePersonaPreference,
}: RenderAppOptions): void {
  root.innerHTML = "";

  // Persona decoration only runs when the user opted in *and* we have a
  // concrete dark/light answer to feed the paper-palette chooser. `auto`
  // themes resolve here so a system light/dark switch during a session flips
  // the card paper variants on the next re-render without a reload.
  const personaOptions = isPersonaEnabled(personaPreference)
    ? {
        allNotes: workspace.notes,
        dark: isDarkThemeId(resolveThemeId(currentTheme)),
      }
    : undefined;

  // Topbar lives as a direct child of #app (outside .page) so that
  // `position: sticky` pins against the viewport rather than the page column,
  // and scrolling content glides underneath the blurred surface.
  root.append(
    buildTopbar({
      activeMenuItem,
      profile,
      syncState,
      statusText,
      onSelectMenuItem,
      onSignIn,
      onSignOut,
    }),
  );

  const page = document.createElement("main");
  page.className = "page";

  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `
    <p>Each note is stored as its own JSON file in Google Drive, with a notebook index file keeping the list and active selection together. Location labels are powered by <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> and <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim</a>.</p>
    <p class="build-stamp">${buildStamp}</p>
  `;

  if (activeMenuItem === "home") {
    page.append(
      buildHomePage({
        workspace,
        profile,
        appRootUrl,
        bookmarkletHelperExpanded,
        bookmarkletMessage,
        iosShortcutUrl,
        personaOptions,
        onToggleBookmarkletHelper,
        onCopyBookmarklet,
        onNewNote,
        onOpenNote: onSelectNote,
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
          filterMode,
          currentNoteId,
          personaOptions,
          onToggleTagFilter,
          onClearTagFilters,
          onChangeFilterMode,
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
    } else if (activeMenuItem === "tasks") {
      page.append(
        buildTasksPage({
          workspace,
          onOpenNote: openNoteInEditor,
          onToggleTask,
        }),
      );
    } else if (activeMenuItem === "settings") {
      page.append(
        buildSettingsPage({
          currentTheme,
          personaPreference,
          profile,
          onChangeTheme,
          onChangePersonaPreference,
          onLoadNotebook,
          onSaveNotebook,
          onSignIn,
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
        filterMode,
        notesViewMode,
        personaOptions,
        onSelectNote,
        onToggleTagFilter,
        onClearTagFilters,
        onNewNote,
        onChangeNotesView,
      }),
    );
    page.append(footer);
    root.append(page);
    return;
  }

  // Auto-tag values are cached from the full combined index so the editor's
  // selected-filters bar can style chips without re-deriving per-note tags.
  const autoTagLookup = new Set(
    buildCombinedTagIndex(workspace).tags
      .filter((entry) => entry.kind === "auto")
      .map((entry) => entry.tag),
  );

  page.append(
    buildDetailTopbar({
      note: note ?? (selectedTagFilters.length > 0 ? null : currentNote),
      onBackToNotes,
    }),
  );

  page.append(
    buildEditorCard({
      note,
      currentNote,
      selectedTagFilters,
      filterMode,
      autoTagLookup,
      availableTagSuggestions: buildTagIndex(workspace).tags,
      syncState,
      statusText,
      onRemoveSelectedFilter,
      onTitleInput,
      onBodyInput,
      onAddTag,
      onRemoveTag,
    }),
  );
  page.append(footer);

  root.append(page);
}
