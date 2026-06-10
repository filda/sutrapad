/**
 * Pure helpers for the Links page's card layout. Kept DOM-free so the
 * card renderer stays presentational and the derivations are
 * unit-testable without jsdom.
 *
 * Ported from handoff v2 (`docs/design_handoff_sutrapad2/src/screen_rest.jsx`
 * — the `LinksScreen` grid with gradient thumbs + title/desc/meta).
 * The handoff uses a hard-coded `l.hue` on each mock link; we derive
 * it from the hostname so two captures of the same domain share the
 * same thumb colour in the wild.
 */

/**
 * Extracts a display-friendly hostname from a URL. Strips the leading
 * `www.` so "www.nytimes.com" reads as "nytimes.com" — the handoff's
 * thumb chip shows the trimmed form, and the thumb gradient is hashed
 * off the same string so bare-domain and www-domain hashes don't
 * diverge.
 *
 * Returns `null` when `url` can't be parsed (e.g. a malformed capture
 * from an old workspace). Callers render a placeholder in that case.
 */
export function deriveLinkHostname(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.hostname.replace(/^www\./u, "");
}

/**
 * Deterministic djb2-style hash → hue in [0, 360). Used to tint each
 * link-thumb gradient off the hostname, so the same domain gets the
 * same colour every render. djb2 is cheap, has decent distribution
 * for short strings, and is stable across JS engines — good enough for
 * a cosmetic hue bucket.
 */
export function hashStringToHue(input: string): number {
  // djb2 seed. The specific magic number matters less than consistency:
  // as long as the constants don't drift, existing users keep the same
  // colours they had yesterday.
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    // `(hash * 33) ^ c`, but with `<< 5 + hash` to keep the result as
    // a 32-bit-ish integer (no Math.imul so we stay legible — modern
    // engines optimise the shift/add form fine).
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    // Mask to 31-bit so negative numbers don't sneak in after ^.
    hash &= 0x7fffffff;
  }
  return hash % 360;
}

/*
 * Card excerpt logic lives in `src/app/logic/card-excerpt.ts` (Step 6 of
 * cards-unification — Notes and Links share the same trim/strip/truncate
 * pipeline). Callers import `buildCardExcerpt` directly from there.
 */
