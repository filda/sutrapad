/**
 * Initials helper for the account-bar avatar fallback.
 *
 * When Google doesn't return a profile picture (or the URL fails to
 * load), the avatar circle currently rendered as a plain accent
 * gradient leaves the user wondering whose account they're looking at.
 * Showing initials over the same gradient turns it into an actual
 * identity hint — Filip's "FK" reads as "yes, you, signed in" the way
 * a faceless gradient never does.
 *
 * Convention:
 *   - Whitespace-separated words drive the split.
 *   - Single-word names produce one initial.
 *   - Multi-word names produce **first word + last word** initials so
 *     middle names don't crowd the chip — "Maria José Costa" → "MC",
 *     not "MJC". Two letters fit a 32 px circle without ad-hoc shrink.
 *   - Hyphenated names ("Anne-Marie") stay one word; the result is
 *     the first letter of the whole hyphenated chunk. Convention varies
 *     across products but consistency-with-self matters more than
 *     converging on whichever style; "Anne-Marie Smith" → "AS".
 *
 * The function is locale-aware via `toLocaleUpperCase()` so Czech
 * names (`žofie`, `řehoř`) capitalise correctly without a manual
 * uppercase table. Surrogate-pair-safe via `Array.from()` so an emoji
 * leading a name doesn't return half a codepoint.
 *
 * Always returns a string. An empty result (`""`) is the caller's
 * signal that the gradient should fall back to its glyph-less form;
 * the caller decides whether to omit the text node entirely or render
 * an empty span.
 */

/**
 * Returns up to two uppercased initials extracted from `name`. Empty
 * string when `name` is blank or has nothing usable. Pure: same input,
 * same output, no I/O.
 *
 * Examples:
 *   - `"Filip Krolupper"` → `"FK"`
 *   - `"Filip"`           → `"F"`
 *   - `"  Maria  José Costa  "` → `"MC"`
 *   - `"Anne-Marie Smith"`      → `"AS"`
 *   - `""`                      → `""`
 *   - `"   "`                    → `""`
 *   - `"žofie středníková"`     → `"ŽS"`
 */
export function formatInitials(name: string): string {
  // Defensive against tampered persisted-session payloads — the
  // TypeScript signature forbids non-strings, but `UserProfile.name`
  // arrives via JSON deserialisation and could be null at runtime.
  if (typeof name !== "string") return "";

  // Split on runs of whitespace and filter out the empty fragments
  // `String.prototype.split` produces at the start / end when the
  // input has leading or trailing spaces. The filter is the load-
  // bearing defence here: it lets us skip a separate `trim()` pass
  // (which would be redundant with the regex anyway) while still
  // collapsing surrounding whitespace into a clean word list.
  const words = name.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  if (words.length === 1) return firstGlyphUpper(words[0]);
  return firstGlyphUpper(words[0]) + firstGlyphUpper(words[words.length - 1]);
}

/**
 * First grapheme of `word`, locale-uppercased. Uses `Array.from` to
 * walk codepoints rather than UTF-16 code units, so a name leading
 * with an emoji or a surrogate-pair character ("𝓕ilip") doesn't
 * decompose into a half-character. Locale-uppercase so `i` → `İ` in
 * Turkish locales and `ž` → `Ž` in Czech, both of which the platform
 * `String.prototype.toUpperCase()` would mangle.
 *
 * Caller is expected to have filtered out empty strings (the public
 * API does this in the split+filter pass) — `Array.from("")[0]` is
 * `undefined` which would crash `toLocaleUpperCase()`. Keeping the
 * contract narrow lets us avoid a guard that's dead code given the
 * upstream filter.
 */
function firstGlyphUpper(word: string): string {
  return Array.from(word)[0].toLocaleUpperCase();
}
