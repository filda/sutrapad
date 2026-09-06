import { getMenuItemLabel, type MenuItemId } from "../../logic/menu";
import { messages } from "../../../lib/i18n";

/**
 * Ids that appear as pinned tabs in the mobile bottom bar, in render order.
 * Kept as a small dedicated list (rather than reusing MENU_ITEMS) because the
 * mobile bottom bar intentionally drops Add: Add is fulfilled by the app FAB
 * (see `app-fab.ts`) so it doesn't steal bottom-bar real estate from the five
 * primary destinations.
 *
 * Why these five: handoff v2 README originally specced four tabs (Today ·
 * Notes · Tasks · Tags) and routed Links through a not-yet-built overflow.
 * Shipping Links as a fifth tab is a deliberate variance from that spec —
 * five is still within Apple HIG / Material's 5-max for bottom navigation,
 * keeps every primary content collection one thumb-tap away, and avoids
 * the discoverability cost of relegating Links to a kebab. Home is labelled
 * "Today" on mobile to match the page's own title once you arrive; the
 * tab is intentionally redundant with the brand-mark home link in the
 * topbar (the brand collapses to a 26×26 icon on mobile, which is harder
 * to find as a route than a labelled bottom tab).
 *
 * Order mirrors the desktop nav-tabs (Notes · Links · Tasks · Tags) with
 * Today prepended so the bottom-bar's first slot is the dashboard, the
 * pattern Twitter/Instagram/LinkedIn use.
 */
export const MOBILE_TABBAR_ITEM_IDS: readonly MenuItemId[] = [
  "home",
  "notes",
  "links",
  "tasks",
  "tags",
];

/**
 * Label for a bottom-bar tab. Everything reuses the primary-nav label except
 * Home, which reads "Today" down here to match the page's own title once you
 * arrive — so the divergence is one branch rather than a duplicated table.
 */
export function getMobileTabLabel(id: MenuItemId): string {
  return id === "home" ? messages().nav.today : getMenuItemLabel(id);
}

/**
 * Returns true iff `activeMenuItem` matches one of the tabbar entries. The
 * tabbar hides its active highlight on off-bar pages (Capture, Settings)
 * because none of its own tabs represent "where you are" in that case.
 */
export function isMobileTabActive(
  id: MenuItemId,
  activeMenuItem: MenuItemId,
): boolean {
  return id === activeMenuItem;
}

export interface MobileTabbarOptions {
  activeMenuItem: MenuItemId;
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Sticky-to-bottom tab bar shown only at ≤640px (visibility is owned by CSS
 * — the element is always rendered so a viewport resize reveals it without a
 * re-render). The active item uses the same `.is-active` hook the desktop
 * nav-tabs use, so the one set of hover/active paint rules covers both.
 */
export function buildMobileTabbar({
  activeMenuItem,
  onSelectMenuItem,
}: MobileTabbarOptions): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "mobile-tabbar";
  nav.setAttribute("aria-label", messages().nav.mobileLabel);

  for (const id of MOBILE_TABBAR_ITEM_IDS) {
    const active = isMobileTabActive(id, activeMenuItem);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mobile-tab${active ? " is-active" : ""}`;
    button.textContent = getMobileTabLabel(id);
    button.setAttribute("aria-current", active ? "page" : "false");
    button.addEventListener("click", () => onSelectMenuItem(id));
    nav.append(button);
  }

  return nav;
}
