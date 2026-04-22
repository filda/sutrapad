/**
 * Presentation helper for auto-derived tags. The stored tag form keeps its
 * namespace prefix (e.g. `device:mobile`) so it can never collide with a
 * user-typed tag and so URL filters round-trip verbatim. But rendering that
 * prefix inside every chip is visually noisy and reads like a leaked internal
 * identifier — so the Tags UI pulls the namespace out into an icon and shows
 * only the value as text.
 *
 * This module is the single source of truth for that split: every chip
 * renderer (tag cloud on the Tags page and Notes page, topbar tag-filter
 * strip) runs its auto-tag strings through `formatAutoTagDisplay` to get
 * `{ icon, label }` and composes the chip from those two parts.
 *
 * The function is deliberately dumb: no date parsing, no locale-aware casing,
 * no fancy prettifying. The stored values are already reasonable ("mobile",
 * "today", "example.com"); applying transformations here would make the
 * on-chip label drift from what URL filters / share links encode.
 */

/**
 * Namespaces emitted by `deriveAutoTags`. Keeping the list explicit (rather
 * than inferring from the map keys) makes it obvious at a glance that every
 * category has an icon — if a new namespace is introduced and forgotten, the
 * type error here flags the gap before it ships.
 */
export type AutoTagNamespace =
  | "date"
  | "year"
  | "month"
  | "edit"
  | "source"
  | "device"
  | "orientation"
  | "os"
  | "browser"
  | "lang"
  | "location"
  | "author"
  | "network"
  | "weather"
  | "battery"
  | "scroll"
  | "engagement"
  | "tasks";

const NAMESPACE_ICONS: Readonly<Record<AutoTagNamespace, string>> = {
  date: "\u{1F4C5}",      // 📅  calendar
  year: "\u{1F4C5}",      // 📅  same bucket visually — year / month / exact date all mean "when"
  month: "\u{1F4C5}",     // 📅
  edit: "\u{270F}\u{FE0F}", // ✏️  pencil — "has this been touched since it was written?"
  source: "\u{1F4E5}",    // 📥  inbox tray — "how this note arrived"
  device: "\u{1F4BB}",    // 💻  laptop — fine cover for mobile/desktop/tablet alike
  orientation: "\u{1F4D0}", // 📐  triangular ruler — "how the screen was held"
  os: "\u{2699}\u{FE0F}", // ⚙️   gear
  browser: "\u{1F310}",   // 🌐  globe
  lang: "\u{1F5E3}\u{FE0F}", // 🗣️ speaking head — language of the content
  location: "\u{1F4CD}",  // 📍  round pushpin
  author: "\u{270D}\u{FE0F}", // ✍️  writing hand — who wrote the captured page
  network: "\u{1F4F6}",   // 📶  antenna bars
  weather: "\u{1F324}\u{FE0F}", // 🌤️  sun behind small cloud
  battery: "\u{1F50B}",   // 🔋
  scroll: "\u{1F4DC}",    // 📜  scroll
  engagement: "\u{23F1}\u{FE0F}", // ⏱️  stopwatch — time spent on the source page
  tasks: "\u{2705}",      // ✅  checkbox — state of checklists in the note
};

export interface AutoTagDisplay {
  /** Emoji glyph — safe to drop straight into `textContent`. */
  icon: string;
  /** Value portion of the tag, with namespace prefix stripped. */
  label: string;
  /** Namespace portion, e.g. "device". Useful for grouping or `aria-label`. */
  namespace: AutoTagNamespace;
}

function isKnownNamespace(value: string): value is AutoTagNamespace {
  return Object.hasOwn(NAMESPACE_ICONS, value);
}

/**
 * Splits an auto-tag into icon + label. Returns `null` when the input isn't
 * an auto-tag we know how to format (no `:`, or a namespace we don't have an
 * icon for) — callers should treat that as "render as plain text" and fall
 * back to the user-tag chip style.
 *
 * Only the first `:` is treated as the separator, so values that themselves
 * contain `:` (unlikely but not impossible after normalisation) stay intact.
 */
export function formatAutoTagDisplay(tag: string): AutoTagDisplay | null {
  const separatorIndex = tag.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === tag.length - 1) {
    return null;
  }

  const namespace = tag.slice(0, separatorIndex);
  if (!isKnownNamespace(namespace)) {
    return null;
  }

  return {
    icon: NAMESPACE_ICONS[namespace],
    label: tag.slice(separatorIndex + 1),
    namespace,
  };
}
