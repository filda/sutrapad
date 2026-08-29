/**
 * The four value derivations `renderAppPage` performs before it routes.
 *
 * Extracted 2026-08-29. `render-app.ts` carried a note for months saying
 * "decision-heavy logic should move out first"; measuring it showed the file
 * is a *router* (twelve branches delegating to page builders that each have
 * their own suite) with these four computations bolted to the top. They are
 * the only part of it that decides anything about *values* rather than about
 * which builder to call, and they are pure — so they belong here, beside the
 * rest of `app/logic`, where they can be reasoned about without a DOM.
 *
 * The router keeps calling all four in the same order it always did; nothing
 * about the rendered output changed. `tests/render-app.test.ts` was written
 * through the public entry point precisely so it could prove that: it passed
 * unchanged across this move.
 *
 * `availableTagSuggestions` deliberately did *not* move — it is a bare
 * `buildTagIndex(workspace).tags` at both call sites, and wrapping a single
 * property read in a named function would be ceremony, not clarity.
 */

import { buildCombinedTagIndex } from "../../lib/notebook";
import { buildTaskFacetByNoteId } from "../../lib/tasks";
import { documentFromSummary } from "../../lib/note-card-meta";
import type {
  SutraPadDocument,
  SutraPadNoteSummary,
  SutraPadTaskIndex,
  SutraPadWorkspace,
  UserProfile,
} from "../../types";
import { formatLastChange } from "./editor-sync-crumb";
import { isPersonaEnabled, type PersonaPreference } from "./persona";
import { isDarkThemeId, resolveThemeId, type ThemeChoice } from "./theme";

/**
 * Persona decoration inputs, or `undefined` to render flat cards. Structurally
 * `NotesListPersonaOptions` from the view layer; declared here so this module
 * stays free of any `view/` import.
 */
export interface RenderPersonaOptions {
  allNotes: readonly SutraPadDocument[];
  dark: boolean;
}

export interface PersonaOptionsInput {
  personaPreference: PersonaPreference;
  currentTheme: ThemeChoice;
  noteSummaries: readonly SutraPadNoteSummary[];
}

/**
 * Persona decoration runs only when the user opted in **and** we have a
 * concrete dark/light answer to feed the paper-palette chooser.
 *
 * `auto` resolves here rather than at preference-write time, so a system
 * light/dark switch during a session flips the card paper variants on the
 * next re-render without a reload.
 *
 * The population comes from the resident summaries, not the note bodies:
 * recurrence stickers (`regular` / `first-of-kind`) read only tags plus the
 * place/source facets, so body-less documents rebuilt from summaries drive
 * them identically — and keep working once `loadWorkspace` stops holding note
 * bodies at all (Phase 2 step 3e).
 */
export function deriveRenderPersonaOptions({
  personaPreference,
  currentTheme,
  noteSummaries,
}: PersonaOptionsInput): RenderPersonaOptions | undefined {
  if (!isPersonaEnabled(personaPreference)) return undefined;
  return {
    allNotes: noteSummaries.map((summary) => documentFromSummary(summary)),
    dark: isDarkThemeId(resolveThemeId(currentTheme)),
  };
}

/**
 * The set of auto-tags present anywhere in the workspace, used to style a tag
 * chip as derived rather than user-authored.
 *
 * Built once per render pass and handed to both the topbar filter strip and
 * the editor card — they must agree, or the same tag renders in two different
 * styles on one screen.
 *
 * `buildTaskFacetByNoteId` corrects the `tasks:*` facet for placeholder notes
 * (Phase 2 notes-scaling): it is the one facet that needs a note's body, and a
 * not-yet-hydrated note does not have one. See that function's doc.
 */
export function buildAutoTagLookup(
  workspace: SutraPadWorkspace,
  taskIndex: SutraPadTaskIndex,
  now: Date = new Date(),
): ReadonlySet<string> {
  const combined = buildCombinedTagIndex(
    workspace,
    now,
    undefined,
    buildTaskFacetByNoteId(taskIndex),
  );
  return new Set(
    combined.tags.filter((entry) => entry.kind === "auto").map((entry) => entry.tag),
  );
}

export interface TopbarNoteInput {
  /** The note matching the current filters, or null when nothing matched. */
  note: SutraPadDocument | null;
  /** The workspace's active note, regardless of filters. */
  currentNote: SutraPadDocument;
  selectedTagFilters: readonly string[];
}

/**
 * Which note the detail-topbar describes.
 *
 * Three states, and the middle one is the reason this is not just `note ??
 * currentNote`:
 *
 *   - a note matched → that note;
 *   - nothing matched **and a filter is active** → null. There is no single
 *     note whose last-edit time would mean anything, and showing the active
 *     note's would be a lie about what the user is looking at;
 *   - nothing matched and no filter → the active note, because "no match"
 *     here just means the editor is showing the current note directly.
 */
export function deriveTopbarNote({
  note,
  currentNote,
  selectedTagFilters,
}: TopbarNoteInput): SutraPadDocument | null {
  return note ?? (selectedTagFilters.length > 0 ? null : currentNote);
}

/**
 * The topbar's right-edge crumb: "synced HH:mm" for a signed-in user, "local ·
 * HH:mm" for a drafter whose notes have never left the device. Cross-day edits
 * get the date appended (see `formatLastChange`).
 *
 * Null when there is no note to describe — the filter-miss state above.
 */
export function deriveSyncCrumb(
  topbarNote: SutraPadDocument | null,
  profile: UserProfile | null,
): string | null {
  if (topbarNote === null) return null;
  return formatLastChange(topbarNote.updatedAt, { signedIn: profile !== null });
}
