import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_ITEM,
  HOME_MENU_ITEM_ID,
  NAV_MENU_ITEM_IDS,
  getMenuItemLabel,
  isMenuActionItemId,
  isMenuItemId,
  type MenuItemId,
} from "../src/app/logic/menu";
import { CS } from "../src/lib/i18n";

describe("menu items", () => {
  it("exposes the five primary-nav entries in the expected order", () => {
    // Capture + Settings are intentionally *not* rendered in the nav-tabs
    // pill group per handoff v2. Settings lives in the topbar-actions
    // cluster as a gear icon; Capture is reached from the site footer
    // (`Use → Capture setup`) and the command palette. Both are still
    // valid MenuItemIds and routable via onSelectMenuItem, just not here.
    expect(NAV_MENU_ITEM_IDS).toEqual(["add", "notes", "links", "tasks", "tags"]);
  });

  it("uses title-cased English labels for every nav entry", () => {
    // The ids above are routing keys; these are the copy. Asserted as
    // literals so a drifted or emptied catalog entry fails here rather than
    // shipping a blank tab.
    expect(NAV_MENU_ITEM_IDS.map((id) => getMenuItemLabel(id))).toEqual([
      "Add",
      "Notes",
      "Links",
      "Tasks",
      "Tags",
    ]);
  });

  it("has no duplicate ids", () => {
    expect(new Set(NAV_MENU_ITEM_IDS).size).toBe(NAV_MENU_ITEM_IDS.length);
  });

  it("defaults to the notes tab so the existing editor is visible on load", () => {
    expect(DEFAULT_MENU_ITEM).toBe<MenuItemId>("notes");
    expect(NAV_MENU_ITEM_IDS).toContain(DEFAULT_MENU_ITEM);
  });

  it("keeps the home view out of the primary nav (reached via the clickable SutraPad eyebrow)", () => {
    expect(NAV_MENU_ITEM_IDS).not.toContain(HOME_MENU_ITEM_ID);
    expect(HOME_MENU_ITEM_ID).toBe<MenuItemId>("home");
  });

  it("keeps capture + settings out of the primary nav (settings is the topbar gear; capture lives in the footer / palette)", () => {
    expect(NAV_MENU_ITEM_IDS).not.toContain<MenuItemId>("capture");
    expect(NAV_MENU_ITEM_IDS).not.toContain<MenuItemId>("settings");
  });

  it("keeps privacy out of the primary nav (footer-link only — long-form static page, not a daily destination)", () => {
    expect(NAV_MENU_ITEM_IDS).not.toContain<MenuItemId>("privacy");
  });
});

describe("isMenuItemId", () => {
  it("accepts every known menu id", () => {
    for (const id of NAV_MENU_ITEM_IDS) {
      expect(isMenuItemId(id)).toBe(true);
    }
  });

  it("accepts the home id even though it is not rendered in the primary nav", () => {
    expect(isMenuItemId(HOME_MENU_ITEM_ID)).toBe(true);
    expect(isMenuItemId("home")).toBe(true);
  });

  it("still accepts capture + settings ids (settings via topbar-actions gear; capture via footer / palette)", () => {
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
    expect(getMenuItemLabel("lexicon")).toBe("Lexicon Builder");
  });

  it("follows the catalog it is given", () => {
    // The id is a routing key and never changes; only the label does. This
    // is the assertion that would fail if a future edit reached past the
    // catalog and hard-coded English back into the lookup.
    expect(getMenuItemLabel("notes", CS)).toBe("Poznámky");
    expect(getMenuItemLabel("settings", CS)).toBe("Nastavení");
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
