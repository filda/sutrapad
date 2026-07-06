/**
 * DOM-free orchestrator for the drag-and-drop import's Drive writes.
 *
 * Each imported note is persisted through the app's existing
 * `appendNoteToWorkspace` (the silent-capture fast path), which creates an
 * app-owned file — the only way notes become visible under the `drive.file`
 * scope. Uploads run in small concurrent batches with a pause between them so
 * a 6k-note import doesn't fan out thousands of simultaneous requests and trip
 * Drive's rate limits. Individual failures are counted, not fatal: one bad
 * upload must not abandon the rest of the import.
 *
 * Kept side-effect free (the `appendNote`, `onProgress`, and `sleep`
 * dependencies are all injected) so the batching/accounting is node-testable
 * without a Drive client or real timers.
 */
import type { SutraPadDocument } from "../../types";

export interface NoteImportProgress {
  /** Uploads that resolved successfully. */
  readonly done: number;
  /** Uploads that rejected. */
  readonly failed: number;
  /** Total notes in the import. */
  readonly total: number;
}

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_DELAY_MS = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface NoteImportOptions {
  readonly notes: readonly SutraPadDocument[];
  readonly appendNote: (note: SutraPadDocument) => Promise<void>;
  readonly onProgress?: (progress: NoteImportProgress) => void;
  readonly batchSize?: number;
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export async function runNoteImport(
  options: NoteImportOptions,
): Promise<NoteImportProgress> {
  const {
    notes,
    appendNote,
    onProgress,
    batchSize = DEFAULT_BATCH_SIZE,
    delayMs = DEFAULT_DELAY_MS,
    sleep = defaultSleep,
  } = options;

  const total = notes.length;
  const size = Math.max(1, batchSize);
  let done = 0;
  let failed = 0;

  for (let start = 0; start < total; start += size) {
    const chunk = notes.slice(start, start + size);
    // oxlint-disable-next-line no-await-in-loop -- batches run sequentially on purpose to throttle Drive uploads
    const results = await Promise.allSettled(
      chunk.map((note) => appendNote(note)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        done += 1;
      } else {
        failed += 1;
      }
    }
    onProgress?.({ done, failed, total });

    if (start + size < total && delayMs > 0) {
      // oxlint-disable-next-line no-await-in-loop -- inter-batch pause is the throttle; must run between batches
      await sleep(delayMs);
    }
  }

  return { done, failed, total };
}
