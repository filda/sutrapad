// @vitest-environment happy-dom
//
// Unit tests for the shared `card-header` helpers introduced in Step 3
// of cards-unification (Notes / Links / Tasks all funnel title + date
// rendering through one place). The integration tests in
// `entity-card-classes.test.ts` exercise the helpers through the
// page renderers; this file covers the helper's own contract:
//
//   - per-kind class hooks are stamped correctly
//   - whitespace-only titles fall back to the configured default
//   - the empty-title fallback can be overridden (Links uses this to
//     surface the bare URL when a link has no source note)
//   - dates render as `<time dateTime>` with the formatDate label

import { describe, expect, it } from "vitest";
import {
  buildCardDate,
  buildCardTitle,
} from "../src/app/view/shared/card-header";

describe("buildCardTitle", () => {
  it("renders an <h3 class=\"note-list-title\"> for kind 'note'", () => {
    const el = buildCardTitle("Hello", "note");
    expect(el.tagName).toBe("H3");
    expect(el.className).toBe("note-list-title");
    expect(el.textContent).toBe("Hello");
  });

  it("renders an <h3 class=\"link-card-title\"> for kind 'link'", () => {
    const el = buildCardTitle("Hello", "link");
    expect(el.tagName).toBe("H3");
    expect(el.className).toBe("link-card-title");
  });

  it("renders an <h3 class=\"task-card-title\"> for kind 'task'", () => {
    const el = buildCardTitle("Hello", "task");
    expect(el.tagName).toBe("H3");
    expect(el.className).toBe("task-card-title");
  });

  it("falls back to 'Untitled note' when the raw title is empty", () => {
    const el = buildCardTitle("", "note");
    expect(el.textContent).toBe("Untitled note");
  });

  it("falls back to 'Untitled note' when the raw title is whitespace only", () => {
    // Pre-helper Notes used a bare `||` check, which let "   " slip
    // through as the rendered label. The helper trims first so this
    // case lands on the default.
    const el = buildCardTitle("   ", "note");
    expect(el.textContent).toBe("Untitled note");
  });

  it("trims surrounding whitespace off non-empty titles", () => {
    const el = buildCardTitle("  Hello world  ", "note");
    expect(el.textContent).toBe("Hello world");
  });

  it("uses a caller-provided fallback when the raw title is empty", () => {
    // Links surfaces the bare URL via `opts.fallback` when a link has
    // no source note at all (an edge case the default fallback
    // can't express).
    const el = buildCardTitle("", "link", { fallback: "https://example.com" });
    expect(el.textContent).toBe("https://example.com");
  });

  it("prefers the trimmed title over the caller-provided fallback when non-empty", () => {
    const el = buildCardTitle("Hello", "link", {
      fallback: "https://example.com",
    });
    expect(el.textContent).toBe("Hello");
  });
});

describe("buildCardDate", () => {
  it("renders a <time class=\"note-list-date\" dateTime=…> for kind 'note'", () => {
    const iso = "2026-04-22T12:34:00.000Z";
    const el = buildCardDate(iso, "note");
    expect(el.tagName).toBe("TIME");
    expect(el.className).toBe("note-list-date");
    expect(el.dateTime).toBe(iso);
  });

  it("renders a <time class=\"link-card-saved\" dateTime=…> for kind 'link'", () => {
    const iso = "2026-04-22T12:34:00.000Z";
    const el = buildCardDate(iso, "link");
    expect(el.className).toBe("link-card-saved");
    expect(el.dateTime).toBe(iso);
  });

  it("uses formatDate for the visible textContent", () => {
    // Sanity check that we go through `formatDate` and not the raw
    // ISO string. The exact format is owned by `formatDate`; we just
    // assert the rendered text differs from the raw ISO (since
    // `formatDate("2026-04-22T…")` produces a human-friendly date,
    // not the literal timestamp).
    const iso = "2026-04-22T12:34:00.000Z";
    const el = buildCardDate(iso, "note");
    expect(el.textContent).not.toBe("");
    expect(el.textContent).not.toBe(iso);
  });
});
