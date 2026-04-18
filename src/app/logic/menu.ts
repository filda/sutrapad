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

const ALL_MENU_ITEM_IDS: readonly MenuItemId[] = [
  HOME_MENU_ITEM.id,
  ...MENU_ITEMS.map((item) => item.id),
];

export function isMenuItemId(value: unknown): value is MenuItemId {
  return (
    typeof value === "string" &&
    ALL_MENU_ITEM_IDS.includes(value as MenuItemId)
  );
}

export function getMenuItemLabel(id: MenuItemId): string {
  if (id === HOME_MENU_ITEM.id) return HOME_MENU_ITEM.label;
  const match = MENU_ITEMS.find((item) => item.id === id);
  return match?.label ?? id;
}
