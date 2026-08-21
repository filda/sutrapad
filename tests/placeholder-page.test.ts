// @vitest-environment happy-dom
//
// First focused test for `src/app/view/pages/placeholder-page.ts` — twelve
// lines, and the smallest promotion left in the batch. It is worth measuring
// anyway for one reason: the per-id class (`page-placeholder-<id>`) is the
// hook the CSS uses to style a stub, and the heading comes from
// `getMenuItemLabel`, not from the raw id. A mutant that drops the lookup
// leaves a page titled "shortcuts" instead of "Shortcuts", which looks like a
// routing bug rather than a copy one.
//
// Every `MenuItemId` is exercised, because the two halves of the output
// disagree for exactly the ids whose label is not their id.

import { describe, expect, it } from "vitest";
import { buildPagePlaceholder } from "../src/app/view/pages/placeholder-page";
import type { MenuItemId } from "../src/app/logic/menu";

const ALL_IDS: readonly MenuItemId[] = [
  "home",
  "add",
  "notes",
  "links",
  "tags",
  "tasks",
  "capture",
  "settings",
  "privacy",
  "about",
  "terms",
  "shortcuts",
  "lexicon",
];

describe("buildPagePlaceholder", () => {
  it("renders a section carrying both the generic and the per-id class", () => {
    const page = buildPagePlaceholder("lexicon");

    expect(page.tagName.toLowerCase()).toBe("section");
    // Both halves matter: the generic class carries the layout, the suffixed
    // one is the per-page hook.
    expect(page.className).toBe("page-placeholder page-placeholder-lexicon");
  });

  it("titles the stub with the menu label, not the raw id", () => {
    const page = buildPagePlaceholder("lexicon");
    const heading = page.querySelector("h2");

    // `lexicon` → "Lexicon Builder": the two differ, so a mutant that
    // substitutes the id shows up here.
    expect(heading?.textContent).toBe("Lexicon Builder");
    expect(heading?.hasAttribute("class")).toBe(false);
  });

  it("holds the heading as its only child", () => {
    const page = buildPagePlaceholder("about");

    expect([...page.children].map((child) => child.tagName.toLowerCase())).toEqual(["h2"]);
  });

  it("labels every menu id", () => {
    const rendered = ALL_IDS.map((id) => {
      const page = buildPagePlaceholder(id);
      return `${page.className} → ${page.querySelector("h2")?.textContent}`;
    });

    expect(rendered).toEqual([
      "page-placeholder page-placeholder-home → Home",
      "page-placeholder page-placeholder-add → Add",
      "page-placeholder page-placeholder-notes → Notes",
      "page-placeholder page-placeholder-links → Links",
      "page-placeholder page-placeholder-tags → Tags",
      "page-placeholder page-placeholder-tasks → Tasks",
      "page-placeholder page-placeholder-capture → Capture",
      "page-placeholder page-placeholder-settings → Settings",
      "page-placeholder page-placeholder-privacy → Privacy",
      "page-placeholder page-placeholder-about → About",
      "page-placeholder page-placeholder-terms → Terms",
      "page-placeholder page-placeholder-shortcuts → Shortcuts",
      "page-placeholder page-placeholder-lexicon → Lexicon Builder",
    ]);
  });

  it("builds a fresh element on every call", () => {
    // The router mounts and discards these; a cached singleton would leak
    // the previous page's id into the class list.
    expect(buildPagePlaceholder("notes")).not.toBe(buildPagePlaceholder("notes"));
  });
});
