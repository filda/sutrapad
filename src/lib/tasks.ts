import type {
  SutraPadDocument,
  SutraPadTaskEntry,
  SutraPadTaskIndex,
  SutraPadWorkspace,
} from "../types";

/**
 * Task-parsing module. Kept separate from `notebook.ts` so helpers that want
 * to interrogate a note's task state (e.g. `deriveAutoTags` for the
 * `tasks:none/open/done` auto-tag) can do so without dragging in — or
 * creating a cycle through — the full notebook index code.
 */

/**
 * Matches a checkbox at the start of a line (optional leading whitespace and
 * an optional `-` bullet). Accepted bracket variants are `[]`, `[ ]`, `[x]`
 * and `[X]`. Captured groups:
 *   1 — full prefix up to and including the closing bracket
 *   2 — bracket content (empty string, space, or `x`/`X`)
 *   3 — remaining text on the line (the task description)
 */
const TASK_LINE_REGEX = /^(\s*(?:-\s+)?\[([ xX]?)\])\s?(.*)$/;

export function parseTasksFromNote(note: SutraPadDocument): SutraPadTaskEntry[] {
  const tasks: SutraPadTaskEntry[] = [];
  const lines = note.body.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = TASK_LINE_REGEX.exec(lines[lineIndex]);
    if (!match) continue;

    const bracketContent = match[2];
    const text = match[3].trimEnd();
    // Skip lines that are just a checkbox with nothing after it; they are
    // almost always a typo rather than an intentional empty task and would
    // otherwise clutter the Tasks page with ghost entries.
    if (text.length === 0) continue;

    tasks.push({
      noteId: note.id,
      lineIndex,
      text,
      done: bracketContent === "x" || bracketContent === "X",
      noteUpdatedAt: note.updatedAt,
    });
  }
  return tasks;
}

/**
 * Counts open and completed tasks in a single note. Used by the notebook list
 * to show a "has-tasks" chip next to each note card, and by `deriveAutoTags`
 * for the `tasks:none|open|done` facet.
 */
export function countTasksInNote(note: SutraPadDocument): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const task of parseTasksFromNote(note)) {
    if (task.done) done += 1;
    else open += 1;
  }
  return { open, done };
}

/**
 * Comparator used to order the task index. Extracted from `buildTaskIndex`
 * as an exported pure function so every branch (open/done, recency,
 * noteId, lineIndex) can be unit-tested with crafted pairs; the integration
 * path through `parseTasksFromNote` only ever produces lineIndex-ascending
 * input so the tie-breakers are otherwise unobservable.
 *
 * Ordering, in order of precedence:
 *   1. Open tasks before completed ones.
 *   2. Most recently touched note first (by `noteUpdatedAt` descending).
 *   3. Alphabetical by `noteId` to make ordering deterministic for ties.
 *   4. Ascending `lineIndex` so tasks inside a note mirror the note body.
 */
export function compareTaskEntries(
  left: SutraPadTaskEntry,
  right: SutraPadTaskEntry,
): number {
  if (left.done !== right.done) return left.done ? 1 : -1;
  const updatedAtDelta = right.noteUpdatedAt.localeCompare(left.noteUpdatedAt);
  if (updatedAtDelta !== 0) return updatedAtDelta;
  if (left.noteId !== right.noteId) return left.noteId.localeCompare(right.noteId);
  return left.lineIndex - right.lineIndex;
}

export function buildTaskIndex(
  workspace: SutraPadWorkspace,
  savedAt = new Date().toISOString(),
): SutraPadTaskIndex {
  const tasks: SutraPadTaskEntry[] = [];
  for (const note of workspace.notes) {
    tasks.push(...parseTasksFromNote(note));
  }

  return {
    version: 1,
    savedAt,
    tasks: tasks.toSorted(compareTaskEntries),
  };
}

/**
 * Flips the done-state of a single task at `lineIndex` within `body`. Unknown
 * or non-checkbox lines are returned unchanged so callers can safely invoke
 * this even if the index is momentarily stale (e.g. the user edited the note
 * between the render and the click). The bracket style is preserved for the
 * open state (`[]` stays `[]`, `[ ]` stays `[ ]`); marking a task done always
 * writes `[x]`.
 */
export function toggleTaskInBody(body: string, lineIndex: number): string {
  const lines = body.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return body;

  const line = lines[lineIndex];
  const match = TASK_LINE_REGEX.exec(line);
  if (!match) return body;

  const bracketContent = match[2];
  const isDone = bracketContent === "x" || bracketContent === "X";
  const prefix = match[1];
  const rest = line.slice(prefix.length);

  let nextPrefix: string;
  if (isDone) {
    // Preserve the original open style when we can infer it; default to `[ ]`.
    nextPrefix = prefix.replace(/\[[xX]\]$/, "[ ]");
  } else {
    // Collapse both `[]` and `[ ]` to `[x]` on completion.
    nextPrefix = prefix.replace(/\[[ ]?\]$/, "[x]");
  }

  lines[lineIndex] = `${nextPrefix}${rest}`;
  return lines.join("\n");
}
