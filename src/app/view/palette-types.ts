/**
 * Public shape of the palette wiring's external handle.
 *
 * `wirePaletteAccess` (in `app.ts`) returns one of these so the rest
 * of the app can call `open()` from the topbar trigger, `refresh(…)`
 * from the render path, and `dispose()` from HMR teardown without
 * having to know how the palette is mounted internally. The
 * interface lives in its own module so cross-cutting consumers
 * (state-store, lifecycle, render-callbacks) can import it without
 * pulling in `app.ts`.
 */
import type { SutraPadWorkspace } from "../../types";

export interface PaletteAccess {
  /** Opens the palette programmatically (click path — keydown handler uses the same closure). */
  open: () => void;
  /** Called from render() so the palette's visible list follows the workspace + filter state. */
  refresh: (workspace: SutraPadWorkspace, selectedTagFilters: readonly string[]) => void;
  /**
   * Tears down the global `/` keydown listener and closes any open
   * palette. Hooked up to `import.meta.hot?.dispose` so Vite's HMR
   * doesn't stack a second listener on every save.
   */
  dispose: () => void;
}
