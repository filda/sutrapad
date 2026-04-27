/**
 * Pure ranking helper for the lexicon-page target typeahead.
 *
 * Lives outside the page module so the cs-CZ locale rules and rank
 * order can be pinned by tests without going through the DOM. The
 * page wraps this in a tiny custom typeahead because the native HTML
 * `<datalist>` flow was eating in-flight keystrokes when the user
 * typed quickly — see `lexicon-page.ts` for the surrounding view
 * logic.
 *
 * Ranking rules:
 *
 *   - empty query → return up to `limit` targets in their input order;
 *   - non-empty query → cs-CZ lower-case substring match against each
 *     target, partitioned into "starts with the query" first and
 *     "contains it elsewhere" second, then sliced to `limit`. The
 *     partitioning preserves the input order inside each group, so the
 *     caller controls the secondary tiebreaker by passing pre-sorted
 *     `allTargets`.
 *
 * The helper intentionally does not deduplicate — that's the caller's
 * responsibility (in practice `listExistingTargets` already does it).
 */
export function filterTargetSuggestions(
  query: string,
  allTargets: readonly string[],
  limit: number,
): string[] {
  if (limit <= 0 || allTargets.length === 0) return [];
  const normalised = query.trim().toLocaleLowerCase("cs-CZ");
  if (normalised === "") return allTargets.slice(0, limit);

  const startsWith: string[] = [];
  const includes: string[] = [];
  for (const target of allTargets) {
    const lower = target.toLocaleLowerCase("cs-CZ");
    if (lower.startsWith(normalised)) {
      startsWith.push(target);
    } else if (lower.includes(normalised)) {
      includes.push(target);
    }
  }
  return [...startsWith, ...includes].slice(0, limit);
}
