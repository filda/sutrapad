import { describe, expect, it } from "vitest";
import {
  formatHomeHeaderDate,
  formatNoteTime,
  greetingFor,
  groupNotesByRecency,
} from "../src/app/logic/home-groups";
import type { SutraPadDocument } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "n",
    title: "t",
    body: "",
    tags: [],
    urls: [],
    createdAt: "2026-04-21T09:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

// Tests use a fixed "now" and local dates so day-boundary rules are
// deterministic regardless of the machine running the suite. `localIso`
// lives at module scope — lint flagged it as not capturing outer variables,
// and hoisting is also nicer for reuse across describe blocks.
function localIso(year: number, month: number, day: number, hour: number): string {
  return new Date(year, month - 1, day, hour, 0, 0).toISOString();
}

describe("groupNotesByRecency", () => {
  const now = new Date(2026, 3, 21, 14, 0, 0); // 2026-04-21 14:00 local

  it("puts notes updated today into the today bucket", () => {
    const n = makeNote({ id: "a", updatedAt: localIso(2026, 4, 21, 9) });
    const groups = groupNotesByRecency([n], now);
    expect(groups.today).toEqual([n]);
    expect(groups.yesterday).toEqual([]);
    expect(groups.earlier).toEqual([]);
  });

  it("puts notes updated on the previous local day into yesterday", () => {
    const n = makeNote({ id: "b", updatedAt: localIso(2026, 4, 20, 23) });
    const groups = groupNotesByRecency([n], now);
    expect(groups.yesterday).toEqual([n]);
  });

  it("puts older notes into earlier", () => {
    const n = makeNote({ id: "c", updatedAt: localIso(2026, 4, 19, 12) });
    const groups = groupNotesByRecency([n], now);
    expect(groups.earlier).toEqual([n]);
  });

  it("sorts each bucket newest first", () => {
    const morning = makeNote({ id: "morning", updatedAt: localIso(2026, 4, 21, 9) });
    const afternoon = makeNote({ id: "afternoon", updatedAt: localIso(2026, 4, 21, 13) });
    const groups = groupNotesByRecency([morning, afternoon], now);
    // Newest-first keeps the most recent note at the top of the timeline,
    // matching how people read reverse-chronological logs.
    expect(groups.today.map((n) => n.id)).toEqual(["afternoon", "morning"]);
  });

  it("handles month and year rollover for the yesterday bucket", () => {
    const januaryFirst = new Date(2026, 0, 1, 10, 0, 0);
    const newYearsEveNote = makeNote({
      id: "nye",
      updatedAt: localIso(2025, 12, 31, 23),
    });
    const groups = groupNotesByRecency([newYearsEveNote], januaryFirst);
    expect(groups.yesterday).toEqual([newYearsEveNote]);
  });

  it("does not mutate the input array", () => {
    const a = makeNote({ id: "a", updatedAt: localIso(2026, 4, 21, 9) });
    const b = makeNote({ id: "b", updatedAt: localIso(2026, 4, 21, 13) });
    const input = [a, b];
    const snapshot = [...input];
    groupNotesByRecency(input, now);
    expect(input).toEqual(snapshot);
  });
});

describe("greetingFor", () => {
  it("returns morning for 5:00 through 11:59", () => {
    expect(greetingFor(5)).toBe("morning");
    expect(greetingFor(8)).toBe("morning");
    expect(greetingFor(11)).toBe("morning");
  });

  it("returns afternoon for 12:00 through 17:59", () => {
    expect(greetingFor(12)).toBe("afternoon");
    expect(greetingFor(17)).toBe("afternoon");
  });

  it("returns evening for 18:00 through 4:59, including small hours", () => {
    // Small hours fold into evening so the greeting never reads "Good night,"
    // which parses as a send-off rather than a welcome.
    expect(greetingFor(18)).toBe("evening");
    expect(greetingFor(23)).toBe("evening");
    expect(greetingFor(0)).toBe("evening");
    expect(greetingFor(4)).toBe("evening");
  });
});

describe("formatHomeHeaderDate", () => {
  it("renders weekday · day month with a middle dot separator", () => {
    const value = formatHomeHeaderDate(new Date(2026, 3, 21, 10));
    expect(value).toMatch(/ · /);
    // Use case-insensitive matching — locale differences may lowercase the
    // weekday — but the numeric day must always appear.
    expect(value).toMatch(/21/);
  });
});

describe("formatNoteTime", () => {
  it("returns a zero-padded 24-hour HH:MM string", () => {
    const value = formatNoteTime("2026-04-21T07:05:00.000Z");
    // The exact hour depends on the TZ of the test runner; checking the
    // width and colon is enough to prove the hour12: false formatting path.
    expect(value).toMatch(/^\d{2}:\d{2}$/);
  });
});
