import type {
  SutraPadTagEntry,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../../types";
import { deriveAutoTags } from "../../lib/auto-tags";

/**
 * Handoff v2 threshold — a tag with exactly one carrier note that hasn't
 * been touched in this many days is considered dormant and gets moved into
 * the "Rare" / "Graveyard" section at the bottom of the Tags page. 90 days
 * is the line the handoff draws; exported so tests and callers that want a
 * tighter window (e.g. previews) can lean on the same constant.
 */
export const GRAVEYARD_THRESHOLD_DAYS = 90;

/** Exposed so tests don't have to restate the conversion. */
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface GraveyardSplit {
  /** Tags that should render in the main cloud. Order matches `index.tags`. */
  living: SutraPadTagEntry[];
  /** Tags that belong in the collapsible Rare section. Sorted oldest-first. */
  graveyard: SutraPadTagEntry[];
}

/**
 * Builds a map from tag → latest `updatedAt` of any note carrying that tag,
 * for both user-curated and auto-derived tags. Used as the `lastUsed` signal
 * for graveyard detection.
 *
 * The walk mirrors `buildCombinedTagIndex`: user tags come straight off
 * `note.tags`; auto tags are freshly derived per note at query time. This
 * keeps auto-tag graveyard behaviour correct — e.g. `date:today` is always
 * re-derived as today's ISO date, so it can't drift into the graveyard just
 * because the note itself is old.
 */
export function computeLastUsedByTag(
  workspace: SutraPadWorkspace,
  now: Date = new Date(),
): Map<string, string> {
  const lastUsed = new Map<string, string>();

  for (const note of workspace.notes) {
    const tagsForNote = new Set<string>(note.tags);
    for (const tag of deriveAutoTags(note, now)) tagsForNote.add(tag);

    for (const tag of tagsForNote) {
      const previous = lastUsed.get(tag);
      if (!previous || note.updatedAt.localeCompare(previous) > 0) {
        lastUsed.set(tag, note.updatedAt);
      }
    }
  }

  return lastUsed;
}

/**
 * Tests a single tag entry against the graveyard criterion:
 *
 *   - exactly one note carries it (`count === 1`)
 *   - its most recent `updatedAt` is older than `thresholdDays` from `now`
 *
 * Returns `false` for any tag we can't place on the timeline (unknown
 * lastUsed, unparseable date) — when in doubt we keep it in the living
 * cloud so we never hide a tag the user would expect to see.
 */
export function isGraveyardTag(
  entry: SutraPadTagEntry,
  lastUsedByTag: Map<string, string>,
  now: Date,
  thresholdDays: number = GRAVEYARD_THRESHOLD_DAYS,
): boolean {
  if (entry.count !== 1) return false;

  const lastUsed = lastUsedByTag.get(entry.tag);
  if (!lastUsed) return false;

  const lastUsedMs = Date.parse(lastUsed);
  if (Number.isNaN(lastUsedMs)) return false;

  const ageDays = (now.getTime() - lastUsedMs) / DAY_MS;
  return ageDays > thresholdDays;
}

/**
 * Splits a pre-computed tag index into `living` (still in the main cloud) and
 * `graveyard` (collapsed in the Rare section). The input index order is
 * preserved for the living set — the main cloud's count-desc/name-asc sort
 * shouldn't change just because a few tags were culled. The graveyard is
 * re-sorted oldest-first so the most sunset-looking entries sit at the top
 * of the collapsed section, which is what the handoff's muted pile implies.
 */
export function splitGraveyard(
  index: SutraPadTagIndex,
  workspace: SutraPadWorkspace,
  now: Date = new Date(),
  thresholdDays: number = GRAVEYARD_THRESHOLD_DAYS,
): GraveyardSplit {
  const lastUsedByTag = computeLastUsedByTag(workspace, now);
  const living: SutraPadTagEntry[] = [];
  const graveyard: SutraPadTagEntry[] = [];

  for (const entry of index.tags) {
    if (isGraveyardTag(entry, lastUsedByTag, now, thresholdDays)) {
      graveyard.push(entry);
    } else {
      living.push(entry);
    }
  }

  // Sort graveyard oldest-first (ties broken by alpha) so the most-dormant
  // tags lead the collapsed section. ISO-8601 strings sort lexicographically,
  // so a plain localeCompare is chronologically correct.
  graveyard.sort((left, right) => {
    const leftUsed = lastUsedByTag.get(left.tag) ?? "";
    const rightUsed = lastUsedByTag.get(right.tag) ?? "";
    return (
      leftUsed.localeCompare(rightUsed) || left.tag.localeCompare(right.tag)
    );
  });

  return { living, graveyard };
}
