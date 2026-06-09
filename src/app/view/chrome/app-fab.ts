import type { MenuItemId } from "../../logic/menu";

/**
 * Pure-logic description of the FAB's visibility. The FAB is suppressed on
 * the Add route — we don't stack a "create note" FAB over the screen that
 * IS the create-note surface. Exposed as its own function (rather than
 * baked into the builder only) so it is covered by DOM-free tests.
 */
export function describeAppFab(
  activeMenuItem: MenuItemId,
): { hidden: boolean; ariaLabel: string } {
  return {
    hidden: activeMenuItem === "add",
    ariaLabel: "New note",
  };
}

export interface AppFabOptions {
  activeMenuItem: MenuItemId;
  onSelectMenuItem: (id: MenuItemId) => void;
}

/**
 * Floating action button — terracotta circle pinned to the bottom-right.
 * Originally mobile-only, now the sole "create note" CTA on every viewport:
 * the page-header used to carry a `+ New note` button on Home and Notes, but
 * it disappeared when the user collapsed the intro and duplicated the topbar
 * `Add` pill. The FAB sidesteps both problems by living outside the header.
 *
 * Tapping it fires `onSelectMenuItem("add")`, the same path the desktop
 * `Add` pill uses, so creating a note reaches the exact same detail route
 * regardless of which affordance the user touched.
 *
 * We suppress the button when we're already on the Add flow (detail editor
 * on a freshly created note counts as "on Add" for this rule — callers pass
 * the effective menu id). Hiding is done via a data-attribute rather than
 * returning null so CSS can still transition in/out if we ever animate it.
 */
export function buildAppFab({
  activeMenuItem,
  onSelectMenuItem,
}: AppFabOptions): HTMLElement {
  const { hidden, ariaLabel } = describeAppFab(activeMenuItem);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-fab";
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  if (hidden) {
    button.dataset.hidden = "true";
  }

  const plus = document.createElement("span");
  plus.className = "app-fab-plus";
  plus.setAttribute("aria-hidden", "true");
  plus.textContent = "+";
  button.append(plus);

  button.addEventListener("click", () => onSelectMenuItem("add"));
  return button;
}
