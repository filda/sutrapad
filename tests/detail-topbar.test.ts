// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
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
      expect(breadcrumbs?.textContent).toMatch(/\bwords?\b/u);
      expect(breadcrumbs?.textContent).toMatch(/\bmin read\b/u);
      expect(breadcrumbs?.textContent).toMatch(/\btasks?\b/u);
      expect(breadcrumbs?.textContent).toMatch(/\blinks?\b/u);
      expect(breadcrumbs?.textContent).toMatch(/\btags?\b/u);
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

/** Text of every crumb in the breadcrumb row, separators excluded. */
function crumbTexts(element: HTMLElement): string[] {
  return [...element.querySelectorAll(".crumb")].map((el) => el.textContent ?? "");
}

function topbarFor(overrides: Partial<SutraPadDocument> & { id: string }) {
  return buildDetailTopbar({
    note: makeNote(overrides),
    syncCrumb: null,
  }).element;
}

describe("buildDetailTopbar back button", () => {
  it("carries the canonical label and reports the click", () => {
    const onBackToNotes = vi.fn();
    const handle = buildDetailTopbar({
      note: null,
      syncCrumb: null,
      onBackToNotes,
    });
    const button = handle.element.querySelector<HTMLButtonElement>(
      ".editor-back-button",
    );
    expect(button?.textContent).toBe("← Back to notes");
    expect(button?.type).toBe("button");
    button?.click();
    expect(onBackToNotes).toHaveBeenCalledTimes(1);
  });

  it("is omitted when no handler was passed", () => {
    const handle = buildDetailTopbar({ note: null, syncCrumb: null });
    expect(handle.element.querySelector(".editor-back-button")).toBeNull();
  });
});

describe("buildDetailTopbar breadcrumb copy", () => {
  it("always shows word count and read time, singular at one word", () => {
    expect(crumbTexts(topbarFor({ id: "n", body: "hello" }))).toEqual([
      "1 word",
      "1 min read",
    ]);
  });

  it("pluralizes the word count and floors read time at one minute", () => {
    expect(crumbTexts(topbarFor({ id: "n", body: "hello there friend" }))).toEqual([
      "3 words",
      "1 min read",
    ]);
  });

  it("reads `0 words` on an empty note rather than skipping the crumb", () => {
    expect(crumbTexts(topbarFor({ id: "n", body: "   " }))).toEqual([
      "0 words",
      "1 min read",
    ]);
  });

  it("sums open and done tasks into the `open/total` form", () => {
    // The total is open + done, so a note with one open and two done reads
    // "1/3", not "1/1" or "1/2".
    const crumbs = crumbTexts(
      topbarFor({ id: "n", body: "- [ ] a\n- [x] b\n- [x] c" }),
    );
    expect(crumbs).toContain("1/3 tasks open");
  });

  it("switches to the all-done form, pluralized", () => {
    expect(crumbTexts(topbarFor({ id: "n", body: "- [x] a\n- [x] b" }))).toContain(
      "2 tasks done",
    );
  });

  it("uses the singular all-done form for a single finished task", () => {
    expect(crumbTexts(topbarFor({ id: "n", body: "- [x] a" }))).toContain(
      "1 task done",
    );
  });

  it("omits the task crumb entirely for a note with no checkboxes", () => {
    const crumbs = crumbTexts(topbarFor({ id: "n", body: "just prose" }));
    expect(crumbs.some((text) => text.includes("task"))).toBe(false);
  });

  it("counts links in the singular and plural, and omits the crumb at zero", () => {
    expect(
      crumbTexts(topbarFor({ id: "n", body: "x", urls: ["https://a.example"] })),
    ).toContain("1 link");
    expect(
      crumbTexts(
        topbarFor({
          id: "n",
          body: "x",
          urls: ["https://a.example", "https://b.example"],
        }),
      ),
    ).toContain("2 links");
    const none = crumbTexts(topbarFor({ id: "n", body: "x" }));
    expect(none.some((text) => text.includes("link"))).toBe(false);
  });

  it("counts tags in the singular and plural, and omits the crumb at zero", () => {
    expect(crumbTexts(topbarFor({ id: "n", body: "x", tags: ["work"] }))).toContain(
      "1 tag",
    );
    expect(
      crumbTexts(topbarFor({ id: "n", body: "x", tags: ["work", "urgent"] })),
    ).toContain("2 tags");
    const none = crumbTexts(topbarFor({ id: "n", body: "x" }));
    expect(none.some((text) => text.includes("tag"))).toBe(false);
  });

  it("puts the sync crumb last, and drops it when there is nothing to say", () => {
    const withSync = buildDetailTopbar({
      note: makeNote({ id: "n", body: "hello" }),
      syncCrumb: "synced 22:00",
    }).element;
    const sync = withSync.querySelector(".crumb-sync");
    expect(sync?.className).toBe("crumb crumb-sync");
    expect(sync?.textContent).toBe("synced 22:00");
    expect(crumbTexts(withSync).at(-1)).toBe("synced 22:00");

    const withoutSync = buildDetailTopbar({
      note: makeNote({ id: "n", body: "hello" }),
      syncCrumb: null,
    }).element;
    expect(withoutSync.querySelector(".crumb-sync")).toBeNull();
  });

  it("separates every crumb with one aria-hidden `·`", () => {
    // Screen readers hear the three facts as separate chunks; the dot is
    // decoration between them.
    const element = buildDetailTopbar({
      note: makeNote({ id: "n", body: "hello", tags: ["work"] }),
      syncCrumb: "synced 22:00",
    }).element;
    const seps = [...element.querySelectorAll(".crumb-sep")];
    // 4 crumbs (words, read, tag, sync) → 3 separators.
    expect(seps).toHaveLength(3);
    expect(seps.every((sep) => sep.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(seps.every((sep) => sep.textContent === "·")).toBe(true);
  });
});

// --- Gap-closing block, 2026-08-29 ------------------------------------------

describe("buildDetailTopbar breadcrumb separators", () => {
  it("puts a separator between every pair of crumbs and nowhere else", () => {
    // The row is built by alternating `appendCrumbSeparator` / `appendCrumb`,
    // one conditional pair per optional stat. Assert the whole alternating
    // sequence rather than the crumb texts: a missing separator leaves two
    // crumbs jammed together ("12 words1 min read"), and a stray one leaves a
    // dangling middle dot — neither shows up in a test that only reads the
    // crumb labels.
    const note = makeNote({
      id: "n1",
      title: "Hello",
      body: "- [ ] one\n- [x] two\n\nhttps://example.com\n\n#praha",
      tags: ["praha"],
      urls: ["https://example.com"],
    });

    const handle = buildDetailTopbar({
      note,
      syncCrumb: "synced 22:00",
      onBackToNotes: () => {},
    });
    const crumbs = handle.element.querySelector(".detail-breadcrumbs");
    if (crumbs === null) throw new Error("expected .detail-breadcrumbs");

    // `sep` / `crumb` rather than the raw className, because the trailing
    // sync crumb carries an extra `crumb-sync` hook.
    const shape = [...crumbs.children].map((el) =>
      el.classList.contains("crumb-sep") ? "sep" : "crumb",
    );

    // Words, read time, tasks, links, tags and the sync crumb — six crumbs
    // with a separator between each adjacent pair, and none at either end.
    expect(shape).toEqual([
      "crumb",
      "sep",
      "crumb",
      "sep",
      "crumb",
      "sep",
      "crumb",
      "sep",
      "crumb",
      "sep",
      "crumb",
    ]);
  });

  it("drops the separator along with the crumb it precedes", () => {
    // A note with no tasks, links or tags renders only the two unconditional
    // crumbs plus the sync crumb. Each optional separator has to disappear
    // with its own crumb, or the row trails a dot into empty space.
    const note = makeNote({ id: "n1", title: "Hello", body: "just words" });

    const handle = buildDetailTopbar({
      note,
      syncCrumb: "synced 22:00",
      onBackToNotes: () => {},
    });
    const crumbs = handle.element.querySelector(".detail-breadcrumbs");

    expect(
      [...(crumbs?.children ?? [])].map((el) =>
        el.classList.contains("crumb-sep") ? "sep" : "crumb",
      ),
    ).toEqual(["crumb", "sep", "crumb", "sep", "crumb"]);
  });
});
