import { parseTagName } from "./tag-class";

/**
 * Confidence heuristic for auto-tags. Every facet that `deriveAutoTags` emits
 * maps to a fixed 0..1 score, which the view layer turns into a `72%` badge on
 * the pill when the score is below the display threshold (see `LOW_CONFIDENCE_THRESHOLD`).
 *
 * The values are **not** measured — they're educated guesses about how
 * reliably each derivation reflects the user's intent:
 *
 *   - Timestamp/structural signals (`date`, `month`, `year`, `edit`, `tasks`,
 *     `source`) are 1.0 because the input is authoritative — a note's
 *     `createdAt` is what it is; either it has checkboxes or it doesn't.
 *   - Device/context signals (`device`, `os`, `browser`, `orientation`,
 *     `network`, `battery`) sit at 0.9–0.95 because the platform APIs self-
 *     report, but UA sniffing / connection-type reports sometimes lie.
 *   - Derived-from-text signals (`lang`, `author`) sit at 0.75–0.8 because
 *     page metadata is often stale or missing.
 *   - Engagement/threshold signals (`engagement`, `weather`, `scroll`,
 *     `location`) sit at 0.6–0.7. The bucketing rules are arbitrary cutoffs
 *     (what counts as "warm"? when is a scroll "middle"?) so the pill should
 *     read as a soft suggestion, not a fact.
 *
 * Keep this map aligned with `AUTO_FACET_TO_CLASS` in `tag-class.ts` — adding
 * a new facet to `deriveAutoTags` without an entry here falls through to
 * `UNKNOWN_FACET_CONFIDENCE`, which is deliberately below the threshold so
 * the UI flags the ambiguity until someone classifies it.
 */

/**
 * Pills with confidence below this threshold render the `NN%` badge and get
 * the dashed-border `low-conf` style. Pulled out as a named export so tests
 * (and future callers picking a higher/lower visual noise floor) can pin to
 * the same value the view reads.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Fallback for facets we don't know about. Deliberately below
 * `LOW_CONFIDENCE_THRESHOLD` so an unmapped facet visibly flags itself in
 * the UI — we'd rather over-badge than silently hide a new auto-tag.
 */
export const UNKNOWN_FACET_CONFIDENCE = 0.5;

const CONFIDENCE_BY_FACET: Readonly<Record<string, number>> = {
  // Timestamp-authoritative facets — the input is a stored number, no
  // interpretation layer to be wrong about.
  date: 1,
  month: 1,
  year: 1,
  edit: 1,

  // Structural parse of the body — deterministic and exact.
  tasks: 1,

  // We set `source` ourselves at capture time.
  source: 1,

  // Platform self-reports — strong but occasionally lie (UA strings, effective
  // network type is advisory, orientation can be `"landscape"` on a rotated
  // desktop). Still high enough that we don't visually flag them.
  device: 0.95,
  orientation: 0.95,
  browser: 0.9,
  os: 0.9,
  network: 0.9,
  battery: 0.9,

  // Page metadata — often missing, sometimes stale. We de-emphasise but
  // don't flag; anything that did make it through is usually right.
  lang: 0.8,
  author: 0.75,

  // Threshold- or heuristic-derived facets. Below the display threshold so
  // the badge appears; lets the user see these as soft reads, not ground
  // truth. Kept distinct so future tuning can move individual facets
  // without a global re-score.
  location: 0.7,
  scroll: 0.65,
  engagement: 0.6,
  weather: 0.6,
};

/**
 * Returns the confidence score (0..1) for an auto-tag. Callers pass the raw
 * namespaced string (`date:today`, `weather:warm`) — the facet is extracted
 * and looked up.
 *
 * Notes on the edge cases:
 *
 *   - A tag with no facet (plain word) is unusual for an auto-tag — all our
 *     auto-tags come out of `deriveAutoTags` namespaced. If one turns up, we
 *     return `UNKNOWN_FACET_CONFIDENCE` so the UI treats it as low-conf
 *     rather than pretending it's authoritative.
 *   - An unknown facet (e.g. a new one added to `deriveAutoTags` before this
 *     table learns about it) also falls through to
 *     `UNKNOWN_FACET_CONFIDENCE`. That's deliberate — better to visibly flag
 *     the new class until it's triaged.
 */
export function confidenceForAutoTag(tag: string): number {
  const { facet } = parseTagName(tag);
  if (facet === null) return UNKNOWN_FACET_CONFIDENCE;
  return CONFIDENCE_BY_FACET[facet] ?? UNKNOWN_FACET_CONFIDENCE;
}
