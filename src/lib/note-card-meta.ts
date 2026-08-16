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
import { deriveAutoTags } from "./auto-tags";
import type { SutraPadDocument, SutraPadNoteSummary } from "../types";

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

/**
 * Projects a full note document down to the index summary the Notes list
 * renders from. Card meta is precomputed here so the list can show headline /
 * excerpt / tags / location / task counts without hydrating the body. Used as
 * the transition source for the resident summary model (Phase 2 parallel-run):
 * summaries are derived from the loaded workspace until `loadWorkspace` stops
 * holding every body, at which point they come straight from the Drive index.
 */
export function buildNoteSummary(
  note: SutraPadDocument,
  now: Date = new Date(),
): SutraPadNoteSummary {
  const meta = buildNoteCardMeta(note);
  return {
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    headline: meta.headline,
    excerpt: meta.excerpt,
    tags: meta.tags,
    location: meta.location,
    tasks: { open: meta.tasks.open, done: meta.tasks.done },
    urls: note.urls,
    captureContext: note.captureContext,
    autoTags: deriveAutoTags(note, now),
  };
}

/**
 * Rebuilds a body-less `SutraPadDocument` from an index summary — the inverse
 * of `buildNoteSummary` minus the body. The card / tasks / links renderers and
 * their persona / thumb / primary-URL helpers all take a document but read
 * only non-body fields, so this lets those surfaces render from the resident
 * summary model without hydrating the note. Persona's body-derived cues are
 * passed to `deriveNotebookPersona` as precomputed options instead.
 */
export function documentFromSummary(
  summary: SutraPadNoteSummary,
): SutraPadDocument {
  return {
    id: summary.id,
    title: summary.title,
    body: "",
    urls: [...(summary.urls ?? [])],
    tags: [...(summary.tags ?? [])],
    location: summary.location,
    captureContext: summary.captureContext,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    fileId: summary.fileId,
  };
}

/**
 * Builds the resident placeholder `loadWorkspace` seeds `workspace.notes`
 * with (Phase 2 notes-scaling): the real metadata from the index summary,
 * an empty body, and `hydrated: false` so every downstream reader (the
 * editor, `upsertNote`'s no-op guard, the hydrate-on-open lifecycle) can
 * tell it apart from a real note. See `SutraPadDocument.hydrated` and
 * `src/app/logic/note-hydration.ts` (`applyHydratedNote`, the counterpart
 * that replaces this placeholder once the real body is fetched).
 */
export function buildPlaceholderNote(summary: SutraPadNoteSummary): SutraPadDocument {
  return { ...documentFromSummary(summary), hydrated: false };
}
