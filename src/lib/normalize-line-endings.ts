/**
 * Line-ending normalisation for text arriving from outside the app.
 *
 * Everything SutraPad stores assumes `\n`. The editor is a `<textarea>`,
 * which always hands back `\n` whatever the platform, so the assumption
 * holds for anything the user types — but not for text that arrives from
 * somewhere else:
 *
 *   - a `.json` export or `.md` file dropped onto the app, authored on
 *     Windows (`\r\n`) or by an old Mac-era tool (`\r`);
 *   - a `?note=` / `?selection=` bookmarklet payload copied out of a
 *     native Windows application.
 *
 * A stray `\r` is invisible in the rendered note and quietly breaks any
 * line-anchored parse of the body. The one that bit us: `TASK_LINE_REGEX`
 * in `lib/tasks.ts` ends `(.*)$`, and `.` does not match `\r` — so on a
 * CRLF body split by `"\n"`, the capture stopped in front of the `\r` and
 * `$` failed the whole match. **A Windows-authored note parsed zero tasks
 * except on its final line** (found by mutation testing, 2026-08-31 —
 * see `docs/mutation-survivor-triage.md`, source finding 11).
 *
 * Normalising at the boundary rather than at each consumer is deliberate:
 * the alternative is every line-anchored regex in the codebase having to
 * remember `\r?`, which is exactly the kind of thing that gets forgotten
 * once and then silently regresses.
 */

/**
 * Converts CRLF and lone-CR line endings to LF. Leaves LF-only text
 * untouched (and returns the same string, so it is safe to apply
 * unconditionally on a hot path).
 *
 * Order matters: `\r\n` has to go first, or the lone-CR pass would turn
 * each CRLF into a blank line.
 */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
