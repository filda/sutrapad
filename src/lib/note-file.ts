/**
 * Filename convention for a note's per-note JSON file on Drive: `note-<id>.json`.
 *
 * Historically the loader identified note files purely by Drive `appProperties`
 * (`sutrapad=true`, `kind=note`). That coupled "is this a note?" to metadata
 * only the app itself sets, so a plain `note-<id>.json` dropped into the
 * workspace folder by any other means stayed invisible. Recognising the
 * filename shape too lets SutraPad act as a renderer for a dedicated folder:
 * any well-formed `note-<id>.json` becomes a note, whether or not it carries
 * the appProperties markers.
 *
 * The pattern is deliberately strict — anchored at both ends and requiring a
 * non-empty id — so substring matches from Drive's `name contains 'note-'`
 * query (e.g. `footnote-1.json`) and the app's own non-note artifacts
 * (`sutrapad-index.json`, `index-<ts>.json`, …) are excluded client-side.
 */
const NOTE_FILE_NAME_PATTERN = /^note-(.+)\.json$/u;

/** Builds the canonical per-note Drive filename for a note id. */
export function noteFileName(noteId: string): string {
  return `note-${noteId}.json`;
}

/** True when `name` is a canonical `note-<id>.json` filename. */
export function isNoteFileName(name: string): boolean {
  return NOTE_FILE_NAME_PATTERN.test(name);
}

/**
 * Extracts the note id embedded in a `note-<id>.json` filename, or `null` when
 * the name isn't a canonical note filename. Used by the progressive refresh to
 * derive a note id without fetching the file body when appProperties are
 * absent.
 */
export function noteIdFromFileName(name: string): string | null {
  const match = NOTE_FILE_NAME_PATTERN.exec(name);
  return match ? match[1] : null;
}
