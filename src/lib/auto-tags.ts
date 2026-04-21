import type { SutraPadDocument } from "../types";
import { countTasksInNote } from "./tasks";

/**
 * Automatic tags are derived from the metadata a note already carries —
 * `captureContext`, `createdAt`, `location`, `urls`, etc. They complement the
 * hand-curated `note.tags` (which stay the source of truth for user intent)
 * and let users slice their notebook by facets they never had to type out:
 * "notes I took on mobile", "notes from yesterday", "notes where I was
 * offline".
 *
 * Design rules this module adheres to:
 *
 *   - **Namespaced**. Every auto-tag has the shape `<facet>:<value>`, e.g.
 *     `device:mobile`, `date:today`, `location:prague`. The prefix prevents
 *     collisions with user tags (a user typing `#mobile` still wins its own
 *     chip) and makes the source obvious in the UI.
 *   - **Pure + deterministic**. Given the same note (and the same "now"), the
 *     output is identical — which lets the tag index and the filter panel
 *     recompute freely on every render without memoisation.
 *   - **Lowercased + deduped**. Tags are lowercased and returned in a stable
 *     order (category-by-category below) with duplicates stripped.
 *   - **Graceful on missing data**. Every field inside `captureContext` is
 *     optional; we only emit a tag when the underlying value is present and
 *     usable. Notes with no capture context at all (hand-typed on the home
 *     page) still pick up `date:*` and `source:*` tags.
 *
 * The `now` parameter is injectable so tests can pin "today" without mocking
 * globals; callers in the app pass `new Date()`.
 */
export function deriveAutoTags(
  note: SutraPadDocument,
  now: Date = new Date(),
): string[] {
  const tags = new Set<string>();

  addDateTags(tags, note, now);
  addEditTag(tags, note);
  addSourceTag(tags, note);
  addDeviceTags(tags, note);
  addOrientationTags(tags, note);
  addLanguageTags(tags, note);
  addLocationTags(tags, note);
  addAuthorTag(tags, note);
  addNetworkTags(tags, note);
  addWeatherTags(tags, note);
  addBatteryTags(tags, note);
  addScrollTags(tags, note);
  addEngagementTags(tags, note);
  addTaskTags(tags, note);
  // Domains are intentionally *not* emitted as auto-tags: the Links page
  // already gives every saved URL its own first-class row, so a `domain:*`
  // chip in the tag cloud would just be a second, less-informative UI for
  // the same axis.

  return [...tags];
}

function addDateTags(
  tags: Set<string>,
  note: SutraPadDocument,
  now: Date,
): void {
  const created = new Date(note.createdAt);
  if (Number.isNaN(created.getTime())) return;

  const createdDay = startOfUtcDay(created);
  const today = startOfUtcDay(now);
  const dayDeltaMs = today.getTime() - createdDay.getTime();
  const dayDelta = Math.round(dayDeltaMs / MS_PER_DAY);

  if (dayDelta === 0) tags.add("date:today");
  else if (dayDelta === 1) tags.add("date:yesterday");

  // "This week" is the rolling last 7 days — a simpler, more intuitive rule
  // than ISO week boundaries (which confuse users whose week starts Monday
  // when the calendar still says Sunday).
  if (dayDelta >= 0 && dayDelta < 7) tags.add("date:this-week");
  if (dayDelta >= 0 && dayDelta < 30) tags.add("date:this-month");

  const year = created.getUTCFullYear();
  const month = `${year}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`;
  tags.add(`year:${year}`);
  tags.add(`month:${month}`);
}

/**
 * Splits the notebook into two piles: notes the user has revisited at least
 * once (`edit:revised`) versus one-shot captures that still read exactly as
 * written (`edit:fresh`). Useful as a filter — "show me the notes I've been
 * iterating on" pairs well with the Tasks page and reveals which captures
 * actually got follow-up.
 *
 * The rule is a strict inequality on the stored timestamps; even a same-second
 * save of a re-opened note writes a new `updatedAt`. Malformed timestamps
 * (either field unparseable) skip the facet entirely rather than fall back
 * to an arbitrary default.
 */
function addEditTag(tags: Set<string>, note: SutraPadDocument): void {
  const created = new Date(note.createdAt).getTime();
  const updated = new Date(note.updatedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return;

  tags.add(updated > created ? "edit:revised" : "edit:fresh");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addSourceTag(tags: Set<string>, note: SutraPadDocument): void {
  const source = note.captureContext?.source;
  if (source) tags.add(`source:${source}`);
}

function addDeviceTags(tags: Set<string>, note: SutraPadDocument): void {
  const context = note.captureContext;
  if (!context) return;

  if (context.deviceType) tags.add(`device:${context.deviceType}`);
  if (context.os) tags.add(`os:${slugifyTagValue(context.os)}`);
  if (context.browser) tags.add(`browser:${slugifyTagValue(context.browser)}`);
}

/**
 * Reads `screen.orientation` (values like `portrait-primary`, `landscape`,
 * `portrait`, `landscape-secondary` as surfaced by the Screen Orientation
 * API). We collapse the `-primary`/`-secondary` suffix and only distinguish
 * the two buckets that actually read differently — a user captures on a
 * phone flipped landscape, or they don't; whether it's primary-landscape or
 * secondary-landscape doesn't matter for filtering.
 */
function addOrientationTags(tags: Set<string>, note: SutraPadDocument): void {
  const orientation = note.captureContext?.screen?.orientation;
  if (typeof orientation !== "string") return;

  const lower = orientation.toLowerCase();
  if (lower.includes("portrait")) tags.add("orientation:portrait");
  else if (lower.includes("landscape")) tags.add("orientation:landscape");
}

function addLanguageTags(tags: Set<string>, note: SutraPadDocument): void {
  const context = note.captureContext;
  if (!context) return;

  // The captured page's declared language beats the device locale — it's
  // what the text was actually written in, which is what a "lang:" tag
  // should mean for filtering.
  const pageLang = context.page?.lang;
  const deviceLang = context.languages?.[0] ?? context.locale;
  const primary = pageLang ?? deviceLang;
  if (primary) tags.add(`lang:${extractLanguageCode(primary)}`);
}

function extractLanguageCode(tag: string): string {
  // `cs-CZ`, `en-US`, `pt-BR` → `cs`, `en`, `pt`. We only emit the primary
  // subtag so notes in the same language don't fragment across regional
  // variants (`lang:en-US` vs `lang:en-GB`).
  return tag.toLowerCase().split(/[-_]/)[0];
}

/**
 * Emits `author:<slug>` when the captured page advertised an author in its
 * meta tags or OG data. Slugifying preserves Unicode (so Czech diacritics
 * survive) and collapses whitespace/punctuation to hyphens, which keeps the
 * URL filter `?tags=author:jan-novak` readable and copy-pastable.
 *
 * Pages without an author (most content still ships that way) skip this
 * facet entirely — no noisy `author:unknown` chip.
 */
function addAuthorTag(tags: Set<string>, note: SutraPadDocument): void {
  const author = note.captureContext?.page?.author;
  if (!author) return;

  const slug = slugifyTagValue(author);
  if (slug) tags.add(`author:${slug}`);
}

function addLocationTags(tags: Set<string>, note: SutraPadDocument): void {
  if (!note.location) return;
  // `note.location` is a human-readable label from reverse geocoding
  // ("Prague, Czechia"). Using the whole string as the tag value keeps the
  // chip recognisable; slugifying collapses whitespace/diacritics/commas so
  // URL encoding stays tidy.
  const slug = slugifyTagValue(note.location);
  if (slug) tags.add(`location:${slug}`);
}

function addNetworkTags(tags: Set<string>, note: SutraPadDocument): void {
  const network = note.captureContext?.network;
  if (!network) return;

  if (network.online === true) tags.add("network:online");
  if (network.online === false) tags.add("network:offline");
  if (network.effectiveType) {
    tags.add(`network:${slugifyTagValue(network.effectiveType)}`);
  }
  if (network.saveData === true) tags.add("network:save-data");
}

function addWeatherTags(tags: Set<string>, note: SutraPadDocument): void {
  const weather = note.captureContext?.weather;
  if (!weather) return;

  if (weather.isDay === true) tags.add("weather:day");
  if (weather.isDay === false) tags.add("weather:night");

  // Thresholds chosen for human intuition rather than meteorological
  // precision: 20 °C is "warm enough for a T-shirt", 5 °C is "coat weather".
  // The `cool` bucket fills the gap so every measured temperature lands in
  // exactly one bucket.
  if (typeof weather.temperatureC === "number") {
    if (weather.temperatureC >= 20) tags.add("weather:warm");
    else if (weather.temperatureC >= 5) tags.add("weather:cool");
    else tags.add("weather:cold");
  }

  if (typeof weather.windSpeedKmh === "number" && weather.windSpeedKmh >= 25) {
    tags.add("weather:windy");
  }

  const condition = mapWmoCodeToCondition(weather.weatherCode);
  if (condition) tags.add(`weather:${condition}`);
}

/**
 * Collapses Open-Meteo's WMO weather codes into the six human-scale buckets
 * we expose as auto-tags. The full WMO table is granular (drizzle vs. rain
 * vs. rain-showers, and again in a freezing variant, and again for snow),
 * but for filtering ("what was it doing outside when I captured this?") the
 * coarse grouping reads better and avoids fragmenting the tag cloud into
 * dozens of weather chips.
 *
 * Reference: https://open-meteo.com/en/docs#weathervariables
 *   0       → clear sky
 *   1–3     → mainly clear / partly cloudy / overcast
 *   45, 48  → fog (incl. depositing rime fog)
 *   51–67   → drizzle / freezing drizzle / rain / freezing rain
 *   71–77   → snow fall / snow grains
 *   80–82   → rain showers
 *   85, 86  → snow showers
 *   95–99   → thunderstorm (with or without hail)
 */
function mapWmoCodeToCondition(code: number | undefined): string | null {
  if (typeof code !== "number") return null;
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return null;
}

function addBatteryTags(tags: Set<string>, note: SutraPadDocument): void {
  const battery = note.captureContext?.battery;
  if (!battery) return;

  if (battery.charging === true) tags.add("battery:charging");
  if (typeof battery.levelPercent === "number" && battery.levelPercent <= 20) {
    tags.add("battery:low");
  }
}

function addScrollTags(tags: Set<string>, note: SutraPadDocument): void {
  const scroll = note.captureContext?.scroll;
  if (!scroll || typeof scroll.progress !== "number") return;

  // `progress` is 0..1 of how far down the source page the user had scrolled
  // when they captured. Splitting into thirds keeps the filter meaningful
  // (skimmed vs. read through) without over-fragmenting.
  if (scroll.progress < 0.1) tags.add("scroll:top");
  else if (scroll.progress > 0.8) tags.add("scroll:bottom");
  else tags.add("scroll:middle");
}

/**
 * Buckets `timeOnPageMs` (how long the user was on the source page before
 * capturing) into three human-scale intervals:
 *   - `skimmed`:   < 30 s     — quick grab, usually a fact or quote
 *   - `read`:      30 s–5 min — a real read
 *   - `deep-dive`: > 5 min    — long-form article, documentation, thread
 *
 * Notes captured directly in SutraPad (no source page) have no `timeOnPageMs`
 * at all and skip this facet — it's only meaningful for url-capture.
 */
function addEngagementTags(tags: Set<string>, note: SutraPadDocument): void {
  const ms = note.captureContext?.timeOnPageMs;
  if (typeof ms !== "number" || ms < 0) return;

  if (ms < 30_000) tags.add("engagement:skimmed");
  else if (ms < 300_000) tags.add("engagement:read");
  else tags.add("engagement:deep-dive");
}

/**
 * Summarises a note's checkbox state as a single facet:
 *   - `tasks:none` — no `[ ]`/`[x]` lines at all (pure prose)
 *   - `tasks:open` — at least one unchecked task (work outstanding)
 *   - `tasks:done` — every task in the note is checked off
 *
 * "All tasks done" is a useful filter in its own right (a finished
 * checklist), distinct from a note that never had tasks; that's why we
 * emit three values rather than a boolean `has-tasks` flag.
 */
function addTaskTags(tags: Set<string>, note: SutraPadDocument): void {
  const { open, done } = countTasksInNote(note);
  if (open === 0 && done === 0) tags.add("tasks:none");
  else if (open === 0) tags.add("tasks:done");
  else tags.add("tasks:open");
}

/**
 * Lowercases + slugifies a free-form string so it can safely appear as the
 * value half of an auto-tag. Preserves Unicode letters and numbers (so
 * Czech/Japanese location labels survive), collapses every other character
 * to a single `-`, and trims leading/trailing separators.
 */
function slugifyTagValue(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
