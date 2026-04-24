import type { SyncState } from "../../session/workspace-sync";
import type { SutraPadTagEntry, UserProfile } from "../../../types";
import { MENU_ITEMS, type MenuItemId } from "../../logic/menu";
import { buildAccountBar } from "./account-bar";
import { buildTagFilterBar } from "./tag-filter-bar";
import { buildIcon, type IconName } from "../shared/icons";

/**
 * Mapping from primary-nav menu id to the glyph slot in the handoff icon set.
 * Kept as a table rather than a switch so the mapping reads declaratively and
 * a missing entry (e.g. a new `MenuItemId`) shows up as a type error at the
 * `satisfies` site below rather than silently falling through.
 *
 * Source: `docs/design_handoff_sutrapad2/src/app.jsx` lines 14-18 (`tabs`
 * array with `ico: ICONS.note/link/task/tag`).
 */
const NAV_TAB_ICONS: Partial<Record<MenuItemId, IconName>> = {
  notes: "note",
  links: "link",
  tasks: "task",
  tags: "tag",
};

export interface TopbarOptions {
  activeMenuItem: MenuItemId;
  profile: UserProfile | null;
  syncState: SyncState;
  statusText: string;
  selectedTagFilters: readonly string[];
  /**
   * Full tag index fed into the tag-filter-bar's inline typeahead. Expected
   * to already be count-desc + alpha sorted (as produced by `buildTagIndex`).
   */
  availableTagSuggestions: readonly SutraPadTagEntry[];
  /**
   * Newest-first persisted recent-tag list (max 8). Hydrated by app.ts from
   * `localStorage.sp_recent_tags`.
   */
  recentTagFilters: readonly string[];
  autoTagLookup: ReadonlySet<string>;
  onSelectMenuItem: (id: MenuItemId) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRemoveFilter: (tag: string) => void;
  onClearFilters: () => void;
  onOpenPalette: () => void;
  onApplyFilter: (tag: string) => void;
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
  availableTagSuggestions,
  recentTagFilters,
  autoTagLookup,
  onSelectMenuItem,
  onSignIn,
  onSignOut,
  onRemoveFilter,
  onClearFilters,
  onOpenPalette,
  onApplyFilter,
}: TopbarOptions): HTMLElement {
  const topbar = document.createElement("header");
  topbar.className = "topbar";

  topbar.append(buildBrand(activeMenuItem, onSelectMenuItem));
  topbar.append(buildAddPill(activeMenuItem, onSelectMenuItem));
  topbar.append(buildNavTabs(activeMenuItem, onSelectMenuItem));

  // Filter strip sits between the nav tabs and the right-aligned actions so
  // the active filters are always in the chrome, regardless of which page
  // is mounted. The strip now carries its own inline typeahead input — the
  // `/` kbd pill still opens the palette as a richer cmd-k surface that can
  // also search notes.
  topbar.append(
    buildTagFilterBar({
      selectedTagFilters,
      availableTagSuggestions,
      recentTagFilters,
      autoTagLookup,
      onRemoveFilter,
      onClearFilters,
      onOpenPalette,
      onApplyFilter,
    }),
  );

  const actions = document.createElement("div");
  actions.className = "topbar-actions";
  actions.append(buildCaptureChip(() => onSelectMenuItem("capture")));
  actions.append(buildSyncPill(syncState, statusText));
  actions.append(buildSettingsGear(() => onSelectMenuItem("settings")));
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

  // Handoff renders the plus as a stroked SVG (size 14) inline with the
  // "Add" label — no bubble. Keeping parity so the Add pill reads as a
  // CTA, not a badge with a count.
  button.append(buildIcon("plus", 14));

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
    button.setAttribute(
      "aria-current",
      item.id === activeMenuItem ? "page" : "false",
    );

    // Icon-before-label pairing matches the handoff: `.nav-ico` wraps the
    // stroked SVG so the CSS can tune colour + opacity independently of the
    // text label. `.nav-tab` labels live inside their own `<span>` so the
    // mobile breakpoint can hide them without dropping the icon.
    const iconName = NAV_TAB_ICONS[item.id];
    if (iconName) {
      const iconWrap = document.createElement("span");
      iconWrap.className = "nav-ico";
      iconWrap.append(buildIcon(iconName, 14));
      button.append(iconWrap);
    }

    const label = document.createElement("span");
    label.className = "nav-tab-label";
    label.textContent = item.label;
    button.append(label);

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

/**
 * Small ghost gear button that routes to the Settings page. Per handoff v2
 * Settings no longer lives in the nav-tabs pill-group — it's a quiet icon
 * tucked between the sync pill and the avatar, so the primary nav stays
 * focused on content pages (Add · Notes · Links · Tasks · Tags) and
 * preferences get out of the way. The gear silhouette comes from the
 * shared icon library (`ICONS.cog` in the handoff icons file).
 */
function buildSettingsGear(onOpenSettings: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-gear";
  button.setAttribute("aria-label", "Settings");
  button.title = "Settings";
  button.append(buildIcon("cog", 14));
  button.addEventListener("click", onOpenSettings);
  return button;
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
