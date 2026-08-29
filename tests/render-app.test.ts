// @vitest-environment happy-dom
//
// Focused test for `src/app/view/render-app.ts` — the last module brought
// into the mutation scope, and the one the config note had been warning
// about: "largest untested surface; decision-heavy logic should move out
// first."
//
// On reading it, that turned out to describe a **router**, not a god
// function. Twelve branches on `activeMenuItem`, each delegating to a page
// builder that already has its own suite, plus four derivations at the top
// and a `finalize()` tail. The derivations *were* the decision-heavy part,
// and they have since moved to `logic/render-derivations` (with their own
// suite) — **this file did not change across that extraction**, which is what
// proved the move behaviour-preserving. That was the point of writing it this
// way: it asserts only what `renderAppPage` itself decides, through the
// public entry point, never an internal.
//
//   - **which page is mounted, and its wrapper class.** `page--wide` is on
//     five routes and off the other seven; getting it wrong reflows the
//     whole column. The `else` arm (an unknown id → placeholder) is the one
//     no user ever reaches and the one a routing mutant lands in.
//   - **the append order.** topbar → mobile tabbar → page → FAB, with the
//     footer inside the page. It is not cosmetic: the topbar is a direct
//     child of the root so `position: sticky` pins to the viewport rather
//     than the page column, the tabbar is a sibling of `.page` for the same
//     reason, and the FAB is last so it paints above content without a
//     z-index war. Each is a comment in the source and none was asserted.
//   - **`root.innerHTML = ""` first.** Every render is a full rebuild; a
//     mutant that drops it doubles the whole app on the second pass.
//   - **the derivations, through their effects.** `personaOptions` (opt-in
//     *and* a resolved dark/light answer), `autoTagLookup` (auto tags only,
//     shared by the topbar and the editor), `availableTagSuggestions` (user
//     tags only — auto tags must not reach the typeahead), and `topbarNote` /
//     `syncCrumb`, whose three states the crumb makes visible. The functions
//     themselves are unit-tested in `tests/render-derivations.test.ts`; what
//     is asserted here is that the router still calls them and threads the
//     results to the right surfaces.
//   - **the detail route's own layout**: the hero only when there is a note,
//     the sidebar suppressed on a filter miss, and the consent card's
//     three-way state.
//
// Nothing is mocked. Every collaborator is real and already measured, and the
// assertions are all "which class / which element", so the suite reads the
// same way the router does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderAppPage } from "../src/app/view/render-app";
import { buildLinkIndex } from "../src/lib/notebook";
import { buildNoteSummary } from "../src/lib/note-card-meta";
import { buildTaskIndex } from "../src/lib/tasks";
import type { MenuItemId } from "../src/app/logic/menu";
import { addDismissedTagAlias } from "../src/app/logic/tag-aliases";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

const note = (overrides: Partial<SutraPadDocument> = {}): SutraPadDocument => ({
  id: "n-1",
  title: "První",
  body: "tělo poznámky",
  urls: [],
  createdAt: "2026-04-21T08:00:00.000Z",
  updatedAt: "2026-04-21T08:00:00.000Z",
  tags: ["praha"],
  ...overrides,
});

/** A notebook whose note carries a URL, so the Links page has a row to click. */
const LINKED_WORKSPACE: SutraPadWorkspace = {
  notes: [
    note({
      id: "n-3",
      title: "Článek",
      body: "https://example.com/clanek",
      urls: ["https://example.com/clanek"],
    }),
  ],
  activeNoteId: "n-3",
};

const WORKSPACE: SutraPadWorkspace = {
  notes: [note(), note({ id: "n-2", title: "Druhá", tags: ["cesty"] })],
  activeNoteId: "n-1",
};

type Options = Parameters<typeof renderAppPage>[0];

function render(overrides: Partial<Options> = {}) {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const spies = {
    onSignIn: vi.fn(),
    onLoadNotebook: vi.fn(),
    onSaveNotebook: vi.fn(),
    onRebuildIndex: vi.fn(),
    onSignOut: vi.fn(),
    onCopyBookmarklet: vi.fn(),
    onSelectNote: vi.fn(),
    onToggleTagFilter: vi.fn(),
    onClearTagFilters: vi.fn(),
    onChangeFilterMode: vi.fn(),
    onNewNote: vi.fn(),
    onChangeNotesView: vi.fn(),
    onRemoveSelectedFilter: vi.fn(),
    onTitleInput: vi.fn(),
    onBodyInput: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onBackToNotes: vi.fn(),
    onSelectMenuItem: vi.fn(),
    onToggleTask: vi.fn(),
    onChangeTheme: vi.fn(),
    onChangePersonaPreference: vi.fn(),
    onChangeCaptureLocationPreference: vi.fn(),
    onAllowLocationCapture: vi.fn(),
    onDenyLocationCapture: vi.fn(),
    onOpenPalette: vi.fn(),
    onApplyTagFilter: vi.fn(),
    onOpenCapture: vi.fn(),
    onChangeTasksFilter: vi.fn(),
    onToggleTasksShowDone: vi.fn(),
    onSetOneThing: vi.fn(),
    onChangeLinksView: vi.fn(),
    onToggleTagClass: vi.fn(),
    onChangeTagsSearchQuery: vi.fn(),
    onMergeTagAlias: vi.fn(),
    onDismissTagAlias: vi.fn(),
  };
  const workspace = (overrides.workspace ?? WORKSPACE) as SutraPadWorkspace;
  renderAppPage({
    root,
    workspace,
    noteSummaries: workspace.notes.map((entry) => buildNoteSummary(entry)),
    taskIndex: buildTaskIndex(workspace),
    linkIndex: buildLinkIndex(workspace),
    currentNoteId: "n-1",
    selectedTagFilters: [],
    filterMode: "any",
    note: workspace.notes[0] ?? null,
    currentNote: workspace.notes[0] ?? note(),
    syncState: "idle",
    statusText: "All changes saved",
    profile: null,
    appRootUrl: "https://notes.example.com/",
    bookmarkletMessage: "",
    iosShortcutUrl: "https://www.icloud.com/shortcuts/abc",
    buildStamp: "v0.3.0 • abc1234",
    notesViewMode: "cards",
    activeMenuItem: "notes",
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
    rebuildStatus: { kind: "idle" },
    getLexiconStore: () => null,
    ...spies,
    ...overrides,
  } as Options);
  return { root, ...spies };
}

/** Class names of the root's direct children, in append order. */
const rootShape = (root: HTMLElement): string[] =>
  [...root.children].map((child) => child.className);

const page = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>("main.page");

/** The persona paper colour applied to the first note card, or "" when off. */
const paperOf = (root: HTMLElement): string =>
  root
    .querySelector<HTMLElement>(".notes-list .note-list-item")
    ?.style.getPropertyValue("--nc-bg") ?? "";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("renderAppPage frame", () => {
  it("lays the chrome out around the page in paint order", () => {
    // topbar sticks to the viewport, the tabbar is fixed to it, and the FAB
    // paints above everything — all three depend on being direct children of
    // the root rather than of `.page`.
    const { root } = render();

    expect(rootShape(root)).toEqual([
      "topbar",
      "mobile-tabbar",
      "page page--wide",
      "app-fab",
    ]);
  });

  it("puts the footer inside the page, last", () => {
    const { root } = render();

    expect([...(page(root)?.children ?? [])].at(-1)?.className).toBe("site-footer");
  });

  it("wipes the root before every render", () => {
    // Without this the second pass appends a second copy of the whole app.
    const { root } = render();
    const first = page(root);

    renderAppPageAgain(root);

    expect(root.querySelectorAll("main.page")).toHaveLength(1);
    expect(page(root)).not.toBe(first);
    // Wiped, not replaced with something: the root holds only the four
    // chrome elements, with no stray text node in front of them.
    expect([...root.childNodes].every((child) => child instanceof HTMLElement)).toBe(true);
    expect(root.children).toHaveLength(4);
  });

  it("flags the detail route on the root element", () => {
    // The class is what switches the app grid into the two-column detail
    // layout; the topbar reads it for its condensed variant.
    const list = render().root;
    expect(list.classList.contains("app--note-detail")).toBe(false);

    const detail = render({ activeMenuItem: "notes", detailNoteId: "n-1" }).root;
    expect(detail.classList.contains("app--note-detail")).toBe(true);
  });

  it("needs both halves of the detail route, not just a lingering note id", () => {
    // `activeMenuItem === "notes" && detailNoteId !== null`. A stale
    // `detailNoteId` left over from the editor must not put the Tags page
    // into the two-column detail layout on the way out of a note.
    const { root } = render({ activeMenuItem: "tags", detailNoteId: "n-1" });

    expect(root.classList.contains("app--note-detail")).toBe(false);
    expect(page(root)?.querySelector(".tags-page")).not.toBeNull();
  });

  it("clears the detail flag again on the way back to a list", () => {
    // `classList.toggle` with an explicit second argument, not a bare
    // toggle — a bare one would flip the class on every render.
    const { root } = render({ activeMenuItem: "notes", detailNoteId: "n-1" });
    expect(root.classList.contains("app--note-detail")).toBe(true);

    renderAppPageAgain(root);

    expect(root.classList.contains("app--note-detail")).toBe(false);
  });
});

/** Re-renders the same root on the plain notes list, for idempotence checks. */
function renderAppPageAgain(root: HTMLElement): void {
  render({ root, activeMenuItem: "notes", detailNoteId: null });
}

describe("renderAppPage routing", () => {
  it("mounts each menu id on its own page", () => {
    const routed = (
      [
        "home",
        "notes",
        "tags",
        "links",
        "tasks",
        "capture",
        "settings",
        "privacy",
        "about",
        "terms",
        "shortcuts",
        "lexicon",
      ] as const
    ).map((activeMenuItem) => {
      document.body.innerHTML = "";
      const { root } = render({ activeMenuItem });
      const mounted = [...(page(root)?.children ?? [])][0];
      return `${activeMenuItem} → ${mounted?.className}`;
    });

    expect(routed).toEqual([
      "home → home-page",
      "notes → notes-panel",
      "tags → tags-page",
      "links → links-page",
      "tasks → tasks-page",
      "capture → capture-page",
      "settings → settings-page",
      "privacy → static-page",
      "about → static-page",
      "terms → static-page",
      "shortcuts → static-page",
      "lexicon → lexicon-page",
    ]);
  });

  it("widens the column only for the list-shaped pages", () => {
    // Long-form and single-purpose pages keep the reading measure; grids of
    // cards get the wide column.
    const widths = (
      [
        "home",
        "notes",
        "tags",
        "links",
        "tasks",
        "capture",
        "settings",
        "privacy",
        "about",
        "terms",
        "shortcuts",
        "lexicon",
      ] as const
    ).map((activeMenuItem) => {
      document.body.innerHTML = "";
      const { root } = render({ activeMenuItem });
      return `${activeMenuItem}: ${page(root)?.className}`;
    });

    expect(widths).toEqual([
      "home: page page--wide",
      "notes: page page--wide",
      "tags: page page--wide",
      "links: page page--wide",
      "tasks: page page--wide",
      "capture: page",
      "settings: page",
      "privacy: page",
      "about: page",
      "terms: page",
      "shortcuts: page",
      "lexicon: page",
    ]);
  });

  it("falls back to the placeholder for an id it does not know", () => {
    // The `else` arm. Unreachable through the UI, which is exactly why a
    // routing mutant can land here unnoticed.
    const { root } = render({ activeMenuItem: "nonsense" as MenuItemId });

    expect(page(root)?.querySelector(".page-placeholder")).not.toBeNull();
  });

  it("still frames an unknown route with the full chrome", () => {
    const { root } = render({ activeMenuItem: "nonsense" as MenuItemId });

    expect(rootShape(root)).toEqual(["topbar", "mobile-tabbar", "page", "app-fab"]);
  });

  it("opens a note from a list page through the shared callback", () => {
    // Every non-notes page routes through one `openNoteInEditor` wrapper,
    // which delegates to `onSelectNote` (that switches to the notes route
    // and opens the detail). A wrapper that swallowed the id would leave
    // every card on Links / Tasks / Tags inert.
    const { root, onSelectNote } = render({
      activeMenuItem: "links",
      workspace: LINKED_WORKSPACE,
    });
    const card = root.querySelector<HTMLElement>(".links-page .entity-card");

    expect(card).not.toBeNull();
    card?.click();

    expect(onSelectNote).toHaveBeenCalledExactlyOnceWith("n-3");
  });
});

describe("renderAppPage derivations", () => {
  it("keeps auto tags out of the topbar typeahead", () => {
    // `availableTagSuggestions` comes from `buildTagIndex` (user tags only).
    // Auto tags are namespaced `facet:value` and belong to the Tags page and
    // the palette, not the filter dropdown.
    const { root } = render();
    const input = root.querySelector<HTMLInputElement>(".tfb-input");
    input?.focus();
    if (input) input.value = "";
    input?.dispatchEvent(new Event("input", { bubbles: true }));

    const suggested = [...root.querySelectorAll(".tfb-suggest .tfb-name")].map(
      (node) => node.textContent,
    );
    expect(suggested.length > 0).toBe(true);
    expect(suggested.every((tag) => !(tag ?? "").includes(":"))).toBe(true);
    expect(suggested).toContain("praha");
  });

  it("hands the topbar the auto-tag lookup so chips can be styled", () => {
    // The same Set is shared with the editor — built once per render pass.
    // A chip for an auto tag renders in the auto style.
    const { root } = render({ selectedTagFilters: ["year:2026"] });
    const chip = root.querySelector(".tfb-chips .tag-pill");

    expect(chip?.classList.contains("auto")).toBe(true);
  });

  it("styles a user filter chip as a user tag", () => {
    const { root } = render({ selectedTagFilters: ["praha"] });
    const chip = root.querySelector(".tfb-chips .tag-pill");

    expect(chip?.classList.contains("auto")).toBe(false);
  });

  it("leaves persona decoration off unless the user opted in", () => {
    // `personaOptions` stays `undefined`, and the list renders flat cards.
    const { root } = render({ activeMenuItem: "notes", personaPreference: "off" });

    expect(root.querySelector(".notes-list")?.className).not.toContain("persona");
    expect(paperOf(root)).toBe("");
  });

  it("turns persona decoration on for the opted-in user", () => {
    const { root } = render({ activeMenuItem: "notes", personaPreference: "on" });

    expect(root.querySelector(".notes-list")?.className).toContain("notes-list--persona");
    expect(paperOf(root)).not.toBe("");
  });

  it("resolves the theme to a concrete light or dark for the paper palette", () => {
    // `resolveThemeId` runs here so an `auto` session that flips light/dark
    // re-papers the cards on the next render without a reload. The two
    // palettes must therefore disagree.
    const light = paperOf(render({ personaPreference: "on", currentTheme: "sand" }).root);
    document.body.innerHTML = "";
    const dark = paperOf(render({ personaPreference: "on", currentTheme: "midnight" }).root);

    expect(light).not.toBe("");
    expect(dark).not.toBe("");
    expect(dark).not.toBe(light);
  });
});

describe("renderAppPage note detail route", () => {
  const detail = (overrides: Partial<Options> = {}) =>
    render({ activeMenuItem: "notes", detailNoteId: "n-1", ...overrides });

  it("builds the detail shell instead of the notes list", () => {
    const { root } = detail();

    expect(page(root)?.className).toBe("page page--note-detail");
    expect(root.querySelector(".notes-panel")).toBeNull();
    expect(root.querySelector(".note-detail-shell")).not.toBeNull();
  });

  it("puts the hero above the shell and the editor inside it", () => {
    const { root } = detail();

    expect([...(page(root)?.children ?? [])].map((child) => child.className)).toEqual([
      expect.stringContaining("note-detail-hero"),
      "note-detail-shell",
      "site-footer",
    ]);
    expect(root.querySelector(".note-detail-shell .editor-stage .editor-card")).not.toBeNull();
  });

  it("edits the title from the hero, pinned to the note it was mounted for", () => {
    const { root, onTitleInput } = detail();
    const title = root.querySelector<HTMLTextAreaElement>(".note-detail-hero-title");

    expect(title?.value).toBe("První");
    expect(title?.placeholder).toBe("Note title");
    if (title) title.value = "Nový titulek";
    title?.dispatchEvent(new Event("input", { bubbles: true }));

    // The id is threaded so a render that detaches this textarea cannot
    // route the trailing keystroke onto a different note.
    expect(onTitleInput).toHaveBeenCalledWith("Nový titulek", "n-1");
  });

  it("keeps the title semantically single-line", () => {
    // A textarea so long titles wrap visually; newlines are collapsed on
    // input and Enter is blocked outright so the caret stays put.
    //
    // NB both mutants of the `includes("\n")` guard are equivalent: the
    // `replaceAll(/\n+/gu, " ")` it protects is a no-op on a value with no
    // newline, so `→ true` and `→ includes("")` produce identical output.
    // The guard is a cheap skip, not a branch.
    const { root, onTitleInput } = detail();
    const title = root.querySelector<HTMLTextAreaElement>(".note-detail-hero-title");

    if (title) title.value = "Dva\n\nřádky";
    title?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(title?.value).toBe("Dva řádky");
    expect(onTitleInput).toHaveBeenCalledWith("Dva řádky", "n-1");

    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true, bubbles: true });
    title?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });

  it("lets other keys through", () => {
    const { root } = detail();
    const title = root.querySelector<HTMLTextAreaElement>(".note-detail-hero-title");

    const key = new KeyboardEvent("keydown", { key: "a", cancelable: true, bubbles: true });
    title?.dispatchEvent(key);

    expect(key.defaultPrevented).toBe(false);
  });

  it("drops the hero when a filter matched nothing", () => {
    // No note means no title to edit and no thumbnail to draw; the editor
    // card renders its own empty state instead.
    const { root } = detail({ note: null, selectedTagFilters: ["nic"] });

    expect(root.querySelector(".note-detail-hero")).toBeNull();
    expect(root.querySelector(".note-detail-shell")).not.toBeNull();
  });

  it("suppresses the sidebar on a filter miss and marks the stage solo", () => {
    // The sidebar would show tag UI for an unrelated note.
    const { root } = detail({ note: null, selectedTagFilters: ["nic"] });

    expect(root.querySelector(".editor-sidebar")).toBeNull();
    expect(root.querySelector(".editor-stage")?.className).toBe("editor-stage editor-stage-solo");
  });

  it("keeps the sidebar when a filter is active and a note still matched", () => {
    // `!(note === null && filters.length > 0)` — both halves. A live filter
    // on its own is not a reason to drop the tag rail; only a filter that
    // matched *nothing* is, because then the rail would show tag UI for an
    // unrelated note.
    const { root } = detail({ selectedTagFilters: ["praha"] });

    expect(root.querySelector(".editor-sidebar")).not.toBeNull();
    expect(root.querySelector(".editor-stage")?.className).toBe("editor-stage");
  });

  it("keeps the sidebar when there is simply no active note and no filter", () => {
    // Both halves of `!(note === null && filters.length > 0)`: a null note
    // without a filter still gets the sidebar, off `currentNote`.
    const { root } = detail({ note: null, selectedTagFilters: [] });

    expect(root.querySelector(".editor-sidebar")).not.toBeNull();
    expect(root.querySelector(".editor-stage")?.className).toBe("editor-stage");
  });

  it("stamps the last-change crumb into the detail topbar", () => {
    const { root } = detail();

    expect(root.querySelector(".detail-topbar")?.textContent).toContain("local");
  });

  it("drops the crumb when a filter matched nothing", () => {
    // `topbarNote` resolves to null there, and a last-edit time for some
    // other note would be a lie.
    const { root } = detail({ note: null, selectedTagFilters: ["nic"] });

    expect(root.querySelector(".detail-topbar")?.textContent).not.toContain("local");
  });

  it("says synced for a signed-in user and local for a drafter", () => {
    // `{ signedIn: profile !== null }` is the only thing that picks the
    // wording; a signed-out drafter's notes never left the device, so
    // "synced" would be a lie.
    const anonymous = detail().root.querySelector(".detail-topbar")?.textContent;
    document.body.innerHTML = "";
    const signedIn = detail({
      profile: { name: "Filip", email: "f@example.com", picture: "" },
    }).root.querySelector(".detail-topbar")?.textContent;

    expect(anonymous).toContain("local");
    expect(signedIn).toContain("synced");
    expect(signedIn).not.toContain("local");
  });

  it("keeps the detail page flat while the cards stay tilted", () => {
    // `{ rotationFactor: 0 }` — the persona rotation is charming on a grid
    // of cards and unreadable on a full-page writing surface.
    const { root } = detail({ personaPreference: "on" });
    const detailPage = page(root);

    expect(detailPage?.classList.contains("page--notebook-persona")).toBe(true);
    expect(detailPage?.style.getPropertyValue("--nc-rotation")).toBe("0deg");
    expect(detailPage?.style.getPropertyValue("--nc-bg")).not.toBe("");
  });

  it("papers the detail page from the resolved theme and the whole population", () => {
    // `deriveNotebookPersona(note, { allNotes, dark })` — dropping either
    // half changes the paper it picks.
    const light = detail({ personaPreference: "on", currentTheme: "sand" }).root;
    const lightPaper = page(light)?.style.getPropertyValue("--nc-bg");
    document.body.innerHTML = "";
    const dark = detail({ personaPreference: "on", currentTheme: "midnight" }).root;
    const darkPaper = page(dark)?.style.getPropertyValue("--nc-bg");

    expect(lightPaper).not.toBe("");
    expect(darkPaper).not.toBe(lightPaper);
  });

  it("leaves persona off the detail page for the opted-out user", () => {
    const { root } = detail({ personaPreference: "off" });

    expect(page(root)?.classList.contains("page--notebook-persona")).toBe(false);
  });

  it("gives the editor card no title field of its own", () => {
    // The hero owns the title. Two inputs bound to one value was the shape
    // an earlier experiment produced and this flag exists to prevent.
    const { root } = detail();

    expect(root.querySelectorAll(".note-detail-hero-title")).toHaveLength(1);
    expect(root.querySelector(".editor-card .editor-title")).toBeNull();
  });

  it("draws the hero from the note's own primary URL", () => {
    // `deriveNotePrimaryUrl(note)` picks the banner's subject; the domain
    // chip is the visible proof it looked at this note and not at nothing.
    //
    // NB the sibling `notes: [note]` argument on the same call feeds the
    // og-image resolver, and its `→ []` mutant is not observable here: the
    // resolved image is applied behind an `Image()` preload that never
    // fires in happy-dom. Recorded as environment-equivalent rather than
    // chased with a fake image loader.
    const withLink = render({
      activeMenuItem: "notes",
      detailNoteId: "n-3",
      workspace: LINKED_WORKSPACE,
      note: LINKED_WORKSPACE.notes[0] ?? null,
      currentNote: LINKED_WORKSPACE.notes[0] ?? note(),
      currentNoteId: "n-3",
    });
    const hero = withLink.root.querySelector<HTMLElement>(".note-detail-hero");

    expect(hero?.querySelector(".link-thumb-domain")?.textContent).toBe("example.com");
  });

  it("falls back to the current note when there is no match and no filter", () => {
    // The third state of `note ?? (filters.length > 0 ? null : currentNote)`.
    const { root } = detail({ note: null, selectedTagFilters: [] });

    expect(root.querySelector(".note-detail-hero-title")).not.toBeNull();
  });
});

describe("renderAppPage location consent card", () => {
  const detail = (overrides: Partial<Options> = {}) =>
    render({ activeMenuItem: "notes", detailNoteId: "n-1", ...overrides });

  it("asks once while the user has not decided", () => {
    const { root } = detail({ captureLocationPreference: "unanswered" });

    expect(root.querySelector(".location-consent-card")).not.toBeNull();
  });

  it("stays out of the way once the user has decided either way", () => {
    // Settings is the surface for changing an explicit decision.
    for (const captureLocationPreference of ["on", "off"] as const) {
      document.body.innerHTML = "";
      const { root } = detail({ captureLocationPreference });
      expect(root.querySelector(".location-consent-card")).toBeNull();
    }
  });

  it("shows the blocked panel whatever the preference says", () => {
    // The blocked flag wins the precedence test — the browser is refusing
    // regardless of what the user chose.
    const { root } = detail({
      captureLocationPreference: "on",
      locationConsentBlocked: true,
    });
    const card = root.querySelector(".location-consent-card");

    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("blocking");
  });

  it("sits above the editor inside the same column", () => {
    // Part of the writing surface, not chrome.
    const { root } = detail({ captureLocationPreference: "unanswered" });

    expect([...(root.querySelector(".editor-stage")?.children ?? [])].map((c) => c.className)).toEqual(
      [
        expect.stringContaining("location-consent-card"),
        expect.stringContaining("editor-card"),
        "editor-sidebar",
      ],
    );
  });

  it("routes its buttons to the caller", () => {
    const { root, onAllowLocationCapture, onDenyLocationCapture } = detail({
      captureLocationPreference: "unanswered",
    });
    const buttons = [
      ...root.querySelectorAll<HTMLButtonElement>(".location-consent-card button"),
    ];

    for (const button of buttons) button.click();

    expect(
      onAllowLocationCapture.mock.calls.length + onDenyLocationCapture.mock.calls.length > 0,
    ).toBe(true);
  });
});

describe("renderAppPage home hints", () => {
  // The three hint callbacks are built inline in `renderAppPage` and are the
  // only wiring between a hint's CTA and the router. `() => undefined` type-
  // checks fine, so the button would render and do nothing.
  const PROFILE = { name: "Filip", email: "f@example.com", picture: "" };

  const home = (overrides: Partial<Options> = {}) =>
    render({ activeMenuItem: "home", profile: PROFILE, ...overrides });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("routes the capture hint's CTA to the capture page", () => {
    // Signed in with nothing ever captured externally — the highest-priority
    // onboarding hint.
    const { root, onSelectMenuItem } = home();

    expect(root.querySelector(".hint-banner")).not.toBeNull();
    root.querySelector<HTMLButtonElement>(".hint-banner-cta")?.click();

    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("capture");
  });

  it("routes the tag-hygiene hint's CTA to Settings", () => {
    // Four notes, two spellings of the same tag twice each — the alias
    // engine needs count >= 2 per spelling. Capture is already installed so
    // the higher-priority hint stays out of the way.
    const captured = { source: "url-capture" } as SutraPadDocument["captureContext"];
    const workspace: SutraPadWorkspace = {
      notes: [
        note({ id: "a1", tags: ["praha"], captureContext: captured }),
        note({ id: "a2", tags: ["praha"] }),
        note({ id: "a3", tags: ["Praha"] }),
        note({ id: "a4", tags: ["Praha"] }),
      ],
      activeNoteId: "a1",
    };
    const { root, onSelectMenuItem } = home({ workspace });

    expect(root.querySelector(".hint-banner")?.textContent).toContain("Tags");
    root.querySelector<HTMLButtonElement>(".hint-banner-cta")?.click();

    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("settings");
  });

  it("routes the focus hint's CTA to Tasks", () => {
    const captured = { source: "url-capture" } as SutraPadDocument["captureContext"];
    const workspace: SutraPadWorkspace = {
      notes: [
        note({
          id: "t1",
          tags: [],
          captureContext: captured,
          body: "- [ ] jedna\n- [ ] dva\n- [ ] tri",
        }),
      ],
      activeNoteId: "t1",
    };
    const { root, onSelectMenuItem } = home({ workspace });

    expect(root.querySelector(".hint-banner")?.textContent).toContain("Today");
    root.querySelector<HTMLButtonElement>(".hint-banner-cta")?.click();

    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("tasks");
  });
});

describe("renderAppPage settings", () => {
  it("hides an alias pair the user already dismissed", () => {
    // The `{ dismissed }` option is threaded on every Settings render so a
    // "keep separate" decision sticks without an invalidate step.
    const workspace: SutraPadWorkspace = {
      notes: [
        note({ id: "a1", tags: ["praha"] }),
        note({ id: "a2", tags: ["praha"] }),
        note({ id: "a3", tags: ["Praha"] }),
        note({ id: "a4", tags: ["Praha"] }),
      ],
      activeNoteId: "a1",
    };
    const shown = render({ activeMenuItem: "settings", workspace }).root;
    expect(shown.querySelectorAll(".hygiene-alias-list").length).toBeGreaterThan(0);

    document.body.innerHTML = "";
    const hidden = render({
      activeMenuItem: "settings",
      workspace,
      dismissedTagAliases: addDismissedTagAlias(new Set<string>(), "praha", "Praha"),
    }).root;

    // The pair is gone, not merely greyed out — a "keep separate" decision
    // has to survive every later Settings render without an invalidate step.
    expect(hidden.querySelectorAll(".hygiene-alias-list")).toHaveLength(0);
  });
});
