/**
 * Non-functional budgets — the one place every limit on request counts,
 * fan-out concurrency, data-integrity thresholds and resident-memory shape
 * lives. Imported by the app (runtime guards in `saveWorkspace`, the
 * prewarm cap, cache sizes) and by `tests/nfr/**` (the property tests that
 * assert the same numbers against a synthetic workspace), so a budget change
 * is a one-line diff reviewed like a Stryker threshold.
 *
 * Every value carries the failure it exists to prevent. Most of them were
 * written after the 2026-09-07 incident, when a placeholder-as-empty-draft
 * bug collapsed the Drive index to 879 of ~6 470 notes and the resulting
 * re-upload storm hit `net::ERR_INSUFFICIENT_RESOURCES`, Drive 403s and a
 * third-party proxy's rate limit within one evening — none of which a
 * functional test can see. See `docs/nfr-testing-plan.md`.
 *
 * Pure data: excluded from mutation testing (`stryker.config.mjs`), because
 * a mutant that turns 48 into 49 is not a bug anyone can assert against.
 * The *logic* that consumes these values is in scope and must be tested
 * against them.
 */

// ---------------------------------------------------------------------------
// Drive fan-out
// ---------------------------------------------------------------------------

/**
 * Max concurrent note-body fetches when `loadWorkspace` / `rebuildIndexes`
 * hydrate note files. Firing one request per note at once (Promise.all over
 * the whole folder) exhausts the browser's socket/memory budget on large
 * workspaces — thousands of parallel fetches surface as
 * `net::ERR_INSUFFICIENT_RESOURCES`.
 */
export const DRIVE_FETCH_CONCURRENCY = 24;

/**
 * Max concurrent note-file writes during `saveWorkspace`. Same failure mode
 * as `DRIVE_FETCH_CONCURRENCY`, on the upload side, and lower because writes
 * are what Drive's per-user quota meters most aggressively (a burst answers
 * 403 for every request past the limit).
 */
export const DRIVE_UPLOAD_CONCURRENCY = 8;

/**
 * Drive requests a cold `loadWorkspace` may make on a fully indexed
 * workspace: folder lookup, folder inventory, head lookup, head body, index
 * metadata, index body. Nothing per note — the whole point of the lazy-body
 * model, and the number that turns into thousands the moment the index
 * drifts from the folder. Asserted by `tests/nfr`; not enforced at runtime
 * (a drifted load *should* pay to recover, once).
 */
export const LOAD_MAX_REQUESTS = 6;

/**
 * Note uploads a single interactive save is expected to stay under. A
 * keystroke-driven autosave writes the notes the user just edited — one, or a
 * handful after a paste-and-tag session — never a slice of the workspace.
 * Crossing this means the index has drifted from the folder (every drifted
 * note misses the `updatedAt` short-circuit) and the save is about to do the
 * work of a rebuild by accident. Soft budget: reported, not enforced, because
 * a legitimate recovery save after an index rebuild can exceed it.
 */
export const SAVE_MAX_NOTE_UPLOADS_INTERACTIVE = 50;

// ---------------------------------------------------------------------------
// Data integrity
// ---------------------------------------------------------------------------

/**
 * Fraction of the existing index a single save may drop before it is
 * suspicious. Deleting a note removes one entry out of thousands; losing
 * more than this in one write has, so far, only ever meant a bug (the
 * placeholder-as-empty-draft strip). Soft budget for now — reported, not
 * refused — until the question "is there a legitimate mass delete?" is
 * settled (`docs/nfr-testing-plan.md`, open decision).
 */
export const INDEX_MAX_SHRINK_RATIO = 0.05;

/**
 * How many notes one interactive save may turn from "has content" (the
 * existing index summary carries an excerpt) into an empty body before the
 * save is refused outright. A user can empty a note — select all, delete —
 * and that must save. A user cannot empty several notes inside one 2-second
 * autosave window; that shape is a body-less copy overwriting real files,
 * the one unrecoverable failure mode of the lazy-body model. Hard budget.
 */
export const SAVE_MAX_BLANKED_NOTES_INTERACTIVE = 3;

/**
 * Number of index snapshots kept in the workspace folder (the active one
 * plus the most recent stale ones). Each snapshot is a full copy of the
 * index, so this bounds Drive usage.
 */
export const INDEX_MAX_SNAPSHOTS = 10;

/**
 * Minimum age of the oldest snapshot that retention must keep, in
 * addition to the count-based window. Eight saves in two minutes (the
 * incident) rotated every snapshot older than those two minutes out of a
 * count-only window, and with them the only recovery point — "point head
 * back at yesterday's index" stopped being possible right when it was
 * needed. Retention now always keeps the newest snapshot that is at least
 * this old.
 */
export const INDEX_SNAPSHOT_MIN_AGE_KEPT_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Third-party fan-out (og:image proxy)
// ---------------------------------------------------------------------------

/**
 * Distinct URLs one og:image prewarm resolves — roughly two screens of URL
 * cards on the Notes / Links grids, the only region a prewarm can make
 * visibly faster. A ~6 500-note workspace holds well over a thousand
 * distinct URLs; resolving them all on every load blew through the proxy's
 * rate limit (HTTP 429 on every card).
 */
export const PREWARM_MAX_URLS = 48;

/**
 * Simultaneous proxy fetches during prewarm. Small enough to stay polite on
 * a free proxy, large enough to drain the capped plan in a couple of
 * seconds.
 */
export const PREWARM_CONCURRENCY = 4;

/**
 * Entries kept in the og:image localStorage cache. Permanent entries in an
 * unbounded cache eventually tip over the 5–10 MiB localStorage quota and
 * every write starts throwing. Sized for a few hundred captured links.
 */
export const OG_IMAGE_CACHE_MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Timeline entries the Home page renders. Home is "what happened lately",
 * not the archive — the Notes page is. Unbounded, the timeline rendered
 * every note in the workspace: ~38 000 DOM elements and 3–4 s per render at
 * 6 470 notes (Diagnostics card, 2026-09-13), on every keystroke-driven
 * repaint.
 */
export const HOME_TIMELINE_MAX_ITEMS = 40;

/**
 * DOM elements one full `renderAppPage` may produce for any page at
 * workspace scale. Every list that can grow with the notebook must page
 * (endless scroll) or cap; this is the number `tests/nfr` holds each page
 * to. Sized from the paged Notes list (~1 200 elements at 60 cards) with
 * headroom for the Tasks page, which renders every open task.
 */
export const RENDER_MAX_ELEMENTS = 6000;

/**
 * Tag pairs `suggestTagAliases` may run the fuzzy matcher over, per
 * distinct user tag. Tag hygiene runs inside the render pass (Settings
 * card, home hint banner), so its cost is render cost — and it scales with
 * the tag space, not the note count.
 *
 * The all-pairs loop this replaced compared `(T - 1) / 2` pairs per tag:
 * 3.8 s at 1 900 tags, 11 s at 3 500, which was the whole of the 20.1 s of
 * `settings` DOM build in the 2026-09-14 Diagnostics card. Blocking on the
 * deletion neighbourhood brings it to ~5 per tag at 4 000. The budget is
 * loose because the ratio drifts with how alike the tags are; what it
 * catches is a return to comparing everything with everything.
 */
export const TAG_HYGIENE_MAX_PAIRS_PER_TAG = 25;

/** Tag count {@link TAG_HYGIENE_MAX_PAIRS_PER_TAG} is measured at. */
export const TAG_HYGIENE_REFERENCE_TAGS = 4000;

// ---------------------------------------------------------------------------
// Resident memory
// ---------------------------------------------------------------------------

/**
 * Resident note bodies kept by the LRU cache the detail view hydrates into.
 * Small on purpose: detail viewing is one-at-a-time, and this — not the
 * note count — is what bounds heap growth from bodies.
 */
export const NOTE_BODY_CACHE_CAPACITY = 50;

/**
 * How many times one session may try to hydrate the same placeholder
 * before `hydrateNoteOnOpen` gives up on it. Hydration is re-triggered by
 * `render()` for as long as the displayed note is still a placeholder, so
 * anything that keeps the body from landing — a fetch that fails every
 * time (expired token, Drive 403), a body whose `id` does not match the
 * index entry, a workspace commit that does not stick — turns into
 * fetch → render → fetch with no console error and a page that never
 * paints (2026-09-13, production). After this many attempts the note is
 * left as a placeholder and one `[hydrate]` warning says why.
 */
export const HYDRATE_MAX_ATTEMPTS_PER_NOTE = 3;

/**
 * How long the "Reloading…" state of the update banner waits for the new
 * service worker to take control before the page reloads itself anyway.
 * `updateSW(true)` posts SKIP_WAITING to `registration.waiting` and reloads
 * on `controllerchange`; when there is no waiting worker any more (DevTools
 * "Update on reload", a second tab that already activated it) that event
 * never comes and the button used to stay busy forever (2026-09-13).
 */
export const SW_RELOAD_FALLBACK_MS = 8_000;
