import { describe, expect, it } from "vitest";

import { httpUrlOrNull } from "../src/lib/safe-url";

describe("httpUrlOrNull", () => {
  it("accepts http and https URLs, returning the canonical form", () => {
    expect(httpUrlOrNull("https://example.com/a")).toBe("https://example.com/a");
    expect(httpUrlOrNull("http://example.com/")).toBe("http://example.com/");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(httpUrlOrNull("  https://example.com/a  ")).toBe(
      "https://example.com/a",
    );
  });

  it("rejects dangerous and non-http schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/uuid",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(httpUrlOrNull(value)).toBeNull();
    }
  });

  it("rejects relative, malformed, blank, and non-string input", () => {
    expect(httpUrlOrNull("/relative/path")).toBeNull();
    expect(httpUrlOrNull("not a url")).toBeNull();
    expect(httpUrlOrNull("")).toBeNull();
    expect(httpUrlOrNull("   ")).toBeNull();
    expect(httpUrlOrNull(null)).toBeNull();
    expect(httpUrlOrNull(undefined)).toBeNull();
    expect(httpUrlOrNull(42)).toBeNull();
  });

  it("rejects a non-string that merely stringifies to a URL", () => {
    // The gate accepts real strings only — an object whose `toString`
    // returns a URL must not slip through (the `typeof` guard, not URL
    // coercion, is what stops it).
    expect(httpUrlOrNull({ toString: () => "https://example.com" })).toBeNull();
  });

  it("percent-encodes characters that would break a CSS url(\"…\") token", () => {
    const out = httpUrlOrNull('https://example.com/a"b c');
    expect(out).not.toBeNull();
    expect(out).not.toContain('"');
    expect(out).not.toContain(" ");
    expect(out).toContain("%22");
    expect(out).toContain("%20");
  });
});
