/**
 * Global keyboard shortcuts (`N`, `G T/N/L/K`, `Esc` on detail).
 * Sibling of `wirePaletteAccess` — the `/` shortcut lives there
 * because it needs the palette handle. Kept at module scope so the
 * dispatch logic can be re-read without pulling `createApp` into
 * every context; the sequence-state reducer itself is already
 * exercised in `tests/keyboard-shortcuts.test.ts`.
 *
 * `goto` mirrors the topbar's `onSelectMenuItem` path (no-op if
 * already there, otherwise switch menu + clear detail + render) so
 * hitting `G N` while already on the notes *detail* route still
 * bounces back to the list — same affordance as clicking the Notes
 * tab.
 */
import {
  initialShortcutState,
  isEditingTarget,
  reduceShortcut,
  type ShortcutAction,
  type ShortcutState,
} from "../../lib/keyboard-shortcuts";
import type { MenuItemId } from "../logic/menu";

export interface WireKeyboardShortcutsOptions {
  getActiveMenuItem: () => MenuItemId;
  getDetailNoteId: () => string | null;
  setActiveMenuItem: (next: MenuItemId) => void;
  setDetailNoteId: (next: string | null) => void;
  handleNewNote: () => void;
  /**
   * Called before `G T/N/L/K` goto shortcuts and before `Esc` leaves
   * a detail route, so an untouched draft doesn't survive keyboard
   * nav the same way it wouldn't survive a click-based nav.
   */
  purgeEmptyDraftNotes: () => void;
  render: () => void;
}

export function wireKeyboardShortcuts(
  options: WireKeyboardShortcutsOptions,
): () => void {
  let state: ShortcutState = initialShortcutState;

  const dispatch = (action: ShortcutAction): void => {
    if (action.kind === "new-note") {
      options.handleNewNote();
      return;
    }
    if (action.kind === "goto") {
      if (
        options.getActiveMenuItem() === action.menu &&
        options.getDetailNoteId() === null
      ) {
        return;
      }
      options.purgeEmptyDraftNotes();
      options.setActiveMenuItem(action.menu);
      options.setDetailNoteId(null);
      options.render();
      return;
    }
    // action.kind === "escape" — only emitted when isDetailRoute was
    // true. Escape from a fresh "+ Add" / `N` draft that was never
    // typed into should dispose the draft rather than leave it
    // pinned to the notes list, so the purge runs here too.
    options.purgeEmptyDraftNotes();
    options.setDetailNoteId(null);
    options.render();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    const result = reduceShortcut(state, {
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      isEditingTarget: isEditingTarget(event.target),
      isDetailRoute:
        options.getActiveMenuItem() === "notes" &&
        options.getDetailNoteId() !== null,
      now: Date.now(),
    });
    state = result.state;
    if (result.preventDefault) event.preventDefault();
    if (result.action !== null) dispatch(result.action);
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
