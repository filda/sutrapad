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
import type { CaptureLocationPreference } from "../logic/capture-location";
import type { TagClassId } from "../logic/tag-class";
import { suggestTagAliases } from "../logic/tag-aliases";
import type { TasksFilterId } from "../logic/tasks-filter";
import type { SutraPadTagFilterMode, UserProfile } from "../../types";
import { buildCombinedTagIndex, buildTagIndex } from "../../lib/notebook";
import { buildTopbar } from "./chrome/topbar";
import { buildMobileFab, buildMobileTabbar } from "./chrome/mobile-nav";
import { buildHomePage } from "./pages/home-page";
import { buildCapturePage } from "./pages/capture-page";
import { buildTagsPage } from "./pages/tags-page";
import { buildLinksPage } from "./pages/links-page";
import type { LinksViewMode } from "../logic/links-view";
import { buildTasksPage } from "./pages/tasks-page";
import { buildNotesPanel, type NotesPanelOptions } from "./pages/notes-page";
import { buildPagePlaceholder } from "./pages/placeholder-page";
import { buildSettingsPage } from "./pages/settings-page";
import { buildPrivacyPage } from "./pages/privacy-page";
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
  /**
   * Whether `+ Add` (and other fresh-note paths) is allowed to call
   * `getCurrentPosition` to enrich the new note with a place label.
   * Device-local, default off so the geolocation prompt only appears
   * after a deliberate opt-in via Settings → Privacy.
   */
  captureLocationPreference: CaptureLocationPreference;
  onSelectMenuItem: (id: MenuItemId) => void;
  onSignIn: () => void;
  onLoadNotebook: () => void;
  onSaveNotebook: () => void;
  onSignOut: () => void;
  onCopyBookmarklet: () => void;
  onToggleTask: (noteId: string, lineIndex: number) => void;
  onChangeTheme: (choice: ThemeChoice) => void;
  onChangePersonaPreference: (preference: PersonaPreference) => void;
  onChangeCaptureLocationPreference: (
    preference: CaptureLocationPreference,
  ) => void;
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
   * Tag-filter callbacks — still needed at the app-chrome level even though
   * the Notes page no longer exposes its own tag-filter-card (per handoff v2:
   * filtering on Notes is driven exclusively from the topbar + `/` palette).
   *
   * - `onClearTagFilters` feeds the topbar's tag-filter-bar "clear all" chip.
   * - `onToggleTagFilter` is consumed by the Tags page so a tag tile can be
   *   lit/unlit from there.
   */
  onToggleTagFilter: (tag: string) => void;
  onClearTagFilters: () => void;
  /**
   * Invoked by the topbar's tag-filter strip when the user clicks the `/`
   * keyboard-hint pill. The strip carries its own inline tag typeahead, but
   * the palette still provides a richer cmd-k surface that can search both
   * notes and tags — this hands off to the same opener as the global `/`
   * shortcut.
   */
  onOpenPalette: () => void;
  /**
   * Newest-first persisted recent-tag list, threaded through for the topbar
   * typeahead's "Recently used" group.
   */
  recentTagFilters: readonly string[];
  /**
   * Called when the user commits a tag from the inline typeahead (Enter,
   * second-Tab, or click). app.ts owns the follow-on: rotate the recent-tag
   * list, persist it, extend the active filter set, and re-render.
   */
  onApplyTagFilter: (tag: string) => void;
  /**
   * Tasks screen state — lives at app-top-level (like `notesViewMode`) so
   * toggling a task checkbox, which triggers a full re-render, doesn't wipe
   * the chip selection, show-done toggle, or one-thing pin. Deliberately
   * not URL-synced: these are ephemeral session preferences, not
   * shareable view-state.
   */
  tasksFilter: TasksFilterId;
  tasksShowDone: boolean;
  tasksOneThingKey: string | null;
  onChangeTasksFilter: (filter: TasksFilterId) => void;
  onToggleTasksShowDone: (showDone: boolean) => void;
  onSetOneThing: (key: string | null) => void;
  /**
   * Links page layout preference — cards (default) or list. Lives at
   * app-level so a nav away + back preserves the choice and so URL
   * `?view=…` can seed it on initial load.
   */
  linksViewMode: LinksViewMode;
  onChangeLinksView: (mode: LinksViewMode) => void;
  /**
   * "← Back to notes" click handler — consumed by the detail-topbar that sits
   * above the editor card on the note detail route. Kept here (rather than on
   * EditorCardOptions) because the editor card is now a pure writing surface
   * and shouldn't own route-level navigation affordances.
   */
  onBackToNotes: () => void;
  /**
   * Tags-page view state. Both live at app-top-level so a full re-render
   * (e.g. toggling a filter) preserves the class-visibility stance and
   * in-progress search query.
   *
   * `visibleTagClasses` is device-local + persisted (localStorage) — see
   * `src/app/logic/visible-tag-classes.ts`. `tagsSearchQuery` is volatile
   * session state; we never round-trip it to storage or the URL because
   * it's the kind of input users are actively typing, not a saved stance.
   */
  visibleTagClasses: ReadonlySet<TagClassId>;
  tagsSearchQuery: string;
  onToggleTagClass: (classId: TagClassId) => void;
  onChangeTagsSearchQuery: (query: string) => void;
  /**
   * Dismissed alias pairs — excluded from the hygiene card's suggestions.
   * Passed through as a Set so render-app can feed it straight into
   * `suggestTagAliases` without converting back from a serialized form.
   */
  dismissedTagAliases: ReadonlySet<string>;
  /** Merge handler for the Settings → Tag hygiene card. */
  onMergeTagAlias: (from: string, to: string) => void;
  /** Dismiss handler for the Settings → Tag hygiene card. */
  onDismissTagAlias: (canonical: string, alias: string) => void;
  /**
   * Opens the Capture page — wired into the right-rail sidebar's
   * "Other ways to capture" card. Kept as a dedicated callback (rather
   * than reusing `onSelectMenuItem("capture")` at the call site) so
   * app.ts can also clear `detailNoteId` in the same transition, matching
   * the behaviour of `onBackToNotes`.
   */
  onOpenCapture: () => void;
}

/**
 * Builds the page footer using DOM construction APIs instead of an
 * `innerHTML` template literal. The previous version interpolated
 * `buildStamp` into innerHTML — safe today (build stamps are
 * `version • commit • timestamp`, all developer-controlled), but the
 * pattern was the last interpolated-innerHTML site in the codebase
 * and a tempting precedent for someone adding a user-string later.
 *
 * Keeping zero interpolated-innerHTML in the repo means a single
 * grep is enough to audit the entire view layer.
 */
function buildFooter(
  buildStamp: string,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "footer";

  const description = document.createElement("p");
  description.append(
    "Each note is stored as its own JSON file in Google Drive, with a notebook index file keeping the list and active selection together. Location labels are powered by ",
  );
  const osmLink = document.createElement("a");
  osmLink.href = "https://www.openstreetmap.org/";
  osmLink.target = "_blank";
  osmLink.rel = "noreferrer";
  osmLink.textContent = "OpenStreetMap";
  description.append(osmLink, " and ");

  const nominatimLink = document.createElement("a");
  nominatimLink.href = "https://nominatim.openstreetmap.org/";
  nominatimLink.target = "_blank";
  nominatimLink.rel = "noreferrer";
  nominatimLink.textContent = "Nominatim";
  description.append(nominatimLink, ".");

  // Small in-app static-page link cluster. Today only Privacy lives
  // here; the wrapping nav makes it easy to slot future static pages
  // (Help, About, Terms, Changelog) alongside without restructuring
  // the footer markup each time. `is-link` re-uses the existing button-
  // as-link styling that brand / nav-tab / detail-back already share.
  const staticLinks = document.createElement("nav");
  staticLinks.className = "footer-links";
  staticLinks.setAttribute("aria-label", "Site information");

  const privacyLink = document.createElement("button");
  privacyLink.type = "button";
  privacyLink.className = "is-link footer-link";
  privacyLink.textContent = "Privacy";
  privacyLink.addEventListener("click", () => onSelectMenuItem("privacy"));
  staticLinks.append(privacyLink);

  const stamp = document.createElement("p");
  stamp.className = "build-stamp";
  stamp.textContent = buildStamp;

  footer.append(description, staticLinks, stamp);
  return footer;
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
  captureLocationPreference,
  onSelectMenuItem,
  onToggleTask,
  onChangeTheme,
  onChangePersonaPreference,
  onChangeCaptureLocationPreference,
  onOpenPalette,
  onApplyTagFilter,
  onOpenCapture,
  recentTagFilters,
  tasksFilter,
  tasksShowDone,
  tasksOneThingKey,
  onChangeTasksFilter,
  onToggleTasksShowDone,
  onSetOneThing,
  linksViewMode,
  onChangeLinksView,
  visibleTagClasses,
  tagsSearchQuery,
  onToggleTagClass,
  onChangeTagsSearchQuery,
  dismissedTagAliases,
  onMergeTagAlias,
  onDismissTagAlias,
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

  // Tag index for the topbar typeahead. Only the user-authored tags end up in
  // `buildTagIndex` — auto-tags don't need to appear in the filter dropdown
  // because they're always derived from metadata (filtering by `when:night`
  // happens via the Tags page / palette, not the typeahead).
  const availableTagSuggestions = buildTagIndex(workspace).tags;

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
      availableTagSuggestions,
      recentTagFilters,
      autoTagLookup,
      onSelectMenuItem,
      onSignIn,
      onSignOut,
      onRemoveFilter: onRemoveSelectedFilter,
      onClearFilters: onClearTagFilters,
      onOpenPalette,
      onApplyFilter: onApplyTagFilter,
    }),
  );

  // Mobile chrome — both nodes are always present so a viewport resize flips
  // between desktop and mobile without a re-render. CSS owns visibility via
  // the `@media (max-width: 640px)` block. Tabbar sits as a sibling of .page
  // so its `position: fixed` anchors to the viewport, not the page column.
  // FAB is appended last so it paints on top of every page's content.
  root.append(
    buildMobileTabbar({
      activeMenuItem,
      onSelectMenuItem,
    }),
  );

  const page = document.createElement("main");
  page.className = "page";

  const footer = buildFooter(buildStamp, onSelectMenuItem);

  // Tail applied to every render path: footer → page → root → FAB (last, so
  // the FAB paints above page content on mobile without a z-index war with
  // every card and popover).
  const finalize = (): void => {
    page.append(footer);
    root.append(page);
    root.append(
      buildMobileFab({
        activeMenuItem,
        onSelectMenuItem,
      }),
    );
  };

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
    finalize();
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
          visibleTagClasses,
          tagsSearchQuery,
          onToggleTagFilter,
          onClearTagFilters,
          onChangeFilterMode,
          onToggleTagClass,
          onChangeTagsSearchQuery,
          onOpenNote: openNoteInEditor,
        }),
      );
    } else if (activeMenuItem === "links") {
      page.append(
        buildLinksPage({
          workspace,
          selectedTagFilters,
          linksViewMode,
          onOpenNote: openNoteInEditor,
          onOpenCapture,
          onChangeLinksView,
          onClearTagFilters,
        }),
      );
    } else if (activeMenuItem === "tasks") {
      page.append(
        buildTasksPage({
          workspace,
          selectedTagFilters,
          tasksFilter,
          tasksShowDone,
          tasksOneThingKey,
          onOpenNote: openNoteInEditor,
          onToggleTask,
          onChangeTasksFilter,
          onToggleTasksShowDone,
          onSetOneThing,
          onClearTagFilters,
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
      // Suggestions are recomputed from the live workspace on every
      // Settings render. Cheap at our note counts and keeps the card
      // honest after a merge: the pair that was just collapsed disappears
      // without a separate "invalidate" step.
      const tagAliasSuggestions = suggestTagAliases(buildTagIndex(workspace), {
        dismissed: dismissedTagAliases,
      });
      page.append(
        buildSettingsPage({
          currentTheme,
          personaPreference,
          captureLocationPreference,
          profile,
          tagAliasSuggestions,
          onChangeTheme,
          onChangePersonaPreference,
          onChangeCaptureLocationPreference,
          onLoadNotebook,
          onSaveNotebook,
          onSignIn,
          onMergeTagAlias,
          onDismissTagAlias,
          onSelectMenuItem,
        }),
      );
    } else if (activeMenuItem === "privacy") {
      page.append(buildPrivacyPage({ onSelectMenuItem }));
    } else {
      page.append(buildPagePlaceholder(activeMenuItem));
    }
    finalize();
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
        onNewNote,
        onChangeNotesView,
      }),
    );
    finalize();
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
  finalize();
}
