import type { SyncState } from "../../session/workspace-sync";
import type { UserProfile } from "../../../types";
import { MENU_ITEMS, type MenuItemId } from "../../logic/menu";
import { buildAccountBar } from "./account-bar";

export interface TopbarOptions {
  activeMenuItem: MenuItemId;
  profile: UserProfile | null;
  syncState: SyncState;
  statusText: string;
  onSelectMenuItem: (id: MenuItemId) => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

/**
 * Sticky topbar modelled on docs/design_handoff_sutrapad/src/app.jsx. Lays
 * out the brand (which doubles as the Home link), a primary "+ Add" pill, a
 * pill-group of nav tabs, the sync pill, and the account/avatar menu. Menu
 * routing is unchanged — this component is pure structure/styling.
 */
export function buildTopbar({
  activeMenuItem,
  profile,
  syncState,
  statusText,
  onSelectMenuItem,
  onSignIn,
  onSignOut,
}: TopbarOptions): HTMLElement {
  const topbar = document.createElement("header");
  topbar.className = "topbar";

  topbar.append(buildBrand(activeMenuItem, onSelectMenuItem));
  topbar.append(buildAddPill(activeMenuItem, onSelectMenuItem));
  topbar.append(buildNavTabs(activeMenuItem, onSelectMenuItem));

  const actions = document.createElement("div");
  actions.className = "topbar-actions";
  actions.append(buildSyncPill(syncState, statusText));
  actions.append(
    buildAccountBar({
      profile,
      onSignIn,
      onSignOut,
    }),
  );
  topbar.append(actions);

  return topbar;
}

function buildBrand(
  activeMenuItem: MenuItemId,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const brand = document.createElement("button");
  brand.type = "button";
  brand.className = `brand is-link${activeMenuItem === "home" ? " is-active" : ""}`;
  brand.setAttribute("aria-label", "Go to SutraPad home");
  brand.setAttribute(
    "aria-current",
    activeMenuItem === "home" ? "page" : "false",
  );

  const mark = document.createElement("span");
  mark.className = "brand-mark";
  mark.setAttribute("aria-hidden", "true");
  brand.append(mark);

  const wordmark = document.createElement("span");
  wordmark.className = "brand-wordmark";
  wordmark.textContent = "SUTRAPAD";
  brand.append(wordmark);

  brand.addEventListener("click", () => onSelectMenuItem("home"));
  return brand;
}

function buildAddPill(
  activeMenuItem: MenuItemId,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `nav-tab-add${activeMenuItem === "add" ? " is-active" : ""}`;
  button.setAttribute("aria-label", "Add a new note");

  const plus = document.createElement("span");
  plus.className = "nav-tab-add-plus";
  plus.setAttribute("aria-hidden", "true");
  plus.textContent = "+";
  button.append(plus);

  const label = document.createElement("span");
  label.textContent = "Add";
  button.append(label);

  button.addEventListener("click", () => onSelectMenuItem("add"));
  return button;
}

function buildNavTabs(
  activeMenuItem: MenuItemId,
  onSelectMenuItem: (id: MenuItemId) => void,
): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "nav-tabs";
  nav.setAttribute("aria-label", "Primary");

  // "add" is rendered as its own pill CTA, so skip it here to avoid duplicating
  // the control.
  for (const item of MENU_ITEMS) {
    if (item.id === "add") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nav-tab${item.id === activeMenuItem ? " is-active" : ""}`;
    button.textContent = item.label;
    button.setAttribute(
      "aria-current",
      item.id === activeMenuItem ? "page" : "false",
    );
    button.addEventListener("click", () => onSelectMenuItem(item.id));
    nav.append(button);
  }

  return nav;
}

function buildSyncPill(syncState: SyncState, statusText: string): HTMLElement {
  const pill = document.createElement("div");
  pill.className = `sync-pill is-${syncState}`;
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");

  const dot = document.createElement("span");
  dot.className = "sync-dot";
  dot.setAttribute("aria-hidden", "true");
  pill.append(dot);

  const label = document.createElement("span");
  label.className = "sync-pill-label";
  label.textContent = syncPillLabel(syncState);
  pill.append(label);

  // Full status string (including last-edit timestamp / error detail) is kept
  // as a tooltip so the pill itself stays compact — the screen-reader reading
  // comes from `aria-label` instead of the clipped visible label.
  pill.title = statusText;
  pill.setAttribute("aria-label", statusText);

  return pill;
}

/**
 * Visible label on the sync pill. Exported so the app's lightweight
 * `refreshStatus` pathway (background save) can patch the pill in place
 * without having to rebuild the whole topbar.
 */
export function syncPillLabel(syncState: SyncState): string {
  switch (syncState) {
    case "loading":
      return "Loading";
    case "saving":
      return "Saving";
    case "error":
      return "Error";
    default:
      return "Synced";
  }
}
