/**
 * Maintenance rebuild status (Phase 2 notes-scaling). Pure, DOM-free state
 * shape + formatter for the Settings page's "Rebuild index" action — kept
 * separate from the async orchestration in `app.ts` so the display text is
 * unit-testable without mocking Drive I/O.
 *
 * This is deliberately its own small piece of state rather than reusing the
 * existing `SyncState` (`"idle" | "loading" | "saving" | "error"`, see
 * `session/workspace-sync.ts`): that type drives the topbar sync-pill and a
 * rebuild is a much longer, rarer, Settings-page-local action with its own
 * wording ("this walks every note...") that doesn't belong in the pill's
 * fixed 4-state switch.
 */
import {
  catalogFor,
  formatPlural,
  getActiveLocale,
  type Locale,
} from "../../lib/i18n";

export type RebuildStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; noteCount: number }
  | { state: "error"; message: string };

export const IDLE_REBUILD_STATUS: RebuildStatus = { state: "idle" };

/**
 * Human-readable status line for the Backup card, or `null` when there's
 * nothing to show (idle — the common case, before the button's ever been
 * clicked this session).
 *
 * Takes the locale rather than a catalog: the done line is a counted message
 * and `Intl.PluralRules` needs the locale anyway, so deriving the catalog
 * from it here makes a mismatch — Czech text with English plural rules —
 * unrepresentable.
 */
export function describeRebuildStatus(
  status: RebuildStatus,
  locale: Locale = getActiveLocale(),
): string | null {
  const copy = catalogFor(locale).rebuild;
  switch (status.state) {
    case "idle":
      return null;
    case "running":
      return copy.running;
    case "done":
      return formatPlural(locale, status.noteCount, copy.done);
    case "error":
      return copy.error(status.message);
  }
}
