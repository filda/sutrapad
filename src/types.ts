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

/**
 * Best-effort environment sensor readings taken at capture time inside the
 * SutraPad app (never the bookmarklet — these describe where the *user* is,
 * not the source page).
 *
 * Both fields are sensor- and permission-gated, so they are frequently
 * absent: `motionStatus` only populates where the device exposes the
 * accelerometer (`DeviceMotion` / Generic Sensor) and, on iOS, only after the
 * motion permission has been granted; `noiseLevelDb` only populates when the
 * microphone permission is *already* granted (capture never raises a prompt
 * on its own — see `resolveNoiseSnapshot`). A note with neither sensor
 * available carries no `sensors` snapshot at all, exactly like
 * `experimental`.
 */
export interface SutraPadCaptureSensorsSnapshot {
  /**
   * Coarse movement classification derived from the variance of the
   * accelerometer magnitude over a short sampling window: `"still"` when the
   * device was at rest, `"moving"` when it was being carried/walked. Only two
   * buckets — finer gradations aren't reliable from a sub-second sample.
   */
  motionStatus?: "still" | "moving";
  /**
   * Ambient loudness as an *uncalibrated* dBFS value (decibels relative to
   * full scale), computed from the RMS of a short microphone waveform sample.
   * Always ≤ 0; quieter rooms sit further negative (roughly −60…−40),
   * louder environments approach 0. This is a relative indicator, not a
   * calibrated SPL (dB-A) measurement — browsers expose no absolute level.
   */
  noiseLevelDb?: number;
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
  sensors?: SutraPadCaptureSensorsSnapshot;
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
  /**
   * `false` marks a body-less placeholder (Phase 2 notes-scaling): `loadWorkspace`
   * populates `workspace.notes` from `sutrapad-index.json` summaries without
   * fetching bodies, so most resident notes start as a placeholder with
   * `body: ""` and this flag set. Absent or `true` means the document's `body`
   * is real and safe to read/edit/persist — every note constructed in-memory
   * (new note, capture, import, drag-drop) is hydrated from the moment it's
   * created and never sets this field.
   *
   * `upsertNote` refuses to commit an edit against a placeholder (see its
   * guard) — this is the load-bearing half of the data-loss safety invariant:
   * a body-less placeholder must never overwrite a real note file on Drive.
   * The other half is hydrating on detail-open before any edit UI is enabled
   * (see `src/app/logic/note-hydration.ts`).
   */
  hydrated?: boolean;
  /**
   * Drive file id, carried on a placeholder (see `hydrated`) so the
   * hydrate-on-open lifecycle (`src/app/lifecycle/hydrate-note-on-open.ts`)
   * knows what to fetch without a separate lookup into the resident
   * summary model. Undefined for a note that has never round-tripped
   * through the Drive index (a brand-new draft, or a pre-Phase-2 index
   * entry the maintenance rebuild hasn't backfilled yet) — hydration has
   * nothing to fetch in that case and leaves the note alone.
   */
  fileId?: string;
}

export interface SutraPadNoteSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  fileId?: string;
  /**
   * Card metadata precomputed at save time (Phase 2) so the Notes list can
   * render from the index without hydrating every note body. All optional for
   * back-compat with indexes written before Phase 2 — a maintenance rebuild
   * backfills them. Shape mirrors `NoteCardMeta` in `lib/note-card-meta.ts`.
   */
  headline?: string;
  excerpt?: string;
  tags?: string[];
  location?: string;
  tasks?: { open: number; done: number };
  /**
   * Card-render metadata beyond the text blurb (Phase 2 resident model). The
   * Notes grid needs these to draw the og:image thumb (primary URL derives
   * from `captureContext.page.canonicalUrl` / `urls`) and the persona layer
   * (place / source facets come from `captureContext` + `location`). Carried
   * on the summary so the list renders without hydrating the body — only the
   * body itself stays lazy. Optional for back-compat with pre-Phase-2 indexes.
   */
  urls?: string[];
  captureContext?: SutraPadCaptureContext;
  /**
   * Auto-tags derived from the note at build time (`deriveAutoTags`). Stored so
   * the persona layer's place / source facets + the `regular` recurrence
   * sticker read from here instead of re-deriving per card (which needs the
   * body-scan task count and was O(N²) across the list). Optional for
   * back-compat with pre-Phase-2 indexes.
   */
  autoTags?: string[];
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

/**
 * Cross-device, user-level preferences synced via Google Drive.
 *
 * Lives in a dedicated `sutrapad-preferences.json` file in the SutraPad
 * folder rather than inside the workspace or head, so additions here
 * don't have to ride the workspace save path (which is hot and
 * note-shaped) and so preferences round-trip independently of the
 * note inventory.
 *
 * Currently the only field is `dismissedTagAliases` — the pair keys
 * the user has explicitly marked "Keep separate" on the Settings → Tag
 * hygiene card. Listed sorted on write so the on-disk form is stable
 * across toggles.
 *
 * Conflict policy is last-write-wins, matching the workspace: the
 * Drive copy is the source of truth on load. Local localStorage stays
 * as an offline cache.
 */
export interface SutraPadPreferences {
  version: 1;
  savedAt: string;
  dismissedTagAliases: string[];
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
  /**
   * Drive-server-stamped revision time (ISO-8601). Returned by
   * `findFiles` for every artifact so the progressive refresh can
   * sort the inventory by recency without a per-file metadata
   * fetch. Optional because callers that only need id / name (folder
   * lookups, ensure-in-folder reparenting) don't have to thread it
   * through.
   */
  modifiedTime?: string;
  appProperties?: Record<string, string>;
  parents?: string[];
}
