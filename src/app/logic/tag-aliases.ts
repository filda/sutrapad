import { buildTagIndexCached } from "../../lib/notebook";
import type {
  SutraPadTagEntry,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../../types";

/**
 * Tag hygiene — alias/merge suggestions surfaced on the Settings page.
 *
 * Why this lives as a pure module: the Settings "Tag hygiene" card renders
 * the list, but the heuristic (what counts as a duplicate, which name wins
 * as the canonical) is easier to unit-test in isolation from the DOM, and
 * the merge mutation is a pure workspace transformer so the full round-trip
 * (suggest → apply → suggestion-goes-away) can be exercised without
 * touching localStorage or Drive.
 *
 * Design decisions worth flagging because they cap the shape of what we'll
 * ever suggest:
 *
 *  - **User tags only.** Auto-tags (`device:mobile`, `date:2026-04-23`)
 *    regenerate from `deriveAutoTags` on every index rebuild, so merging
 *    them is incoherent — the "alias" would be re-created on the next
 *    rebuild. We filter `kind !== "auto"` at the input boundary
 *    (`kind === undefined` counts as user for pre-auto-tag data).
 *
 *  - **Count ≥ 2.** A singleton tag paired with a typo of itself is noise
 *    more often than a real duplicate (one-off misspellings that never
 *    recurred). The Graveyard already handles stale-and-singleton at the
 *    Tags page; hygiene skips them too.
 *
 *  - **Two fuzzy signals, OR-combined.** Normalized equality
 *    (trim/lowercase/diacritic-strip) catches "Café" / "café" / "CAFE".
 *    Levenshtein with a relative cap catches "café" / "coffee" but refuses
 *    "cat" / "dog". Neither dominates: normalized-equal handles the
 *    boring-but-common case, Levenshtein handles the interesting long-tail.
 *
 *  - **Co-occurrence is a boost, not a gate.** If a candidate cluster's
 *    tags share at least one note, the reason text calls it out — but a
 *    pair of likely duplicates that never co-occur still surfaces. Making
 *    co-occurrence a requirement would hide the most useful case: two
 *    spellings used exclusively of each other.
 *
 *  - **Dismissed pairs are excluded at the output boundary.** Marking
 *    A ↔ B as "Keep separate" stops the Merge arrow from ever drawing
 *    A→B, but a third tag C that fuzzy-matches both can still pull them
 *    into the same cluster through different arrows. To respect the
 *    explicit "keep separate" intent, aliases whose pair-with-canonical is
 *    dismissed are filtered out — if that empties the cluster, the whole
 *    suggestion drops.
 */

const STORAGE_KEY = "sutrapad-dismissed-tag-aliases";

const DEFAULT_MAX_EDIT_DISTANCE = 2;
const DEFAULT_MAX_RELATIVE_DISTANCE = 0.34;

export interface AliasSuggestion {
  /** Highest-count tag in the cluster. The survivor if the user merges. */
  readonly canonical: string;
  /** Every other tag in the cluster, ordered count-desc then alpha. */
  readonly aliases: readonly string[];
  /** Human-readable reason shown under the heading. */
  readonly reason: string;
}

export interface SuggestionOptions {
  /** Pairs the user has dismissed via "Keep separate". Skipped from output. */
  readonly dismissed?: ReadonlySet<string>;
  /** Edit-distance ≤ this qualifies a pair. Default 2. */
  readonly maxEditDistance?: number;
  /** Relative distance (edit / longer length) ≤ this. Default 0.34. */
  readonly maxRelativeDistance?: number;
}

/**
 * Normalizes a tag for shape-based comparison: trims, lowercases, and
 * strips combining diacritical marks via NFD decomposition. Strictly for
 * comparison — the reverse isn't meaningful and display code should keep
 * using the raw tag string.
 */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036F]/gu, "");
}

/**
 * Standard Levenshtein edit distance (insertion / deletion / substitution
 * each cost 1). Two-row DP keeps the memory bounded even for very long
 * tags; realistically our inputs are single-word tags and the performance
 * is moot. The shape is classic enough that the tests pin a handful of
 * canonical values rather than re-deriving the algorithm.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current: number[] = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1, // insertion
        previous[j] + 1, // deletion
        previous[j - 1] + cost, // substitution
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

/**
 * Order-independent key for a dismissed pair — the lexicographically
 * smaller tag comes first. Used both for serialization and for the in-
 * memory Set so `dismissedPairKey("a","b") === dismissedPairKey("b","a")`.
 * The `|` separator was picked because tags come from `note.tags`, which
 * is already lowercased + hashtag-parsed and doesn't contain the
 * character in normal use.
 */
export function dismissedPairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

interface FuzzyMatch {
  matched: boolean;
  /** True when the strings differ only in case / diacritics. */
  normalizedEqual: boolean;
}

function isFuzzyMatch(
  a: string,
  b: string,
  maxEdit: number,
  maxRel: number,
): FuzzyMatch {
  const na = normalizeTag(a);
  const nb = normalizeTag(b);
  if (na === nb) {
    // Normalized forms match. If the raw strings also match, the caller is
    // comparing a tag with itself — not a suggestion.
    return { matched: a !== b, normalizedEqual: a !== b };
  }
  const distance = levenshtein(na, nb);
  if (distance > maxEdit) return { matched: false, normalizedEqual: false };
  const longerLen = Math.max(na.length, nb.length);
  // Guard against division by zero — a zero-length normalized form only
  // happens for all-whitespace / all-diacritic input, which we'd rather
  // not auto-merge anyway.
  if (longerLen === 0) return { matched: false, normalizedEqual: false };
  if (distance / longerLen > maxRel) {
    return { matched: false, normalizedEqual: false };
  }
  return { matched: true, normalizedEqual: false };
}

/**
 * How many characters this tag may have to lose before it can meet a
 * partner on common ground — see {@link candidatePairs}.
 *
 * Deliberately a conservative upper bound. The allowance belongs to a
 * *pair* (`min(maxEdit, floor(maxRel × longerLen))`) and can't be known
 * while indexing one tag alone, so we assume the most generous partner
 * this tag could have: a pair's length difference is a lower bound on its
 * edit distance, so no partner is ever more than `maxEdit` characters
 * longer. Over-generating variants only costs a few buckets; under-
 * generating would drop real suggestions, which is the one failure mode
 * that must not happen here.
 */
function maxDeletions(length: number, maxEdit: number, maxRel: number): number {
  return Math.min(maxEdit, Math.floor(maxRel * (length + maxEdit)));
}

/**
 * Every string reachable from `value` by deleting at most `deletions`
 * characters, including `value` itself. Deduplicated: "aab" loses either
 * 'a' to the same "ab".
 */
function deletionVariants(value: string, deletions: number): Set<string> {
  const variants = new Set<string>([value]);
  let frontier: string[] = [value];
  for (let round = 0; round < deletions; round += 1) {
    const next: string[] = [];
    for (const item of frontier) {
      for (let at = 0; at < item.length; at += 1) {
        const shorter = item.slice(0, at) + item.slice(at + 1);
        if (variants.has(shorter)) continue;
        variants.add(shorter);
        next.push(shorter);
      }
    }
    frontier = next;
  }
  return variants;
}

/**
 * Yields every pair of candidate tags that could possibly fuzzy-match,
 * each pair once, in candidate order. A *superset* of the real matches —
 * the caller still runs {@link isFuzzyMatch} on what comes out, so the
 * result is exactly what the naive all-pairs loop produced.
 *
 * Why this exists: the all-pairs loop it replaced ran `levenshtein` on
 * every one of the `T × (T − 1) / 2` pairs, and Settings recomputes the
 * suggestions on *every* render. Measured on 2026-09-14 against the
 * shape of the real notebook: 200 tags → 42 ms, 1 000 → 0.9 s, 1 900 →
 * 3.8 s, 3 500 → 11 s. That quadratic was the whole of the reported
 * "Settings renders take 3 s" — the rest of the render is ~110 ms.
 *
 * The blocking key is the deletion neighbourhood (SymSpell's index, same
 * idea as a BK-tree but cheaper to build): if `levenshtein(x, y) ≤ d`
 * then deleting at most `d` characters from each yields the *same*
 * string — every substitution drops its character on both sides, every
 * insertion drops it on the longer side. So two tags that can match
 * always share a bucket, and tags that share no bucket cannot match.
 * Buckets are keyed on the normalized form, which also puts
 * case/diacritic twins ("Café" / "cafe") in the same bucket for free.
 *
 * Exported for the NFR property in `tests/nfr/node/tag-hygiene-cost.test.ts`,
 * which counts what comes out of it: comparisons made is the work this
 * layer measures, since the plan keeps wall-clock out of CI.
 */
export function* candidatePairs(
  candidates: readonly SutraPadTagEntry[],
  maxEdit: number,
  maxRel: number,
): Generator<readonly [string, string]> {
  const byVariant = new Map<string, number[]>();
  for (let index = 0; index < candidates.length; index += 1) {
    const normalized = normalizeTag(candidates[index].tag);
    const variants = deletionVariants(
      normalized,
      maxDeletions(normalized.length, maxEdit, maxRel),
    );
    for (const variant of variants) {
      const bucket = byVariant.get(variant);
      if (bucket) bucket.push(index);
      else byVariant.set(variant, [index]);
    }
  }

  // A pair can share several variants ("cafe"/"café" meet under both
  // "caf" and "cae"), so pairs are de-duplicated before they reach the
  // caller — otherwise the same match would be recorded twice.
  const seen = new Set<string>();
  for (const bucket of byVariant.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const key = `${bucket[left]}:${bucket[right]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        yield [candidates[bucket[left]].tag, candidates[bucket[right]].tag];
      }
    }
  }
}

/**
 * Simple disjoint-set / union-find keyed by tag string. Used to cluster
 * fuzzy-match pairs into transitive groups — "cafe" ~ "café" ~ "coffee"
 * collapses into one cluster. Path compression + union-by-rank would be
 * overkill at this scale; the naive form is easier to read.
 */
class UnionFind {
  private readonly parent = new Map<string, string>();

  add(tag: string): void {
    if (!this.parent.has(tag)) this.parent.set(tag, tag);
  }

  findRoot(tag: string): string {
    let current = tag;
    let next = this.parent.get(current);
    while (next !== undefined && next !== current) {
      current = next;
      next = this.parent.get(current);
    }
    return current;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.findRoot(a);
    const rootB = this.findRoot(b);
    if (rootA === rootB) return;
    this.parent.set(rootA, rootB);
  }
}

/**
 * Returns the alias suggestions for the given user-tag index. See the
 * module-level comment for the full rule set. Output is deterministic:
 * clusters are sorted by canonical tag name; within a cluster, aliases
 * are ordered count-desc then alpha.
 */
export function suggestTagAliases(
  index: SutraPadTagIndex,
  options: SuggestionOptions = {},
): AliasSuggestion[] {
  const dismissed = options.dismissed ?? new Set<string>();
  const maxEdit = options.maxEditDistance ?? DEFAULT_MAX_EDIT_DISTANCE;
  const maxRel =
    options.maxRelativeDistance ?? DEFAULT_MAX_RELATIVE_DISTANCE;

  // Only user-kind, count ≥ 2. Missing `kind` is treated as "user"
  // (back-compat with pre-auto-tag index data — see types.ts).
  const candidates = index.tags.filter(
    (entry) =>
      (entry.kind === undefined || entry.kind === "user") &&
      entry.count >= 2,
  );
  if (candidates.length < 2) return [];

  const byTag = new Map<string, SutraPadTagEntry>();
  for (const entry of candidates) byTag.set(entry.tag, entry);

  const union = new UnionFind();
  for (const entry of candidates) union.add(entry.tag);

  // Record signals per pair, union them, then consolidate per-cluster
  // once all unions have completed. Recording per final root during the
  // loop would be racy because the root changes under further unions.
  const pairs: Array<{ a: string; normalizedEqual: boolean }> = [];
  for (const [a, b] of candidatePairs(candidates, maxEdit, maxRel)) {
    if (dismissed.has(dismissedPairKey(a, b))) continue;
    const match = isFuzzyMatch(a, b, maxEdit, maxRel);
    if (!match.matched) continue;
    pairs.push({ a, normalizedEqual: match.normalizedEqual });
    union.union(a, b);
  }

  const rootHasNormalized = new Map<string, boolean>();
  const rootHasLevenshtein = new Map<string, boolean>();
  for (const { a, normalizedEqual } of pairs) {
    const root = union.findRoot(a);
    if (normalizedEqual) rootHasNormalized.set(root, true);
    else rootHasLevenshtein.set(root, true);
  }

  // Bucket tags by cluster root. Singleton clusters (no pair triggered)
  // are dropped.
  const clusters = new Map<string, string[]>();
  for (const entry of candidates) {
    const root = union.findRoot(entry.tag);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(entry.tag);
    else clusters.set(root, [entry.tag]);
  }

  const suggestions: AliasSuggestion[] = [];
  for (const [root, tags] of clusters) {
    if (tags.length < 2) continue;

    const sorted = tags.toSorted((left, right) => {
      const leftEntry = byTag.get(left);
      const rightEntry = byTag.get(right);
      if (!leftEntry || !rightEntry) return 0;
      return (
        rightEntry.count - leftEntry.count || left.localeCompare(right)
      );
    });
    const [canonical, ...rawAliases] = sorted;

    // Respect explicit dismiss: if a tag's pair-with-canonical is
    // dismissed, filter it out even though it reached the cluster through
    // a third party. Dropping the whole cluster would lose legitimate
    // merges; dropping just the dismissed aliases keeps the rest.
    //
    // This cannot empty the list, which is why there is no guard for that case
    // — there was one until 2026-08-29 and it was unreachable. Emptying it
    // would mean every alias is dismissed against the canonical, and each of
    // those dismissals is exactly what stops the canonical from joining the
    // cluster in the first place: the pair is skipped above, before it can
    // union. A canonical that is in a cluster got there through some
    // undismissed pair, and that partner always survives this filter.
    const aliases = rawAliases.filter(
      (alias) => !dismissed.has(dismissedPairKey(canonical, alias)),
    );

    // Co-occurrence is computed over the _surviving_ cluster — if the
    // only shared note was between the canonical and a dismissed alias,
    // the boost shouldn't apply.
    const survivingEntries: SutraPadTagEntry[] = [canonical, ...aliases]
      .map((tag) => byTag.get(tag))
      .filter((entry): entry is SutraPadTagEntry => entry !== undefined);
    const coOccurs = clusterCoOccurs(survivingEntries);

    suggestions.push({
      canonical,
      aliases,
      reason: buildReason({
        normalizedEqual: rootHasNormalized.get(root) ?? false,
        hasLevenshtein: rootHasLevenshtein.get(root) ?? false,
        coOccurs,
      }),
    });
  }

  // Stable output order — Settings card reads consistently across renders.
  suggestions.sort((left, right) =>
    left.canonical.localeCompare(right.canonical),
  );
  return suggestions;
}

/**
 * The only thing the suggestions depend on: which user tags exist and how
 * often, in index order. Deliberately *not* the workspace object — editing
 * a note's body, an autosave and a Drive refresh all replace the workspace
 * while leaving the tag space untouched, and keying on the object would
 * make every one of those pay the full derivation again on the next
 * Settings render.
 */
function tagSpaceSignature(index: SutraPadTagIndex): string {
  const parts: string[] = [];
  for (const entry of index.tags) {
    if (entry.kind !== undefined && entry.kind !== "user") continue;
    if (entry.count < 2) continue;
    parts.push(`${entry.tag}:${entry.count}`);
  }
  return parts.join(" ");
}

let cachedSignature: string | null = null;
let cachedDismissed: ReadonlySet<string> | null = null;
let cachedSuggestions: readonly AliasSuggestion[] = [];

/**
 * Alias suggestions for a whole workspace, memoized on the tag space and
 * the dismissed set.
 *
 * The render path needs this. Settings recomputes the hygiene card on
 * every render and the home hint banner asks the same question for its
 * "you have duplicate tags" candidate; without the memo, every keystroke
 * and every tag chip click pays the full derivation again. Callers that
 * hold an index rather than a workspace (tests, the merge round-trip)
 * keep using {@link suggestTagAliases} directly.
 *
 * One entry is enough: there is one live workspace, and the question is
 * only ever asked about it.
 */
export function suggestTagAliasesForWorkspace(
  workspace: SutraPadWorkspace,
  dismissed: ReadonlySet<string>,
): readonly AliasSuggestion[] {
  const index = buildTagIndexCached(workspace);
  const signature = tagSpaceSignature(index);
  if (signature === cachedSignature && dismissed === cachedDismissed) {
    return cachedSuggestions;
  }
  cachedSuggestions = suggestTagAliases(index, { dismissed });
  cachedSignature = signature;
  cachedDismissed = dismissed;
  return cachedSuggestions;
}

/**
 * Do the tags in this cluster ever appear on the same note?
 *
 * **The `< 2` guard is unreachable and stays anyway** (decision, 2026-08-31).
 * Every caller builds `entries` from a cluster that already has a canonical
 * plus at least one alias, so the length is always >= 2 — which is why both
 * mutants on this line survive and no fixture can kill them.
 *
 * It is kept because removing it does not simplify anything: the line below
 * reads `entries[0].noteIds`, so without the guard an empty array throws
 * instead of answering `false`. Paying two unkillable mutants for a function
 * that cannot be made to explode is the same trade as the `nonEmpty > 0`
 * guard in `lib/detect-kind.ts` — see docs/mutation-survivor-triage.md,
 * source finding 5.
 */
function clusterCoOccurs(entries: readonly SutraPadTagEntry[]): boolean {
  if (entries.length < 2) return false;
  const accumulator = new Set(entries[0].noteIds);
  for (let i = 1; i < entries.length; i += 1) {
    for (const noteId of entries[i].noteIds) {
      if (accumulator.has(noteId)) return true;
    }
    for (const noteId of entries[i].noteIds) accumulator.add(noteId);
  }
  return false;
}

function buildReason(signals: {
  normalizedEqual: boolean;
  hasLevenshtein: boolean;
  coOccurs: boolean;
}): string {
  const parts: string[] = [];
  if (signals.normalizedEqual) {
    parts.push("same spelling after case and diacritics");
  }
  if (signals.hasLevenshtein) {
    parts.push("near-identical spelling");
  }
  if (signals.coOccurs) {
    parts.push("used together on at least one note");
  }
  if (parts.length === 0) return "Looks like a duplicate";
  const joined = parts.join("; ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Parses the stored CSV of dismissed-pair keys. Missing slot → empty set
 * (no pairs dismissed). Entries are validated structurally — each must
 * contain a `|` separator — so a corrupt storage value doesn't sneak into
 * the dismissed set and silently swallow suggestions.
 */
export function loadDismissedTagAliases(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): Set<string> {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return new Set();
  // No outer `trim()` and no empty-string early return: both were subsumed by
  // the per-part `trim()` plus the `includes("|")` filter below, which discards
  // empty and whitespace-only parts anyway. Removed 2026-08-29 — a `""` or
  // `"   "` slot still yields an empty set, by the same path as a corrupt one.
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.includes("|")),
  );
}

/**
 * Writes the dismissed set as a sorted CSV of pair keys. Sorting keeps
 * the on-disk form stable across toggles (dismissing A|B then C|D
 * produces the same string regardless of which order the toggles ran).
 */
export function persistDismissedTagAliases(
  dismissed: ReadonlySet<string>,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  const serialized = [...dismissed].toSorted().join(",");
  storage.setItem(STORAGE_KEY, serialized);
}

/** Convenience mirror of the `resolveInitialX` pattern elsewhere. */
export function resolveInitialDismissedTagAliases(
  storage?: Pick<Storage, "getItem">,
): Set<string> {
  return loadDismissedTagAliases(storage);
}

/** Pure set-producer for the "Keep separate" button. */
export function addDismissedTagAlias(
  current: ReadonlySet<string>,
  a: string,
  b: string,
): Set<string> {
  const next = new Set(current);
  next.add(dismissedPairKey(a, b));
  return next;
}

/**
 * Pure workspace mutation: returns a new workspace where every occurrence
 * of `from` in a note's `tags` has been replaced by `to`. Notes that
 * already carry `to` get the `from` entry removed (no duplicates). Touched
 * notes get a fresh `updatedAt` string from `now` so the auto-save
 * pipeline notices them. Non-touched notes are returned by reference
 * (structural sharing); the top-level workspace is always a new object
 * so callers comparing by identity still see the change.
 */
export function mergeTagInWorkspace(
  workspace: SutraPadWorkspace,
  from: string,
  to: string,
  now: Date = new Date(),
): SutraPadWorkspace {
  if (from === to) return workspace;
  const stamp = now.toISOString();
  let changed = false;
  const notes = workspace.notes.map((note) => {
    if (!note.tags.includes(from)) return note;
    const nextTags: string[] = [];
    const seen = new Set<string>();
    for (const tag of note.tags) {
      const replaced = tag === from ? to : tag;
      if (seen.has(replaced)) continue;
      seen.add(replaced);
      nextTags.push(replaced);
    }
    changed = true;
    return {
      ...note,
      tags: nextTags,
      updatedAt: stamp,
    };
  });
  if (!changed) return workspace;
  return { ...workspace, notes };
}
