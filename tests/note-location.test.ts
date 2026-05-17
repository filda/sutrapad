// Pure-logic tests for `formatNoteLocation` — used by every card surface
// (Notes / Links / Tasks) through `buildLocationLine` in
// `app/view/shared/card-header.ts`. The helper has to survive mutation
// pressure on its regex + placeholder branches, so the suite covers
// every documented rule individually.

import { describe, expect, it } from "vitest";
import { formatNoteLocation } from "../src/app/logic/note-location";

describe("formatNoteLocation", () => {
  it("returns null when the input is undefined (helper accepts the optional `note.location`)", () => {
    expect(formatNoteLocation(undefined)).toBeNull();
  });

  it("returns null when the input is an empty string", () => {
    expect(formatNoteLocation("")).toBeNull();
  });

  it("returns null when the input is whitespace only", () => {
    expect(formatNoteLocation("   ")).toBeNull();
    expect(formatNoteLocation("\t\n")).toBeNull();
  });

  it("returns null when the input is the lone em-dash placeholder", () => {
    // The geo-permission flow stores `"—"` when the user denies
    // location. Without this guard the chip would render the dash
    // sitting next to the pin icon — confusing UX.
    expect(formatNoteLocation("—")).toBeNull();
  });

  it("returns null when the input is the em-dash placeholder with surrounding whitespace", () => {
    // The trim happens before the placeholder check; a padded em
    // dash should still suppress the chip.
    expect(formatNoteLocation("  —  ")).toBeNull();
  });

  it("returns the venue unchanged when there is no `City — ` prefix", () => {
    // Notes captured outside a known city land in the workspace as
    // bare venue strings — passing them through must not drop
    // anything.
    expect(formatNoteLocation("Karlin office")).toBe("Karlin office");
  });

  it("trims surrounding whitespace from a bare venue", () => {
    expect(formatNoteLocation("  Karlin office  ")).toBe("Karlin office");
  });

  it("strips the leading `City — ` prefix and returns the venue", () => {
    expect(formatNoteLocation("Praha — Karlin office")).toBe("Karlin office");
  });

  it("strips only the outermost segment for multi-segment locations (non-greedy match)", () => {
    // `^.*?—\s*` is non-greedy, so a `"State — City — Venue"` only
    // loses the leftmost `"State — "` chunk, preserving the inner
    // segment for callers that still want to display it.
    expect(formatNoteLocation("Czechia — Praha — Karlin office")).toBe(
      "Praha — Karlin office",
    );
  });

  it("tolerates a missing space after the em dash", () => {
    // `\s*` lets the prefix end immediately after the dash. A
    // tightly-formatted `"Praha —Karlin"` source still resolves
    // to `"Karlin"`.
    expect(formatNoteLocation("Praha —Karlin")).toBe("Karlin");
  });

  it("returns the empty string when the prefix is the entire input (degenerate case)", () => {
    // `"Praha — "` → after strip → `""`. The helper returns it as-is
    // rather than collapsing to null; the caller already handles the
    // null branch on the source check, and this case shouldn't happen
    // in practice (capture emits either a venue or the placeholder).
    expect(formatNoteLocation("Praha — ")).toBe("");
  });
});
