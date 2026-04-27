/**
 * Runtime lexicon generator.
 *
 * Collapses the working `BuilderState` into the on-disk `RuntimeLexicon`
 * shape used at production lookup time. The conversion is deterministic —
 * given the same `forms` map, the output bytes are identical, which makes
 * commit-diffing the generated file (when it eventually gets copied into
 * the repo) actually meaningful.
 *
 * Indices are local to one snapshot. The generated `forms` record maps a
 * form to an index into the `tags` array; consumers MUST read `tags` from
 * the same file. If the lexicon is regenerated and a tag's index changes,
 * that's expected.
 */
import type { BuilderState, RuntimeLexicon } from "./types";

export function generateRuntimeLexicon(state: BuilderState): RuntimeLexicon {
  // Collect distinct targets and sort them deterministically once so
  // both the `tags` array and the form-index lookup share a single
  // ordering. Any target that appears as a value in `state.forms`
  // ends up in `tags`, so the index lookup below is provably
  // exhaustive — no defensive branch needed.
  const targetSet = new Set<string>(Object.values(state.forms));
  const tags = [...targetSet].toSorted((left, right) =>
    left.localeCompare(right, "cs-CZ"),
  );
  const tagIndex = new Map<string, number>();
  for (const [index, tag] of tags.entries()) {
    tagIndex.set(tag, index);
  }

  // Same cs-CZ collation for the forms keys so consumers that scan the
  // file by hand see a stable, predictable ordering.
  const orderedFormEntries = Object.entries(state.forms).toSorted(
    ([leftForm], [rightForm]) => leftForm.localeCompare(rightForm, "cs-CZ"),
  );
  const forms: Record<string, number> = {};
  for (const [form, target] of orderedFormEntries) {
    // `tagIndex` was just built from the same `state.forms` values, so
    // every `target` is in the map. The `??` fallback is unreachable in
    // practice but keeps TypeScript honest without an `as` cast.
    forms[form] = tagIndex.get(target) ?? 0;
  }

  return {
    version: 1,
    locale: "cs-CZ",
    tags,
    forms,
  };
}
