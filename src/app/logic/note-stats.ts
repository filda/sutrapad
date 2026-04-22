import type { SutraPadDocument } from "../../types";
import { countTasksInNote } from "../../lib/tasks";

export interface NoteStats {
  wordCount: number;
  /**
   * Minutes-to-read estimate at an average reading speed of ~220 wpm.
   * Floored at 1 minute so even short notes produce a useful value to
   * display in breadcrumb rows.
   */
  readMinutes: number;
  openTasks: number;
  doneTasks: number;
  linkCount: number;
  tagCount: number;
}

const READ_WORDS_PER_MINUTE = 220;

/**
 * Matches absolute HTTP(S) URLs that appear in a note body. We stop at the
 * first whitespace or closing parenthesis so links embedded in prose ("see
 * https://example.com/path)") don't sweep up the trailing punctuation.
 */
const LINK_REGEX = /https?:\/\/[^\s)]+/g;

/**
 * Computes the counts shown in the detail-topbar breadcrumb row (word count,
 * read time, tasks, links, tag count). Extracted from the view so the derivation
 * can be unit-tested without a DOM.
 *
 * `note.urls` (the captured link list) is unioned with any bare URLs that
 * appear in the body so a note captured via the bookmarklet and edited
 * afterwards always surfaces the higher count of the two sources.
 */
export function computeNoteStats(note: SutraPadDocument): NoteStats {
  const body = note.body ?? "";
  const trimmed = body.trim();
  const wordCount = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  const readMinutes = Math.max(1, Math.round(wordCount / READ_WORDS_PER_MINUTE));

  const { open, done } = countTasksInNote(note);

  const bodyLinks = body.match(LINK_REGEX) ?? [];
  const capturedLinks = note.urls?.length ?? 0;
  const linkCount = Math.max(bodyLinks.length, capturedLinks);

  return {
    wordCount,
    readMinutes,
    openTasks: open,
    doneTasks: done,
    linkCount,
    tagCount: note.tags.length,
  };
}
