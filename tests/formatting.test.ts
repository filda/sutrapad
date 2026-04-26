import { describe, expect, it } from "vitest";
import { formatBuildStamp, formatDate } from "../src/app/logic/formatting";

describe("formatting helpers", () => {
  it("formats ISO dates into a human-friendly date/time string in the runtime locale", () => {
    const formatted = formatDate("2026-04-13T10:15:00.000Z");

    // Locale-agnostic checks: the year is present and the time uses a ':' separator.
    // We don't assert on month name or day/month/year ordering because the runtime
    // locale (and the user's browser locale in production) controls the format.
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it("formats build metadata into a versioned build stamp", () => {
    const formatted = formatBuildStamp(
      "0.3.0",
      "abc1234",
      "2026-04-13T10:15:00.000Z",
    );

    expect(formatted).toContain("v0.3.0");
    expect(formatted).toContain("abc1234");
    expect(formatted).toContain("built");
    // The date itself is locale-formatted; just confirm the year made it in.
    expect(formatted).toMatch(/2026/);
  });

  it("renders the build stamp with the exact ' · ' separator and `built ` prefix", () => {
    // Pin the punctuation: the visual rhythm of `vX · hash · built …`
    // is part of the topbar look. A swap to `-` or omitting `built `
    // would slip past the contains-check above but reads as a
    // different string in the UI.
    const formatted = formatBuildStamp(
      "0.3.0",
      "abc1234",
      "2026-04-13T10:15:00.000Z",
    );
    expect(formatted.startsWith("v0.3.0 · abc1234 · built ")).toBe(true);
  });

  it("includes a time component (date + time, not date alone)", () => {
    // formatBuildStamp passes both `dateStyle` and `timeStyle` to
    // Intl.DateTimeFormat. If the options object were ever flattened
    // to `{}` (the mutation we're guarding against here), the output
    // would stop including the time and read as a bare date in every
    // locale. The HH:MM check is locale-agnostic.
    const formatted = formatBuildStamp(
      "0.3.0",
      "abc1234",
      "2026-04-13T10:15:00.000Z",
    );
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});
