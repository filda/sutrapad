export type MenuItemId =
  | "home"
  | "add"
  | "notes"
  | "links"
  | "tags"
  | "tasks"
  | "capture"
  | "settings"
  | "privacy";

export interface MenuItem {
  id: MenuItemId;
  label: string;
}

/**
 * Items rendered in the primary navigation pill. The "home" view is reachable
 * via the clickable SutraPad eyebrow in the top row, so it is intentionally
 * left out of this list.
 *
 * Per handoff v2: Capture + Settings are *not* nav tabs — Capture sits in
 * the right-actions cluster as the `capture-chip`, and Settings sits there
 * as a gear icon. Both are still valid `MenuItemId`s and therefore still
 * reachable via `onSelectMenuItem`; they're just not rendered here.
 */
export const MENU_ITEMS: readonly MenuItem[] = [
  { id: "add", label: "Add" },
  { id: "notes", label: "Notes" },
  { id: "links", label: "Links" },
  { id: "tasks", label: "Tasks" },
  { id: "tags", label: "Tags" },
];

export const HOME_MENU_ITEM: MenuItem = { id: "home", label: "Home" };

export const DEFAULT_MENU_ITEM: MenuItemId = "notes";

/**
 * Ids reachable via `onSelectMenuItem` but not rendered in the primary nav.
 * Capture and Settings live in the topbar-actions cluster (chip + gear)
 * per handoff v2; Privacy is reached only from the footer link or the
 * Settings → Privacy card (it's a long-form static page, not a daily
 * destination). All three still need to round-trip through the routing
 * layer so deep-links and the persisted last-page path don't drop them.
 */
const OFF_NAV_MENU_ITEM_IDS: readonly MenuItemId[] = [
  "capture",
  "settings",
  "privacy",
];

const ALL_MENU_ITEM_IDS: ReadonlySet<MenuItemId> = new Set<MenuItemId>([
  HOME_MENU_ITEM.id,
  ...MENU_ITEMS.map((item) => item.id),
  ...OFF_NAV_MENU_ITEM_IDS,
]);

/**
 * Menu items that do not represent a page but trigger an action when selected.
 * "add" is a shortcut for the "New note" button on the notebook list — clicking
 * it creates a fresh note and opens its editor instead of navigating to a page.
 */
const MENU_ACTION_ITEM_IDS: ReadonlySet<MenuItemId> = new Set<MenuItemId>(["add"]);

export function isMenuItemId(value: unknown): value is MenuItemId {
  return (
    typeof value === "string" &&
    ALL_MENU_ITEM_IDS.has(value as MenuItemId)
  );
}

/**
 * Returns true when selecting this menu id should trigger an action rather
 * than navigating to a page. Page-style menu ids (e.g. "notes", "links") stay
 * false and continue to drive the active page state.
 */
export function isMenuActionItemId(id: MenuItemId): boolean {
  return MENU_ACTION_ITEM_IDS.has(id);
}

/**
 * Labels for ids that exist but aren't rendered in the primary nav
 * (Capture, Settings, Privacy). Keeps `getMenuItemLabel` lookup-complete
 * so placeholder pages and aria-labels don't fall through to the raw id
 * string.
 */
const OFF_NAV_MENU_ITEM_LABELS: Readonly<
  Record<"capture" | "settings" | "privacy", string>
> = {
  capture: "Capture",
  settings: "Settings",
  privacy: "Privacy",
};

export function getMenuItemLabel(id: MenuItemId): string {
  if (id === HOME_MENU_ITEM.id) return HOME_MENU_ITEM.label;
  const match = MENU_ITEMS.find((item) => item.id === id);
  if (match) return match.label;
  if (id === "capture" || id === "settings" || id === "privacy") {
    return OFF_NAV_MENU_ITEM_LABELS[id];
  }
  return id;
}
