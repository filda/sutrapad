// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildDetailTopbar } from "../src/app/view/shared/detail-topbar";
import type { SutraPadDocument } from "../src/types";

function makeNote(
  overrides: Partial<SutraPadDocument> & { id: string },
): SutraPadDocument {
  return {
    title: "Test",
    body: "",
    urls: [],
    tags: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Index of the first child of `parent` carrying `className`, or -1
 * when there's no match. Hoisted out of the test body so the inline
 * `.findIndex` callback doesn't push the nested-callback depth past
 * the lint limit inside a nested describe.
 */
function indexOfChildByClass(parent: HTMLElement, className: string): number {
  return [...parent.children].findIndex((el) =>
    el.classList.contains(className),
  );
}

describe("buildDetailTopbar", () => {
  it("renders a back button, kind chip, and breadcrumb row for a real note", () => {
    const note = makeNote({ id: "n1", title: "Hello", body: "world" });
    const handle = buildDetailTopbar({
      note,
      syncCrumb: "synced 22:00",
      onBackToNotes: () => {},
    });
    expect(handle.element.querySelector(".editor-back-button")).not.toBeNull();
    expect(handle.element.querySelector(".detail-kind-chip")).not.toBeNull();
    expect(handle.element.querySelector(".detail-breadcrumbs")).not.toBeNull();
  });

  it("omits breadcrumbs and domain chip when there is no editable note", () => {
    // The filter-miss state passes `note: null` so the topbar collapses
    // to just the back button. Pinning the omissions catches a refactor
    // that renders an empty `.detail-breadcrumbs` (which would read as
    // "0 words · 1 min read") or a domain chip for nothing.
    const handle = buildDetailTopbar({
      note: null,
      syncCrumb: null,
      onBackToNotes: () => {},
    });
    expect(handle.element.querySelector(".detail-breadcrumbs")).toBeNull();
    expect(handle.element.querySelector(".detail-domain-chip")).toBeNull();
    expect(handle.element.querySelector(".detail-kind-chip")).toBeNull();
  });

  describe(".detail-domain-chip", () => {
    it("renders the note's primary-URL hostname (trimmed of www.)", () => {
      // Mirrors `deriveLinkHostname`'s behaviour — the topbar pill and
      // the grid card thumb share one hostname rendering so a domain
      // never reads as "www.x" in one place and "x" in another.
      const note = makeNote({
        id: "n1",
        urls: ["https://www.developers.google.com/search/docs/appearance/structured-data"],
      });
      const handle = buildDetailTopbar({
        note,
        syncCrumb: null,
        onBackToNotes: () => {},
      });
      const chip = handle.element.querySelector(".detail-domain-chip");
      expect(chip?.textContent).toBe("developers.google.com");
    });

    it("prefers the bookmarklet's canonical URL over note.urls[0]", () => {
      // The canonical URL is what `deriveNotePrimaryUrl` reaches for
      // first — pin this so a refactor doesn't fall through to the
      // tracking-tail variant on `urls[0]` and leave the topbar chip
      // out of sync with the grid card thumb's hostname.
      const note = makeNote({
        id: "n1",
        urls: ["https://example.com/article?utm=tracking"],
        captureContext: {
          source: "url-capture",
          page: { canonicalUrl: "https://www.canonical.example.org/article" },
        },
      });
      const handle = buildDetailTopbar({
        note,
        syncCrumb: null,
        onBackToNotes: () => {},
      });
      expect(
        handle.element.querySelector(".detail-domain-chip")?.textContent,
      ).toBe("canonical.example.org");
    });

    it("is omitted when the note has no URL (hand-typed)", () => {
      // Hand-typed notes have nothing to surface as a source. No chip
      // — not an empty pill that would look like a layout glitch.
      const note = makeNote({ id: "n1" });
      const handle = buildDetailTopbar({
        note,
        syncCrumb: null,
        onBackToNotes: () => {},
      });
      expect(handle.element.querySelector(".detail-domain-chip")).toBeNull();
    });

    it("is omitted when the URL is malformed (hostname parse fails)", () => {
      // `deriveLinkHostname` returns null when `new URL()` throws.
      // Without this fall-through guard, the chip would render with
      // the raw garbage string as its label.
      const note = makeNote({
        id: "n1",
        urls: ["not a real url"],
      });
      const handle = buildDetailTopbar({
        note,
        syncCrumb: null,
        onBackToNotes: () => {},
      });
      expect(handle.element.querySelector(".detail-domain-chip")).toBeNull();
    });

    it("sits between the kind chip and the breadcrumbs in DOM order", () => {
      // Visual contract: the row reads left-to-right as
      // [back-button] [kind-chip] [domain-chip] [breadcrumbs]. CSS
      // flex order follows DOM order here, so DOM order is the
      // assertion that matters. A future refactor that prepends the
      // domain chip (or pushes it past the breadcrumbs) would land
      // it in a position that doesn't pair semantically with the
      // kind chip.
      const note = makeNote({
        id: "n1",
        urls: ["https://example.com/x"],
      });
      const handle = buildDetailTopbar({
        note,
        syncCrumb: null,
        onBackToNotes: () => {},
      });
      const kindIndex = indexOfChildByClass(handle.element, "detail-kind-chip");
      const domainIndex = indexOfChildByClass(handle.element, "detail-domain-chip");
      const breadcrumbsIndex = indexOfChildByClass(handle.element, "detail-breadcrumbs");
      expect(kindIndex).toBeGreaterThanOrEqual(0);
      expect(domainIndex).toBeGreaterThan(kindIndex);
      expect(breadcrumbsIndex).toBeGreaterThan(domainIndex);
    });
  });

  describe(".detail-breadcrumbs content", () => {
    it("renders the full word / read / tasks / links / tags crumb set when each has a non-zero count", () => {
      // Pin the full breadcrumb contents. The link count and tag
      // count were briefly retired during a visual-shorten attempt
      // before we realised the actual concern was just the pill's
      // *width* (handled separately by dropping `flex: 1` on the
      // breadcrumbs container). Content stays as-is: a refactor
      // that drops either crumb again would silently lose stats
      // that are useful at a glance.
      const note = makeNote({
        id: "n1",
        body: "lorem ipsum\n- [ ] do the thing",
        urls: ["https://example.com/x"],
        tags: ["a", "b", "c"],
      });
      const breadcrumbs = buildDetailTopbar({
        note,
        syncCrumb: null,
        onBackToNotes: () => {},
      }).element.querySelector(".detail-breadcrumbs");
      expect(breadcrumbs?.textContent).toMatch(/\bwords?\b/);
      expect(breadcrumbs?.textContent).toMatch(/\bmin read\b/);
      expect(breadcrumbs?.textContent).toMatch(/\btasks?\b/);
      expect(breadcrumbs?.textContent).toMatch(/\blinks?\b/);
      expect(breadcrumbs?.textContent).toMatch(/\btags?\b/);
    });
  });

  it("setKind re-runs detectKind against the live title + body and updates the chip", () => {
    // The handle's `setKind` is what the editor-card calls on every
    // keystroke (`onInputsChange`) to keep the chip in sync without an
    // outer render pass. Pin that the call actually wires through to
    // the chip's `setKind` — a no-op handle (mutation that drops the
    // call inside `setKind`) would leave the chip showing the
    // initial-render kind forever.
    const note = makeNote({ id: "n1", title: "", body: "" });
    const handle = buildDetailTopbar({
      note,
      syncCrumb: null,
      onBackToNotes: () => {},
    });
    const before = handle.element
      .querySelector<HTMLElement>(".detail-kind-chip")
      ?.dataset.kind;
    // A markdown-shape body should flip the kind. `detectKind` is the
    // source of truth; we just need the labels to differ.
    handle.setKind("Notes", "- [ ] do the thing\n- [ ] another");
    const after = handle.element
      .querySelector<HTMLElement>(".detail-kind-chip")
      ?.dataset.kind;
    expect(after).not.toBe(before);
  });
});
