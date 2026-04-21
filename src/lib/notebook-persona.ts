import type { SutraPadDocument } from "../types";
import { deriveAutoTags } from "./auto-tags";

/**
 * Notebook persona — a deterministic "character" for each note derived from
 * its tags and metadata. Ported from docs/design_handoff_sutrapad
 * (notebook_persona.jsx). Pure + DOM-free so the UI can call it on every
 * render without memoisation and tests can assert the exact output.
 *
 * The design handoff models tags as `{ class, name }` pairs; SutraPad stores
 * tags as flat strings. Here we bridge: user-typed tags fill the `topic`
 * bucket, and namespaced auto-tags (`location:…`, `source:…`, `device:…`)
 * stand in for `place`/`source`/`device`. A single `when` bucket is computed
 * fresh from `createdAt` so notes don't need an explicit time-of-day tag.
 */

export interface NotebookPersonaPaper {
  /** Card background colour. Lands on the `.note-list-item` or inline style. */
  bg: string;
  /** Primary text colour on that paper. Must contrast with `bg`. */
  ink: string;
}

export interface NotebookPersonaFonts {
  title: string;
  body: string;
}

export interface NotebookPersonaDensity {
  titlePx: number;
  bodyPx: number;
  lineHeight: number;
  padding: number;
}

export type NotebookPersonaFontTier = "default" | "mono" | "handwritten";

export type NotebookPersonaStickerKind =
  | "night-owl"
  | "one-shot"
  | "reading"
  | "regular"
  | "first-of-kind"
  | "to-go"
  | "away"
  | "voice";

export interface NotebookPersonaSticker {
  kind: NotebookPersonaStickerKind;
  label: string;
}

export type NotebookPersonaPatina =
  | "coffee-ring"
  | "folded-corner"
  | "pencil-marks"
  | "highlight"
  | "washi"
  | "date-stamp"
  | "pin";

export interface NotebookPersona {
  /** Paper surface + ink colour pair for the card. */
  paper: NotebookPersonaPaper;
  /** Human-readable paper label (e.g. "Evening paper"). */
  paperName: string;
  /** Derived notebook name (topic-capitalised, or paper name). */
  notebookName: string;
  /** Optional accent override; prefers terracotta saturation when set. */
  accent: string | null;
  fonts: NotebookPersonaFonts;
  fontTier: NotebookPersonaFontTier;
  density: NotebookPersonaDensity;
  /** Signed degrees in -0.8..0.8, deterministic by note id. */
  rotation: number;
  /** 0..1 "lived-in" score combining age + edit activity. */
  wear: number;
  /** Decorative stickers; capped at 3. */
  stickers: readonly NotebookPersonaSticker[];
  /** Decorative patinas; capped at 3. */
  patina: readonly NotebookPersonaPatina[];
}

export interface NotebookPersonaOptions {
  /** Used for regular / first-of-kind stickers (place + topic frequency). */
  allNotes?: readonly SutraPadDocument[];
  /** `true` picks the dark variant of the paper palette. */
  dark?: boolean;
  /** "Now" for age-based wear + night-owl; injectable for tests. */
  now?: Date;
}

type WhenBucket =
  | "morning"
  | "evening"
  | "night"
  | "weekend"
  | "weekday"
  | "spring"
  | "summer"
  | "autumn"
  | "winter"
  | "default";

const PAPERS: Record<WhenBucket, { light: NotebookPersonaPaper; dark: NotebookPersonaPaper }> = {
  morning: { light: { bg: "#fbf4e6", ink: "#3a2e22" }, dark: { bg: "#2a231b", ink: "#e7dcc6" } },
  evening: { light: { bg: "#f4e2c7", ink: "#4a321e" }, dark: { bg: "#2b2015", ink: "#ebc891" } },
  night: { light: { bg: "#e8e6ea", ink: "#22242b" }, dark: { bg: "#1a1b22", ink: "#cdd2de" } },
  weekend: { light: { bg: "#f6e6d5", ink: "#3e2919" }, dark: { bg: "#2d2016", ink: "#f0cfa3" } },
  weekday: { light: { bg: "#f1ebdd", ink: "#2c2620" }, dark: { bg: "#23201a", ink: "#d9cfb8" } },
  spring: { light: { bg: "#eef0dc", ink: "#2e3520" }, dark: { bg: "#1d211a", ink: "#c9d6b0" } },
  summer: { light: { bg: "#f8ead0", ink: "#3d2a17" }, dark: { bg: "#2a1f14", ink: "#ead09a" } },
  autumn: { light: { bg: "#f0d9c0", ink: "#3a2414" }, dark: { bg: "#2a1d14", ink: "#e0b88f" } },
  winter: { light: { bg: "#e4e8ee", ink: "#1f2530" }, dark: { bg: "#171a20", ink: "#c5cbd6" } },
  default: { light: { bg: "#fbf7ef", ink: "#2b2520" }, dark: { bg: "#221f1a", ink: "#d9cfbc" } },
};

const PAPER_LABELS: Record<WhenBucket, string> = {
  morning: "Morning paper",
  evening: "Evening paper",
  night: "Midnight paper",
  weekend: "Weekend paper",
  weekday: "Weekday paper",
  spring: "Spring paper",
  summer: "Summer paper",
  autumn: "Autumn paper",
  winter: "Winter paper",
  default: "Plain paper",
};

const SATURATED = new Set<WhenBucket>(["weekend", "summer"]);

const FONTS: Record<NotebookPersonaFontTier, NotebookPersonaFonts> = {
  default: { title: "var(--serif)", body: "var(--serif)" },
  mono: { title: "var(--mono)", body: "var(--sans)" },
  handwritten: { title: "var(--handwritten)", body: "var(--serif)" },
};

const DENSITY: Record<string, NotebookPersonaDensity> = {
  cafe: { titlePx: 17, bodyPx: 13, lineHeight: 1.45, padding: 14 },
  home: { titlePx: 19, bodyPx: 14, lineHeight: 1.65, padding: 18 },
  park: { titlePx: 19, bodyPx: 14, lineHeight: 1.55, padding: 16 },
  office: { titlePx: 18, bodyPx: 13.5, lineHeight: 1.5, padding: 16 },
  default: { titlePx: 18, bodyPx: 13.5, lineHeight: 1.55, padding: 16 },
};

/**
 * Place-slug substring hints → density key. `note.location` is reverse-geocoded
 * free text ("Praha — Vinohrady", "Caffè Vinile, Rome"), slugified into our
 * auto-tag value. Rather than enumerate every place name, we lightly probe
 * for common indicators so a "cafe" or "park" vibe can adjust the density.
 */
const DENSITY_HINTS: ReadonlyArray<{ match: RegExp; key: keyof typeof DENSITY }> = [
  { match: /(cafe|caf\u00e9|kav\u00e1rna|coffee|espresso)/, key: "cafe" },
  { match: /(park|sady|n\u00e1plavka|letn\u00e1|prom[eě]nade|garden)/, key: "park" },
  { match: /(office|kancel|workplace|studio)/, key: "office" },
  { match: /(home|vinohrady|\u017ei\u017ekov|flat|byt)/, key: "home" },
];

const OPEN_TASK_PATTERN = /^\s*-\s*\[\s\]/m;

/**
 * Convenience facet extractor for the bridge from SutraPad tags (flat strings,
 * partially namespaced) to design-handoff tag classes. All values lowercased.
 */
interface TagFacets {
  /** User-typed tags (no `:` namespace). First one wins `topic`. */
  topic: string | null;
  /** `location:<slug>` — slug portion after the prefix. */
  place: string | null;
  /** `source:<slug>` — used for font-tier + voice sticker. */
  source: string | null;
  /** All user tags, lowercased — for `reading` sticker match. */
  userTags: readonly string[];
}

function splitNamespacedTag(tag: string): { prefix: string | null; value: string } {
  const colonIndex = tag.indexOf(":");
  if (colonIndex === -1) return { prefix: null, value: tag };
  return {
    prefix: tag.slice(0, colonIndex).toLowerCase(),
    value: tag.slice(colonIndex + 1).toLowerCase(),
  };
}

function extractFacets(note: SutraPadDocument, now: Date): TagFacets {
  const userTags: string[] = [];
  for (const tag of note.tags) {
    const { prefix } = splitNamespacedTag(tag);
    // Skip namespaced tags — those belong to `auto-tags`. Only bare
    // hashtag-style entries are "topic" tags.
    if (prefix === null) userTags.push(tag.toLowerCase());
  }

  let place: string | null = null;
  let source: string | null = null;
  for (const autoTag of deriveAutoTags(note, now)) {
    const { prefix, value } = splitNamespacedTag(autoTag);
    if (prefix === "location" && place === null) place = value;
    else if (prefix === "source" && source === null) source = value;
  }

  return {
    topic: userTags[0] ?? null,
    place,
    source,
    userTags,
  };
}

/**
 * Picks the single `when` bucket that best describes a note's creation.
 * Time-of-day wins when it lands in a distinctive window (night/morning/
 * evening); weekend marks the modifier-ish fallback; season fills the
 * remaining space. The priority is deliberate — a 03:00 Saturday note is a
 * "night" note first and a "weekend" note second.
 */
export function pickWhenBucket(createdAt: string): WhenBucket {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "default";

  const hour = date.getHours();
  if (hour >= 22 || hour < 5) return "night";
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 17 && hour < 22) return "evening";

  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return "weekend";

  const month = date.getMonth(); // 0..11
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "autumn";
  return "winter";
}

function pickFontTier(facets: TagFacets): NotebookPersonaFontTier {
  if (facets.source === "url-capture") return "mono";
  if (facets.source === "text-capture") return "handwritten";
  if (facets.place && /(park|sady|n\u00e1plavka|letn\u00e1)/.test(facets.place)) {
    return "handwritten";
  }
  return "default";
}

function pickDensity(place: string | null): NotebookPersonaDensity {
  if (!place) return DENSITY.default;
  for (const hint of DENSITY_HINTS) {
    if (hint.match.test(place)) return DENSITY[hint.key];
  }
  return DENSITY.default;
}

/**
 * FNV-1a 32-bit hash. Lifted from the design handoff unchanged — we need
 * identical outputs so the persona's rotation/patina choices match what the
 * designer previewed.
 */
function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function pseudoRandom01(noteId: string, salt: string): number {
  return (fnv1a(`${noteId}:${salt}`) % 10000) / 10000;
}

// Locations treated as "home base" for the `away` sticker heuristic. The
// handoff hardcoded Prague slugs against a mock dataset; a production app
// might swap this for a user-defined home base. For now the list is
// "close enough".
const PRAGUE_PLACES: readonly string[] = [
  "vinohrady",
  "\u017ei\u017ekov",
  "zizkov",
  "n\u00e1plavka",
  "naplavka",
  "kav\u00e1rna-m\u00edsto",
  "t\u0159i-oc\u00e1sci",
  "riegrovy-sady",
  "letn\u00e1",
  "letna",
  "home",
  "praha",
  "prague",
];

/**
 * Each rule below returns the sticker it would apply or `null` if the note
 * doesn't qualify. Keeping each rule tiny and independent lets the driver
 * function stay under oxlint's complexity threshold, and each rule can be
 * unit-tested in isolation.
 */

function nightOwlSticker(note: SutraPadDocument): NotebookPersonaSticker | null {
  if (!note.createdAt) return null;
  const hour = new Date(note.createdAt).getHours();
  if (Number.isNaN(hour)) return null;
  if (hour < 22 && hour > 5) return null;
  return { kind: "night-owl", label: "night owl" };
}

function oneShotSticker(note: SutraPadDocument): NotebookPersonaSticker | null {
  // Only meaningful when the note has been touched at all, i.e. both stamps
  // are present and valid.
  if (!note.createdAt || !note.updatedAt) return null;
  const createdMs = new Date(note.createdAt).getTime();
  const updatedMs = new Date(note.updatedAt).getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(updatedMs)) return null;
  const deltaMinutes = (updatedMs - createdMs) / 60_000;
  if (deltaMinutes < 0 || deltaMinutes > 10) return null;
  return { kind: "one-shot", label: "one-shot" };
}

function readingSticker(
  note: SutraPadDocument,
  facets: TagFacets,
): NotebookPersonaSticker | null {
  if (note.urls.length === 0) return null;
  if (!facets.userTags.includes("reading")) return null;
  return { kind: "reading", label: "reading" };
}

function regularSticker(
  facets: TagFacets,
  allNotes: readonly SutraPadDocument[],
  now: Date,
): NotebookPersonaSticker | null {
  if (!facets.place || allNotes.length === 0) return null;
  let placeHits = 0;
  for (const other of allNotes) {
    for (const autoTag of deriveAutoTags(other, now)) {
      const { prefix, value } = splitNamespacedTag(autoTag);
      if (prefix === "location" && value === facets.place) {
        placeHits += 1;
        break;
      }
    }
    if (placeHits >= 5) return { kind: "regular", label: "regular" };
  }
  return null;
}

function firstOfKindSticker(
  facets: TagFacets,
  allNotes: readonly SutraPadDocument[],
): NotebookPersonaSticker | null {
  if (!facets.topic || allNotes.length === 0) return null;
  let topicHits = 0;
  for (const other of allNotes) {
    if (other.tags.some((t) => t.toLowerCase() === facets.topic)) {
      topicHits += 1;
      if (topicHits > 1) return null;
    }
  }
  return topicHits === 1 ? { kind: "first-of-kind", label: "only one" } : null;
}

function toGoSticker(note: SutraPadDocument): NotebookPersonaSticker | null {
  if (!note.body || !OPEN_TASK_PATTERN.test(note.body)) return null;
  return { kind: "to-go", label: "open task" };
}

function awaySticker(facets: TagFacets): NotebookPersonaSticker | null {
  const place = facets.place;
  if (!place) return null;
  if (PRAGUE_PLACES.some((p) => place.includes(p))) return null;
  return { kind: "away", label: "away" };
}

function voiceSticker(facets: TagFacets): NotebookPersonaSticker | null {
  // We treat "text-capture" (iOS shortcut text share) as voice-like; url
  // captures never get this sticker. This intentionally keeps the visual
  // language of the handoff even though SutraPad's capture pipeline uses
  // a different naming.
  if (facets.source !== "text-capture") return null;
  return { kind: "voice", label: "voice memo" };
}

function computeStickers(
  note: SutraPadDocument,
  facets: TagFacets,
  allNotes: readonly SutraPadDocument[],
  now: Date,
): NotebookPersonaSticker[] {
  const candidates = [
    nightOwlSticker(note),
    oneShotSticker(note),
    readingSticker(note, facets),
    regularSticker(facets, allNotes, now),
    firstOfKindSticker(facets, allNotes),
    toGoSticker(note),
    awaySticker(facets),
    voiceSticker(facets),
  ];
  const stickers: NotebookPersonaSticker[] = [];
  for (const sticker of candidates) {
    if (sticker !== null) stickers.push(sticker);
    if (stickers.length >= 3) break;
  }
  return stickers;
}

function computeWear(note: SutraPadDocument, now: Date): number {
  const createdMs = new Date(note.createdAt).getTime();
  const ageMs = Number.isFinite(createdMs) ? now.getTime() - createdMs : 0;
  const ageDays = ageMs > 0 ? ageMs / (1000 * 60 * 60 * 24) : 0;
  const ageWear = Math.min(1, ageDays / 180);

  // The handoff's `editCount` is a mock (each hour of span = one edit). We
  // don't track revision count today; a monotonically-non-decreasing value
  // based on update span keeps the wear gradient sensible without lying
  // about real edit history. Tasks should read this as "time-lived-in", not
  // "number of revisions".
  const updatedMs = new Date(note.updatedAt).getTime();
  const spanHours =
    Number.isFinite(createdMs) && Number.isFinite(updatedMs)
      ? Math.max(0, (updatedMs - createdMs) / (1000 * 60 * 60))
      : 0;
  const editWear = Math.min(1, spanHours / 80); // ~80h of activity = fully worn

  const jitter = pseudoRandom01(note.id, "wear") * 0.15;
  return Math.min(1, ageWear * 0.6 + editWear * 0.4 + jitter);
}

interface PatinaContext {
  note: SutraPadDocument;
  facets: TagFacets;
  fontTier: NotebookPersonaFontTier;
  wear: number;
  /** True when the `when` bucket is weekend/summer — boosts washi probability. */
  saturated: boolean;
  now: Date;
}

function computePatina(ctx: PatinaContext): NotebookPersonaPatina[] {
  const { note, facets, fontTier, wear, saturated, now } = ctx;
  const patina: NotebookPersonaPatina[] = [];

  // coffee-ring: stale (>7 days since update) AND still has an open task
  if (note.updatedAt) {
    const updatedMs = new Date(note.updatedAt).getTime();
    if (Number.isFinite(updatedMs)) {
      const daysSinceUpdate = (now.getTime() - updatedMs) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate > 7 && OPEN_TASK_PATTERN.test(note.body ?? "")) {
        patina.push("coffee-ring");
      }
    }
  }

  // folded-corner: probability scales with wear
  if (pseudoRandom01(note.id, "corner") < 0.3 + wear * 0.4) {
    patina.push("folded-corner");
  }

  // pencil-marks: handwritten-tier notes pick these up as they age
  if (
    fontTier === "handwritten" &&
    pseudoRandom01(note.id, "pencil") < 0.3 + wear * 0.5
  ) {
    patina.push("pencil-marks");
  }

  // highlight: gets applied to specific declarative topics
  const { topic } = facets;
  if (topic && ["manifesto", "poetry", "craft"].includes(topic)) {
    if (pseudoRandom01(note.id, "highlight") > 0.4) patina.push("highlight");
  }

  // washi: low-probability decorative tape; weekend/summer notes get a boost
  if (pseudoRandom01(note.id, "washi") < 0.18 + (saturated ? 0.1 : 0)) {
    patina.push("washi");
  }

  // date-stamp: library vibe for reference/reading topics
  if (
    topic &&
    ["reading", "research", "philosophy", "writing"].includes(topic) &&
    pseudoRandom01(note.id, "stamp") < 0.35
  ) {
    patina.push("date-stamp");
  }

  // pin: keep-visible signal for actionable notes
  if (
    OPEN_TASK_PATTERN.test(note.body ?? "") &&
    pseudoRandom01(note.id, "pin") < 0.22
  ) {
    patina.push("pin");
  }

  return patina.slice(0, 3);
}

/**
 * Builds a notebook persona for `note`. Returns the full shape in a single
 * call so callers don't have to branch on which facets they need — rendering
 * a persona-styled card consumes nearly every field.
 *
 * Callers that want to respect the user's "persona on/off" preference should
 * gate at the call site rather than inside this function: keeping the module
 * preference-free means tests can derive a persona for any note without
 * wiring up stored state.
 */
export function deriveNotebookPersona(
  note: SutraPadDocument,
  options: NotebookPersonaOptions = {},
): NotebookPersona {
  const { allNotes = [], dark = false, now = new Date() } = options;
  const facets = extractFacets(note, now);
  const whenBucket = pickWhenBucket(note.createdAt);
  const paperVariant = PAPERS[whenBucket] ?? PAPERS.default;
  const paper = paperVariant[dark ? "dark" : "light"];
  const paperName = PAPER_LABELS[whenBucket];
  const saturated = SATURATED.has(whenBucket);

  const fontTier = pickFontTier(facets);
  const fonts = FONTS[fontTier];

  const density = pickDensity(facets.place);
  const rotation = (pseudoRandom01(note.id, "rot") - 0.5) * 1.6;
  const wear = computeWear(note, now);
  const stickers = computeStickers(note, facets, allNotes, now);
  const patina = computePatina({ note, facets, fontTier, wear, saturated, now });

  let accent: string | null = null;
  if (saturated) accent = dark ? "#e89a5a" : "#c46a3a";
  else if (whenBucket === "night") accent = dark ? "#8a96b6" : "#6c7896";
  else if (whenBucket === "spring") accent = dark ? "#a8bf8c" : "#7a9260";

  const notebookName = facets.topic
    ? `${facets.topic[0].toUpperCase()}${facets.topic.slice(1)} notebook`
    : paperName;

  return {
    paper,
    paperName,
    notebookName,
    accent,
    fonts,
    fontTier,
    density,
    rotation,
    wear,
    stickers,
    patina,
  };
}
