// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { buildAppFab, describeAppFab } from "../src/app/view/chrome/app-fab";
import type { MenuItemId } from "../src/app/logic/menu";

/**
 * The app FAB is a thin DOM builder over a small pure-logic surface. The
 * pure surface (`describeAppFab`) is tested first; the DOM-builder suite
 * renders the actual button under happy-dom and asserts on classes / a11y
 * attributes / click wiring so the className strings, event listeners,
 * and `data-hidden` branch are all pinned by an observable.
 */

describe("describeAppFab", () => {
  it("hides the FAB while the user is on the Add route", () => {
    expect(describeAppFab("add").hidden).toBe(true);
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
      expect(describeAppFab(id).hidden).toBe(false);
    }
  });

  it("announces itself as 'New note' so its purpose is obvious to screen readers", () => {
    expect(describeAppFab("home").ariaLabel).toBe("New note");
    expect(describeAppFab("add").ariaLabel).toBe("New note");
  });
});

describe("buildAppFab", () => {
  it("renders a `<button>` with the `app-fab` className and the `New note` a11y label", () => {
    const button = buildAppFab({
      activeMenuItem: "home",
      onSelectMenuItem: vi.fn(),
    });
    expect(button.tagName).toBe("BUTTON");
    expect(button.classList.contains("app-fab")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("New note");
    expect(button.title).toBe("New note");
  });

  it("stamps `data-hidden=\"true\"` only on the Add route so CSS can fade the FAB out without a re-render", () => {
    const onAdd = buildAppFab({
      activeMenuItem: "add",
      onSelectMenuItem: vi.fn(),
    });
    expect(onAdd.getAttribute("data-hidden")).toBe("true");

    const onHome = buildAppFab({
      activeMenuItem: "home",
      onSelectMenuItem: vi.fn(),
    });
    // Off the Add route, the attribute is omitted entirely (rather than
    // set to "false") — CSS only checks the presence selector.
    expect(onHome.hasAttribute("data-hidden")).toBe(false);
  });

  it("renders a `+` glyph inside `.app-fab-plus` marked aria-hidden so screen readers see only the parent label", () => {
    const button = buildAppFab({
      activeMenuItem: "home",
      onSelectMenuItem: vi.fn(),
    });
    const plus = button.querySelector(".app-fab-plus");
    expect(plus?.textContent).toBe("+");
    expect(plus?.getAttribute("aria-hidden")).toBe("true");
  });

  it("invokes `onSelectMenuItem('add')` exactly once when clicked", () => {
    const onSelectMenuItem = vi.fn();
    const button = buildAppFab({
      activeMenuItem: "home",
      onSelectMenuItem,
    });
    button.click();
    expect(onSelectMenuItem).toHaveBeenCalledTimes(1);
    expect(onSelectMenuItem).toHaveBeenCalledWith("add");
  });
});
