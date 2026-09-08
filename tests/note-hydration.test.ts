import { describe, expect, it } from "vitest";
import { adoptRemotePlaceholders, applyHydratedNote } from "../src/app/logic/note-hydration";
import { buildPlaceholderNote } from "../src/lib/note-card-meta";
import type { SutraPadDocument, SutraPadNoteSummary, SutraPadWorkspace } from "../src/types";

function summary(overrides: Partial<SutraPadNoteSummary> & Pick<SutraPadNoteSummary, "id">): SutraPadNoteSummary {
  return {
    title: "Real title",
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

function fullDoc(overrides: Partial<SutraPadDocument> & Pick<SutraPadDocument, "id">): SutraPadDocument {
  return {
    title: "Real title",
    body: "The real body from Drive",
    urls: [],
    tags: ["kept-tag"],
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("applyHydratedNote", () => {
  it("replaces the placeholder with the fetched document and marks it hydrated", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1" }));
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [placeholder] };

    const updated = applyHydratedNote(workspace, "1", fullDoc({ id: "1" }));

    expect(updated.notes[0].body).toBe("The real body from Drive");
    expect(updated.notes[0].hydrated).toBe(true);
    expect(updated.activeNoteId).toBe("1");
  });

  it("leaves every other note untouched", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1" }));
    const sibling = buildPlaceholderNote(summary({ id: "2" }));
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [placeholder, sibling] };

    const updated = applyHydratedNote(workspace, "1", fullDoc({ id: "1" }));

    expect(updated.notes[1]).toBe(sibling);
  });

  it("no-ops when the note is gone (deleted, or a refresh dropped it mid-fetch)", () => {
    const workspace: SutraPadWorkspace = { activeNoteId: null, notes: [] };

    const updated = applyHydratedNote(workspace, "missing", fullDoc({ id: "missing" }));

    expect(updated).toBe(workspace);
  });

  it("no-ops when the note is already hydrated (a slower duplicate fetch loses the race)", () => {
    const alreadyHydrated = fullDoc({ id: "1", body: "edited while the fetch was in flight" });
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [alreadyHydrated] };

    const updated = applyHydratedNote(
      workspace,
      "1",
      fullDoc({ id: "1", body: "stale fetched body" }),
    );

    expect(updated).toBe(workspace);
    expect(updated.notes[0].body).toBe("edited while the fetch was in flight");
  });
});

describe("adoptRemotePlaceholders", () => {
  const T = "2026-09-08T10:00:00.000Z";
  const hydrated = (id: string, updatedAt = T): SutraPadDocument => ({
    id,
    title: id,
    body: `body ${id}`,
    urls: [],
    tags: [],
    createdAt: T,
    updatedAt,
  });
  const placeholder = (id: string, updatedAt = T): SutraPadDocument => ({
    ...hydrated(id, updatedAt),
    body: "",
    hydrated: false,
    fileId: `file-${id}`,
  });

  it("swaps hydrated notes for Drive's placeholder when the stamps match, keeping the active note", () => {
    const local = { notes: [hydrated("a"), hydrated("b"), hydrated("c")], activeNoteId: "b" };
    const remote = { notes: [placeholder("a"), placeholder("b"), placeholder("c")], activeNoteId: "a" };
    const result = adoptRemotePlaceholders(local, remote, new Set(["b"]));
    expect(result.notes.map((n) => [n.id, n.hydrated, n.body])).toEqual([
      ["a", false, ""],
      ["b", undefined, "body b"],
      ["c", false, ""],
    ]);
    expect(result.notes[0]).toBe(remote.notes[0]); // the remote object itself, fileId included
    expect(result.activeNoteId).toBe("b");
  });

  it("leaves a local edit Drive has not seen (different stamp) and notes with no remote twin alone", () => {
    const edited = hydrated("a", "2026-09-08T11:00:00.000Z");
    const localOnly = hydrated("new");
    const local = { notes: [edited, localOnly], activeNoteId: null };
    const remote = { notes: [placeholder("a")], activeNoteId: "a" };
    expect(adoptRemotePlaceholders(local, remote, new Set())).toBe(local);
  });

  it("ignores remote copies that are themselves hydrated (orphans) and local placeholders", () => {
    const local = { notes: [hydrated("a"), placeholder("b")], activeNoteId: null };
    const remote = { notes: [hydrated("a"), placeholder("b")], activeNoteId: null };
    expect(adoptRemotePlaceholders(local, remote, new Set())).toBe(local);
  });
});
