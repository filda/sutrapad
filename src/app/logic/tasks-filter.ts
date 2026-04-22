import type {
  SutraPadDocument,
  SutraPadTaskEntry,
  SutraPadWorkspace,
} from "../../types";

/**
 * Chip-filter identity for the Tasks screen. Four chips, matching the handoff
 * (`docs/design_handoff_sutrapad2/src/screen_rest.jsx`):
 *
 * - `all`     — every task (modulo the show-done toggle)
 * - `recent`  — tasks from notes ≤ 2 days old
 * - `stale`   — open tasks 3+ days old
 * - `waiting` — open tasks whose text mentions a person (verb-person
 *   pattern or bare `@mention`)
 *
 * Deliberately no `open` / `done` chips — the show-done checkbox covers
 * that dimension orthogonally so the four chips stay a semantic axis
 * rather than a state axis.
 */
export type TasksFilterId = "all" | "recent" | "stale" | "waiting";

export const TASKS_FILTER_IDS: readonly TasksFilterId[] = [
  "all",
  "recent",
  "stale",
  "waiting",
];

export interface EnrichedTask {
  readonly task: SutraPadTaskEntry;
  readonly note: SutraPadDocument;
  readonly daysOld: number;
  readonly hasPerson: boolean;
}

/**
 * Regex matching "waiting for a person" signals in task text. Ported verbatim
 * from `docs/design_handoff_sutrapad2/src/screen_rest.jsx` — catches short
 * verb-person patterns ("call Mia", "ask @lu") and bare `@mentions`.
 * Deliberately imperfect: once tag-classes land (#79) this becomes a fallback
 * behind structural `class: "people"` detection.
 */
export const WAITING_PERSON_REGEX = /\b(?:call|ask|email|text|write to)\s+\w|@\w/i;

export function detectWaitingFor(taskText: string): boolean {
  return WAITING_PERSON_REGEX.test(taskText);
}

/**
 * Whole-day span from `iso` to `now`. Clamped to 0 for future / invalid /
 * missing dates — a task on a note dated tomorrow is not "negative days old",
 * it's fresh.
 */
export function computeDaysOld(now: Date, iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const ms = now.getTime() - t;
  if (ms <= 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function enrichTasks(
  tasks: readonly SutraPadTaskEntry[],
  workspace: SutraPadWorkspace,
  now: Date,
): EnrichedTask[] {
  const notesById = new Map(workspace.notes.map((note) => [note.id, note]));
  const out: EnrichedTask[] = [];
  for (const task of tasks) {
    const note = notesById.get(task.noteId);
    if (!note) continue;
    out.push({
      task,
      note,
      daysOld: computeDaysOld(now, note.createdAt),
      hasPerson: detectWaitingFor(task.text),
    });
  }
  return out;
}

/**
 * Count how many tasks belong in each chip. Semantics mirror the handoff:
 *
 * - `all` counts what's currently visible under the show-done stance —
 *   so flipping "Show done" updates the All chip instead of showing a
 *   stale total.
 * - `recent` shares that visibility rule (a done-yesterday task is still
 *   recent).
 * - `stale` and `waiting` hard-exclude done because a completed task is
 *   neither stale nor waiting anymore, regardless of the toggle.
 */
export function computeTaskCounts(
  enriched: readonly EnrichedTask[],
  showDone: boolean,
): Record<TasksFilterId, number> {
  let all = 0;
  let recent = 0;
  let stale = 0;
  let waiting = 0;
  for (const entry of enriched) {
    const visible = showDone || !entry.task.done;
    if (visible) all++;
    if (entry.daysOld <= 2 && visible) recent++;
    if (entry.daysOld >= 3 && !entry.task.done) stale++;
    if (entry.hasPerson && !entry.task.done) waiting++;
  }
  return { all, recent, stale, waiting };
}

/**
 * Apply the current chip filter + show-done toggle. Only the two
 * "backlog" filters (`stale`, `waiting`) hard-exclude done items — `all`
 * and `recent` honour the toggle so the user can pull up a "what did I
 * actually finish this week" view just by flipping Show done.
 */
export function applyTaskFilter(
  enriched: readonly EnrichedTask[],
  filter: TasksFilterId,
  showDone: boolean,
): EnrichedTask[] {
  return enriched.filter((entry) => {
    if (!showDone && entry.task.done) return false;
    switch (filter) {
      case "all":
        return true;
      case "recent":
        return entry.daysOld <= 2;
      case "stale":
        return entry.daysOld >= 3 && !entry.task.done;
      case "waiting":
        return entry.hasPerson;
      default:
        return true;
    }
  });
}

/**
 * Pick the "stalest" open task to promote as today's one-thing. Prefer the
 * oldest `daysOld >= 3`; otherwise any open task; otherwise null. Matches
 * the handoff's "Prefer stale, then recent" behaviour behind its
 * `Pick one thing for today` button.
 */
export function pickStalestOpenTask(
  enriched: readonly EnrichedTask[],
): EnrichedTask | null {
  const open = enriched.filter((entry) => !entry.task.done);
  if (open.length === 0) return null;
  const stale = open.filter((entry) => entry.daysOld >= 3);
  if (stale.length > 0) {
    // Oldest first so "stalest" truly wins. `toSorted` leaves the input
    // untouched — `enriched` is a read-only view over the task index.
    return stale.toSorted((a, b) => b.daysOld - a.daysOld)[0] ?? null;
  }
  return open[0] ?? null;
}

/**
 * Human-friendly relative time. Copied semantics verbatim from the handoff
 * `relTime` helper so "a week ago" / "3 weeks ago" / "2 months ago" read
 * identically. 30-day "months" is intentional — good-enough for a
 * sub-label.
 */
export function formatRelativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "a week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/**
 * Stable identity for the one-thing pin: `noteId::lineIndex`. Tasks don't
 * have their own id in the data model, so we synthesise one from their
 * anchor in the source note. Edits to the note body can shift line
 * indices — in that case the pin is harmlessly dropped on the next render
 * because the key no longer resolves.
 */
export function taskKey(task: SutraPadTaskEntry): string {
  return `${task.noteId}::${task.lineIndex}`;
}

export function findEnrichedTaskByKey(
  enriched: readonly EnrichedTask[],
  key: string | null,
): EnrichedTask | null {
  if (key === null) return null;
  return enriched.find((entry) => taskKey(entry.task) === key) ?? null;
}

/**
 * Group enriched tasks by source note, preserving the source order of
 * `enriched` (most recently-touched note first). Within a group, tasks
 * follow their authoring order (`lineIndex` ascending) so the card
 * mirrors the note body's layout.
 */
export interface EnrichedNoteGroup {
  readonly note: SutraPadDocument;
  readonly tasks: EnrichedTask[];
  readonly openCount: number;
  readonly totalCount: number;
  readonly hasStaleOpen: boolean;
}

export function groupEnrichedTasksByNote(
  enriched: readonly EnrichedTask[],
): EnrichedNoteGroup[] {
  const groupsById = new Map<
    string,
    {
      note: SutraPadDocument;
      tasks: EnrichedTask[];
    }
  >();
  const ordered: { note: SutraPadDocument; tasks: EnrichedTask[] }[] = [];

  for (const entry of enriched) {
    let group = groupsById.get(entry.task.noteId);
    if (!group) {
      group = { note: entry.note, tasks: [] };
      groupsById.set(entry.task.noteId, group);
      ordered.push(group);
    }
    group.tasks.push(entry);
  }

  return ordered.map((group) => {
    const sorted = group.tasks.toSorted(
      (a, b) => a.task.lineIndex - b.task.lineIndex,
    );
    const openCount = sorted.filter((entry) => !entry.task.done).length;
    const hasStaleOpen = sorted.some(
      (entry) => entry.daysOld >= 3 && !entry.task.done,
    );
    return {
      note: group.note,
      tasks: sorted,
      openCount,
      totalCount: sorted.length,
      hasStaleOpen,
    };
  });
}
