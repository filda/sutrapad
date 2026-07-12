import { describe, expect, it } from "vitest";
import { buildNoteCardMeta, buildNoteSummary } from "../src/lib/note-card-meta";
import type { SutraPadDocument } from "../src/types";

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
