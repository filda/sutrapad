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
import { buildCapturePage } from "./pages/capture-page";
import { buildTagsPage } from "./pages/tags-page";
import { buildLinksPage } from "./pages/links-page";
import { buildTasksPage } from "./pages/tasks-page";
import { buildNotesPanel, type NotesPanelOptions } from "./pages/notes-page";
import { buildPagePlaceholder } from "./pages/placeholder-page";
import { buildSettingsPage } from "./pages/settings-page";
import { buildDetailTopbar } from "./shared/detail-topbar";
import { buildEditorCard, type EditorCardOptions } from "./shared/editor-card";
import { buildEditorSidebar } from "./shared/editor-sidebar";

// The editor-card builder needs the list of available tag suggestions, but
// callers don't have to supply it — it's derived here from the workspace
// that NotesPanelOptions already requires.
interface RenderAppOptions
  extends Omit<EditorCardOptions, "availableTagSuggestions">,
    NotesPanelOptions {
  root: HTMLElement;
  profile: UserProfile | null;
  appRootUrl: string;
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
  onCopyBookmarklet: () => void;
  onToggleTask: (noteId: string, lineIndex: number) => void;
  onChangeTheme: (choice: ThemeChoice) => void;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
  onChangeFilterMode: (mode: SutraPadTagFilterMode) => void;
  /**
   * Removes a single active filter — hooked up to the `×` affordance inside
   * each chip of the topbar tag-filter strip. Kept here (rather than on
   * EditorCardOptions, where it previously lived via the now-retired
   * selected-filters bar) because the chip row has moved permanently into
   * the chrome.
   */
  onRemoveSelectedFilter: (tag: string) => void;
  /**
   * Invoked by the topbar's tag-filter strip when the user clicks the
   * "+ Filter by tag…" trigger (or the `/` keyboard-hint pill). The strip
   * itself is purely presentational — the palette is the single suggestion
   * engine — so this just forwards into the same opener the `/` shortcut
   * uses.
   */
  onOpenPalette: () => void;
  /**
   * "← Back to notes" click handler — consumed by the detail-topbar that sits
   * above the editor card on the note detail route. Kept here (rather than on
   * EditorCardOptions) because the editor card is now a pure writing surface
   * and shouldn't own route-level navigation affordances.
   */
  onBackToNotes: () => void;
  /**
   * Opens the Capture page — wired into the right-rail sidebar's
   * "Other ways to capture" card. Kept as a dedicated callback (rather
   * than reusing `onSelectMenuItem("capture")` at the call site) so
   * app.ts can also clear `detailNoteId` in the same transition, matching
   * the behaviour of `onBackToNotes`.
   */
  onOpenCapture: () => void;
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
  bookmarkletMessage,
  iosShortcutUrl,
  buildStamp,
  onSignIn,
  onLoadNotebook,
  onSaveNotebook,
  onSignOut,
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
  onOpenPalette,
  onOpenCapture,
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

  // Auto-tag lookup is also consumed below by the editor-card on the detail
  // route, but the topbar needs it for chip styling too, so we build it once
  // at the top of the render pass and hand both surfaces the same Set.
  const autoTagLookup = new Set(
    buildCombinedTagIndex(workspace).tags
      .filter((entry) => entry.kind === "auto")
      .map((entry) => entry.tag),
  );

  // Topbar lives as a direct child of #app (outside .page) so that
  // `position: sticky` pins against the viewport rather than the page column,
  // and scrolling content glides underneath the blurred surface.
  root.append(
    buildTopbar({
      activeMenuItem,
      profile,
      syncState,
      statusText,
      selectedTagFilters,
      autoTagLookup,
      onSelectMenuItem,
      onSignIn,
      onSignOut,
      onRemoveFilter: onRemoveSelectedFilter,
      onClearFilters: onClearTagFilters,
      onOpenPalette,
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
        personaOptions,
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
          onOpenNote: openNoteInEditor,
        }),
      );
    } else if (activeMenuItem === "links") {
      page.append(
        buildLinksPage({
          workspace,
          onOpenNote: openNoteInEditor,
          onOpenCapture,
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
    } else if (activeMenuItem === "capture") {
      page.append(
        buildCapturePage({
          appRootUrl,
          iosShortcutUrl,
          bookmarkletMessage,
          onCopyBookmarklet,
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

  page.append(
    buildDetailTopbar({
      note: note ?? (selectedTagFilters.length > 0 ? null : currentNote),
      onBackToNotes,
    }),
  );

  // Editor + right-rail sidebar share a grid row so the sidebar's
  // sticky positioning anchors to the page column (not the viewport
  // margin). We only build the sidebar on the detail route — every
  // other route keeps the editor card full-width.
  const editorStage = document.createElement("div");
  editorStage.className = "editor-stage";

  // When no note matches the active filter, editor-card shows an
  // empty-state notice instead of the writing surface — the sidebar
  // would just display stats for some unrelated note, so skip it.
  const showSidebar = !(note === null && selectedTagFilters.length > 0);

  const sidebar = showSidebar
    ? buildEditorSidebar({
        currentNote: note ?? currentNote,
        onOpenCapture,
      })
    : null;

  editorStage.append(
    buildEditorCard({
      note,
      currentNote,
      selectedTagFilters,
      availableTagSuggestions: buildTagIndex(workspace).tags,
      syncState,
      statusText,
      onTitleInput,
      onBodyInput,
      onAddTag,
      onRemoveTag,
      onInputsChange: sidebar
        ? (title, body) => {
            sidebar.syncFromInputs(title, body);
          }
        : undefined,
    }),
  );

  if (sidebar !== null) {
    editorStage.append(sidebar.element);
  } else {
    editorStage.classList.add("editor-stage-solo");
  }

  page.append(editorStage);
  page.append(footer);

  root.append(page);
}
