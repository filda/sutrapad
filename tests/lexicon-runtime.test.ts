import { describe, expect, it } from "vitest";
import {
  acceptExact,
  createEmptyBuilderState,
  mapForm,
} from "../src/app/logic/lexicon/state";
import { generateRuntimeLexicon } from "../src/app/logic/lexicon/runtime";

describe("generateRuntimeLexicon", () => {
  it("produces an empty lexicon for an empty state", () => {
    expect(generateRuntimeLexicon(createEmptyBuilderState())).toEqual({
      version: 1,
      locale: "cs-CZ",
      tags: [],
      forms: {},
    });
  });

  it("collapses all unique target values into the tags array", () => {
    let state = mapForm(createEmptyBuilderState(), "praze", "praha");
    state = mapForm(state, "psa", "pes");
    state = mapForm(state, "psovi", "pes");
    const runtime = generateRuntimeLexicon(state);
    expect(runtime.tags).toEqual(["pes", "praha"]);
  });

  it("maps every form to the index of its target in tags", () => {
    let state = mapForm(createEmptyBuilderState(), "praze", "praha");
    state = mapForm(state, "psa", "pes");
    const runtime = generateRuntimeLexicon(state);
    expect(runtime.forms.praze).toBe(runtime.tags.indexOf("praha"));
    expect(runtime.forms.psa).toBe(runtime.tags.indexOf("pes"));
  });

  it("includes the auto-self-mapped target form in the runtime", () => {
    // mapForm adds praha -> praha automatically when praze -> praha
    // creates a brand-new target.
    const state = mapForm(createEmptyBuilderState(), "praze", "praha");
    const runtime = generateRuntimeLexicon(state);
    expect(runtime.forms.praha).toBe(runtime.tags.indexOf("praha"));
    expect(runtime.forms.praze).toBe(runtime.tags.indexOf("praha"));
  });

  it("is deterministic — repeated runs produce identical output", () => {
    let state = createEmptyBuilderState();
    state = mapForm(state, "praze", "praha");
    state = acceptExact(state, "brno");
    state = mapForm(state, "psa", "pes");
    const first = generateRuntimeLexicon(state);
    const second = generateRuntimeLexicon(state);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("orders tags alphabetically with cs-CZ collation", () => {
    let state = mapForm(createEmptyBuilderState(), "x1", "čára");
    state = mapForm(state, "x2", "cara");
    const runtime = generateRuntimeLexicon(state);
    expect(runtime.tags).toEqual(["cara", "čára"]);
  });

  it("orders forms alphabetically with cs-CZ collation in the output object", () => {
    let state = createEmptyBuilderState();
    state = mapForm(state, "psa", "pes");
    state = mapForm(state, "praze", "praha");
    const runtime = generateRuntimeLexicon(state);
    // Object.keys preserves insertion order in modern engines, and the
    // generator inserts in cs-CZ-sorted order so consumers reading the
    // file see a predictable ordering.
    expect(Object.keys(runtime.forms)).toEqual([
      "pes",
      "praha",
      "praze",
      "psa",
    ]);
  });

  it("emits exactly one tag per unique target across many forms", () => {
    let state = createEmptyBuilderState();
    state = mapForm(state, "psa", "pes");
    state = mapForm(state, "psovi", "pes");
    state = mapForm(state, "psem", "pes");
    const runtime = generateRuntimeLexicon(state);
    expect(runtime.tags).toEqual(["pes"]);
    expect(runtime.forms.psa).toBe(0);
    expect(runtime.forms.psovi).toBe(0);
    expect(runtime.forms.psem).toBe(0);
  });
});
