import { describe, expect, it } from "vitest";
import {
  describeRebuildStatus,
  IDLE_REBUILD_STATUS,
  type RebuildStatus,
} from "../src/app/logic/rebuild-status";

describe("describeRebuildStatus", () => {
  it("returns null for idle (nothing to show before the button's been clicked)", () => {
    expect(describeRebuildStatus({ state: "idle" })).toBeNull();
    expect(describeRebuildStatus(IDLE_REBUILD_STATUS)).toBeNull();
  });

  it("describes the running state", () => {
    const text = describeRebuildStatus({ state: "running" });
    expect(text).toContain("Rebuilding");
  });

  it("singularises the done message for exactly one note", () => {
    expect(describeRebuildStatus({ state: "done", noteCount: 1 })).toBe(
      "Done — refreshed 1 note.",
    );
  });

  it("pluralises the done message for any other count", () => {
    expect(describeRebuildStatus({ state: "done", noteCount: 0 })).toBe(
      "Done — refreshed 0 notes.",
    );
    expect(describeRebuildStatus({ state: "done", noteCount: 6470 })).toBe(
      "Done — refreshed 6470 notes.",
    );
  });

  it("surfaces the error message verbatim", () => {
    const status: RebuildStatus = { state: "error", message: "Network request failed" };
    expect(describeRebuildStatus(status)).toBe(
      "Rebuild failed: Network request failed",
    );
  });
});
