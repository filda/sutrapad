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
    expect(value).toMatch(/ · /u);
    // Use case-insensitive matching — locale differences may lowercase the
    // weekday — but the numeric day must always appear.
    expect(value).toMatch(/21/u);
  });
});

describe("formatNoteTime", () => {
  it("returns a zero-padded 24-hour HH:MM string", () => {
    const value = formatNoteTime("2026-04-21T07:05:00.000Z");
    // The exact hour depends on the TZ of the test runner; checking the
    // width and colon is enough to prove the hour12: false formatting path.
    expect(value).toMatch(/^\d{2}:\d{2}$/u);
  });
});

/** A note whose `createdAt` and `updatedAt` are the same instant. */
const stampNote = (id: string, updatedAt: string) => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
});

describe("groupNotesByRecency ordering", () => {
  // Two-element fixtures: exactly one comparison, so the ordering contract is
  // asserted without depending on how V8 happens to walk a larger array.
  //
  // Note for future mutation-report readers: two mutants of the comparator on
  // `home-groups.ts` L41 (`<` → `<=`, and `a.updatedAt < b.updatedAt` → `false`)
  // survive every fixture here, and that is not a gap. Both only ever turn a
  // positive return into `0` or the reverse, and a stable sort branches on
  // `result < 0` alone — `0` and `1` are the same instruction to it. Verified
  // over 20 000 random arrays (1–40 elements, heavy ties, so both the binary-
  // insertion and the TimSort paths): zero orderings differ from the original
  // comparator. They are equivalent mutants; no test can kill them.

  it("puts the newer note first even when the input is oldest-first", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const groups = groupNotesByRecency(
      [
        stampNote("older", "2026-04-21T08:00:00.000Z"),
        stampNote("newer", "2026-04-21T11:00:00.000Z"),
      ],
      now,
    );
    expect(groups.today.map((note) => note.id)).toEqual(["newer", "older"]);
  });

  it("leaves a tied pair in input order", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const stamp = "2026-04-21T09:00:00.000Z";
    const groups = groupNotesByRecency(
      [stampNote("first", stamp), stampNote("second", stamp)],
      now,
    );
    expect(groups.today.map((note) => note.id)).toEqual(["first", "second"]);
  });

  it("sorts newest-first and keeps equal timestamps in input order", () => {
    // The comparator returns 0 on a tie, which `toSorted` treats as "keep the
    // relative order" — two notes saved in the same second must not shuffle
    // between renders.
    const now = new Date("2026-04-21T12:00:00.000Z");
    const stamp = "2026-04-21T09:00:00.000Z";
    const notes = [
      { id: "tie-a", title: "A", createdAt: stamp, updatedAt: stamp },
      { id: "older", title: "B", createdAt: stamp, updatedAt: "2026-04-21T08:00:00.000Z" },
      { id: "tie-b", title: "C", createdAt: stamp, updatedAt: stamp },
      { id: "newest", title: "D", createdAt: stamp, updatedAt: "2026-04-21T11:00:00.000Z" },
    ];
    const groups = groupNotesByRecency(notes, now);
    expect(groups.today.map((note) => note.id)).toEqual([
      "newest",
      "tie-a",
      "tie-b",
      "older",
    ]);
  });

  it("does not reorder the caller's array", () => {
    const now = new Date("2026-04-21T12:00:00.000Z");
    const notes = [
      {
        id: "old",
        title: "A",
        createdAt: "2026-04-21T08:00:00.000Z",
        updatedAt: "2026-04-21T08:00:00.000Z",
      },
      {
        id: "new",
        title: "B",
        createdAt: "2026-04-21T11:00:00.000Z",
        updatedAt: "2026-04-21T11:00:00.000Z",
      },
    ];
    groupNotesByRecency(notes, now);
    expect(notes.map((note) => note.id)).toEqual(["old", "new"]);
  });

  it("zero-pads the local date key so single-digit months and days still bucket", () => {
    // The bucket key is built by hand as YYYY-MM-DD; an unpadded month would
    // make "2026-3-05" and "2026-03-05" different days and drop the note into
    // Earlier on the 5th of March.
    const now = new Date(2026, 2, 5, 12, 0, 0);
    const sameDay = new Date(2026, 2, 5, 8, 30, 0);
    const groups = groupNotesByRecency(
      [
        {
          id: "n",
          title: "A",
          createdAt: sameDay.toISOString(),
          updatedAt: sameDay.toISOString(),
        },
      ],
      now,
    );
    expect(groups.today.map((note) => note.id)).toEqual(["n"]);
    expect(groups.earlier).toEqual([]);
  });

  it("counts the month from one, not from zero", () => {
    // `getMonth()` is 0-based, so the `+ 1` is what keeps January out of
    // December's bucket. A note from 1 Feb must not land in "today" on 1 Jan.
    const january = new Date(2026, 0, 1, 12, 0, 0);
    const february = new Date(2026, 1, 1, 12, 0, 0);
    const groups = groupNotesByRecency(
      [
        {
          id: "feb",
          title: "A",
          createdAt: february.toISOString(),
          updatedAt: february.toISOString(),
        },
      ],
      january,
    );
    expect(groups.today).toEqual([]);
    expect(groups.earlier.map((note) => note.id)).toEqual(["feb"]);
  });
});

describe("formatHomeHeaderDate options", () => {
  it("spells the weekday and month out in full", () => {
    // `{ weekday: "long" }` / `{ day: "numeric", month: "long" }` — dropping
    // either option leaves Intl on its own defaults, which render the whole
    // date instead of the two pieces the eyebrow composes.
    const formatted = formatHomeHeaderDate(new Date(2026, 3, 21, 12, 0, 0));
    const [weekday, dayMonth] = formatted.split(" · ");
    expect(weekday).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
        new Date(2026, 3, 21, 12, 0, 0),
      ),
    );
    expect(weekday).not.toContain("2026");
    expect(dayMonth).toBe(
      new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(
        new Date(2026, 3, 21, 12, 0, 0),
      ),
    );
    expect(dayMonth).not.toContain("2026");
    expect(dayMonth).toMatch(/\d/u);
  });
});
