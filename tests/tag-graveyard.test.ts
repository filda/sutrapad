import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  GRAVEYARD_THRESHOLD_DAYS,
  computeLastUsedByTag,
  isGraveyardTag,
  splitGraveyard,
} from "../src/app/logic/tag-graveyard";
import type {
  SutraPadDocument,
  SutraPadTagEntry,
  SutraPadTagIndex,
  SutraPadWorkspace,
} from "../src/types";

const NOW = new Date("2026-04-23T12:00:00.000Z");

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function note(
  partial: Partial<SutraPadDocument> & Pick<SutraPadDocument, "id" | "updatedAt">,
): SutraPadDocument {
  return {
    title: "n",
    body: "",
    urls: [],
    createdAt: partial.updatedAt,
    tags: [],
    ...partial,
  };
}

function workspaceOf(notes: SutraPadDocument[]): SutraPadWorkspace {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function entry(tag: string, noteIds: string[], kind: "user" | "auto" = "user"): SutraPadTagEntry {
  return { tag, noteIds, count: noteIds.length, kind };
}

function index(tags: SutraPadTagEntry[]): SutraPadTagIndex {
  return { version: 1, savedAt: NOW.toISOString(), tags };
}

describe("computeLastUsedByTag", () => {
  it("returns the latest updatedAt across all notes that carry a tag", () => {
    const ws = workspaceOf([
      note({ id: "a", updatedAt: daysAgoIso(10), tags: ["writing"] }),
      note({ id: "b", updatedAt: daysAgoIso(30), tags: ["writing"] }),
      note({ id: "c", updatedAt: daysAgoIso(2), tags: ["coffee"] }),
    ]);

    const map = computeLastUsedByTag(ws, NOW);
    expect(map.get("writing")).toBe(daysAgoIso(10));
    expect(map.get("coffee")).toBe(daysAgoIso(2));
  });

  it("includes auto-tags derived at query time", () => {
    // A note created 100 days ago should surface its derived source/device
    // auto-tags with that note's updatedAt, NOT with `now`.
    const ws = workspaceOf([
      note({
        id: "a",
        updatedAt: daysAgoIso(100),
        tags: [],
        captureContext: {
          source: "text-capture",
          deviceType: "desktop",
        },
      }),
    ]);

    const map = computeLastUsedByTag(ws, NOW);
    expect(map.get("source:text-capture")).toBe(daysAgoIso(100));
    expect(map.get("device:desktop")).toBe(daysAgoIso(100));
  });

  it("returns an empty map for an empty workspace", () => {
    expect(computeLastUsedByTag(workspaceOf([]), NOW).size).toBe(0);
  });
});

describe("isGraveyardTag", () => {
  const lastUsed = new Map<string, string>([
    ["old-solo", daysAgoIso(120)],
    ["old-paired", daysAgoIso(120)],
    ["fresh-solo", daysAgoIso(5)],
  ]);

  it("flags a count-1 tag older than the threshold", () => {
    expect(
      isGraveyardTag(entry("old-solo", ["n1"]), lastUsed, NOW),
    ).toBe(true);
  });

  it("spares a tag whose count is greater than 1", () => {
    expect(
      isGraveyardTag(entry("old-paired", ["n1", "n2"]), lastUsed, NOW),
    ).toBe(false);
  });

  it("spares a count-1 tag that was touched recently", () => {
    expect(
      isGraveyardTag(entry("fresh-solo", ["n1"]), lastUsed, NOW),
    ).toBe(false);
  });

  it("spares a tag exactly at the threshold (strict greater-than)", () => {
    const map = new Map([["edge", daysAgoIso(GRAVEYARD_THRESHOLD_DAYS)]]);
    expect(
      isGraveyardTag(entry("edge", ["n1"]), map, NOW),
    ).toBe(false);
  });

  it("flags a tag one day past the threshold", () => {
    const map = new Map([["just-past", daysAgoIso(GRAVEYARD_THRESHOLD_DAYS + 1)]]);
    expect(
      isGraveyardTag(entry("just-past", ["n1"]), map, NOW),
    ).toBe(true);
  });

  it("spares a tag with no known lastUsed entry", () => {
    expect(
      isGraveyardTag(entry("ghost", ["n1"]), new Map(), NOW),
    ).toBe(false);
  });

  it("spares a tag whose lastUsed string is unparseable", () => {
    const map = new Map([["broken", "not-a-date"]]);
    expect(
      isGraveyardTag(entry("broken", ["n1"]), map, NOW),
    ).toBe(false);
  });

  it("honours a custom threshold", () => {
    const map = new Map([["recent", daysAgoIso(10)]]);
    // Default 90 would spare it; a 7-day threshold buries it.
    expect(isGraveyardTag(entry("recent", ["n1"]), map, NOW, 7)).toBe(true);
    expect(isGraveyardTag(entry("recent", ["n1"]), map, NOW, 30)).toBe(false);
  });
});

describe("splitGraveyard", () => {
  it("returns empty sets for an empty index", () => {
    const ws = workspaceOf([]);
    const { living, graveyard } = splitGraveyard(index([]), ws, NOW);
    expect(living).toEqual([]);
    expect(graveyard).toEqual([]);
  });

  it("sends count-1 tags older than 90 days to the graveyard", () => {
    const ws = workspaceOf([
      note({ id: "a", updatedAt: daysAgoIso(100), tags: ["oedipus"] }),
      note({ id: "b", updatedAt: daysAgoIso(3), tags: ["writing"] }),
      note({ id: "c", updatedAt: daysAgoIso(3), tags: ["writing"] }),
    ]);
    const idx = index([
      entry("writing", ["b", "c"]),
      entry("oedipus", ["a"]),
    ]);

    const { living, graveyard } = splitGraveyard(idx, ws, NOW);
    expect(living.map((e) => e.tag)).toEqual(["writing"]);
    expect(graveyard.map((e) => e.tag)).toEqual(["oedipus"]);
  });

  it("preserves the original index order within the living set", () => {
    const ws = workspaceOf([
      note({ id: "a", updatedAt: daysAgoIso(2), tags: ["x", "y", "z"] }),
      note({ id: "b", updatedAt: daysAgoIso(2), tags: ["x", "y"] }),
      note({ id: "c", updatedAt: daysAgoIso(2), tags: ["x"] }),
    ]);
    const idx = index([
      entry("x", ["a", "b", "c"]),
      entry("y", ["a", "b"]),
      entry("z", ["a"]),
    ]);

    const { living } = splitGraveyard(idx, ws, NOW);
    expect(living.map((e) => e.tag)).toEqual(["x", "y", "z"]);
  });

  it("sorts the graveyard oldest-first, breaking ties on name", () => {
    const ws = workspaceOf([
      note({ id: "a", updatedAt: daysAgoIso(200), tags: ["saffron"] }),
      note({ id: "b", updatedAt: daysAgoIso(150), tags: ["bauhaus"] }),
      note({ id: "c", updatedAt: daysAgoIso(150), tags: ["aardvark"] }),
      note({ id: "d", updatedAt: daysAgoIso(100), tags: ["oedipus"] }),
    ]);
    const idx = index([
      entry("oedipus", ["d"]),
      entry("saffron", ["a"]),
      entry("aardvark", ["c"]),
      entry("bauhaus", ["b"]),
    ]);

    const { graveyard } = splitGraveyard(idx, ws, NOW);
    expect(graveyard.map((e) => e.tag)).toEqual([
      "saffron", // 200d oldest
      "aardvark", // 150d, alpha before bauhaus
      "bauhaus", // 150d
      "oedipus", // 100d
    ]);
  });

  it("honours a custom threshold", () => {
    const ws = workspaceOf([
      note({ id: "a", updatedAt: daysAgoIso(20), tags: ["recentish"] }),
    ]);
    const idx = index([entry("recentish", ["a"])]);

    // Default spares it.
    expect(splitGraveyard(idx, ws, NOW).graveyard).toEqual([]);
    // Tighter 7-day threshold buries it.
    expect(splitGraveyard(idx, ws, NOW, 7).graveyard.map((e) => e.tag)).toEqual([
      "recentish",
    ]);
  });

  it("handles user and auto tags in the same pass", () => {
    const ws = workspaceOf([
      note({
        id: "a",
        updatedAt: daysAgoIso(120),
        tags: ["bauhaus"],
        captureContext: { source: "text-capture" },
      }),
    ]);
    const idx = index([
      entry("bauhaus", ["a"], "user"),
      entry("source:text-capture", ["a"], "auto"),
    ]);

    const { graveyard } = splitGraveyard(idx, ws, NOW);
    // Both tags are solo + old → both sunset.
    expect(graveyard.map((e) => e.tag).toSorted()).toEqual([
      "bauhaus",
      "source:text-capture",
    ]);
  });

  it("keeps a tag in the living set if it was touched by any fresh note", () => {
    // Two notes carry `writing`, one old, one fresh → lastUsed is fresh →
    // the tag is living even though its oldest carrier is ancient.
    const ws = workspaceOf([
      note({ id: "a", updatedAt: daysAgoIso(200), tags: ["writing"] }),
      note({ id: "b", updatedAt: daysAgoIso(2), tags: ["writing"] }),
    ]);
    const idx = index([entry("writing", ["a", "b"])]);

    const { living, graveyard } = splitGraveyard(idx, ws, NOW);
    expect(living.map((e) => e.tag)).toEqual(["writing"]);
    expect(graveyard).toEqual([]);
  });
});
