import { describe, expect, it } from "vitest";
import {
  DEFAULT_MENU_ITEM,
  HOME_MENU_ITEM,
  MENU_ITEMS,
  getMenuItemLabel,
  isMenuItemId,
  type MenuItemId,
} from "../src/app/logic/menu";

describe("menu items", () => {
  it("exposes the six menu entries in the expected order", () => {
    expect(MENU_ITEMS.map((item) => item.id)).toEqual([
      "add",
      "notes",
      "links",
      "tags",
      "tasks",
      "settings",
    ]);
  });

  it("uses title-cased labels for every menu entry", () => {
    expect(MENU_ITEMS.map((item) => item.label)).toEqual([
      "Add",
      "Notes",
      "Links",
      "Tags",
      "Tasks",
      "Settings",
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
    expect(getMenuItemLabel("settings")).toBe("Settings");
  });
});
