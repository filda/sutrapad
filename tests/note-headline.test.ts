import { describe, expect, it } from "vitest";
import { bodyAfterHeadline, firstBodyLine } from "../src/app/logic/note-headline";

describe("firstBodyLine", () => {
  it("returns the first non-blank line, trimmed", () => {
    expect(firstBodyLine("  hello world  \nmore")).toBe("hello world");
  });

  it("skips leading blank lines", () => {
    expect(firstBodyLine("\n\n  first real  \nsecond")).toBe("first real");
  });

  it("handles a single-line body", () => {
    expect(firstBodyLine("just one line")).toBe("just one line");
  });

  it("returns an empty string for a blank body", () => {
    expect(firstBodyLine("")).toBe("");
    expect(firstBodyLine("   \n  \n")).toBe("");
  });
});

describe("bodyAfterHeadline", () => {
  it("drops the first non-blank line and returns the rest", () => {
    expect(bodyAfterHeadline("headline\nsecond\nthird")).toBe("second\nthird");
  });

  it("skips leading blanks before removing the headline line", () => {
    expect(bodyAfterHeadline("\n\nheadline\nrest")).toBe("rest");
  });

  it("returns empty for a single-line body (nothing after the headline)", () => {
    expect(bodyAfterHeadline("only line")).toBe("");
  });

  it("returns empty for a blank body", () => {
    expect(bodyAfterHeadline("")).toBe("");
  });

  it("trims surrounding whitespace of the remainder", () => {
    expect(bodyAfterHeadline("head\n\n  body text  \n")).toBe("body text");
  });
});
