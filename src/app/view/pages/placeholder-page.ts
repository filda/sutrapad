import { getMenuItemLabel, type MenuItemId } from "../../logic/menu";

export function buildPagePlaceholder(id: MenuItemId): HTMLElement {
  const section = document.createElement("section");
  section.className = `page-placeholder page-placeholder-${id}`;

  const heading = document.createElement("h2");
  heading.textContent = getMenuItemLabel(id);
  section.append(heading);

  return section;
}
