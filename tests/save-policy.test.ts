import { describe, expect, it } from "vitest";
import type { SutraPadDocument, SutraPadNoteSummary } from "../src/types";
import {
  INDEX_MAX_SHRINK_RATIO,
  INDEX_MAX_SNAPSHOTS,
  INDEX_SNAPSHOT_MIN_AGE_KEPT_MS,
  SAVE_MAX_BLANKED_NOTES_INTERACTIVE,
  SAVE_MAX_NOTE_UPLOADS_INTERACTIVE,
} from "../src/lib/budgets";
import {
  assertNotMassBlanking,
  checkIndexShrink,
  checkNoteUploadCount,
  findBlankedNotes,
  parseIndexSnapshotTimestamp,
  selectSnapshotsToDelete,
  WorkspaceSaveRefusedError,
} from "../src/services/drive/save-policy";

function note(overrides: Partial<SutraPadDocument> & { id: string }): SutraPadDocument {
  return {
    title: "",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

function summary(
  overrides: Partial<SutraPadNoteSummary> & { id: string },
): SutraPadNoteSummary {
  return {
    title: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    excerpt: "had content",
    fileId: `file-${overrides.id}`,
    ...overrides,
  };
}

function byId(...summaries: SutraPadNoteSummary[]): Map<string, SutraPadNoteSummary> {
  return new Map(summaries.map((entry) => [entry.id, entry]));
}

describe("findBlankedNotes", () => {
  it("flags a hydrated, changed note whose body is now empty while the index still has an excerpt", () => {
    const blanked = findBlankedNotes([note({ id: "a" })], byId(summary({ id: "a" })));
    expect(blanked.map((n) => n.id)).toEqual(["a"]);
  });

  it("treats a whitespace-only body as blank", () => {
    const blanked = findBlankedNotes([note({ id: "a", body: " \n\t" })], byId(summary({ id: "a" })));
    expect(blanked).toHaveLength(1);
  });

  it("ignores placeholders — they are never uploaded", () => {
    const blanked = findBlankedNotes(
      [note({ id: "a", hydrated: false })],
      byId(summary({ id: "a" })),
    );
    expect(blanked).toEqual([]);
  });

  it("ignores a note with a non-empty body", () => {
    expect(findBlankedNotes([note({ id: "a", body: "x" })], byId(summary({ id: "a" })))).toEqual([]);
  });

  it("ignores a note the index does not know (new note, nothing to overwrite)", () => {
    expect(findBlankedNotes([note({ id: "a" })], byId())).toEqual([]);
  });

  it("ignores an unchanged note — it takes the short-circuit, not the upload path", () => {
    const unchanged = note({ id: "a", updatedAt: "2026-09-01T00:00:00.000Z" });
    expect(findBlankedNotes([unchanged], byId(summary({ id: "a" })))).toEqual([]);
  });

  it("ignores a note whose existing summary has no excerpt (it was already empty)", () => {
    expect(
      findBlankedNotes([note({ id: "a" })], byId(summary({ id: "a", excerpt: "  " }))),
    ).toEqual([]);
    expect(
      findBlankedNotes([note({ id: "a" })], byId(summary({ id: "a", excerpt: undefined }))),
    ).toEqual([]);
  });
});

describe("assertNotMassBlanking", () => {
  const blankers = (count: number): SutraPadDocument[] =>
    Array.from({ length: count }, (_, i) => note({ id: `n${i}` }));
  const summaries = (count: number): Map<string, SutraPadNoteSummary> =>
    byId(...Array.from({ length: count }, (_, i) => summary({ id: `n${i}` })));

  it("allows blanking up to the budget (a user can empty a note)", () => {
    const count = SAVE_MAX_BLANKED_NOTES_INTERACTIVE;
    expect(() => assertNotMassBlanking(blankers(count), summaries(count))).not.toThrow();
  });

  it("refuses one past the budget with a typed error naming the count", () => {
    const count = SAVE_MAX_BLANKED_NOTES_INTERACTIVE + 1;
    let caught: unknown;
    try {
      assertNotMassBlanking(blankers(count), summaries(count));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkspaceSaveRefusedError);
    const refused = caught as WorkspaceSaveRefusedError;
    expect(refused.code).toBe("blanked-notes");
    expect(refused.name).toBe("WorkspaceSaveRefusedError");
    expect(refused.message).toContain(`${count} notes`);
    expect(refused.message).toContain("Save refused");
  });

  it("is a no-op on an empty workspace", () => {
    expect(() => assertNotMassBlanking([], byId())).not.toThrow();
  });
});

describe("checkIndexShrink", () => {
  it("never reports when there was no index before", () => {
    expect(checkIndexShrink(0, 0)).toBeNull();
    expect(checkIndexShrink(0, 10)).toBeNull();
  });

  it("stays silent at exactly the ratio and below, including growth", () => {
    expect(checkIndexShrink(1000, 1000 - 1000 * INDEX_MAX_SHRINK_RATIO)).toBeNull();
    expect(checkIndexShrink(1000, 1200)).toBeNull();
  });

  it("reports one note past the ratio with the counts and rounded percentage", () => {
    const next = 1000 - 1000 * INDEX_MAX_SHRINK_RATIO - 1;
    const overrun = checkIndexShrink(1000, next);
    expect(overrun).toMatchObject({ budget: "index-shrink", limit: INDEX_MAX_SHRINK_RATIO });
    expect(overrun?.observed).toBeCloseTo((1000 - next) / 1000);
    expect(overrun?.message).toContain("1000 to 949");
    expect(overrun?.message).toContain("5 %");
  });

  it("describes the incident shape (6470 → 879) as an 86 % shrink", () => {
    expect(checkIndexShrink(6470, 879)?.message).toContain("86 %");
  });
});

describe("checkNoteUploadCount", () => {
  it("stays silent at and below the budget", () => {
    expect(checkNoteUploadCount(0)).toBeNull();
    expect(checkNoteUploadCount(SAVE_MAX_NOTE_UPLOADS_INTERACTIVE)).toBeNull();
  });

  it("reports one past the budget with both numbers in the message", () => {
    const uploads = SAVE_MAX_NOTE_UPLOADS_INTERACTIVE + 1;
    const overrun = checkNoteUploadCount(uploads);
    expect(overrun).toMatchObject({
      budget: "note-uploads",
      observed: uploads,
      limit: SAVE_MAX_NOTE_UPLOADS_INTERACTIVE,
    });
    expect(overrun?.message).toContain(`${uploads} note files`);
    expect(overrun?.message).toContain(`${SAVE_MAX_NOTE_UPLOADS_INTERACTIVE}`);
  });
});

describe("parseIndexSnapshotTimestamp", () => {
  it("inverts buildIndexSnapshotFileName's `[:.]` → `-` replacement", () => {
    expect(parseIndexSnapshotTimestamp("index-2026-09-07T16-39-45-229Z.json")).toBe(
      "2026-09-07T16:39:45.229Z",
    );
  });

  it("returns null for anything else", () => {
    expect(parseIndexSnapshotTimestamp("sutrapad-index.json")).toBeNull();
    expect(parseIndexSnapshotTimestamp("index-2026-09-07.json")).toBeNull();
    expect(parseIndexSnapshotTimestamp("xindex-2026-09-07T16-39-45-229Z.json")).toBeNull();
  });
});

describe("selectSnapshotsToDelete", () => {
  const NOW = Date.parse("2026-09-08T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1000;

  /** Snapshot named for `ageMs` before NOW. */
  function snap(id: string, ageMs: number): { id: string; name: string } {
    const iso = new Date(NOW - ageMs).toISOString();
    return { id, name: `index-${iso.replaceAll(/[:.]/gu, "-")}.json` };
  }

  it("never deletes the active snapshot", () => {
    const active = snap("active", 0);
    const files = [active, ...Array.from({ length: 30 }, (_, i) => snap(`s${i}`, (i + 1) * 60_000))];
    const deleted = selectSnapshotsToDelete(files, "active", NOW);
    expect(deleted.some((file) => file.id === "active")).toBe(false);
  });

  it("keeps the INDEX_MAX_SNAPSHOTS - 1 newest stale snapshots regardless of order", () => {
    const files = Array.from({ length: 15 }, (_, i) => snap(`s${i}`, (i + 1) * 60_000 + 2 * DAY));
    const shuffled = files.toReversed();
    const deleted = selectSnapshotsToDelete([snap("active", 0), ...shuffled], "active", NOW);
    // s0..s8 are the 9 newest and survive; s9..s14 go (all are >24 h old,
    // and the kept window already holds an old-enough one, so no extra keep).
    expect(deleted.map((file) => file.id).toSorted()).toEqual(
      ["s9", "s10", "s11", "s12", "s13", "s14"].toSorted(),
    );
    expect(INDEX_MAX_SNAPSHOTS - 1).toBe(9);
  });

  it("keeps the youngest snapshot older than the age floor when the count window is all fresh (save storm)", () => {
    // Nine saves in the last two minutes fill the window; the recovery
    // points from yesterday and the day before would all rotate out.
    const storm = Array.from({ length: 9 }, (_, i) => snap(`fresh${i}`, (i + 1) * 10_000));
    const yesterday = snap("yesterday", INDEX_SNAPSHOT_MIN_AGE_KEPT_MS + 60_000);
    const older = snap("older", 3 * DAY);
    const oldest = snap("oldest", 10 * DAY);
    const deleted = selectSnapshotsToDelete(
      [snap("active", 0), oldest, ...storm, yesterday, older],
      "active",
      NOW,
    );
    expect(deleted.map((file) => file.id).toSorted()).toEqual(["older", "oldest"]);
  });

  it("does not keep a snapshot that is one millisecond short of the age floor", () => {
    const storm = Array.from({ length: 9 }, (_, i) => snap(`fresh${i}`, (i + 1) * 10_000));
    const almost = snap("almost", INDEX_SNAPSHOT_MIN_AGE_KEPT_MS - 1);
    const deleted = selectSnapshotsToDelete([snap("active", 0), ...storm, almost], "active", NOW);
    expect(deleted.map((file) => file.id)).toEqual(["almost"]);
  });

  it("keeps a snapshot exactly at the age floor", () => {
    const storm = Array.from({ length: 9 }, (_, i) => snap(`fresh${i}`, (i + 1) * 10_000));
    const exact = snap("exact", INDEX_SNAPSHOT_MIN_AGE_KEPT_MS);
    expect(selectSnapshotsToDelete([snap("active", 0), ...storm, exact], "active", NOW)).toEqual([]);
  });

  it("skips the extra keep when the count window already contains an old-enough snapshot", () => {
    const window = [
      ...Array.from({ length: 8 }, (_, i) => snap(`fresh${i}`, (i + 1) * 10_000)),
      snap("inWindowOld", 2 * DAY),
    ];
    const beyond = snap("beyond", 3 * DAY);
    const deleted = selectSnapshotsToDelete([snap("active", 0), ...window, beyond], "active", NOW);
    expect(deleted.map((file) => file.id)).toEqual(["beyond"]);
  });

  it("leaves files with non-snapshot names alone and never treats them as a recovery point", () => {
    // The legacy `sutrapad-index.json` carries the same `kind=index` marker
    // and sorts *after* every `index-…` name, so a name-only window would
    // both shelter it and let it crowd out a real snapshot.
    const storm = Array.from({ length: 9 }, (_, i) => snap(`fresh${i}`, (i + 1) * 10_000));
    const tenth = snap("tenth", 20 * 60_000);
    const legacy = { id: "legacy", name: "sutrapad-index.json" };
    const deleted = selectSnapshotsToDelete(
      [snap("active", 0), legacy, ...storm, tenth],
      "active",
      NOW,
    );
    expect(deleted.map((file) => file.id)).toEqual(["tenth"]);
  });

  it("returns nothing when there is nothing beyond the window", () => {
    const few = Array.from({ length: 3 }, (_, i) => snap(`s${i}`, (i + 1) * 60_000));
    expect(selectSnapshotsToDelete([snap("active", 0), ...few], "active", NOW)).toEqual([]);
  });
});
