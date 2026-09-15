import { LOCAL_TASK_INDEX_MAX_BYTES } from "../../lib/budgets";
import type { SutraPadTaskEntry, SutraPadTaskIndex } from "../../types";

/**
 * Device-local copy of the resident task index.
 *
 * Why this exists (2026-09-15). Under the lazy-body model a note comes back
 * from Drive as a placeholder with no body, so tasks cannot be re-derived
 * from the workspace — `reconcileTaskIndexForWorkspace` carries a
 * placeholder's entries forward from the *previous* index instead. At a cold
 * boot there is no previous index, so the Tasks page had nothing to show
 * until `reseedResidentIndexesFromDrive` landed: 14 Drive requests and
 * ~18 s on the real notebook, during which the page rendered its ordinary
 * "no tasks" empty state. Not slow — wrong: "still loading" and "you have
 * none" looked identical, twice, in the same week.
 *
 * Persisting the index next to the local workspace closes that window. The
 * Drive re-seed stays exactly as it was and remains authoritative; it just
 * becomes a correction to something already on screen rather than the first
 * source of it.
 *
 * Deliberately only the *task* index. The link index is rebuilt at boot from
 * `note.urls`, which every placeholder carries
 * (`buildLinkIndex(workspace$.get())` in `state-store.ts`), and note
 * summaries reconcile from the workspace the same way — neither needs a
 * second copy, and localStorage already holds a ~1.2 MB workspace on the real
 * notebook. Tasks are the one resident model a placeholder genuinely cannot
 * reproduce.
 */

export const LOCAL_TASK_INDEX_KEY = "sutrapad-local-task-index";

/** The value a missing or unusable slot resolves to: today's boot seed. */
export function emptyTaskIndex(): SutraPadTaskIndex {
  return { version: 1, savedAt: "", tasks: [] };
}

/**
 * Structural guard for one stored entry. The slot is user-writable and
 * survives across deploys, so a shape from an older build (or a hand-edited
 * value) must not reach the Tasks page — a malformed entry there surfaces as
 * a crash mid-render, which is worse than the empty list this replaces.
 */
function isTaskEntry(value: unknown): value is SutraPadTaskEntry {
  // Only `null` needs its own check: reading a property off it throws, while
  // every other non-object (a bare string in the array, a number) answers
  // `undefined` and falls out of the per-field checks below. A `typeof`
  // guard in front of them would be unreachable cover.
  if (value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.noteId === "string" &&
    // `Number.isInteger` is the whole test — it answers false for every
    // non-number too, so no separate `typeof` check.
    Number.isInteger(entry.lineIndex) &&
    typeof entry.text === "string" &&
    typeof entry.done === "boolean" &&
    typeof entry.noteUpdatedAt === "string"
  );
}

/**
 * Reads the stored index, dropping entries that fail the shape guard. A
 * missing slot, unparseable JSON or a wrong-shaped root all resolve to
 * {@link emptyTaskIndex} — i.e. to the behaviour this module replaced, so
 * the worst case is the old one rather than a broken boot.
 */
export function loadLocalTaskIndex(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): SutraPadTaskIndex {
  let raw: string | null;
  try {
    raw = storage.getItem(LOCAL_TASK_INDEX_KEY);
  } catch {
    // Storage can throw outright (Safari private mode, blocked site data).
    return emptyTaskIndex();
  }
  if (raw === null) return emptyTaskIndex();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyTaskIndex();
  }
  // Same reasoning as `isTaskEntry`: a primitive answers `undefined` for
  // `.tasks` and is rejected by the array check, so `null` is the only shape
  // that needs naming.
  const candidate = parsed as Record<string, unknown> | null;
  if (candidate === null || !Array.isArray(candidate.tasks)) {
    return emptyTaskIndex();
  }

  return {
    version: 1,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
    tasks: candidate.tasks.filter((entry): entry is SutraPadTaskEntry =>
      isTaskEntry(entry),
    ),
  };
}

/**
 * Writes the index, and swallows the two ways that can fail.
 *
 * A write over {@link LOCAL_TASK_INDEX_MAX_BYTES} is skipped rather than
 * attempted: this slot shares a 5–10 MiB origin quota with a workspace that
 * is already ~1.2 MB, and the failure mode of filling it is that *every*
 * later write throws — including the workspace one, which is the copy that
 * actually matters. A `QuotaExceededError` from the write itself is caught
 * for the same reason. Either way the next boot falls back to the empty
 * index and the Drive re-seed, which is where this started.
 */
export function persistLocalTaskIndex(
  index: SutraPadTaskIndex,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  const serialized = JSON.stringify(index);
  if (serialized.length > LOCAL_TASK_INDEX_MAX_BYTES) {
    console.warn(
      `[storage] task index not cached locally: ${serialized.length} bytes over the ${LOCAL_TASK_INDEX_MAX_BYTES} budget`,
    );
    return;
  }
  try {
    storage.setItem(LOCAL_TASK_INDEX_KEY, serialized);
  } catch (error) {
    console.warn("[storage] task index not cached locally", error);
  }
}
