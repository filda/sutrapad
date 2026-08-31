import { describe, expect, it, vi } from "vitest";
import {
  dropSourceFromDataTransfer,
  extractDropNotes,
  handleImportDrop,
  parseNoteImport,
  toImportedNote,
} from "../src/app/logic/drop-import";

const fileOf = (content: string) => ({ text: () => Promise.resolve(content) });

const bundleDrop = (content: string) =>
  ({
    files: [fileOf(content)],
    getData: () => "",
  }) as unknown as DataTransfer;

describe("toImportedNote", () => {
  it("preserves a well-formed note verbatim (id, timestamps, tags)", () => {
    const note = toImportedNote({
      id: "abc",
      title: "Hello",
      body: "world\nsecond line",
      urls: ["https://example.com/a"],
      createdAt: "2020-01-02T03:04:05Z",
      updatedAt: "2021-02-03T04:05:06Z",
      tags: ["facebook-import"],
    });
    expect(note).toEqual({
      id: "abc",
      title: "Hello",
      body: "world\nsecond line",
      urls: ["https://example.com/a"],
      createdAt: "2020-01-02T03:04:05Z",
      updatedAt: "2021-02-03T04:05:06Z",
      tags: ["facebook-import"],
    });
  });

  it("leaves the title empty when none is given (the app derives a headline from the body)", () => {
    const note = toImportedNote({ body: "\n  first real line  \nmore" });
    expect(note?.title).toBe("");
    expect(note?.body).toBe("\n  first real line  \nmore");
  });

  it("generates an id when none is provided", () => {
    const note = toImportedNote({ body: "no id here" });
    expect(typeof note?.id).toBe("string");
    expect(note?.id.length).toBeGreaterThan(0);
  });

  it("drops non-http(s) urls and keeps only safe ones", () => {
    const note = toImportedNote({
      title: "t",
      body: "b",
      urls: [
        "https://ok.example/a",
        "javascript:alert(1)",
        "data:text/html,x",
        "http://ok.example/b",
        42,
      ],
    });
    expect(note?.urls).toEqual(["https://ok.example/a", "http://ok.example/b"]);
  });

  it("re-extracts urls from the body when urls isn't an array", () => {
    const note = toImportedNote({
      title: "t",
      body: "see https://body.example/x",
      urls: "javascript:alert(1)",
    });
    expect(note?.urls).toEqual(["https://body.example/x"]);
  });

  it("falls back to updatedAt/now for missing or invalid timestamps", () => {
    const note = toImportedNote({
      body: "b",
      createdAt: "not-a-date",
      updatedAt: "2022-05-06T07:08:09Z",
    });
    expect(note?.updatedAt).toBe("2022-05-06T07:08:09Z");
    expect(note?.createdAt).toBe("2022-05-06T07:08:09Z");
  });

  it("keeps only string tags", () => {
    const note = toImportedNote({ body: "b", tags: ["a", 1, null, "b"] });
    expect(note?.tags).toEqual(["a", "b"]);
  });

  it("returns null for a note with neither title nor body", () => {
    expect(toImportedNote({ title: "   ", body: "  " })).toBeNull();
    expect(toImportedNote({})).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(toImportedNote(null)).toBeNull();
    expect(toImportedNote("string")).toBeNull();
    expect(toImportedNote(7)).toBeNull();
  });
});

describe("parseNoteImport", () => {
  it("parses an array of notes, skipping invalid entries", () => {
    const json = JSON.stringify([
      { id: "1", title: "One", body: "a", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", tags: [] },
      { title: "", body: "" },
      { id: "2", title: "Two", body: "b", createdAt: "2020-01-02T00:00:00Z", updatedAt: "2020-01-02T00:00:00Z", tags: [] },
    ]);
    const notes = parseNoteImport(json);
    expect(notes?.map((n) => n.id)).toEqual(["1", "2"]);
  });

  it("accepts a single note object (not wrapped in an array)", () => {
    const json = JSON.stringify({
      id: "solo",
      title: "Solo",
      body: "x",
      createdAt: "2020-01-01T00:00:00Z",
      updatedAt: "2020-01-01T00:00:00Z",
      tags: [],
    });
    const notes = parseNoteImport(json);
    expect(notes).toHaveLength(1);
    expect(notes?.[0].id).toBe("solo");
  });

  it("returns an empty array for JSON that contains no valid notes", () => {
    expect(parseNoteImport(JSON.stringify([{}, { title: " " }]))).toEqual([]);
  });

  it("returns null when the text isn't JSON at all", () => {
    expect(parseNoteImport("just some dropped text")).toBeNull();
    expect(parseNoteImport("")).toBeNull();
  });
});

describe("extractDropNotes", () => {
  it("expands a dropped JSON bundle file into its notes", async () => {
    const bundle = JSON.stringify([
      { id: "a", body: "one", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", tags: [] },
      { id: "b", body: "two", createdAt: "2020-01-02T00:00:00Z", updatedAt: "2020-01-02T00:00:00Z", tags: [] },
    ]);
    const notes = await extractDropNotes({ files: [fileOf(bundle)], getText: () => "" });
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("imports a single-note JSON file", async () => {
    const single = JSON.stringify({ id: "solo", body: "x", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", tags: [] });
    const notes = await extractDropNotes({ files: [fileOf(single)], getText: () => "" });
    expect(notes.map((n) => n.id)).toEqual(["solo"]);
  });

  it("treats a non-JSON file as a single text note from its contents", async () => {
    const notes = await extractDropNotes({
      files: [fileOf("just a plain text file\nsecond line")],
      getText: () => "",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("");
    expect(notes[0].body).toBe("just a plain text file\nsecond line");
  });

  it("combines notes across multiple dropped files", async () => {
    const bundle = JSON.stringify([{ id: "j1", body: "x", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", tags: [] }]);
    const notes = await extractDropNotes({
      files: [fileOf(bundle), fileOf("loose text")],
      getText: () => "",
    });
    expect(notes).toHaveLength(2);
    expect(notes[0].id).toBe("j1");
    expect(notes[1].body).toBe("loose text");
  });

  it("skips a file that fails to read without aborting the rest", async () => {
    const failing = { text: () => Promise.reject(new Error("read error")) };
    const ok = fileOf("kept");
    const notes = await extractDropNotes({ files: [failing, ok], getText: () => "" });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe("kept");
  });

  it("makes a text note from a fileless (text/URL) drop", async () => {
    const notes = await extractDropNotes({
      files: [],
      getText: () => "https://example.com/dropped",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].urls).toEqual(["https://example.com/dropped"]);
  });

  it("returns nothing for an empty fileless drop", async () => {
    const notes = await extractDropNotes({ files: [], getText: () => "   " });
    expect(notes).toEqual([]);
  });
});

describe("dropSourceFromDataTransfer", () => {
  it("maps files and prefers text/uri-list over text/plain for the text getter", () => {
    const dataTransfer = {
      files: [fileOf("f")],
      getData: (format: string) =>
        format === "text/uri-list" ? "https://u.example" : "plain",
    } as unknown as DataTransfer;
    const source = dropSourceFromDataTransfer(dataTransfer);
    expect(source.files).toHaveLength(1);
    expect(source.getText()).toBe("https://u.example");
  });

  it("falls back to text/plain when uri-list is empty", () => {
    const dataTransfer = {
      files: [],
      getData: (format: string) =>
        format === "text/uri-list" ? "" : "just text",
    } as unknown as DataTransfer;
    expect(dropSourceFromDataTransfer(dataTransfer).getText()).toBe("just text");
  });
});

describe("handleImportDrop", () => {
  it("imports extracted notes and emits start then progress then done", async () => {
    const bundle = JSON.stringify([
      { id: "a", body: "x", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", tags: [] },
    ]);
    const statuses: string[] = [];
    const importNotes = vi.fn(
      (
        notes: unknown[],
        options?: { onProgress?: (p: { done: number; failed: number; total: number }) => void },
      ) => {
        options?.onProgress?.({ done: notes.length, failed: 0, total: notes.length });
        return Promise.resolve({ done: notes.length, failed: 0, total: notes.length });
      },
    );
    const result = await handleImportDrop(bundleDrop(bundle), {
      importNotes,
      onStatus: (status) => statuses.push(status.phase),
    });
    expect(importNotes).toHaveBeenCalledTimes(1);
    expect(importNotes.mock.calls[0][0]).toHaveLength(1);
    expect(statuses).toEqual(["start", "progress", "done"]);
    expect(result).toEqual({ done: 1, failed: 0, total: 1 });
  });

  it("emits empty and skips importNotes when the drop has no notes", async () => {
    const empty = { files: [], getData: () => "  " } as unknown as DataTransfer;
    const importNotes = vi.fn(() =>
      Promise.resolve({ done: 0, failed: 0, total: 0 }),
    );
    const statuses: string[] = [];
    const result = await handleImportDrop(empty, {
      importNotes,
      onStatus: (status) => statuses.push(status.phase),
    });
    expect(importNotes).not.toHaveBeenCalled();
    expect(statuses).toEqual(["empty"]);
    expect(result).toBeNull();
  });
});

function fnPayload(props: Record<string, unknown>): unknown {
  return Object.assign(function payload() {}, props);
}

describe("toImportedNote defensive fields", () => {
  it("generates an id when the imported one is an empty string", () => {
    // `isNonEmptyString` — the suite feeds a real id or omits the key, so
    // `value.length > 0` never has to reject a present-but-blank id. An
    // empty id would collide with every other empty id on re-import.
    const note = toImportedNote({ id: "", title: "Kept" });
    expect(note?.id).not.toBe("");
    expect(note?.id).toMatch(/[0-9a-f-]{36}/u);
  });

  it("rejects a function payload", () => {
    // `typeof raw !== "object"` — the null half of the guard catches null,
    // and every primitive falls through to the "nothing worth importing"
    // exit anyway. A function is the one non-object that carries fields.
    expect(toImportedNote(fnPayload({ title: "Leaked", body: "text" }))).toBeNull();
  });

  it("imports a note that has a title but no body", () => {
    // The guard is `body.trim().length === 0 && rawTitle.length === 0` — an
    // `&&`, so a titled-but-bodyless note must survive. Dropping the second
    // half silently discards every title-only note in an export.
    const note = toImportedNote({ title: "Only a title", body: "   " });
    expect(note?.title).toBe("Only a title");
    expect(note?.body).toBe("   ");
  });

  it("falls back to an empty tag list when `tags` is not an array", () => {
    expect(toImportedNote({ title: "x", tags: "urgent" })?.tags).toEqual([]);
    expect(toImportedNote({ title: "x", tags: 42 })?.tags).toEqual([]);
  });
});

describe("dropSourceFromDataTransfer text fallback", () => {
  it("falls back to text/plain when there is no uri-list", () => {
    const dataTransfer = {
      files: [],
      getData: (type: string) => (type === "text/plain" ? "https://example.com/x" : ""),
    } as unknown as DataTransfer;

    expect(dropSourceFromDataTransfer(dataTransfer).getText()).toBe(
      "https://example.com/x",
    );
  });

  it("prefers text/uri-list over text/plain", () => {
    const dataTransfer = {
      files: [],
      getData: (type: string) =>
        type === "text/uri-list" ? "https://uri.example/a" : "https://plain.example/b",
    } as unknown as DataTransfer;

    expect(dropSourceFromDataTransfer(dataTransfer).getText()).toBe(
      "https://uri.example/a",
    );
  });
});
