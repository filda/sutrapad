/**
 * Endless-scroll growth trigger for the Notes list.
 *
 * A single window scroll listener: while the Notes page is active and the
 * viewport is within the prefetch margin of the bottom, it grows the visible
 * card limit (`growVisible`) and re-renders. The limit + reset logic live in
 * `logic/endless-scroll`; this is the thin DOM glue, mirroring the other
 * lifecycle installers. Returns a disposer so HMR / teardown can detach the
 * listener instead of stacking one per reload.
 */
import { growVisible, shouldGrow } from "../logic/endless-scroll";
import type { MenuItemId } from "../logic/menu";

/** Pages whose main list pages through `logic/endless-scroll`. */
function isPagedPage(item: MenuItemId): boolean {
  return item === "notes" || item === "links";
}

export interface NotesEndlessScrollOptions {
  readonly getActiveMenuItem: () => MenuItemId;
  readonly render: () => void;
}

export function installNotesEndlessScroll(
  options: NotesEndlessScrollOptions,
): () => void {
  const onScroll = (): void => {
    if (!isPagedPage(options.getActiveMenuItem())) return;
    const documentHeight = document.documentElement.scrollHeight;
    if (!shouldGrow(window.scrollY, window.innerHeight, documentHeight)) return;
    if (growVisible()) options.render();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll);
  };
}
