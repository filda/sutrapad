import { describe, expect, it } from "vitest";
import {
  buildNoteCardMeta,
  buildNoteSummary,
  buildPlaceholderNote,
  reconcileNoteSummaries,
} from "../src/lib/note-card-meta";
import type { SutraPadDocument, SutraPadNoteSummary, SutraPadWorkspace } from "../src/types";

function note(overrides: Partial<SutraPadDocument>): SutraPadDocument {
  return {
    id: "n",
    title: "",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildNoteCardMeta", () => {
  it("uses the title as headline and the full body as excerpt when titled", () => {
    const meta = buildNoteCardMeta(note({ title: "  My title  ", body: "line one\nline two" }));
    expect(meta.headline).toBe("My title");
    expect(meta.excerpt).toBe("line one line two");
  });

  it("derives headline from the first body line and excerpts the rest when title is blank", () => {
    const meta = buildNoteCardMeta(note({ title: "", body: "headline here\nthe rest" }));
    expect(meta.headline).toBe("headline here");
    expect(meta.excerpt).toBe("the rest");
  });

  it("gives an empty excerpt for a title-less one-liner", () => {
    const meta = buildNoteCardMeta(note({ title: "", body: "just one line" }));
    expect(meta.headline).toBe("just one line");
    expect(meta.excerpt).toBe("");
  });

  it("passes tags and location through", () => {
    const meta = buildNoteCardMeta(
      note({ title: "t", body: "b", tags: ["x", "y"], location: "Praha" }),
    );
    expect(meta.tags).toEqual(["x", "y"]);
    expect(meta.location).toBe("Praha");
  });

  it("counts open/done tasks from the body", () => {
    const meta = buildNoteCardMeta(
      note({ title: "t", body: "- [ ] todo\n- [x] done\n- [ ] another" }),
    );
    expect(meta.tasks).toEqual({ open: 2, done: 1 });
  });

  it("truncates a long excerpt to the card budget", () => {
    const meta = buildNoteCardMeta(note({ title: "t", body: "x".repeat(200) }));
    expect(meta.excerpt.length).toBe(72);
    expect(meta.excerpt.endsWith("…")).toBe(true);
  });
});

describe("buildNoteSummary", () => {
  it("carries the identity fields straight through", () => {
    const summary = buildNoteSummary(
      note({
        id: "abc",
        title: "T",
        createdAt: "2021-02-03T00:00:00.000Z",
        updatedAt: "2022-03-04T00:00:00.000Z",
      }),
    );
    expect(summary.id).toBe("abc");
    expect(summary.title).toBe("T");
    expect(summary.createdAt).toBe("2021-02-03T00:00:00.000Z");
    expect(summary.updatedAt).toBe("2022-03-04T00:00:00.000Z");
  });

  it("mirrors the card meta (headline / excerpt / tags / location / tasks)", () => {
    const doc = note({
      title: "",
      body: "headline here\nthe rest",
      tags: ["x"],
      location: "Praha",
    });
    const summary = buildNoteSummary(doc);
    const meta = buildNoteCardMeta(doc);
    expect(summary.headline).toBe(meta.headline);
    expect(summary.excerpt).toBe(meta.excerpt);
    expect(summary.tags).toEqual(meta.tags);
    expect(summary.location).toBe(meta.location);
    expect(summary.tasks).toEqual({ open: meta.tasks.open, done: meta.tasks.done });
  });

  it("carries urls and captureContext for thumb + persona rendering", () => {
    const ctx = { source: "url-capture" as const };
    const summary = buildNoteSummary(
      note({ title: "t", body: "b", urls: ["https://x.test/a"], captureContext: ctx }),
    );
    expect(summary.urls).toEqual(["https://x.test/a"]);
    expect(summary.captureContext).toEqual(ctx);
  });

  it("stores derived auto-tags (source facet from captureContext)", () => {
    const summary = buildNoteSummary(
      note({ title: "t", body: "b", captureContext: { source: "url-capture" } }),
    );
    expect(summary.autoTags).toContain("source:url-capture");
  });

  it("omits location when the note has none", () => {
    const summary = buildNoteSummary(note({ title: "t", body: "b" }));
    expect(summary.location).toBeUndefined();
  });
});

function summary(overrides: Partial<SutraPadNoteSummary> & Pick<SutraPadNoteSummary, "id">): SutraPadNoteSummary {
  return {
    title: "Real title",
    createdAt: "2026-04-13T10:00:00.000Z",
    updatedAt: "2026-04-13T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildPlaceholderNote", () => {
  it("carries the summary's real metadata with an empty, unhydrated body", () => {
    const placeholder = buildPlaceholderNote(
      summary({
        id: "1",
        tags: ["kept-tag"],
        location: "Prague",
        urls: ["https://example.com"],
        fileId: "drive-file-1",
      }),
    );

    expect(placeholder.id).toBe("1");
    expect(placeholder.title).toBe("Real title");
    expect(placeholder.tags).toEqual(["kept-tag"]);
    expect(placeholder.location).toBe("Prague");
    expect(placeholder.urls).toEqual(["https://example.com"]);
    expect(placeholder.body).toBe("");
    expect(placeholder.hydrated).toBe(false);
    // The hydrate-on-open lifecycle needs this to know what to fetch.
    expect(placeholder.fileId).toBe("drive-file-1");
  });

  it("defaults to no tags/urls when the summary predates Phase 2 card metadata", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1" }));
    expect(placeholder.tags).toEqual([]);
    expect(placeholder.urls).toEqual([]);
  });
});

describe("reconcileNoteSummaries", () => {
  it("recomputes the summary fresh for a hydrated note", () => {
    const hydrated = note({ id: "1", title: "", body: "headline\nrest" });
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [hydrated] };

    const summaries = reconcileNoteSummaries(workspace, []);

    expect(summaries[0].headline).toBe("headline");
    expect(summaries[0].excerpt).toBe("rest");
  });

  it("carries forward the previous summary for a placeholder instead of deriving blank card meta from its empty body", () => {
    const previous: SutraPadNoteSummary[] = [
      summary({ id: "1", headline: "Real headline from the index", excerpt: "Real excerpt" }),
    ];
    const placeholder = buildPlaceholderNote(previous[0]);
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [placeholder] };

    const summaries = reconcileNoteSummaries(workspace, previous);

    expect(summaries[0]).toBe(previous[0]);
  });

  it("falls back to a blank-card-meta summary for a placeholder with no previous entry (first render before Drive load lands)", () => {
    const placeholder = buildPlaceholderNote(summary({ id: "1", title: "" }));
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [placeholder] };

    const summaries = reconcileNoteSummaries(workspace, []);

    expect(summaries[0].headline).toBe("");
    expect(summaries[0].excerpt).toBe("");
  });

  it("drops summaries for notes no longer in the workspace", () => {
    const hydrated = note({ id: "1" });
    const workspace: SutraPadWorkspace = { activeNoteId: "1", notes: [hydrated] };
    const previous: SutraPadNoteSummary[] = [
      summary({ id: "1" }),
      summary({ id: "deleted" }),
    ];

    const summaries = reconcileNoteSummaries(workspace, previous);

    expect(summaries.map((s) => s.id)).toEqual(["1"]);
  });
});
