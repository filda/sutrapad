/**
 * Trims + truncates a note body into a one-paragraph blurb suitable for
 * any entity-card surface (Notes excerpt, Links description, future
 * Tasks summary). Step 6 of cards-unification — Notes used to inline its
 * own slice(0, 72), Links called `buildLinkCardDescription`. The two
 * paths converge here.
 *
 * - `stripUrl` removes a known URL from the body so the blurb isn't
 *   just the captured link rendered as plain text. Pass an empty string
 *   (or omit) to skip stripping. Notes typically skips this; Links
 *   always passes the URL it's describing.
 * - `maxChars` caps the rendered length. Notes uses ~72 chars (single
 *   line in the cards grid); Links uses 160 (CSS line-clamps the rest).
 *
 * Returns `null` when the trimmed-and-stripped body is empty — callers
 * then either render a placeholder (`"Empty note"` on Notes) or omit
 * the element entirely (Links).
 */
export interface CardExcerptOptions {
  /**
   * URL to strip out of the body. Empty string or omitted = no
   * stripping. The split/join shortcut on an empty url avoids a
   * subtle codepoint-by-codepoint split that would otherwise break
   * graphemes (emoji, combining diacritics) — see the inline note
   * below.
   */
  stripUrl?: string;
  /**
   * Maximum visible character count. Pre-truncation the result is
   * already collapsed to a single line, so the cap operates on the
   * flat blurb. The final character is replaced by an ellipsis when
   * the input overflows, so the total length stays at exactly
   * `maxChars`.
   */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 160;

export function buildCardExcerpt(
  body: string,
  options: CardExcerptOptions = {},
): string | null {
  const stripUrl = options.stripUrl ?? "";
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  // Remove the URL we're describing — the user already sees it on the
  // thumb chip / URL anchor for Links cards, so repeating it in the
  // blurb is noise. Preserve surrounding whitespace / punctuation so
  // "Read: <url> — fascinating" becomes "Read: — fascinating" rather
  // than "Read:fascinating".
  //
  // Defense-in-depth on the empty-url branch: `body.split("")` splits
  // *between every character* and `join("")` then re-stitches the body
  // codepoint-by-codepoint — a no-op for ASCII but a subtle grapheme-
  // splitter trap on emoji / combining-diacritic input. Call sites
  // today either pass a real URL or omit `stripUrl`; this is a guard
  // against a future regression rather than a hot path. Truncation
  // below still applies because we only short-circuit the split/join.
  const withoutUrl =
    stripUrl === "" ? body.trim() : body.split(stripUrl).join("").trim();
  if (withoutUrl === "") return null;

  // Collapse runs of whitespace to single spaces — the card body is a
  // single line visually (CSS line-clamp handles vertical overflow on
  // surfaces that allow it), so preserving paragraph breaks buys
  // nothing.
  const flattened = withoutUrl.replaceAll(/\s+/gu, " ");
  if (flattened.length <= maxChars) return flattened;

  // Hard truncate at `maxChars - 1` and append a single ellipsis
  // character (not three dots) so the line doesn't grow beyond the
  // caller-specified budget.
  return `${flattened.slice(0, maxChars - 1).trimEnd()}…`;
}
