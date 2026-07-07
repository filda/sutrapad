/**
 * Headline derivation for notes with no explicit title.
 *
 * Imported notes (and any future title-less note) carry their text in the
 * body with an empty `title`. Rather than showing "Untitled note" and then
 * repeating the body in the excerpt, list surfaces use the body's first
 * non-blank line as the headline and drop that line from the excerpt so the
 * text reads once. The editable detail title stays empty (its placeholder
 * shows), so nothing is duplicated there either.
 */

/** First non-blank line of `body`, trimmed. Empty string when the body is blank. */
export function firstBodyLine(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/**
 * The body with its headline line (the first non-blank line) removed, so an
 * excerpt built from it does not repeat the headline. Leading blank lines are
 * dropped; the remainder is returned verbatim (trimmed at the start).
 */
export function bodyAfterHeadline(body: string): string {
  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length && lines[index].trim().length === 0) {
    index += 1;
  }
  // Skip the headline line itself, then return whatever follows.
  return lines.slice(index + 1).join("\n").trim();
}
