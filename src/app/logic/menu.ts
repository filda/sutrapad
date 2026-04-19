export type MenuItemId =
  | "home"
  | "add"
  | "notes"
  | "links"
  | "tags"
  | "tasks"
  | "settings";

export interface MenuItem {
  id: MenuItemId;
  label: string;
}

/**
 * Items rendered in the primary navigation pill. The "home" view is reachable
 * via the clickable SutraPad eyebrow in the top row, so it is intentionally
 * left out of this list.
 */
export const MENU_ITEMS: readonly MenuItem[] = [
  { id: "add", label: "Add" },
  { id: "notes", label: "Notes" },
  { id: "links", label: "Links" },
  { id: "tags", label: "Tags" },
  { id: "tasks", label: "Tasks" },
  { id: "settings", label: "Settings" },
];

export const HOME_MENU_ITEM: MenuItem = { id: "home", label: "Home" };

export const DEFAULT_MENU_ITEM: MenuItemId = "notes";

const ALL_MENU_ITEM_IDS: ReadonlySet<MenuItemId> = new Set<MenuItemId>([
  HOME_MENU_ITEM.id,
  ...MENU_ITEMS.map((item) => item.id),
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

export function getMenuItemLabel(id: MenuItemId): string {
  if (id === HOME_MENU_ITEM.id) return HOME_MENU_ITEM.label;
  const match = MENU_ITEMS.find((item) => item.id === id);
  return match?.label ?? id;
}
