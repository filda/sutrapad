import { describe, expect, it } from "vitest";
import {
  MOBILE_TABBAR_ITEMS,
  describeMobileFab,
  isMobileTabActive,
} from "../src/app/view/chrome/mobile-nav";
import type { MenuItemId } from "../src/app/logic/menu";

/**
 * The mobile tabbar and FAB are thin DOM builders over a small pure-logic
 * surface. We test the surface here (DOM-free per the repo convention):
 * the tabbar item list, the active-match predicate, and the FAB
 * visibility/a11y descriptor.
 */

describe("MOBILE_TABBAR_ITEMS", () => {
  it("exposes exactly four destinations in bottom-bar order", () => {
    expect(MOBILE_TABBAR_ITEMS.map((i) => i.id)).toEqual([
      "home",
      "notes",
      "tasks",
      "tags",
    ]);
  });

  it("relabels home as Today to match the page's own title", () => {
    const home = MOBILE_TABBAR_ITEMS.find((i) => i.id === "home");
    expect(home?.label).toBe("Today");
  });

  it("keeps each label short (<= 6 chars) so four fit on a narrow viewport", () => {
    for (const item of MOBILE_TABBAR_ITEMS) {
      expect(item.label.length).toBeLessThanOrEqual(6);
    }
  });

  it("never duplicates an id — route → tab is 1:1", () => {
    const ids = MOBILE_TABBAR_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("omits Add — the FAB owns that route on mobile", () => {
    expect(MOBILE_TABBAR_ITEMS.find((i) => i.id === "add")).toBeUndefined();
  });
});

describe("isMobileTabActive", () => {
  it("matches when the active menu id equals the tab's id", () => {
    const notes = MOBILE_TABBAR_ITEMS.find((i) => i.id === "notes");
    if (!notes) throw new Error("notes tab missing from MOBILE_TABBAR_ITEMS");
    expect(isMobileTabActive(notes, "notes")).toBe(true);
  });

  it("does not match for siblings", () => {
    const tags = MOBILE_TABBAR_ITEMS.find((i) => i.id === "tags");
    if (!tags) throw new Error("tags tab missing from MOBILE_TABBAR_ITEMS");
    expect(isMobileTabActive(tags, "notes")).toBe(false);
    expect(isMobileTabActive(tags, "home")).toBe(false);
  });

  it("returns false for every tab when active is off-bar (capture, settings)", () => {
    for (const item of MOBILE_TABBAR_ITEMS) {
      expect(isMobileTabActive(item, "capture")).toBe(false);
      expect(isMobileTabActive(item, "settings")).toBe(false);
    }
  });
});

describe("describeMobileFab", () => {
  it("hides the FAB while the user is on the Add route", () => {
    expect(describeMobileFab("add").hidden).toBe(true);
  });

  it("shows the FAB on every non-Add route", () => {
    const routes: MenuItemId[] = [
      "home",
      "notes",
      "tasks",
      "tags",
      "links",
      "capture",
      "settings",
    ];
    for (const id of routes) {
      expect(describeMobileFab(id).hidden).toBe(false);
    }
  });

  it("announces itself as 'New note' so its purpose is obvious to screen readers", () => {
    expect(describeMobileFab("home").ariaLabel).toBe("New note");
    expect(describeMobileFab("add").ariaLabel).toBe("New note");
  });
});
