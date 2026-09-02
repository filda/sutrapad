import { describe, expect, it } from "vitest";
import { normalizeLineEndings } from "../src/lib/normalize-line-endings";

describe("normalizeLineEndings", () => {
  it.each([
    ["a\r\nb", "a\nb", "CRLF"],
    ["a\rb", "a\nb", "lone CR"],
    ["a\nb", "a\nb", "LF is untouched"],
    ["a\r\n\r\nb", "a\n\nb", "a CRLF blank line stays one blank line"],
    ["a\r\rb", "a\n\nb", "two lone CRs are two breaks"],
    ["", "", "empty"],
    ["no breaks", "no breaks", "no line breaks at all"],
  ])("normalises %j to %j (%s)", (input, expected) => {
    expect(normalizeLineEndings(input)).toBe(expected);
  });

  it("does not turn a CRLF into a blank line", () => {
    // The ordering of the two passes is the whole contract: replacing lone
    // CRs first would rewrite "a\r\nb" as "a\n\nb".
    expect(normalizeLineEndings("- [ ] one\r\n- [x] two")).toBe(
      "- [ ] one\n- [x] two",
    );
    expect(normalizeLineEndings("a\r\nb").split("\n")).toHaveLength(2);
  });

  it("leaves a body that is already LF-only byte-identical", () => {
    const body = "line one\nline two\n\nline four";
    expect(normalizeLineEndings(body)).toBe(body);
  });
});
