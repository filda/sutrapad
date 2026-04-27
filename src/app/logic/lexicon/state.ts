/**
 * Pure state mutations for the Topic Lexicon Builder.
 *
 * Every helper returns a new immutable `BuilderState`. Callers feed the
 * result back into the page controller and queue a Drive autosave. Keeping
 * the helpers pure is the point — they're the easiest things to test and
 * mutate against, and the spec's edge cases (auto self-map on a manual
 * `praze -> praha` mapping, rejected-list dedup, candidate cleanup) all
 * land here.
 */
import {
  type BuilderCandidate,
  type BuilderState,
  createEmptyBuilderState,
} from "./types";
import { tokenizeImport } from "./tokenize";

const MAX_CONTEXTS_PER_CANDIDATE = 2;

/**
 * Folds an imported text into the working state's candidate queue. Forms
 * already mapped or already rejected are dropped during tokenization, so
 * imports never resurrect a decided form.
 *
 * Counts are bumped per occurrence (the spec calls them "approximate" — a
 * second import of the same text just bumps priority, no per-text dedup).
 * Each candidate keeps at most two short context snippets — first ones win
 * to make the order stable across repeated identical imports.
 */
export function mergeImport(state: BuilderState, text: string): BuilderState {
  const tokens = tokenizeImport(text, {
    knownForms: new Set(Object.keys(state.forms)),
    rejectedForms: new Set(state.rejectedForms),
  });
  if (tokens.length === 0) return state;

  const nextCandidates: Record<string, BuilderCandidate> = {};
  for (const [form, candidate] of Object.entries(state.candidates)) {
    nextCandidates[form] = candidate;
  }

  for (const token of tokens) {
    const previous = nextCandidates[token.form];
    if (previous) {
      // Cap context list at MAX so a long import doesn't blow up the JSON.
      const contexts =
        previous.contexts.length >= MAX_CONTEXTS_PER_CANDIDATE
          ? previous.contexts
          : previous.contexts.includes(token.context)
            ? previous.contexts
            : [...previous.contexts, token.context];
      nextCandidates[token.form] = {
        count: previous.count + 1,
        contexts,
      };
    } else {
      nextCandidates[token.form] = {
        count: 1,
        contexts: [token.context],
      };
    }
  }

  return { ...state, candidates: nextCandidates };
}

/** Records `form -> form`, dropping the candidate. */
export function acceptExact(state: BuilderState, form: string): BuilderState {
  return mapForm(state, form, form);
}

/**
 * Records `form -> target`. When `target` is a brand-new value (not already
 * present as another form's target and not equal to `form`), the spec asks
 * us to *also* add `target -> target` so the canonical form itself works as
 * a lookup. The candidate row for `form` is removed — the spec does not
 * keep "in-flight" rows after a decision.
 */
export function mapForm(
  state: BuilderState,
  form: string,
  target: string,
): BuilderState {
  if (!form || !target) return state;

  const nextForms: Record<string, string> = { ...state.forms, [form]: target };

  // Auto self-map: if the user maps `praze -> praha` and praha isn't yet
  // a recognised form, also add `praha -> praha` so the canonical itself
  // resolves at runtime. Skip when target === form (we just added that
  // self-map ourselves) or when target already lives in nextForms (some
  // earlier decision already covers it).
  if (target !== form && !Object.hasOwn(nextForms, target)) {
    nextForms[target] = target;
  }

  const nextCandidates = removeCandidate(state.candidates, form);
  // Ensure rejected list never disagrees with the live mapping — if the
  // user rehabilitates a previously-rejected form by mapping it, drop the
  // old rejection so it doesn't keep filtering future imports.
  const nextRejected = state.rejectedForms.includes(form)
    ? state.rejectedForms.filter((entry) => entry !== form)
    : state.rejectedForms;

  return {
    ...state,
    forms: nextForms,
    rejectedForms: nextRejected,
    candidates: nextCandidates,
  };
}

/**
 * Adds a form to the rejected list and removes the candidate row. A form
 * that's already mapped is left alone — Reject from the candidate queue
 * shouldn't undo an earlier mapping decision.
 */
export function rejectForm(state: BuilderState, form: string): BuilderState {
  if (!form) return state;
  if (Object.hasOwn(state.forms, form)) return state;

  const nextRejected = state.rejectedForms.includes(form)
    ? state.rejectedForms
    : [...state.rejectedForms, form];

  return {
    ...state,
    rejectedForms: nextRejected,
    candidates: removeCandidate(state.candidates, form),
  };
}

/**
 * Returns the candidate forms in priority order. The state stores
 * candidates as a record (so JSON stays hand-editable); the UI needs them
 * as an ordered list keyed by frequency.
 */
export function listCandidates(
  state: BuilderState,
): Array<{ form: string; count: number; contexts: readonly string[] }> {
  return Object.entries(state.candidates)
    .map(([form, candidate]) => ({
      form,
      count: candidate.count,
      contexts: candidate.contexts,
    }))
    .toSorted((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.form.localeCompare(right.form, "cs-CZ");
    });
}

/**
 * Returns every distinct target value currently mapped — drives the
 * target-input typeahead. Sorted alphabetically (cs-CZ collation) so the
 * suggestion order is stable.
 */
export function listExistingTargets(state: BuilderState): string[] {
  const seen = new Set<string>();
  for (const target of Object.values(state.forms)) {
    seen.add(target);
  }
  return [...seen].toSorted((left, right) => left.localeCompare(right, "cs-CZ"));
}

/** Used by the UI to decide whether to show the empty-state placeholder. */
export function isEmptyState(state: BuilderState): boolean {
  return (
    Object.keys(state.forms).length === 0 &&
    state.rejectedForms.length === 0 &&
    Object.keys(state.candidates).length === 0
  );
}

function removeCandidate(
  candidates: Readonly<Record<string, BuilderCandidate>>,
  form: string,
): Record<string, BuilderCandidate> {
  if (!Object.hasOwn(candidates, form)) {
    return { ...candidates };
  }
  const next: Record<string, BuilderCandidate> = {};
  for (const [otherForm, candidate] of Object.entries(candidates)) {
    if (otherForm !== form) next[otherForm] = candidate;
  }
  return next;
}

/** Re-export the empty-state factory so callers can import it from one place. */
export { createEmptyBuilderState };
