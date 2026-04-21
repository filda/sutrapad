import { describe, expect, it } from "vitest";
import {
  readTagFilterModeFromLocation,
  readTagFiltersFromLocation,
  writeTagFilterModeToLocation,
  writeTagFiltersToLocation,
} from "../src/app/logic/tag-filters";

const BASE = "https://sutrapad.example/";

describe("readTagFiltersFromLocation", () => {
  it("returns an empty array when the tags param is missing", () => {
    expect(readTagFiltersFromLocation(BASE)).toEqual([]);
  });

  it("splits, lowercases, trims, and dedupes tags", () => {
    const url = `${BASE}?tags=${encodeURIComponent("Work, idea , WORK")}`;

    expect(readTagFiltersFromLocation(url)).toEqual(["idea", "work"]);
  });

  it("sorts tags alphabetically so equivalent selections produce stable URLs", () => {
    expect(readTagFiltersFromLocation(`${BASE}?tags=zebra,apple`)).toEqual([
      "apple",
      "zebra",
    ]);
  });

  it("preserves auto-tag namespaces like `device:mobile`", () => {
    // The URL-encoded `:` is `%3A`; plain `:` is also valid in a query value.
    expect(
      readTagFiltersFromLocation(`${BASE}?tags=device:mobile,date:today`),
    ).toEqual(["date:today", "device:mobile"]);
  });
});

describe("writeTagFiltersToLocation", () => {
  it("drops the tags param entirely when the list is empty", () => {
    expect(writeTagFiltersToLocation(`${BASE}?tags=work`, [])).toBe(BASE);
  });

  it("canonicalises and sorts tags before writing", () => {
    const next = writeTagFiltersToLocation(BASE, ["Work", " idea", "WORK"]);

    expect(new URL(next).searchParams.get("tags")).toBe("idea,work");
  });

  it("round-trips through read → write unchanged", () => {
    const initial = `${BASE}?tags=${encodeURIComponent("idea,work")}`;
    const tags = readTagFiltersFromLocation(initial);
    const written = writeTagFiltersToLocation(BASE, tags);

    expect(readTagFiltersFromLocation(written)).toEqual(tags);
  });
});

describe("readTagFilterModeFromLocation", () => {
  it('defaults to "all" when the param is missing', () => {
    expect(readTagFilterModeFromLocation(BASE)).toBe("all");
  });

  it('returns "any" only when explicitly set', () => {
    expect(readTagFilterModeFromLocation(`${BASE}?tagsMode=any`)).toBe("any");
    expect(readTagFilterModeFromLocation(`${BASE}?tagsMode=all`)).toBe("all");
  });

  it('falls back to "all" for unknown values (so old URLs behave predictably)', () => {
    expect(readTagFilterModeFromLocation(`${BASE}?tagsMode=bogus`)).toBe("all");
    expect(readTagFilterModeFromLocation(`${BASE}?tagsMode=`)).toBe("all");
  });
});

describe("writeTagFilterModeToLocation", () => {
  it('omits the param when the value is the default "all"', () => {
    const next = writeTagFilterModeToLocation(`${BASE}?tagsMode=any`, "all");

    expect(new URL(next).searchParams.has("tagsMode")).toBe(false);
  });

  it('writes the param when the value is "any"', () => {
    const next = writeTagFilterModeToLocation(BASE, "any");

    expect(new URL(next).searchParams.get("tagsMode")).toBe("any");
  });

  it("leaves other params (like tags) untouched", () => {
    const next = writeTagFilterModeToLocation(`${BASE}?tags=work,idea`, "any");
    const url = new URL(next);

    expect(url.searchParams.get("tags")).toBe("work,idea");
    expect(url.searchParams.get("tagsMode")).toBe("any");
  });

  it("round-trips through read → write for both modes", () => {
    for (const mode of ["all", "any"] as const) {
      const written = writeTagFilterModeToLocation(BASE, mode);
      expect(readTagFilterModeFromLocation(written)).toBe(mode);
    }
  });
});
