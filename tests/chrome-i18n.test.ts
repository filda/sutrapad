// @vitest-environment happy-dom
//
// The app chrome rendered in Czech — step 2 of `docs/i18n-plan.md`, same
// two-part contract as `tests/settings-page-i18n.test.ts`: the copy
// localizes, the routing keys do not. The keys matter more here than
// anywhere else, because a `MenuItemId` is what ends up in the URL path and
// in the persisted last-page — translating one breaks every deep link, and
// it breaks it silently.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMobileTabbar,
  getMobileTabLabel,
  MOBILE_TABBAR_ITEM_IDS,
} from "../src/app/view/chrome/mobile-nav";
import { buildSiteFooter } from "../src/app/view/chrome/site-footer";
import { syncPillLabel } from "../src/app/view/chrome/topbar";
import { getMenuItemLabel, NAV_MENU_ITEM_IDS } from "../src/app/logic/menu";
import {
  buildEmptyScene,
  EMPTY_STATE_KINDS,
  emptyCopy,
} from "../src/app/view/shared/empty-state";
import { DEFAULT_LOCALE, setActiveLocale } from "../src/lib/i18n";

beforeEach(() => setActiveLocale("cs"));
afterEach(() => setActiveLocale(DEFAULT_LOCALE));

describe("navigation in Czech", () => {
  it("translates the primary nav labels", () => {
    expect(NAV_MENU_ITEM_IDS.map((id) => getMenuItemLabel(id))).toEqual([
      "Přidat",
      "Poznámky",
      "Odkazy",
      "Úkoly",
      "Štítky",
    ]);
  });

  it("keeps Today's mobile-only relabel in Czech too", () => {
    expect(getMobileTabLabel("home")).toBe("Dnes");
    expect(getMenuItemLabel("home")).toBe("Domů");
  });

  it("renders Czech tab labels but reports untranslated route ids", () => {
    const onSelectMenuItem = vi.fn();
    const nav = buildMobileTabbar({ activeMenuItem: "notes", onSelectMenuItem });

    const tabs = [...nav.querySelectorAll<HTMLElement>(".mobile-tab")];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Dnes",
      "Poznámky",
      "Odkazy",
      "Úkoly",
      "Štítky",
    ]);

    // Click every tab: whatever the button says, the id handed to the router
    // is the English key.
    for (const tab of tabs) tab.click();
    expect(onSelectMenuItem.mock.calls.flat()).toEqual([
      ...MOBILE_TABBAR_ITEM_IDS,
    ]);
  });

  it("translates the bar's own aria-label", () => {
    const nav = buildMobileTabbar({
      activeMenuItem: "notes",
      onSelectMenuItem: vi.fn(),
    });
    expect(nav.getAttribute("aria-label")).toBe("Hlavní navigace (mobil)");
  });
});

describe("sync pill in Czech", () => {
  it("translates every state", () => {
    expect(syncPillLabel("loading")).toBe("Načítám");
    expect(syncPillLabel("saving")).toBe("Ukládám");
    expect(syncPillLabel("error")).toBe("Chyba");
    expect(syncPillLabel("idle")).toBe("Synchronizováno");
  });
});

describe("site footer in Czech", () => {
  it("translates the column heads but keeps the wordmark", () => {
    const footer = buildSiteFooter({
      buildStamp: "v0 • abc • now",
      onSelectMenuItem: vi.fn(),
    });

    expect(
      [...footer.querySelectorAll(".site-footer-col-head")].map((el) => el.textContent),
    ).toEqual(["SutraPad", "Použití", "Zdroje", "Právní"]);
    expect(footer.querySelector(".site-footer-wordmark")?.textContent).toBe(
      "SutraPad",
    );
  });

  it("reuses the nav labels for the pages it links to", () => {
    // The footer used to carry its own copy of "About" / "Shortcuts" /
    // "Privacy" / "Terms". Now it reads them from the same place the nav
    // does, so the two cannot drift apart in either language.
    const footer = buildSiteFooter({
      buildStamp: "v0 • abc • now",
      onSelectMenuItem: vi.fn(),
    });

    const labels = [...footer.querySelectorAll(".site-footer-link")].map(
      (el) => el.textContent,
    );
    expect(labels).toContain(getMenuItemLabel("about"));
    expect(labels).toContain(getMenuItemLabel("shortcuts"));
    expect(labels).toContain(getMenuItemLabel("privacy"));
    expect(labels).toContain(getMenuItemLabel("terms"));
    // The one deliberate divergence: the footer says "capture setup", the
    // nav would just say "capture".
    expect(labels).toContain("Nastavení zachytávání");
    expect(labels).not.toContain(getMenuItemLabel("capture"));
  });

  it("routes on the untranslated page id", () => {
    const onSelectMenuItem = vi.fn();
    const footer = buildSiteFooter({
      buildStamp: "v0 • abc • now",
      onSelectMenuItem,
    });

    const about = [...footer.querySelectorAll<HTMLElement>(".site-footer-link")].find(
      (el) => el.textContent === "O aplikaci",
    );
    about?.click();

    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("about");
  });

  it("translates the licence line and keeps the year", () => {
    const footer = buildSiteFooter({
      buildStamp: "v0 • abc • now",
      onSelectMenuItem: vi.fn(),
    });
    const year = new Date().getFullYear();

    expect(footer.querySelector(".site-footer-copy")?.textContent).toBe(
      `© ${year} SutraPad · Licence MIT`,
    );
  });
});

describe("empty states in Czech", () => {
  it("translates the copy but keeps the illustration key", () => {
    const copy = emptyCopy("notes");

    expect(copy.title).toBe("Zatím žádné zápisníky.");
    expect(copy.cta).toBe("Napiš první poznámku");
    // `kind` picks the SVG. It is a key, so it must read the same in every
    // language — a translated one would silently fall through to no drawing.
    expect(copy.kind).toBe("notes");
    expect(copy.kind).toBe(EMPTY_STATE_KINDS.notes);
  });

  it("keeps the filter-miss variants on their base illustration", () => {
    expect(emptyCopy("notes_filtered").kind).toBe(emptyCopy("notes").kind);
    expect(emptyCopy("links_filtered").kind).toBe(emptyCopy("links").kind);
  });

  it("renders a Czech scene with its illustration intact", () => {
    const scene = buildEmptyScene(emptyCopy("tasks"));

    expect(scene.querySelector(".empty-scene-title")?.textContent).toBe("Nic na práci.");
    expect(scene.querySelector("svg")?.children.length).toBeGreaterThan(0);
  });

  it("still explains the task syntax in Czech", () => {
    // The only place in the app that tells the user how a task is written —
    // and `[ ]` is syntax, so it must survive translation verbatim.
    expect(emptyCopy("tasks").sub).toContain("[ ]");
  });
});

describe("command palette in Czech", () => {
  it("reuses the nav labels in the shortcut strip", () => {
    // "G N Poznámky" has to match what the Notes tab says, or the hint
    // names a destination the user cannot find.
    expect(getMenuItemLabel("notes")).toBe("Poznámky");
    expect(getMenuItemLabel("links")).toBe("Odkazy");
    expect(getMenuItemLabel("tasks")).toBe("Úkoly");
  });
});
