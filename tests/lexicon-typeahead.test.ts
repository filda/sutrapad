import { describe, expect, it } from "vitest";
import { filterTargetSuggestions } from "../src/app/logic/lexicon/typeahead";

describe("filterTargetSuggestions", () => {
  it("returns up to `limit` targets in input order when the query is empty", () => {
    const targets = ["praha", "pes", "brno", "vlk", "dub"];
    expect(filterTargetSuggestions("", targets, 3)).toEqual([
      "praha",
      "pes",
      "brno",
    ]);
  });

  it("returns an empty list when allTargets is empty", () => {
    expect(filterTargetSuggestions("p", [], 5)).toEqual([]);
  });

  it("returns an empty list when limit is zero or negative", () => {
    expect(filterTargetSuggestions("p", ["praha"], 0)).toEqual([]);
    expect(filterTargetSuggestions("p", ["praha"], -1)).toEqual([]);
  });

  it("ranks startsWith matches above contains-only matches", () => {
    const targets = ["alfa", "praha", "kompra", "psy"];
    // "pra" starts "praha" and is contained in "kompra"; "alfa" /
    // "psy" don't match at all. startsWith group should land first.
    expect(filterTargetSuggestions("pra", targets, 5)).toEqual([
      "praha",
      "kompra",
    ]);
  });

  it("uses cs-CZ lower-case rules so ČŠŘ collate against their bare forms", () => {
    const targets = ["Čára", "cara", "abc"];
    // Lowercased, "č" stays "č" and "C" becomes "c". A query of "ca"
    // matches both "cara" (startsWith) and "čára" (no startsWith,
    // includes "č"+"á"+"r"+"a" — substring "ca" not present).
    // So we expect only "cara".
    expect(filterTargetSuggestions("CA", targets, 5)).toEqual(["cara"]);
  });

  it("matches case-insensitively", () => {
    expect(filterTargetSuggestions("PRA", ["Praha"], 5)).toEqual(["Praha"]);
  });

  it("trims whitespace from the query before matching", () => {
    expect(filterTargetSuggestions("  pra  ", ["praha"], 5)).toEqual(["praha"]);
  });

  it("treats a whitespace-only query as empty", () => {
    const targets = ["pes", "vlk"];
    expect(filterTargetSuggestions("   ", targets, 5)).toEqual(["pes", "vlk"]);
  });

  it("preserves the input ordering within each rank group", () => {
    // praha, prach, alfa-pra: startsWith group keeps input order
    // (praha, prach); includes group has alfa-pra. Final order is
    // [praha, prach, alfa-pra].
    const targets = ["praha", "prach", "alfa-pra"];
    expect(filterTargetSuggestions("pra", targets, 5)).toEqual([
      "praha",
      "prach",
      "alfa-pra",
    ]);
  });

  it("slices the merged result to limit", () => {
    const targets = ["praha", "prach", "pravda", "pratele", "kompra"];
    expect(filterTargetSuggestions("pra", targets, 2)).toEqual([
      "praha",
      "prach",
    ]);
  });
});
