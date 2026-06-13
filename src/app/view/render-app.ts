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
import type {
  SutraPadDocument,
  SutraPadTagFilterMode,
  UserProfile,
} from "../../types";
import {
  deriveNotebookPersona,
  type NotebookPersona,
} from "../../lib/notebook-persona";
import { buildCombinedTagIndex, buildTagIndex } from "../../lib/notebook";
import { createOgImageResolver } from "../logic/og-image-resolver";
import type { LexiconStore } from "../../services/drive/lexicon-store";
import { pickNoteThumbSeed } from "../logic/link-thumb-seed";
import { deriveNotePrimaryUrl } from "../logic/note-primary-url";
import { buildTopbar } from "./chrome/topbar";
import { buildMobileTabbar } from "./chrome/mobile-nav";
import { buildAppFab } from "./chrome/app-fab";
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
import { buildAboutPage } from "./pages/about-page";
import { buildTermsPage } from "./pages/terms-page";
import { buildShortcutsPage } from "./pages/shortcuts-page";
import { buildLexiconPage } from "./pages/lexicon-page";
import { buildSiteFooter } from "./chrome/site-footer";
import { buildDetailTopbar } from "./shared/detail-topbar";
import { buildEditorCard, type EditorCardOptions } from "./shared/editor-card";
import { buildLocationConsentCard } from "./shared/location-consent-card";
import { requiresLocationConsent } from "../logic/capture-location";
import { buildEditorSidebar } from "./shared/editor-sidebar";
import { buildLinkThumb } from "./shared/link-thumb";
import { applyPersonaStyles } from "./shared/persona-decor";
import { formatLastChange } from "../logic/editor-sync-crumb";
import type { SyncState } from "../session/workspace-sync";
import {
  buildHomeHintContext,
  composeHintBanner,
} from "./shared/hint-banner";

// The editor-card builder is intentionally minimal (writing surface
// only) — tag editing moved to the right-rail sidebar and the status
// row folded into the detail-topbar. So RenderAppOptions still mixes
// in EditorCardOptions for the title/body callbacks, but declares the
// surrounding plumbing (sync state for the chrome sync-pill, tag
// callbacks for the sidebar) inline below.
interface RenderAppOptions extends EditorCardOptions, NotesPanelOptions {
  root: HTMLElement;
  /**
   * Drives the chrome topbar's sync-pill (idle / loading / saving /
   * error). The detail-topbar's "synced 22:00" crumb is built from
   * `currentNote.updatedAt` directly and so doesn't read this field —
   * the pill stays the single source of "is something happening *now*".
   */
  syncState: SyncState;
  /**
   * Long-form sync status the chrome topbar parks in the sync-pill's
   * tooltip / aria-label. Kept as a separate string from the visible
   * crumb so the pill can display the original error detail verbatim.
   */
  statusText: string;
  /** Commits a new user tag from the right-rail tag input. */
  onAddTag: (value: string) => void;
  /** Removes a user tag from the right-rail tag input. */
  onRemoveTag: (tag: string) => void;
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
   * Tri-state: `"on"` opts in, `"off"` opts out, `"unanswered"` (the
   * default) suppresses the prompt and surfaces the in-app consent
   * card in the editor stage.
   */
  captureLocationPreference: CaptureLocationPreference;
  /**
   * Transient flag — true after the user clicked "Allow" but the
   * browser's geolocation site-permission is `"denied"`. Swaps the
   * consent card into its blocked panel so we don't fire a doomed
   * `getCurrentPosition`. Resets on reload.
   */
  locationConsentBlocked: boolean;
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
  /**
   * Consent card "Allow" handler. Pre-checks the browser's
   * geolocation permission, then either flips the blocked flag (when
   * the site is denied at the browser level) or sets the preference
   * to `"on"` and runs the second-pass backfill on the active draft.
   */
  onAllowLocationCapture: () => void;
  /**
   * Consent card "Not now" handler. Sets the preference to `"off"`.
   */
  onDenyLocationCapture: () => void;
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
   * Opens the Capture page — consumed by the Links page's empty-state
   * CTA. Kept as a dedicated callback (rather than reusing
   * `onSelectMenuItem("capture")` at the call site) so app.ts can also
   * clear `detailNoteId` in the same transition, matching the behaviour
   * of `onBackToNotes`.
   */
  onOpenCapture: () => void;
  /**
   * Returns a ready-to-use lexicon store, or `null` when the user is
   * signed out. Threaded through purely for the Lexicon Builder workbench
   * page, which talks to its own Drive artifacts outside the regular
   * workspace sync. The wiring layer owns the access token and builds the
   * store from it, so the workbench view never sees the raw token
   * (hardening plan, item 10). Read at call time (not captured at render)
   * so a sign-out mid-session is reflected on the next workbench action.
   */
  getLexiconStore: () => LexiconStore | null;
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
  locationConsentBlocked,
  onSelectMenuItem,
  onToggleTask,
  onChangeTheme,
  onChangePersonaPreference,
  onChangeCaptureLocationPreference,
  onAllowLocationCapture,
  onDenyLocationCapture,
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
  getLexiconStore,
}: RenderAppOptions): void {
  root.innerHTML = "";
  const isNoteDetailRoute = activeMenuItem === "notes" && detailNoteId !== null;
  root.classList.toggle("app--note-detail", isNoteDetailRoute);

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

  const footer = buildSiteFooter({ buildStamp, onSelectMenuItem });

  // Tail applied to every render path: footer → page → root → FAB (last, so
  // the FAB paints above page content without a z-index war with every card
  // and popover).
  const finalize = (): void => {
    page.append(footer);
    root.append(page);
    root.append(
      buildAppFab({
        activeMenuItem,
        onSelectMenuItem,
      }),
    );
  };

  if (activeMenuItem === "home") {
    page.classList.add("page--wide");
    // The hint context (workspace signals + callbacks) is built in a
    // dedicated helper so the workspace-walking loops have their own
    // scope and don't shadow the outer `note` parameter destructured
    // from RenderAppOptions. Multiple candidates poke at the alias
    // suggestions and task counts, so deriving them once mirrors the
    // existing stats-strip computation cost.
    const hintBanner = composeHintBanner({
      ctx: buildHomeHintContext({
        workspace,
        profile,
        dismissedTagAliases,
        tasksOneThingKey,
        callbacks: {
          openCapture: () => onSelectMenuItem("capture"),
          openSettings: () => onSelectMenuItem("settings"),
          openTasks: () => onSelectMenuItem("tasks"),
        },
      }),
    });

    page.append(
      buildHomePage({
        workspace,
        profile,
        personaOptions,
        hintBanner,
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
      page.classList.add("page--wide");
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
      page.classList.add("page--wide");
      page.append(
        buildLinksPage({
          workspace,
          selectedTagFilters,
          linksViewMode,
          personaOptions,
          onOpenNote: openNoteInEditor,
          onOpenCapture,
          onChangeLinksView,
          onClearTagFilters,
        }),
      );
    } else if (activeMenuItem === "tasks") {
      page.classList.add("page--wide");
      page.append(
        buildTasksPage({
          workspace,
          selectedTagFilters,
          tasksFilter,
          tasksShowDone,
          tasksOneThingKey,
          personaOptions,
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
    } else if (activeMenuItem === "about") {
      page.append(buildAboutPage({ onSelectMenuItem }));
    } else if (activeMenuItem === "terms") {
      page.append(buildTermsPage({ onSelectMenuItem }));
    } else if (activeMenuItem === "shortcuts") {
      page.append(buildShortcutsPage({ onSelectMenuItem }));
    } else if (activeMenuItem === "lexicon") {
      page.append(
        buildLexiconPage({
          profile,
          getLexiconStore,
          onSignIn,
          onSelectMenuItem,
        }),
      );
    } else {
      page.append(buildPagePlaceholder(activeMenuItem));
    }
    finalize();
    return;
  }

  if (detailNoteId === null) {
    page.classList.add("page--wide");
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

  // The topbar's right-edge crumb carries "synced HH:mm" (or, for a
  // signed-out user, "local · HH:mm"); on cross-day edits the date is
  // appended. Suppressed in the filter-miss state because there is no
  // single note whose last-edit time would be meaningful.
  const topbarNote = note ?? (selectedTagFilters.length > 0 ? null : currentNote);
  const syncCrumb = topbarNote
    ? formatLastChange(topbarNote.updatedAt, { signedIn: profile !== null })
    : null;

  appendNoteDetailPage(page, {
    topbarNote,
    syncCrumb,
    note,
    currentNote,
    selectedTagFilters,
    workspace,
    personaOptions,
    captureLocationPreference,
    locationConsentBlocked,
    onAllowLocationCapture,
    onDenyLocationCapture,
    onSelectMenuItem,
    onBackToNotes,
    onTitleInput,
    onBodyInput,
    onAddTag,
    onRemoveTag,
  });
  finalize();
}

interface NoteDetailPageOptions {
  topbarNote: SutraPadDocument | null;
  syncCrumb: string | null;
  note: SutraPadDocument | null;
  currentNote: SutraPadDocument;
  selectedTagFilters: string[];
  workspace: RenderAppOptions["workspace"];
  personaOptions: EditorCardOptions["personaOptions"];
  captureLocationPreference: CaptureLocationPreference;
  locationConsentBlocked: boolean;
  onAllowLocationCapture: () => void;
  onDenyLocationCapture: () => void;
  onSelectMenuItem: (id: MenuItemId) => void;
  onBackToNotes: () => void;
  onTitleInput: (value: string, noteId?: string) => void;
  onBodyInput: (
    value: string,
    caretPosition: number | undefined,
    noteId?: string,
  ) => void;
  onAddTag: (value: string) => void;
  onRemoveTag: (tag: string) => void;
}

function appendNoteDetailPage(
  page: HTMLElement,
  {
    topbarNote,
    syncCrumb,
    note,
    currentNote,
    selectedTagFilters,
    workspace,
    personaOptions,
    captureLocationPreference,
    locationConsentBlocked,
    onAllowLocationCapture,
    onDenyLocationCapture,
    onSelectMenuItem,
    onBackToNotes,
    onTitleInput,
    onBodyInput,
    onAddTag,
    onRemoveTag,
  }: NoteDetailPageOptions,
): void {
  page.classList.add("page--note-detail");

  const detailPersona = deriveNoteDetailPersona(topbarNote, personaOptions);
  if (detailPersona !== null) {
    page.classList.add("page--notebook-persona");
    applyPersonaStyles(page, detailPersona, { rotationFactor: 0 });
  }

  // The detail-topbar is built first because its `setKind` handle is
  // wired into both the hero (above the shell) and the editor card
  // (below) — typing in either surface refreshes the in-topbar kind
  // chip without an outer render pass.
  const detailTopbar = buildDetailTopbar({
    note: topbarNote,
    syncCrumb,
    onBackToNotes,
  });

  if (topbarNote !== null) {
    page.append(
      buildNoteDetailHero(topbarNote, {
        onTitleInput,
        onInputsChange: detailTopbar.setKind,
      }),
    );
  }

  const detailShell = document.createElement("div");
  detailShell.className = "note-detail-shell";
  detailShell.append(detailTopbar.element);

  // Editor + right-rail sidebar share a grid row so the sidebar's
  // sticky positioning anchors to the page column (not the viewport
  // margin). We only build the sidebar on the detail route — every
  // other route keeps the editor card full-width.
  const editorStage = document.createElement("div");
  editorStage.className = "editor-stage";

  // When no note matches the active filter, editor-card shows an
  // empty-state notice instead of the writing surface — the sidebar
  // would just display tag UI for some unrelated note, so skip it.
  const showSidebar = !(note === null && selectedTagFilters.length > 0);

  appendLocationConsentCardIfNeeded(editorStage, {
    captureLocationPreference,
    locationConsentBlocked,
    onAllowLocationCapture,
    onDenyLocationCapture,
    onSelectMenuItem,
  });

  editorStage.append(
    buildEditorCard({
      note,
      currentNote,
      selectedTagFilters,
      onTitleInput,
      onBodyInput,
      onInputsChange: detailTopbar.setKind,
      personaOptions,
      showKindChip: false,
      // Title moved up into the hero so the writing surface stays
      // body-only. The editor-card still listens to `onTitleInput`
      // for the (unused) input case where standalone callers turn
      // it back on, so the contract is forward-compatible.
      showTitleInput: false,
    }),
  );

  if (showSidebar) {
    editorStage.append(
      buildEditorSidebar({
        currentNote: note ?? currentNote,
        availableTagSuggestions: buildTagIndex(workspace).tags,
        onAddTag,
        onRemoveTag,
      }),
    );
  } else {
    editorStage.classList.add("editor-stage-solo");
  }

  detailShell.append(editorStage);
  page.append(detailShell);
}

function deriveNoteDetailPersona(
  note: SutraPadDocument | null,
  personaOptions: EditorCardOptions["personaOptions"],
): NotebookPersona | null {
  if (note === null || personaOptions === undefined) return null;
  return deriveNotebookPersona(note, {
    allNotes: personaOptions.allNotes,
    dark: personaOptions.dark,
  });
}

interface NoteDetailHeroOptions {
  /** Fires on every title keystroke. Same callback the editor-card
   *  used to receive — wiring is identical, the input element just
   *  lives in the hero now. `noteId` pins the write to the note this
   *  hero was mounted for; see `editor-card.ts` for the same race the
   *  binding defends against. */
  onTitleInput: (value: string, noteId?: string) => void;
  /** Fired after the title input updates so the detail-topbar kind
   *  chip can refresh without an outer render pass. Mirrors the
   *  editor-card body input's `onInputsChange` hook. */
  onInputsChange?: (title: string, body: string) => void;
}

function buildNoteDetailHero(
  note: SutraPadDocument,
  options: NoteDetailHeroOptions,
): HTMLElement {
  const primaryUrl = deriveNotePrimaryUrl(note);
  const hero = buildLinkThumb({
    url: primaryUrl,
    notes: [note],
    resolver: createOgImageResolver(),
    gradientSeed: pickNoteThumbSeed(note),
  });
  hero.classList.add("note-detail-hero");

  // Editable title input lives inside the hero so the banner doubles
  // as a "what notebook am I in" header AND the primary edit surface
  // for the title. The editor-card opts out of its own title input
  // (showTitleInput: false in render-app) to avoid the two-fields-
  // for-one-value duplication that earlier experiments produced.
  //
  // `<textarea>` (not `<input>`) because long titles need to wrap onto
  // a second line inside the banner — a single-line input would let
  // the text run past the sidebar that overlaps the hero on the
  // right. We strip any newlines on keystroke + prevent Enter so the
  // value stays semantically single-line while the rendering wraps
  // visually.
  //
  // Body lookup for `onInputsChange`: read the editor textarea via
  // the DOM each keystroke. Slightly less hygienic than threading a
  // state ref through, but the textarea is a sibling further down
  // the same page subtree — a single `querySelector` per keystroke
  // is cheap, and it keeps the hero builder's surface area small.
  const titleInput = document.createElement("textarea");
  titleInput.className = "note-detail-hero-title";
  titleInput.rows = 1;
  titleInput.placeholder = "Note title";
  titleInput.value = note.title;
  // Capture the id this hero was mounted for. Threaded into the
  // title-write so a render that detaches this textarea (and may
  // also shift `activeNoteId`) doesn't route the trailing keystroke
  // / IME commit onto an unrelated note. Same reasoning as the
  // body textarea's `boundNoteId` in `editor-card.ts`.
  const boundNoteId = note.id;
  titleInput.addEventListener("input", () => {
    // Some platforms (paste, IME commits) can sneak a newline into the
    // textarea even without an Enter press — collapse to spaces before
    // propagating so the workspace title field stays one-line.
    if (titleInput.value.includes("\n")) {
      titleInput.value = titleInput.value.replaceAll(/\n+/gu, " ");
    }
    const value = titleInput.value;
    options.onTitleInput(value, boundNoteId);
    const bodyEl = document.querySelector(".editor-body");
    const body =
      bodyEl instanceof HTMLTextAreaElement ? bodyEl.value : note.body;
    options.onInputsChange?.(value, body);
  });
  titleInput.addEventListener("keydown", (event) => {
    // Enter would insert a newline; the title is conceptually one line
    // (wrapping is visual only). Blocking the keystroke is cleaner
    // than stripping after the fact because the caret stays where the
    // user expects.
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });
  hero.append(titleInput);
  return hero;
}

interface LocationConsentCardSlotOptions {
  captureLocationPreference: CaptureLocationPreference;
  locationConsentBlocked: boolean;
  onAllowLocationCapture: () => void;
  onDenyLocationCapture: () => void;
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Appends the in-editor consent card to the editor stage when it
 * needs to be visible. The card sits above the editor in the same
 * column so it reads as part of the writing surface, not chrome.
 *
 * Three shown / hidden states map directly from the preference plus
 * the transient blocked flag:
 *
 *   - preference `"unanswered"` + not blocked → idle card (Allow /
 *     Not now / Privacy).
 *   - blocked is true (regardless of preference) → blocked panel
 *     ("Your browser is blocking location" + Privacy link). The
 *     consent flow can only land here after the user clicked Allow,
 *     so the preference is still `"unanswered"` at this point — but
 *     the blocked flag wins the precedence test either way.
 *   - preference `"on"` or `"off"` AND not blocked → card hidden.
 *     The user has made an explicit decision; Settings is the
 *     surface for changing it.
 *
 * Extracted out of `renderAppPage` to keep that function under the
 * `complexity` cap; the three-way state mapping is also easier to
 * read isolated than inlined into the editor-stage build.
 */
function appendLocationConsentCardIfNeeded(
  editorStage: HTMLElement,
  {
    captureLocationPreference,
    locationConsentBlocked,
    onAllowLocationCapture,
    onDenyLocationCapture,
    onSelectMenuItem,
  }: LocationConsentCardSlotOptions,
): void {
  if (
    !requiresLocationConsent(captureLocationPreference) &&
    !locationConsentBlocked
  ) {
    return;
  }
  editorStage.append(
    buildLocationConsentCard({
      status: locationConsentBlocked ? "blocked" : "idle",
      onAllow: onAllowLocationCapture,
      onDeny: onDenyLocationCapture,
      onSelectMenuItem,
    }),
  );
}
