// @vitest-environment happy-dom
//
// First focused test for `src/app/view/chrome/topbar.ts` — the sticky chrome
// every page renders under. It composes two modules that now have their own
// suites (`tag-filter-bar`, `account-bar`), so this file deliberately does not
// re-assert their internals; it asserts the things only the topbar owns:
//
//   - **the slot order.** Brand · Add · nav tabs · filter strip · actions is a
//     layout contract, not a preference: the CSS grid places children by
//     position, so a reordered append list silently moves the avatar into the
//     brand slot.
//   - **which ids reach the nav.** `MENU_ITEMS` includes `add`, and the topbar
//     skips it in `buildNavTabs` because the Add pill already renders it.
//     Dropping the `continue` gives the user two Add controls; widening it to
//     skip something else drops a whole page from the primary nav.
//   - **the active-state trio.** `is-active` (visual), `aria-current="page"`
//     (assistive) and the brand's own active class are three separate
//     expressions of the same fact, each with its own mutant. A tab can lose
//     the class and keep the attribute, which reads correct to a screen reader
//     and looks wrong to everyone else.
//   - **the sync pill's two channels.** The visible label is the clipped
//     four-word vocabulary from `syncPillLabel`; the full status string (with
//     timestamp / error detail) only ever appears in `title` *and*
//     `aria-label`. Losing either one silently drops the detail for one
//     audience.
//   - **the icon table.** `NAV_TAB_ICONS` is a partial record, so a wrong or
//     missing entry is not a type error — `settings` has no glyph on purpose
//     and `notes`/`links`/`tasks`/`tags` each have a specific one.
//
// `syncPillLabel` is exported for the lightweight `refreshStatus` path (patch
// the pill in place, don't rebuild the topbar), so it gets its own block: all
// four states plus the `default` arm, which must be reachable through a value
// the union allows.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTopbar, syncPillLabel } from "../src/app/view/chrome/topbar";
import type { SyncState } from "../src/app/session/workspace-sync";
import type { SutraPadTagEntry, UserProfile } from "../src/types";

const PROFILE: UserProfile = {
  name: "Filip Šubr",
  email: "filip@example.com",
  picture: "https://lh3.example.com/avatar.jpg",
};

const TAGS: readonly SutraPadTagEntry[] = [
  { tag: "praha", count: 9, noteIds: ["n1"] },
  { tag: "cesty", count: 4, noteIds: ["n2"] },
];

type Options = Parameters<typeof buildTopbar>[0];

function mount(overrides: Partial<Options> = {}) {
  const spies = {
    onSelectMenuItem: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onRemoveFilter: vi.fn(),
    onClearFilters: vi.fn(),
    onOpenPalette: vi.fn(),
    onApplyFilter: vi.fn(),
  };
  const topbar = buildTopbar({
    activeMenuItem: "notes",
    profile: PROFILE,
    syncState: "idle",
    statusText: "All changes saved · last edit 10:04",
    selectedTagFilters: [],
    availableTagSuggestions: TAGS,
    recentTagFilters: [],
    autoTagLookup: new Set<string>(),
    ...spies,
    ...overrides,
  });
  document.body.append(topbar);
  return { topbar, ...spies };
}

/** Every nav tab, in render order. */
const tabs = (topbar: HTMLElement): HTMLButtonElement[] => [
  ...topbar.querySelectorAll<HTMLButtonElement>(".nav-tabs .nav-tab"),
];

/** The `d` of a nav tab's first icon path — its identifying glyph. */
const firstNavGlyph = (tab: HTMLElement): string | null | undefined =>
  tab.querySelector(".nav-ico svg path")?.getAttribute("d");

const tabLabels = (topbar: HTMLElement): Array<string | null | undefined> =>
  tabs(topbar).map((tab) => tab.querySelector(".nav-tab-label")?.textContent);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("buildTopbar layout", () => {
  it("lays the five slots out in grid order", () => {
    const { topbar } = mount();

    expect(topbar.tagName.toLowerCase()).toBe("header");
    expect(topbar.className).toBe("topbar");
    expect([...topbar.children].map((child) => child.className)).toEqual([
      "brand is-link",
      "nav-tab-add",
      "nav-tabs",
      "tag-filter-bar",
      "topbar-actions",
    ]);
  });

  it("orders the right-hand actions sync · gear · account", () => {
    const { topbar } = mount();
    const actions = topbar.querySelector(".topbar-actions");

    expect([...(actions?.children ?? [])].map((child) => child.className)).toEqual([
      "sync-pill is-idle",
      "settings-gear",
      "account-bar",
    ]);
  });

  it("mounts the filter strip between the nav tabs and the actions", () => {
    // The strip lives in the chrome rather than on a page so the active
    // filters survive navigation; its position is what keeps it off the
    // right-aligned action cluster.
    const { topbar } = mount();
    const classes = [...topbar.children].map((child) => child.className);

    expect(classes.indexOf("tag-filter-bar")).toBe(classes.indexOf("nav-tabs") + 1);
    expect(classes.indexOf("topbar-actions")).toBe(classes.indexOf("tag-filter-bar") + 1);
  });
});

describe("buildTopbar brand", () => {
  it("doubles as the Home link", () => {
    const { topbar, onSelectMenuItem } = mount();
    const brand = topbar.querySelector<HTMLButtonElement>(".brand");

    expect(brand?.type).toBe("button");
    expect(brand?.getAttribute("aria-label")).toBe("Go to SutraPad home");
    expect(brand?.querySelector(".brand-wordmark")?.textContent).toBe("SUTRAPAD");

    brand?.click();
    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("home");
  });

  it("hides the decorative mark from screen readers", () => {
    // The wordmark beside it already reads "SUTRAPAD"; announcing the glyph
    // too would say the brand twice.
    const { topbar } = mount();
    const mark = topbar.querySelector(".brand-mark");

    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.textContent).toBe("");
  });

  it("marks itself current only on the home page", () => {
    const away = mount().topbar.querySelector(".brand");
    document.body.innerHTML = "";
    const home = mount({ activeMenuItem: "home" }).topbar.querySelector(".brand");

    expect(away?.className).toBe("brand is-link");
    expect(away?.getAttribute("aria-current")).toBe("false");
    expect(home?.className).toBe("brand is-link is-active");
    expect(home?.getAttribute("aria-current")).toBe("page");
  });
});

describe("buildTopbar add pill", () => {
  it("renders the CTA with its glyph, label and shortcut hint", () => {
    const { topbar, onSelectMenuItem } = mount();
    const add = topbar.querySelector<HTMLButtonElement>(".nav-tab-add");

    expect(add?.type).toBe("button");
    expect(add?.getAttribute("aria-label")).toBe("Add a new note");
    expect([...(add?.children ?? [])].map((child) => child.tagName.toLowerCase())).toEqual([
      "svg",
      "span",
      "span",
    ]);
    expect(add?.querySelector("span:not(.button-kbd)")?.textContent).toBe("Add");

    add?.click();
    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("add");
  });

  it("draws the plus as an inline stroked SVG, not a text glyph", () => {
    // A "+" character inherits the font's own metrics and drifts off the
    // optical centre of the pill; the handoff draws it at size 14.
    const { topbar } = mount();
    const icon = topbar.querySelector<SVGElement>(".nav-tab-add svg");

    expect(icon?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(icon?.getAttribute("class")).toBe("i i-14");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect([...(icon?.children ?? [])].map((path) => path.getAttribute("d"))).toEqual([
      "M12 5v14",
      "M5 12h14",
    ]);
  });

  it("keeps the shortcut pill decorative and non-interactive", () => {
    const { topbar, onSelectMenuItem } = mount();
    const kbd = topbar.querySelector<HTMLElement>(".nav-tab-add .button-kbd");

    expect(kbd?.textContent).toBe("N");
    expect(kbd?.getAttribute("aria-hidden")).toBe("true");
    expect(kbd?.tagName.toLowerCase()).toBe("span");

    // The click lands on the pill but the handler sits on the button, so a
    // tap anywhere in the CTA still adds a note.
    kbd?.click();
    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("add");
  });

  it("marks itself active while the add flow is the selected item", () => {
    expect(mount().topbar.querySelector(".nav-tab-add")?.className).toBe("nav-tab-add");
    document.body.innerHTML = "";
    expect(
      mount({ activeMenuItem: "add" }).topbar.querySelector(".nav-tab-add")?.className,
    ).toBe("nav-tab-add is-active");
  });
});

describe("buildTopbar nav tabs", () => {
  it("names the primary nav for assistive tech", () => {
    const { topbar } = mount();
    const nav = topbar.querySelector(".nav-tabs");

    expect(nav?.tagName.toLowerCase()).toBe("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Primary");
  });

  it("renders the four content pages and skips the Add pill's duplicate", () => {
    // `MENU_ITEMS` still lists `add` — it is the same routing id the CTA
    // above uses — so the loop has to drop it or the user gets two Add
    // controls side by side.
    const { topbar } = mount();

    expect(tabLabels(topbar)).toEqual(["Notes", "Links", "Tasks", "Tags"]);
    expect(topbar.querySelectorAll(".nav-tabs .nav-tab-add")).toHaveLength(0);
  });

  it("routes each tab to its own page", () => {
    const { topbar, onSelectMenuItem } = mount();

    for (const tab of tabs(topbar)) tab.click();

    expect(onSelectMenuItem.mock.calls.flat()).toEqual(["notes", "links", "tasks", "tags"]);
  });

  it("marks exactly the active tab, in both channels", () => {
    const { topbar } = mount({ activeMenuItem: "tasks" });

    expect(tabs(topbar).map((tab) => tab.className)).toEqual([
      "nav-tab",
      "nav-tab",
      "nav-tab is-active",
      "nav-tab",
    ]);
    expect(tabs(topbar).map((tab) => tab.getAttribute("aria-current"))).toEqual([
      "false",
      "false",
      "page",
      "false",
    ]);
  });

  it("marks nothing when the active page is not in the nav", () => {
    // Settings, Privacy and the static pages route through the same ids but
    // are reached from the gear and the footer; none of them may light up a
    // content tab.
    const { topbar } = mount({ activeMenuItem: "settings" });

    expect(tabs(topbar).map((tab) => tab.className)).toEqual([
      "nav-tab",
      "nav-tab",
      "nav-tab",
      "nav-tab",
    ]);
    expect(tabs(topbar).every((tab) => tab.getAttribute("aria-current") === "false")).toBe(
      true,
    );
  });

  it("pairs each tab with its own glyph at nav scale", () => {
    // `NAV_TAB_ICONS` is a partial record, so a wrong glyph is not a type
    // error — the note/link/task/tag mapping only exists here.
    const { topbar } = mount();

    expect(tabs(topbar).map((tab) => tab.querySelector(".nav-ico svg")?.getAttribute("class"))).toEqual([
      "i i-14",
      "i i-14",
      "i i-14",
      "i i-14",
    ]);
    // Four distinct glyphs: a shared one would be a table typo, not a design.
    const shapes = tabs(topbar).map((tab) => firstNavGlyph(tab));
    expect(new Set(shapes).size).toBe(4);
    expect(shapes.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
  });

  it("wraps the glyph and the label in separate spans", () => {
    // The mobile breakpoint hides `.nav-tab-label` and keeps `.nav-ico`; one
    // shared wrapper would hide the icon too and leave blank pills.
    const { topbar } = mount();
    const notes = tabs(topbar)[0];

    expect([...(notes?.children ?? [])].map((child) => child.className)).toEqual([
      "nav-ico",
      "nav-tab-label",
    ]);
    expect(tabs(topbar).every((tab) => (tab as HTMLButtonElement).type === "button")).toBe(
      true,
    );
  });
});

describe("buildTopbar settings gear", () => {
  it("routes to Settings from a labelled icon button", () => {
    const { topbar, onSelectMenuItem } = mount();
    const gear = topbar.querySelector<HTMLButtonElement>(".settings-gear");

    expect(gear?.type).toBe("button");
    // Icon-only, so both the accessible name and the hover tooltip matter.
    expect(gear?.getAttribute("aria-label")).toBe("Settings");
    expect(gear?.title).toBe("Settings");
    expect(gear?.textContent).toBe("");

    gear?.click();
    expect(onSelectMenuItem).toHaveBeenCalledExactlyOnceWith("settings");
  });

  it("draws the cog at gear scale", () => {
    const { topbar } = mount();
    const icon = topbar.querySelector<SVGElement>(".settings-gear svg");

    expect(icon?.getAttribute("class")).toBe("i i-14");
    expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon?.getAttribute("focusable")).toBe("false");
    expect((icon?.children.length ?? 0) > 0).toBe(true);
  });

  it("stays out of the nav-tabs group", () => {
    // Handoff v2 pulled Settings out of the pill group so the primary nav
    // reads as content-only.
    const { topbar } = mount({ activeMenuItem: "settings" });

    expect(topbar.querySelector(".nav-tabs .settings-gear")).toBeNull();
    expect(topbar.querySelector(".topbar-actions .settings-gear")).not.toBeNull();
  });
});

describe("buildTopbar sync pill", () => {
  it("announces itself as a polite live region", () => {
    const { topbar } = mount();
    const pill = topbar.querySelector(".sync-pill");

    expect(pill?.tagName.toLowerCase()).toBe("div");
    expect(pill?.getAttribute("role")).toBe("status");
    // Assertive would interrupt whatever the user is reading on every save.
    expect(pill?.getAttribute("aria-live")).toBe("polite");
    expect(pill?.querySelector(".sync-dot")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the state in the class and the label", () => {
    const rendered = (["idle", "loading", "saving", "error"] as const).map((syncState) => {
      document.body.innerHTML = "";
      const pill = mount({ syncState }).topbar.querySelector(".sync-pill");
      return `${pill?.className} → ${pill?.querySelector(".sync-pill-label")?.textContent}`;
    });

    expect(rendered).toEqual([
      "sync-pill is-idle → Synced",
      "sync-pill is-loading → Loading",
      "sync-pill is-saving → Saving",
      "sync-pill is-error → Error",
    ]);
  });

  it("keeps the full status out of the visible label but in both metadata slots", () => {
    // The pill is width-constrained, so the timestamp / error detail lives in
    // the tooltip for pointer users and in `aria-label` for screen readers.
    // Dropping either one loses the detail for exactly one audience.
    const statusText = "Save failed · retrying in 30 s";
    const { topbar } = mount({ syncState: "error", statusText });
    const pill = topbar.querySelector<HTMLElement>(".sync-pill");

    expect(pill?.title).toBe(statusText);
    expect(pill?.getAttribute("aria-label")).toBe(statusText);
    expect(pill?.querySelector(".sync-pill-label")?.textContent).toBe("Error");
  });

  it("puts the dot before the label", () => {
    const { topbar } = mount();

    expect(
      [...(topbar.querySelector(".sync-pill")?.children ?? [])].map((c) => c.className),
    ).toEqual(["sync-dot", "sync-pill-label"]);
  });
});

describe("syncPillLabel", () => {
  it("maps every sync state to its own word", () => {
    expect(
      (["idle", "loading", "saving", "error"] as const).map((state) => syncPillLabel(state)),
    ).toEqual(["Synced", "Loading", "Saving", "Error"]);
  });

  it("falls back to Synced for a state it does not know", () => {
    // The `default` arm exists because `refreshStatus` patches the pill from a
    // value that has crossed a `localStorage` round-trip; "Synced" is the
    // quiet fallback rather than a blank pill.
    expect(syncPillLabel("resting" as SyncState)).toBe("Synced");
  });
});

describe("buildTopbar composition", () => {
  it("hands the filter strip its selection and its callbacks", () => {
    const { topbar, onRemoveFilter, onClearFilters } = mount({
      selectedTagFilters: ["praha"],
    });
    const bar = topbar.querySelector(".tag-filter-bar");

    // `is-active` only appears when the strip received a non-empty selection,
    // so it doubles as proof the array was passed through rather than
    // defaulted.
    expect(bar?.className).toBe("tag-filter-bar is-active");
    expect(bar?.querySelector(".tfb-chips")?.textContent).toContain("praha");

    bar?.querySelector<HTMLButtonElement>(".tfb-chips button")?.click();
    expect(onRemoveFilter).toHaveBeenCalledWith("praha");
    bar?.querySelector<HTMLButtonElement>(".tfb-clear")?.click();
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it("hands the account bar the signed-in profile", () => {
    const { topbar, onSignOut } = mount();
    const account = topbar.querySelector(".account-bar");

    expect(account?.querySelector<HTMLImageElement>(".account-avatar")?.alt).toBe(
      PROFILE.name,
    );
    account?.querySelector<HTMLButtonElement>(".account-menu-signout")?.click();
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("hands the account bar a null profile through unchanged", () => {
    // `profile: null` is the signed-out branch of a different module; the
    // topbar must not substitute a placeholder for it.
    const { topbar, onSignIn } = mount({ profile: null });

    expect(topbar.querySelector(".account-avatar")).toBeNull();
    topbar.querySelector<HTMLButtonElement>(".account-sign-in")?.click();
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("routes the palette shortcut out of the filter strip", () => {
    const { topbar, onOpenPalette } = mount();

    topbar.querySelector<HTMLElement>(".tfb-kbd")?.click();

    expect(onOpenPalette).toHaveBeenCalledOnce();
  });
});
