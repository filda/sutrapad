// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  MOBILE_TABBAR_ITEMS,
  buildMobileFab,
  buildMobileTabbar,
  describeMobileFab,
  isMobileTabActive,
} from "../src/app/view/chrome/mobile-nav";
import type { MenuItemId } from "../src/app/logic/menu";

/**
 * The mobile tabbar and FAB are thin DOM builders over a small pure-logic
 * surface. The pure surface is tested first (the tabbar item list, the
 * active-match predicate, and the FAB visibility/a11y descriptor); the
 * DOM-builder suites at the bottom render the actual buttons under
 * happy-dom and assert on classes / a11y attributes / click wiring so
 * the className strings, event listeners, and is-active branch are all
 * pinned by an observable.
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

  it("uses the canonical page titles for the other three tabs", () => {
    // The labels are user-facing — pinning them protects against silent
    // string drift (renamings, typos) that the id-only assertion above
    // wouldn't catch.
    const labels = Object.fromEntries(
      MOBILE_TABBAR_ITEMS.map((i) => [i.id, i.label]),
    );
    expect(labels.notes).toBe("Notes");
    expect(labels.tasks).toBe("Tasks");
    expect(labels.tags).toBe("Tags");
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
    const expected: Array<MenuItemId> = ["home", "notes", "tasks", "tags"];
    for (const [index, button] of buttons.entries()) {
      button.click();
      expect(onSelectMenuItem).toHaveBeenNthCalledWith(index + 1, expected[index]);
    }
    expect(onSelectMenuItem).toHaveBeenCalledTimes(buttons.length);
  });
});

describe("buildMobileFab", () => {
  it("renders a `<button>` with the `mobile-fab` className and the `New note` a11y label", () => {
    const button = buildMobileFab({
      activeMenuItem: "home",
      onSelectMenuItem: vi.fn(),
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button.classList.contains("mobile-fab")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("New note");
    expect(button.title).toBe("New note");
  });

  it("stamps `data-hidden=\"true\"` only on the Add route so CSS can fade the FAB out without a re-render", () => {
    const onAdd = buildMobileFab({
      activeMenuItem: "add",
      onSelectMenuItem: vi.fn(),
    });
    expect(onAdd.getAttribute("data-hidden")).toBe("true");

    const onHome = buildMobileFab({
      activeMenuItem: "home",
      onSelectMenuItem: vi.fn(),
    });
    // Off the Add route, the attribute is omitted entirely (rather than
    // set to "false") — CSS only checks the presence selector.
    expect(onHome.hasAttribute("data-hidden")).toBe(false);
  });

  it("renders a `+` glyph inside `.mobile-fab-plus` marked aria-hidden so screen readers see only the parent label", () => {
    const button = buildMobileFab({
      activeMenuItem: "home",
      onSelectMenuItem: vi.fn(),
    });
    const plus = button.querySelector(".mobile-fab-plus");
    expect(plus?.textContent).toBe("+");
    expect(plus?.getAttribute("aria-hidden")).toBe("true");
  });

  it("invokes `onSelectMenuItem('add')` exactly once when clicked", () => {
    const onSelectMenuItem = vi.fn();
    const button = buildMobileFab({
      activeMenuItem: "home",
      onSelectMenuItem,
    });
    button.click();
    expect(onSelectMenuItem).toHaveBeenCalledTimes(1);
    expect(onSelectMenuItem).toHaveBeenCalledWith("add");
  });
});
