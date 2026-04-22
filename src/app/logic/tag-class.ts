/**
 * Tag taxonomy — the seven classes the handoff v2 design organises all tags
 * around. Ported from `docs/design_handoff_sutrapad2/src/data.jsx:342-350`
 * (and consumed verbatim by `taglib.jsx`'s `tagClassMeta`).
 *
 * The shape of the port:
 *
 * - We keep storing tags as plain strings on notes (`SutraPadDocument.tags:
 *   string[]`) — no schema migration. Class is derived at render time by
 *   `classifyTag` below.
 * - User-typed tags (hand-curated in the editor, lifted from `#hashtag` in
 *   the body) land in `topic`. This matches the handoff's `role: "user"` —
 *   only `topic` is user-authored; the other six classes are always auto.
 * - Auto-tags come from `src/lib/auto-tags.ts` as namespaced strings like
 *   `date:today` / `location:prague` / `weather:rainy`. We map each known
 *   facet onto one of the six auto classes. Unknown facets default to
 *   `source` on the assumption they're capture-context; new facets added
 *   without a class-map entry will style as source pills but won't break.
 *
 * Nothing here knows about the rendering layer — the view pulls
 * `TAG_CLASSES[classifyTag(tag, kind)]` to get label/symbol/hue/role.
 */

export type TagClassId =
  | "topic"
  | "place"
  | "when"
  | "source"
  | "device"
  | "weather"
  | "people";

export type TagClassRole = "user" | "auto";

export interface TagClassMeta {
  /** Human-readable label, used in the Tags-page section headers. */
  readonly label: string;
  /** Single-char prefix sigil rendered in the pill (`#` for topic, etc.). */
  readonly symbol: string;
  /** Base hue (0–360) for pill colour — CSS reads it as `--h`. */
  readonly hue: number;
  /** Who authors tags of this class. Only `topic` is user-authored. */
  readonly role: TagClassRole;
  /** One-liner shown in the class header / alias-merge tooltips. */
  readonly desc: string;
}

export const TAG_CLASSES: Readonly<Record<TagClassId, TagClassMeta>> = {
  topic: {
    label: "Topic",
    symbol: "#",
    hue: 18,
    role: "user",
    desc: "Concepts, projects, ideas — what it's about.",
  },
  place: {
    label: "Place",
    symbol: "@",
    hue: 140,
    role: "auto",
    desc: "Location — from GPS or reverse geocode.",
  },
  when: {
    label: "When",
    symbol: "~",
    hue: 260,
    role: "auto",
    desc: "Time of day, day of week, season.",
  },
  source: {
    label: "Source",
    symbol: "!",
    hue: 45,
    role: "auto",
    desc: "How the note was captured.",
  },
  device: {
    label: "Device",
    symbol: "%",
    hue: 200,
    role: "auto",
    desc: "Which device wrote it.",
  },
  weather: {
    label: "Weather",
    symbol: "^",
    hue: 190,
    role: "auto",
    desc: "Conditions at capture time.",
  },
  people: {
    label: "People",
    symbol: "*",
    hue: 330,
    role: "auto",
    desc: "Mentioned in the body.",
  },
};

/**
 * Ordered IDs for iteration. Matches the handoff's visual order on the
 * Tags screen: user-authored topics first, then the auto facets grouped
 * by conceptual proximity (place/when/source/device/weather share the
 * "how + where + when it was captured" intuition; people closes).
 */
export const TAG_CLASS_IDS: readonly TagClassId[] = [
  "topic",
  "place",
  "when",
  "source",
  "device",
  "weather",
  "people",
];

/**
 * Maps every auto-tag facet produced by `src/lib/auto-tags.ts` onto a
 * class. Keep this table aligned with `deriveAutoTags` — adding a new
 * facet there without an entry here silently falls through to `source`.
 *
 * Rationale for the less-obvious bucketings:
 *   - `lang`, `edit`, `scroll`, `engagement`, `tasks` → `source`. They
 *     describe the capture context / source behaviour, not the device
 *     itself. Keeping them under `source` means the Source section on the
 *     Tags screen doubles as a "capture workflow" view, which reads better
 *     than a half-dozen single-entry sections.
 *   - `network`, `battery` → `device`. Transient device state, but still
 *     about the machine — users filter "notes I took while my phone was
 *     on 5%" in the same mental mode as "notes from my phone".
 *   - `author` → `people`. The captured page's declared author is the only
 *     people-shaped signal we currently derive.
 */
const AUTO_FACET_TO_CLASS: Readonly<Record<string, TagClassId>> = {
  date: "when",
  month: "when",
  year: "when",
  location: "place",
  source: "source",
  edit: "source",
  lang: "source",
  scroll: "source",
  engagement: "source",
  tasks: "source",
  device: "device",
  os: "device",
  browser: "device",
  orientation: "device",
  network: "device",
  battery: "device",
  weather: "weather",
  author: "people",
};

/**
 * Splits a tag string into `{ facet, value }`. Auto-tags are namespaced
 * (`date:today`, `location:prague`); user tags are plain (`coffee`,
 * `writing`) and return `{ facet: null, value: tag }`.
 *
 * An empty facet (`:value`) is treated as no facet — guards against user
 * tags that happen to start with a colon not being misclassified.
 */
export function parseTagName(tag: string): {
  facet: string | null;
  value: string;
} {
  const colon = tag.indexOf(":");
  if (colon <= 0) return { facet: null, value: tag };
  return {
    facet: tag.slice(0, colon),
    value: tag.slice(colon + 1),
  };
}

/**
 * The class-lookup contract. `kind` decides the top-level branch:
 *
 *   - `"user"` → always `topic`. User-authored tags never carry a
 *     `facet:` prefix in our data model; even if one did (a user types
 *     `location:prague` by hand), we keep it in `topic` because class
 *     is about authorship + role, not string shape.
 *   - `"auto"` → look up the facet in `AUTO_FACET_TO_CLASS`. Unknown
 *     facets fall through to `source` so the UI stays paintable — a new
 *     auto-tag facet added without updating this table won't crash;
 *     it'll just style as a source pill until the table learns about it.
 *   - Plain strings with no colon classified as `auto` fall through to
 *     `source` too (same reasoning).
 *
 * Passing `kind: undefined` (a persisted entry from before auto-tags
 * existed) is treated as `"user"` — matches the same fallback
 * `buildCombinedTagIndex` uses elsewhere.
 */
export function classifyTag(
  tag: string,
  kind: "user" | "auto" | undefined,
): TagClassId {
  if (kind !== "auto") return "topic";
  const { facet } = parseTagName(tag);
  if (facet === null) return "source";
  return AUTO_FACET_TO_CLASS[facet] ?? "source";
}

/**
 * Convenience for callers that only have the raw auto-tag string (like a
 * URL filter parsing `?tags=location:prague` into chips). Equivalent to
 * `classifyTag(tag, "auto")`.
 */
export function classifyAutoTag(tag: string): TagClassId {
  return classifyTag(tag, "auto");
}

/**
 * Render-side lookup — gives the view layer label/symbol/hue/role/desc
 * for a tag entry in one call. Defined here rather than inline in the
 * view so the renderer stays a pure function of (tag, class, meta).
 */
export function metaForClass(classId: TagClassId): TagClassMeta {
  return TAG_CLASSES[classId];
}
