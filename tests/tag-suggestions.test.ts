import { describe, expect, it } from "vitest";
import { filterTagSuggestions } from "../src/lib/notebook";
import type { SutraPadTagEntry } from "../src/types";

describe("filterTagSuggestions", () => {
  // Matches the order produced by buildTagIndex (count desc, then alpha).
  const availableTags: SutraPadTagEntry[] = [
    { tag: "idea", noteIds: ["1", "2"], count: 2 },
    { tag: "work", noteIds: ["1", "3"], count: 2 },
    { tag: "weekend", noteIds: ["2"], count: 1 },
    { tag: "weekly-review", noteIds: ["3"], count: 1 },
  ];

  it("returns every available tag for a blank query, preserving input order", () => {
    expect(filterTagSuggestions(availableTags, "", []).map((entry) => entry.tag)).toEqual([
      "idea",
      "work",
      "weekend",
      "weekly-review",
    ]);
  });

  it("treats whitespace-only queries as empty", () => {
    expect(filterTagSuggestions(availableTags, "   ", []).map((entry) => entry.tag)).toEqual([
      "idea",
      "work",
      "weekend",
      "weekly-review",
    ]);
  });

  it("matches substrings anywhere in the tag, case-insensitively", () => {
    expect(filterTagSuggestions(availableTags, "EK", []).map((entry) => entry.tag)).toEqual([
      "weekend",
      "weekly-review",
    ]);
  });

  it("excludes tags already on the current note", () => {
    expect(filterTagSuggestions(availableTags, "", ["work"]).map((entry) => entry.tag)).toEqual([
      "idea",
      "weekend",
      "weekly-review",
    ]);
  });

  it("combines query filtering with the excluded set", () => {
    expect(
      filterTagSuggestions(availableTags, "week", ["weekend"]).map((entry) => entry.tag),
    ).toEqual(["weekly-review"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterTagSuggestions(availableTags, "zz", [])).toEqual([]);
  });

  it("respects the limit parameter so huge tag clouds don't flood the dropdown", () => {
    const many: SutraPadTagEntry[] = Array.from({ length: 20 }, (_, index) => ({
      tag: `tag-${index.toString().padStart(2, "0")}`,
      noteIds: ["n"],
      count: 1,
    }));

    expect(filterTagSuggestions(many, "", [], 5)).toHaveLength(5);
    expect(filterTagSuggestions(many, "", [], 5).map((entry) => entry.tag)).toEqual([
      "tag-00",
      "tag-01",
      "tag-02",
      "tag-03",
      "tag-04",
    ]);
  });
});
