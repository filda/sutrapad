import { describe, expect, it } from "vitest";
import { formatInitials } from "../src/app/logic/account-initials";

describe("formatInitials", () => {
  it("returns first + last word initials for a two-word name", () => {
    expect(formatInitials("Filip Krolupper")).toBe("FK");
  });

  it("returns the first character for a single-word name", () => {
    expect(formatInitials("Filip")).toBe("F");
  });

  it("uses first + last word for three-or-more-word names (skips middles)", () => {
    // Two-letter result keeps the 32px circle legible without shrink-to-fit.
    // "Maria José Costa" returns MC, not MJC.
    expect(formatInitials("Maria José Costa")).toBe("MC");
    expect(formatInitials("Filip Středník Krolupper")).toBe("FK");
  });

  it("treats hyphenated parts as a single word", () => {
    // Convention varies in the wild; we pick "consistent with single-word
    // rule" so 'Anne-Marie Smith' → AS, not AMS.
    expect(formatInitials("Anne-Marie Smith")).toBe("AS");
  });

  it("uppercases lowercase input", () => {
    expect(formatInitials("filip krolupper")).toBe("FK");
  });

  it("uses locale-aware uppercase for Czech diacritics", () => {
    // The platform's plain `toUpperCase()` already handles 'ž → Ž' but
    // toLocaleUpperCase is the contract — keep the test on the contract,
    // not the implementation, so a future locale-sensitive case (Turkish
    // 'i → İ') doesn't silently regress.
    expect(formatInitials("žofie středníková")).toBe("ŽS");
    expect(formatInitials("řehoř novák")).toBe("ŘN");
  });

  it("collapses runs of whitespace between words", () => {
    expect(formatInitials("  Maria   José    Costa  ")).toBe("MC");
  });

  it("returns empty for an empty string", () => {
    expect(formatInitials("")).toBe("");
  });

  it("returns empty for a whitespace-only string", () => {
    expect(formatInitials("   ")).toBe("");
    expect(formatInitials("\t\n  ")).toBe("");
  });

  it("handles surrogate pairs without splitting them", () => {
    // The mathematical bold "F" (U+1D4D5) is a surrogate pair in UTF-16.
    // Indexing with `name[0]` would return a lone high surrogate, which
    // wouldn't render. `Array.from` walks codepoints.
    const surrogateF = "\u{1D4D5}";
    expect(formatInitials(`${surrogateF}ilip`)).toBe(surrogateF.toLocaleUpperCase());
  });

  it("treats an emoji-leading name as that emoji's first glyph", () => {
    // Less common in practice, but a Slack-style display name like
    // "🎉 Filip" should still produce a stable two-character output —
    // we don't have to filter emoji to be useful.
    expect(formatInitials("🎉 Filip")).toBe("🎉F");
  });

  it("uppercases each picked glyph independently", () => {
    // First word starts uppercase, last starts lowercase — both should
    // emerge uppercased so the chip reads as a proper monogram.
    expect(formatInitials("Filip krolupper")).toBe("FK");
    expect(formatInitials("filip Krolupper")).toBe("FK");
  });

  it("takes the first codepoint of each word as-is, even when it's punctuation", () => {
    // Edge case: somebody types `"Filip Krolupper"` with the surrounding
    // quotes wedged into the words. First word `"Filip` starts with `"`;
    // last word `Krolupper"` starts with `K` (the trailing quote is on
    // the wrong end). We don't try to strip punctuation — initials just
    // take the first glyph of each picked word. Garbage in, predictable
    // garbage out, never throws.
    expect(formatInitials('"Filip Krolupper"')).toBe('"K');
  });

  it("returns empty string for non-string input (defensive)", () => {
    // The TypeScript signature forbids it, but `UserProfile.name` could
    // arrive as null at runtime via a tampered persisted session. Guard
    // explicitly so callers don't have to.
    expect(formatInitials(null as unknown as string)).toBe("");
    expect(formatInitials(undefined as unknown as string)).toBe("");
    expect(formatInitials(42 as unknown as string)).toBe("");
  });
});
