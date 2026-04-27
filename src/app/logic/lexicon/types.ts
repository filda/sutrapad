/**
 * Topic Lexicon Builder — shared shapes.
 *
 * The builder is an internal workbench described in `docs/dictionary-builder.md`.
 * Two artifacts live on Drive: the editable working state (`BuilderState`)
 * and the runtime lookup file (`RuntimeLexicon`) that production code will
 * eventually copy out of Drive into the repo. The two shapes intentionally
 * differ:
 *
 *   - `BuilderState` keeps mappings as `string -> string` so the JSON stays
 *     hand-editable and diffable in Drive.
 *   - `RuntimeLexicon` collapses the same data into a deduplicated
 *     `tags` array plus numeric indices on `forms`, optimised for size and
 *     lookup speed at runtime.
 *
 * Indices in the runtime file are local to one generated snapshot — they
 * are not stable across regenerations, and consumers must always read
 * `tags` from the same file they read `forms` from.
 */

/** Top-level builder file. Hand-editable JSON on Drive. */
export interface BuilderState {
  readonly version: 1;
  /** Curated `form -> target` mapping. */
  readonly forms: Readonly<Record<string, string>>;
  /** Forms the user has rejected; kept so they don't reappear in candidates. */
  readonly rejectedForms: readonly string[];
  /** Aggregated import frequencies, keyed by form. */
  readonly candidates: Readonly<Record<string, BuilderCandidate>>;
}

export interface BuilderCandidate {
  /** Approximate occurrence count across imports — priority signal, not exact. */
  readonly count: number;
  /** Up to two short context snippets surrounding the form. */
  readonly contexts: readonly string[];
}

/** Generated lookup file. Optimised for size + numeric index lookup. */
export interface RuntimeLexicon {
  readonly version: 1;
  readonly locale: "cs-CZ";
  /** Unique target values, deterministically sorted. */
  readonly tags: readonly string[];
  /** Each form maps to an index into `tags`. */
  readonly forms: Readonly<Record<string, number>>;
}

/** Initial state for a fresh builder. */
export function createEmptyBuilderState(): BuilderState {
  return {
    version: 1,
    forms: {},
    rejectedForms: [],
    candidates: {},
  };
}
