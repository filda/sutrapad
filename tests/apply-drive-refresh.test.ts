import { describe, expect, it } from "vitest";
import { applyDriveRefresh } from "../src/lib/notebook";
import type { SutraPadDocument, SutraPadWorkspace } from "../src/types";

function note(
  id: string,
  body: string,
  updatedAt: string,
  overrides: Partial<SutraPadDocument> = {},
): SutraPadDocument {
  return {
    id,
    title: id,
    body,
    urls: [],
    tags: [],
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

function workspace(
  notes: SutraPadDocument[],
  activeNoteId: string | null = notes[0]?.id ?? null,
): SutraPadWorkspace {
  return { notes, activeNoteId };
}

describe("applyDriveRefresh", () => {
  it("drops local notes that are missing from the inventory", () => {
    // The orchestrator calls this with an empty `fetchedNotes` array in
    // Phase 1 so the count snaps to truth before any JSON is fetched —
    // a note deleted on Device A must disappear from Device B's view
    // even though Device B still has its body cached locally.
    const local = workspace([
      note("a", "alpha", "2026-05-01T10:00:00.000Z"),
      note("gone", "deleted on another device", "2026-04-30T10:00:00.000Z"),
    ]);

    const next = applyDriveRefresh(local, [], [{ noteId: "a" }]);

    expect(next.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("keeps local note copies for ids still in the inventory but not yet fetched", () => {
    // Phase 1's empty-fetch merge must not blow away the bodies the
    // user already has cached — only the deleted-elsewhere notes are
    // pruned. Phase 2 / 3 will then replace these with fresh copies as
    // they arrive.
    const local = workspace([
      note("a", "local body of A", "2026-05-01T10:00:00.000Z"),
      note("b", "local body of B", "2026-04-30T10:00:00.000Z"),
    ]);

    const next = applyDriveRefresh(local, [], [
      { noteId: "a" },
      { noteId: "b" },
    ]);

    expect(next.notes).toHaveLength(2);
    const a = next.notes.find((n) => n.id === "a");
    expect(a?.body).toBe("local body of A");
  });

  it("replaces a local copy with a strictly newer fetched one", () => {
    // The cross-device propagation case: Device A edited the note
    // with a later `updatedAt`; the refresh on Device B pulls the
    // newer JSON and the merge picks it.
    const local = workspace([
      note("a", "old body from B", "2026-05-01T10:00:00.000Z"),
    ]);
    const fetched = [
      note("a", "fresh body from A", "2026-05-01T10:01:00.000Z"),
    ];

    const next = applyDriveRefresh(local, fetched, [{ noteId: "a" }]);

    expect(next.notes[0].body).toBe("fresh body from A");
    expect(next.notes[0].updatedAt).toBe("2026-05-01T10:01:00.000Z");
  });

  it("keeps the local copy when its updatedAt is strictly newer than the fetched one", () => {
    // The mid-edit case: the user is typing on Device B while the
    // refresh is in flight. Every keystroke bumps `local.updatedAt`
    // past whatever Drive captured before the user started, so the
    // merge picks local for that id and the in-flight edit survives.
    const local = workspace([
      note("a", "user is mid-edit here", "2026-05-01T10:02:00.000Z"),
    ]);
    const fetched = [
      note("a", "pre-edit drive copy", "2026-05-01T10:00:00.000Z"),
    ];

    const next = applyDriveRefresh(local, fetched, [{ noteId: "a" }]);

    expect(next.notes[0].body).toBe("user is mid-edit here");
  });

  it("keeps the local copy on a tie (same updatedAt) — local wins, matching mergeWorkspaces", () => {
    // Tie semantics intentionally mirror `mergeWorkspaces`. The
    // strict-greater check (not `>=`) is what produces this: a
    // fetched note with the SAME updatedAt as local doesn't unseat
    // the local version. The local version may have already had
    // additional unsaved metadata applied (auto-tags, fresh-note
    // backfill) that the remote doesn't know about yet.
    const local = workspace([
      note("a", "local body", "2026-05-01T10:00:00.000Z", {
        tags: ["from-local"],
      }),
    ]);
    const fetched = [note("a", "remote body", "2026-05-01T10:00:00.000Z")];

    const next = applyDriveRefresh(local, fetched, [{ noteId: "a" }]);

    expect(next.notes[0].body).toBe("local body");
    expect(next.notes[0].tags).toEqual(["from-local"]);
  });

  it("adds fetched notes the local workspace had never seen", () => {
    // A fresh note created on Device A (silent capture or otherwise)
    // shows up in the inventory AND in the fetched batch — local has
    // no record of it. The merge appends it.
    const local = workspace([
      note("a", "alpha", "2026-05-01T10:00:00.000Z"),
    ]);
    const fetched = [
      note("new", "captured on phone", "2026-05-01T10:05:00.000Z"),
    ];

    const next = applyDriveRefresh(local, fetched, [
      { noteId: "a" },
      { noteId: "new" },
    ]);

    expect(next.notes.map((n) => n.id).toSorted()).toEqual(["a", "new"]);
  });

  it("skips fetched notes whose id is not in the inventory (defensive)", () => {
    // The inventory is authoritative. If a stale JSON somehow gets
    // fed in for an id that's not on Drive, ignore it rather than
    // resurrect a phantom.
    const local = workspace([
      note("a", "alpha", "2026-05-01T10:00:00.000Z"),
    ]);
    const fetched = [note("phantom", "stale", "2026-05-01T10:01:00.000Z")];

    const next = applyDriveRefresh(local, fetched, [{ noteId: "a" }]);

    expect(next.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("sorts the result by updatedAt descending (most recent first) when something changes", () => {
    // Notes-list rendering relies on this order — same invariant the
    // canonical loadWorkspace path preserves. Triggering a real
    // change (an appended new note) so the function takes the
    // re-sort path; the steady-state no-op path returns the local
    // reference unchanged precisely because local is already sorted.
    const local = workspace([
      note("new", "", "2026-05-01T00:00:00.000Z"),
      note("old", "", "2026-04-01T00:00:00.000Z"),
    ]);
    const fetched = [note("mid", "captured elsewhere", "2026-04-15T00:00:00.000Z")];

    const next = applyDriveRefresh(local, fetched, [
      { noteId: "old" },
      { noteId: "new" },
      { noteId: "mid" },
    ]);

    expect(next.notes.map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });

  it("returns the same workspace reference on a steady-state no-op", () => {
    // The orchestrator uses the reference identity to decide whether
    // to render + persist. A focus event that lands while everything
    // is already in sync should cost zero renders.
    const local = workspace([
      note("a", "", "2026-05-01T10:00:00.000Z"),
      note("b", "", "2026-04-30T10:00:00.000Z"),
    ]);

    const next = applyDriveRefresh(local, [], [
      { noteId: "a" },
      { noteId: "b" },
    ]);

    expect(next).toBe(local);
  });

  it("keeps the activeNoteId when it still resolves to a present note", () => {
    const local = workspace(
      [
        note("a", "", "2026-05-01T10:00:00.000Z"),
        note("b", "", "2026-04-30T10:00:00.000Z"),
      ],
      "b",
    );

    const next = applyDriveRefresh(local, [], [
      { noteId: "a" },
      { noteId: "b" },
    ]);

    expect(next.activeNoteId).toBe("b");
  });

  it("falls back to the newest note when the active id was dropped from the inventory", () => {
    // The active note was deleted on another device. We can't keep
    // pointing at it; the safest behaviour mirrors mergeWorkspaces —
    // fall through to the workspace's first (newest) note. Both
    // candidates carry a body so neither qualifies as a local-only
    // empty draft (those are deliberately preserved by the refresh
    // — see the "preserves empty draft notes" cases further down).
    const local = workspace(
      [
        note("survives", "still here", "2026-05-01T10:00:00.000Z"),
        note("deleted-elsewhere", "user typed this", "2026-04-30T10:00:00.000Z"),
      ],
      "deleted-elsewhere",
    );

    const next = applyDriveRefresh(local, [], [{ noteId: "survives" }]);

    expect(next.activeNoteId).toBe("survives");
  });

  it("returns activeNoteId null when the inventory is empty", () => {
    // Drive has zero notes left; nothing to point at. The note carries
    // a body so it doesn't qualify as a local-only empty draft (those
    // are deliberately preserved; see the "preserves empty draft notes"
    // cases below).
    const local = workspace([note("a", "real body", "2026-05-01T10:00:00.000Z")], "a");
    const next = applyDriveRefresh(local, [], []);
    expect(next.notes).toHaveLength(0);
    expect(next.activeNoteId).toBeNull();
  });

  it("preserves empty draft notes that the user just spawned but hasn't typed into", () => {
    // Regression: clicking "+ Add" / "+ New note" / `N` creates a
    // local-only empty draft and opens its editor. The draft is
    // intentionally never pushed to Drive — `stripEmptyDraftNotes`
    // filters it out before every remote save — so its id is *never*
    // present in the Drive inventory.
    //
    // Before this fix, a focus-driven refresh that landed while the
    // user was looking at a fresh draft (autosave timer null because
    // the draft is still empty, so `canRefresh` returned true) dropped
    // the draft as "missing from inventory ⇒ deleted on another
    // device". The detail route then bounced the editor back to the
    // notes list mid-thought, which is what the user reported as
    // "clicking New note opens the editor and immediately redirects
    // me back to the list".
    const local = workspace(
      [
        note("draft", "", "2026-05-01T10:00:00.000Z"),
        note("a", "alpha", "2026-04-30T10:00:00.000Z"),
      ],
      "draft",
    );

    const next = applyDriveRefresh(local, [], [{ noteId: "a" }]);

    expect(next.notes.map((n) => n.id)).toContain("draft");
    expect(next.activeNoteId).toBe("draft");
  });

  it("still drops a non-empty local note that vanished from the inventory (deleted on another device)", () => {
    // The local-only-draft exemption above must not regress the
    // cross-device-delete path. A note with real content whose id is
    // missing from the inventory was deleted on another device and
    // must disappear here. `isEmptyDraftNote` is the gate: empty body
    // AND no tags. Anything past that gate is real content.
    const local = workspace(
      [
        note("typed", "user wrote something", "2026-05-01T10:00:00.000Z"),
        note("a", "alpha", "2026-04-30T10:00:00.000Z"),
      ],
      "typed",
    );

    const next = applyDriveRefresh(local, [], [{ noteId: "a" }]);

    expect(next.notes.map((n) => n.id)).toEqual(["a"]);
  });

  it("returns the same workspace reference when the only delta is a preserved local-only draft", () => {
    // Steady-state guard: if the only "difference" between local and
    // Drive is a local-only empty draft, the refresh is structurally
    // a no-op and must return the same workspace reference so the
    // orchestrator can skip the render + persist round. Without
    // tracking `mutated` correctly inside the draft-preservation
    // branch, a focus event would otherwise trigger a render every
    // time the user has a fresh draft open even though nothing
    // changed.
    const local = workspace(
      [
        note("draft", "", "2026-05-01T10:00:00.000Z"),
        note("a", "alpha", "2026-04-30T10:00:00.000Z"),
      ],
      "draft",
    );

    const next = applyDriveRefresh(local, [], [{ noteId: "a" }]);

    expect(next).toBe(local);
  });

  it("preserves a freshly-spawned draft even after the post-`+ Add` title backfill", () => {
    // The async backfill inside `handleNewNoteCreation` lands a
    // generated "Tuesday afternoon in Prague"-style title plus
    // captureContext on the draft *before* the user has typed
    // anything. `isEmptyDraftNote` deliberately ignores those
    // metadata fields, so the patched draft is still local-only and
    // refresh must still keep it.
    const local = workspace(
      [
        note("draft", "", "2026-05-01T10:00:00.000Z", {
          title: "Monday afternoon in Prague",
          location: "Prague",
        }),
      ],
      "draft",
    );

    const next = applyDriveRefresh(local, [], []);

    expect(next.notes.map((n) => n.id)).toContain("draft");
    expect(next.activeNoteId).toBe("draft");
  });
});
