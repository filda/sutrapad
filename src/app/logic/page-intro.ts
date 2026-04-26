/**
 * Per-page intro state — visit counter + collapse memory.
 *
 * Each `<div class="page-header">` carries a small intro lockup (eyebrow +
 * title + subtitle). After a user has seen the same intro a few times the
 * title and subtitle stop earning their keep, so we auto-fade them and keep
 * only the eyebrow chip — which doubles as a manual toggle. The state is
 * scoped per-page by a stable `pageId` and persisted to `localStorage`.
 *
 * Three pieces of per-page memory drive the display:
 *   - `visits` — how many times this page-id has been built. Incremented
 *     once per page render via {@link recordVisit}.
 *   - `dismissed` — the user explicitly clicked the eyebrow to collapse.
 *     Survives across sessions; takes priority over the auto-fade rule.
 *   - `pinned` — the user explicitly expanded an already-faded intro. We
 *     treat this as "they want to keep seeing it" and disable the
 *     auto-fade for this page-id forever after.
 *
 * Display rule (see {@link isIntroCollapsed}): collapsed when the entry was
 * dismissed, OR when `visits` has crossed {@link AUTO_FADE_AFTER} and the
 * user hasn't pinned it. The `noAutoFade` option lets daily-relevant pages
 * (Today / Home) keep their full lockup forever while still allowing the
 * eyebrow toggle to dismiss it manually.
 *
 * The shape of the persisted JSON is `Record<string, IntroEntry>`. Unknown
 * top-level shapes (a stray array, a string, a JSON parse error) reset to
 * the empty store rather than throwing — defensive parsing is cheaper than
 * forcing every reader to handle "what if localStorage was tampered with".
 *
 * Storage key (`STORAGE_KEY`) matches the v3 prototype so a returning user
 * who already saw the React handoff doesn't lose their dismissed state when
 * we ship this implementation.
 */

/**
 * After how many visits the title + subtitle should auto-fade out, leaving
 * only the eyebrow chip. Counted strictly greater-than: the 11th visit is
 * the first one rendered collapsed, so the user sees the full lockup for
 * exactly ten visits before it folds away.
 */
export const AUTO_FADE_AFTER = 10;

const STORAGE_KEY = "sp.intros.v1";

/** Persisted state for a single page-id. */
export interface IntroEntry {
  /** Total times this page has built a header. Bumped on every visit. */
  visits: number;
  /** User clicked the eyebrow to fold the intro away. */
  dismissed: boolean;
  /** User clicked the eyebrow to expand a faded intro — disable auto-fade. */
  pinned: boolean;
}

/** Per-page store, keyed by stable page-id strings. */
export type IntroStore = Record<string, IntroEntry>;

/** Options passed to the display-rule helper. Mirrors the v3 props. */
export interface IntroDisplayOptions {
  /** Skip the auto-fade rule (manual dismiss still works). */
  noAutoFade?: boolean;
}

/** Returns a fresh entry for a page that has never been visited. */
export function emptyIntroEntry(): IntroEntry {
  return { visits: 0, dismissed: false, pinned: false };
}

/**
 * Structural guard. Defensive against tampered localStorage: anything that
 * isn't a plain object with the expected scalar fields is treated as if the
 * page had never been visited. We don't throw — JSON in user storage is a
 * cooperative contract, not a typed schema.
 */
function isIntroEntry(value: unknown): value is IntroEntry {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.visits === "number" &&
    Number.isFinite(v.visits) &&
    v.visits >= 0 &&
    typeof v.dismissed === "boolean" &&
    typeof v.pinned === "boolean"
  );
}

/**
 * Loads the persisted intro store. Returns an empty store on:
 *   - first run (slot is empty),
 *   - JSON parse error,
 *   - any non-object top-level shape,
 *   - any entry that fails the structural guard (the bad entry is dropped,
 *     the rest survive).
 *
 * The default `Storage` shim makes the test path explicit — every call site
 * that doesn't pass one falls back to `window.localStorage`, matching the
 * pattern in `visible-tag-classes.ts`.
 */
export function loadIntroStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): IntroStore {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  // `parsed` defaults to null so a JSON parse failure falls through into the
  // shape guard below — it's already prepared to send null + arrays + non-
  // objects to the empty-store path, so we don't need a second early return.
  // Keeping a single exit point also makes the catch block legitimately empty
  // rather than hiding behaviour Stryker can't tell apart from the guard.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Intentionally empty — see comment above the try.
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: IntroStore = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isIntroEntry(value)) out[key] = value;
  }
  return out;
}

/**
 * Persists the store. Wrapped in try/catch because `setItem` can throw on
 * quota overflow or in a private-browsing context where the slot is
 * read-only. Failure is silent — the worst case is the visit counter
 * resetting next session, which is acceptable for this purely cosmetic
 * feature.
 */
export function persistIntroStore(
  store: IntroStore,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Intentionally swallow — see doc comment.
  }
}

/**
 * Returns the entry for a page-id, or a fresh zero entry when the page has
 * never been visited. Pure — never mutates `store`. Lets call sites read
 * out current state without having to re-implement the empty-default.
 */
export function getIntroEntry(store: IntroStore, pageId: string): IntroEntry {
  return store[pageId] ?? emptyIntroEntry();
}

/**
 * Pure increment. Returns a new store with the page-id's `visits` bumped
 * by one (other fields preserved, or set to defaults on first visit).
 */
export function recordVisit(store: IntroStore, pageId: string): IntroStore {
  const entry = getIntroEntry(store, pageId);
  return { ...store, [pageId]: { ...entry, visits: entry.visits + 1 } };
}

/**
 * Display rule. Pure: takes an entry + options and returns whether the
 * title+subtitle should be hidden.
 *
 * Precedence:
 *   1. `dismissed` always wins — the user manually folded it away.
 *   2. `noAutoFade` short-circuits the visit-count rule when the entry
 *      isn't dismissed (Today / Home where a daily-changing greeting
 *      shouldn't quietly stop showing).
 *   3. Otherwise: collapsed once `visits > AUTO_FADE_AFTER`, unless the
 *      user pinned the intro by re-expanding it after a previous fade.
 *
 * The strict greater-than means the 11th visit is the first collapsed
 * render. After ten full-strength views the lockup folds; the count
 * keeps growing in storage but the threshold check stays stable.
 */
export function isIntroCollapsed(
  entry: IntroEntry,
  options: IntroDisplayOptions = {},
): boolean {
  if (entry.dismissed) return true;
  if (options.noAutoFade) return false;
  if (entry.pinned) return false;
  return entry.visits > AUTO_FADE_AFTER;
}

/**
 * Pure toggle. Returns a new store with the entry flipped between
 * collapsed and expanded.
 *
 * Expanding pins the entry forever after — the user has signalled they
 * want to keep seeing the full lockup, so the auto-fade rule must not
 * silently re-collapse it on the next visit. `pinned` is sticky across
 * subsequent collapses (the user can still dismiss it manually) so that
 * a future "expand" never has to re-set the pin.
 */
export function toggleIntroCollapse(
  store: IntroStore,
  pageId: string,
  currentlyCollapsed: boolean,
): IntroStore {
  const entry = getIntroEntry(store, pageId);
  const nowCollapsed = !currentlyCollapsed;
  return {
    ...store,
    [pageId]: {
      ...entry,
      dismissed: nowCollapsed,
      pinned: nowCollapsed ? entry.pinned : true,
    },
  };
}

/**
 * Wipes the entire intro store. Used by a future Tweaks "Reset all page
 * intros" button so a user who dismissed everything can get the
 * onboarding lockups back in one click.
 */
export function resetAllPageIntros(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // See persistIntroStore — silent failure is the right behaviour.
  }
}
