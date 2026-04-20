import { describe, expect, it } from "vitest";
import { formatBuildStamp, formatDate } from "../src/app/logic/formatting";

describe("formatting helpers", () => {
  it("formats ISO dates into a human-friendly US date/time string", () => {
    const formatted = formatDate("2026-04-13T10:15:00.000Z");

    expect(formatted).toMatch(/Apr/);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/10:15|3:15|12:15|11:15/);
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
    expect(formatted).toMatch(/13 Apr 2026|13 Apr 2026,|13 Apr 2026 at/);
  });
});
