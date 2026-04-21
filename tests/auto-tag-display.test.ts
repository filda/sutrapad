import { describe, expect, it } from "vitest";
import { formatAutoTagDisplay } from "../src/lib/auto-tag-display";

describe("formatAutoTagDisplay", () => {
  it("splits a namespaced auto-tag into icon + label + namespace", () => {
    const result = formatAutoTagDisplay("device:mobile");

    expect(result).not.toBeNull();
    expect(result?.namespace).toBe("device");
    expect(result?.label).toBe("mobile");
    expect(result?.icon).not.toBe("");
  });

  it("leaves the value intact when it contains further colons", () => {
    // Only the first colon is the separator. No current auto-tag emits this
    // pattern, but the guarantee protects future namespaces that do.
    const result = formatAutoTagDisplay("os:ios:17:4");

    expect(result?.namespace).toBe("os");
    expect(result?.label).toBe("ios:17:4");
  });

  it("produces an icon for each known namespace", () => {
    const namespaces = [
      "date",
      "year",
      "month",
      "edit",
      "source",
      "device",
      "orientation",
      "os",
      "browser",
      "lang",
      "location",
      "author",
      "network",
      "weather",
      "battery",
      "scroll",
      "engagement",
      "tasks",
    ];

    for (const ns of namespaces) {
      const result = formatAutoTagDisplay(`${ns}:value`);
      expect(result, `namespace ${ns} should resolve`).not.toBeNull();
      expect(result?.icon.length).toBeGreaterThan(0);
    }
  });

  it("year and month share the calendar icon with date (visual grouping)", () => {
    const date = formatAutoTagDisplay("date:today");
    const year = formatAutoTagDisplay("year:2026");
    const month = formatAutoTagDisplay("month:2026-04");

    expect(year?.icon).toBe(date?.icon);
    expect(month?.icon).toBe(date?.icon);
  });

  it("returns null for a tag with no namespace", () => {
    expect(formatAutoTagDisplay("work")).toBeNull();
  });

  it("returns null when the namespace is unknown", () => {
    // A user could invent their own `foo:bar`-style tag; we must not mis-read
    // it as an auto-tag and strip the prefix away.
    expect(formatAutoTagDisplay("project:acme")).toBeNull();
  });

  it("returns null for degenerate inputs", () => {
    expect(formatAutoTagDisplay(":mobile")).toBeNull();
    expect(formatAutoTagDisplay("device:")).toBeNull();
    expect(formatAutoTagDisplay("")).toBeNull();
  });
});
