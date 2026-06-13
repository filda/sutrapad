import { describe, expect, it } from "vitest";
import {
  readActivePageFromLocation,
  readNoteDetailIdFromLocation,
  writeActivePageToLocation,
  writeNoteDetailIdToLocation,
} from "../src/app/logic/active-page";

const ORIGIN = "https://app.example";
const BASE = "/sutrapad/";

function url(pathname: string, suffix = ""): string {
  return `${ORIGIN}${pathname}${suffix}`;
}

describe("readActivePageFromLocation", () => {
  it("resolves the bare base path to the default page", () => {
    expect(readActivePageFromLocation(url("/sutrapad/"), BASE)).toBe("notes");
  });

  it("resolves the base path without its trailing slash to the default page", () => {
    // `/sutrapad` (no trailing slash) is the canonical entry point a user
    // typically types; it must still land on the default page.
    expect(readActivePageFromLocation(url("/sutrapad"), BASE)).toBe("notes");
  });

  it("maps a known slug to its page id", () => {
    expect(readActivePageFromLocation(url("/sutrapad/links"), BASE)).toBe("links");
  });

  it("normalises slug casing and surrounding whitespace before matching", () => {
    // Pins the `candidate.trim().toLowerCase()` step. A deep link with an
    // upper-case or percent-encoded-space slug should still resolve, not
    // silently fall back to the default page.
    expect(readActivePageFromLocation(url("/sutrapad/LINKS"), BASE)).toBe("links");
    expect(readActivePageFromLocation(url("/sutrapad/%20links%20"), BASE)).toBe(
      "links",
    );
  });

  it("falls back to the default page for an unknown slug", () => {
    expect(readActivePageFromLocation(url("/sutrapad/wat"), BASE)).toBe("notes");
  });

  it("surfaces an action-only menu id as the default page", () => {
    // "add" is an action item with no dedicated page — a deep link to it
    // must resolve to the default page rather than an empty placeholder.
    expect(readActivePageFromLocation(url("/sutrapad/add"), BASE)).toBe("notes");
  });

  it("does not confuse a path that merely shares the base prefix", () => {
    // `/sutrapadXlinks` shares the leading "/sutrapad" string but is not
    // under the "/sutrapad/" base. Without the `startsWith(baseWithSlash)`
    // guard the code would slice off the base length and read "links" as
    // the page — so this pins that guard against prefix confusion.
    expect(readActivePageFromLocation(url("/sutrapadXlinks"), BASE)).toBe("notes");
  });

  it("falls back to the default page on malformed percent-encoding", () => {
    expect(readActivePageFromLocation(url("/sutrapad/%E0%A4%A"), BASE)).toBe(
      "notes",
    );
  });

  it("treats an empty Vite base the same as root", () => {
    expect(readActivePageFromLocation(url("/links"), "")).toBe("links");
    expect(readActivePageFromLocation(url("/"), "")).toBe("notes");
  });

  it("accepts a base supplied without leading or trailing slashes", () => {
    expect(readActivePageFromLocation(url("/sutrapad/links"), "sutrapad")).toBe(
      "links",
    );
  });
});

describe("writeActivePageToLocation", () => {
  it("writes a non-default page as a slug under the base", () => {
    expect(writeActivePageToLocation(url("/sutrapad/"), "links", BASE)).toBe(
      url("/sutrapad/links"),
    );
  });

  it("collapses the default page back to the bare base path", () => {
    expect(writeActivePageToLocation(url("/sutrapad/links"), "notes", BASE)).toBe(
      url("/sutrapad/"),
    );
  });

  it("preserves query and hash when rewriting the path", () => {
    expect(
      writeActivePageToLocation(url("/sutrapad/links", "?q=1#frag"), "tasks", BASE),
    ).toBe(url("/sutrapad/tasks", "?q=1#frag"));
  });

  it("round-trips every page through read after write", () => {
    for (const page of ["notes", "links", "tasks"] as const) {
      const written = writeActivePageToLocation(url("/sutrapad/"), page, BASE);
      expect(readActivePageFromLocation(written, BASE)).toBe(page);
    }
  });
});

describe("readNoteDetailIdFromLocation", () => {
  it("reads a decoded id from a notes/<id> path", () => {
    expect(readNoteDetailIdFromLocation(url("/sutrapad/notes/abc123"), BASE)).toBe(
      "abc123",
    );
  });

  it("decodes percent-encoded ids", () => {
    expect(
      readNoteDetailIdFromLocation(url("/sutrapad/notes/a%2Fb%20c"), BASE),
    ).toBe("a/b c");
  });

  it("normalises the casing of the notes segment", () => {
    // Pins `segments[0].toLowerCase() === "notes"`: an upper-case "NOTES"
    // segment must still be recognised as a note-detail route. (The segment
    // comes straight from a split pathname and is never decoded, so it can't
    // carry whitespace — hence no trim here.)
    expect(readNoteDetailIdFromLocation(url("/sutrapad/NOTES/abc"), BASE)).toBe(
      "abc",
    );
  });

  it("returns null when not on a notes route", () => {
    expect(readNoteDetailIdFromLocation(url("/sutrapad/links/abc"), BASE)).toBeNull();
  });

  it("returns null when the id segment is missing", () => {
    expect(readNoteDetailIdFromLocation(url("/sutrapad/notes"), BASE)).toBeNull();
  });

  it("returns null when the path is not under the base at all", () => {
    expect(readNoteDetailIdFromLocation(url("/other/notes/abc"), BASE)).toBeNull();
  });

  it("returns null for an id that decodes to whitespace only", () => {
    expect(readNoteDetailIdFromLocation(url("/sutrapad/notes/%20%20"), BASE)).toBeNull();
  });

  it("returns null on malformed percent-encoding in the id", () => {
    expect(readNoteDetailIdFromLocation(url("/sutrapad/notes/%E0%A4%A"), BASE)).toBeNull();
  });
});

describe("writeNoteDetailIdToLocation", () => {
  it("writes an encoded notes/<id> path", () => {
    expect(writeNoteDetailIdToLocation(url("/sutrapad/"), "a/b c", BASE)).toBe(
      url("/sutrapad/notes/a%2Fb%20c"),
    );
  });

  it("preserves query and hash", () => {
    expect(
      writeNoteDetailIdToLocation(url("/sutrapad/notes", "?x=1#h"), "id1", BASE),
    ).toBe(url("/sutrapad/notes/id1", "?x=1#h"));
  });

  it("round-trips arbitrary ids through read after write", () => {
    for (const id of ["plain", "a/b c", "diakritika-ěščř", "100% done"]) {
      const written = writeNoteDetailIdToLocation(url("/sutrapad/"), id, BASE);
      expect(readNoteDetailIdFromLocation(written, BASE)).toBe(id);
    }
  });
});
