import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_ITEM,
  HOME_MENU_ITEM,
  MENU_ITEMS,
  getMenuItemLabel,
  isMenuActionItemId,
  isMenuItemId,
  type MenuItemId,
} from "../src/app/logic/menu";

describe("menu items", () => {
  it("exposes the five primary-nav entries in the expected order", () => {
    // Capture + Settings are intentionally *not* rendered in the nav-tabs
    // pill group per handoff v2 — they live in the topbar-actions cluster
    // (capture-chip and settings-gear respectively). They're still valid
    // MenuItemIds and routable via onSelectMenuItem, just not here.
    expect(MENU_ITEMS.map((item) => item.id)).toEqual([
      "add",
      "notes",
      "links",
      "tasks",
      "tags",
    ]);
  });

  it("uses title-cased labels for every menu entry", () => {
    expect(MENU_ITEMS.map((item) => item.label)).toEqual([
      "Add",
      "Notes",
      "Links",
      "Tasks",
      "Tags",
    ]);
  });

  it("has no duplicate ids", () => {
    const ids = MENU_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("defaults to the notes tab so the existing editor is visible on load", () => {
    expect(DEFAULT_MENU_ITEM).toBe<MenuItemId>("notes");
    expect(MENU_ITEMS.some((item) => item.id === DEFAULT_MENU_ITEM)).toBe(true);
  });

  it("keeps the home view out of the primary nav (reached via the clickable SutraPad eyebrow)", () => {
    expect(MENU_ITEMS.some((item) => item.id === HOME_MENU_ITEM.id)).toBe(false);
    expect(HOME_MENU_ITEM).toEqual({ id: "home", label: "Home" });
  });

  it("keeps capture + settings out of the primary nav (they live in topbar-actions)", () => {
    expect(MENU_ITEMS.some((item) => item.id === "capture")).toBe(false);
    expect(MENU_ITEMS.some((item) => item.id === "settings")).toBe(false);
  });

  it("keeps privacy out of the primary nav (footer-link only — long-form static page, not a daily destination)", () => {
    expect(MENU_ITEMS.some((item) => item.id === "privacy")).toBe(false);
  });
});

describe("isMenuItemId", () => {
  it("accepts every known menu id", () => {
    for (const item of MENU_ITEMS) {
      expect(isMenuItemId(item.id)).toBe(true);
    }
  });

  it("accepts the home id even though it is not rendered in the primary nav", () => {
    expect(isMenuItemId(HOME_MENU_ITEM.id)).toBe(true);
    expect(isMenuItemId("home")).toBe(true);
  });

  it("still accepts capture + settings ids (routable via topbar-actions)", () => {
    expect(isMenuItemId("capture")).toBe(true);
    expect(isMenuItemId("settings")).toBe(true);
  });

  it("accepts the privacy id (routable via footer link / Settings card)", () => {
    expect(isMenuItemId("privacy")).toBe(true);
  });

  it("accepts the about / terms / shortcuts ids (routable via footer link)", () => {
    // All three are long-form static pages reached only from the site
    // footer's column links — they need to round-trip through the routing
    // layer so a deep link or persisted last-page path doesn't drop them.
    expect(isMenuItemId("about")).toBe(true);
    expect(isMenuItemId("terms")).toBe(true);
    expect(isMenuItemId("shortcuts")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isMenuItemId("inbox")).toBe(false);
    expect(isMenuItemId("")).toBe(false);
    expect(isMenuItemId(null)).toBe(false);
    expect(isMenuItemId(undefined)).toBe(false);
    expect(isMenuItemId(42)).toBe(false);
  });
});

describe("getMenuItemLabel", () => {
  it("returns the label that matches the menu id", () => {
    expect(getMenuItemLabel("home")).toBe("Home");
    expect(getMenuItemLabel("add")).toBe("Add");
    expect(getMenuItemLabel("notes")).toBe("Notes");
    expect(getMenuItemLabel("links")).toBe("Links");
    expect(getMenuItemLabel("tags")).toBe("Tags");
    expect(getMenuItemLabel("tasks")).toBe("Tasks");
    expect(getMenuItemLabel("capture")).toBe("Capture");
    expect(getMenuItemLabel("settings")).toBe("Settings");
    expect(getMenuItemLabel("privacy")).toBe("Privacy");
    expect(getMenuItemLabel("about")).toBe("About");
    expect(getMenuItemLabel("terms")).toBe("Terms");
    expect(getMenuItemLabel("shortcuts")).toBe("Shortcuts");
  });
});

describe("isMenuActionItemId", () => {
  it("classifies the 'add' menu item as an action (shortcut for New note)", () => {
    expect(isMenuActionItemId("add")).toBe(true);
  });

  it("classifies every page-style menu id as not an action", () => {
    const pageIds: MenuItemId[] = [
      "home",
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
    ];
    for (const id of pageIds) {
      expect(isMenuActionItemId(id)).toBe(false);
    }
  });
});
