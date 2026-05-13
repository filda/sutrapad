import { describe, expect, it } from "vitest";
import {
  planScrollTransition,
  routeKeysEqual,
  routeScrollKey,
  serializeRouteKey,
  type RouteScrollKey,
} from "../src/app/logic/route-scroll-memory";

describe("routeScrollKey", () => {
  it("returns a page-kind key when no detail note is open", () => {
    expect(routeScrollKey("notes", null)).toEqual({
      kind: "page",
      pageId: "notes",
    });
  });

  it("returns a note-detail-kind key when a detail note is open on the notes route", () => {
    expect(routeScrollKey("notes", "abc")).toEqual({
      kind: "note-detail",
      noteId: "abc",
    });
  });

  it("ignores detailNoteId for non-notes pages — Links scrolled with a stale detailNoteId is still a page route", () => {
    // detailNoteId can carry over from a prior notes visit; the renderer
    // only honours it when activeMenuItem is "notes". Mirror that here so
    // scroll memory keys can't accidentally key off a stale detail value.
    expect(routeScrollKey("links", "stale-id")).toEqual({
      kind: "page",
      pageId: "links",
    });
  });

  it("builds distinct keys per page id", () => {
    expect(routeScrollKey("tasks", null)).toEqual({
      kind: "page",
      pageId: "tasks",
    });
    expect(routeScrollKey("tags", null)).toEqual({
      kind: "page",
      pageId: "tags",
    });
  });
});

describe("routeKeysEqual", () => {
  it("matches two page keys with the same pageId", () => {
    expect(
      routeKeysEqual(
        { kind: "page", pageId: "notes" },
        { kind: "page", pageId: "notes" },
      ),
    ).toBe(true);
  });

  it("rejects two page keys with different pageIds", () => {
    expect(
      routeKeysEqual(
        { kind: "page", pageId: "notes" },
        { kind: "page", pageId: "links" },
      ),
    ).toBe(false);
  });

  it("matches two detail keys with the same noteId", () => {
    expect(
      routeKeysEqual(
        { kind: "note-detail", noteId: "x" },
        { kind: "note-detail", noteId: "x" },
      ),
    ).toBe(true);
  });

  it("rejects two detail keys with different noteIds", () => {
    expect(
      routeKeysEqual(
        { kind: "note-detail", noteId: "x" },
        { kind: "note-detail", noteId: "y" },
      ),
    ).toBe(false);
  });

  it("rejects keys of different kinds", () => {
    expect(
      routeKeysEqual(
        { kind: "page", pageId: "notes" },
        { kind: "note-detail", noteId: "notes" },
      ),
    ).toBe(false);
  });
});

describe("serializeRouteKey", () => {
  it("prefixes page keys with `page:`", () => {
    expect(serializeRouteKey({ kind: "page", pageId: "notes" })).toBe(
      "page:notes",
    );
  });

  it("prefixes detail keys with `note-detail:`", () => {
    expect(
      serializeRouteKey({ kind: "note-detail", noteId: "abc" }),
    ).toBe("note-detail:abc");
  });

  it("produces distinct serializations across kinds even when ids collide", () => {
    // The `page:` vs `note-detail:` prefix is what disambiguates a `notes`
    // page from a detail route whose noteId happens to be "notes". Without
    // the prefix, both kinds would alias to the same Map entry.
    expect(
      serializeRouteKey({ kind: "page", pageId: "notes" }),
    ).not.toBe(serializeRouteKey({ kind: "note-detail", noteId: "notes" }));
  });
});

const emptyMemory = (): undefined => undefined;

describe("planScrollTransition", () => {
  it("does nothing on the very first render (no previous key)", () => {
    expect(
      planScrollTransition({
        previousKey: null,
        currentKey: { kind: "page", pageId: "notes" },
        memoryRead: emptyMemory,
      }),
    ).toEqual({ capturePrevious: false, restoreScrollY: null });
  });

  it("does nothing on a same-key re-render (autosave, in-place patch)", () => {
    expect(
      planScrollTransition({
        previousKey: { kind: "page", pageId: "notes" },
        currentKey: { kind: "page", pageId: "notes" },
        memoryRead: () => 800,
      }),
    ).toEqual({ capturePrevious: false, restoreScrollY: null });
  });

  it("does nothing on a same-detail re-render (note edited in place)", () => {
    // If autosave fires while a user is reading a detail, we mustn't yank
    // them back to the top. Same-detail-key re-renders must therefore
    // pass-through.
    expect(
      planScrollTransition({
        previousKey: { kind: "note-detail", noteId: "x" },
        currentKey: { kind: "note-detail", noteId: "x" },
        memoryRead: () => 999,
      }),
    ).toEqual({ capturePrevious: false, restoreScrollY: null });
  });

  it("notes list → note detail: captures list scroll, restores detail to top", () => {
    expect(
      planScrollTransition({
        previousKey: { kind: "page", pageId: "notes" },
        currentKey: { kind: "note-detail", noteId: "abc" },
        memoryRead: emptyMemory,
      }),
    ).toEqual({ capturePrevious: true, restoreScrollY: 0 });
  });

  it("ignores stored memory for detail routes — opening a note always lands at the top", () => {
    // memoryRead returns a value here on purpose; the helper must still
    // produce restoreScrollY=0. The "opening a note starts at top" UX
    // is intentional, so we don't honour any (hypothetical) per-note
    // memory.
    expect(
      planScrollTransition({
        previousKey: { kind: "page", pageId: "notes" },
        currentKey: { kind: "note-detail", noteId: "abc" },
        memoryRead: () => 1234,
      }),
    ).toEqual({ capturePrevious: true, restoreScrollY: 0 });
  });

  it("note detail → notes list: restores stored scroll, does NOT capture detail scroll", () => {
    // This is the core round-trip the user reported: scroll the list, open
    // a note, click back, land at the same scroll position. The fix lives
    // in this single line of behaviour.
    expect(
      planScrollTransition({
        previousKey: { kind: "note-detail", noteId: "abc" },
        currentKey: { kind: "page", pageId: "notes" },
        memoryRead: (key) =>
          key.kind === "page" && key.pageId === "notes" ? 742 : undefined,
      }),
    ).toEqual({ capturePrevious: false, restoreScrollY: 742 });
  });

  it("falls back to scrollY=0 when returning to a list page with no stored value", () => {
    // First-ever visit to Tasks: previous render was some other page, no
    // memory entry yet. Restore must default to 0 so we don't pass `null`
    // into window.scrollTo.
    expect(
      planScrollTransition({
        previousKey: { kind: "page", pageId: "notes" },
        currentKey: { kind: "page", pageId: "tasks" },
        memoryRead: emptyMemory,
      }),
    ).toEqual({ capturePrevious: true, restoreScrollY: 0 });
  });

  it("page → page: captures the previous page's scroll AND restores the new page's stored scroll", () => {
    expect(
      planScrollTransition({
        previousKey: { kind: "page", pageId: "notes" },
        currentKey: { kind: "page", pageId: "links" },
        memoryRead: (key) =>
          key.kind === "page" && key.pageId === "links" ? 320 : undefined,
      }),
    ).toEqual({ capturePrevious: true, restoreScrollY: 320 });
  });

  it("detail → different detail: no capture (detail kind never captured), restore stays at 0", () => {
    expect(
      planScrollTransition({
        previousKey: { kind: "note-detail", noteId: "a" },
        currentKey: { kind: "note-detail", noteId: "b" },
        memoryRead: () => 9999,
      }),
    ).toEqual({ capturePrevious: false, restoreScrollY: 0 });
  });

  it("treats restoreScrollY=0 distinctly from null — non-null means 'scroll there', null means 'leave alone'", () => {
    // Defensive: this distinction is what lets autosave-triggered renders
    // keep the page mid-scroll. If the helper ever returned 0 for the
    // same-key case, autosaves would yank scroll to top on every save.
    const sameKey = planScrollTransition({
      previousKey: { kind: "page", pageId: "links" },
      currentKey: { kind: "page", pageId: "links" },
      memoryRead: () => 0,
    });
    expect(sameKey.restoreScrollY).toBeNull();
  });

  it("scroll-memory round-trip: list → detail → list lands the user at the original scroll position", () => {
    // Drives the helper through a realistic three-render cycle the way
    // app.ts will: each render decides on the transition, the caller
    // does the capture / restore against a Map, and the next render reads
    // the Map back. A regression in either capture or restore breaks this
    // assertion.
    const memory = new Map<string, number>();
    const memoryRead = (key: RouteScrollKey): number | undefined =>
      memory.get(serializeRouteKey(key));

    const listKey: RouteScrollKey = { kind: "page", pageId: "notes" };
    const detailKey: RouteScrollKey = { kind: "note-detail", noteId: "abc" };

    // Render 1 — first paint of the notes list. No transition.
    const firstPaint = planScrollTransition({
      previousKey: null,
      currentKey: listKey,
      memoryRead,
    });
    expect(firstPaint).toEqual({ capturePrevious: false, restoreScrollY: null });

    // User scrolls to 612, then clicks a note. Render 2 — list → detail.
    const userScrollAtClick = 612;
    const intoDetail = planScrollTransition({
      previousKey: listKey,
      currentKey: detailKey,
      memoryRead,
    });
    expect(intoDetail.capturePrevious).toBe(true);
    expect(intoDetail.restoreScrollY).toBe(0);
    // Caller side-effect that app.ts will perform:
    if (intoDetail.capturePrevious) {
      memory.set(serializeRouteKey(listKey), userScrollAtClick);
    }

    // User reads, then hits "Back to notes". Render 3 — detail → list.
    const backToList = planScrollTransition({
      previousKey: detailKey,
      currentKey: listKey,
      memoryRead,
    });
    expect(backToList).toEqual({
      capturePrevious: false,
      restoreScrollY: userScrollAtClick,
    });
  });
});
