/**
 * Single gate for "we're about to put this string somewhere a URL is
 * fetched or rendered" — image `src`, `href`, or a CSS `url("…")` token.
 *
 * `httpUrlOrNull` accepts only absolute `http:` / `https:` URLs and returns
 * their canonical serialization (`URL.toString()`), so the result is
 * percent-encoded: raw quotes, spaces, `<`, `>` and control characters
 * can't survive into a quoted CSS `url("…")` or an attribute. Everything
 * else collapses to `null`: `javascript:`, `data:`, `blob:`, `vbscript:`,
 * relative paths, malformed input, and blanks. (`URL` parsing does the
 * trimming and empty-string rejection itself — it strips surrounding
 * whitespace and throws on empty / relative input — so there's no separate
 * trim/blank guard here.)
 *
 * This is the rendering-side counterpart to `clampHttpUrl` in
 * `capture-context-sanitize.ts`. That one runs at capture time and returns
 * the trimmed *original* (it's storing a value); this one runs at render
 * time and returns the *normalized* value (it's about to hit a DOM/CSS
 * sink), which is why the two coexist rather than share an implementation.
 */
export function httpUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.toString();
}
