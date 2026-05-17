/**
 * Pure helper that normalises a note's `location` string into a
 * renderable venue label. Used by every card surface (Notes / Links /
 * Tasks) through `buildLocationLine` in `app/view/shared/card-header.ts`,
 * so the strip-prefix + placeholder rules live in one place.
 *
 * Rules:
 *   1. Trim whitespace.
 *   2. Blank string → return `null` (caller skips the location chip).
 *   3. The lone `"—"` placeholder (the geo-permission's "user denied"
 *      sentinel) → return `null`. Without this guard the chip would
 *      render an em dash sitting next to a pin icon, which reads as
 *      "we know where you are but we won't say" — confusing.
 *   4. `"City — Venue"` shape → strip the leading `"City — "` prefix
 *      via the shortest-match regex `^.*?—\s*`, leaving just the
 *      venue. The non-greedy quantifier means a multi-segment
 *      location (`"State — City — Venue"`) only loses the outermost
 *      `"State — "` segment, preserving the inner `"City — Venue"`
 *      for follow-up display.
 *
 * DOM-free + side-effect-free so the renderers can call it on every
 * paint without memoising and the unit tests stay node-only.
 */
export function formatNoteLocation(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "—") return null;
  return trimmed.replace(/^.*?—\s*/, "");
}
