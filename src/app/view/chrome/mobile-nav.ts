import type { MenuItemId } from "../../logic/menu";

export interface MobileTabbarItem {
  id: MenuItemId;
  label: string;
}

/**
 * Ids that appear as pinned tabs in the mobile bottom bar, in render order.
 * Kept as a small dedicated list (rather than reusing MENU_ITEMS) because the
 * mobile bottom bar intentionally drops Add: Add is fulfilled by the floating
 * action button so it doesn't steal bottom-bar real estate from the five
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
export const MOBILE_TABBAR_ITEMS: readonly MobileTabbarItem[] = [
  { id: "home", label: "Today" },
  { id: "notes", label: "Notes" },
  { id: "links", label: "Links" },
  { id: "tasks", label: "Tasks" },
  { id: "tags", label: "Tags" },
];

/**
 * Returns true iff `activeMenuItem` matches one of the tabbar entries. The
 * tabbar hides its active highlight on off-bar pages (Capture, Settings)
 * because none of its own tabs represent "where you are" in that case.
 */
export function isMobileTabActive(
  item: MobileTabbarItem,
  activeMenuItem: MenuItemId,
): boolean {
  return item.id === activeMenuItem;
}

/**
 * Pure-logic description of the FAB's visibility. The FAB is suppressed on
 * the Add route — we don't stack a "create note" FAB over the screen that
 * IS the create-note surface. Exposed as its own function (rather than
 * baked into the builder only) so it is covered by DOM-free tests.
 */
export function describeMobileFab(
  activeMenuItem: MenuItemId,
): { hidden: boolean; ariaLabel: string } {
  return {
    hidden: activeMenuItem === "add",
    ariaLabel: "New note",
  };
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
  nav.setAttribute("aria-label", "Mobile primary navigation");

  for (const item of MOBILE_TABBAR_ITEMS) {
    const active = isMobileTabActive(item, activeMenuItem);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mobile-tab${active ? " is-active" : ""}`;
    button.textContent = item.label;
    button.setAttribute("aria-current", active ? "page" : "false");
    button.addEventListener("click", () => onSelectMenuItem(item.id));
    nav.append(button);
  }

  return nav;
}

export interface MobileFabOptions {
  activeMenuItem: MenuItemId;
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Floating action button — terracotta circle pinned to the bottom-right on
 * phone-width viewports. Tapping it fires `onSelectMenuItem("add")`, which
 * is the same path the desktop "+" pill uses, so creating a note reaches the
 * exact same detail route.
 *
 * We suppress the button when we're already on the Add flow (detail editor
 * on a freshly created note counts as "on Add" for this rule — callers pass
 * the effective menu id). Hiding is done via a data-attribute rather than
 * returning null so CSS can still transition in/out if we ever animate it.
 */
export function buildMobileFab({
  activeMenuItem,
  onSelectMenuItem,
}: MobileFabOptions): HTMLElement {
  const { hidden, ariaLabel } = describeMobileFab(activeMenuItem);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mobile-fab";
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  if (hidden) {
    button.setAttribute("data-hidden", "true");
  }

  const plus = document.createElement("span");
  plus.className = "mobile-fab-plus";
  plus.setAttribute("aria-hidden", "true");
  plus.textContent = "+";
  button.append(plus);

  button.addEventListener("click", () => onSelectMenuItem("add"));
  return button;
}
