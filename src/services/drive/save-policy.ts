/**
 * Pure decision logic for the write boundary of `GoogleDriveStore.saveWorkspace`
 * and for index-snapshot retention. Kept DOM- and IO-free so every rule is
 * unit-testable (and mutation-tested) without a Drive stub; the store just
 * feeds it what it already has in hand.
 *
 * Two kinds of budget live here (see `lib/budgets.ts`):
 *
 *   - **Hard** — the save is refused before any note file is written.
 *     Reserved for shapes that have only ever meant data loss.
 *   - **Soft** — the save proceeds, and the store reports the overrun to
 *     whoever is listening (`console.warn` today, the Settings diagnostics
 *     card later). For the numbers whose legitimate ceiling is not yet known.
 */
import type { SutraPadDocument, SutraPadNoteSummary } from "../../types";
import {
  INDEX_MAX_SHRINK_RATIO,
  INDEX_MAX_SNAPSHOTS,
  INDEX_SNAPSHOT_MIN_AGE_KEPT_MS,
  SAVE_MAX_BLANKED_NOTES_INTERACTIVE,
  SAVE_MAX_NOTE_UPLOADS_INTERACTIVE,
} from "../../lib/budgets";

/** A soft budget the current save is about to exceed. */
export interface BudgetOverrun {
  readonly budget: "index-shrink" | "note-uploads";
  /** Observed value — dropped-note ratio, or number of uploads. */
  readonly observed: number;
  /** The budget it exceeded. */
  readonly limit: number;
  readonly message: string;
}

/**
 * Thrown by `saveWorkspace` when a hard budget refuses the write. Carries a
 * stable `code` so callers can map it to copy; the `message` is the English
 * fallback the sync pill shows today.
 */
export class WorkspaceSaveRefusedError extends Error {
  readonly code: "blanked-notes";

  constructor(code: "blanked-notes", message: string) {
    super(message);
    this.name = "WorkspaceSaveRefusedError";
    this.code = code;
  }
}

/**
 * Notes this save would write with an empty body although the index still
 * describes them as having content — the "body-less copy overwriting a real
 * file" shape. A placeholder (`hydrated === false`) never counts: it is
 * never uploaded at all (`saveNoteFile`). A note whose `updatedAt` matches
 * its summary never counts either: it will hit the unchanged short-circuit,
 * not the upload path.
 */
export function findBlankedNotes(
  notes: readonly SutraPadDocument[],
  existingSummaryById: ReadonlyMap<string, SutraPadNoteSummary>,
): SutraPadDocument[] {
  return notes.filter((note) => {
    if (note.hydrated === false) return false;
    if (note.body.trim() !== "") return false;
    const summary = existingSummaryById.get(note.id);
    if (!summary) return false;
    if (summary.updatedAt === note.updatedAt) return false;
    return (summary.excerpt ?? "").trim() !== "";
  });
}

/**
 * Hard guard. Refuses a save that blanks more than
 * `SAVE_MAX_BLANKED_NOTES_INTERACTIVE` notes at once. Returns nothing on the
 * happy path; the caller runs it before the upload fan-out so a refused save
 * writes nothing.
 */
export function assertNotMassBlanking(
  notes: readonly SutraPadDocument[],
  existingSummaryById: ReadonlyMap<string, SutraPadNoteSummary>,
): void {
  const blanked = findBlankedNotes(notes, existingSummaryById);
  if (blanked.length <= SAVE_MAX_BLANKED_NOTES_INTERACTIVE) return;
  throw new WorkspaceSaveRefusedError(
    "blanked-notes",
    `Save refused: ${blanked.length} notes would be emptied at once. Reload from Drive or rebuild the index in Settings before saving again.`,
  );
}

/**
 * Soft guard. Reports when the index this save is about to write drops more
 * than `INDEX_MAX_SHRINK_RATIO` of the entries the existing index has.
 * `existingCount === 0` (first save, or an index that was itself empty) is
 * never a shrink.
 */
export function checkIndexShrink(
  existingCount: number,
  nextCount: number,
): BudgetOverrun | null {
  if (existingCount === 0) return null;
  const ratio = (existingCount - nextCount) / existingCount;
  if (ratio <= INDEX_MAX_SHRINK_RATIO) return null;
  return {
    budget: "index-shrink",
    observed: ratio,
    limit: INDEX_MAX_SHRINK_RATIO,
    message: `Index would shrink from ${existingCount} to ${nextCount} notes (${Math.round(ratio * 100)} %).`,
  };
}

/**
 * Soft guard. Reports when a save writes more note files than an
 * interactive edit plausibly produces.
 */
export function checkNoteUploadCount(uploads: number): BudgetOverrun | null {
  if (uploads <= SAVE_MAX_NOTE_UPLOADS_INTERACTIVE) return null;
  return {
    budget: "note-uploads",
    observed: uploads,
    limit: SAVE_MAX_NOTE_UPLOADS_INTERACTIVE,
    message: `Save uploaded ${uploads} note files; an interactive save is expected to stay under ${SAVE_MAX_NOTE_UPLOADS_INTERACTIVE}. The index has probably drifted from the folder — rebuild it in Settings.`,
  };
}

/** `index-2026-09-07T16-39-45-229Z.json` → ISO timestamp, or null. */
export function parseIndexSnapshotTimestamp(fileName: string): string | null {
  const match =
    /^index-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/u.exec(fileName);
  if (!match) return null;
  const [, date, hh, mm, ss, ms] = match;
  return `${date}T${hh}:${mm}:${ss}.${ms}Z`;
}

/**
 * Which stale snapshots to delete after a save. Two rules, both must hold:
 *
 *   1. Count window: the `INDEX_MAX_SNAPSHOTS - 1` newest stale snapshots
 *      (by name, which sorts chronologically) survive.
 *   2. Age floor: if nothing in that window is at least
 *      `INDEX_SNAPSHOT_MIN_AGE_KEPT_MS` old, the newest snapshot that *is*
 *      that old survives too — a save storm must not rotate the last
 *      known-good state out of existence.
 *
 * Files whose name doesn't parse as a snapshot (the legacy
 * `sutrapad-index.json` shares the `kind=index` marker) are never deleted
 * and never count as a recovery point — they are not something this
 * retention produced, so it is not its place to rotate them.
 */
export function selectSnapshotsToDelete<T extends { id: string; name: string }>(
  snapshots: readonly T[],
  activeIndexId: string,
  now: number,
): T[] {
  const ageOf = (file: T): number | null => {
    const iso = parseIndexSnapshotTimestamp(file.name);
    if (iso === null) return null;
    const time = Date.parse(iso);
    return Number.isNaN(time) ? null : now - time;
  };
  const isOldEnough = (file: T): boolean => {
    const age = ageOf(file);
    return age !== null && age >= INDEX_SNAPSHOT_MIN_AGE_KEPT_MS;
  };

  const stale = snapshots
    .filter((file) => file.id !== activeIndexId && ageOf(file) !== null)
    .toSorted((left, right) => right.name.localeCompare(left.name));
  const kept = stale.slice(0, INDEX_MAX_SNAPSHOTS - 1);
  const candidates = stale.slice(INDEX_MAX_SNAPSHOTS - 1);

  if (kept.some((file) => isOldEnough(file))) return candidates;
  // `candidates` is newest-first, so the first old-enough one is the
  // youngest snapshot that still clears the age floor.
  const recoveryPoint = candidates.find((file) => isOldEnough(file));
  return recoveryPoint === undefined
    ? candidates
    : candidates.filter((file) => file !== recoveryPoint);
}
