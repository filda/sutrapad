/**
 * Picks a deterministic gradient-hue seed for a note's `.link-thumb` band.
 *
 * Background: the original seed was the URL's hostname, with a literal
 * `"sutrapad"` fallback for hand-typed (URL-less) notes. That fallback
 * meant every hand-typed note shared the same hue (≈ olive 25°), so a
 * Notes grid full of hand-typed entries read as a wall of identical
 * bands — visually it didn't feel "computed from the note" at all.
 *
 * This picker walks per-note metadata in a priority chain so every
 * note's hue is both deterministic *and* meaningfully tied to what's
 * on the card:
 *
 *   1. First user-typed (non-namespaced) tag — gives semantic clustering
 *      on the grid. Two `#trek` notes from different sources read as
 *      siblings even when they don't share a domain. Namespaced
 *      auto-tags (`location:…`, `source:…`, `device:…`) are skipped
 *      because they're already expressed via the persona's paper colour
 *      and would dilute the topical hue.
 *
 *   2. Primary URL hostname — preserves the "two captures of the same
 *      site wear the same hue" property the Links page already relies
 *      on. Uses `deriveNotePrimaryUrl` so the canonical URL (set by the
 *      bookmarklet from `<link rel="canonical">`) wins over a raw
 *      tracking-tail variant.
 *
 *   3. `note.id` — last-resort. Every note has one, every id hashes to
 *      a different hue, and a hand-typed-with-no-tags note still gets
 *      its own colour rather than collapsing into a shared fallback.
 *
 * DOM-free + side-effect-free so callers can call it on every paint
 * without memoising and tests stay node-only.
 */
import type { SutraPadDocument } from "../../types";
import { deriveLinkHostname } from "./link-card";
import { deriveNotePrimaryUrl } from "./note-primary-url";

export function pickNoteThumbSeed(note: SutraPadDocument): string {
  for (const tag of note.tags) {
    // Namespaced tags carry "class:value" — e.g. `location:vinohrady`,
    // `source:url-capture`. Those facets already drive other parts of
    // the persona (paper colour from when-bucket, font tier from
    // source); reusing them for the band hue would create a redundancy
    // band tells the same story the paper already does.
    if (tag.includes(":")) continue;
    // Lower-case the seed so `#AI` and `#ai` share a hue.
    if (tag.length > 0) return tag.toLowerCase();
  }

  const primaryUrl = deriveNotePrimaryUrl(note);
  if (primaryUrl !== null) {
    const hostname = deriveLinkHostname(primaryUrl);
    if (hostname !== null) return hostname;
    // Hostname parse failed (malformed URL) — fall through to the
    // raw string so the seed is still URL-derived rather than skipping
    // to `note.id` and losing the link-to-source signal entirely.
    return primaryUrl;
  }

  return note.id;
}
