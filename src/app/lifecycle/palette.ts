/**
 * Palette wiring — the `/` global shortcut + the topbar "+ tag"
 * trigger feed into the same `mountPalette` flow. Keeps the keyboard
 * path and the click path sharing one open/close bookkeeping
 * (`handle` reference) so a parallel `isOpen` flag isn't needed.
 *
 * Lifted out of `app.ts` so the wiring layer there can stay small.
 * The function still takes its dependencies as a plain options bag —
 * `createApp` builds the bag from the state-store and the
 * `applyVisibleActiveNoteSelection` helper.
 */
import { isEditingTarget } from "../../lib/keyboard-shortcuts";
import { buildPaletteEntries, togglePaletteTagFilter } from "../logic/palette";
import type { MenuItemId } from "../logic/menu";
import { applyVisibleActiveNoteSelection, syncTagFiltersToLocation } from "../sync-helpers";
import { mountPalette, type PaletteHandle } from "../view/palette";
import type { PaletteAccess } from "../view/palette-types";
import type { SutraPadTagFilterMode, SutraPadWorkspace } from "../../types";

/**
 * Pages whose render honours `selectedTagFilters`. When a palette tag pick
 * happens on one of these, the user stays put and the filter just narrows
 * the page's content. Anywhere else (home, capture, settings, privacy, the
 * action-only `add` id) we fall back to routing to Notes — those surfaces
 * have nothing to filter and the filter would otherwise toggle invisibly.
 */
const FILTERABLE_MENU_ITEMS: ReadonlySet<MenuItemId> = new Set<MenuItemId>([
  "notes",
  "links",
  "tasks",
  "tags",
]);

export interface WirePaletteAccessOptions {
  host: HTMLElement;
  getWorkspace: () => SutraPadWorkspace;
  setWorkspace: (next: SutraPadWorkspace) => void;
  /**
   * Reads the currently active page so the tag-pick handler can decide
   * whether to keep the user on it (notes/links/tasks/tags all visualise
   * the filter) or route to Notes (everywhere else).
   */
  getActiveMenuItem: () => MenuItemId;
  setActiveMenuItem: (next: MenuItemId) => void;
  setDetailNoteId: (next: string | null) => void;
  getSelectedTagFilters: () => string[];
  setSelectedTagFilters: (next: string[]) => void;
  getFilterMode: () => SutraPadTagFilterMode;
  persistWorkspace: (workspace: SutraPadWorkspace) => void;
  /**
   * Called before the palette navigates away from the current view so an
   * untouched fresh draft doesn't linger in the workspace. Mirrors the
   * callback-level `purgeEmptyDraftNotes` used by `onSelectMenuItem` /
   * `onSelectNote` / `onBackToNotes` — the palette is just another nav
   * surface and needs the same sweep.
   */
  purgeEmptyDraftNotes: () => void;
  render: () => void;
}

/**
 * Attaches the global `/` shortcut (GitHub-style: active anywhere
 * outside an editable target) and wires the palette's entry
 * selections back into app state. Kept at module scope so the
 * keyboard + selection logic is unit-testable in isolation from the
 * rest of the app.
 *
 * Note picks jump to the detail editor and keep `activeNoteId` in
 * sync with what was chosen, matching a list click. Tag picks
 * *toggle* membership in the current filter set (cumulative),
 * matching how tag chips behave on the notes list and making the
 * per-row "Add" / "Remove" chip label literal.
 *
 * Returns an `open` opener so non-keyboard callers (the topbar's
 * tag-filter strip clicks into this) can share the same open/close
 * bookkeeping as the `/` keydown listener — no second `isOpen` flag,
 * no parallel teardown path. `dispose` removes the keydown listener
 * and destroys any open palette; HMR teardown invokes it so a stack
 * of stale listeners doesn't accumulate over reloads.
 */
export function wirePaletteAccess(options: WirePaletteAccessOptions): PaletteAccess {
  // Local handle + open flag let the topbar "+ tag" click and the
  // `/` keydown share the same bookkeeping without either side
  // having to know about the other. `refresh` pushes the latest
  // workspace + filters into the mounted palette (called by
  // render()); `open` mounts a fresh one if none is currently open.
  let handle: PaletteHandle | null = null;
  const open = (): void => {
    if (handle !== null) return;
    handle = mountPalette({
      host: options.host,
      groups: buildPaletteEntries(options.getWorkspace()),
      selectedTagFilters: options.getSelectedTagFilters(),
      onSelectEntry: (entry) => {
        handle = null;
        // The palette is a navigation surface — sweep any dangling
        // draft before leaving the current view so it isn't left
        // behind when the user jumps to a different note or applies
        // a tag filter.
        options.purgeEmptyDraftNotes();
        if (entry.payload.kind === "note") {
          const nextWorkspace: SutraPadWorkspace = {
            ...options.getWorkspace(),
            activeNoteId: entry.payload.noteId,
          };
          options.setWorkspace(nextWorkspace);
          options.persistWorkspace(nextWorkspace);
          options.setActiveMenuItem("notes");
          options.setDetailNoteId(entry.payload.noteId);
          options.render();
          return;
        }
        // Stay on the current page when it already visualises the
        // filter (notes/links/tasks/tags). On Notes specifically we
        // also clear the detail pin so the user lands on the list —
        // the detail editor doesn't surface the active filter set, so
        // applying one there would feel like nothing happened. From
        // any non-filterable surface (home / capture / settings /
        // privacy) we fall back to routing into Notes so the toggle
        // doesn't fire invisibly. The toggle itself mirrors the
        // notes-page chip-click path (persist + URL + visible-active-
        // note reconciliation) regardless of where we landed.
        const currentMenuItem = options.getActiveMenuItem();
        if (FILTERABLE_MENU_ITEMS.has(currentMenuItem)) {
          if (currentMenuItem === "notes") options.setDetailNoteId(null);
        } else {
          options.setActiveMenuItem("notes");
          options.setDetailNoteId(null);
        }
        const nextFilters = togglePaletteTagFilter(
          options.getSelectedTagFilters(),
          entry.payload.tag,
        );
        options.setSelectedTagFilters(nextFilters);
        options.setWorkspace(
          applyVisibleActiveNoteSelection(
            options.getWorkspace(),
            nextFilters,
            options.getFilterMode(),
            options.persistWorkspace,
          ),
        );
        syncTagFiltersToLocation(nextFilters);
        options.render();
      },
      onClose: () => {
        handle = null;
      },
    });
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "/") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditingTarget(event.target)) return;
    event.preventDefault();
    open();
  };
  window.addEventListener("keydown", onKeydown);

  return {
    open,
    refresh: (workspace, selectedTagFilters) => {
      handle?.update(buildPaletteEntries(workspace), selectedTagFilters);
    },
    dispose: (): void => {
      // HMR re-runs `createApp` against the same `window`. Without
      // tearing down listeners on the previous instance, every save
      // adds another `keydown` handler — `/` would open N palettes
      // in a row after a few hot reloads.
      window.removeEventListener("keydown", onKeydown);
      handle?.destroy();
      handle = null;
    },
  };
}
