import type { SyncState } from "../../session/workspace-sync";
import type { UserProfile } from "../../../types";
import { MENU_ITEMS, type MenuItemId } from "../../logic/menu";
import { buildAccountBar } from "./account-bar";
import { buildTagFilterBar } from "./tag-filter-bar";

export interface TopbarOptions {
  activeMenuItem: MenuItemId;
  profile: UserProfile | null;
  syncState: SyncState;
  statusText: string;
  selectedTagFilters: readonly string[];
  autoTagLookup: ReadonlySet<string>;
  onSelectMenuItem: (id: MenuItemId) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRemoveFilter: (tag: string) => void;
  onClearFilters: () => void;
  onOpenPalette: () => void;
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
  selectedTagFilters,
  autoTagLookup,
  onSelectMenuItem,
  onSignIn,
  onSignOut,
  onRemoveFilter,
  onClearFilters,
  onOpenPalette,
}: TopbarOptions): HTMLElement {
  const topbar = document.createElement("header");
  topbar.className = "topbar";

  topbar.append(buildBrand(activeMenuItem, onSelectMenuItem));
  topbar.append(buildAddPill(activeMenuItem, onSelectMenuItem));
  topbar.append(buildNavTabs(activeMenuItem, onSelectMenuItem));

  // Filter strip sits between the nav tabs and the right-aligned actions so
  // the active filters are always in the chrome, regardless of which page
  // is mounted. Clicking the trigger (or the `/` hint) opens the palette —
  // that's the single suggestion engine for tag selection.
  topbar.append(
    buildTagFilterBar({
      selectedTagFilters,
      autoTagLookup,
      onRemoveFilter,
      onClearFilters,
      onOpenPalette,
    }),
  );

  const actions = document.createElement("div");
  actions.className = "topbar-actions";
  actions.append(buildCaptureChip(() => onSelectMenuItem("capture")));
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

/**
 * How many capture methods the app documents. Reflects the three platforms
 * shipped on the Capture page (Chrome bookmarklet, iOS Share shortcut,
 * Android share intent). The chip is a hint — not live telemetry — because
 * we don't track which methods the user has actually installed.
 *
 * If we ever wire up per-platform install tracking (e.g. a "bookmarklet
 * installed" boolean in profile preferences), this constant should be
 * replaced with a live count computed at call site and the comment
 * updated.
 */
const CAPTURE_METHOD_COUNT = 3;

function buildCaptureChip(onOpenCapture: () => void): HTMLElement {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "capture-chip";
  // Kept short on purpose — the chip's job is a nudge to the Capture page,
  // not a full explainer. The long-form pitch lives on the Capture page
  // itself.
  chip.title = "Capture sources · how your notes get in";
  chip.setAttribute("aria-label", captureChipAriaLabel(CAPTURE_METHOD_COUNT));

  const dot = document.createElement("span");
  dot.className = "capture-dot";
  dot.setAttribute("aria-hidden", "true");
  chip.append(dot);

  const label = document.createElement("span");
  label.className = "capture-chip-label";
  label.textContent = captureChipLabel(CAPTURE_METHOD_COUNT);
  chip.append(label);

  chip.addEventListener("click", onOpenCapture);
  return chip;
}

/**
 * Visible chip label — `3 sources`, or `1 source` when it's singular.
 * Pluralisation is the only reason this is a function and not an inline
 * template: the handoff specifically calls out "pluralise accordingly"
 * for the 1-source case.
 */
function captureChipLabel(count: number): string {
  return `${count} source${count === 1 ? "" : "s"}`;
}

/**
 * Screen-reader label for the chip. The visible label reads `3 sources`
 * which is fine for sighted users; a screen reader benefits from the
 * extra "Capture" context so the count doesn't sound like a notification
 * badge.
 */
function captureChipAriaLabel(count: number): string {
  return `Capture · ${captureChipLabel(count)}`;
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
