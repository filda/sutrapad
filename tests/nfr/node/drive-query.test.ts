import { describe, expect, it } from "vitest";
import { compileDriveQuery, DriveQueryError } from "../drive-query";

const note = {
  name: "note-abc.json",
  mimeType: "application/json",
  appProperties: { sutrapad: "true", kind: "note", noteId: "abc" },
  parents: ["folder-1"],
};
const folder = {
  name: "SutraPad",
  mimeType: "application/vnd.google-apps.folder",
  appProperties: { sutrapad: "true", kind: "folder" },
  parents: ["root"],
};

describe("compileDriveQuery", () => {
  it("evaluates every query shape the stores emit", () => {
    const folderScoped = compileDriveQuery(
      "trashed = false and 'folder-1' in parents and ((appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' }) or name contains 'note-')",
    );
    expect(folderScoped(note)).toBe(true);
    expect(folderScoped({ ...note, parents: ["elsewhere"] })).toBe(false);
    expect(folderScoped({ ...note, appProperties: {}, name: "footnote-1.json" })).toBe(true);
    expect(folderScoped({ ...note, appProperties: {}, name: "other.json" })).toBe(false);

    const folderLookup = compileDriveQuery(
      "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='folder' } and name = 'SutraPad'",
    );
    expect(folderLookup(folder)).toBe(true);
    expect(folderLookup({ ...folder, name: "Other" })).toBe(false);
    expect(folderLookup(note)).toBe(false);

    const byNoteId = compileDriveQuery(
      "trashed = false and appProperties has { key='sutrapad' and value='true' } and appProperties has { key='kind' and value='note' } and appProperties has { key='noteId' and value='abc' }",
    );
    expect(byNoteId(note)).toBe(true);
    expect(byNoteId({ ...note, appProperties: { ...note.appProperties, noteId: "zzz" } })).toBe(false);
  });

  it("honours `trashed = true`, `!=`, and escaped quotes", () => {
    expect(compileDriveQuery("trashed = true")({ ...note, trashed: true })).toBe(true);
    expect(compileDriveQuery("trashed = false")({ ...note, trashed: true })).toBe(false);
    expect(compileDriveQuery("name != 'note-abc.json'")(note)).toBe(false);
    expect(compileDriveQuery("name = 'it\\'s \\\\ here'")({ ...note, name: "it's \\ here" })).toBe(true);
  });

  it("gives `and` precedence over `or`", () => {
    const predicate = compileDriveQuery("name = 'a' or name = 'b' and trashed = true");
    expect(predicate({ ...note, name: "a" })).toBe(true);
    expect(predicate({ ...note, name: "b" })).toBe(false);
    expect(predicate({ ...note, name: "b", trashed: true })).toBe(true);
  });

  it("rejects syntax outside the supported subset instead of matching nothing", () => {
    for (const bad of [
      "modifiedTime > '2026-01-01'",
      "name = 'unterminated",
      "trashed = maybe",
      "name ~ 'x'",
      "(name = 'a'",
      "name = 'a' extra",
      "fullText contains 'x'",
    ]) {
      expect(() => compileDriveQuery(bad)).toThrow(DriveQueryError);
    }
  });
});
