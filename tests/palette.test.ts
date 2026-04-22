import { describe, expect, it } from "vitest";
import {
  PALETTE_EMPTY_QUERY_RECENT_NOTES,
  buildPaletteEntries,
  filterPaletteEntries,
  flattenPaletteGroups,
  navigatePaletteEntries,
  reconcileActiveEntryId,
  togglePaletteTagFilter,
  type PaletteEntry,
  type PaletteGroups,
} from "../src/app/logic/palette";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

function makeNote(overrides: Partial<SutraPadDocument> = {}): SutraPadDocument {
  return {
    id: "n",
    title: "note",
    body: "",
    tags: [],
    urls: [],
    createdAt: "2026-04-21T09:00:00.000Z",
    updatedAt: "2026-04-21T09:00:00.000Z",
    ...overrides,
  };
}

function makeWorkspace(notes: SutraPadDocument[]): SutraPadWorkspace {
  return { notes, activeNoteId: notes[0]?.id ?? null };
}

function makeEntry(
  overrides: Partial<PaletteEntry> & { id: string; kind: PaletteEntry["kind"] },
): PaletteEntry {
  return {
    label: overrides.id,
    payload:
      overrides.kind === "note"
        ? { kind: "note", noteId: "x" }
        : { kind: "tag", tag: "x" },
    ...overrides,
  };
}

describe("buildPaletteEntries", () => {
  it("emits one note entry per workspace note, newest-first", () => {
    const older = makeNote({
      id: "older",
      title: "First",
      updatedAt: "2026-04-20T09:00:00.000Z",
    });
    const newer = makeNote({
      id: "newer",
      title: "Second",
      updatedAt: "2026-04-22T09:00:00.000Z",
    });
    const groups = buildPaletteEntries(makeWorkspace([older, newer]));
    expect(groups.notes.map((entry) => entry.payload)).toEqual([
      { kind: "note", noteId: "newer" },
      { kind: "note", noteId: "older" },
    ]);
  });

  it("keeps note ordering stable when updatedAt ties", () => {
    const alpha = makeNote({ id: "a", title: "Alpha" });
    const beta = makeNote({ id: "b", title: "Beta" });
    const groups = buildPaletteEntries(makeWorkspace([alpha, beta]));
    expect(groups.notes.map((entry) => entry.label)).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to 'Untitled note' when the title is whitespace", () => {
    const untitled = makeNote({ id: "u", title: "   " });
    const groups = buildPaletteEntries(makeWorkspace([untitled]));
    expect(groups.notes[0]?.label).toBe("Untitled note");
  });

  it("populates the note subtitle from up to three user tags", () => {
    const n = makeNote({
      id: "t",
      title: "Tagged",
      tags: ["one", "two", "three", "four"],
    });
    const groups = buildPaletteEntries(makeWorkspace([n]));
    expect(groups.notes[0]?.subtitle).toBe("#one #two #three");
  });

  it("omits the note subtitle when the note has no user tags", () => {
    const n = makeNote({ id: "t", title: "Plain" });
    const groups = buildPaletteEntries(makeWorkspace([n]));
    expect(groups.notes[0]?.subtitle).toBeUndefined();
  });

  it("emits one tag entry per combined-index tag (user + auto)", () => {
    const n1 = makeNote({ id: "a", title: "A", tags: ["work"] });
    const n2 = makeNote({ id: "b", title: "B", tags: ["work", "idea"] });
    const groups = buildPaletteEntries(makeWorkspace([n1, n2]));
    const userTags = groups.tags
      .filter((entry) => entry.payload.kind === "tag")
      .filter((entry) => entry.subtitle?.endsWith("user"));
    expect(userTags.map((userTag) => userTag.label).toSorted()).toEqual([
      "idea",
      "work",
    ]);
  });

  it("singularises the tag subtitle for tags that appear on one note", () => {
    const n = makeNote({ id: "a", title: "A", tags: ["alone"] });
    const groups = buildPaletteEntries(makeWorkspace([n]));
    const userTag = groups.tags.find((entry) => entry.label === "alone");
    expect(userTag?.subtitle).toBe("1 note · user");
  });

  it("pluralises the tag subtitle for tags used by multiple notes", () => {
    const notes = [
      makeNote({ id: "a", title: "A", tags: ["many"] }),
      makeNote({ id: "b", title: "B", tags: ["many"] }),
    ];
    const groups = buildPaletteEntries(makeWorkspace(notes));
    const tag = groups.tags.find((entry) => entry.label === "many");
    expect(tag?.subtitle).toBe("2 notes · user");
  });

  it("gives every entry a globally-unique id namespaced by kind", () => {
    const n = makeNote({ id: "x", title: "X", tags: ["x"] });
    const groups = buildPaletteEntries(makeWorkspace([n]));
    const ids = [...groups.notes, ...groups.tags].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["note:x", "tag:x"]));
  });
});

describe("filterPaletteEntries", () => {
  const baseGroups: PaletteGroups = {
    notes: [
      makeEntry({ id: "note:a", kind: "note", label: "Alpha draft" }),
      makeEntry({ id: "note:b", kind: "note", label: "Beta" }),
      makeEntry({
        id: "note:c",
        kind: "note",
        label: "Plain",
        subtitle: "#alphabet",
      }),
    ],
    tags: [
      makeEntry({ id: "tag:alpha", kind: "tag", label: "alpha" }),
      makeEntry({ id: "tag:other", kind: "tag", label: "other" }),
    ],
  };

  it("returns the top N recent notes and all tags when the query is empty", () => {
    const many = {
      notes: Array.from({ length: PALETTE_EMPTY_QUERY_RECENT_NOTES + 3 }, (_, index) =>
        makeEntry({ id: `note:${index}`, kind: "note", label: `Note ${index}` }),
      ),
      tags: baseGroups.tags,
    };
    const result = filterPaletteEntries(many, "");
    expect(result.notes).toHaveLength(PALETTE_EMPTY_QUERY_RECENT_NOTES);
    expect(result.tags).toEqual(baseGroups.tags);
  });

  it("treats a whitespace-only query as empty", () => {
    const result = filterPaletteEntries(baseGroups, "   ");
    // Three notes fit under the recent-count cap so no slicing happens here.
    expect(result.notes).toEqual(baseGroups.notes);
    expect(result.tags).toEqual(baseGroups.tags);
  });

  it("matches labels case-insensitively", () => {
    const result = filterPaletteEntries(baseGroups, "ALPHA");
    expect(result.notes.map((e) => e.id)).toEqual(["note:a", "note:c"]);
    expect(result.tags.map((e) => e.id)).toEqual(["tag:alpha"]);
  });

  it("matches against the subtitle text so tag hints count", () => {
    const result = filterPaletteEntries(baseGroups, "alphabet");
    expect(result.notes.map((e) => e.id)).toEqual(["note:c"]);
  });

  it("returns empty groups when nothing matches", () => {
    const result = filterPaletteEntries(baseGroups, "nothing-here");
    expect(result.notes).toEqual([]);
    expect(result.tags).toEqual([]);
  });
});

describe("flattenPaletteGroups", () => {
  it("yields notes first, then tags, preserving each group's order", () => {
    const groups: PaletteGroups = {
      notes: [
        makeEntry({ id: "note:a", kind: "note" }),
        makeEntry({ id: "note:b", kind: "note" }),
      ],
      tags: [makeEntry({ id: "tag:x", kind: "tag" })],
    };
    expect(flattenPaletteGroups(groups).map((e) => e.id)).toEqual([
      "note:a",
      "note:b",
      "tag:x",
    ]);
  });
});

describe("navigatePaletteEntries", () => {
  const entries: PaletteEntry[] = [
    makeEntry({ id: "a", kind: "note" }),
    makeEntry({ id: "b", kind: "note" }),
    makeEntry({ id: "c", kind: "tag" }),
  ];

  it("moves to the next entry when direction is next", () => {
    expect(navigatePaletteEntries(entries, "a", "next")).toBe("b");
    expect(navigatePaletteEntries(entries, "b", "next")).toBe("c");
  });

  it("wraps from the last entry to the first on next", () => {
    expect(navigatePaletteEntries(entries, "c", "next")).toBe("a");
  });

  it("wraps from the first entry to the last on prev", () => {
    expect(navigatePaletteEntries(entries, "a", "prev")).toBe("c");
  });

  it("moves to the previous entry on prev", () => {
    expect(navigatePaletteEntries(entries, "b", "prev")).toBe("a");
    expect(navigatePaletteEntries(entries, "c", "prev")).toBe("b");
  });

  it("snaps to the top on next when no current id is set", () => {
    expect(navigatePaletteEntries(entries, null, "next")).toBe("a");
  });

  it("snaps to the bottom on prev when no current id is set", () => {
    expect(navigatePaletteEntries(entries, null, "prev")).toBe("c");
  });

  it("snaps to the top on next when the current id has been filtered out", () => {
    expect(navigatePaletteEntries(entries, "gone", "next")).toBe("a");
  });

  it("returns null when there are no entries to navigate", () => {
    expect(navigatePaletteEntries([], null, "next")).toBeNull();
    expect(navigatePaletteEntries([], "any", "next")).toBeNull();
  });
});

describe("reconcileActiveEntryId", () => {
  const entries: PaletteEntry[] = [
    makeEntry({ id: "a", kind: "note" }),
    makeEntry({ id: "b", kind: "note" }),
  ];

  it("keeps the current id when it still exists in the entries", () => {
    expect(reconcileActiveEntryId(entries, "b")).toBe("b");
  });

  it("falls back to the first entry when the current id is missing", () => {
    expect(reconcileActiveEntryId(entries, "gone")).toBe("a");
  });

  it("returns the first entry when no current id is set", () => {
    expect(reconcileActiveEntryId(entries, null)).toBe("a");
  });

  it("returns null when the entries list is empty", () => {
    expect(reconcileActiveEntryId([], "a")).toBeNull();
    expect(reconcileActiveEntryId([], null)).toBeNull();
  });
});

describe("togglePaletteTagFilter", () => {
  it("appends the tag when it is not already in the filter set", () => {
    expect(togglePaletteTagFilter(["work"], "idea")).toEqual(["work", "idea"]);
  });

  it("preserves the tag order of the existing filter set on append", () => {
    expect(togglePaletteTagFilter(["a", "b", "c"], "d")).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("removes the tag when it is already in the filter set", () => {
    expect(togglePaletteTagFilter(["work", "idea"], "work")).toEqual(["idea"]);
  });

  it("removes only the matching entry and keeps the rest intact", () => {
    expect(togglePaletteTagFilter(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("returns a new array so callers can treat state as immutable", () => {
    const original = ["work"];
    const next = togglePaletteTagFilter(original, "idea");
    expect(next).not.toBe(original);
    expect(original).toEqual(["work"]);
  });

  it("adds the tag to an empty filter set", () => {
    expect(togglePaletteTagFilter([], "only")).toEqual(["only"]);
  });
});
