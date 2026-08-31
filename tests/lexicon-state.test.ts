import { describe, expect, it } from "vitest";
import {
  acceptExact,
  createEmptyBuilderState,
  isEmptyState,
  listCandidates,
  listExistingTargets,
  mapForm,
  mergeImport,
  rejectForm,
} from "../src/app/logic/lexicon/state";

describe("createEmptyBuilderState", () => {
  it("returns a shape that satisfies isEmptyState", () => {
    expect(isEmptyState(createEmptyBuilderState())).toBe(true);
  });
});

describe("mergeImport", () => {
  it("aggregates token counts across imports", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "Praha praze Praha");
    expect(state.candidates.praha?.count).toBe(2);
    expect(state.candidates.praze?.count).toBe(1);
  });

  it("caps stored contexts at two per candidate", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "Praha jednou a podruhé Praha pak Praha potřetí.");
    state = mergeImport(state, "Praha o sto let později.");
    expect(state.candidates.praha?.contexts.length).toBe(2);
  });

  it("returns the original state reference when the import contributes no candidates", () => {
    const state = createEmptyBuilderState();
    // Only stoplist words + punctuation — nothing should remain.
    expect(mergeImport(state, "jsem jste a, b!")).toBe(state);
  });

  it("seeds a new candidate's contexts with the actual snippet, not an empty list", () => {
    const state = mergeImport(createEmptyBuilderState(), "I went to praha yesterday.");
    expect(state.candidates.praha?.contexts.length).toBe(1);
    expect(state.candidates.praha?.contexts[0]).toContain("praha");
  });

  it("ignores forms that already have a target", () => {
    let state = createEmptyBuilderState();
    state = mapForm(state, "praze", "praha");
    state = mergeImport(state, "Praze praze praze");
    expect(state.candidates.praze).toBeUndefined();
  });

  it("ignores forms in the rejected list", () => {
    let state = rejectForm(createEmptyBuilderState(), "bagr");
    state = mergeImport(state, "bagr bagr bagr");
    expect(state.candidates.bagr).toBeUndefined();
  });

  it("does not duplicate identical context snippets when bumping a count", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "praha");
    state = mergeImport(state, "praha");
    expect(state.candidates.praha?.contexts).toEqual(["praha"]);
    expect(state.candidates.praha?.count).toBe(2);
  });
});

describe("acceptExact", () => {
  it("creates a self-mapping and removes the candidate row", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "Praha praze");
    state = acceptExact(state, "praha");
    expect(state.forms.praha).toBe("praha");
    expect(state.candidates.praha).toBeUndefined();
  });
});

describe("mapForm", () => {
  it("records the requested target for the form", () => {
    const state = mapForm(createEmptyBuilderState(), "praze", "praha");
    expect(state.forms.praze).toBe("praha");
  });

  it("auto-adds a self-map for the new target so the canonical also resolves", () => {
    const state = mapForm(createEmptyBuilderState(), "praze", "praha");
    expect(state.forms.praha).toBe("praha");
  });

  it("does not overwrite an existing self-map on the target", () => {
    let state = acceptExact(createEmptyBuilderState(), "praha");
    state = mapForm(state, "praze", "praha");
    expect(state.forms.praha).toBe("praha");
  });

  it("does not add a self-map when the target already maps somewhere else", () => {
    // praha → city is unusual but the helper should not overwrite it
    // just because a new form chose praha-as-target.
    let state = mapForm(createEmptyBuilderState(), "praha", "city");
    state = mapForm(state, "praze", "praha");
    expect(state.forms.praha).toBe("city");
  });

  it("removes the candidate row for the form", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "praze praze");
    state = mapForm(state, "praze", "praha");
    expect(state.candidates.praze).toBeUndefined();
  });

  it("rehabilitates a previously rejected form when the user later maps it", () => {
    let state = rejectForm(createEmptyBuilderState(), "praze");
    state = mapForm(state, "praze", "praha");
    expect(state.rejectedForms).not.toContain("praze");
    expect(state.forms.praze).toBe("praha");
  });

  it("returns the state unchanged when form or target is empty", () => {
    const state = createEmptyBuilderState();
    expect(mapForm(state, "", "praha")).toBe(state);
    expect(mapForm(state, "praze", "")).toBe(state);
  });
});

describe("rejectForm", () => {
  it("adds to the rejected list and drops the candidate row", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "bagr bagr");
    state = rejectForm(state, "bagr");
    expect(state.rejectedForms).toContain("bagr");
    expect(state.candidates.bagr).toBeUndefined();
  });

  it("is idempotent on repeated rejections", () => {
    let state = rejectForm(createEmptyBuilderState(), "bagr");
    const before = state.rejectedForms;
    state = rejectForm(state, "bagr");
    expect(state.rejectedForms).toEqual(before);
  });

  it("returns the state unchanged for an empty form", () => {
    const state = createEmptyBuilderState();
    expect(rejectForm(state, "")).toBe(state);
  });

  it("does not undo an existing mapping", () => {
    let state = mapForm(createEmptyBuilderState(), "praze", "praha");
    state = rejectForm(state, "praze");
    expect(state.forms.praze).toBe("praha");
    expect(state.rejectedForms).not.toContain("praze");
  });
});

describe("listCandidates", () => {
  it("orders candidates by count descending then form alphabetically", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "Brno brno praze brno alfa");
    const list = listCandidates(state);
    expect(list[0]?.form).toBe("brno");
    expect(list[1]?.form).toBe("alfa");
    expect(list[2]?.form).toBe("praze");
  });

  it("uses cs-CZ collation for ties so 'č' sorts after 'c'", () => {
    let state = createEmptyBuilderState();
    state = mergeImport(state, "čára cara");
    const list = listCandidates(state);
    expect(list[0]?.form).toBe("cara");
    expect(list[1]?.form).toBe("čára");
  });
});

describe("listExistingTargets", () => {
  it("returns each target once, sorted with cs-CZ collation", () => {
    let state = createEmptyBuilderState();
    state = mapForm(state, "praze", "praha");
    state = mapForm(state, "psa", "pes");
    state = mapForm(state, "psovi", "pes");
    expect(listExistingTargets(state)).toEqual(["pes", "praha"]);
  });
});

describe("isEmptyState", () => {
  it("reports false once any state branch is non-empty", () => {
    expect(isEmptyState(rejectForm(createEmptyBuilderState(), "x"))).toBe(false);
    let state = createEmptyBuilderState();
    state = mergeImport(state, "praha");
    expect(isEmptyState(state)).toBe(false);
  });
});

describe("lexicon builder state — the paths the suite drives one-sided", () => {
  it("keeps the other rejected forms when one is rehabilitated by mapping", () => {
    // `rejectedForms.filter(entry => entry !== form)` — the suite only ever
    // rejects one form and then maps that same one, so a filter that dropped
    // EVERYTHING would look identical to one that dropped the right entry.
    let state = createEmptyBuilderState();
    state = rejectForm(state, "bagr");
    state = rejectForm(state, "kbelik");
    expect(state.rejectedForms).toEqual(["bagr", "kbelik"]);

    state = mapForm(state, "bagr", "bagr");
    expect(state.rejectedForms).toEqual(["kbelik"]);
  });

  it("leaves the rejected list untouched when the mapped form was never rejected", () => {
    let state = rejectForm(createEmptyBuilderState(), "bagr");
    state = mapForm(state, "praze", "praha");
    expect(state.rejectedForms).toEqual(["bagr"]);
  });

  it("keeps the other candidates when the mapped form is not a candidate", () => {
    // `removeCandidate`'s `return { ...candidates }` early arm. Mapping a form
    // that never appeared in an import must not empty the review queue.
    let state = mergeImport(createEmptyBuilderState(), "praze praze bagr bagr");
    const before = listCandidates(state).map((c) => c.form);
    expect(before.length).toBeGreaterThan(0);

    state = mapForm(state, "nikdy-neviděno", "cokoliv");
    expect(listCandidates(state).map((c) => c.form)).toEqual(before);
  });

  it("orders candidates by descending count, highest first", () => {
    // `right.count - left.count`, and the INPUT ORDER decides whether any
    // fixture can see it. `Object.entries` preserves insertion order, so the
    // low-count form has to be merged FIRST — only then does the sort have to
    // move something. Seeded the other way round, the mutated comparator
    // (`+`, always positive here) leaves the already-correct order alone and
    // is indistinguishable: with two elements the sort only ever asks
    // `compare(later, earlier)`, and both versions answer "after".
    let state = createEmptyBuilderState();
    state = mergeImport(state, "brne");
    state = mergeImport(state, "praze praze praze praze praze");

    expect(listCandidates(state).map((c) => [c.form, c.count])).toEqual([
      ["praze", 5],
      ["brne", 1],
    ]);
  });
});
