/**
 * Pure helpers for the bookmarklet's silent-capture flow.
 *
 * Background: the bookmarklet runs on a third-party page and can't talk
 * to Drive directly (no token, CORS, etc.). The "silent" path loads
 * SutraPad inside a hidden `<iframe>` from the bookmarklet, the iframe
 * processes the URL params + saves to Drive, then `postMessage`s back
 * to the bookmarklet which displays a small toast and removes the
 * iframe. The user's source page is never redirected.
 *
 * If anything goes wrong (no auth, save failed, iframe blocked by the
 * site's CSP, third-party storage partitioned), the bookmarklet falls
 * back to the original "open SutraPad in a new tab" flow — so capture
 * always works, just sometimes loud.
 *
 * The query-param surface this module reads is set by `bookmarklet.ts`;
 * the matching writer there is the source of truth for param names.
 */

/**
 * Sentinel param the bookmarklet sets when it expects the page to run
 * silent + postMessage instead of rendering the editor. Reads as `?silent=1`
 * — we accept any truthy form (`true`, `yes`) to be forgiving but write
 * `1` from the bookmarklet builder.
 */
const SILENT_PARAM = "silent";

/**
 * Param holding the user's text selection at click time. Optional —
 * absent or blank means "no selection, just save the URL".
 */
const SELECTION_PARAM = "selection";

/**
 * Returns true when the given URL has the silent-capture flag set.
 * Used by the bootstrap shim to fork between "render the app" and
 * "process capture in the background, postMessage, exit".
 */
export function isSilentCapture(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const raw = parsed.searchParams.get(SILENT_PARAM);
  if (raw === null) return false;
  const normalized = raw.trim().toLowerCase();
  // Tolerant truthy check — accept the values a hand-built test URL
  // might use without forcing a specific spelling.
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Extracts the selection-text param from the URL, returning null when
 * the param is missing, blank, or whitespace-only. Centralised so the
 * empty-vs-meaningful-content predicate matches the bookmarklet's
 * "skip selection if empty" rule on every reader.
 */
export function extractSelectionFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const raw = parsed.searchParams.get(SELECTION_PARAM);
  if (raw === null) return null;
  if (raw.trim() === "") return null;
  return raw;
}

/**
 * Builds the note body for a silent-captured URL.
 *
 * Rules:
 *   - When the user selected text on the source page, the selection
 *     becomes the primary content with the source URL appended on its
 *     own line. Reads naturally as "here's a quote, here's where I
 *     saw it" without forcing the user to read the URL first.
 *   - Without a selection, the URL alone is the body — same as the
 *     pre-silent bookmarklet flow (`createCapturedNoteWorkspace`).
 *
 * Empty / whitespace-only selections are treated as no selection —
 * the empty string short-circuit avoids a `\n\n<URL>` body that would
 * read as "blank space, then URL".
 */
export function buildSilentCaptureBody(
  selection: string | null,
  url: string,
): string {
  if (selection === null || selection.trim() === "") {
    return url;
  }
  return `${selection.trim()}\n\n${url}`;
}
