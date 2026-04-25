/**
 * Builds the render-callback bag passed into `renderAppPage`. Each
 * callback wires a UI gesture (click / keystroke / drag) to the
 * appropriate state mutation + persistence + side-effect.
 *
 * Lifted out of `app.ts` so the wiring layer there can stay focused
 * on store + render orchestration. The 35-parameter destructured
 * options bag is preserved as-is — collapsing it into a smaller
 * shape (a `dispatch` action API, perhaps) is a separate refactor;
 * this commit just relocates the function.
 *
 * Most handlers are now one-liners thanks to the atom-store
 * subscriber chain (set → atom → persist + scheduleRender). The
 * exceptions are sites that need either a synchronous render
 * pre-empting the microtask (tag input focus restore) or an
 * additional side-effect alongside the mutation (autosave schedule,
 * URL location sync).
 */
import { GoogleAuthService } from "../services/google-auth";
import { buildBookmarklet } from "../lib/bookmarklet";
import {
  extractUrlsFromText,
  mergeHashtagsIntoTags,
  toggleTaskInBody,
  upsertNote,
} from "../lib/notebook";
import type {
  SutraPadDocument,
  SutraPadTagFilterMode,
  SutraPadWorkspace,
  UserProfile,
} from "../types";
import { isMenuActionItemId, type MenuItemId } from "./logic/menu";
import type { NotesViewMode } from "./logic/notes-view";
import type { LinksViewMode } from "./logic/links-view";
import type { ThemeChoice } from "./logic/theme";
import type { PersonaPreference } from "./logic/persona";
import type { TagClassId } from "./logic/tag-class";
import { toggleTagClassVisibility } from "./logic/visible-tag-classes";
import {
  addDismissedTagAlias,
  mergeTagInWorkspace,
} from "./logic/tag-aliases";
import { pushRecentTagFilter } from "./logic/tag-filter-typeahead";
import { togglePaletteTagFilter } from "./logic/palette";
import type { TasksFilterId } from "./logic/tasks-filter";
import {
  applyVisibleActiveNoteSelection,
  getCurrentWorkspaceNote,
  syncFilterModeToLocation,
  syncTagFiltersToLocation,
} from "./sync-helpers";
import {
  renderPreservingBodyInputFocus,
  renderPreservingTagInputFocus,
} from "./render-helpers";
import type { SyncState } from "./session/workspace-sync";

export interface RenderCallbackOptions {
  auth: GoogleAuthService;
  appRootUrl: string;
  setProfile: (profile: UserProfile | null) => void;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (workspace: SutraPadWorkspace) => void;
  setSyncState: (syncState: SyncState) => void;
  setLastError: (lastError: string) => void;
  setBookmarkletMessage: (message: string) => void;
  getSelectedTagFilters: () => string[];
  setSelectedTagFilters: (selectedTagFilters: string[]) => void;
  getFilterMode: () => SutraPadTagFilterMode;
  setFilterMode: (filterMode: SutraPadTagFilterMode) => void;
  getActiveMenuItem: () => MenuItemId;
  setActiveMenuItem: (menuItemId: MenuItemId) => void;
  getDetailNoteId: () => string | null;
  setDetailNoteId: (detailNoteId: string | null) => void;
  // View-mode / preference getters were dropped after the atom-store
  // migration: handlers used them only for `if (next === getX()) return`
  // early-outs, which the atoms' built-in `Object.is` check now handles
  // for free. The matching setters stay because handlers still mutate.
  setNotesViewMode: (notesViewMode: NotesViewMode) => void;
  setLinksViewMode: (linksViewMode: LinksViewMode) => void;
  setTasksFilter: (next: TasksFilterId) => void;
  setTasksShowDone: (next: boolean) => void;
  setTasksOneThingKey: (next: string | null) => void;
  getVisibleTagClasses: () => ReadonlySet<TagClassId>;
  setVisibleTagClasses: (next: Set<TagClassId>) => void;
  getTagsSearchQuery: () => string;
  setTagsSearchQuery: (next: string) => void;
  getDismissedTagAliases: () => ReadonlySet<string>;
  setDismissedTagAliases: (next: Set<string>) => void;
  getRecentTagFilters: () => readonly string[];
  setRecentTagFilters: (next: readonly string[]) => void;
  setCurrentTheme: (theme: ThemeChoice) => void;
  setPersonaPreference: (preference: PersonaPreference) => void;
  handleNewNote: () => void;
  /**
   * Discards the active note if it's an empty draft (user hit "+ Add"
   * then walked away without typing). Returns true when a purge
   * happened. Callers should invoke this *before* every navigation so a
   * freshly-spawned-but-untouched note doesn't linger in the workspace
   * or get pushed to Drive.
   */
  purgeEmptyDraftNotes: () => boolean;
  loadWorkspace: () => Promise<void>;
  saveWorkspace: () => Promise<void>;
  restoreWorkspaceAfterSignIn: () => Promise<void>;
  replaceCurrentNote: (updater: (note: SutraPadDocument) => SutraPadDocument) => void;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  scheduleAutoSave: () => void;
  render: () => void;
  refreshNotesPanel: () => void;
}

export function createRenderCallbacks({
  auth,
  appRootUrl,
  setProfile,
  getWorkspace,
  setWorkspace,
  setSyncState,
  setLastError,
  setBookmarkletMessage,
  getSelectedTagFilters,
  setSelectedTagFilters,
  getFilterMode,
  setFilterMode,
  getActiveMenuItem,
  setActiveMenuItem,
  getDetailNoteId,
  setDetailNoteId,
  setNotesViewMode,
  setLinksViewMode,
  setTasksFilter,
  setTasksShowDone,
  setTasksOneThingKey,
  getVisibleTagClasses,
  setVisibleTagClasses,
  getTagsSearchQuery,
  setTagsSearchQuery,
  getDismissedTagAliases,
  setDismissedTagAliases,
  getRecentTagFilters,
  setRecentTagFilters,
  setCurrentTheme,
  setPersonaPreference,
  handleNewNote,
  purgeEmptyDraftNotes,
  loadWorkspace,
  saveWorkspace,
  restoreWorkspaceAfterSignIn,
  replaceCurrentNote,
  persistWorkspace,
  scheduleAutoSave,
  render,
  refreshNotesPanel,
}: RenderCallbackOptions) {
  return {
    // Atom Object.is already short-circuits same-value sets, and
    // `persistNotesView` / `persistLinksView` / `persistTheme` /
    // … are wired as subscribers on the matching atoms — handlers
    // just call setters and rely on the atom subscriber chain to
    // persist + re-render.
    onChangeNotesView: (mode: NotesViewMode) => setNotesViewMode(mode),
    onChangeLinksView: (mode: LinksViewMode) => setLinksViewMode(mode),
    onChangeTasksFilter: (filter: TasksFilterId) => setTasksFilter(filter),
    onToggleTasksShowDone: (showDone: boolean) => setTasksShowDone(showDone),
    onSetOneThing: (key: string | null) => setTasksOneThingKey(key),
    onToggleTagClass: (classId: TagClassId) => {
      setVisibleTagClasses(toggleTagClassVisibility(getVisibleTagClasses(), classId));
    },
    onChangeTagsSearchQuery: (query: string) => {
      if (query === getTagsSearchQuery()) return;
      setTagsSearchQuery(query);
      // Full re-render is fine: the list view is modest and the Active-
      // filters / Classes blocks on the left panel need to stay in sync
      // with whatever state changed alongside this. The input itself
      // re-mounts, but we restore focus + caret below — same pattern
      // `renderPreservingBodyInputFocus` uses for the note body textarea.
      // Synchronous render here pre-empts the atom-driven scheduleRender
      // microtask, so the focus + caret restore below operates on the
      // freshly-mounted input rather than the about-to-be-replaced one.
      render();
      const nextInput = document.querySelector<HTMLInputElement>(
        ".tags-search-input",
      );
      if (nextInput && document.activeElement !== nextInput) {
        nextInput.focus();
        const end = nextInput.value.length;
        nextInput.setSelectionRange(end, end);
      }
    },
    onMergeTagAlias: (from: string, to: string) => {
      if (from === to) return;
      const current = getWorkspace();
      const next = mergeTagInWorkspace(current, from, to);
      if (next === current) return;
      setWorkspace(next);
      // Keep the active filter strip consistent: if the user was filtered
      // on `from`, carry them onto `to`. If they already had `to` selected
      // too, the duplicate is dropped. Anything else is left alone.
      const filters = getSelectedTagFilters();
      if (filters.includes(from)) {
        const rewritten = filters
          .map((tag) => (tag === from ? to : tag))
          .filter((tag, index, all) => all.indexOf(tag) === index);
        setSelectedTagFilters(rewritten);
      }
      persistWorkspace(next);
      scheduleAutoSave();
    },
    onDismissTagAlias: (canonical: string, alias: string) => {
      setDismissedTagAliases(
        addDismissedTagAlias(getDismissedTagAliases(), canonical, alias),
      );
    },
    onChangeTheme: (choice: ThemeChoice) => setCurrentTheme(choice),
    onChangePersonaPreference: (preference: PersonaPreference) =>
      setPersonaPreference(preference),
    onSelectMenuItem: (id: MenuItemId) => {
      if (isMenuActionItemId(id)) {
        handleNewNote();
        return;
      }
      if (getActiveMenuItem() === id && getDetailNoteId() === null) return;
      // Drop the untouched draft (if any) on nav away so an accidental
      // "+ Add" click doesn't leave an Untitled stub behind.
      purgeEmptyDraftNotes();
      setActiveMenuItem(id);
      setDetailNoteId(null);
    },
    onSignIn: () => {
      void (async () => {
        try {
          setSyncState("loading");
          setLastError("");
          setProfile(await auth.signIn());
          await restoreWorkspaceAfterSignIn();
        } catch (error) {
          setSyncState("error");
          setLastError(error instanceof Error ? error.message : "Sign-in failed.");
        }
      })();
    },
    onLoadNotebook: () => void loadWorkspace(),
    onSaveNotebook: () => void saveWorkspace(),
    onSignOut: () => {
      auth.signOut();
      setProfile(null);
      setSyncState("idle");
      setLastError("");
    },
    onCopyBookmarklet: () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(buildBookmarklet(appRootUrl));
          setBookmarkletMessage(
            "Bookmarklet copied. In Safari, create any bookmark, edit it, and paste this code into its URL field.",
          );
        } catch (error) {
          // The user-visible copy failure message is enough for the
          // recovery path, but a `console.warn` keeps the underlying
          // cause discoverable in devtools — clipboard rejections
          // are easy to mistake for "the button is broken" without
          // the actual permission / focus error in the log.
          console.warn("Bookmarklet clipboard copy failed:", error);
          setBookmarkletMessage(
            "Copy failed. In Safari, you can still drag the bookmarklet or manually copy the link target.",
          );
        }
      })();
    },
    onSelectNote: (noteId: string) => {
      // Leaving the current detail (possibly an untouched fresh draft)
      // for another note — drop the draft before rebinding active, so
      // it doesn't keep occupying the workspace once we've moved on.
      purgeEmptyDraftNotes();
      setActiveMenuItem("notes");
      setDetailNoteId(noteId);
      const workspace = {
        ...getWorkspace(),
        activeNoteId: noteId,
      };
      setWorkspace(workspace);
      persistWorkspace(workspace);
    },
    onBackToNotes: () => {
      // "← Back to notes" from the detail topbar. Same untouched-draft
      // sweep as the other nav paths — the user is explicitly leaving
      // the editor, so a blank note doesn't get a free ride to Drive.
      purgeEmptyDraftNotes();
      setDetailNoteId(null);
    },
    onOpenCapture: () => {
      // Mirrors `onBackToNotes`'s shape: clear the detail context first,
      // then flip the active menu item. Order matters so the next render
      // pass doesn't see a detail-editor route on the capture page.
      purgeEmptyDraftNotes();
      setDetailNoteId(null);
      setActiveMenuItem("capture");
    },
    onToggleTagFilter: (tag: string) => {
      const nextSelectedTagFilters = togglePaletteTagFilter(getSelectedTagFilters(), tag);
      setSelectedTagFilters(nextSelectedTagFilters);
      setWorkspace(
        applyVisibleActiveNoteSelection(
          getWorkspace(),
          nextSelectedTagFilters,
          getFilterMode(),
          persistWorkspace,
        ),
      );
      syncTagFiltersToLocation(nextSelectedTagFilters);
    },
    onApplyTagFilter: (tag: string) => {
      // Commit path from the topbar's inline typeahead. Enter, second-Tab,
      // and suggestion clicks all land here. The palette has its own toggle
      // path (`onToggleTagFilter`) which can also *remove* an active filter
      // — this one is strictly "add if not already active" so a stale
      // suggestion click can't accidentally un-filter.
      const selected = getSelectedTagFilters();
      const nextSelectedTagFilters = selected.includes(tag) ? selected : [...selected, tag];
      if (nextSelectedTagFilters !== selected) {
        setSelectedTagFilters(nextSelectedTagFilters);
        setWorkspace(
          applyVisibleActiveNoteSelection(
            getWorkspace(),
            nextSelectedTagFilters,
            getFilterMode(),
            persistWorkspace,
          ),
        );
        syncTagFiltersToLocation(nextSelectedTagFilters);
      }
      // Rotate the recent-tag list regardless of whether the filter was
      // already active — the user just interacted with this tag, so it
      // belongs at the top of the recents next time they open the dropdown.
      // The persist subscriber on `recentTagFilters$` writes the new list
      // to localStorage automatically.
      setRecentTagFilters(pushRecentTagFilter(getRecentTagFilters(), tag));
    },
    onClearTagFilters: () => {
      setSelectedTagFilters([]);
      syncTagFiltersToLocation([]);
    },
    onChangeFilterMode: (mode: SutraPadTagFilterMode) => {
      if (mode === getFilterMode()) return;
      setFilterMode(mode);
      setWorkspace(
        applyVisibleActiveNoteSelection(
          getWorkspace(),
          getSelectedTagFilters(),
          mode,
          persistWorkspace,
        ),
      );
      syncFilterModeToLocation(mode);
    },
    onNewNote: handleNewNote,
    onRemoveSelectedFilter: (tag: string) => {
      const nextSelectedTagFilters = getSelectedTagFilters().filter((entry) => entry !== tag);
      setSelectedTagFilters(nextSelectedTagFilters);
      setWorkspace(
        applyVisibleActiveNoteSelection(
          getWorkspace(),
          nextSelectedTagFilters,
          getFilterMode(),
          persistWorkspace,
        ),
      );
      syncTagFiltersToLocation(nextSelectedTagFilters);
    },
    onTitleInput: (value: string) => {
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        title: value,
        updatedAt: new Date().toISOString(),
      }));
      setSyncState("idle");
      refreshNotesPanel();
    },
    onBodyInput: (value: string) => {
      const tagsBefore = getCurrentWorkspaceNote(getWorkspace()).tags;
      const mergedTags = mergeHashtagsIntoTags(tagsBefore, value);
      // Only re-render the whole editor when a new hashtag actually appeared
      // in the body — otherwise every keystroke would swap the textarea and
      // lose caret/IME state. The notes panel still refreshes for title/body
      // preview updates even when no new tag is added.
      const tagsChanged = mergedTags.length !== tagsBefore.length;

      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        body: value,
        urls: extractUrlsFromText(value),
        tags: mergedTags,
        updatedAt: new Date().toISOString(),
      }));

      if (tagsChanged) {
        renderPreservingBodyInputFocus(render);
      } else {
        refreshNotesPanel();
      }
    },
    onToggleTask: (noteId: string, lineIndex: number) => {
      const workspace = getWorkspace();
      const targetNote = workspace.notes.find((entry) => entry.id === noteId);
      if (!targetNote) return;

      const nextBody = toggleTaskInBody(targetNote.body, lineIndex);
      if (nextBody === targetNote.body) return;

      const previousActiveNoteId = workspace.activeNoteId;
      const updatedWorkspace = upsertNote(workspace, noteId, (note) => ({
        ...note,
        body: nextBody,
        urls: extractUrlsFromText(nextBody),
        updatedAt: new Date().toISOString(),
      }));
      const finalWorkspace = { ...updatedWorkspace, activeNoteId: previousActiveNoteId };
      setWorkspace(finalWorkspace);
      persistWorkspace(finalWorkspace);
      scheduleAutoSave();
    },
    onAddTag: (value: string) => {
      const tag = value.trim().toLowerCase();
      if (!tag || getCurrentWorkspaceNote(getWorkspace()).tags.includes(tag)) return;
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        tags: [...currentWorkspaceNote.tags, tag],
        updatedAt: new Date().toISOString(),
      }));
      setSyncState("idle");
      renderPreservingTagInputFocus(render);
    },
    onRemoveTag: (tag: string) => {
      if (!tag) return;
      replaceCurrentNote((currentWorkspaceNote) => ({
        ...currentWorkspaceNote,
        tags: currentWorkspaceNote.tags.filter((entry) => entry !== tag),
        updatedAt: new Date().toISOString(),
      }));
      setSyncState("idle");
      renderPreservingTagInputFocus(render);
    },
  };
}
