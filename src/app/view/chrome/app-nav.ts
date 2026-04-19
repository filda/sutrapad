import { MENU_ITEMS, type MenuItemId } from "../../logic/menu";

export function buildAppNav(
  activeMenuItem: MenuItemId,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "app-nav";
  nav.setAttribute("aria-label", "Primary");

  for (const item of MENU_ITEMS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `app-nav-item${item.id === activeMenuItem ? " is-active" : ""}`;
    button.textContent = item.label;
    button.setAttribute("aria-current", item.id === activeMenuItem ? "page" : "false");
    button.addEventListener("click", () => onSelectMenuItem(item.id));
    nav.append(button);
  }

  return nav;
}
