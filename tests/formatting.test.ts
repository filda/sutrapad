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
});
