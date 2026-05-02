/**
 * Pure helper that picks a single "primary URL" for a note. The Notes
 * and Tasks cards use this to feed the shared link-thumb header — they
 * each show one card per note and need exactly one URL to drive the
 * og:image lookup and hostname chip.
 *
 * Priority:
 *   1. `captureContext.page.canonicalUrl` — set by the bookmarklet from
 *      `<link rel="canonical">`. It's the most authoritative URL for a
 *      captured page (avoids tracking-tail variants of the same article).
 *   2. First URL on `note.urls` — the canonicalised list maintained by
 *      `lib/notebook.ts` → `extractUrls`. Already trimmed/dedup'd, so we
 *      can hand it back as-is.
 *   3. `null` — the note has no URL at all (hand-typed). Callers fall
 *      back to a persona-tinted gradient with no domain chip.
 *
 * DOM-free + side-effect-free so the renderer can call it on every
 * paint without memoising and the unit tests stay node-only.
 */
import type { SutraPadDocument } from "../../types";

export function deriveNotePrimaryUrl(note: SutraPadDocument): string | null {
  const canonical = note.captureContext?.page?.canonicalUrl?.trim();
  if (canonical) return canonical;

  for (const url of note.urls) {
    const trimmed = url?.trim();
    if (trimmed) return trimmed;
  }

  return null;
}
