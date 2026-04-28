export interface SutraPadCoordinates {
  latitude: number;
  longitude: number;
}

export type SutraPadCaptureSource = "new-note" | "text-capture" | "url-capture";

export interface SutraPadCapturePageMetadata {
  title?: string;
  lang?: string;
  description?: string;
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  author?: string;
  publishedTime?: string;
}

export interface SutraPadCaptureScreenSnapshot {
  viewportWidth?: number;
  viewportHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
  pixelRatio?: number;
  orientation?: string;
}

export interface SutraPadCaptureScrollSnapshot {
  x?: number;
  y?: number;
  progress?: number;
}

export interface SutraPadCaptureNetworkSnapshot {
  online?: boolean;
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
}

export interface SutraPadCaptureBatterySnapshot {
  levelPercent?: number;
  charging?: boolean;
}

export interface SutraPadCaptureWeatherSnapshot {
  temperatureC?: number;
  weatherCode?: number;
  windSpeedKmh?: number;
  isDay?: boolean;
  source: "open-meteo";
}

export interface SutraPadCaptureExperimentalSnapshot {
  ambientLightLux?: number;
}

export interface SutraPadCaptureContext {
  source: SutraPadCaptureSource;
  timezone?: string;
  timezoneOffsetMinutes?: number;
  locale?: string;
  languages?: string[];
  referrer?: string;
  deviceType?: "mobile" | "tablet" | "desktop";
  os?: string;
  browser?: string;
  screen?: SutraPadCaptureScreenSnapshot;
  scroll?: SutraPadCaptureScrollSnapshot;
  timeOnPageMs?: number;
  page?: SutraPadCapturePageMetadata;
  network?: SutraPadCaptureNetworkSnapshot;
  battery?: SutraPadCaptureBatterySnapshot;
  weather?: SutraPadCaptureWeatherSnapshot;
  experimental?: SutraPadCaptureExperimentalSnapshot;
}

export interface SutraPadDocument {
  id: string;
  title: string;
  body: string;
  urls: string[];
  captureContext?: SutraPadCaptureContext;
  location?: string;
  coordinates?: SutraPadCoordinates;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface SutraPadNoteSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  fileId?: string;
}

export interface SutraPadIndex {
  version: 1;
  updatedAt: string;
  savedAt: string;
  previousIndexId?: string;
  activeNoteId: string | null;
  notes: SutraPadNoteSummary[];
}

export interface SutraPadHead {
  version: 1;
  activeIndexId: string;
  savedAt: string;
}

/**
 * Distinguishes hand-curated tags (typed by the user or lifted from `#hashtag`
 * in the body) from tags derived automatically from a note's metadata
 * (`createdAt`, `captureContext`, `urls`, …). Kept as a discriminated field
 * on `SutraPadTagEntry` so the filter UI can style the two kinds differently
 * without a parallel type hierarchy.
 */
export type SutraPadTagKind = "user" | "auto";

export interface SutraPadTagEntry {
  tag: string;
  noteIds: string[];
  count: number;
  /**
   * Optional on the base type for backwards compatibility with persisted
   * indexes written before auto-tags existed. Readers should treat a missing
   * `kind` as `"user"` — which is what `buildTagIndex` produced exclusively.
   */
  kind?: SutraPadTagKind;
}

/**
 * Tag-index file as written to the user's Drive workspace folder.
 *
 * **Drive copy is write-only.** The app NEVER deserialises this file
 * back from Drive — every consumer rebuilds the live tag index in
 * memory via `buildTagIndex` / `buildCombinedTagIndex` (`lib/notebook.ts`)
 * against `workspace.notes`. The Drive copy exists for two reasons
 * only: (a) external tooling that wants a pre-aggregated snapshot
 * without paying the cost of fetching every note file, and (b)
 * forensic / recovery scenarios.
 *
 * Because `appendNoteToWorkspace` (silent capture) intentionally
 * skips re-writing this file to keep round-trips down, the Drive
 * copy can drift behind the workspace by N captures. The same
 * applies to the main `SutraPadIndex` since the silent path stopped
 * touching it — `loadWorkspace` is now folder-query-driven, so the
 * index is consulted only for the `activeNoteId` hint and orphan
 * note files (created by silent capture but absent from the index)
 * are picked up directly from the folder. Drift heals on the next
 * interactive `saveWorkspace`. Any future stats / sync feature that
 * wants live tag data MUST go through `buildTagIndex` against the
 * in-memory workspace, not `fetchJsonFile<SutraPadTagIndex>`.
 */
export interface SutraPadTagIndex {
  version: 1;
  savedAt: string;
  tags: SutraPadTagEntry[];
}

/**
 * How multi-tag filtering combines the selected tags. `all` requires every
 * tag to be present on a note (intersection); `any` matches notes that
 * carry at least one of the selected tags (union). `all` is the historical
 * default and stays the default when the URL parameter is absent.
 */
export type SutraPadTagFilterMode = "all" | "any";

export interface SutraPadLinkEntry {
  url: string;
  noteIds: string[];
  count: number;
  latestUpdatedAt: string;
}

/**
 * Link-index file as written to Drive. **Write-only on Drive** — see
 * `SutraPadTagIndex` doc for the full rationale. Live link aggregation
 * comes from `buildLinkIndex` (`lib/notebook.ts`) against
 * `workspace.notes`; the Drive copy can drift behind the workspace
 * between full saves.
 */
export interface SutraPadLinkIndex {
  version: 1;
  savedAt: string;
  links: SutraPadLinkEntry[];
}

/**
 * A single checkbox-style task extracted from a note's body. Tasks are parsed
 * from lines that start (after optional whitespace and an optional `-`) with
 * `[ ]`, `[]`, `[x]`, or `[X]`. The `lineIndex` pins the task to a specific
 * line so toggling can rewrite the bracket in place without relying on the
 * task text (which may repeat within a note).
 */
export interface SutraPadTaskEntry {
  noteId: string;
  lineIndex: number;
  text: string;
  done: boolean;
  noteUpdatedAt: string;
}

/**
 * Task-index file as written to Drive. **Write-only on Drive** — see
 * `SutraPadTagIndex` doc for the full rationale. Live task aggregation
 * comes from `buildTaskIndex` (`lib/tasks.ts`) against
 * `workspace.notes`; the Drive copy can drift behind the workspace
 * between full saves.
 */
export interface SutraPadTaskIndex {
  version: 1;
  savedAt: string;
  tasks: SutraPadTaskEntry[];
}

export interface SutraPadWorkspace {
  notes: SutraPadDocument[];
  activeNoteId: string | null;
}

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
}

export interface DriveFileRecord {
  id: string;
  name: string;
  mimeType?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
}
