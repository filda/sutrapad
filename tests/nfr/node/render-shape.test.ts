// @vitest-environment happy-dom
/**
 * DOM-size budget per page at workspace scale. Every list that can grow
 * with the notebook has to page or cap; a page that renders O(notes)
 * elements is exactly what made every repaint take 3–4 s on 2026-09-13
 * (Home timeline: ~38 000 elements; Links grid: ~18 000). Counted, not
 * timed — see `docs/nfr-testing-plan.md`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderAppPage } from "../../../src/app/view/render-app";
import { createEmptyDiagnostics } from "../../../src/app/logic/diagnostics";
import { resetListState } from "../../../src/app/logic/endless-scroll";
import type { MenuItemId } from "../../../src/app/logic/menu";
import { RENDER_MAX_ELEMENTS } from "../../../src/lib/budgets";
import { buildLinkIndex } from "../../../src/lib/notebook";
import { buildNoteSummary, buildPlaceholderNote } from "../../../src/lib/note-card-meta";
import { buildTaskIndex } from "../../../src/lib/tasks";
import type { SutraPadWorkspace } from "../../../src/types";
import { generateWorkspace, REAL_SHAPE } from "../workspace-fixture";

const PAGES: readonly MenuItemId[] = ["home", "notes", "links", "tasks", "tags", "settings"];

type RenderOptions = Parameters<typeof renderAppPage>[0];

function renderPage(page: MenuItemId, workspace: SutraPadWorkspace, resident: {
  noteSummaries: RenderOptions["noteSummaries"];
  taskIndex: RenderOptions["taskIndex"];
  linkIndex: RenderOptions["linkIndex"];
}): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  const noop = vi.fn();
  const callbacks = Object.fromEntries(
    [
      "onSignIn", "onLoadNotebook", "onSaveNotebook", "onRebuildIndex", "onSignOut", "onCopyBookmarklet",
      "onSelectNote", "onToggleTagFilter", "onClearTagFilters", "onChangeFilterMode", "onNewNote",
      "onChangeNotesView", "onRemoveSelectedFilter", "onTitleInput", "onBodyInput", "onAddTag", "onRemoveTag",
      "onBackToNotes", "onSelectMenuItem", "onToggleTask", "onChangeTheme", "onChangePersonaPreference",
      "onChangeCaptureLocationPreference", "onAllowLocationCapture", "onDenyLocationCapture", "onOpenPalette",
      "onApplyTagFilter", "onOpenCapture", "onChangeTasksFilter", "onToggleTasksShowDone", "onSetOneThing",
      "onChangeLinksView", "onToggleTagClass", "onChangeTagsSearchQuery", "onMergeTagAlias", "onDismissTagAlias",
      "onChangeLocale",
    ].map((name) => [name, noop]),
  );
  renderAppPage({
    root,
    workspace,
    ...resident,
    currentNoteId: workspace.notes[0].id,
    selectedTagFilters: [],
    filterMode: "any",
    note: workspace.notes[0],
    currentNote: workspace.notes[0],
    syncState: "idle",
    statusText: "",
    profile: null,
    appRootUrl: "https://notes.example.com/",
    bookmarkletMessage: "",
    iosShortcutUrl: "https://www.icloud.com/shortcuts/abc",
    buildStamp: "test",
    notesViewMode: "cards",
    activeMenuItem: page,
    detailNoteId: null,
    currentTheme: "sand",
    personaPreference: "off",
    captureLocationPreference: "on",
    locationConsentBlocked: false,
    recentTagFilters: [],
    tasksFilter: "all",
    tasksShowDone: false,
    tasksOneThingKey: null,
    linksViewMode: "cards",
    visibleTagClasses: new Set<string>(),
    tagsSearchQuery: "",
    dismissedTagAliases: new Set<string>(),
    rebuildStatus: { state: "idle" },
    diagnostics: createEmptyDiagnostics(),
    getLexiconStore: () => null,
    ...callbacks,
  } as unknown as RenderOptions);
  return root;
}

describe("render shape at 6 470 notes", () => {
  beforeEach(() => {
    // The og:image resolver would otherwise reach for the network per card.
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 204 })));
    resetListState();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetListState();
    document.body.innerHTML = "";
  });

  it("keeps every page under RENDER_MAX_ELEMENTS after a cold load (placeholders only)", () => {
    const full = generateWorkspace(REAL_SHAPE);
    const noteSummaries = full.notes.map((note) => ({ ...buildNoteSummary(note), fileId: "f" }));
    const workspace = { notes: noteSummaries.map((s) => buildPlaceholderNote(s)), activeNoteId: full.activeNoteId };
    const resident = { noteSummaries, taskIndex: buildTaskIndex(full), linkIndex: buildLinkIndex(full) };

    const sizes = Object.fromEntries(
      PAGES.map((page) => {
        const root = renderPage(page, workspace, resident);
        const count = root.querySelectorAll("*").length;
        root.remove();
        return [page, count];
      }),
    );
    for (const [page, count] of Object.entries(sizes)) {
      expect(count, `${page} renders ${count} elements`).toBeLessThanOrEqual(RENDER_MAX_ELEMENTS);
    }
  });
});
