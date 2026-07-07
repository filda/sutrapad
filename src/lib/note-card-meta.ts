/**
 * Card metadata derived from a note — everything the Notes card shows without
 * needing the full body. Precomputed into the index summary at save time
 * (Phase 2) so the list renders from small records instead of hydrating every
 * body, and reused by the card renderer so the stored excerpt/headline can't
 * drift from what is drawn.
 */
import { buildCardExcerpt } from "./card-excerpt";
import { bodyAfterHeadline, firstBodyLine } from "./note-headline";
import { countTasksInNote } from "./tasks";
import type { SutraPadDocument } from "../types";

/** Card excerpt budget (single line in the Notes grid). */
export const NOTE_CARD_EXCERPT_MAX = 72;

export interface NoteCardMeta {
  /** Title if non-empty, else the body's first non-blank line (may be ""). */
  readonly headline: string;
  /** Short blurb; "" when there is nothing beyond the headline. */
  readonly excerpt: string;
  readonly tags: string[];
  readonly location?: string;
  /** Open/done task counts, mirroring `countTasksInNote`, for the task chip. */
  readonly tasks: { readonly open: number; readonly done: number };
}

export function buildNoteCardMeta(note: SutraPadDocument): NoteCardMeta {
  const titleIsBlank = note.title.trim() === "";
  const headline = titleIsBlank ? firstBodyLine(note.body) : note.title.trim();
  // Mirror the card renderer: with an empty title the first body line becomes
  // the headline, so the excerpt is built from the body minus that line.
  const excerptSource = titleIsBlank ? bodyAfterHeadline(note.body) : note.body;
  return {
    headline,
    excerpt: buildCardExcerpt(excerptSource, { maxChars: NOTE_CARD_EXCERPT_MAX }) ?? "",
    tags: note.tags,
    location: note.location,
    tasks: countTasksInNote(note),
  };
}
