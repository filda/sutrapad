import { messages, type Messages } from "../../lib/i18n";

export type MenuItemId =
  | "home"
  | "add"
  | "notes"
  | "links"
  | "tags"
  | "tasks"
  | "capture"
  | "settings"
  | "privacy"
  | "about"
  | "terms"
  | "shortcuts"
  | "lexicon";

/**
 * Ids rendered in the primary navigation pill, in render order. The "home"
 * view is reachable via the clickable SutraPad eyebrow in the top row, so it
 * is intentionally left out of this list.
 *
 * Per handoff v2: Capture + Settings are *not* nav tabs. Settings sits in
 * the right-actions cluster as a gear icon; Capture is reached from the
 * site footer (`Use → Capture setup`) and the command palette. Both are
 * still valid `MenuItemId`s and therefore still reachable via
 * `onSelectMenuItem`; they're just not rendered here.
 *
 * Ids only — the labels live in the message catalog. A menu id is a routing
 * key: it appears in the URL path and in the persisted last-page, so
 * translating one would break every deep link. See `getMenuItemLabel`.
 */
export const NAV_MENU_ITEM_IDS: readonly MenuItemId[] = [
  "add",
  "notes",
  "links",
  "tasks",
  "tags",
];

export const HOME_MENU_ITEM_ID: MenuItemId = "home";

export const DEFAULT_MENU_ITEM: MenuItemId = "notes";

/**
 * Ids reachable via `onSelectMenuItem` but not rendered in the primary nav.
 * Capture and Settings live in the topbar-actions cluster (chip + gear)
 * per handoff v2; Privacy / About / Terms / Shortcuts are static long-form
 * pages reached from the site footer, never the primary nav; Lexicon is
 * an internal workbench page reached only from a Settings link / direct
 * URL, intentionally hidden from the user-facing nav. All of them still
 * need to round-trip through the routing layer so deep-links and the
 * persisted last-page path don't drop them.
 */
const OFF_NAV_MENU_ITEM_IDS: readonly MenuItemId[] = [
  "capture",
  "settings",
  "privacy",
  "about",
  "terms",
  "shortcuts",
  "lexicon",
];

const ALL_MENU_ITEM_IDS: ReadonlySet<MenuItemId> = new Set<MenuItemId>([
  HOME_MENU_ITEM_ID,
  ...NAV_MENU_ITEM_IDS,
  ...OFF_NAV_MENU_ITEM_IDS,
]);

/**
 * Menu items that do not represent a page but trigger an action when selected.
 * "add" is a shortcut for the "New note" button on the notebook list — clicking
 * it creates a fresh note and opens its editor instead of navigating to a page.
 */
const MENU_ACTION_ITEM_IDS: ReadonlySet<MenuItemId> = new Set<MenuItemId>(["add"]);

export function isMenuItemId(value: unknown): value is MenuItemId {
  // `Set.has` returns false for any non-string value (null, numbers,
  // objects), so a separate `typeof value === "string"` guard is dead
  // weight — an unkillable mutant rather than a safety net. Same call
  // `isThemeChoice` in `theme.ts` already makes.
  return ALL_MENU_ITEM_IDS.has(value as MenuItemId);
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
 * Display label for a menu id in the active language.
 *
 * Indexing `catalog.menu` by `MenuItemId` is what keeps the two in step: a
 * new id without a catalog entry is a compile error here, and the Czech
 * catalog then fails to satisfy `Messages` until it is translated. That
 * replaces the old hand-maintained off-nav label table and the `if` chain
 * that had to enumerate its keys a second time.
 */
export function getMenuItemLabel(
  id: MenuItemId,
  catalog: Messages = messages(),
): string {
  return catalog.menu[id];
}
