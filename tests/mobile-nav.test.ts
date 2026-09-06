// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  MOBILE_TABBAR_ITEM_IDS,
  buildMobileTabbar,
  getMobileTabLabel,
  isMobileTabActive,
} from "../src/app/view/chrome/mobile-nav";
import type { MenuItemId } from "../src/app/logic/menu";

/**
 * The mobile tabbar is a thin DOM builder over a small pure-logic surface.
 * The pure surface is tested first (the tabbar item list and the active-
 * match predicate); the DOM-builder suite at the bottom renders the actual
 * buttons under happy-dom and asserts on classes / a11y attributes / click
 * wiring so the className strings, event listeners, and is-active branch
 * are all pinned by an observable. The app FAB has its own test file
 * (`app-fab.test.ts`) since it ships on every viewport, not just mobile.
 */

describe("MOBILE_TABBAR_ITEM_IDS", () => {
  it("exposes exactly five destinations in bottom-bar order", () => {
    expect(MOBILE_TABBAR_ITEM_IDS).toEqual(["home", "notes", "links", "tasks", "tags"]);
  });

  it("relabels home as Today to match the page's own title", () => {
    expect(getMobileTabLabel("home")).toBe("Today");
  });

  it("uses the canonical page titles for the other four tabs", () => {
    // The labels are user-facing — pinning them protects against silent
    // string drift (renamings, typos) that the id-only assertion above
    // wouldn't catch.
    expect(getMobileTabLabel("notes")).toBe("Notes");
    expect(getMobileTabLabel("links")).toBe("Links");
    expect(getMobileTabLabel("tasks")).toBe("Tasks");
    expect(getMobileTabLabel("tags")).toBe("Tags");
  });

  it("keeps every English label short (<= 6 chars) so five fit on a narrow viewport", () => {
    // English only. Czech "Poznámky" is eight characters and the bar has to
    // cope — that is a CSS problem, not a reason to pick a worse word.
    for (const id of MOBILE_TABBAR_ITEM_IDS) {
      expect(getMobileTabLabel(id).length).toBeLessThanOrEqual(6);
    }
  });

  it("never duplicates an id — route → tab is 1:1", () => {
    expect(new Set(MOBILE_TABBAR_ITEM_IDS).size).toBe(MOBILE_TABBAR_ITEM_IDS.length);
  });

  it("omits Add — the FAB owns that route on mobile", () => {
    expect(MOBILE_TABBAR_ITEM_IDS).not.toContain<MenuItemId>("add");
  });

  it("stays within Apple HIG / Material's 5-tab bottom-nav max", () => {
    // The handoff originally specced four tabs; we ship five (with Links
    // as the new addition). Pin the upper bound so a sixth tab is a
    // deliberate decision rather than a quiet drift past the limit
    // beyond which bottom navigation ceases to work as a primary
    // destination affordance.
    expect(MOBILE_TABBAR_ITEM_IDS.length).toBeLessThanOrEqual(5);
  });
});

describe("isMobileTabActive", () => {
  it("matches when the active menu id equals the tab's id", () => {
    expect(isMobileTabActive("notes", "notes")).toBe(true);
  });

  it("does not match for siblings", () => {
    expect(isMobileTabActive("tags", "notes")).toBe(false);
    expect(isMobileTabActive("tags", "home")).toBe(false);
  });

  it("returns false for every tab when active is off-bar (capture, settings)", () => {
    for (const id of MOBILE_TABBAR_ITEM_IDS) {
      expect(isMobileTabActive(id, "capture")).toBe(false);
      expect(isMobileTabActive(id, "settings")).toBe(false);
    }
  });
});

describe("buildMobileTabbar", () => {
  it("renders one `<button>` per tabbar entry, in order, with the canonical label as text", () => {
    const nav = buildMobileTabbar({
      activeMenuItem: "notes",
      onSelectMenuItem: vi.fn(),
    });
    const buttons = Array.from(nav.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Today",
      "Notes",
      "Links",
      "Tasks",
      "Tags",
    ]);
  });

  it("stamps `mobile-tabbar` on the nav root and gives it a screen-reader label", () => {
    const nav = buildMobileTabbar({
      activeMenuItem: "notes",
      onSelectMenuItem: vi.fn(),
    });
    expect(nav.tagName).toBe("NAV");
    expect(nav.classList.contains("mobile-tabbar")).toBe(true);
    expect(nav.getAttribute("aria-label")).toBe("Mobile primary navigation");
  });

  it("flips `is-active` and `aria-current` only on the matching tab", () => {
    const nav = buildMobileTabbar({
      activeMenuItem: "tasks",
      onSelectMenuItem: vi.fn(),
    });
    const buttons = Array.from(nav.querySelectorAll("button"));
    const taskBtn = buttons.find((b) => b.textContent === "Tasks");
    const notesBtn = buttons.find((b) => b.textContent === "Notes");
    expect(taskBtn?.classList.contains("is-active")).toBe(true);
    expect(taskBtn?.getAttribute("aria-current")).toBe("page");
    // Sibling tabs must remain non-active and `aria-current="false"` (not
    // missing — the literal "false" matters for ATs that diff against the
    // page-state value).
    expect(notesBtn?.classList.contains("is-active")).toBe(false);
    expect(notesBtn?.getAttribute("aria-current")).toBe("false");
  });

  it("uses the bare `mobile-tab` className when no tab matches the active route (off-bar pages)", () => {
    const nav = buildMobileTabbar({
      activeMenuItem: "settings",
      onSelectMenuItem: vi.fn(),
    });
    for (const button of nav.querySelectorAll("button")) {
      expect(button.classList.contains("is-active")).toBe(false);
      expect(button.classList.contains("mobile-tab")).toBe(true);
      expect(button.getAttribute("aria-current")).toBe("false");
    }
  });

  it("invokes `onSelectMenuItem` with the tab's id on click — once per button", () => {
    const onSelectMenuItem = vi.fn();
    const nav = buildMobileTabbar({
      activeMenuItem: "home",
      onSelectMenuItem,
    });
    const buttons = Array.from(nav.querySelectorAll("button"));
    // Pin the id-per-button mapping so a future reorder doesn't ship a
    // tab that fires the wrong route. Without the per-button assertion,
    // the `() => onSelectMenuItem(item.id)` mutant `() => undefined`
    // survives.
    const expected: Array<MenuItemId> = [
      "home",
      "notes",
      "links",
      "tasks",
      "tags",
    ];
    for (const [index, button] of buttons.entries()) {
      button.click();
      expect(onSelectMenuItem).toHaveBeenNthCalledWith(index + 1, expected[index]);
    }
    expect(onSelectMenuItem).toHaveBeenCalledTimes(buttons.length);
  });
});

