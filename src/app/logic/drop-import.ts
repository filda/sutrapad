/**
 * Pure parsing/normalisation for the drag-and-drop import surface.
 *
 * The DOM side (binding listeners, the progress indicator) lives in the
 * wiring layer; everything here is node-testable and side-effect free. Import
 * creates notes through the app's own token, so the resulting files are
 * app-owned and visible under the `drive.file` scope — unlike files dropped
 * into the Drive folder by another app.
 */
import { extractUrlsFromText } from "../../lib/notebook";
import { normalizeLineEndings } from "../../lib/normalize-line-endings";
import { httpUrlOrNull } from "../../lib/safe-url";
import type { SutraPadDocument } from "../../types";
import type { NoteImportProgress } from "./import-batches";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Returns `value` when it is a parseable ISO-ish date string, else null. */
function validIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}


/**
 * Normalises one raw JSON object into a `SutraPadDocument`, or null when it
 * carries nothing worth importing (neither a title nor a body). Defensive
 * about every field because the input is a user-supplied file:
 *
 *   - `id` is preserved when present (so re-importing the same export is
 *     idempotent — dedup collapses it) and generated otherwise.
 *   - `urls` are filtered to http(s) only (they flow to the Links `href`
 *     sink) or re-derived from the body when absent/misshapen.
 *   - timestamps fall back to `createdAt`/now so sorting never sees NaN.
 */
export function toImportedNote(raw: unknown): SutraPadDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  // Imported files are authored elsewhere — a Windows-authored export
  // arrives with CRLF endings, which are invisible in the rendered note and
  // break every line-anchored parse of the body.
  const body =
    typeof record.body === "string" ? normalizeLineEndings(record.body) : "";
  const rawTitle = typeof record.title === "string" ? record.title.trim() : "";
  if (body.trim().length === 0 && rawTitle.length === 0) return null;

  const updatedAt =
    validIsoOrNull(record.updatedAt) ??
    validIsoOrNull(record.createdAt) ??
    new Date().toISOString();
  const createdAt = validIsoOrNull(record.createdAt) ?? updatedAt;

  const urls = Array.isArray(record.urls)
    ? record.urls.filter(
        (url): url is string =>
          typeof url === "string" && httpUrlOrNull(url) !== null,
      )
    : extractUrlsFromText(body);

  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    id: isNonEmptyString(record.id) ? record.id : crypto.randomUUID(),
    title: rawTitle,
    body,
    urls,
    createdAt,
    updatedAt,
    tags,
  };
}

/**
 * Parses dropped JSON text into importable notes. Accepts either a single
 * note object or an array of them. Returns the (possibly empty) list of valid
 * notes, or `null` when the text isn't JSON at all — letting the caller fall
 * back to treating the drop as plain note text.
 */
export function parseNoteImport(jsonText: string): SutraPadDocument[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const rawList = Array.isArray(parsed) ? parsed : [parsed];
  const notes: SutraPadDocument[] = [];
  for (const raw of rawList) {
    const note = toImportedNote(raw);
    if (note !== null) notes.push(note);
  }
  return notes;
}

/** A dropped file, narrowed to the only member this module needs. */
export interface DroppedFile {
  readonly text: () => Promise<string>;
}

/** The drop payload, narrowed away from the DOM's `DataTransfer` for testing. */
export interface DropSource {
  readonly files: readonly DroppedFile[];
  /** Plain-text / URI payload for a text-only drop (no files). */
  readonly getText: () => string;
}

/**
 * Turns a drop payload into importable notes. Dropped files are read as text:
 * a file whose contents parse as JSON becomes one or more notes (bundle or
 * single); any other file becomes a single text note from its contents. A
 * fileless drop (selected text, a dragged link) becomes one text note. Files
 * that fail to read are skipped rather than aborting the whole drop.
 */
export async function extractDropNotes(
  source: DropSource,
): Promise<SutraPadDocument[]> {
  const notes: SutraPadDocument[] = [];

  if (source.files.length > 0) {
    for (const file of source.files) {
      let content: string;
      try {
        // oxlint-disable-next-line no-await-in-loop -- drop is usually one file; sequential read keeps skip-on-error simple
        content = await file.text();
      } catch {
        continue;
      }
      const parsed = parseNoteImport(content);
      if (parsed !== null) {
        notes.push(...parsed);
      } else {
        const note = toImportedNote({ body: content });
        if (note !== null) notes.push(note);
      }
    }
    return notes;
  }

  const text = source.getText();
  const note = toImportedNote({ body: text });
  if (note !== null) notes.push(note);
  return notes;
}

/** Adapts the DOM `DataTransfer` to the test-friendly `DropSource`. */
export function dropSourceFromDataTransfer(
  dataTransfer: DataTransfer,
): DropSource {
  return {
    files: Array.from(dataTransfer.files),
    getText: () =>
      dataTransfer.getData("text/uri-list") ||
      dataTransfer.getData("text/plain"),
  };
}

export type ImportDropStatus =
  | { readonly phase: "empty" }
  | { readonly phase: "start"; readonly total: number }
  | ({ readonly phase: "progress" } & NoteImportProgress)
  | ({ readonly phase: "done" } & NoteImportProgress);

/**
 * Orchestrates one drop: extracts notes from the payload and hands them to
 * `importNotes`, emitting status transitions for a progress indicator.
 * Returns the import result, or null when the drop carried no importable
 * notes.
 */
export async function handleImportDrop(
  dataTransfer: DataTransfer,
  deps: {
    importNotes: (
      notes: SutraPadDocument[],
      options?: { onProgress?: (progress: NoteImportProgress) => void },
    ) => Promise<NoteImportProgress>;
    onStatus?: (status: ImportDropStatus) => void;
  },
): Promise<NoteImportProgress | null> {
  const notes = await extractDropNotes(dropSourceFromDataTransfer(dataTransfer));
  if (notes.length === 0) {
    deps.onStatus?.({ phase: "empty" });
    return null;
  }
  deps.onStatus?.({ phase: "start", total: notes.length });
  const result = await deps.importNotes(notes, {
    onProgress: (progress) =>
      deps.onStatus?.({ phase: "progress", ...progress }),
  });
  deps.onStatus?.({ phase: "done", ...result });
  return result;
}
