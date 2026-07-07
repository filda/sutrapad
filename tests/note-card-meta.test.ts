import { describe, expect, it } from "vitest";
import { buildNoteCardMeta } from "../src/lib/note-card-meta";
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
