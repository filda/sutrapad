export type MenuItemId = "add" | "notes" | "links" | "tags" | "tasks" | "settings";

export interface MenuItem {
  id: MenuItemId;
  label: string;
}

export const MENU_ITEMS: readonly MenuItem[] = [
  { id: "add", label: "Add" },
  { id: "notes", label: "Notes" },
  { id: "links", label: "Links" },
  { id: "tags", label: "Tags" },
  { id: "tasks", label: "Tasks" },
  { id: "settings", label: "Settings" },
];

export const DEFAULT_MENU_ITEM: MenuItemId = "notes";

export function isMenuItemId(value: unknown): value is MenuItemId {
  return (
    typeof value === "string" &&
    MENU_ITEMS.some((item) => item.id === value)
  );
}

export function getMenuItemLabel(id: MenuItemId): string {
  const match = MENU_ITEMS.find((item) => item.id === id);
  return match?.label ?? id;
}
